# VOTC Voice Mode — Fork Documentation

This fork of [Voices of the Court](https://github.com/Voices-of-the-Court/VOTC) adds
spoken voices for NPC replies, synthesized locally by F5-TTS. Nothing in the voice
pipeline touches the internet. Build brief: `votc-voice-mode-brief.md` (Rev 3, kept
in Moe's Downloads).

## Components

| Component | Where | What it does |
|---|---|---|
| TTS service | `tts-server/` (this repo) | Local Python web server wrapping the existing F5-TTS install at `C:\Users\user\Claude\F5-TTS`. Receives text + voice_id, returns WAV. |
| Voice library | `%APPDATA%\VOTC-Voice\votc_data\voices\` | Reference clips (`{voice_id}.wav`), transcripts (`{voice_id}.txt`), and `catalog.json` with tags. Written by the in-app Curator, read by the service. |
| App voice module | `src/main/voice/` + renderer Voice tab (coming in Phase 2+) | Hooks NPC reply completion, resolves voices, queues playback. |

## Fork data folder (important)

The fork stores ALL its user data in `%APPDATA%\VOTC-Voice`, seeded from the
installed app's `%APPDATA%\VOTC` by double-clicking `tts-server/fix-data-folder.bat`
(safe to re-run any time; it only reads the installed app's data and never
overwrites newer files in the fork's folder). The two copies drift apart after
seeding. The installed app remains untouched as a fallback.
Never point the fork back at `%APPDATA%\VOTC`.

Note for Claude Code sessions: writes made by Claude's tools OUTSIDE the repo
folder can land in a sandbox overlay invisible to normally-launched programs.
Any file that must exist under `%APPDATA%` has to be created by a script the
user runs (like fix-data-folder.bat) — and verified by a user-run program,
not by Claude's own shell.

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
| `src/main/main.ts` | First-line import of `./voice/forkDataPath` (data-folder redirect); voice imports; voice IPC registration + service auto-start in `app.on('ready')`; service shutdown in `before-quit`. |
| `src/main/conversation/Conversation.ts` | Two one-line `voiceManager.onNpcReply(...)` calls at the streaming and non-streaming reply-completion points in `respondAs()`. |
| `src/main/conversation/ConversationManager.ts` | One `voiceManager.clearQueue()` line in `createConversation()` (new conversation drops stale audio). |
| `src/main/SettingsRepository.ts` | `voiceSettings` schema entry, getter/setter, inclusion in `getAppSettings()`. |
| `src/main/llmProviders/types.ts` | `VoiceSettings` interface + defaults; `voiceSettings` field on `AppSettings`. |
| `src/preload/preload.ts` | `voiceAPI` context-bridge block. |
| `src/preload/global.d.ts` | Types for `window.voiceAPI` and voice events. |
| `src/renderer/App.tsx` | One `useVoicePlayer()` call mounting the audio player. |
| `src/renderer/config/ConfigPanel.tsx` | 'voice' tab: type union, header button, view conditional. |
| `.gitignore` | Ignore `voice-clips/` (raw gathered clips staging folder). |

New files (never conflict on upstream merges): `src/main/voice/`, `src/renderer/voice/`,
`src/renderer/config/VoiceView.tsx`, `tts-server/`, this README.

Deviation note: the Voice tab label and VoiceView texts are hardcoded English rather
than added to the 9 locale files — the voice feature is English-only by design and
this keeps the upstream merge surface small.

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
