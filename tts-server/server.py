"""Local F5-TTS speech service for the VOTC voice-mode fork.

A thin FastAPI server around the machine's existing F5-TTS installation.
It knows nothing about VOTC: it receives text plus a voice_id, looks the
voice up in the local voice library, and returns WAV audio.

Run with the same Python environment that has f5-tts installed:

    python server.py                # default port 8765, default library
    python server.py --port 9000 --voices-dir "D:\\my\\voices"

Endpoints:
    GET  /health      -> service and model status
    GET  /voices      -> voice IDs and tags the library currently holds
    POST /reload      -> re-read the voice library folder from disk
    POST /synthesize  -> {"text": ..., "voice_id": ...} -> audio/wav bytes
"""

import argparse
import io
import json
import logging
import os
import re
import socket
import sys
import tempfile
import time
from pathlib import Path

import soundfile as sf
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from curator import Curator, CuratorError

DEFAULT_PORT = 8765
MAX_PORT_ATTEMPTS = 20
DEFAULT_VOICES_DIR = Path(os.environ.get("APPDATA", "")) / "VOTC-Voice" / "votc_data" / "voices"

# Fixed inference seed: the same character voicing the same words should
# sound identical across runs. Any constant works; this one is arbitrary.
INFERENCE_SEED = 42

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("tts-server")


# --------------------------------------------------------------------------
# Text preprocessing — deterministic cleanup before synthesis.
# The app is responsible for emote stripping; this layer only removes
# things that read badly aloud regardless of settings (markdown, URLs).
# --------------------------------------------------------------------------

_RE_CODE_BLOCK = re.compile(r"```.*?```", re.DOTALL)
_RE_INLINE_CODE = re.compile(r"`([^`]*)`")
_RE_MD_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_RE_URL = re.compile(r"(?:https?://|www\.)\S+")
_RE_MD_MARKS = re.compile(r"[*_#>~]+")
_RE_WHITESPACE = re.compile(r"\s+")


def preprocess_text(text: str) -> str:
    original_len = len(text)
    text = _RE_CODE_BLOCK.sub(" ", text)
    text = _RE_INLINE_CODE.sub(r"\1", text)
    text = _RE_MD_LINK.sub(r"\1", text)
    text = _RE_URL.sub(" ", text)
    text = _RE_MD_MARKS.sub(" ", text)
    text = _RE_WHITESPACE.sub(" ", text).strip()
    log.info("preprocess: %d chars in -> %d chars out", original_len, len(text))
    return text


# --------------------------------------------------------------------------
# Voice library — a folder of {voice_id}.wav + {voice_id}.txt + catalog.json
# --------------------------------------------------------------------------

class VoiceLibrary:
    def __init__(self, voices_dir: Path):
        self.voices_dir = voices_dir
        self.entries: dict[str, dict] = {}

    def reload(self) -> None:
        # Build into a local dict and swap in ONE assignment at the end:
        # /synthesize runs on other threads and must never observe a
        # half-filled library while the Curator is writing.
        entries: dict[str, dict] = {}
        catalog_path = self.voices_dir / "catalog.json"
        if not catalog_path.is_file():
            log.warning("voice library: no catalog at %s — library is empty", catalog_path)
            self.entries = entries
            return
        try:
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            log.error("voice library: cannot read catalog.json (%s) — library is empty", e)
            self.entries = entries
            return
        for entry in catalog.get("voices", []):
            voice_id = entry.get("voice_id")
            if not voice_id:
                log.warning("voice library: skipping catalog entry without voice_id")
                continue
            wav = self.voices_dir / f"{voice_id}.wav"
            txt = self.voices_dir / f"{voice_id}.txt"
            if not wav.is_file() or not txt.is_file():
                log.warning("voice library: skipping '%s' — missing %s", voice_id,
                            wav.name if not wav.is_file() else txt.name)
                continue
            ref_text = txt.read_text(encoding="utf-8").strip()
            if not ref_text:
                log.warning("voice library: skipping '%s' — transcript file is empty", voice_id)
                continue
            entries[voice_id] = {"meta": entry, "wav_path": wav, "ref_text": ref_text}
        self.entries = entries
        log.info("voice library: %d voice(s) loaded from %s", len(self.entries), self.voices_dir)


