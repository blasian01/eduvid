import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makePlan} from './fixtures.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = process.env.EDUVID_REMOTION_QA_DIR ?? path.join(root, '.qa');
await mkdir(work, {recursive: true});
const planPath = path.join(work, 'cancel-plan.json'); await writeFile(planPath, JSON.stringify(makePlan({duration: 300})));
const child = spawn(process.execPath, [path.join(root, 'render.mjs'), '--plan', planPath, '--output', path.join(work, 'cancelled.mp4')], {cwd: root});
let text = ''; let resolveReady;
const ready = new Promise(resolve => resolveReady = resolve);
child.stdout.on('data', data => {text += data; if (text.includes('"phase":"browser"')) resolveReady();});
child.stderr.on('data', data => text += data);
const closed = new Promise(resolve => child.on('close', (code, signal) => resolve({code, signal})));
await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Browser did not open: ' + text)), 120000))]);
const processes = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], {encoding: 'utf8'}).split('\n').map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map(m => ({pid: Number(m[1]), parent: Number(m[2]), command: m[3]}));
const owned = new Set([child.pid]);
for (let i = 0; i < 6; i++) for (const process of processes) if (owned.has(process.parent)) owned.add(process.pid);
const chrome = processes.filter(process => owned.has(process.pid) && process.command.includes('chrome-headless-shell'));
assert.ok(chrome.length > 0, 'No render-owned Chrome PID was observed');
child.kill('SIGTERM');
const result = await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('Runner ignored SIGTERM')), 5000))]);
assert.equal(result.code, 130);
for (const process of chrome) {
  let exists = true;
  for (let i = 0; i < 40; i++) {try {globalThis.process.kill(process.pid, 0);} catch {exists = false; break;} await new Promise(resolve => setTimeout(resolve, 50));}
  assert.equal(exists, false, `Render Chrome PID ${process.pid} survived cancellation`);
}
console.log(JSON.stringify({ok: true, cancelledRunnerPid: child.pid, closedChromePids: chrome.map(p => p.pid)}));
process.exit(0);
