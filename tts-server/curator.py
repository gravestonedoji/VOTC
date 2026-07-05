"""Library Curator backend: import, clean, transcribe, tag, and manage
reference clips in the voice library.

All heavy lifting for the in-app Curator UI happens here, in the same
process as the TTS engine:
  - ffmpeg turns any common audio/video file into a mono 24 kHz WAV,
    trims leading/trailing silence, and normalizes loudness
  - the Whisper model bundled with F5-TTS transcribes the result locally
  - catalog.json is only ever replaced atomically, under a lock, so a
    failed import can never damage existing library entries
"""

import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

log = logging.getLogger("tts-server")

TARGET_SAMPLE_RATE = 24000
IDEAL_MIN_S, IDEAL_MAX_S = 5.0, 12.0
HARD_MIN_S, HARD_MAX_S = 1.0, 60.0

VOICE_ID_RE = re.compile(r"^[a-z0-9_]{3,64}$")

# Trim silence quieter than -45 dB from both ends, then normalize loudness,
# then downmix/resample. Deterministic, same chain for every import.
_FFMPEG_FILTERS = (
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,"
    "areverse,"
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,"
    "areverse,"
    "loudnorm=I=-18:TP=-2:LRA=11"
)


class CuratorError(Exception):
    """User-facing failure with a plain-language message."""


def find_ffmpeg(name: str = "ffmpeg") -> str:
    exe = shutil.which(name)
    if exe:
        return exe
    winget = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Links" / f"{name}.exe"
    if winget.is_file():
        return str(winget)
    raise CuratorError(
        f"{name} was not found on this machine. It is needed to convert audio. "
        "Install it with: winget install Gyan.FFmpeg"
    )


