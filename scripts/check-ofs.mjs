import electron from 'electron';
import { spawn } from 'node:child_process';

// Exercise SQLite and workers on the same embedded runtime as the shipped app.
const child = spawn(electron, ['--test', 'test/ofs-worker.cjs'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: 'inherit'
});
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
