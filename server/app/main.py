"""EduVid API server. Run with: uvicorn app.main:app --port 8000 (from the server/ folder)."""
from __future__ import annotations

import shutil
from importlib.metadata import version
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, StrictBool

from . import deepseek, elevenlabs, prompts, remotion, render, sources
from .pipeline import DEFAULT_SETTINGS, JOBS_DIR, JobManager, public_job

app = FastAPI(title="EduVid")
app.include_router(sources.router)
manager = JobManager()

WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"


class Keys(BaseModel):
    deepseek_key: str | None = None
    elevenlabs_key: str | None = None


class CreateJob(Keys):
    prompt: str | None = Field(default=None, max_length=4000)
    source_id: str | None = Field(default=None, min_length=1, max_length=128)
    settings: dict = Field(default_factory=dict)


class Rerender(Keys):
    code: str | None = None
    regenerate: bool = False
    settings: dict | None = None


class Resume(Keys):
    settings: dict | None = None
    allow_long_script: StrictBool = False


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "manimgl": version("manimgl"),
        "remotion": remotion.availability(),
        "ffmpeg": bool(shutil.which("ffmpeg") and shutil.which("ffprobe")),
        "latex": render.latex_available(),
        "font": render.pick_font(),
        "styles": {k: {"label": v["label"], "background": v["background"]} for k, v in prompts.STYLES.items()},
        "defaults": DEFAULT_SETTINGS,
    }


@app.post("/api/voices")
async def voices(body: Keys):
    if not (body.elevenlabs_key and body.elevenlabs_key.strip()):
        raise HTTPException(400, "Add your ElevenLabs API key first.")
    try:
        return {"voices": await elevenlabs.list_voices(body.elevenlabs_key.strip())}
    except elevenlabs.ElevenLabsError as e:
        raise HTTPException(400, str(e))


@app.post("/api/check-deepseek")
async def check_deepseek(body: Keys):
    if not (body.deepseek_key and body.deepseek_key.strip()):
        raise HTTPException(400, "Add your DeepSeek API key first.")
    try:
        return {"models": await deepseek.check_key(body.deepseek_key.strip())}
    except deepseek.DeepSeekError as e:
        raise HTTPException(400, str(e))


@app.get("/api/jobs")
def list_jobs():
    return {"jobs": manager.list()}


@app.post("/api/jobs")
async def create_job(body: CreateJob):
    if not (body.deepseek_key and body.deepseek_key.strip()):
        raise HTTPException(400, "Missing DeepSeek API key — add it under API keys (top right).")
    if not (body.elevenlabs_key and body.elevenlabs_key.strip()):
        raise HTTPException(400, "Missing ElevenLabs API key — add it under API keys (top right).")
    # Keys stay in memory for this job only; they are never written to disk.
    keys = {"deepseek": body.deepseek_key.strip(), "elevenlabs": body.elevenlabs_key.strip()}
    source = None
    if body.source_id is not None:
        try:
            source = sources.get_source(body.source_id.strip())
        except sources.SourceError as e:
            raise HTTPException(e.status_code, str(e)) from e
    try:
        job = manager.create((body.prompt or "").strip(), body.settings, keys, source=source)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    except RuntimeError as e:
        raise HTTPException(409, str(e)) from e
    return public_job(job)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    return public_job(_job(job_id))


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    manager.cancel(_job(job_id))
    return {"ok": True}


@app.post("/api/jobs/{job_id}/rerender")
async def rerender_job(job_id: str, body: Rerender):
    job = _job(job_id)
    keys = {"deepseek": (body.deepseek_key or "").strip() or None}
    try:
        manager.rerender(job, keys, body.code, body.regenerate, body.settings)
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    return public_job(job)


@app.post("/api/jobs/{job_id}/resume")
async def resume_job(job_id: str, body: Resume):
    job = _job(job_id)
    keys = {
        "deepseek": (body.deepseek_key or "").strip() or None,
        "elevenlabs": (body.elevenlabs_key or "").strip() or None,
    }
    try:
        manager.resume(job, keys, body.settings, allow_long_script=body.allow_long_script)
    except RuntimeError as e:
        raise HTTPException(409, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return public_job(job)


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str):
    manager.delete(_job(job_id))
    return {"ok": True}


def _job(job_id: str):
    job = manager.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


# Rendered videos, thumbnails, captions and code
app.mount("/files", StaticFiles(directory=JOBS_DIR), name="files")

# Serve the built React app in production (`npm run build` in web/)
if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        # Unknown API paths must stay JSON 404s, not the app's HTML with a 200.
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not found")
        target = WEB_DIST / path
        if path and target.is_file() and WEB_DIST in target.resolve().parents:
            return FileResponse(target)
        return FileResponse(WEB_DIST / "index.html")
