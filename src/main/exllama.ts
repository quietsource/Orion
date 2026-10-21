import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { DownloadProgress, ModelCompatibilityReport } from '../shared/types';
import { isModelCompatibilityError } from './llama';

type Asset = { name: string; size: number; browser_download_url: string };
type Release = { tag_name: string; prerelease: boolean; assets: Asset[] };
type Exl2State = { version: string; cuda: string; torch: string; python: string; gpu: string; backend: 'cuda'; uvBinary: string; pythonBin: string; envDirectory: string; serverScript: string; runtimeDependencies?: number };
type DownloadSink = (progress: DownloadProgress) => void;

// Prebuilt ExLlamaV2 wheels are keyed by CUDA tier, torch version and Python
// version. Each tier is paired with the newest torch release published on the
// matching pytorch wheel index. Only Python 3.11 is provisioned because every
// published wheel combination includes cp311.
const EXL2_VERSION = '0.3.2';
const EXL2_PYTHON = '3.11';
const EXL2_TIERS: Array<{ minimumDriver: number; cuda: string; torch: string; index: string }> = [
  { minimumDriver: 570, cuda: 'cu128', torch: '2.7.0', index: 'https://download.pytorch.org/whl/cu128' },
  { minimumDriver: 550, cuda: 'cu124', torch: '2.6.0', index: 'https://download.pytorch.org/whl/cu124' },
  { minimumDriver: 530, cuda: 'cu121', torch: '2.5.0', index: 'https://download.pytorch.org/whl/cu121' },
  { minimumDriver: 450, cuda: 'cu118', torch: '2.6.0', index: 'https://download.pytorch.org/whl/cu118' }
];

function run(executable: string, args: string[], timeout = 20000) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore','pipe','pipe'] }); let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-16000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16000); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

