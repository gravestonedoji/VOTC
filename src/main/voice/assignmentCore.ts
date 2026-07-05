/**
 * voice-mode fork: the pure decision logic of the assignment engine.
 *
 * No Electron, no filesystem, no network — everything here is a plain
 * function of (character facts, mapping rules, voice catalog), which is
 * what makes assignment deterministic and testable: the same character
 * with the same library gets the same voice, every single time.
 */

export type AgeBand = 'young' | 'adult' | 'elder';

/** The slice of a catalog card the engine cares about. */
export interface VoiceCardLite {
    voice_id: string;
    gender: string;      // 'male' | 'female' | 'unknown' (unknown matches anyone)
    age_band: string;
    personality_tags: string[];
    accent_tag: string;
    mod_tags: string[];
}

/** Everything the rules may ask about a character, pre-extracted. */
export interface CharacterFacts {
    id: number;
    name: string;
    gender: 'male' | 'female' | null;   // null: unknown/nonbinary — gender filters are skipped
    ageBand: AgeBand | null;
    traits: string[];                   // lowercase trait names
    culture: string;
    faith: string;
    house: string;
    personalityText: string;
    titleText: string;                  // primary title + court positions, lowercase
    scores: Record<string, number>;     // boldness, greed, zeal, ... (0-100)
    isRuler: boolean | null;
}

export interface RuleWhen {
    gender?: 'male' | 'female';
    age_band?: AgeBand | AgeBand[];
    has_trait_any?: string[];
    culture_contains_any?: string[];
    faith_contains_any?: string[];
    house_contains_any?: string[];
    title_contains_any?: string[];
    personality_contains_any?: string[];
    score_at_least?: Record<string, number>;
    score_at_most?: Record<string, number>;
    is_ruler?: boolean;
}

export interface RulePickFrom {
    personality_tags_any?: string[];
    accent_tag_any?: string[];
    mod_tags_any?: string[];
    voice_id_any?: string[];
}

export interface MappingRule {
    comment?: string;
    when: RuleWhen;
    pick_from: RulePickFrom;
}

export interface MappingConfig {
    young_max_age?: number; // inclusive; default 24
    adult_max_age?: number; // inclusive; default 54
}

export interface MappingFile {
    config?: MappingConfig;
    rules: MappingRule[];
}

export interface AssignmentResult {
    voiceId: string;
    ruleIndex: number;
    ruleComment: string;
    ladderStep: string;
    candidateCount: number;
}

export const CATCH_ALL_RULE: MappingRule = { comment: 'built-in catch-all', when: {}, pick_from: {} };

// ---------------------------------------------------------------------------

const lower = (s: unknown): string => String(s ?? '').toLowerCase();

const containsAny = (haystack: string, needles: string[]): boolean =>
    needles.some((n) => haystack.includes(lower(n)));

export function ageToBand(age: number | null | undefined, config?: MappingConfig): AgeBand | null {
    if (age == null || !Number.isFinite(age) || age <= 0) return null;
    if (age <= (config?.young_max_age ?? 24)) return 'young';
    if (age <= (config?.adult_max_age ?? 54)) return 'adult';
    return 'elder';
}

/** Every specified condition must hold; a condition on missing data fails the rule. */
export function matchRule(when: RuleWhen, facts: CharacterFacts): boolean {
    if (when.gender !== undefined && facts.gender !== when.gender) return false;
    if (when.age_band !== undefined) {
        const wanted = Array.isArray(when.age_band) ? when.age_band : [when.age_band];
        if (facts.ageBand === null || !wanted.includes(facts.ageBand)) return false;
    }
    if (when.has_trait_any !== undefined &&
        !when.has_trait_any.some((t) => facts.traits.includes(lower(t)))) return false;
    if (when.culture_contains_any !== undefined && !containsAny(lower(facts.culture), when.culture_contains_any)) return false;
    if (when.faith_contains_any !== undefined && !containsAny(lower(facts.faith), when.faith_contains_any)) return false;
    if (when.house_contains_any !== undefined && !containsAny(lower(facts.house), when.house_contains_any)) return false;
    if (when.title_contains_any !== undefined && !containsAny(facts.titleText, when.title_contains_any)) return false;
    if (when.personality_contains_any !== undefined &&
        !containsAny(lower(facts.personalityText), when.personality_contains_any)) return false;
    if (when.score_at_least !== undefined) {
        for (const [score, min] of Object.entries(when.score_at_least)) {
            const value = facts.scores[lower(score)];
            if (value === undefined || value < min) return false;
        }
    }
    if (when.score_at_most !== undefined) {
        for (const [score, max] of Object.entries(when.score_at_most)) {
            const value = facts.scores[lower(score)];
            if (value === undefined || value > max) return false;
        }
    }
    if (when.is_ruler !== undefined) {
        if (facts.isRuler === null || facts.isRuler !== when.is_ruler) return false;
    }
    return true;
}

