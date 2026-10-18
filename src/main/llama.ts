import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { DownloadProgress, ModelCompatibilityReport } from '../shared/types';

type Asset = { name: string; size: number; browser_download_url: string };
type Release = { tag_name: string; prerelease: boolean; assets: Asset[] };
type Hardware = { backend: string; label: string; driver: string };
type State = { release: string; gpu: string; backend: string; serverBinary: string; cpuBinary: string; cudart?: string; runtimeDirectory?: string; cpuRuntimeDirectory?: string };
export function isModelCompatibilityError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/out of memory|not enough memory|failed to allocate|cannot allocate|corrupt|unexpected end|file.*missing|startup was cancelled|shutting down/i.test(message)) return false;
  return /unknown (?:model )?architecture|unsupported (?:model |gguf )?(?:architecture|version)|architecture.*not supported|unknown pre.tokenizer|unknown model type|unsupported tensor type|chat.?template|jinja|tokenizer.*not supported/i.test(message);
}
type DownloadSink = (progress: DownloadProgress) => void;

function run(executable: string, args: string[], timeout = 20000, env?: NodeJS.ProcessEnv) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ['ignore','pipe','pipe'] }); let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-16000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16000); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

export class LlamaManager {
  private readonly root: string;
  private readonly stateFile: string;
  private readonly emit: DownloadSink;
  private state: State | null = null;
  private installPromise: Promise<void> | null = null;
  private process: ChildProcess | null = null;
  private port = 0;
  private activeModel = '';
  private activeContext = 0;
  private lifecycle: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private disposed = false;
  private serverLog = '';
  private modelRuntimes: Record<string, State> | null = null;
  private compatibilityManager: LlamaManager | null = null;
  private async runtimeForModel(modelPath: string) {
    if (!this.modelRuntimes) {
      try {
        const profiles = JSON.parse(await fs.readFile(path.join(this.root, 'model-runtimes.json'), 'utf8'));
        this.modelRuntimes = profiles && typeof profiles === 'object' && !Array.isArray(profiles) ? profiles : {};
      }
      catch { this.modelRuntimes = {}; }
    }
    return this.modelRuntimes?.[modelPath] ?? await this.loadState();
  }