# --------------------------------------------------------------------------
# TTS engine — loads the F5-TTS model once, caches per-voice references
# --------------------------------------------------------------------------

# F5-TTS's own preprocessing trims the reference and re-adds only 50 ms of
# trailing silence. For some voices that is too abrupt: the model never sees
# a real pause, and fills sentence gaps in generated speech by repeating the
# tail of the reference line. Padding the reference with genuine silence
# AFTER F5's preprocessing (which would otherwise strip it again) fixes it.
TRAILING_REF_SILENCE_S = 0.35


class Engine:
    def __init__(self, library: VoiceLibrary):
        self.library = library
        self._ref_cache: dict[str, tuple[str, str]] = {}
        self._cache_gen = 0  # bumped on clear so in-flight preprocessing can't re-insert stale refs
        self._ref_dir = Path(tempfile.mkdtemp(prefix="votc_refs_"))
        log.info("loading F5-TTS model (first load takes a few seconds)...")
        t0 = time.perf_counter()
        from f5_tts.api import F5TTS  # imported late so --help stays fast
        self.f5 = F5TTS()
        log.info("model loaded on '%s' in %.1fs", self.f5.device, time.perf_counter() - t0)

    def clear_cache(self) -> None:
        self._cache_gen += 1
        self._ref_cache = {}

    def _reference_for(self, voice_id: str) -> tuple[str, str]:
        """Return (padded processed ref wav, processed ref text), cached per voice."""
        cached = self._ref_cache.get(voice_id)
        if cached is not None:
            return cached
        gen = self._cache_gen
        import numpy as np
        from f5_tts.infer.utils_infer import preprocess_ref_audio_text
        entry = self.library.entries[voice_id]
        ref_file, ref_text = preprocess_ref_audio_text(
            str(entry["wav_path"]), entry["ref_text"], show_info=log.debug
        )
        data, sr = sf.read(ref_file)
        padded = np.concatenate([data, np.zeros(int(sr * TRAILING_REF_SILENCE_S), dtype=data.dtype)])
        padded_path = self._ref_dir / f"{voice_id}_{gen}.wav"
        sf.write(padded_path, padded, sr)
        value = (str(padded_path), ref_text)
        if gen == self._cache_gen:  # don't re-insert a ref that was invalidated mid-flight
            self._ref_cache[voice_id] = value
        return value

    def synthesize(self, text: str, voice_id: str) -> bytes:
        ref_file, ref_text = self._reference_for(voice_id)
        t0 = time.perf_counter()
        # Call the inference step directly: F5TTS.infer() would re-run its
        # preprocessing on our padded reference and strip the padding again.
        from f5_tts.infer.utils_infer import infer_process
        from f5_tts.model.utils import seed_everything
        seed_everything(INFERENCE_SEED)
        wav, sr, _ = infer_process(
            ref_file,
            ref_text,
            text,
            self.f5.ema_model,
            self.f5.vocoder,
            self.f5.mel_spec_type,
            show_info=log.debug,
            progress=None,
            device=self.f5.device,
        )
        elapsed = time.perf_counter() - t0
        duration = len(wav) / sr
        log.info("synthesized %.1fs of audio in %.2fs (%.1fx realtime) voice=%s",
                 duration, elapsed, duration / elapsed if elapsed > 0 else 0, voice_id)
        buf = io.BytesIO()
        sf.write(buf, wav, sr, format="WAV")
        return buf.getvalue()


# --------------------------------------------------------------------------
# HTTP API
# --------------------------------------------------------------------------

class SynthesizeRequest(BaseModel):
    text: str
    voice_id: str


class AnalyzeRequest(BaseModel):
    source_path: str


class VoiceCard(BaseModel):
    voice_id: str
    display_name: str = ""
    gender: str = "unknown"
    age_band: str = "adult"
    personality_tags: list[str] = []
    accent_tag: str = "neutral"
    mod_tags: list[str] = []
    source_note: str = ""


class SaveRequest(VoiceCard):
    temp_id: str
    transcript: str


class UpdateRequest(VoiceCard):
    transcript: str | None = None


class RenameRequest(BaseModel):
    old_id: str
    new_id: str


class VoiceIdRequest(BaseModel):
    voice_id: str