// Minimal OpenAI-compatible chat server around exllamav2. Written to the
// backend directory at install time and executed by the managed Python
// environment. Chat templates come from the model itself (tokenizer_config.json
// or chat_template.jinja); a ChatML template is used when a model ships none.
const EXL2_SERVER_SCRIPT = String.raw`import argparse, json, os, sys, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--host', default='127.0.0.1')
parser.add_argument('--port', type=int, required=True)
parser.add_argument('--max-context', type=int, default=8192)
arguments = parser.parse_args()

READY = False
LOAD_ERROR = ''
GENERATION_LOCK = threading.Lock()
GENERATOR = None
TEMPLATE_SOURCE = None
STOP_IDS = []

try:
    from jinja2 import Environment
    from exllamav2 import ExLlamaV2, ExLlamaV2Cache, ExLlamaV2Config, ExLlamaV2Tokenizer
    from exllamav2.generator import ExLlamaV2Sampler, ExLlamaV2StreamingGenerator
except Exception as error:
    print('Could not import the ExLlamaV2 runtime: ' + repr(error), file=sys.stderr, flush=True)
    sys.exit(3)

TOKENIZER_TOKENS = {}
try:
    with open(os.path.join(arguments.model, 'tokenizer_config.json'), encoding='utf-8') as handle:
        TOKENIZER_TOKENS = json.load(handle)
except Exception:
    TOKENIZER_TOKENS = {}

def load_template_source():
    for candidate in ('chat_template.jinja', 'chat_template.json'):
        location = os.path.join(arguments.model, candidate)
        if os.path.isfile(location):
            try:
                with open(location, encoding='utf-8') as handle:
                    text = handle.read().strip()
                if candidate.endswith('.json'):
                    parsed = json.loads(text or '{}')
                    text = parsed.get('chat_template') or ''
                if text:
                    return text
            except Exception:
                pass
    config_template = TOKENIZER_TOKENS.get('chat_template')
    if isinstance(config_template, str) and config_template.strip():
        return config_template
    return None

CHATML_TEMPLATE = "{% for message in messages %}{{ '<|im_start|>' + message['role'] + '\n' + message['content'] + '<|im_end|>' + '\n' }}{% endfor %}{% if add_generation_prompt %}{{ '<|im_start|>' + 'assistant\n' }}{% endif %}"

def raise_exception(message):
    raise ValueError(message)

def strftime_now(format):
    return datetime.now().strftime(format)

def render_template(source, messages, tools):
    environment = Environment(trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True)
    environment.filters['tojson'] = lambda value, indent=None: json.dumps(value, ensure_ascii=False, indent=indent)
    environment.globals['raise_exception'] = raise_exception
    environment.globals['strftime_now'] = strftime_now
    template = environment.from_string(source)
    return template.render(
        messages=messages,
        tools=tools,
        add_generation_prompt=True,
        bos_token=str(TOKENIZER_TOKENS.get('bos_token') or ''),
        eos_token=str(TOKENIZER_TOKENS.get('eos_token') or ''),
        pad_token=str(TOKENIZER_TOKENS.get('pad_token') or '')
    )

def flatten_messages(body):
    messages = []
    for message in body.get('messages') or []:
        role = str(message.get('role') or 'user')
        content = message.get('content')
        if message.get('images'):
            raise ValueError('The ExLlamaV2 engine does not support image input in this Orion nightly.')
        if isinstance(content, list):
            text = '\n'.join(str(part.get('text') or '') for part in content if isinstance(part, dict) and part.get('type') in (None, 'text'))
        else:
            text = '' if content is None else str(content)
        messages.append({'role': role, 'content': text})
    return messages

config = ExLlamaV2Config(arguments.model)
config.max_seq_len = max(1024, arguments.max_context)
config.prepare()
tokenizer = ExLlamaV2Tokenizer(config)
model = ExLlamaV2(config)
cache = ExLlamaV2Cache(model, lazy=True)

def default_stop_ids():
    candidates = [tokenizer.eos_token_id, config.eos_token_id]
    ids = []
    for candidate in candidates:
        if isinstance(candidate, list):
            candidates.extend(item for item in candidate if isinstance(item, int))
        elif isinstance(candidate, int) and candidate not in ids:
            ids.append(candidate)
    return ids

def build_sampler(body):
    settings = ExLlamaV2Sampler.Settings()
    settings.temperature = max(0.0, float(body.get('temperature', 0.7) or 0.0))
    settings.top_k = int(body.get('top_k', 40) or 40)
    settings.top_p = min(1.0, max(0.05, float(body.get('top_p', 0.95) or 0.95)))
    if body.get('presence_penalty'):
        settings.token_presence_penalty = float(body['presence_penalty'])
    if body.get('frequency_penalty'):
        settings.token_frequency_penalty = float(body['frequency_penalty'])
    return settings

def chunk_response(identifier, created, delta, finish_reason):
    return {'id': identifier, 'object': 'chat.completion.chunk', 'created': created, 'model': 'orion-local',
            'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish_reason}]}

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'
    server_version = 'OrionExL2/1.0'

    def log_message(self, format, *args):
        pass

    def send_json(self, status, payload):
        data = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        route = self.path.split('?')[0]
        if route in ('/health', '/'):
            if READY:
                self.send_json(200, {'status': 'ok'})
            else:
                self.send_json(503, {'status': LOAD_ERROR or 'loading'})
        elif route == '/props':
            self.send_json(200, {'chat_template_caps': {'supports_tools': False, 'supports_tool_calls': False}})
        elif route == '/v1/models':
            self.send_json(200, {'object': 'list', 'data': [{'id': 'orion-local', 'object': 'model', 'owned_by': 'orion'}]})
        else:
            self.send_json(404, {'error': {'message': 'Unknown endpoint.'}})

    def do_POST(self):
        route = self.path.split('?')[0]
        if route != '/v1/chat/completions':
            self.send_json(404, {'error': {'message': 'Unknown endpoint.'}})
            return
        try:
            length = int(self.headers.get('content-length') or 0)
            body = json.loads(self.rfile.read(length).decode('utf-8') or '{}')
        except Exception:
            self.send_json(400, {'error': {'message': 'Invalid JSON request body.'}})
            return
        if not READY:
            self.send_json(503, {'error': {'message': LOAD_ERROR or 'The model is still loading.'}})
            return
        try:
            prompt_ids = build_prompt(body)
            budget = int(config.max_seq_len) - int(prompt_ids.shape[-1]) - 8
            if budget < 16:
                raise ValueError('This prompt is longer than the selected context window. Reduce the context or start a new conversation.')
            max_tokens = max(1, min(int(body.get('max_tokens') or min(512, budget)), budget))
            stops = list(STOP_IDS)
            for candidate in body.get('stop') or []:
                if isinstance(candidate, str) and candidate:
                    stops.append(candidate)
            GENERATOR.set_stop_conditions(stops)
        except ValueError as error:
            self.send_json(400, {'error': {'message': str(error)}})
            return
        identifier = 'chatcmpl-' + uuid.uuid4().hex
        created = int(time.time())
        abort_event = threading.Event()
        stream = bool(body.get('stream'))
        try:
            with GENERATION_LOCK:
                if stream:
                    self.generate_stream(body, prompt_ids, identifier, created, abort_event)
                else:
                    self.generate_full(body, prompt_ids, identifier, created, abort_event)
        except (BrokenPipeError, ConnectionResetError):
            abort_event.set()
        except Exception as error:
            print('Generation failed: ' + repr(error), file=sys.stderr, flush=True)
            if not stream:
                try:
                    self.send_json(500, {'error': {'message': 'Generation failed: ' + repr(error)}})
                except Exception:
                    pass

    def generate_full(self, body, prompt_ids, identifier, created, abort_event):
        max_tokens = generation_budget(body, prompt_ids)
        settings = build_sampler(body)
        collected = []
        produced = 0
        GENERATOR.begin_stream_ex(prompt_ids, settings, abort_event=abort_event)
        while produced < max_tokens:
            output = GENERATOR.stream_ex()
            collected.append(output.get('chunk') or '')
            produced += produced_tokens(output)
            if output.get('eos'):
                break
        self.send_json(200, {'id': identifier, 'object': 'chat.completion', 'created': created, 'model': 'orion-local',
            'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': ''.join(collected)}, 'finish_reason': 'stop'}],
            'usage': {'prompt_tokens': int(prompt_ids.shape[-1]), 'completion_tokens': produced, 'total_tokens': int(prompt_ids.shape[-1]) + produced}})

    def generate_stream(self, body, prompt_ids, identifier, created, abort_event):
        max_tokens = generation_budget(body, prompt_ids)
        settings = build_sampler(body)
        self.send_response(200)
        self.send_header('content-type', 'text/event-stream')
        self.send_header('cache-control', 'no-cache')
        self.end_headers()
        def emit(payload):
            self.wfile.write(('data: ' + json.dumps(payload) + '\n\n').encode('utf-8'))
            self.wfile.flush()
        emit(chunk_response(identifier, created, {'role': 'assistant'}, None))
        GENERATOR.begin_stream_ex(prompt_ids, settings, abort_event=abort_event)
        produced = 0
        while produced < max_tokens:
            output = GENERATOR.stream_ex()
            text = output.get('chunk') or ''
            if text:
                emit(chunk_response(identifier, created, {'content': text}, None))
            produced += produced_tokens(output)
            if output.get('eos'):
                break
        emit(chunk_response(identifier, created, {}, 'stop'))
        emit({'id': identifier, 'object': 'chat.completion.chunk', 'created': created, 'model': 'orion-local',
              'choices': [], 'usage': {'prompt_tokens': int(prompt_ids.shape[-1]), 'completion_tokens': produced, 'total_tokens': int(prompt_ids.shape[-1]) + produced}})
        self.wfile.write(b'data: [DONE]\n\n')
        self.wfile.flush()

def build_prompt(body):
    messages = flatten_messages(body)
    tools = body.get('tools') or None
    source = TEMPLATE_SOURCE or CHATML_TEMPLATE
    rendered = render_template(source, messages, tools)
    return tokenizer.encode(rendered, add_bos=TEMPLATE_SOURCE is None, encode_special_tokens=True)

def produced_tokens(output):
    ids = output.get('chunk_token_ids')
    try:
        return int(len(ids[0])) if ids is not None else 1
    except Exception:
        return 1

def generation_budget(body, prompt_ids):
    budget = int(config.max_seq_len) - int(prompt_ids.shape[-1]) - 8
    if budget < 16:
        raise ValueError('This prompt is longer than the selected context window. Reduce the context or start a new conversation.')
    return max(1, min(int(body.get('max_tokens') or min(512, budget)), budget))

def main():
    global READY, LOAD_ERROR, GENERATOR, TEMPLATE_SOURCE, STOP_IDS
    try:
        server = ThreadingHTTPServer((arguments.host, arguments.port), Handler)
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()
        print('Orion ExLlamaV2 server listening on ' + arguments.host + ':' + str(arguments.port), file=sys.stderr, flush=True)
        print('Loading model, this can take several minutes...', file=sys.stderr, flush=True)
        model.load_autosplit(cache, last_id_only=True)
        GENERATOR = ExLlamaV2StreamingGenerator(model, cache, tokenizer)
        STOP_IDS = default_stop_ids()
        GENERATOR.set_stop_conditions(STOP_IDS)
        TEMPLATE_SOURCE = load_template_source()
        READY = True
        print('Model ready on port ' + str(arguments.port) + '.', file=sys.stderr, flush=True)
        while True:
            time.sleep(3600)
    except Exception as error:
        LOAD_ERROR = 'The model failed to load: ' + repr(error)
        print(LOAD_ERROR, file=sys.stderr, flush=True)
        import traceback
        traceback.print_exc()
        time.sleep(2)
        sys.exit(1)

main()
`;

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = (server.address() as { port: number }).port; server.close(error => error ? reject(error) : resolve(port)); });
  });
}

