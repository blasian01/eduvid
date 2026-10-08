# EduVid Studio

Turn a topic, article, paper, or YouTube video into a short narrated animated explainer.

- **DeepSeek** writes and reviews the script, then plans trusted Remotion scenes or writes [ManimGL](https://github.com/3b1b/manim) animation code.
- **ElevenLabs** records the voiceover, with timing for every word.
- **Remotion** renders reusable React scenes for stories, summaries, and safety overviews, with an interactive browser preview.
- **3b1b/manim (ManimGL)** remains available for mathematical diagrams and derivations. Both renderers use the same narration, timing, captions, and downloads.

Your API keys are pasted into the web app. They're stored only in your browser and sent to the local server with each request.

```
input ─▶ script + source review ─▶ voice per beat ─▶ animation plan
                                                         │
       final.mp4 ◀─ ffmpeg mix ◀─ Remotion or Manim render ◀─ validation
```

## Requirements

- macOS or Linux (Manim rendering uses OpenGL)
- Python 3.11+
- Node.js 20.19+
- Chrome Headless Shell for Remotion rendering (installed by the setup script in the application cache)
- ffmpeg: `brew install ffmpeg`
- Optional: LaTeX, for real typeset equations (`brew install --cask mactex-no-gui`). Without it, equations are written with Unicode text (x², √2, π), which looks fine for most topics.

## Setup and run

```bash
npm run setup     # one time: Python venv with manimgl + server deps, web deps
npm run dev       # starts the API (port 8000) and the web app (port 5173)
```

Open http://localhost:5173, click **API keys**, and paste:

- a DeepSeek key from https://platform.deepseek.com/api_keys
- an ElevenLabs key from https://elevenlabs.io/app/settings/api-keys. It needs Text to Speech access, plus Voices: read to list your voices.

Choose **Topic**, **Article or paper**, or **YouTube**. Read and review a source before clicking **Generate video**. Generation usually takes a few minutes; render repairs can take longer. Flash animation generation starts in direct-code mode to avoid spending the response budget on reasoning instead of runnable code.

`npm start` builds the web app and serves everything from one server at http://localhost:8000.

## Features

- **Animation renderer:** turn **Enable Remotion** off to use Manim, or on to choose Auto or Always Remotion. Auto uses Remotion for general explainers and stories, and Manim for recognized mathematical topics or Math & science mode. The last enabled choice is remembered. Saved videos have their own switch; **Apply animation style** changes their renderer while reusing the recorded narration. The four standard visual themes work with either renderer; Illustrated Discovery requires Remotion.
- **Remotion scenes:** eight reusable scene layouts (hero, cards, steps, comparison, timeline, diagram, story, takeaway), vector icons, paced reveals, four standard themes plus Illustrated Discovery, and layouts for both aspect ratios. The AI supplies validated scene data; it does not supply executable React code. Scene timing and captions come from the recorded voice, with content held until the next beat.
- **Illustrated Discovery:** original layered vector worlds and specific illustrations of narrated actions and mechanisms. Short scenes can switch between exercise poses, tokens, embeddings, attention, generation loops, object compositions and limited visual metaphors. Exact narration cues are matched to the recorded word timings, so the picture changes when that idea is spoken. The artwork uses the app's own templates and assets; scene variety and artistic detail depend on those templates and the supplied explanation.
- **Interactive preview:** review a Remotion storyboard with narration in the browser before or after MP4 export. Edit its scene data and re-render. Switch an existing narrated video to Remotion without new voice requests; the initial conversion can use a script-derived storyboard without an AI request.
- **Article and paper inputs:** upload selectable-text PDF, DOCX, TXT, Markdown, or HTML; read a public article/PDF URL; or paste article text. Review the title, excerpt, text count and extraction warnings before generating. Documents are limited to 20 MB and 180,000 text characters (PDFs up to 300 pages). Scanned PDFs need OCR; diagrams are not extracted.
- **YouTube inputs:** paste a watch, Shorts, or youtu.be link. Captions are used first. When captions are unavailable, the app can download public audio and transcribe it with ElevenLabs Scribe using your current key. This fallback needs Speech to Text permission and consumes transcription credits. Private/restricted videos and provider blocks can require uploading a transcript instead. Recorded videos up to two hours are supported; on-screen-only details are not read.
- **Explanation styles:** Auto, Math & science, Storytelling, or Infotainment. Scripts use source evidence, preserve uncertainty and avoid inventing quotes or results. Math/science gets visual reasoning; stories use scenes and a takeaway; infotainment uses a factual hook. Each job saves a source snapshot so resume and animation changes keep the same evidence.
- **Source review before voice:** each new source script gets one additional AI review of narration and visuals against the supplied text, including qualifications and optional equipment. A failed review stops before narration is purchased. This helps catch unsupported claims but does not replace human review for accuracy or training use.
- **Storyboard faithfulness:** source-based and safety Remotion videos receive a bounded AI review against the approved narration before rendering. It checks negations, trigger conditions, causal direction and heading scope. If the plan or review cannot pass validation, the app uses a script-derived storyboard and displays a quality warning. Important claims still need human review, especially for safety training.
- **Options:** 16:9 (YouTube) or 9:16 (Shorts/Reels); 60/90/120-second targets for source explainers (topic mode also offers 30/45 seconds); five visual styles (3B1B classic, neon, chalkboard, light paper, Illustrated Discovery); 480p/720p/1080p.
- **Voice:** choose from your ElevenLabs voices with a preview button. Eleven v4 is the fresh-browser default; existing selections are retained. Set narration language and target audience for delivery style. Models that support a speed control expose it under Advanced; v4/v3 set pace themselves.
- **Synced timing:** each beat of narration has a slot. The scene calls `self.beat(i)`, which waits until the voiceover for beat `i` starts, so animations land on cue.
- **Captions:** burned into the video, with word-level timing from ElevenLabs. A `.srt` subtitle file is always produced too.
- **Self-healing renders:**
  - Every generated scene is first test-run in about 1 second, with frame drawing skipped.
  - If it crashes, the traceback is sent back to DeepSeek to fix (up to 5 attempts).
  - Text that runs off-screen or overlaps other text, and beats that run long, are detected and sent back for one layout-fix pass.
  - Text wider than the frame is shrunk automatically.
- **Edit and re-render:** change the ManimGL code in the browser and re-render, keeping the same voiceover. **New animation** asks DeepSeek for a fresh take on the same script.
- **Resume after a failure:** failed or cancelled jobs offer **Resume generation**. Valid recorded voice clips and the saved script are reused, so a quota or connection failure does not require purchasing the same narration again.
- **Quality review:** checks cover text overlap, frame bounds, caption space, and beat timing. Any remaining warnings appear beside the finished video. Review the actual explanation and playback before publishing.
- **Length checks:** scripts that exceed the spoken word budget receive up to three bounded revisions before recording. Later revisions aim below the limit to allow for revision drift. If the last draft is still long, review its word count and estimated duration and choose **Continue anyway** to record it; the finished video may exceed the selected length. Actual duration still varies with the voice, language, and speaking speed. Resuming an older job preserves its already recorded script.
- **Library:** every video is kept in `server/jobs/<id>/`, with `final.mp4`, `scene.py`, `captions.srt` and the per-beat audio.

Choose **Visual style → Illustrated Discovery** for a new video; selecting it enables Remotion. For an existing narrated video, choose it in that video's **Visual style** selector, then click **Apply animation style**. The saved script, narration, voice and format are reused. **New animation** asks DeepSeek to make a fresh plan using the staged renderer and visual style.

Turning **Enable Remotion** off restores the remembered standard theme, with classic as the default. Matching saved Manim code with a known theme can be reused without an API key. A changed or unknown Manim theme needs a new animation and a DeepSeek key; the existing narration is still reused.

Open any job in ManimGL's live preview window (scroll, zoom, inspect):

```bash
scripts/preview.sh <job-id>
```

## Costs (rough)

- **DeepSeek:** a few cents or less per video with `deepseek-flash`. `deepseek-v4-pro` writes better animation code but costs more.
- **ElevenLabs:** a 60-second script is about 900 characters, which is roughly 900 credits on Multilingual v2 and about half that on Flash v2.5.

Check both providers' current pricing.

Remotion renders locally. Its free license covers eligible individuals and teams of up to three people, including commercial automation. Larger commercial teams need a Company License; the automation option is currently $0.01 per render with a $100/month minimum. Check [Remotion's current pricing and eligibility](https://www.remotion.pro/license) before using the app commercially. AI and voice-provider costs are separate.

## Licensing

- **3b1b/manim:** MIT licensed, so free for commercial use. Keep its license notice if you redistribute the Manim code itself.
- **ElevenLabs:** audio from the **free plan can't be used commercially**, and published free-plan audio must credit ElevenLabs. Use a paid plan for commercial videos.
- **DeepSeek:** see the current DeepSeek Open Platform Terms.

## How it fits together

```
server/app/
  main.py                    FastAPI routes (/api/*, /files/* for videos)
  sources.py                 document/article extraction and YouTube captions/audio transcription
  pipeline.py                job steps: script → voice → code → test/fix → render → mix
  prompts.py                 prompts and a ManimGL API reference checked against manimgl 1.7.2
  deepseek.py, elevenlabs.py API clients (streaming, retries, readable errors)
  render.py                  runs manimgl, screens generated code, test runs
  remotion.py                validates storyboards, builds frame timing, invokes local Remotion rendering
  media.py                   ffprobe/ffmpeg: narration track, captions, .srt, final mux
  manim_runtime/edu_prelude.py  EduScene base class: beat sync, captions, layout checks
web/src/                     React app (Vite)
remotion/                    shared React scenes, composition, local renderer, and template QA
scripts/                     setup, dev launcher, preview helper
```

**Security note:** the animation code is written by an AI and runs as Python on your computer. Before running, the server rejects code that imports or uses `os`, `subprocess`, `socket`, `open`, `eval` and similar. This is a guard rail, not a sandbox, so only run this app on your own machine.

## Troubleshooting

- **"Can't reach the EduVid server":** make sure `npm run dev` is running, and run `npm run setup` if `server/.venv` is missing.
- **DeepSeek 401/402:** the key is wrong, or the account has no balance.
- **DeepSeek token limit:** animation generation uses a bounded direct-code fallback when a thinking response is truncated. **Resume generation** keeps the completed narration.
- **ElevenLabs 401:** the key lacks Text to Speech permission. Voice loading also needs Voices: read.
- **ElevenLabs quota limit:** add credits or use a key with available quota, then choose **Resume generation**. Some quota failures use HTTP 401 even when the key is valid.
- **Code still fails after 5 auto-fixes:** click **New animation**, switch to `deepseek-v4-pro` under Advanced, or simplify the prompt. The log tab shows every traceback.
- **Equations look plain:** install LaTeX (see Requirements) and restart. The top bar shows "LaTeX on" when it's detected.
- **Article site blocks access:** download a copy, or paste its readable text in Article or paper. Browser challenge pages are rejected instead of being turned into videos.
- **YouTube transcription fails:** check Speech to Text access on the ElevenLabs key; otherwise upload a transcript. The app cannot extract a private/restricted video or guarantee access when YouTube blocks downloads.
- **Remotion unavailable:** the official browser runtime lives in `~/Library/Caches/EduVid/Remotion` on macOS (or the platform cache directory elsewhere), keeping it outside Desktop privacy restrictions. Run `npm run setup` to install its dependencies and Chrome Headless Shell, then restart the app. Manim remains available. An interactive preview is a storyboard preview; the downloaded MP4 is the finished artifact.

## QA checks

The focused regression suite runs without calling either paid provider:

```bash
npm --prefix remotion run typecheck
npm --prefix remotion test
npm --prefix remotion run test:render
npm --prefix remotion run test:illustrated
npm --prefix remotion run test:content
node remotion/tests/cancel-qa.mjs
npm --prefix web run typecheck
npm --prefix web run test:qa
npm run build
cd server
EDUVID_RENDER_QA=1 .venv/bin/python -m unittest discover -s tests -p 'test_*_qa.py' -v
```

Remotion tests render all eight templates in both aspect ratios and four standard themes, check long and multilingual text, reject overflowing captions, and verify render cancellation cleans up Chrome. `test:illustrated` exercises the Illustrated Discovery layouts and teaching scenes; `test:content` checks the specific exercise and concept pictures, their boundaries, and both aspect ratios. Normal storyboard validation samples every specific picture as well as each scene's start, middle and end. The Manim render tests exercise OpenGL, ffmpeg, caption visibility, paper-style text colors, timing, and process cleanup. Run them on the machine used for rendering. Backend tests cover input validation, source extraction, source snapshots, interrupted provider responses, cancellation, quota failures, and reuse of recorded audio. Frontend checks cover duplicate/stale extraction requests, article/YouTube creation, library state, downloads, renderer/theme controls, and resume controls.

For a repeatable transformer lesson with local narration on macOS:

```bash
# From server/; uses the installed Samantha voice and makes no provider requests.
.venv/bin/python tests/smoke_transformer.py --aspect 16:9 --quality 720p
.venv/bin/python tests/smoke_transformer.py --aspect 9:16 --quality 720p
```

These fixtures test the local pipeline; live DeepSeek and ElevenLabs generation must be checked separately with configured keys and available credits.