def build_app(library: VoiceLibrary, engine: Engine) -> FastAPI:
    app = FastAPI(title="VOTC voice-mode TTS service")
    started = time.time()
    curator = Curator(library, engine)
    curator.cleanup_stale_temps()

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "device": engine.f5.device,
            "sample_rate": engine.f5.target_sample_rate,
            "voices": len(library.entries),
            "voices_dir": str(library.voices_dir),
            "user": os.environ.get("USERNAME", "?"),
            "uptime_s": round(time.time() - started, 1),
        }

    @app.get("/voices")
    def voices():
        # The card plus the transcript, which the Curator UI edits.
        return {"voices": [{**e["meta"], "transcript": e["ref_text"]} for e in library.entries.values()]}

    # ---- Library Curator endpoints (used by the in-app Curator UI) ----

    @app.post("/curator/analyze")
    def curator_analyze(req: AnalyzeRequest):
        return curator.analyze(req.source_path)

    @app.post("/curator/save")
    def curator_save(req: SaveRequest):
        return curator.save_new(req.temp_id, req.transcript, req.model_dump())

    @app.post("/curator/update")
    def curator_update(req: UpdateRequest):
        return curator.update(req.voice_id, req.transcript, req.model_dump())

    @app.post("/curator/rename")
    def curator_rename(req: RenameRequest):
        return curator.rename(req.old_id, req.new_id)

    @app.post("/curator/delete")
    def curator_delete(req: VoiceIdRequest):
        curator.delete(req.voice_id)
        return {"success": True}

    @app.post("/curator/retranscribe")
    def curator_retranscribe(req: VoiceIdRequest):
        return {"transcript": curator.retranscribe(req.voice_id)}

    @app.get("/curator/audio/{kind}/{ident}")
    def curator_audio(kind: str, ident: str):
        return FileResponse(curator.audio_path(kind, ident), media_type="audio/wav")

    @app.exception_handler(CuratorError)
    def curator_error_handler(_, exc: CuratorError):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @app.post("/reload")
    def reload_library():
        with curator.catalog_lock:
            library.reload()
            engine.clear_cache()
        return {"voices": len(library.entries)}

    @app.post("/synthesize")
    def synthesize(req: SynthesizeRequest):
        if req.voice_id not in library.entries:
            raise HTTPException(status_code=404, detail=f"unknown voice_id '{req.voice_id}'")
        text = preprocess_text(req.text)
        if not text:
            # Nothing speakable (e.g. reply was all markdown/URLs). Not an error.
            return Response(status_code=204)
        try:
            audio = engine.synthesize(text, req.voice_id)
        except Exception as e:  # noqa: BLE001 — surface any inference failure as a clean 500
            log.exception("synthesis failed")
            raise HTTPException(status_code=500, detail=f"synthesis failed: {e}") from e
        return Response(content=audio, media_type="audio/wav")

    return app


def pick_port(host: str, preferred: int) -> int:
    for port in range(preferred, preferred + MAX_PORT_ATTEMPTS):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, port))
                return port
            except OSError:
                log.warning("port %d is in use, trying %d", port, port + 1)
    log.error("no free port found in %d..%d", preferred, preferred + MAX_PORT_ATTEMPTS - 1)
    sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Local F5-TTS service for VOTC voice mode")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--voices-dir", type=Path, default=DEFAULT_VOICES_DIR)
    args = parser.parse_args()

    library = VoiceLibrary(args.voices_dir)
    library.reload()
    if not library.entries:
        # The classic cause: launched under a different Windows account (e.g.
        # "Run as administrator"), whose %APPDATA% has no voice library.
        log.warning("=" * 60)
        log.warning("THE VOICE LIBRARY IS EMPTY. Looked in:")
        log.warning("  %s", args.voices_dir)
        log.warning("Running as Windows user '%s'. If that is not the account",
                    os.environ.get("USERNAME", "?"))
        log.warning("that owns the library, restart WITHOUT 'Run as administrator'.")
        log.warning("=" * 60)
    engine = Engine(library)
    app = build_app(library, engine)

    port = pick_port(args.host, args.port)
    # Parseable line for the Electron app (it reads this to learn the port).
    print(f"TTS_SERVICE_PORT={port}", flush=True)
    uvicorn.run(app, host=args.host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