class Curator:
    def __init__(self, library, engine):
        self.library = library      # VoiceLibrary from server.py
        self.engine = engine        # Engine from server.py (for cache clearing)
        self.catalog_lock = threading.Lock()
        self.incoming_dir = library.voices_dir / "_incoming"
        self._transcriber = None

    # ------------------------------------------------------------------
    # analysis: raw clip in -> cleaned temp wav + transcript out
    # ------------------------------------------------------------------

    def cleanup_stale_temps(self) -> None:
        if not self.incoming_dir.is_dir():
            return
        cutoff = time.time() - 24 * 3600
        for f in self.incoming_dir.glob("*.wav"):
            try:
                if f.stat().st_mtime < cutoff:
                    f.unlink()
            except OSError:
                pass

    def _probe_duration(self, path: Path) -> float:
        ffprobe = find_ffmpeg("ffprobe")
        result = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "a:0", "-show_entries",
             "format=duration", "-of", "json", str(path)],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            raise CuratorError(
                "This file could not be read as audio. It may be corrupt, "
                "or it may not contain an audio track."
            )
        try:
            return float(json.loads(result.stdout)["format"]["duration"])
        except (KeyError, ValueError, json.JSONDecodeError) as e:
            raise CuratorError("Could not determine the clip's duration — the file may be corrupt.") from e

    def analyze(self, source_path: str) -> dict:
        """Convert + trim + normalize into a temp wav, then transcribe it."""
        src = Path(source_path)
        if not src.is_file():
            raise CuratorError(f"File not found: {src}")

        raw_duration = self._probe_duration(src)
        if raw_duration < HARD_MIN_S:
            raise CuratorError(f"This clip is only {raw_duration:.1f}s long — too short to clone a voice from.")
        if raw_duration > HARD_MAX_S:
            raise CuratorError(
                f"This clip is {raw_duration:.0f}s long. Please cut it down to a 5-12 second "
                "excerpt of a single speaker first."
            )

        self.incoming_dir.mkdir(parents=True, exist_ok=True)
        temp_id = uuid.uuid4().hex
        temp_wav = self.incoming_dir / f"{temp_id}.wav"

        ffmpeg = find_ffmpeg("ffmpeg")
        result = subprocess.run(
            [ffmpeg, "-y", "-i", str(src), "-vn", "-af", _FFMPEG_FILTERS,
             "-ac", "1", "-ar", str(TARGET_SAMPLE_RATE), "-c:a", "pcm_s16le", str(temp_wav)],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0 or not temp_wav.is_file():
            log.error("ffmpeg failed for %s: %s", src, result.stderr[-500:])
            raise CuratorError("Audio conversion failed — the file may be corrupt or in an unsupported format.")

        duration = self._probe_duration(temp_wav)
        if duration < HARD_MIN_S:
            temp_wav.unlink(missing_ok=True)
            raise CuratorError(
                "After trimming silence, almost nothing was left of this clip. "
                "It may be silent or too quiet."
            )

        warnings = []
        if duration < IDEAL_MIN_S:
            warnings.append(f"Clip is {duration:.1f}s after trimming — shorter than the ideal 5-12s.")
        elif duration > IDEAL_MAX_S:
            warnings.append(
                f"Clip is {duration:.1f}s after trimming — F5-TTS only uses the first ~12s, "
                "so consider a tighter excerpt."
            )

        transcript = self._transcribe(temp_wav)
        if not transcript.strip():
            warnings.append("Nothing was transcribed — is anyone speaking in this clip?")

        log.info("curator: analyzed '%s' -> %s (%.1fs)", src.name, temp_id, duration)
        return {
            "temp_id": temp_id,
            "source_name": src.name,
            "duration_s": round(duration, 2),
            "transcript": transcript.strip(),
            "warnings": warnings,
        }

    def _transcribe(self, wav_path: Path) -> str:
        if self._transcriber is None:
            log.info("curator: loading the Whisper transcription model (first import only)...")
            from f5_tts.infer.utils_infer import transcribe
            self._transcriber = transcribe
        try:
            return self._transcriber(str(wav_path), language="en")
        except Exception as e:  # noqa: BLE001
            log.exception("curator: transcription failed")
            raise CuratorError(f"Transcription failed: {e}") from e

    def retranscribe(self, voice_id: str) -> str:
        entry = self.library.entries.get(voice_id)
        if not entry:
            raise CuratorError(f"Unknown voice '{voice_id}'.")
        return self._transcribe(entry["wav_path"]).strip()

    # ------------------------------------------------------------------
    # catalog mutations — always atomic, always under the lock
    # ------------------------------------------------------------------

    def _read_catalog(self) -> dict:
        catalog_path = self.library.voices_dir / "catalog.json"
        if catalog_path.is_file():
            return json.loads(catalog_path.read_text(encoding="utf-8"))
        return {"voices": []}

    def _write_catalog(self, catalog: dict) -> None:
        catalog_path = self.library.voices_dir / "catalog.json"
        tmp = catalog_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(catalog, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, catalog_path)

    @staticmethod
    def _card_from(payload: dict, voice_id: str) -> dict:
        return {
            "voice_id": voice_id,
            "display_name": str(payload.get("display_name") or voice_id),
            "gender": str(payload.get("gender") or "unknown"),
            "age_band": str(payload.get("age_band") or "adult"),
            "personality_tags": [str(t) for t in payload.get("personality_tags") or []],
            "accent_tag": str(payload.get("accent_tag") or "neutral"),
            "mod_tags": [str(t) for t in payload.get("mod_tags") or []],
            "source_note": str(payload.get("source_note") or ""),
            "created": str(payload.get("created") or time.strftime("%Y-%m-%d")),
        }

    def save_new(self, temp_id: str, transcript: str, payload: dict) -> dict:
        voice_id = str(payload.get("voice_id") or "").strip()
        if not VOICE_ID_RE.match(voice_id):
            raise CuratorError(
                "Voice ID must be 3-64 characters of lowercase letters, digits and underscores "
                "(e.g. m_elder_stern_norse)."
            )
        if not transcript.strip():
            raise CuratorError("The transcript is empty. Type what is said in the clip before saving.")
        temp_wav = self.incoming_dir / f"{temp_id}.wav"
        if not temp_wav.is_file():
            raise CuratorError("The imported audio has expired. Please import the file again.")

        with self.catalog_lock:
            if voice_id in self.library.entries:
                raise CuratorError(f"A voice with the ID '{voice_id}' already exists.")
            wav_dest = self.library.voices_dir / f"{voice_id}.wav"
            txt_dest = self.library.voices_dir / f"{voice_id}.txt"
            # Order matters: files first, catalog last. If anything fails
            # mid-way the catalog never references a missing file.
            shutil.copyfile(temp_wav, wav_dest)
            txt_dest.write_text(transcript.strip() + "\n", encoding="utf-8")
            catalog = self._read_catalog()
            card = self._card_from(payload, voice_id)
            catalog["voices"].append(card)
            self._write_catalog(catalog)
            temp_wav.unlink(missing_ok=True)
            self._refresh()
        log.info("curator: saved new voice '%s'", voice_id)
        return card

    def update(self, voice_id: str, transcript: str | None, payload: dict) -> dict:
        with self.catalog_lock:
            if voice_id not in self.library.entries:
                raise CuratorError(f"Unknown voice '{voice_id}'.")
            if transcript is not None:
                if not transcript.strip():
                    raise CuratorError("The transcript cannot be empty.")
                (self.library.voices_dir / f"{voice_id}.txt").write_text(
                    transcript.strip() + "\n", encoding="utf-8"
                )
            catalog = self._read_catalog()
            card = self._card_from(payload, voice_id)
            existing = next((v for v in catalog["voices"] if v.get("voice_id") == voice_id), None)
            if existing:
                card["created"] = existing.get("created", card["created"])
                catalog["voices"] = [card if v.get("voice_id") == voice_id else v for v in catalog["voices"]]
            else:
                catalog["voices"].append(card)
            self._write_catalog(catalog)
            self._refresh()
        log.info("curator: updated voice '%s'", voice_id)
        return card

    def rename(self, old_id: str, new_id: str) -> dict:
        if not VOICE_ID_RE.match(new_id):
            raise CuratorError("The new voice ID must be lowercase letters, digits and underscores.")
        with self.catalog_lock:
            if old_id not in self.library.entries:
                raise CuratorError(f"Unknown voice '{old_id}'.")
            if new_id in self.library.entries or (self.library.voices_dir / f"{new_id}.wav").exists():
                raise CuratorError(f"A voice with the ID '{new_id}' already exists.")
            os.replace(self.library.voices_dir / f"{old_id}.wav", self.library.voices_dir / f"{new_id}.wav")
            os.replace(self.library.voices_dir / f"{old_id}.txt", self.library.voices_dir / f"{new_id}.txt")
            catalog = self._read_catalog()
            card = None
            for v in catalog["voices"]:
                if v.get("voice_id") == old_id:
                    v["voice_id"] = new_id
                    card = v
            self._write_catalog(catalog)
            self._refresh()
        log.info("curator: renamed voice '%s' -> '%s'", old_id, new_id)
        return card or {"voice_id": new_id}

    def delete(self, voice_id: str) -> None:
        with self.catalog_lock:
            if voice_id not in self.library.entries:
                raise CuratorError(f"Unknown voice '{voice_id}'.")
            catalog = self._read_catalog()
            catalog["voices"] = [v for v in catalog["voices"] if v.get("voice_id") != voice_id]
            self._write_catalog(catalog)  # catalog first: a stray file is harmless, a dangling card is not
            (self.library.voices_dir / f"{voice_id}.wav").unlink(missing_ok=True)
            (self.library.voices_dir / f"{voice_id}.txt").unlink(missing_ok=True)
            self._refresh()
        log.info("curator: deleted voice '%s'", voice_id)

    def audio_path(self, kind: str, ident: str) -> Path:
        if kind == "temp":
            p = self.incoming_dir / f"{ident}.wav"
        else:
            entry = self.library.entries.get(ident)
            p = entry["wav_path"] if entry else None
        if not p or not p.is_file():
            raise CuratorError("Audio not found.")
        return p

    def _refresh(self) -> None:
        self.library.reload()
        self.engine.clear_cache()
