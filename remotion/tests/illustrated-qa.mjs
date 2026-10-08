import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makePlan} from './fixtures.mjs';
import {illustrationSubjects, illustrationMotions, templates} from '../validate-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.EDUVID_REMOTION_QA_DIR ?? path.join(root, '.qa', 'illustrated');
await mkdir(out, {recursive: true});
const run = args => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'render.mjs'), ...args], {cwd: root}); let log = '';
  child.stdout.on('data', data => log += data); child.stderr.on('data', data => log += data);
  child.on('error', reject); child.on('close', code => {
    let result;
    for (const line of log.split('\n')) {try {const value = JSON.parse(line); if ('ok' in value) result = value;} catch {}}
    resolve({code, result, log});
  });
});
const reports = [];
for (const portrait of [false, true]) {
  const plan = makePlan({portrait, style: 'illustrated', duration: 90, long: true});
  plan.title = 'Illustrated discovery: worlds that explain';
  plan.scenes = illustrationSubjects.map((subject, i) => ({...plan.scenes[i % templates.length], template: templates[i % templates.length], startFrame: i * 90, durationInFrames: 90,
    illustration: {subject, motion: illustrationMotions[i % illustrationMotions.length], mode: ['attention', 'network', 'machine'].includes(subject) ? 'schematic' : 'metaphor', labels: ['An approved concept', 'A visible relationship', 'A longer but bounded concept', 'Keep the context']}}));
  plan.durationInFrames = 90 * plan.scenes.length;
  plan.captions = plan.scenes.map(scene => ({startFrame: scene.startFrame, endFrame: scene.startFrame + 90, text: 'The illustration helps explain the idea; it is not a literal model.'}));
  const name = portrait ? 'portrait' : 'landscape';
  const file = path.join(out, `${name}.json`); await writeFile(file, JSON.stringify(plan));
  const result = await run(['--plan', file, '--output', path.join(out, name), '--validate']);
  reports.push({name, ...result.result});
  console.log(name, result.code, result.result?.ok, result.result?.issues);
  assert.equal(result.code, 0, result.log);
  assert.equal(result.result?.ok, true, result.log);
  // Every frame is checked during the short MP4, covering points between still samples.
  const short = {...plan, durationInFrames: plan.scenes.length * 30, scenes: plan.scenes.map((scene, i) => ({...scene, startFrame: i * 30, durationInFrames: 30})), captions: plan.scenes.map((_, i) => ({startFrame: i * 30, endFrame: (i + 1) * 30, text: 'Illustrated discovery in motion.'}))};
  const shortFile = path.join(out, `${name}-motion.json`); await writeFile(shortFile, JSON.stringify(short));
  const movie = await run(['--plan', shortFile, '--output', path.join(out, `${name}-motion.mp4`)]);
  console.log('Motion video', name, movie.code, movie.result?.issues);
  assert.equal(movie.code, 0, movie.log);
  assert.equal(movie.result?.ok, true, movie.log);
}
await writeFile(path.join(out, 'summary.json'), JSON.stringify(reports, null, 2));
console.log(`All ${illustrationSubjects.length} illustrated worlds, ${illustrationMotions.length} motion types and both aspects passed.`);
