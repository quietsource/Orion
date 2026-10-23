import { mkdir, readdir, copyFile, access, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const source = path.join(root, 'vendor', 'orion-inference-runtime');
const output = path.join(root, 'build', 'inference-runtime');
const windows = process.platform === 'win32';
const targetDir = process.env.ORION_INFERENCE_TARGET_DIR || process.env.CARGO_TARGET_DIR || path.join(root, '.build', 'orion-inference-target');
const fail = message => { throw new Error(message); };

async function run(command, args, options = {}) {
  const child = Bun.spawn([command, ...args], { cwd: source, stdout: 'inherit', stderr: 'inherit', ...options });
  if (await child.exited !== 0) fail(`${command} ${args.join(' ')} failed.`);
}

if (!await access(path.join(source, 'Cargo.toml')).then(() => true, () => false)) {
  fail('Orion’s pinned inference source is missing from vendor/orion-inference-runtime.');
}

let env = { ...process.env, CARGO_TARGET_DIR: targetDir };
const args = ['build', '--release', '--locked', '--manifest-path', path.join(source, 'orion-inference-cli', 'Cargo.toml'), '--bin', 'orion-inference'];
if (windows) {
  if (process.arch !== 'x64') fail('The bundled CUDA inference runtime currently targets Windows x64.');
  const cuda = process.env.ORION_CUDA_PATH || process.env.CUDA_PATH || '';
  if (!cuda || !await access(path.join(cuda, 'bin', 'nvcc.exe')).then(() => true, () => false)) {
    fail('A CUDA 13.4 toolkit is required to build Orion inference with CUDA. Set ORION_CUDA_PATH to its root directory.');
  }
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const vsDevCmd = process.env.VSDEVCMD || path.join(programFilesX86, 'Microsoft Visual Studio', '2022', 'BuildTools', 'Common7', 'Tools', 'VsDevCmd.bat');
  if (!await access(vsDevCmd).then(() => true, () => false)) fail('Visual Studio 2022 Build Tools are required for the Windows CUDA build.');
  const envScript = path.join(root, '.build', 'orion-inference-msvc-env.cmd');
  await mkdir(path.dirname(envScript), { recursive: true });
  await writeFile(envScript, `@echo off\r\ncall "${vsDevCmd}" -arch=x64 -host_arch=x64 >nul || exit /b 1\r\nset\r\n`);
  const setup = Bun.spawnSync(['cmd.exe', '/d', '/c', envScript], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  await rm(envScript, { force: true });
  if (setup.exitCode !== 0) fail(`Could not initialize the MSVC build environment: ${setup.stderr.toString()}`);
  for (const line of setup.stdout.toString().split(/\r?\n/)) {
    const split = line.indexOf('=');
    if (split > 0) env[line.slice(0, split)] = line.slice(split + 1);
  }
  env.CUDA_PATH = cuda;
  env.CUDA_HOME = cuda;
  env.NVCC_PREPEND_FLAGS = `${env.NVCC_PREPEND_FLAGS || ''} -Xcompiler=/Zc:preprocessor`.trim();
  const msvcPath = env.Path || env.PATH || process.env.PATH || '';
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  env.PATH = `${path.join(cuda, 'bin')};${msvcPath}`;
  args.push('--features', 'cuda');
}

const cargo = windows ? path.join(process.env.USERPROFILE || '', '.cargo', 'bin', 'cargo.exe') : 'cargo';
await run(cargo, args, { env });
const binary = path.join(targetDir, 'release', `orion-inference${windows ? '.exe' : ''}`);
await access(binary).then(() => true, () => fail(`The inference build finished without producing ${binary}.`));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await copyFile(binary, path.join(output, `orion-inference${windows ? '.exe' : ''}`));

if (windows) {
  const cuda = env.CUDA_PATH;
  // CUDA's Windows x64 redistributable DLLs live in bin/x64 on current
  // toolkits; nvcc remains in bin. Fall back to bin for older layouts.
  const cudaBin = path.join(cuda, 'bin');
  const x64Bin = path.join(cudaBin, 'x64');
  const bin = await access(x64Bin).then(() => x64Bin, () => cudaBin);
  const dlls = (await readdir(bin)).filter(name => /^(cudart64_|cublas64_|cublasLt64_|curand64_|nvrtc64_|nvrtc-builtins64_|nvJitLink_|nvptxcompiler_|nvfatbin_).*\.dll$/i.test(name));
  for (const required of ['cudart64_13.dll', 'cublas64_13.dll', 'cublasLt64_13.dll', 'curand64_10.dll']) {
    if (!dlls.some(name => name.toLowerCase() === required.toLowerCase())) fail(`CUDA runtime dependency ${required} was not found under ${bin}.`);
  }
  for (const name of dlls) await copyFile(path.join(bin, name), path.join(output, name));
}

console.log(`Built Orion Inference runtime: ${path.join(output, `orion-inference${windows ? '.exe' : ''}`)}`);
