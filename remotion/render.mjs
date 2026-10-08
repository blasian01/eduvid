import {bundle} from '@remotion/bundler';
import {makeCancelSignal, openBrowser, renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePlan} from './validate-plan.mjs';
import {ensureCachedBrowser} from './browser-cache.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
// Remotion locates its downloaded browser relative to the caller's CWD.
// CLI and Python invocations must share the same trusted cache.
process.chdir(root);
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
let browserPromise;
let phase = 'input';
const {cancel, cancelSignal} = makeCancelSignal();
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
  if (stopping) return;
  stopping = true; cancel();
  const deadline = setTimeout(() => process.exit(130), 4000);
  try { const current = browser ?? (browserPromise ? await browserPromise : undefined); await current?.close({silent: true}); }
  finally { clearTimeout(deadline); process.exit(130); }
});

async function sourceHash() {
  const hash = createHash('sha256');
  for (const name of (await readdir(path.join(root, 'src'))).sort()) {
    const file = path.join(root, 'src', name);
    if ((await stat(file)).isFile()) hash.update(name).update(await readFile(file));
  }
  hash.update(await readFile(path.join(root, 'package-lock.json')));
  return hash.digest('hex').slice(0, 20);
}

async function trustedBundle() {
  const cache = path.join(root, '.cache'); await mkdir(cache, {recursive: true});
  const hash = await sourceHash();
  const directory = path.join(cache, `bundle-${hash}`);
  try { await stat(path.join(directory, 'index.html')); return directory; } catch {}
  const lock = path.join(cache, `lock-${hash}`);
  for (let attempts = 0; ; attempts++) {
    try { await mkdir(lock); break; } catch (error) {
      if (error.code !== 'EEXIST' || attempts > 2400) throw error;
      try { await stat(path.join(directory, 'index.html')); return directory; } catch {}
      // A cancelled worker must not leave a permanent build lock.
      if (Date.now() - (await stat(lock)).mtimeMs > 120000) { await rm(lock, {recursive: true, force: true}); continue; }
      await sleep(100);
    }
  }
  const temporary = directory + `-${process.pid}`;
  try {
    await bundle({entryPoint: path.join(root, 'src/index.ts'), rootDir: root, outDir: temporary, onProgress: value => {if (value % 20 === 0) emit({phase: 'bundle', progress: value / 100 * 0.08});}});
    await rename(temporary, directory);
    return directory;
  } finally { await rm(lock, {recursive: true, force: true}); await rm(temporary, {recursive: true, force: true}); }
}

async function main() {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (!['--plan', '--output', '--validate'].includes(args[i])) throw new Error(`Unknown option ${args[i]}`);
    if (args[i] === '--validate') options.validate = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
    else { const key = args[i].slice(2); if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for --${key}`); options[key] = args[++i]; }
  }
  if (!options.plan || (!options.output && typeof options.validate !== 'string')) throw new Error('Usage: node remotion/render.mjs --plan PATH --output PATH [--validate]');
  const plan = JSON.parse(await readFile(path.resolve(options.plan), 'utf8'));
  const issues = validatePlan(plan);
  if (issues.length) { emit({ok: false, error: 'Invalid storyboard', issues}); process.exitCode = 1; return; }
  const output = path.resolve(typeof options.validate === 'string' ? options.validate : options.output);
  await mkdir(options.validate ? output : path.dirname(output), {recursive: true});
  phase = 'bundle';
  const serveUrl = await trustedBundle();
  phase = 'browser-download';
  // Keep download separate from launch: cancelling a stalled download exits
  // immediately, while an opened browser is always closed before exit.
  const browserExecutable = await ensureCachedBrowser();
  phase = 'browser';
  browserPromise = openBrowser('chrome', {browserExecutable, logLevel: process.env.EDUVID_REMOTION_DEBUG === '1' ? 'verbose' : 'error'});
  browser = await browserPromise;
  if (stopping) return;
  emit({phase: 'browser', progress: 0.08});
  const inputProps = {plan};
  phase = 'composition';
  const composition = await selectComposition({serveUrl, id: 'EduVidExplainer', inputProps, puppeteerInstance: browser, logLevel: 'error'});
  const found = new Set();
  const onBrowserLog = log => {
    const marker = log.text.indexOf('EDUVID_QA ');
    if (marker >= 0) {
      try { for (const issue of JSON.parse(log.text.slice(marker + 10)).issues ?? []) found.add(issue); } catch {}
    }
  };
  if (options.validate) {
    phase = 'validate';
    const frames = [];
    const samples = plan.scenes.map(scene => {
      const result = [['start', Math.min(scene.durationInFrames - 1, Math.round(plan.fps))], ['mid', Math.floor(scene.durationInFrames / 2)], ['end', scene.durationInFrames - 1]];
      for (const [i, shot] of (scene.illustration?.shots ?? []).entries()) {
        result.push([`shot-${i + 1}-start`, shot.startFrame], [`shot-${i + 1}-mid`, shot.startFrame + Math.floor(shot.durationInFrames / 2)], [`shot-${i + 1}-end`, shot.startFrame + shot.durationInFrames - 1]);
      }
      const seen = new Set();
      return result.filter(([, frame]) => {if (seen.has(frame)) return false; seen.add(frame); return true;});
    });
    const sampleCount = samples.reduce((total, scene) => total + scene.length, 0);
    for (const [i, scene] of plan.scenes.entries()) {
      for (const [position, relative] of samples[i]) {
        const frame = scene.startFrame + relative;
        const file = path.join(output, `scene-${String(i + 1).padStart(2, '0')}-${position}.png`);
        await renderStill({composition, serveUrl, inputProps, frame, output: file, imageFormat: 'png', puppeteerInstance: browser, logLevel: 'error', onBrowserLog});
        await sleep(25);
        frames.push({scene: i, position, frame, path: file});
        emit({phase: 'validate', progress: 0.08 + frames.length / sampleCount * 0.92});
      }
    }
    const report = {ok: found.size === 0, issues: [...found], frames, width: plan.width, height: plan.height, durationInFrames: plan.durationInFrames};
    const reportPath = path.join(output, 'report.json'); await writeFile(reportPath, JSON.stringify(report, null, 2));
    emit({ok: report.ok, path: reportPath, issues: report.issues, ...(report.ok ? {} : {error: 'Storyboard text exceeds the safe layout'})});
    if (!report.ok) process.exitCode = 1;
  } else {
    phase = 'render';
    let lastProgress = -1;
    await renderMedia({composition, serveUrl, inputProps, outputLocation: output, codec: 'h264', muted: true, pixelFormat: 'yuv420p', crf: 18, x264Preset: 'fast', concurrency: 2, puppeteerInstance: browser, logLevel: 'error', cancelSignal, onBrowserLog, onProgress: ({progress}) => {
      const value = Math.floor((0.08 + progress * 0.92) * 100);
      if (value > lastProgress) { lastProgress = value; emit({progress: value / 100}); }
    }});
    emit({ok: found.size === 0, path: output, issues: [...found], ...(found.size ? {error: 'Storyboard text exceeds the safe layout'} : {})});
    if (found.size) process.exitCode = 1;
  }
}

try { await main(); } catch (error) {
  if (process.env.EDUVID_REMOTION_DEBUG === '1') process.stderr.write((error.stack || String(error)) + '\n');
  emit({ok: false, error: error.message || String(error), phase, issues: []}); process.exitCode = 1;
}
finally { try { await browser?.close({silent: true}); } catch {} }
