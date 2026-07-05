# VOTC Voice Mode — Fork Documentation

This fork of [Voices of the Court](https://github.com/Voices-of-the-Court/VOTC) adds
spoken voices for NPC replies, synthesized locally by F5-TTS. Nothing in the voice
pipeline touches the internet. Build brief: `votc-voice-mode-brief.md` (Rev 3, kept
in Moe's Downloads).

## Components

| Component | Where | What it does |
|---|---|---|
| TTS service | `tts-server/` (this repo) | Local Python web server wrapping the existing F5-TTS install at `C:\Users\moham\Claude\F5-TTS`. Receives text + voice_id, returns WAV. |
| Voice library | `%APPDATA%\VOTC-Voice\votc_data\voices\` | Reference clips (`{voice_id}.wav`), transcripts (`{voice_id}.txt`), and `catalog.json` with tags. Written by the in-app Curator, read by the service. |
| App voice module | `src/main/voice/` + renderer Voice tab (coming in Phase 2+) | Hooks NPC reply completion, resolves voices, queues playback. |

## Fork data folder (important)

The fork stores ALL its user data in `%APPDATA%\VOTC-Voice` — a one-time copy
(taken 2026-07-05) of the installed app's `%APPDATA%\VOTC`. The two copies drift
apart from that date. The installed app remains untouched as a fallback.
Never point the fork back at `%APPDATA%\VOTC`.

## How to start / stop everything

- **TTS service alone:** double-click `tts-server/start-tts-server.bat`.
  Wait for "model loaded" (~20 s). Close the window to stop it.
- **Smoke test:** with the service running, double-click `tts-server/test-speak.bat` —
  it speaks a test line out loud. Also: `python tts-server/test_speak.py --text "..."`.
- **App from source:** `npm run dev` in the repo root.
- (Phase 5 will add a single `Start VOTC Voice.bat` that launches both.)

## TTS service API (localhost only, default port 8765)

- `GET /health` — status, GPU device, library size
- `GET /voices` — catalog entries the service can see
- `POST /reload` — re-read the library folder (Curator calls this after imports)
- `POST /synthesize` `{"text": ..., "voice_id": ...}` — returns `audio/wav`;
  `204` if nothing speakable, `404` for unknown voice

If port 8765 is taken it walks upward (max +20) and prints `TTS_SERVICE_PORT=<port>`.

## Original files touched (the merge map — keep current)

| File | Why |
|---|---|
| `src/main/main.ts` | One added first-line import of `./voice/forkDataPath` (data-folder redirect). |

Everything else so far is new files (`src/main/voice/`, `tts-server/`, this README).

## Pulling in a new upstream VOTC release

```
git fetch upstream
git checkout voice-mode
git merge <new-release-tag>     # e.g. git merge v2.0.4
# resolve conflicts — only files in the merge map above should ever conflict
npm install && npm run typecheck
git push origin voice-mode
```

The installed (fallback) app auto-updates itself; this fork only updates via the
procedure above, so their versions will drift. That is expected.

## Troubleshooting

- **Service window closes instantly / won't start:** run `python tts-server\server.py`
  in a terminal to see the error. Most likely Python can't find `f5_tts` — the service
  must run in the default Python 3.10 (`python` on PATH), the same one F5-TTS uses.
- **Synthesis is slow (many seconds):** almost certainly the wrong Python environment
  (CPU instead of GPU). Check `GET /health` — `"device"` must be `"cuda"`.
- **No audio device / no sound:** the service still returns audio; playback happens in
  the app (or `test_speak.py`). Check Windows output device and app volume.
- **A clip transcribes badly or clones poorly:** re-record or re-trim in the Curator;
  fix the transcript text — transcript accuracy directly affects cloning quality.
  Best clips: 5–12 s, one speaker, no music or echo.
- **Library empty / folder renamed:** the app runs exactly like vanilla VOTC;
  the service logs a warning and `GET /health` shows `"voices": 0`.
