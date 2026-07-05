import React, { useCallback, useEffect, useState } from 'react';
import type { AssignmentInfo, VoiceCard } from '../../preload/global';

// voice-mode fork: who-sounds-like-whom panel — recent speakers with
// per-character voice pins, plus the mapping-file controls.

const VoiceAssignments: React.FC<{ serviceUp: boolean; voiceEnabled: boolean }> = ({ serviceUp, voiceEnabled }) => {
    const [info, setInfo] = useState<AssignmentInfo | null>(null);
    const [voices, setVoices] = useState<VoiceCard[]>([]);
    const [notice, setNotice] = useState('');

    const refresh = useCallback(async () => {
        setInfo(await window.voiceAPI.getAssignmentInfo());
        if (serviceUp) setVoices(await window.voiceAPI.listVoices());
    }, [serviceUp]);

    useEffect(() => {
        refresh();
        // Speakers appear as the conversation progresses; refresh while visible.
        const timer = setInterval(refresh, 5000);
        return () => clearInterval(timer);
    }, [refresh]);

    const handlePin = async (characterId: number, voiceId: string) => {
        await window.voiceAPI.setOverride(characterId, voiceId === '__auto__' ? null : voiceId);
        refresh();
    };

    const handleReloadMapping = async () => {
        const result = await window.voiceAPI.reloadMapping();
        setNotice(result.success
            ? `Mapping reloaded: ${result.ruleCount} rule(s).`
            : result.error || 'Reload failed.');
        refresh();
    };

    return (
        <div>
            <h3>Voice assignment</h3>

            <div className="form-group button-group">
                <button type="button" onClick={() => window.voiceAPI.openMappingFile()}>Open mapping file</button>
                <button type="button" onClick={handleReloadMapping}>Reload mapping</button>
            </div>
            {info?.mappingError && (
                <small style={{ display: 'block', color: '#d9534f' }}>{info.mappingError}</small>
            )}
            {notice && <small style={{ display: 'block', opacity: 0.85 }}>{notice}</small>}

            <small style={{ display: 'block', opacity: 0.7, margin: '6px 0' }}>
                Rules in the mapping file route characters to voices by their traits, culture,
                faith, age and gender; the same character always lands on the same voice.
                Pin a voice below to overrule the rules for that character permanently.
            </small>

            {(!info || info.recent.length === 0) && (
                <small style={{ display: 'block', opacity: 0.7 }}>
                    No speakers yet — characters appear here as they talk.
                </small>
            )}

            {info?.recent.map((speaker) => (
                <div key={speaker.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(128,128,128,0.2)' }}>
                    <span style={{ minWidth: '40%' }}>
                        {speaker.name}
                        {speaker.pinned && <span title="pinned"> 📌</span>}
                    </span>
                    <select
                        value={speaker.pinned ? (info.overrides[String(speaker.id)] ?? speaker.lastVoiceId) : '__auto__'}
                        onChange={(e) => handlePin(speaker.id, e.target.value)}
                        disabled={!serviceUp}
                        style={{ flex: 1 }}
                    >
                        <option value="__auto__">Auto ({speaker.lastVoiceId})</option>
                        {voices.map((v) => (
                            <option key={v.voice_id} value={v.voice_id}>
                                📌 {v.display_name || v.voice_id}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        title="Speak the test line with this character's current voice"
                        disabled={!serviceUp || !voiceEnabled}
                        onClick={() => window.voiceAPI.speakTestLine(
                            info.overrides[String(speaker.id)] ?? speaker.lastVoiceId)}
                    >
                        🗣
                    </button>
                </div>
            ))}
        </div>
    );
};

export default VoiceAssignments;
