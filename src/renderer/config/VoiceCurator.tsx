import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalyzedClip, VoiceCard } from '../../preload/global';

// voice-mode fork: the Library Curator — import, tag, and manage voices.
// English-only labels by design (see VOICE_README.md).

const PERSONALITY_FLAVORS = [
    'stern', 'warm', 'scheming', 'zealous', 'jovial', 'cold',
    'gruff', 'timid', 'seductive', 'weary', 'mad', 'noble',
];

interface PendingImport extends AnalyzedClip {
    card: VoiceCard;
    saving?: boolean;
    error?: string;
}

const emptyCard = (): VoiceCard => ({
    voice_id: '',
    display_name: '',
    gender: 'male',
    age_band: 'adult',
    personality_tags: [],
    accent_tag: 'neutral',
    mod_tags: [],
    source_note: '',
});

const suggestVoiceId = (card: VoiceCard): string => {
    const g = card.gender === 'female' ? 'f' : 'm';
    const flavor = card.personality_tags[0] || 'plain';
    const accent = card.accent_tag && card.accent_tag !== 'neutral' ? `_${card.accent_tag}` : '';
    return `${g}_${card.age_band}_${flavor}${accent}`.toLowerCase().replace(/[^a-z0-9_]/g, '');
};

/** Shared form for tagging a voice (used by import review and edit). */
const CardForm: React.FC<{
    card: VoiceCard;
    onChange: (card: VoiceCard) => void;
    idPrefix: string;
    voiceIdEditable?: boolean;
}> = ({ card, onChange, idPrefix, voiceIdEditable = true }) => {
    const toggleFlavor = (flavor: string) => {
        const tags = card.personality_tags.includes(flavor)
            ? card.personality_tags.filter((t) => t !== flavor)
            : [...card.personality_tags, flavor];
        const next = { ...card, personality_tags: tags };
        if (voiceIdEditable) next.voice_id = suggestVoiceId(next);
        onChange(next);
    };

    const set = (patch: Partial<VoiceCard>, resuggest = false) => {
        const next = { ...card, ...patch };
        if (resuggest && voiceIdEditable) next.voice_id = suggestVoiceId(next);
        onChange(next);
    };

    return (
        <>
            <div className="form-group" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <span>
                    Gender:{' '}
                    <label><input type="radio" name={`${idPrefix}-gender`} checked={card.gender === 'male'}
                        onChange={() => set({ gender: 'male' }, true)} /> male</label>{' '}
                    <label><input type="radio" name={`${idPrefix}-gender`} checked={card.gender === 'female'}
                        onChange={() => set({ gender: 'female' }, true)} /> female</label>
                </span>
                <span>
                    Age:{' '}
                    <select value={card.age_band} onChange={(e) => set({ age_band: e.target.value }, true)}>
                        <option value="young">young</option>
                        <option value="adult">adult</option>
                        <option value="elder">elder</option>
                    </select>
                </span>
            </div>
            <div className="form-group">
                <label>Personality flavor (tick what you hear):</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                    {PERSONALITY_FLAVORS.map((flavor) => (
                        <label key={flavor} style={{ whiteSpace: 'nowrap' }}>
                            <input
                                type="checkbox"
                                checked={card.personality_tags.includes(flavor)}
                                onChange={() => toggleFlavor(flavor)}
                            /> {flavor}
                        </label>
                    ))}
                </div>
            </div>
            <div className="form-group" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <label>
                    Accent:{' '}
                    <input type="text" value={card.accent_tag} size={10}
                        onChange={(e) => set({ accent_tag: e.target.value.trim() || 'neutral' })} />
                </label>
                <label>
                    Mod tags (comma-separated, e.g. pod:ventrue):{' '}
                    <input type="text" value={card.mod_tags.join(', ')} size={18}
                        onChange={(e) => set({ mod_tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
                </label>
            </div>
            <div className="form-group" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <label>
                    Display name:{' '}
                    <input type="text" value={card.display_name} size={22}
                        onChange={(e) => set({ display_name: e.target.value })} />
                </label>
                <label>
                    Voice ID:{' '}
                    <input type="text" value={card.voice_id} size={22} disabled={!voiceIdEditable}
                        onChange={(e) => set({ voice_id: e.target.value })} />
                </label>
            </div>
            <div className="form-group">
                <label>
                    Where the clip came from (for your records):{' '}
                    <input type="text" value={card.source_note} style={{ width: '100%' }}
                        onChange={(e) => set({ source_note: e.target.value })} />
                </label>
            </div>
        </>
    );
};

const VoiceCurator: React.FC<{ serviceUp: boolean; voiceEnabled: boolean }> = ({ serviceUp, voiceEnabled }) => {
    const [pending, setPending] = useState<PendingImport[]>([]);
    const [library, setLibrary] = useState<VoiceCard[]>([]);
    const [importing, setImporting] = useState(false);
    const [notice, setNotice] = useState('');
    const [editing, setEditing] = useState<(VoiceCard & { transcript: string }) | null>(null);
    const previewRef = useRef<HTMLAudioElement | null>(null);

    const refreshLibrary = useCallback(async () => {
        setLibrary(await window.voiceAPI.listVoices());
    }, []);

    useEffect(() => {
        if (serviceUp) refreshLibrary();
    }, [serviceUp, refreshLibrary]);

    const playPreview = async (kind: 'voice' | 'temp', ident: string) => {
        const result = await window.voiceAPI.getAudio(kind, ident);
        if (!result.success) { setNotice(result.error); return; }
        previewRef.current?.pause();
        const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
        const audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })));
        previewRef.current = audio;
        audio.onended = () => URL.revokeObjectURL(audio.src);
        audio.play();
    };

    const handleImport = async () => {
        const paths = await window.voiceAPI.pickClips();
        if (paths.length === 0) return;
        setImporting(true);
        setNotice(`Importing ${paths.length} clip(s)… cleaning audio and transcribing (the first import loads the transcription model, ~15s extra).`);
        for (const p of paths) {
            const result = await window.voiceAPI.curatorAnalyze(p);
            if (result.success) {
                const clip = result.data;
                setPending((prev) => [...prev, { ...clip, card: { ...emptyCard(), display_name: clip.source_name.replace(/\.[^.]+$/, '') } }]);
            } else {
                setNotice(`"${p.split(/[\\/]/).pop()}": ${result.error}`);
            }
        }
        setImporting(false);
    };

    const savePending = async (index: number) => {
        const item = pending[index];
        const patch = (p: Partial<PendingImport>) =>
            setPending((prev) => prev.map((x, i) => (i === index ? { ...x, ...p } : x)));
        patch({ saving: true, error: undefined });
        const result = await window.voiceAPI.curatorSave({
            ...item.card,
            temp_id: item.temp_id,
            transcript: item.transcript,
        });
        if (result.success) {
            setPending((prev) => prev.filter((_, i) => i !== index));
            setNotice(`Saved voice "${result.data.voice_id}" to the library.`);
            refreshLibrary();
        } else {
            patch({ saving: false, error: result.error });
        }
    };

    const saveEdit = async () => {
        if (!editing) return;
        const result = await window.voiceAPI.curatorUpdate(editing);
        if (result.success) {
            setEditing(null);
            setNotice(`Updated "${result.data.voice_id}".`);
            refreshLibrary();
        } else {
            setNotice(result.error);
        }
    };

    const deleteVoice = async (voiceId: string) => {
        if (!window.confirm(`Delete the voice "${voiceId}" from the library? This cannot be undone.`)) return;
        const result = await window.voiceAPI.curatorDelete(voiceId);
        setNotice(result.success ? `Deleted "${voiceId}".` : result.error);
        refreshLibrary();
    };

    const retranscribe = async (voiceId: string) => {
        setNotice('Re-transcribing…');
        const result = await window.voiceAPI.curatorRetranscribe(voiceId);
        if (result.success && editing?.voice_id === voiceId) {
            setEditing({ ...editing, transcript: result.data.transcript });
            setNotice('Transcript refreshed — review and save.');
        } else {
            setNotice(result.success ? 'Done.' : result.error);
        }
    };

    if (!serviceUp) {
        return (
            <div>
                <h3>Voice library</h3>
                <p style={{ opacity: 0.75 }}>
                    The Curator needs the TTS service — start it with the button above,
                    wait for the green light, and this section comes alive.
                </p>
            </div>
        );
    }

    return (
        <div>
            <h3>Voice library ({library.length} voice{library.length === 1 ? '' : 's'})</h3>

            <div className="form-group" style={{ background: 'rgba(128,128,128,0.12)', padding: '8px 10px', borderRadius: '6px' }}>
                <small>
                    <b>Best clips:</b> 5–12 seconds, one speaker, no music or echo, expressive natural
                    delivery. Prefer public-domain or openly licensed voices (Mozilla Common Voice,
                    VCTK, LibriVox audiobooks) rather than clips of identifiable living actors or streamers.
                </small>
            </div>

            <div className="form-group button-group">
                <button type="button" onClick={handleImport} disabled={importing}>
                    {importing ? 'Importing…' : 'Import clips…'}
                </button>
            </div>
            {notice && <small style={{ display: 'block', opacity: 0.85, marginBottom: '8px' }}>{notice}</small>}

            {pending.map((item, i) => (
                <div key={item.temp_id} style={{ border: '1px solid rgba(128,128,128,0.4)', borderRadius: '6px', padding: '10px', marginBottom: '10px' }}>
                    <div className="form-group" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <b>New import:</b> {item.source_name} ({item.duration_s}s)
                        <button type="button" onClick={() => playPreview('temp', item.temp_id)}>▶ Play</button>
                        <button type="button" onClick={() => setPending((prev) => prev.filter((_, x) => x !== i))}>Discard</button>
                    </div>
                    {item.warnings.map((w) => (
                        <small key={w} style={{ display: 'block', color: '#e0b53f' }}>⚠ {w}</small>
                    ))}
                    <div className="form-group">
                        <label>Transcript (fix any mistakes — accuracy directly affects cloning quality):</label>
                        <textarea
                            rows={2}
                            style={{ width: '100%' }}
                            value={item.transcript}
                            onChange={(e) => setPending((prev) => prev.map((x, idx) => (idx === i ? { ...x, transcript: e.target.value } : x)))}
                        />
                    </div>
                    <CardForm
                        idPrefix={`pending-${i}`}
                        card={item.card}
                        onChange={(card) => setPending((prev) => prev.map((x, idx) => (idx === i ? { ...x, card } : x)))}
                    />
                    {item.error && <small style={{ display: 'block', color: '#d9534f' }}>{item.error}</small>}
                    <button type="button" disabled={item.saving || !item.card.voice_id} onClick={() => savePending(i)}>
                        {item.saving ? 'Saving…' : 'Save to library'}
                    </button>
                </div>
            ))}

            {library.map((voice) => (
                <div key={voice.voice_id} style={{ borderBottom: '1px solid rgba(128,128,128,0.25)', padding: '6px 0' }}>
                    {editing?.voice_id === voice.voice_id ? (
                        <div style={{ border: '1px solid rgba(128,128,128,0.4)', borderRadius: '6px', padding: '10px' }}>
                            <div className="form-group"><b>Editing: {voice.voice_id}</b></div>
                            <div className="form-group">
                                <label>Transcript:</label>
                                <textarea rows={2} style={{ width: '100%' }} value={editing.transcript}
                                    onChange={(e) => setEditing({ ...editing, transcript: e.target.value })} />
                                <button type="button" onClick={() => retranscribe(voice.voice_id)}>Re-transcribe</button>
                            </div>
                            <CardForm idPrefix="edit" card={editing} voiceIdEditable={false}
                                onChange={(card) => setEditing({ ...editing, ...card })} />
                            <div className="button-group">
                                <button type="button" onClick={saveEdit}>Save changes</button>
                                <button type="button" onClick={() => setEditing(null)}>Cancel</button>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <b>{voice.display_name || voice.voice_id}</b>
                            <small style={{ opacity: 0.7 }}>
                                {voice.voice_id} — {voice.gender}, {voice.age_band}
                                {voice.personality_tags.length > 0 && `, ${voice.personality_tags.join('/')}`}
                                {voice.accent_tag !== 'neutral' && `, ${voice.accent_tag}`}
                            </small>
                            <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                                <button type="button" title="Play the reference clip"
                                    onClick={() => playPreview('voice', voice.voice_id)}>▶ Clip</button>
                                <button type="button" title="Speak the test line with this voice" disabled={!voiceEnabled}
                                    onClick={() => window.voiceAPI.speakTestLine(voice.voice_id)}>🗣 Test</button>
                                <button type="button" onClick={() => setEditing({ ...voice, transcript: voice.transcript || '' })}>Edit</button>
                                <button type="button" onClick={() => deleteVoice(voice.voice_id)}>Delete</button>
                            </span>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};

export default VoiceCurator;