export function filterByPick(voices: VoiceCardLite[], pick: RulePickFrom): VoiceCardLite[] {
    return voices.filter((v) => {
        if (pick.voice_id_any && !pick.voice_id_any.includes(v.voice_id)) return false;
        if (pick.personality_tags_any &&
            !v.personality_tags.some((t) => pick.personality_tags_any!.map(lower).includes(lower(t)))) return false;
        if (pick.accent_tag_any && !pick.accent_tag_any.map(lower).includes(lower(v.accent_tag))) return false;
        if (pick.mod_tags_any &&
            !v.mod_tags.some((t) => pick.mod_tags_any!.map(lower).includes(lower(t)))) return false;
        return true;
    });
}

const byGender = (voices: VoiceCardLite[], facts: CharacterFacts): VoiceCardLite[] =>
    facts.gender === null
        ? voices
        : voices.filter((v) => lower(v.gender) === facts.gender || lower(v.gender) === 'unknown');

const byAge = (voices: VoiceCardLite[], facts: CharacterFacts): VoiceCardLite[] =>
    facts.ageBand === null ? voices : voices.filter((v) => lower(v.age_band) === facts.ageBand);

/** FNV-1a, 32-bit unsigned: a tiny stable string hash with good spread. */
export function fnv1a(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/**
 * The heart of the engine. Finds the first matching rule, then walks a
 * degradation ladder from most-specific to least until candidates exist:
 *   1. gender + age band + the rule's tag filter
 *   2. gender + the rule's tag filter        (age dropped)
 *   3. gender + age band                     (rule filter dropped)
 *   4. gender only
 *   5. the whole library
 * With a non-empty library this can never fail. The final pick is a
 * stable hash of the character ID over the sorted candidates.
 */
export function assignVoice(
    facts: CharacterFacts,
    mapping: MappingFile,
    voices: VoiceCardLite[],
): AssignmentResult | null {
    if (voices.length === 0) return null;

    const rules = mapping.rules?.length ? mapping.rules : [CATCH_ALL_RULE];
    let ruleIndex = rules.findIndex((r) => matchRule(r.when ?? {}, facts));
    let rule: MappingRule;
    if (ruleIndex === -1) {
        rule = CATCH_ALL_RULE;
        ruleIndex = -1; // no user rule matched; built-in catch-all
    } else {
        rule = rules[ruleIndex];
    }

    const pick = rule.pick_from ?? {};
    const ladder: Array<[string, VoiceCardLite[]]> = [
        ['gender+age+rule', filterByPick(byAge(byGender(voices, facts), facts), pick)],
        ['gender+rule', filterByPick(byGender(voices, facts), pick)],
        ['gender+age', byAge(byGender(voices, facts), facts)],
        ['gender', byGender(voices, facts)],
        ['any', voices],
    ];
    const [ladderStep, candidates] = ladder.find(([, c]) => c.length > 0)!;

    const sorted = [...candidates].sort((a, b) => a.voice_id.localeCompare(b.voice_id));
    const chosen = sorted[fnv1a(String(facts.id)) % sorted.length];

    return {
        voiceId: chosen.voice_id,
        ruleIndex,
        ruleComment: rule.comment ?? '',
        ladderStep,
        candidateCount: sorted.length,
    };
}
