"""One-shot smoke test: ask the TTS service to speak a line out loud.

Usage (the server must already be running — double-click start-tts-server.bat):

    python test_speak.py
    python test_speak.py --text "Any line you like." --voice some_voice_id
"""

import argparse
import json
import sys
import tempfile
import time
import urllib.error
import urllib.request
import winsound

DEFAULT_TEXT = (
    "Greetings, my liege. The voice pipeline is alive, "
    "and every word you hear was made on this very machine."
)


def fail(msg: str) -> None:
    print(f"\nPROBLEM: {msg}")
    sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--text", default=DEFAULT_TEXT)
    parser.add_argument("--voice", default=None, help="voice_id (default: first voice in library)")
    args = parser.parse_args()
    base = f"http://127.0.0.1:{args.port}"

    try:
        with urllib.request.urlopen(f"{base}/health", timeout=5) as r:
            health = json.loads(r.read())
    except (urllib.error.URLError, OSError):
        fail("The TTS service is not running. Double-click start-tts-server.bat first, "
             "wait until it says 'model loaded', then run this test again.")

    print(f"Service is up: device={health['device']}, voices in library={health['voices']}")
    if health["voices"] == 0:
        fail("The voice library is empty — there is nothing to speak with.\n"
             f"The service (running as user '{health.get('user', '?')}') is looking in:\n"
             f"  {health.get('voices_dir', '?')}\n"
             "If that path or user looks wrong, close the service window and start it\n"
             "again with a normal double-click — NOT 'Run as administrator'.")

    voice = args.voice
    if voice is None:
        with urllib.request.urlopen(f"{base}/voices", timeout=5) as r:
            voice = json.loads(r.read())["voices"][0]["voice_id"]
    print(f"Using voice: {voice}")
    print(f"Synthesizing: \"{args.text}\"")

    body = json.dumps({"text": args.text, "voice_id": voice}).encode()
    req = urllib.request.Request(
        f"{base}/synthesize", data=body, headers={"Content-Type": "application/json"}
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            audio = r.read()
    except urllib.error.HTTPError as e:
        fail(f"Synthesis failed ({e.code}): {e.read().decode(errors='replace')}")
    elapsed = time.perf_counter() - t0
    print(f"Received {len(audio) / 1024:.0f} KB of audio in {elapsed:.2f}s. Playing...")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio)
        wav_path = f.name
    winsound.PlaySound(wav_path, winsound.SND_FILENAME)
    print("Done. If you heard the line, the pipeline works end to end.")


if __name__ == "__main__":
    main()
