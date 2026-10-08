import {ensureCachedBrowser} from './browser-cache.mjs';
const browserExecutable = await ensureCachedBrowser({logLevel: 'info'});
console.log(`Official Remotion browser ready: ${browserExecutable}`);
