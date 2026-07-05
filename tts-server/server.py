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
import time
from pathlib import Path

import soundfile as sf
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

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
        self.entries = {}
        catalog_path = self.voices_dir / "catalog.json"
        if not catalog_path.is_file():
            log.warning("voice library: no catalog at %s — library is empty", catalog_path)
            return
        try:
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            log.error("voice library: cannot read catalog.json (%s) — library is empty", e)
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
            self.entries[voice_id] = {"meta": entry, "wav_path": wav, "ref_text": ref_text}
        log.info("voice library: %d voice(s) loaded from %s", len(self.entries), self.voices_dir)


# --------------------------------------------------------------------------
# TTS engine — loads the F5-TTS model once, caches per-voice references
# --------------------------------------------------------------------------

class Engine:
    def __init__(self, library: VoiceLibrary):
        self.library = library
        self._ref_cache: dict[str, tuple[str, str]] = {}
        log.info("loading F5-TTS model (first load takes a few seconds)...")
        t0 = time.perf_counter()
        from f5_tts.api import F5TTS  # imported late so --help stays fast
        self.f5 = F5TTS()
        log.info("model loaded on '%s' in %.1fs", self.f5.device, time.perf_counter() - t0)

    def clear_cache(self) -> None:
        self._ref_cache = {}

    def _reference_for(self, voice_id: str) -> tuple[str, str]:
        """Return (processed_ref_wav, processed_ref_text), cached per voice."""
        if voice_id not in self._ref_cache:
            from f5_tts.infer.utils_infer import preprocess_ref_audio_text
            entry = self.library.entries[voice_id]
            ref_file, ref_text = preprocess_ref_audio_text(
                str(entry["wav_path"]), entry["ref_text"], show_info=log.debug
            )
            self._ref_cache[voice_id] = (ref_file, ref_text)
        return self._ref_cache[voice_id]

    def synthesize(self, text: str, voice_id: str) -> bytes:
        ref_file, ref_text = self._reference_for(voice_id)
        t0 = time.perf_counter()
        wav, sr, _ = self.f5.infer(
            ref_file=ref_file,
            ref_text=ref_text,
            gen_text=text,
            seed=INFERENCE_SEED,
            show_info=log.debug,
            progress=None,
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


def build_app(library: VoiceLibrary, engine: Engine) -> FastAPI:
    app = FastAPI(title="VOTC voice-mode TTS service")
    started = time.time()

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "device": engine.f5.device,
            "sample_rate": engine.f5.target_sample_rate,
            "voices": len(library.entries),
            "uptime_s": round(time.time() - started, 1),
        }

    @app.get("/voices")
    def voices():
        return {"voices": [e["meta"] for e in library.entries.values()]}

    @app.post("/reload")
    def reload_library():
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
    engine = Engine(library)
    app = build_app(library, engine)

    port = pick_port(args.host, args.port)
    # Parseable line for the Electron app (it reads this to learn the port).
    print(f"TTS_SERVICE_PORT={port}", flush=True)
    uvicorn.run(app, host=args.host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
