import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { VOTC_DATA_DIR } from '../utils/paths';

export type TTSServiceState = 'stopped' | 'starting' | 'running' | 'error';

export interface TTSStatus {
    state: TTSServiceState;
    port: number | null;
    voices: number;
    device: string | null;
    detail?: string;
}

const HEALTH_POLL_MS = 5000;
const STARTUP_TIMEOUT_MS = 120_000; // model load takes ~20s; leave generous headroom

/**
 * Manages the local F5-TTS python service as a child process:
 * spawn on demand, discover the actual port from stdout, health-check,
 * restart, and shut down with the app. All failures degrade to a status
 * change — nothing here ever throws into the caller.
 */
export class TTSService extends EventEmitter {
    private child: ChildProcess | null = null;
    private status: TTSStatus = { state: 'stopped', port: null, voices: 0, device: null };
    private healthTimer: NodeJS.Timeout | null = null;
    private restartTimer: NodeJS.Timeout | null = null;
    // Poll generation: bumped whenever polling should cease, so an in-flight
    // async poll iteration from a previous service instance can't re-arm
    // itself or write status for a process that no longer exists.
    private pollGen = 0;
    private stopping = false;

    getStatus(): TTSStatus {
        return { ...this.status };
    }

    private setStatus(patch: Partial<TTSStatus>): void {
        this.status = { ...this.status, ...patch };
        this.emit('status', this.getStatus());
    }

    start(preferredPort: number): void {
        if (this.child) return; // already running or starting
        this.stopping = false;

        const serverDir = path.join(app.getAppPath(), 'tts-server');
        const voicesDir = path.join(VOTC_DATA_DIR, 'voices');
        this.setStatus({ state: 'starting', port: null, detail: 'launching python service' });

        let child: ChildProcess;
        try {
            child = spawn('python', ['server.py', '--port', String(preferredPort), '--voices-dir', voicesDir], {
                cwd: serverDir,
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });
        } catch (err) {
            this.setStatus({ state: 'error', detail: `failed to launch python: ${err}` });
            return;
        }
        this.child = child;

        const startupDeadline = setTimeout(() => {
            if (this.status.state === 'starting') {
                this.setStatus({ state: 'error', detail: 'service did not become healthy in time' });
            }
        }, STARTUP_TIMEOUT_MS);

        // Every handler below ignores events from a replaced child: on Windows
        // a killed python process can take seconds to actually exit, and its
        // late events must not clobber the instance that replaced it.
        child.stdout?.on('data', (buf: Buffer) => {
            if (this.child !== child) return;
            const text = buf.toString();
            for (const line of text.split(/\r?\n/)) {
                if (!line.trim()) continue;
                console.log('[tts-service]', line);
                const m = line.match(/^TTS_SERVICE_PORT=(\d+)/);
                if (m) {
                    this.setStatus({ port: parseInt(m[1], 10) });
                    this.beginHealthPolling();
                }
            }
        });
        child.stderr?.on('data', (buf: Buffer) => {
            // Python logging writes to stderr; it is mostly INFO noise.
            for (const line of buf.toString().split(/\r?\n/)) {
                if (line.trim()) console.log('[tts-service]', line);
            }
        });

        child.on('exit', (code) => {
            if (this.child !== child) return;
            clearTimeout(startupDeadline);
            this.stopHealthPolling();
            this.child = null;
            if (!this.stopping) {
                this.setStatus({ state: 'error', port: null, detail: `service exited unexpectedly (code ${code})` });
            } else {
                this.setStatus({ state: 'stopped', port: null, voices: 0, device: null, detail: undefined });
            }
        });
        child.on('error', (err) => {
            if (this.child !== child) return;
            clearTimeout(startupDeadline);
            this.stopHealthPolling();
            this.child = null;
            // Typical cause: python not on PATH.
            this.setStatus({ state: 'error', port: null, detail: `could not start python: ${err.message}` });
        });
    }

    stop(): void {
        this.stopping = true;
        if (this.restartTimer) {
            clearTimeout(this.restartTimer); // a pending restart must not resurrect the service
            this.restartTimer = null;
        }
        this.stopHealthPolling();
        if (this.child) {
            const child = this.child;
            this.child = null; // detach first so the exit handler ignores the kill
            child.kill();
        }
        this.setStatus({ state: 'stopped', port: null, voices: 0, device: null, detail: undefined });
    }

