import {ensureBrowser} from '@remotion/renderer';
import {cp, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
export const browserCacheRoot = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Caches', 'EduVid', 'Remotion')
  : process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'EduVid', 'Remotion')
    : path.join(os.homedir(), '.cache', 'eduvid', 'remotion');

export async function ensureCachedBrowser({logLevel = 'error'} = {}) {
  // Desktop/Documents are privacy-protected on macOS. Spawned Chromium
  // children can lose the launcher's audit attribution and fail to read their
  // own ICU resources there. Keep the entire official runtime in a cache.
  await mkdir(browserCacheRoot, {recursive: true});
  await writeFile(path.join(browserCacheRoot, 'package.json'), JSON.stringify({name: 'eduvid-browser-cache', private: true}));
  const destination = path.join(browserCacheRoot, 'node_modules', '.remotion', 'chrome-headless-shell');
  try { await readFile(path.join(destination, 'VERSION')); }
  catch {
    const source = path.join(packageRoot, 'node_modules', '.remotion', 'chrome-headless-shell');
    const temporary = path.join(browserCacheRoot, `.browser-migration-${process.pid}-${Date.now()}`);
    try {
      await readFile(path.join(source, 'VERSION'));
      await cp(source, temporary, {recursive: true, filter: file => !file.endsWith('download.lock') && !file.endsWith('.zip')});
      await mkdir(path.dirname(destination), {recursive: true});
      try { await rename(temporary, destination); }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { await rm(temporary, {recursive: true, force: true}); }
  }
  const previousDirectory = process.cwd();
  try {
    // The pinned renderer discovers its browser cache from the closest package
    // marker. Its public API then verifies the version or downloads it here.
    process.chdir(browserCacheRoot);
    const browser = await ensureBrowser({logLevel});
    if (!('path' in browser)) throw new Error('Official Remotion browser installation did not complete');
    return browser.path;
  } finally { process.chdir(previousDirectory); }
}
