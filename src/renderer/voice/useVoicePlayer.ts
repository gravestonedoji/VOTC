import { useEffect, useRef } from 'react';
import type { VoiceUtterance } from '../../preload/global';

/**
 * voice-mode fork: the audio player for spoken NPC replies.
 *
 * Headless hook mounted once at the app root. Receives synthesized WAV
 * utterances from the main process, plays them strictly one at a time
 * in arrival order, and obeys stop / skip / clear commands. If anything
 * fails to decode or play, the utterance is dropped silently — voice
 * must never disturb the conversation.
 */
export function useVoicePlayer(): void {
    const queueRef = useRef<VoiceUtterance[]>([]);
    const currentAudioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        const stopCurrent = () => {
            const audio = currentAudioRef.current;
            if (audio) {
                currentAudioRef.current = null;
                audio.pause();
                if (audio.src) URL.revokeObjectURL(audio.src);
            }
        };

        const playNext = () => {
            if (currentAudioRef.current) return; // something is already playing
            const next = queueRef.current.shift();
            if (!next) return;
            try {
                const bytes = Uint8Array.from(atob(next.wavBase64), (c) => c.charCodeAt(0));
                const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
                const audio = new Audio(url);
                audio.volume = Math.min(1, Math.max(0, next.volume));
                const finish = () => {
                    if (currentAudioRef.current === audio) currentAudioRef.current = null;
                    URL.revokeObjectURL(url);
                    playNext();
                };
                audio.onended = finish;
                audio.onerror = finish;
                currentAudioRef.current = audio;
                audio.play().catch(finish);
            } catch (err) {
                console.error('[voice] failed to play utterance:', err);
                playNext();
            }
        };

        const cleanups = [
            window.voiceAPI.onEnqueue((utterance) => {
                queueRef.current.push(utterance);
                playNext();
            }),
            window.voiceAPI.onClear(() => {
                queueRef.current = [];
                stopCurrent();
            }),
            window.voiceAPI.onCommand((cmd) => {
                if (cmd === 'stop') {
                    // "Stop" means silence: drop the queue too. Keeping queued
                    // utterances around would make them blurt out, stale and
                    // out of context, when the next reply arrives.
                    queueRef.current = [];
                    stopCurrent();
                } else if (cmd === 'skip') {
                    stopCurrent();
                    playNext();
                }
            }),
        ];

        return () => {
            cleanups.forEach((off) => off());
            queueRef.current = [];
            stopCurrent();
        };
    }, []);
}