  constructor(dataRoot: string, emit: DownloadSink) { this.root = path.join(dataRoot, 'orion', 'backends', 'llama.cpp'); this.stateFile = path.join(this.root, 'orion-state.json'); this.emit = emit; }
  private report(id: string, file: string, received: number, total: number, phase: DownloadProgress['phase'], error?: string) { this.emit({ id, repo: 'Orion llama.cpp', file, received, total, phase, ...(error ? { error } : {}) }); }
  private async loadState() { if (this.state) return this.state; try { this.state = JSON.parse(await fs.readFile(this.stateFile, 'utf8')) as State; return this.state; } catch { return null; } }
  async isInstalled() { const state = await this.loadState(); return Boolean(state && await fs.access(state.serverBinary).then(() => true, () => false) && await fs.access(state.cpuBinary).then(() => true, () => false)); }
  private async hardware(): Promise<Hardware> {
    const nvidiaCandidates = process.platform === 'win32' ? ['nvidia-smi.exe', path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe'), path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')] : ['nvidia-smi'];
    let nvidia: Awaited<ReturnType<typeof run>> | null = null;
    for (const executable of nvidiaCandidates) { nvidia = await run(executable, ['--query-gpu=name,driver_version','--format=csv,noheader'], 9000).catch(() => null); if (nvidia?.code === 0 && nvidia.stdout.trim()) break; }
    if (nvidia?.code === 0 && nvidia.stdout.trim()) {
      const [name, driver] = nvidia.stdout.trim().split(/,\s*/);
      const driverMajor = Number((driver ?? '').split('.')[0]);
      if (driverMajor >= 570) return { backend: 'cuda', label: `NVIDIA ${name}`, driver: driver ?? '' };
      // Recent CUDA 12/13 packages need newer drivers. Keep older NVIDIA cards
      // on Vulkan if available, otherwise use the known working CPU package.
      // `vulkaninfo` is not installed on most end-user systems even when the
      // graphics driver exposes Vulkan. Verify the bundled server itself later.
      if (process.platform === 'linux' || process.platform === 'win32') return { backend: 'vulkan', label: `NVIDIA ${name} · Vulkan fallback`, driver: driver ?? '' };
      return { backend: 'cpu', label: `NVIDIA ${name} detected · CPU fallback (driver ${driver} is too old for the managed CUDA runtime)`, driver: driver ?? '' };
    }
    if (process.platform === 'darwin') return { backend: 'metal', label: process.arch === 'arm64' ? 'Apple Silicon Metal' : 'Intel Mac', driver: '' };
    if (process.platform === 'linux') {
      const amd = await run('rocminfo', [], 12000).catch(() => null);
      if (amd?.code === 0) return { backend: 'rocm', label: 'AMD ROCm GPU', driver: '' };
    }
    if (process.platform === 'linux' || process.platform === 'win32') return { backend: 'vulkan', label: 'Vulkan-capable GPU candidate (verified after installing llama.cpp)', driver: '' };
    return { backend: 'cpu', label: 'CPU inference', driver: '' };
  }
  private chooseAssets(release: Release, gpu: Hardware, platform: NodeJS.Platform = process.platform, arch: string = process.arch) {
    const assets = release.assets; const find = (regex: RegExp) => assets.find(a => regex.test(a.name));
    let gpuAsset: Asset | undefined, cudart: Asset | undefined;
    const cuda13 = Number(gpu.driver.split('.')[0] ?? 0) >= 580;
    const supportedArch = arch === 'x64' || arch === 'arm64';
    if (platform === 'darwin' && supportedArch) gpuAsset = find(new RegExp(`^llama-${release.tag_name}-bin-macos-${arch}\\.tar\\.gz$`));
    else if (platform === 'linux' && supportedArch && gpu.backend === 'cuda') {
      // The release publishes CUDA 12.8 for x64 and CUDA 13.4 for both x64 and ARM64.
      const version = cuda13 ? '13\\.(?:3|4)' : arch === 'x64' ? '12\\.8' : '';
      if (version) {
        gpuAsset = find(new RegExp(`^llama-${release.tag_name}-bin-ubuntu-cuda-${version}-${arch}\\.tar\\.gz$`));
        cudart = find(new RegExp(`^cudart-llama-(?:${release.tag_name}-)?bin-ubuntu-cuda-${version}-${arch}\\.tar\\.gz$`));
      }
    } else if (platform === 'win32' && supportedArch && gpu.backend === 'cuda') {
      // CUDA 12.4 is x64 only; CUDA 13.4 has x64 and ARM64 packages.
      const version = cuda13 ? '13\\.(?:3|4)' : arch === 'x64' ? '12\\.4' : '';
      if (version) {
        gpuAsset = find(new RegExp(`^llama-${release.tag_name}-bin-win-cuda-${version}-${arch}\\.zip$`));
        cudart = find(new RegExp(`^cudart-llama-(?:${release.tag_name}-)?bin-win-cuda-${version}-${arch}\\.zip$`));
      }
    } else if (platform === 'linux' && arch === 'x64' && gpu.backend === 'rocm') gpuAsset = find(new RegExp(`^llama-${release.tag_name}-bin-ubuntu-rocm-10\\.0-x64\\.tar\\.gz$`));
    else if ((platform === 'linux' || platform === 'win32') && gpu.backend === 'vulkan') gpuAsset = platform === 'linux'
      ? supportedArch ? find(new RegExp(`^llama-${release.tag_name}-bin-ubuntu-vulkan-${arch}\\.tar\\.gz$`)) : undefined
      : arch === 'x64' ? find(new RegExp(`^llama-${release.tag_name}-bin-win-vulkan-x64\\.zip$`)) : undefined;
    const cpuAsset = platform === 'win32'
      ? supportedArch ? find(new RegExp(`^llama-${release.tag_name}-bin-win-cpu-${arch}\\.zip$`)) : undefined
      : platform === 'darwin'
        ? supportedArch ? find(new RegExp(`^llama-${release.tag_name}-bin-macos-${arch}\\.tar\\.gz$`)) : undefined
        : platform === 'linux' && supportedArch ? find(new RegExp(`^llama-${release.tag_name}-bin-ubuntu-${arch}\\.tar\\.gz$`)) : undefined;
    if (!gpuAsset && gpu.backend === 'cuda' && ((platform === 'linux' && arch === 'x64') || (platform === 'win32' && arch === 'x64'))) {
      gpuAsset = platform === 'linux'
        ? find(new RegExp(`^llama-${release.tag_name}-bin-ubuntu-vulkan-x64\\.tar\\.gz$`))
        : find(new RegExp(`^llama-${release.tag_name}-bin-win-vulkan-x64\\.zip$`));
    }
    return { gpuAsset: gpuAsset ?? cpuAsset, accelerated: Boolean(gpuAsset), cpuAsset: gpu.backend === 'cpu' || gpu.backend === 'metal' ? undefined : cpuAsset, cudart: gpu.backend === 'cuda' && gpuAsset?.name.includes('-cuda-') ? cudart : undefined };
  }
  private async fetchAsset(asset: Asset, id: string) {
    const file = path.join(this.root, asset.name), temp = `${file}.${id}.partial`;
    const response = await fetch(asset.browser_download_url, { headers: { 'user-agent': 'Orion-Local-AI/0.1' } });
    if (!response.ok || !response.body) throw new Error(`llama.cpp download failed (${response.status}): ${asset.name}`);
    await fs.mkdir(this.root, { recursive: true }); const handle = await fs.open(temp, 'w', 0o600); const total = Number(response.headers.get('content-length') ?? asset.size); let received = 0, last = 0;
    try { const reader = response.body.getReader(); while (true) { const { value, done } = await reader.read(); if (done) break; let offset = 0; while (offset < value.byteLength) { const result = await handle.write(value, offset, value.byteLength - offset); offset += result.bytesWritten; } received += value.byteLength; if (received - last > 1024 * 1024) { this.report(id, asset.name, received, total, 'downloading'); last = received; } } await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temp, file); this.report(id, asset.name, received, total, 'complete'); return file;
  }
  private async unpack(archive: string, destination: string) {
    await fs.mkdir(destination, { recursive: true });
    const result = await run('tar', ['-xf', archive, '-C', destination], 10 * 60 * 1000);
    if (result.code !== 0) throw new Error(`Could not unpack llama.cpp: ${result.stderr.slice(-1200)}`);
  }
  private async findBinary(root: string, name: string): Promise<string | null> {
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) { const found = await this.findBinary(full, name); if (found) return found; }
      else if (entry.name === name) return full;
    }
    return null;
  }
  private async runtimeEnvironment(root: string): Promise<NodeJS.ProcessEnv> {
    const libraryDirs: string[] = [];
    const visit = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await visit(full);
        else if (/\.(?:dll|so(?:\.\d+)*|dylib)$/i.test(entry.name)) libraryDirs.push(dir);
      }
    };
    await visit(root);
    const dirs = [...new Set(libraryDirs)];
    const env = { ...process.env };
    if (process.platform === 'win32') env.PATH = [...dirs, env.PATH].filter(Boolean).join(path.delimiter);
    else if (process.platform === 'darwin') env.DYLD_LIBRARY_PATH = [...dirs, env.DYLD_LIBRARY_PATH].filter(Boolean).join(path.delimiter);
    else env.LD_LIBRARY_PATH = [...dirs, env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter);
    return env;
  }
  async install() {
    if (this.installPromise) return this.installPromise;
    this.installPromise = this.doInstall().finally(() => { this.installPromise = null; }); return this.installPromise;
  }
  private async doInstall(previousRelease?: string) {
    const current = await this.loadState();
    if (current && await fs.access(current.serverBinary).then(() => true, () => false) && await fs.access(current.cpuBinary).then(() => true, () => false)) return;
    let gpu = await this.hardware(); const releaseResponse = await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=100', { headers: { 'user-agent': 'Orion-Local-AI/0.1', accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) });
    if (!releaseResponse.ok) throw new Error(`Could not check llama.cpp releases (${releaseResponse.status}).`);
    const releases = await releaseResponse.json() as Release[];
    let selected: { release: Release; gpuAsset: Asset; cpuAsset?: Asset; cudart?: Asset } | null = null;
    for (const release of releases) {
      if (release.prerelease) continue;
      const choices = this.chooseAssets(release, gpu);
      if (choices.gpuAsset && (gpu.backend === 'cpu' || choices.accelerated)) { selected = { release, gpuAsset: choices.gpuAsset, ...(choices.cpuAsset ? { cpuAsset: choices.cpuAsset } : {}), ...(choices.cudart ? { cudart: choices.cudart } : {}) }; break; }
    }
    if (!selected) for (const release of releases) {
      const choices = this.chooseAssets(release, gpu);
      if (choices.gpuAsset && (gpu.backend === 'cpu' || choices.accelerated)) { selected = { release, gpuAsset: choices.gpuAsset, ...(choices.cpuAsset ? { cpuAsset: choices.cpuAsset } : {}), ...(choices.cudart ? { cudart: choices.cudart } : {}) }; break; }
    }
    if (!selected && gpu.backend !== 'cpu') {
      gpu = { backend: 'cpu', label: `${gpu.label} · compatible GPU runtime unavailable, CPU fallback`, driver: gpu.driver };
      for (const release of releases) {
        if (release.prerelease) continue;
        const choices = this.chooseAssets(release, gpu);
        if (choices.gpuAsset) { selected = { release, gpuAsset: choices.gpuAsset }; break; }
      }
      if (!selected) for (const release of releases) {
        const choices = this.chooseAssets(release, gpu);
        if (choices.gpuAsset) { selected = { release, gpuAsset: choices.gpuAsset }; break; }
      }
    }
    if (!selected) throw new Error(`No llama.cpp runtime is published for ${process.platform}/${process.arch}.`);
    if (previousRelease && (selected.release.tag_name === previousRelease || (/^b\d+$/.test(previousRelease) && /^b\d+$/.test(selected.release.tag_name) && Number(selected.release.tag_name.slice(1)) <= Number(previousRelease.slice(1))))) throw new Error('No newer compatible-platform llama.cpp release is available.');
    const installId = randomUUID(); await fs.mkdir(this.root, { recursive: true });
    const gpuRoot = path.join(this.root, 'runtime-gpu'), cpuRoot = path.join(this.root, 'runtime-cpu');
    await fs.rm(gpuRoot, { recursive: true, force: true }); await fs.rm(cpuRoot, { recursive: true, force: true });
    const gpuArchive = await this.fetchAsset(selected.gpuAsset, installId); await this.unpack(gpuArchive, gpuRoot);
    if (selected.cudart) { const runtime = await this.fetchAsset(selected.cudart, installId); await this.unpack(runtime, gpuRoot); }
    const gpuBinary = await this.findBinary(gpuRoot, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
    if (!gpuBinary) throw new Error('Downloaded llama.cpp package does not include llama-server.');
    let cpuBinary = gpuBinary;
    if (selected.cpuAsset && selected.cpuAsset.name !== selected.gpuAsset.name) { const cpuArchive = await this.fetchAsset(selected.cpuAsset, installId); await this.unpack(cpuArchive, cpuRoot); cpuBinary = (await this.findBinary(cpuRoot, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server')) ?? gpuBinary; }
    const deviceEnv = await this.runtimeEnvironment(gpuRoot);
    const deviceCheck = await run(gpuBinary, ['--list-devices'], 30000, deviceEnv).catch(() => null);
    let backend = gpu.backend;
    if (gpu.backend !== 'cpu' && gpu.backend !== 'metal' && (deviceCheck?.code !== 0 || !/CUDA|Vulkan|ROCm|SYCL|GPU/i.test(deviceCheck.stdout + deviceCheck.stderr))) { backend = 'cpu'; }
    this.state = { release: selected.release.tag_name, gpu: gpu.label, backend, serverBinary: gpuBinary, cpuBinary, runtimeDirectory: gpuRoot, cpuRuntimeDirectory: cpuBinary === gpuBinary ? gpuRoot : cpuRoot };
    await fs.writeFile(this.stateFile, JSON.stringify(this.state, null, 2), { mode: 0o600 });
  }
  private async freePort() { return new Promise<number>((resolve, reject) => { const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = (server.address() as { port: number }).port; server.close(error => error ? reject(error) : resolve(port)); }); }); }
  async ensureServer(modelPath: string, context: number, mmprojPath?: string) {
    if (this.disposed) throw new Error('llama.cpp is shutting down.');
    const generation = this.generation;
    const operation = this.lifecycle.then(() => this.startServer(modelPath, context, mmprojPath, generation));
    this.lifecycle = operation.catch(() => undefined);
    return operation;
  }
  private async startServer(modelPath: string, context: number, mmprojPath: string | undefined, generation: number) {
    const check = () => { if (this.disposed || generation !== this.generation) throw new Error('llama.cpp startup was cancelled.'); };
    check();
    if (!await fs.stat(modelPath).then(s => s.isFile(), () => false)) throw new Error('The selected GGUF file is missing. Re-download it from Models.');
    const state = await this.runtimeForModel(modelPath) ?? (await this.install(), await this.loadState()); if (!state) throw new Error('llama.cpp backend did not install.');
    if (mmprojPath && !await fs.stat(mmprojPath).then(s => s.isFile(), () => false)) throw new Error('A required GGUF projector file is missing. Re-download the model from Models.');
    check();
    if (this.process && this.process.exitCode === null && !this.process.killed && this.activeModel === `${modelPath}\0${mmprojPath ?? ''}` && this.activeContext === context) {
      const healthy = await fetch(`http://127.0.0.1:${this.port}/health`, { signal: AbortSignal.timeout(2500) }).then(response => response.ok).catch(() => false);
      check();
      if (healthy) return `http://127.0.0.1:${this.port}`;
    }
    await this.stopChild(); check(); this.port = await this.freePort(); const binary = state.backend === 'cpu' ? state.cpuBinary : state.serverBinary;
    const args = ['--model', modelPath, '--host', '127.0.0.1', '--port', String(this.port), '--ctx-size', String(context), '--alias', 'orion-local', '--jinja', '--n-gpu-layers', state.backend === 'cpu' ? '0' : 'all'];
    if (mmprojPath) args.push('--mmproj', mmprojPath);
    const binaryRoot = path.relative(this.root, binary).split(path.sep)[0];
    const runtimeRoot = (state.backend === 'cpu' ? state.cpuRuntimeDirectory : state.runtimeDirectory) ?? (binaryRoot === 'runtime-cpu' ? path.join(this.root, 'runtime-cpu') : path.join(this.root, 'runtime-gpu'));
    const env = await this.runtimeEnvironment(runtimeRoot);
    check();
    this.serverLog = '';
    const child = spawn(binary, args, { cwd: path.dirname(binary), env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr?.on('data', chunk => { this.serverLog = (this.serverLog + String(chunk)).slice(-8000); });
    this.process = child;
    const spawnFailure: { error: Error | null } = { error: null };
    child.once('error', error => { spawnFailure.error = error; if (this.process === child) this.process = null; });
    child.once('exit', () => { if (this.process === child) this.process = null; }); this.activeModel = `${modelPath}\0${mmprojPath ?? ''}`; this.activeContext = context;
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      check();
      if (!this.process || this.process.killed) throw new Error(spawnFailure.error ? `Could not launch llama-server: ${spawnFailure.error.message}` : `llama-server stopped while loading the model (selected backend: ${state.backend}).\n${this.serverLog.trim()}`);
      const health = await fetch(`http://127.0.0.1:${this.port}/health`, { signal: AbortSignal.timeout(2500) }).then(r => r.ok).catch(() => false);
      if (health) { check(); return `http://127.0.0.1:${this.port}`; }
      await delay(1000);
    }
    await this.stopChild(); throw new Error('llama-server did not finish loading this model within eight minutes.');
  }
  private async probeCompatibility(modelPath: string, context: number, mmprojPath?: string) {
    const base = await this.ensureServer(modelPath, context, mmprojPath);
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'orion-local', messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 16, temperature: 0, stream: false }),
      signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) throw new Error(`Chat compatibility failed (HTTP ${response.status}): ${(await response.text()).slice(0, 1500)}`);
    const result = await response.json() as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>; usage?: { completion_tokens?: number } };
    const message = result.choices?.[0]?.message;
    if (!message || !(message.content?.trim() || message.reasoning_content?.trim() || (result.usage?.completion_tokens ?? 0) > 0)) throw new Error('The model did not produce any tokens during compatibility validation.');
  }
  async checkCompatibility(modelPath: string, context: number, mmprojPath?: string, progress: (detail: string) => void = () => {}, initialFailure?: Error): Promise<ModelCompatibilityReport> {
    if (!await this.isInstalled()) throw new Error('Install Orion’s managed llama.cpp engine first.');
    await this.lifecycle;
    const previousModel = this.activeModel, previousContext = this.activeContext;
    const state = await this.runtimeForModel(modelPath);
    const actions: string[] = [];
    let report: ModelCompatibilityReport;
    try {
      progress('Checking compatibility with the installed llama.cpp runtime…');
      if (initialFailure) throw initialFailure;
      await this.probeCompatibility(modelPath, context, mmprojPath);
      report = { status: 'compatible', detail: 'Compatible with the installed llama.cpp runtime. No adaptation is needed.', runtimeRelease: state?.release ?? 'Unknown', checkedAt: Date.now(), actions };
    } catch (error) {
      const original = error instanceof Error ? error.message : String(error);
      report = { status: 'error', detail: original, runtimeRelease: state?.release ?? 'Unknown', checkedAt: Date.now(), actions };
      if (isModelCompatibilityError(error)) {
        // Keep the working runtime intact. A replacement is assigned only to
        // this model and only after loading AND chat inference are verified.
        await this.stop();
        const candidate = new LlamaManager(path.join(this.root, 'compatibility-runtimes', randomUUID()), this.emit);
        this.compatibilityManager = candidate;
        try {
          progress('Model incompatibility detected. Checking for a newer official llama.cpp runtime…');
          await candidate.doInstall(state?.release);
          actions.push(`Downloaded official llama.cpp ${candidate.state!.release} into an isolated runtime.`);
          progress('Verifying that the new runtime supports this model…');
          await candidate.probeCompatibility(modelPath, context, mmprojPath);
          await candidate.stop();
          if (this.disposed) throw new Error('llama.cpp is shutting down.');
          const updatedProfiles = { ...this.modelRuntimes, [modelPath]: candidate.state! };
          const profileFile = path.join(this.root, 'model-runtimes.json');
          const temporary = `${profileFile}.${randomUUID()}.tmp`;
          await fs.writeFile(temporary, JSON.stringify(updatedProfiles, null, 2), { mode: 0o600 });
          await fs.rename(temporary, profileFile);
          this.modelRuntimes = updatedProfiles;
          actions.push('Saved a verified, model-specific runtime profile. Other models retain their runtime.');
          report = { status: 'repaired', canRepair: true, detail: 'This model was incompatible with its previous runtime. Orion made it compatible using a verified official runtime and will use that profile automatically.', runtimeRelease: candidate.state!.release, checkedAt: Date.now(), actions };
          progress('Compatibility restored. The verified runtime profile has been saved.');
        } catch (repairError) {
          const reason = repairError instanceof Error ? repairError.message : String(repairError);
          const unsupported = isModelCompatibilityError(repairError) || /No newer compatible-platform/.test(reason);
          report = { status: unsupported ? 'unsupported' : 'error', canRepair: unsupported ? false : undefined, detail: unsupported ? `Not compatible with the installed runtime. Orion cannot make this model compatible using the available official runtimes; implementation support from llama.cpp is required.\n${reason}` : `The model is incompatible, but Orion could not finish checking or applying a repair.\n${reason}`, runtimeRelease: state?.release ?? 'Unknown', checkedAt: Date.now(), actions: [...actions, `Original incompatibility: ${original}`] };
        } finally {
          await candidate.dispose();
          if (this.compatibilityManager === candidate) this.compatibilityManager = null;
          if (report.status !== 'repaired') await fs.rm(candidate.root, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    }
    try {
      if (previousModel) {
        const [previousPath, previousProjector] = previousModel.split('\0');
        await this.ensureServer(previousPath!, previousContext, previousProjector || undefined);
      } else await this.stop();
    } catch (error) { report.restoreWarning = `The previous model could not be restored: ${error instanceof Error ? error.message : String(error)}`; }
    return report;
  }
  async stop() {
    this.generation++;
    await this.stopChild();
    await this.lifecycle;
  }
  async dispose() { this.disposed = true; await this.compatibilityManager?.dispose(); await this.stop(); }
  private async stopChild() {
    const child = this.process;
    if (child && child.exitCode === null) {
      await new Promise<void>(resolve => {
        let finished = false;
        const finish = () => { if (finished) return; finished = true; clearTimeout(timer); child.removeListener('exit', finish); resolve(); };
        const signal = (name: NodeJS.Signals) => { if (process.platform !== 'win32' && child.pid) { try { process.kill(-child.pid, name); return; } catch { /* The group may already have exited. */ } } child.kill(name); };
        const timer = setTimeout(() => { if (child.exitCode === null) signal('SIGKILL'); finish(); }, 5000);
        child.once('exit', finish);
        if (process.platform === 'win32' && child.pid) {
          void run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], 5000).then(result => { if (result.code !== 0 && child.exitCode === null) child.kill(); }, () => child.kill());
        } else signal('SIGTERM');
      });
    }
    if (this.process === child) this.process = null;
    this.activeModel = ''; this.activeContext = 0;
  }
}
