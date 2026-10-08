# EduVid Remotion renderer

This package renders validated storyboard data through trusted React components.
Generated code, arbitrary components, external media and unknown plan fields are
rejected. The shared `src/Explainer.tsx` export also powers the web Player.

Install dependencies and the official Chrome Headless Shell:

```sh
npm --prefix remotion install
npm --prefix remotion run browser
```

Render a silent H.264 MP4 (the server adds the saved narration with ffmpeg):

```sh
node remotion/render.mjs --plan /absolute/plan.json --output /absolute/video.mp4
```

Validate a storyboard's layout and save three stills per scene:

```sh
node remotion/render.mjs --plan /absolute/plan.json --output /absolute/validation --validate
```

`--validate /absolute/validation` is also accepted. Progress is emitted as JSON
lines containing `progress` from 0 to 1. The final line contains `ok`, `path`
and `issues`; failure also includes `error` and, for runtime failures, `phase`.
Validation writes `report.json` with actual frame paths and layout issues.
Set `EDUVID_REMOTION_DEBUG=1` for Chromium diagnostics and error stacks.

The runner resolves bundles relative to this package and stores the official
browser in the user's system cache (`~/Library/Caches/EduVid/Remotion` on macOS).
This lets browser children read their ICU resources without requesting Desktop
or Documents privacy access. Caller directory does not change either cache.
SIGTERM and SIGINT cancel rendering and close
the owned Chromium process. The Python bridge supplies timeout/cancellation.

Plans use the shared `src/types.ts` contract. Frames must be contiguous; every
scene holds its content through its recorded narration slot. Eight fixed
templates cover hero illustrations, cards, ordered steps, comparisons,
timelines, ordered diagrams, story settings and takeaways. Vector icons are
schematics, so they do not imply machine-specific dimensions or controls.
Captions have a separate reserved band. Full text wraps and fits to a readable
minimum size; DOM overflow checks reject content that still does not fit.
Those checks verify layout, not the factual accuracy of a storyboard.

Run checks:

```sh
npm --prefix remotion run typecheck
npm --prefix remotion test
npm --prefix remotion run test:render
npm --prefix remotion run test:cancel
```

`test:render` covers all templates, styles and aspect ratios using long and
multilingual labels, actual stills and MP4 exports, plus an overcrowded-caption
failure. `test:cancel` records only the spawned runner's Chrome descendants and
verifies that those processes end after cancellation. Set
`EDUVID_REMOTION_QA_DIR` to choose an output directory for these tests.
