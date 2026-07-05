import { BrowserWindow } from 'electron';
import { Character } from '../gameData/Character';
import { settingsRepository } from '../SettingsRepository';
import { ttsService } from './TTSService';
import { voiceAssigner } from './VoiceAssigner';
import { VoiceCardLite } from './assignmentCore';

const TEST_LINE = 'Greetings, my liege. If you can hear this, the voice pipeline is working.';

/**
 * Orchestrates the voice pipeline on the main-process side:
 * NPC reply text in → emote stripping → synthesis (strictly one at a
 * time, in arrival order) → WAV bytes sent to the chat window's player.
 *
 * The golden rule: nothing in here may ever throw into, block, or slow
 * down the conversation flow. Every public entry point is fire-and-forget.
 */
class VoiceManager {
    private getWindow: () => BrowserWindow | null = () => null;
    private synthesisChain: Promise<void> = Promise.resolve();
    private utteranceCounter = 0;
    private generation = 0; // bumped on clear; stale synth results are dropped

    init(getWindow: () => BrowserWindow | null): void {
        this.getWindow = getWindow;
        ttsService.on('status', (status) => {
            this.send('voice:status', status);
        });
    }

    /** Remove *asterisk-wrapped* roleplay actions; returns '' if nothing speakable remains. */
    private stripEmotes(text: string): string {
        return text.replace(/\*[^*]*\*/g, ' ').replace(/\s+/g, ' ').trim();
    }

    /** Called from Conversation.respondAs when an NPC reply is complete. Never throws. */
    onNpcReply(content: string, npc: Character): void {
        try {
            const settings = settingsRepository.getVoiceSettings();
            if (!settings.enabled) return;
            if (ttsService.getStatus().state !== 'running') return;

            const text = settings.stripEmotes ? this.stripEmotes(content) : content;
            if (!text.trim()) return; // 100%-emote reply: speak nothing

            this.enqueueSynthesis(text, npc.fullName, undefined, npc);
        } catch (err) {
            console.error('[voice] onNpcReply failed (conversation unaffected):', err);
        }
    }

    /** The permanent diagnostic: speak a fixed line through the whole pipeline.
     *  With a voiceId, tests that specific library voice. */
    speakTestLine(voiceId?: string): void {
        this.enqueueSynthesis(TEST_LINE, 'Voice test', voiceId);
    }

    /** New conversation, or user hit "clear queue": drop everything pending. */
    clearQueue(): void {
        this.generation++;
        this.send('voice:clear');
    }

    /** Forward a playback command (stop / skip) to the renderer player. */
    playbackCommand(cmd: 'stop' | 'skip'): void {
        this.send('voice:command', cmd);
    }

    private enqueueSynthesis(text: string, speaker: string, requestedVoiceId?: string, npc?: Character): void {
        const generationAtEnqueue = this.generation;
        // Serialize synthesis: the GPU handles one request at a time, and
        // FIFO order here guarantees utterances arrive in reply order.
        this.synthesisChain = this.synthesisChain.then(async () => {
            if (generationAtEnqueue !== this.generation) return; // queue was cleared meanwhile
            try {
                let voiceId = requestedVoiceId;
                if (!voiceId) {
                    const voices = await ttsService.listVoices() as unknown as VoiceCardLite[];
                    if (voices.length === 0) return;
                    voiceId = npc
                        ? voiceAssigner.assign(npc, voices) ?? undefined
                        : voices[0].voice_id; // bare test line: any voice will do
                    if (!voiceId) return;
                }
                const wav = await ttsService.synthesize(text, voiceId);
                if (!wav) return; // nothing speakable
                if (generationAtEnqueue !== this.generation) return;
                this.send('voice:enqueue', {
                    utteranceId: ++this.utteranceCounter,
                    speaker,
                    volume: settingsRepository.getVoiceSettings().volume,
                    wavBase64: wav.toString('base64'),
                });
            } catch (err) {
                console.error('[voice] synthesis failed (conversation unaffected):', err);
            }
        });
    }

    private send(channel: string, payload?: unknown): void {
        const win = this.getWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, payload);
        }
    }
}

export const voiceManager = new VoiceManager();