export class ExllamaManager {
  private readonly root: string;
  private readonly stateFile: string;
  private readonly emit: DownloadSink;
  private state: Exl2State | null = null;
  private installPromise: Promise<void> | null = null;
  private process: ChildProcess | null = null;
  private port = 0;
  private activeModel = '';
  private activeContext = 0;
  private lifecycle: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private disposed = false;
  private serverLog = '';

  constructor(dataRoot: string, emit: DownloadSink) { this.root = path.join(dataRoot, 'orion', 'backends', 'exllamav2'); this.stateFile = path.join(this.root, 'orion-state.json'); this.emit = emit; }
  get directory() { return this.root; }
  private report(id: string, file: string, received: number, total: number, phase: DownloadProgress['phase'], error?: string) { this.emit({ id, repo: 'Orion ExLlamaV2', file, received, total, phase, ...(error ? { error } : {}) }); }
  private async loadState() {
    if (this.state) return this.state;
    try {
      const state = JSON.parse(await fs.readFile(this.stateFile, 'utf8')) as Exl2State;
      const uvName = process.platform === 'win32' ? 'uv.exe' : 'uv';
      const sharedUvRoot = path.join(path.dirname(this.root), 'uv');
      let sharedUv = await this.findBinary(sharedUvRoot, uvName);
      if (!sharedUv) {
        // Older nightly installs kept a private uv copy in this backend.
        // Copy it into Orion's shared runtime location before starting it.
        const legacyUvRoot = path.join(this.root, 'uv');
        if (await this.findBinary(legacyUvRoot, uvName)) {
          await fs.mkdir(path.dirname(sharedUvRoot), { recursive: true });
          await fs.cp(legacyUvRoot, sharedUvRoot, { recursive: true, force: false, errorOnExist: false }).catch(() => undefined);
          sharedUv = await this.findBinary(sharedUvRoot, uvName);
        }
      }
      if (sharedUv && state.uvBinary !== sharedUv) {
        state.uvBinary = sharedUv;
        await fs.writeFile(this.stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
      }
      this.state = state;
      return state;
    } catch { return null; }
  }
  private markerFile() { return path.join(this.root, 'installed.ok'); }
  private async ensureRuntimeDependencies(state: Exl2State) {
    if (state.runtimeDependencies === 2) return;
    const dependencies = await run(state.uvBinary, ['pip', 'install', '--python', state.pythonBin, 'setuptools', 'wheel', 'jinja2', 'tokenizers'], 20 * 60_000);
    if (dependencies.code !== 0) throw new Error(`Could not repair the ExLlamaV2 Python runtime dependencies: ${(dependencies.stderr || dependencies.stdout).slice(-1200)}`);
    state.runtimeDependencies = 2;
    await fs.writeFile(this.stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  }
  async isInstalled() {
    const state = await this.loadState();
    if (!state || !await fs.access(state.pythonBin).then(() => true, () => false) || !await fs.access(this.markerFile()).then(() => true, () => false)) return false;
    try { await this.ensureRuntimeDependencies(state); return true; } catch { return false; }
  }
  private async gpuHardware(): Promise<{ label: string; driverMajor: number }> {
    const candidates = process.platform === 'win32'
      ? ['nvidia-smi.exe', path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe'), path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')]
      : ['nvidia-smi'];
    for (const executable of candidates) {
      const probe = await run(executable, ['--query-gpu=name,driver_version', '--format=csv,noheader'], 9000).catch(() => null);
      if (probe?.code === 0 && probe.stdout.trim()) {
        const [name, driver] = probe.stdout.trim().split(/,\s*/);
        return { label: `NVIDIA ${name}`, driverMajor: Number((driver ?? '').split('.')[0]) || 0 };
      }
    }
    return { label: '', driverMajor: 0 };
  }
  private async fetchToFile(url: string, file: string, id: string, label: string) {
    const response = await fetch(url, { headers: { 'user-agent': 'Orion-Local-AI/0.1' }, signal: AbortSignal.timeout(30 * 60_000) });
    if (!response.ok || !response.body) throw new Error(`ExLlamaV2 download failed (${response.status}): ${label}`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${id}.partial`, handle = await fs.open(temporary, 'w', 0o600);
    const total = Number(response.headers.get('content-length') ?? 0); let received = 0, last = 0;
    try {
      const reader = response.body.getReader();
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        let offset = 0;
        while (offset < value.byteLength) { const written = await handle.write(value, offset, value.byteLength - offset); offset += written.bytesWritten; }
        received += value.byteLength;
        if (received - last > 1024 * 1024) { this.report(id, label, received, total, 'downloading'); last = received; }
      }
      await handle.sync();
    } finally { await handle.close(); }
    await fs.rename(temporary, file);
    this.report(id, label, received, total, 'complete');
    return file;
  }
  private async findBinary(root: string, name: string): Promise<string | null> {
    for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[])) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) { const found = await this.findBinary(full, name); if (found) return found; }
      else if (entry.name === name) return full;
    }
    return null;
  }
  private async selectWheel(release: Release, tier: typeof EXL2_TIERS[number]): Promise<Asset> {
    const pythonTag = 'cp311';
    const platformTag = process.platform === 'win32' ? 'win_amd64' : 'linux_x86_64';
    const version = release.tag_name.replace(/^v/, '');
    const wanted = new RegExp(`^exllamav2-${version.replace(/\./g, '\\.')}\\+${tier.cuda}\\.torch${tier.torch.replace(/\./g, '\\.')}-${pythonTag}-${pythonTag}-${platformTag}\\.whl$`);
    const asset = release.assets.find(item => wanted.test(item.name));
    if (!asset) throw new Error(`No prebuilt ExLlamaV2 ${version} wheel for ${tier.cuda}/torch ${tier.torch}/${pythonTag}/${platformTag}.`);
    return asset;
  }
  async install(force = false) {
    if (this.installPromise) return this.installPromise;
    this.installPromise = this.doInstall(force).finally(() => { this.installPromise = null; });
    return this.installPromise;
  }
  private async doInstall(force = false) {
    const alreadyInstalled = await this.isInstalled();
    if (alreadyInstalled && !force) return;
    if (process.arch !== 'x64') throw new Error('The Orion ExLlamaV2 engine requires a 64-bit Intel/AMD system.');
    const gpu = await this.gpuHardware();
    if (!gpu.driverMajor) throw new Error('The Orion ExLlamaV2 engine requires an NVIDIA GPU. Keep using the managed llama.cpp engine for this device, or install a CUDA-enabled driver.');
    const tier = EXL2_TIERS.find(item => gpu.driverMajor >= item.minimumDriver);
    if (!tier) throw new Error(`The NVIDIA driver on this device is too old for the ExLlamaV2 runtime. Update the GPU driver to 450 or newer, or keep using the managed llama.cpp engine.`);
    const releaseResponse = await fetch('https://api.github.com/repos/turboderp/exllamav2/releases/latest', { headers: { 'user-agent': 'Orion-Local-AI/0.1', accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) });
    if (!releaseResponse.ok) throw new Error(`Could not check ExLlamaV2 releases (${releaseResponse.status}).`);
    const release = await releaseResponse.json() as Release;
    const wheel = await this.selectWheel(release, tier);
    if (alreadyInstalled && force) {
      const state = await this.loadState();
      const verify = state ? await run(state.uvBinary, ['run', '--python', state.pythonBin, '--no-project', 'python', '-c', 'import setuptools; from torch.utils.cpp_extension import load; import exllamav2, jinja2; print(exllamav2.__version__)'], 120_000).catch(() => null) : null;
      if (state && verify?.code === 0 && verify.stdout.trim() === release.tag_name.replace(/^v/, '') && state.cuda === tier.cuda && state.torch === tier.torch) return;
      await this.stop();
      await fs.rm(state?.envDirectory ?? path.join(this.root, 'env'), { recursive: true, force: true });
    }
    const installId = randomUUID();
    await fs.mkdir(this.root, { recursive: true });
    this.report(installId, 'Preparing the managed ExLlamaV2 runtime', 0, 0, 'downloading');
    // Keep one Orion-managed uv installation shared by Python-backed engines,
    // instead of downloading a private copy inside the ExLlamaV2 folder.
    const uvRoot = path.join(path.dirname(this.root), 'uv');
    const uvName = process.platform === 'win32' ? 'uv.exe' : 'uv';
    await fs.mkdir(uvRoot, { recursive: true });
    let uvBinary = await this.findBinary(uvRoot, uvName);
    if (!uvBinary) {
      await fs.rm(uvRoot, { recursive: true, force: true });
      await fs.mkdir(uvRoot, { recursive: true });
      const uvAsset = process.platform === 'win32' ? 'uv-x86_64-pc-windows-msvc.zip' : 'uv-x86_64-unknown-linux-gnu.tar.gz';
      const uvArchive = await this.fetchToFile(`https://github.com/astral-sh/uv/releases/latest/download/${uvAsset}`, path.join(uvRoot, uvAsset), installId, uvAsset);
      const unpacked = await run('tar', ['-xf', uvArchive, '-C', uvRoot], 10 * 60 * 1000);
      if (unpacked.code !== 0) throw new Error(`Could not unpack Orion's Python environment manager: ${(unpacked.stderr || unpacked.stdout).slice(-800)}`);
      await fs.rm(uvArchive, { force: true });
      uvBinary = await this.findBinary(uvRoot, uvName);
    }
    if (!uvBinary) throw new Error("Orion's shared uv installation is incomplete.");
    const envDirectory = path.join(this.root, 'env');
    const pythonBin = process.platform === 'win32' ? path.join(envDirectory, 'Scripts', 'python.exe') : path.join(envDirectory, 'bin', 'python');
    await fs.rm(envDirectory, { recursive: true, force: true }).catch(() => undefined);
    const venv = await run(uvBinary, ['venv', envDirectory, '--python', EXL2_PYTHON], 20 * 60_000);
    if (venv.code !== 0) throw new Error(`Could not prepare the managed Python environment: ${(venv.stderr || venv.stdout).slice(-1200)}`);
    // torch.utils.cpp_extension imports setuptools even when ExLlamaV2 is
    // installed from its prebuilt wheel. uv-created environments do not
    // include setuptools, so provision the runtime dependency explicitly
    // before installing or importing either package.
    const buildTools = await run(uvBinary, ['pip', 'install', '--python', pythonBin, 'setuptools', 'wheel'], 15 * 60_000);
    if (buildTools.code !== 0) throw new Error(`Could not install the ExLlamaV2 Python support packages: ${(buildTools.stderr || buildTools.stdout).slice(-1200)}`);
    this.report(installId, `PyTorch ${tier.torch} (${tier.cuda.toUpperCase()} · several GB, no progress available)`, 0, 0, 'downloading');
    const torch = await run(uvBinary, ['pip', 'install', '--python', pythonBin, `torch==${tier.torch}`, '--index-url', tier.index], 90 * 60_000);
    if (torch.code !== 0) throw new Error(`Could not install PyTorch: ${(torch.stderr || torch.stdout).slice(-1600)}`);
    const runtimePackages = await run(uvBinary, ['pip', 'install', '--python', pythonBin, 'jinja2', 'tokenizers'], 15 * 60_000);
    if (runtimePackages.code !== 0) throw new Error(`Could not install the ExLlamaV2 runtime packages: ${(runtimePackages.stderr || runtimePackages.stdout).slice(-1200)}`);
    const wheelFile = await this.fetchToFile(wheel.browser_download_url, path.join(this.root, wheel.name), installId, `ExLlamaV2 ${release.tag_name} (${tier.cuda})`);
    const wheelInstall = await run(uvBinary, ['pip', 'install', '--python', pythonBin, wheelFile], 30 * 60_000);
    await fs.rm(wheelFile, { force: true }).catch(() => undefined);
    if (wheelInstall.code !== 0) throw new Error(`Could not install ExLlamaV2: ${(wheelInstall.stderr || wheelInstall.stdout).slice(-1600)}`);
    const serverScript = path.join(this.root, 'orion-exl2-server.py');
    await fs.writeFile(serverScript, EXL2_SERVER_SCRIPT, { mode: 0o600 });
    const verify = await run(uvBinary, ['run', '--python', pythonBin, '--no-project', 'python', '-c', 'import setuptools; from torch.utils.cpp_extension import load; import exllamav2, jinja2; print(exllamav2.__version__)'], 120_000);
    if (verify.code !== 0) throw new Error(`The ExLlamaV2 runtime failed verification: ${(verify.stderr || verify.stdout).slice(-1200)}`);
    this.state = { version: verify.stdout.trim() || release.tag_name.replace(/^v/, ''), cuda: tier.cuda, torch: tier.torch, python: EXL2_PYTHON, gpu: `${gpu.label} (driver ${gpu.driverMajor})`, backend: 'cuda', uvBinary, pythonBin, envDirectory, serverScript, runtimeDependencies: 2 };
    await fs.writeFile(this.stateFile, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await fs.writeFile(this.markerFile(), 'seen', { mode: 0o600 });
    this.report(installId, 'Managed ExLlamaV2 runtime', 1, 1, 'complete');
  }
  async ensureServer(modelDirectory: string, context: number) {
    if (this.disposed) throw new Error('ExLlamaV2 is shutting down.');
    const generation = this.generation;
    const operation = this.lifecycle.then(() => this.startServer(modelDirectory, context, generation));
    this.lifecycle = operation.catch(() => undefined);
    return operation;
  }
  private async startServer(modelDirectory: string, context: number, generation: number) {
    const check = () => { if (this.disposed || generation !== this.generation) throw new Error('ExLlamaV2 startup was cancelled.'); };
    check();
    if (!await fs.stat(modelDirectory).then(stat => stat.isDirectory(), () => false)) throw new Error('The selected EXL2 model folder is missing. Re-download it from Models.');
    const state = await this.loadState() ?? (await this.install(), await this.loadState());
    if (!state) throw new Error('The ExLlamaV2 backend did not install.');
    await this.ensureRuntimeDependencies(state);
    check();
    if (this.process && this.process.exitCode === null && !this.process.killed && this.activeModel === modelDirectory && this.activeContext === context) {
      const healthy = await fetch(`http://127.0.0.1:${this.port}/health`, { signal: AbortSignal.timeout(2500) }).then(response => response.ok).catch(() => false);
      check();
      if (healthy) return `http://127.0.0.1:${this.port}`;
    }
    await this.stopChild(); check();
    this.port = await freePort();
    const args = [state.serverScript, '--model', modelDirectory, '--host', '127.0.0.1', '--port', String(this.port), '--max-context', String(Math.max(1024, context))];
    check();
    this.serverLog = '';
    const child = spawn(state.uvBinary, ['run', '--python', state.pythonBin, '--no-project', 'python', ...args], { cwd: this.root, env: process.env, windowsHide: true, detached: false, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr?.on('data', chunk => { this.serverLog = (this.serverLog + String(chunk)).slice(-8000); });
    this.process = child;
    const spawnFailure: { error: Error | null } = { error: null };
    child.once('error', error => { spawnFailure.error = error; if (this.process === child) this.process = null; });
    child.once('exit', () => { if (this.process === child) this.process = null; });
    this.activeModel = modelDirectory; this.activeContext = context;
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      check();
      if (!this.process || this.process.killed) throw new Error(spawnFailure.error ? `Could not launch the ExLlamaV2 server: ${spawnFailure.error.message}` : `The ExLlamaV2 server stopped while loading the model.\n${this.serverLog.trim()}`);
      const health = await fetch(`http://127.0.0.1:${this.port}/health`, { signal: AbortSignal.timeout(2500) }).then(response => response.ok).catch(() => false);
      if (health) { check(); return `http://127.0.0.1:${this.port}`; }
      await delay(1000);
    }
    await this.stopChild();
    throw new Error('The ExLlamaV2 server did not finish loading this model within fifteen minutes.');
  }
  private async probeCompatibility(modelDirectory: string, context: number) {
    const base = await this.ensureServer(modelDirectory, context);
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'orion-local', messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 16, temperature: 0, stream: false }),
      signal: AbortSignal.timeout(120_000)
    });
    if (!response.ok) throw new Error(`Chat compatibility failed (HTTP ${response.status}): ${(await response.text()).slice(0, 1500)}`);
    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { completion_tokens?: number } };
    if (!(result.choices?.[0]?.message?.content?.trim() || (result.usage?.completion_tokens ?? 0) > 0)) throw new Error('The model did not produce any tokens during compatibility validation.');
  }
  async checkCompatibility(modelDirectory: string, context: number, progress: (detail: string) => void = () => {}, initialFailure?: Error): Promise<ModelCompatibilityReport> {
    if (!await this.isInstalled()) throw new Error('Install Orion’s managed ExLlamaV2 engine first.');
    await this.lifecycle;
    const state = await this.loadState();
    const previousModel = this.activeModel, previousContext = this.activeContext;
    let report: ModelCompatibilityReport;
    try {
      progress('Checking compatibility with the installed ExLlamaV2 runtime…');
      if (initialFailure) throw initialFailure;
      await this.probeCompatibility(modelDirectory, context);
      report = { status: 'compatible', detail: 'Compatible with the installed ExLlamaV2 runtime.', runtimeRelease: state ? `ExLlamaV2 ${state.version} · ${state.cuda}` : 'ExLlamaV2', checkedAt: Date.now(), actions: [] };
    } catch (error) {
      const original = error instanceof Error ? error.message : String(error);
      const unsupported = isModelCompatibilityError(error);
      report = {
        status: unsupported ? 'unsupported' : 'error',
        canRepair: false,
        detail: unsupported
          ? `Not compatible with the ExLlamaV2 runtime. Orion cannot rewrite EXL2 models; download a different quantization for this GPU.\n${original}`
          : `The model could not be checked against the ExLlamaV2 runtime.\n${original}`,
        runtimeRelease: state ? `ExLlamaV2 ${state.version} · ${state.cuda}` : 'ExLlamaV2', checkedAt: Date.now(),
        actions: initialFailure ? [`Original failure: ${original}`] : []
      };
    }
    try {
      if (previousModel) await this.ensureServer(previousModel, previousContext);
      else await this.stop();
    } catch (error) { report.restoreWarning = `The previous model could not be restored: ${error instanceof Error ? error.message : String(error)}`; }
    return report;
  }
  async stop() {
    this.generation++;
    await this.stopChild();
    await this.lifecycle;
  }
  async dispose() { this.disposed = true; await this.stop(); }
  async uninstall() { await this.stop(); await fs.rm(this.root, { recursive: true, force: true }); this.state = null; }
  private async stopChild() {
    const child = this.process;
    if (child && child.exitCode === null) {
      await new Promise<void>(resolve => {
        let finished = false;
        const finish = () => { if (finished) return; finished = true; clearTimeout(timer); child.removeListener('exit', finish); resolve(); };
        const signal = (name: NodeJS.Signals) => { child.kill(name); };
        const timer = setTimeout(() => { if (child.exitCode === null) signal('SIGKILL'); finish(); }, 5000);
        child.once('exit', finish);
        if (process.platform === 'win32' && child.pid) {
          void run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], 5000).then(() => undefined, () => child.kill());
        } else signal('SIGTERM');
      });
    }
    if (this.process === child) this.process = null;
    this.activeModel = ''; this.activeContext = 0;
  }
}
