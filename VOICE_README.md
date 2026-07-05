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

- **Everything (normal use):** double-click `Start VOTC Voice.bat` in the repo root.
  It refuses to launch while the installed VOTC app is running, then starts the app,
  which spawns the TTS service itself. Closing the window stops everything.
- **TTS service alone (diagnostics):** double-click `tts-server/start-tts-server.bat`.
  Wait for "model loaded" (~20 s). Close the window to stop it.
- **Smoke test:** with a service running, double-click `tts-server/test-speak.bat` —
  it speaks a test line out loud. Also: `python tts-server/test_speak.py --text "..."`.
  (In-app equivalent: Voice tab → "Speak a test line".)

## TTS service API (localhost only, default port 8765)

- `GET /health` — status, GPU device, library size
- `GET /voices` — catalog entries (incl. transcripts) the service can see
- `POST /reload` — re-read the library folder
- `POST /synthesize` `{"text": ..., "voice_id": ...}` — returns `audio/wav`;
  `204` if nothing speakable, `404` for unknown voice
- Curator endpoints (used by the in-app Library Curator): `POST /curator/analyze`
  (ffmpeg mono/24kHz/trim/normalize + local Whisper transcription into a staging
  file under `voices/_incoming/`), `POST /curator/save|update|rename|delete|retranscribe`
  (all catalog writes atomic, under a lock), `GET /curator/audio/{kind}/{id}` (previews).
  ffmpeg is located via PATH or the winget links folder.

If port 8765 is taken it walks upward (max +20) and prints `TTS_SERVICE_PORT=<port>`.

## Voice assignment (who sounds like whom)

- Rules live in `voice-mapping.json` in the fork's data folder (`votc_data\`) —
  "Open mapping file" / "Reload mapping" buttons are in the Voice tab. The file's
  `_readme` section documents every condition and filter. Rules run top to bottom,
  first match wins; gender and age band are applied automatically; filters relax
  step by step so assignment can never fail while the library has ≥1 voice.
- The final pick is a stable hash of the character ID over the sorted candidates:
  the same character gets the same voice every session, with nothing stored.
  Adding voices to the library can reshuffle some assignments (candidate sets
  change) — pin characters you care about.
- Pins live in `voice-overrides.json` (edited via the Voice tab's assignment
  panel; pins beat all rules). Recent speakers are tracked in the same file.
- Every decision is logged to `votc_data\logs\voice-assignments.log` (auto-rotated)
  — read it to tune the mapping file.
- Logic tests: `npx tsx scripts/test-voice-assignment.ts`.

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
| `.gitignore` | Ignore `voice-clips/` (raw gathered clips staging folder) and `.claude/`. |
| `package-lock.json` | Regenerated by `npm install` on this machine (npm 10.9.2) — incidental, expect conflicts here on upstream merges; resolve by regenerating (`npm install`). |

New files (never conflict on upstream merges): `src/main/voice/`, `src/renderer/voice/`,
`src/renderer/config/VoiceView.tsx`, `tts-server/`, this README.

Deviation note: the Voice tab label and VoiceView texts are hardcoded English rather
than added to the 9 locale files — the voice feature is English-only by design and
this keeps the upstream merge surface small.

Packaging note: this fork is meant to run from source via `Start VOTC Voice.bat`.
If it is ever packaged with electron-builder, the TTS service spawn path
(`app.getAppPath()/tts-server` in `src/main/voice/TTSService.ts`) would point inside
the asar archive and must be adjusted (e.g. ship tts-server as an extraResource).

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
- **A voice repeats the end of its reference line at sentence gaps:** the service pads
  each reference with 0.35 s of silence after F5-TTS's own (too aggressive) trimming,
  which fixed this class of artifact. If it recurs for one voice, check that voice's
  transcript exactly matches the END of the clip (Edit → play the clip → compare),
  and that the clip doesn't cut off mid-word.
- **First import of a session is slow:** the Whisper transcription model loads on
  first use (~15 s). Subsequent imports are fast.
- **Status light green but a different port than 8765:** normal — if the port is
  taken (e.g. a manually started service), the app's service walks up to the next
  free port and the app follows it automatically.
- **Library empty / folder renamed:** the app runs exactly like vanilla VOTC;
  the service logs a warning and `GET /health` shows `"voices": 0`.
- **Assignments look wrong:** read `votc_data\logs\voice-assignments.log` — every
  decision lists the character's facts, the rule that fired, and the candidate count.