    restart(preferredPort: number): void {
        this.stop();
        // Give the old process a moment to release the port.
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            this.start(preferredPort);
        }, 1000);
    }

    private beginHealthPolling(): void {
        const gen = ++this.pollGen;
        if (this.healthTimer) {
            clearTimeout(this.healthTimer);
            this.healthTimer = null;
        }
        const poll = async () => {
            if (gen !== this.pollGen) return;
            const ok = await this.checkHealth(gen);
            if (gen !== this.pollGen) return;
            // While starting, poll fast so the status light turns green promptly.
            const next = ok ? HEALTH_POLL_MS : (this.status.state === 'starting' ? 1500 : HEALTH_POLL_MS);
            this.healthTimer = setTimeout(poll, next);
        };
        poll();
    }

    private stopHealthPolling(): void {
        this.pollGen++; // invalidates any in-flight poll iteration
        if (this.healthTimer) {
            clearTimeout(this.healthTimer);
            this.healthTimer = null;
        }
    }

    private async checkHealth(gen: number): Promise<boolean> {
        const port = this.status.port;
        if (!port) return false;
        try {
            const res = await fetch(`http://127.0.0.1:${port}/health`, {
                signal: AbortSignal.timeout(3000),
            });
            if (!res.ok) throw new Error(`health returned ${res.status}`);
            const h = await res.json() as { voices: number; device: string };
            if (gen !== this.pollGen) return false; // service was stopped/replaced mid-fetch
            this.setStatus({ state: 'running', voices: h.voices, device: h.device, detail: undefined });
            return true;
        } catch {
            if (gen !== this.pollGen) return false;
            if (this.status.state === 'running') {
                this.setStatus({ state: 'error', detail: 'service stopped responding' });
            }
            return false;
        }
    }

    /** POST /synthesize. Returns WAV bytes, or null when there is nothing to speak (204). */
    async synthesize(text: string, voiceId: string): Promise<Buffer | null> {
        if (this.status.state !== 'running' || !this.status.port) {
            throw new Error('TTS service is not running');
        }
        const res = await fetch(`http://127.0.0.1:${this.status.port}/synthesize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice_id: voiceId }),
            // Generous: even very long replies finish in seconds on the GPU,
            // but a CPU-fallback F5-TTS run must not silently drop them.
            signal: AbortSignal.timeout(300_000),
        });
        if (res.status === 204) return null;
        if (!res.ok) throw new Error(`synthesize failed (${res.status}): ${await res.text()}`);
        return Buffer.from(await res.arrayBuffer());
    }

    async listVoices(): Promise<Array<{ voice_id: string;[k: string]: unknown }>> {
        if (this.status.state !== 'running' || !this.status.port) return [];
        try {
            const res = await fetch(`http://127.0.0.1:${this.status.port}/voices`, { signal: AbortSignal.timeout(5000) });
            const data = await res.json() as { voices: Array<{ voice_id: string }> };
            return data.voices;
        } catch {
            return [];
        }
    }

    /** Generic JSON POST to a curator endpoint. Throws with the service's plain-language message on 400. */
    async curatorPost<T>(endpoint: string, body: unknown, timeoutMs = 180_000): Promise<T> {
        if (this.status.state !== 'running' || !this.status.port) {
            throw new Error('The TTS service is not running.');
        }
        const res = await fetch(`http://127.0.0.1:${this.status.port}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error((data as { detail?: string }).detail || `curator request failed (${res.status})`);
        }
        return data as T;
    }

    /** Fetch a library or pending-import clip as WAV bytes for preview playback. */
    async fetchAudio(kind: 'voice' | 'temp', ident: string): Promise<Buffer> {
        if (this.status.state !== 'running' || !this.status.port) {
            throw new Error('The TTS service is not running.');
        }
        const res = await fetch(
            `http://127.0.0.1:${this.status.port}/curator/audio/${kind}/${encodeURIComponent(ident)}`,
            { signal: AbortSignal.timeout(15_000) },
        );
        if (!res.ok) throw new Error('Audio not found.');
        return Buffer.from(await res.arrayBuffer());
    }

    async reloadLibrary(): Promise<number> {
        if (this.status.state !== 'running' || !this.status.port) return 0;
        const res = await fetch(`http://127.0.0.1:${this.status.port}/reload`, {
            method: 'POST',
            signal: AbortSignal.timeout(10_000),
        });
        const data = await res.json() as { voices: number };
        this.setStatus({ voices: data.voices });
        return data.voices;
    }
}

export const ttsService = new TTSService();
