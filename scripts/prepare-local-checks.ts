import fs from 'node:fs/promises';
import path from 'node:path';
// Optional migration checks reuse downloaded weights without changing the old app.
// Large immutable weights are hard-linked; runtimes are copied into the test profile.
const original = process.argv[2];
if (!original) throw Error('Pass the original Orion data directory, containing models and backends.');
const profile = path.resolve('.migration/integration-profile');
const root = path.join(profile, 'orion');
await fs.mkdir(root, { recursive: true });
const llama = path.join(root, 'backends/llama.cpp');
await fs.cp(path.join(original, 'backends/llama.cpp/runtime-cpu'), path.join(llama, 'runtime-cpu'), { recursive: true });
const cpu = path.join(llama, 'runtime-cpu/llama-server.exe');
await fs.writeFile(path.join(llama, 'orion-state.json'), JSON.stringify({ release: 'b11609', backend: 'cpu', gpu: 'CPU migration check', serverBinary: cpu, cpuBinary: cpu, runtimeDirectory: path.dirname(cpu), cpuRuntimeDirectory: path.dirname(cpu) }));
const models = path.join(root, 'models');
await fs.mkdir(path.join(models, 'chat/migration-check'), { recursive: true });
const modelPath = 'chat/migration-check/qwen3-0.6b-q4_k_m.gguf';
const link = async (source: string, target: string) => { await fs.mkdir(path.dirname(target), { recursive: true }); try { await fs.link(source, target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } };
await link(path.join(original, 'models/subagents/qwen3-0.6b-q4_k_m.gguf'), path.join(models, modelPath));
const sourceIndex = JSON.parse(await fs.readFile(path.join(original, 'models/installed.json'), 'utf8'));
const media = sourceIndex.filter((item: any) => item.category !== 'conversational');
for (const item of media) for (const relative of new Set<string>([item.path, ...(item.files ?? [])])) await link(path.join(original, 'models', relative), path.join(models, relative));
const local = { id: 'migration-qwen3-06b', repo: 'Qwen/Qwen3-0.6B-GGUF', file: path.basename(modelPath), category: 'conversational', path: modelPath, size: (await fs.stat(path.join(models, modelPath))).size, downloadedAt: Date.now() };
await fs.writeFile(path.join(models, 'installed.json'), JSON.stringify([local, ...media]));
await fs.cp(path.join(original, 'backends/diffusion'), path.join(root, 'backends/diffusion'), { recursive: true, filter: source => !source.endsWith('.zip') });
await fs.cp(path.join(original, 'voice'), path.join(root, 'voice'), { recursive: true, filter: source => !source.endsWith('.enc') });
await fs.writeFile(path.join(root, 'migration-check.txt'), 'Synthetic document for the Orion Tauri conversion checks.');
console.log(`Prepared isolated local-runtime check profile: ${profile}`);
