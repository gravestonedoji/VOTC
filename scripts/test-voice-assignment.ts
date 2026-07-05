/**
 * voice-mode fork: sanity tests for the assignment engine's pure logic.
 * Run with:  npx --yes tsx scripts/test-voice-assignment.ts
 * Exits non-zero on the first failure.
 */
import assert from 'assert';
import {
    CharacterFacts,
    MappingFile,
    VoiceCardLite,
    ageToBand,
    assignVoice,
    fnv1a,
} from '../src/main/voice/assignmentCore';
import { DEFAULT_MAPPING } from '../src/main/voice/defaultMapping';

const voice = (id: string, gender: string, age: string, tags: string[] = [], accent = 'neutral', mod: string[] = []): VoiceCardLite =>
    ({ voice_id: id, gender, age_band: age, personality_tags: tags, accent_tag: accent, mod_tags: mod });

const facts = (over: Partial<CharacterFacts>): CharacterFacts => ({
    id: 1, name: 'Test', gender: 'male', ageBand: 'adult', traits: [], culture: '', faith: '',
    house: '', personalityText: '', titleText: '', scores: {}, isRuler: false, ...over,
});

const LIBRARY: VoiceCardLite[] = [
    voice('f_adult_warm', 'female', 'adult', ['warm']),
    voice('m_adult_stern', 'male', 'adult', ['stern']),
    voice('m_adult_jovial', 'male', 'adult', ['jovial']),
    voice('m_elder_gruff', 'male', 'elder', ['gruff', 'stern']),
];

// 1. Determinism: same character, same result, 100 times.
{
    const first = assignVoice(facts({ id: 424242 }), DEFAULT_MAPPING, LIBRARY)!;
    for (let i = 0; i < 100; i++) {
        const again = assignVoice(facts({ id: 424242 }), DEFAULT_MAPPING, LIBRARY)!;
        assert.strictEqual(again.voiceId, first.voiceId, 'assignment must be deterministic');
    }
}

// 2. Candidate ordering must not depend on library order.
{
    const shuffled = [...LIBRARY].reverse();
    const a = assignVoice(facts({ id: 7 }), DEFAULT_MAPPING, LIBRARY)!;
    const b = assignVoice(facts({ id: 7 }), DEFAULT_MAPPING, shuffled)!;
    assert.strictEqual(a.voiceId, b.voiceId, 'library order must not change the pick');
}

// 3. Trait rule routes wrathful men to stern/gruff/cold voices.
{
    const r = assignVoice(facts({ traits: ['wrathful'] }), DEFAULT_MAPPING, LIBRARY)!;
    assert.ok(['m_adult_stern'].includes(r.voiceId), `wrathful adult male -> stern, got ${r.voiceId}`);
}

// 4. Gender is respected when possible: a female character never gets a male voice here.
{
    for (let id = 1; id <= 50; id++) {
        const r = assignVoice(facts({ id, gender: 'female' }), DEFAULT_MAPPING, LIBRARY)!;
        assert.strictEqual(r.voiceId, 'f_adult_warm', 'female characters must get the only female voice');
    }
}

// 5. Degradation: a female elder (no female elder voice exists) still gets the female voice (age dropped).
{
    const r = assignVoice(facts({ gender: 'female', ageBand: 'elder' }), DEFAULT_MAPPING, LIBRARY)!;
    assert.strictEqual(r.voiceId, 'f_adult_warm');
    assert.notStrictEqual(r.ladderStep, 'gender+age+rule');
}

// 6. Sparse library: ONE voice serves absolutely everyone.
{
    const tiny = [voice('only_one', 'female', 'young', ['timid'])];
    for (const g of ['male', 'female'] as const) {
        for (const t of [['wrathful'], ['zealous'], []]) {
            const r = assignVoice(facts({ gender: g, traits: t }), DEFAULT_MAPPING, tiny)!;
            assert.strictEqual(r.voiceId, 'only_one', 'a one-voice library must still assign everyone');
        }
    }
}

// 7. Empty library returns null (caller skips voicing) rather than throwing.
assert.strictEqual(assignVoice(facts({}), DEFAULT_MAPPING, []), null);

// 8. Broken/empty mapping still assigns via built-in catch-all.
{
    const r = assignVoice(facts({}), { rules: [] } as MappingFile, LIBRARY);
    assert.ok(r && r.voiceId, 'empty rules must fall back to catch-all');
}

// 9. Unknown-gender voices are wildcards; unknown character gender skips the filter.
{
    const lib = [voice('anyone', 'unknown', 'adult')];
    const r = assignVoice(facts({ gender: 'female' }), DEFAULT_MAPPING, lib)!;
    assert.strictEqual(r.voiceId, 'anyone');
    const r2 = assignVoice(facts({ gender: null }), DEFAULT_MAPPING, LIBRARY)!;
    assert.ok(r2.voiceId, 'null gender must not crash');
}

// 10. Age banding boundaries (defaults: young<=24, adult<=54).
assert.strictEqual(ageToBand(16), 'young');
assert.strictEqual(ageToBand(24), 'young');
assert.strictEqual(ageToBand(25), 'adult');
assert.strictEqual(ageToBand(54), 'adult');
assert.strictEqual(ageToBand(55), 'elder');
assert.strictEqual(ageToBand(0), null);
assert.strictEqual(ageToBand(30, { young_max_age: 30, adult_max_age: 60 }), 'young');

// 11. Hash is stable across runs (regression pin).
assert.strictEqual(fnv1a('12345'), fnv1a('12345'));
assert.notStrictEqual(fnv1a('12345'), fnv1a('12346'));

// 12. Distribution sanity: many characters spread over more than one voice.
{
    const picks = new Set<string>();
    for (let id = 1; id <= 200; id++) {
        picks.add(assignVoice(facts({ id }), DEFAULT_MAPPING, LIBRARY)!.voiceId);
    }
    assert.ok(picks.size >= 2, `200 male adults should spread over the 2 matching voices, got ${picks.size}`);
}

console.log('All assignment-engine tests passed.');
