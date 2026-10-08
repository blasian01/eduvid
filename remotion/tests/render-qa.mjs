import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makePlan} from './fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.EDUVID_REMOTION_QA_DIR ?? path.join(root, '.qa');
await mkdir(out, {recursive: true});
function run(args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'render.mjs'), ...args], {cwd}); let text = '';
    child.stdout.on('data', data => text += data); child.stderr.on('data', data => text += data);
    child.on('error', reject); child.on('close', code => {const lines = text.trim().split('\n'); let result; for (const line of lines) {try {const value = JSON.parse(line); if ('ok' in value) result = value;} catch {}} resolve({code, result, text});});
  });
}
const reports = [];
for (const style of ['classic', 'neon', 'chalkboard', 'paper']) for (const portrait of [false, true]) {
  const name = `${style}-${portrait ? 'portrait' : 'landscape'}`;
  const planPath = path.join(out, `${name}.json`); await writeFile(planPath, JSON.stringify(makePlan({style, portrait, long: true})));
  const result = await run(['--plan', planPath, '--output', path.join(out, name), '--validate']);
  reports.push({name, ...result.result}); console.log(name, result.result?.ok, (result.result?.issues ?? []).length, 'issues');
}
await writeFile(path.join(out, 'summary.json'), JSON.stringify(reports, null, 2));
assert.ok(reports.every(report => report.ok), `Layout validation failed; inspect ${out}/summary.json`);
for (const portrait of [false, true]) {
  const plan = makePlan({portrait, duration: 15}); const name = portrait ? 'portrait' : 'landscape';
  const planPath = path.join(out, `video-${name}.json`); await writeFile(planPath, JSON.stringify(plan));
  // Call from a different directory to cover browser/bundle cache discovery.
  const result = await run(['--plan', planPath, '--output', path.join(out, `video-${name}.mp4`)], path.dirname(root));
  assert.equal(result.code, 0, result.text); assert.equal(result.result.ok, true, result.text);
  console.log(`Rendered ${name}`, result.result.path);
}
// Schema-valid text can still be visually impossible. The DOM guard must fail
// that plan rather than quietly clipping or reporting every render as success.
const crowded = makePlan({duration: 30});
crowded.scenes = [crowded.scenes[0]]; crowded.durationInFrames = 30;
crowded.captions = [{startFrame: 0, endFrame: 30, text: 'W'.repeat(200)}];
const crowdedPath = path.join(out, 'overflow-negative.json'); await writeFile(crowdedPath, JSON.stringify(crowded));
const negative = await run(['--plan', crowdedPath, '--output', path.join(out, 'overflow-negative'), '--validate']);
assert.equal(negative.code, 1, negative.text);
assert.equal(negative.result?.ok, false, negative.text);
assert.ok(negative.result.issues.some(issue => issue.includes('Caption text overflows')), negative.text);
console.log('Overcrowded caption rejected by actual DOM measurements');
