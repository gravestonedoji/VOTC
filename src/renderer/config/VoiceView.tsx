import React, { ChangeEvent, useEffect, useState } from 'react';
import type { VoiceSettings } from '../../main/llmProviders/types';
import type { VoiceServiceStatus } from '../../preload/global';
import VoiceCurator from './VoiceCurator';

// voice-mode fork. Labels are hardcoded English: the voice feature is
// English-only by design (see VOICE_README.md), so it stays out of the
// upstream locale files to keep the merge surface small.

const STATUS_COLORS: Record<VoiceServiceStatus['state'], string> = {
    running: '#3fbf5a',
    starting: '#e0b53f',
    error: '#d9534f',
    stopped: '#888888',
};

const STATUS_LABELS: Record<VoiceServiceStatus['state'], string> = {
    running: 'Running',
    starting: 'Starting…',
    error: 'Error',
    stopped: 'Stopped',
};

const VoiceView: React.FC = () => {
    const [settings, setSettings] = useState<VoiceSettings | null>(null);
    const [status, setStatus] = useState<VoiceServiceStatus | null>(null);
    const [notice, setNotice] = useState<string>('');

    useEffect(() => {
        window.voiceAPI.getSettings().then(setSettings);
        window.voiceAPI.getStatus().then(setStatus);
        return window.voiceAPI.onStatus(setStatus);
    }, []);

    if (!settings) {
        return <div>Loading…</div>;
    }

    const save = async (patch: Partial<VoiceSettings>) => {
        setSettings({ ...settings, ...patch }); // optimistic
        setSettings(await window.voiceAPI.saveSettings(patch));
    };

    const handleEnabledToggle = (e: ChangeEvent<HTMLInputElement>) => save({ enabled: e.target.checked });
    const handleStripEmotesToggle = (e: ChangeEvent<HTMLInputElement>) => save({ stripEmotes: e.target.checked });
    const handleAutoStartToggle = (e: ChangeEvent<HTMLInputElement>) => save({ autoStartService: e.target.checked });
    const handleVolumeChange = (e: ChangeEvent<HTMLInputElement>) => save({ volume: parseFloat(e.target.value) });

    const handleReloadLibrary = async () => {
        const result = await window.voiceAPI.reloadLibrary();
        setNotice(result.success ? `Library reloaded: ${result.voices} voice(s).` : `Reload failed: ${result.error}`);
        setStatus(await window.voiceAPI.getStatus());
    };

    const serviceUp = status?.state === 'running';

    return (
        <div className="settings-view">
            <h3>Voice (local text-to-speech)</h3>

            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                    title={status?.detail || ''}
                    style={{
                        display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%',
                        backgroundColor: STATUS_COLORS[status?.state ?? 'stopped'],
                    }}
                />
                <span>
                    TTS service: {STATUS_LABELS[status?.state ?? 'stopped']}
                    {serviceUp && ` — ${status?.voices} voice(s) in library, on ${status?.device}`}
                    {status?.state === 'error' && status.detail ? ` — ${status.detail}` : ''}
                </span>
            </div>

            <div className="form-group button-group">
                <button type="button" onClick={() => window.voiceAPI.restartService()}>
                    {status?.state === 'stopped' || status?.state === 'error' ? 'Start service' : 'Restart service'}
                </button>
                <button type="button" onClick={handleReloadLibrary} disabled={!serviceUp}>
                    Reload voice library
                </button>
                <button type="button" onClick={() => window.voiceAPI.openVoicesFolder()}>
                    Open voices folder
                </button>
                <button type="button" onClick={() => window.voiceAPI.speakTestLine()} disabled={!serviceUp || !settings.enabled}>
                    Speak a test line
                </button>
            </div>
            {notice && <small style={{ display: 'block', marginTop: '-6px', opacity: 0.8 }}>{notice}</small>}

            <hr />

            <div className="form-group">
                <label htmlFor="voiceEnabled">Voice NPC replies (master switch):</label>
                <input
                    type="checkbox"
                    id="voiceEnabled"
                    checked={settings.enabled}
                    onChange={handleEnabledToggle}
                />
            </div>

            <div className="form-group">
                <label htmlFor="voiceVolume">Volume: {Math.round(settings.volume * 100)}%</label>
                <input
                    type="range"
                    id="voiceVolume"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.volume}
                    onChange={handleVolumeChange}
                />
            </div>

            <div className="form-group">
                <label htmlFor="voiceStripEmotes">Skip roleplay actions (*like this*) when speaking:</label>
                <input
                    type="checkbox"
                    id="voiceStripEmotes"
                    checked={settings.stripEmotes}
                    onChange={handleStripEmotesToggle}
                />
            </div>

            <div className="form-group">
                <label htmlFor="voiceAutoStart">Start TTS service with the app:</label>
                <input
                    type="checkbox"
                    id="voiceAutoStart"
                    checked={settings.autoStartService}
                    onChange={handleAutoStartToggle}
                />
            </div>

            <hr />

            <div className="form-group button-group">
                <button type="button" onClick={() => window.voiceAPI.playbackCommand('stop')}>Stop current</button>
                <button type="button" onClick={() => window.voiceAPI.playbackCommand('skip')}>Skip</button>
                <button type="button" onClick={() => window.voiceAPI.clearQueue()}>Clear queue</button>
            </div>

            <hr />

            <VoiceCurator serviceUp={serviceUp} voiceEnabled={settings.enabled} />
        </div>
    );
};

export default VoiceView;
