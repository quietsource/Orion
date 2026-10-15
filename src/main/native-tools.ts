import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import spawn from 'cross-spawn';

type FunctionTool = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
type ToolResult = { output: string; success: boolean };

const objectSchema = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({ type: 'object', properties, required, additionalProperties: false });
export const nativeWorkspaceTools: FunctionTool[] = [
  { type: 'function', function: { name: 'workspace_list', description: 'Inspect project structure. Call once for a directory, then use its listing; use offset only to fetch the next page. Never repeat the same path and offset.', parameters: objectSchema({ path: { type: 'string', description: 'Workspace-relative directory; defaults to .' }, offset: { type: 'integer', minimum: 0, description: 'Use the next offset reported by Orion, not 0 again.' }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, []) } },
  { type: 'function', function: { name: 'workspace_glob', description: 'Find project files by workspace-relative glob pattern such as src/**/*.ts. Use a narrow pattern and do not repeat the same search.', parameters: objectSchema({ pattern: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 300 } }, ['pattern']) } },
  { type: 'function', function: { name: 'workspace_search', description: 'Find matching lines in project text files. Search only when you have a specific symbol or text to locate; do not repeat the same query and directory.', parameters: objectSchema({ query: { type: 'string', description: 'Specific text or symbol to locate' }, path: { type: 'string', description: 'Optional workspace-relative directory' } }, ['query']) } },
  { type: 'function', function: { name: 'workspace_grep', description: 'Search project files for literal text or a regular expression, optionally restricted by path and file glob. Returns file and line references; never use broad queries repeatedly.', parameters: objectSchema({ pattern: { type: 'string' }, path: { type: 'string' }, include: { type: 'string', description: 'Optional glob such as **/*.ts' }, regex: { type: 'boolean' }, case_sensitive: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, ['pattern']) } },
  { type: 'function', function: { name: 'workspace_read', description: 'Read a project file. Output includes line numbers and next offset. Read only relevant files and ranges; never repeat an already successful path and offset. Use a new offset to continue.', parameters: objectSchema({ path: { type: 'string', description: 'Workspace-relative file path from workspace_list or workspace_search' }, offset: { type: 'integer', minimum: 0, description: 'Line offset; use only the next offset reported by Orion.' }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, ['path']) } },
  { type: 'function', function: { name: 'workspace_rules', description: 'Read applicable repository instructions such as AGENTS.md, ORION.md, or project guidance files before making changes. This is read-only.', parameters: objectSchema({ path: { type: 'string', description: 'Workspace-relative directory or file whose parent instructions should be found' } }, []) } },
  { type: 'function', function: { name: 'workspace_write', description: 'Create or replace a workspace file after inspecting relevant existing files. This changes the private project proposal for review.', parameters: objectSchema({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']) } },
  { type: 'function', function: { name: 'workspace_edit', description: 'Apply a precise change to a workspace file using one unique exact old_text passage. If not found or not unique, read the current file and retry with corrected context.', parameters: objectSchema({ path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, ['path', 'old_text', 'new_text']) } },
  { type: 'function', function: { name: 'workspace_run', description: 'Run one command from the workspace root. Use for a concrete build, verification, or project operation; do not repeat a command that already succeeded without a reason.', parameters: objectSchema({ command: { type: 'string', description: 'Command line to execute from the workspace root' }, timeout_seconds: { type: 'integer', minimum: 1, maximum: 300 } }, ['command']) } }
];

export function parseTextToolCalls(text: string, allowedTools: Array<{ function: { name: string } }>) {
  const allowed = new Set(allowedTools.map(tool => tool.function.name));
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const visibleText = text.replace(/<orion_tool_call>\s*([\s\S]*?)\s*<\/orion_tool_call>/gi, (whole, body: string) => {
    try {
      const value: unknown = JSON.parse(body);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return whole;
      const request = value as { name?: unknown; arguments?: unknown; input?: unknown };
      if (typeof request.name !== 'string' || !allowed.has(request.name)) return whole;
      const args = request.arguments ?? request.input ?? {};
      if (!args || typeof args !== 'object' || Array.isArray(args)) return whole;
      calls.push({ name: request.name, arguments: args as Record<string, unknown> });
      return '';
    } catch { return whole; }
  }).trim();
  return { calls, visibleText };
}

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function resolveWorkspacePath(root: string, input: unknown, writing = false) {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0')) throw new Error('Provide a workspace-relative path.');
  const target = path.resolve(root, input);
  if (!inside(root, target)) throw new Error('The path must stay inside the selected workspace.');
  let current = writing ? path.dirname(target) : target;
  while (true) {
    try {
      const real = await fs.realpath(current);
      if (!inside(root, real)) throw new Error('The path resolves outside the selected workspace.');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
  try {
    if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('Symbolic links cannot be edited by workspace tools.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!writing) {
    const real = await fs.realpath(target);
    if (!inside(root, real)) throw new Error('The path resolves outside the selected workspace.');
    return real;
  }
  return target;
}

async function collectFiles(root: string, start: string) {
  const results: string[] = [], pending = [start];
  let visited = 0;
  const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'release', '.next', '.venv', 'venv', 'target', 'vendor']);
  while (pending.length && results.length < 1500 && visited < 10000) {
    const directory = pending.pop()!;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      visited++;
      if (visited >= 10000) break;
      if (entry.isDirectory()) { if (!ignored.has(entry.name)) pending.push(path.join(directory, entry.name)); }
      else if (entry.isFile()) results.push(path.relative(root, path.join(directory, entry.name)));
      if (results.length >= 1500) break;
    }
  }
  return results.sort((a, b) => a.localeCompare(b));
}

function runCommand(root: string, command: string, timeoutSeconds: number, onProgress?: (output: string) => void) {
  const executable = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command];
  return new Promise<ToolResult>((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PWD: root } });
    let output = '', timedOut = false, settled = false, lastUpdate = 0;
    const append = (chunk: Buffer) => {
      if (output.length < 100_000) output += chunk.toString('utf8').slice(0, 100_000 - output.length);
      if (Date.now() - lastUpdate > 150) { lastUpdate = Date.now(); onProgress?.(output); }
    };
    child.stdout?.on('data', append); child.stderr?.on('data', append);
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, Math.max(1, Math.min(300, timeoutSeconds)) * 1000);
    child.once('error', error => { if (settled) return; settled = true; clearTimeout(timer); reject(error); });
    child.once('close', code => { if (settled) return; settled = true; clearTimeout(timer); resolve({ output: `Exit code: ${code ?? 'unknown'}${timedOut ? ' (time limit reached)' : ''}\n${output}`, success: code === 0 && !timedOut }); });
  });
}

export async function runNativeWorkspaceTool(name: string, input: Record<string, unknown>, workspaceRoot: string, onProgress?: (output: string) => void, maxOutputCharacters = 6000): Promise<ToolResult> {
  const matchesGlob = (relative: string, pattern: string) => {
    let expression = '^';
    const normalized = pattern.replaceAll('\\', '/').replace(/^\.\//, '');
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized[i]!;
      if (char === '*' && normalized[i + 1] === '*') {
        i++;
        if (normalized[i + 1] === '/') { i++; expression += '(?:.*/)?'; }
        else expression += '.*';
      } else if (char === '*') expression += '[^/]*';
      else if (char === '?') expression += '[^/]';
      else expression += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    expression += '$';
    return new RegExp(expression, process.platform === 'win32' ? 'i' : '').test(relative.replaceAll('\\', '/'));
  };
  if (name === 'workspace_list') {
    const base = await resolveWorkspacePath(workspaceRoot, typeof input.path === 'string' && input.path ? input.path : '.', false);
    const stat = await fs.stat(base);
    if (!stat.isDirectory()) return { output: 'The requested path is not a directory.', success: false };
    const files = await collectFiles(workspaceRoot, base), offset = Math.min(files.length, Math.max(0, Math.floor(Number(input.offset) || 0))), limit = Math.max(1, Math.min(200, Math.floor(Number(input.limit) || 100)));
    const page = files.slice(offset, offset + limit);
    let included = 0, listing = '';
    for (const file of page) { if (listing.length + file.length + 1 > maxOutputCharacters) break; listing += `${listing ? '\n' : ''}${file}`; included++; }
    const nextOffset = offset + included;
    const continuation = nextOffset < files.length ? `\nShowing ${offset + 1}-${nextOffset} of ${files.length}. Continue with offset=${nextOffset}.` : `\nShowing ${offset + 1}-${nextOffset} of ${files.length}. End of listing.`;
    return { output: `${listing || 'No files found.'}${files.length ? continuation : ''}`, success: true };
  }
  if (name === 'workspace_glob') {
    const pattern = String(input.pattern ?? '').trim();
    if (!pattern || pattern.length > 300 || path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..')) return { output: 'Provide a safe workspace-relative glob pattern.', success: false };
    const files = await collectFiles(workspaceRoot, workspaceRoot), limit = Math.max(1, Math.min(300, Math.floor(Number(input.limit) || 100)));
    const matches = files.filter(file => matchesGlob(file, pattern)).slice(0, limit);
    return { output: matches.join('\n') || 'No files matched that glob.', success: true };
  }
  if (name === 'workspace_rules') {
    const anchor = await resolveWorkspacePath(workspaceRoot, typeof input.path === 'string' && input.path ? input.path : '.', false);
    const stat = await fs.stat(anchor), directory = stat.isDirectory() ? anchor : path.dirname(anchor);
    const relative = path.relative(workspaceRoot, directory), parts = relative ? relative.split(path.sep) : [];
    const candidates = [workspaceRoot];
    for (const part of parts) candidates.push(path.join(candidates.at(-1)!, part));
    const names = ['AGENTS.md', 'ORION.md', 'CLAUDE.md', '.github/copilot-instructions.md'];
    const excerpts: string[] = [];
    for (const dir of candidates) for (const name of names) {
      const file = path.join(dir, name);
      try { const real = await fs.realpath(file); if (!inside(workspaceRoot, real)) continue; const content = await fs.readFile(real, 'utf8'); if (content.trim()) excerpts.push(path.relative(workspaceRoot, real) + '\n' + content.slice(0, 8000)); }
      catch { /* Optional repository guidance file. */ }
    }
    const output = excerpts.join('\n\n') || 'No repository instruction files apply to this path.';
    return { output: output.slice(0, maxOutputCharacters), success: true };
  }
  if (name === 'workspace_search') {
    const query = String(input.query ?? '').trim().toLocaleLowerCase();
    if (!query) return { output: 'Provide text to search for.', success: false };
    const base = await resolveWorkspacePath(workspaceRoot, typeof input.path === 'string' && input.path ? input.path : '.', false);
    const stat = await fs.stat(base);
    const files = stat.isDirectory() ? await collectFiles(workspaceRoot, base) : [path.relative(workspaceRoot, base)];
    const matches: string[] = [];
    for (const relative of files) {
      if (matches.length >= 100) break;
      try {
        const absolute = await resolveWorkspacePath(workspaceRoot, relative, false), info = await fs.stat(absolute);
        if (info.size > 1_000_000) continue;
        const lines = (await fs.readFile(absolute, 'utf8')).split(/\r?\n/);
        lines.forEach((line, index) => { if (line.toLocaleLowerCase().includes(query) && matches.length < 100) matches.push(`${relative}:${index + 1}: ${line.slice(0, 500)}`); });
      } catch { /* Skip binary, unreadable, or concurrently changed files. */ }
    }
    const output = matches.join('\n') || 'No matching lines found.';
    return { output: output.length > maxOutputCharacters ? `${output.slice(0, maxOutputCharacters)}\n[Search output truncated. Refine the query or directory.]` : output, success: true };
  }
  if (name === 'workspace_grep') {
    const pattern = String(input.pattern ?? '');
    if (!pattern || pattern.length > 500) return { output: 'Provide a search pattern of 1 to 500 characters.', success: false };
    let matcher: RegExp;
    try { matcher = input.regex === true ? new RegExp(pattern, input.case_sensitive === true ? '' : 'i') : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), input.case_sensitive === true ? '' : 'i'); }
    catch (error) { return { output: `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`, success: false }; }
    const base = await resolveWorkspacePath(workspaceRoot, typeof input.path === 'string' && input.path ? input.path : '.', false);
    const stat = await fs.stat(base), files = stat.isDirectory() ? await collectFiles(workspaceRoot, base) : [path.relative(workspaceRoot, base)];
    const include = typeof input.include === 'string' && input.include ? input.include : '**/*';
    const matches: string[] = [], limit = Math.max(1, Math.min(200, Math.floor(Number(input.limit) || 100)));
    for (const relative of files) {
      if (matches.length >= limit || !matchesGlob(relative, include)) continue;
      try { const file = await resolveWorkspacePath(workspaceRoot, relative, false), info = await fs.stat(file); if (!info.isFile() || info.size > 1_000_000) continue; const lines = (await fs.readFile(file, 'utf8')).split(/\r?\n/); lines.forEach((line, index) => { if (matches.length < limit && matcher.test(line)) matches.push(`${relative}:${index + 1}: ${line.slice(0, 400)}`); }); }
      catch { /* Ignore binary, unreadable, or changed files. */ }
    }
    return { output: matches.join('\n') || 'No matching lines found.', success: true };
  }
  if (name === 'workspace_read') {
    const file = await resolveWorkspacePath(workspaceRoot, input.path, false), stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 2_000_000) return { output: 'The requested file must be a regular text file smaller than 2 MB.', success: false };
    const lines = (await fs.readFile(file, 'utf8')).split(/\r?\n/), offset = Math.min(lines.length, Math.max(0, Math.floor(Number(input.offset) || 0))), limit = Math.max(1, Math.min(200, Math.floor(Number(input.limit) || 40)));
    const page: string[] = []; let used = 72;
    for (let index = offset; index < Math.min(lines.length, offset + limit); index++) {
      const row = `${offset + index + 1}: ${lines[index]!.slice(0, 300)}`;
      if (page.length && used + row.length + 1 > maxOutputCharacters) break;
      page.push(row); used += row.length + 1;
      if (used >= maxOutputCharacters) break;
    }
    const nextOffset = offset + page.length;
    return { output: `File ${path.relative(workspaceRoot, file)} · lines ${offset + 1}-${nextOffset} of ${lines.length}\n${page.join('\n')}${nextOffset < lines.length ? `\nMore lines available. Continue with offset=${nextOffset}.` : '\nEnd of file.'}`, success: true };
  }
  if (name === 'workspace_write') {
    const file = await resolveWorkspacePath(workspaceRoot, input.path, true), content = String(input.content ?? '');
    if (Buffer.byteLength(content, 'utf8') > 2_000_000) return { output: 'File content exceeds the 2 MB limit.', success: false };
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.orion-tmp`;
    try { await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' }); await fs.rename(temporary, file); }
    catch (error) { await fs.rm(temporary, { force: true }).catch(() => undefined); throw error; }
    return { output: `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${path.relative(workspaceRoot, file)}.`, success: true };
  }
  if (name === 'workspace_edit') {
    const file = await resolveWorkspacePath(workspaceRoot, input.path, true), oldText = String(input.old_text ?? ''), newText = String(input.new_text ?? '');
    if (!oldText) return { output: 'old_text must not be empty.', success: false };
    const current = await fs.readFile(file, 'utf8'), first = current.indexOf(oldText);
    if (first < 0) return { output: 'The exact old_text passage was not found. Read the current file and retry with an exact passage.', success: false };
    if (current.indexOf(oldText, first + oldText.length) >= 0) return { output: 'The old_text passage occurs more than once. Include more surrounding context so the edit is unique.', success: false };
    const next = `${current.slice(0, first)}${newText}${current.slice(first + oldText.length)}`;
    await fs.writeFile(file, next, 'utf8');
    return { output: `Updated ${path.relative(workspaceRoot, file)}.`, success: true };
  }
  if (name === 'workspace_run') {
    const command = String(input.command ?? '').trim();
    if (!command || command.length > 4000) return { output: 'Provide a command between 1 and 4,000 characters.', success: false };
    return runCommand(workspaceRoot, command, Number(input.timeout_seconds ?? 120), onProgress);
  }
  return { output: `Unknown workspace tool: ${name}`, success: false };
}

export function workspaceToolNeedsApproval(name: string, level: 'all'|'external'|'none') {
  if (level === 'all') return true;
  if (level === 'none') return false;
  return name === 'workspace_run';
}
