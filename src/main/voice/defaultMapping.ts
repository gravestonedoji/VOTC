import { MappingFile } from './assignmentCore';

/**
 * voice-mode fork: the starter voice-mapping.json, written to the data
 * folder on first launch. Everything here is meant to be edited by hand —
 * rules run top to bottom, first match wins, and the "Reload mapping"
 * button in the Voice tab picks up changes without a restart.
 */
export const DEFAULT_MAPPING: MappingFile & { _readme: string[] } = {
    _readme: [
        'HOW THIS FILE WORKS',
        'Rules run top to bottom; the first rule whose `when` matches the character wins.',
        'The winning rule\'s `pick_from` filters the voice library by catalog tags.',
        'Gender and age band are ALWAYS applied automatically on top of `pick_from`.',
        'If a filter matches zero voices it relaxes step by step (drop age, drop tags,',
        'drop everything) so every character always gets some voice, even with 3 clips.',
        'Within the final candidates the character\'s ID picks one deterministically —',
        'same character, same voice, every session. Pins in the Voice tab beat all rules.',
        '',
        'WHAT `when` CAN CHECK',
        'gender: "male"|"female" | age_band: "young"|"adult"|"elder" (or a list)',
        'has_trait_any: ["wrathful", ...] (CK3 trait names)',
        'culture_contains_any / faith_contains_any / house_contains_any: substrings',
        'title_contains_any: substrings of the primary title + court positions',
        'personality_contains_any: substrings of the personality description',
        'score_at_least / score_at_most: {"zeal": 70} — scores are 0-100:',
        '  greed, boldness, compassion, energy, honor, rationality, sociability,',
        '  vengefulness, zeal, prowess',
        'is_ruler: true|false',
        '',
        'WHAT `pick_from` CAN FILTER',
        'personality_tags_any / accent_tag_any / mod_tags_any / voice_id_any',
        'Personality tags from the Curator: stern, warm, scheming, zealous, jovial,',
        'cold, gruff, timid, seductive, weary, mad, noble',
        '',
        'config.young_max_age / adult_max_age set the age-band cutoffs (inclusive).',
    ],
    config: {
        young_max_age: 24,
        adult_max_age: 54,
    },
    rules: [
        {
            comment: 'PoD example, disabled by default gibberish faith name — rename to a real clan faith string (check in-game) and tag clips with pod:ventrue to activate',
            when: { faith_contains_any: ['zzz_example_ventrue'] },
            pick_from: { mod_tags_any: ['pod:ventrue'] },
        },
        {
            comment: 'lunatics and the possessed sound unsettling',
            when: { has_trait_any: ['lunatic', 'possessed'] },
            pick_from: { personality_tags_any: ['mad'] },
        },
        {
            comment: 'cruel and wrathful characters get hard voices',
            when: { has_trait_any: ['wrathful', 'vengeful', 'sadistic', 'callous'] },
            pick_from: { personality_tags_any: ['stern', 'gruff', 'cold'] },
        },
        {
            comment: 'religious fervor',
            when: { has_trait_any: ['zealous'] },
            pick_from: { personality_tags_any: ['zealous', 'stern'] },
        },
        {
            comment: 'schemers and paranoids whisper',
            when: { has_trait_any: ['deceitful', 'paranoid', 'schemer', 'ambitious'] },
            pick_from: { personality_tags_any: ['scheming', 'cold'] },
        },
        {
            comment: 'seducers and the lustful',
            when: { has_trait_any: ['seducer', 'seductress', 'lustful'] },
            pick_from: { personality_tags_any: ['seductive', 'warm'] },
        },
        {
            comment: 'life of the feast',
            when: { has_trait_any: ['gregarious', 'drunkard', 'reveler'] },
            pick_from: { personality_tags_any: ['jovial', 'warm'] },
        },
        {
            comment: 'the meek and fearful',
            when: { has_trait_any: ['craven', 'shy', 'content'] },
            pick_from: { personality_tags_any: ['timid', 'weary'] },
        },
        {
            comment: 'scholars and cynics',
            when: { has_trait_any: ['cynical', 'scholar', 'erudite', 'lazy'] },
            pick_from: { personality_tags_any: ['cold', 'weary'] },
        },
        {
            comment: 'honorable souls',
            when: { has_trait_any: ['honest', 'just', 'compassionate', 'brave'] },
            pick_from: { personality_tags_any: ['noble', 'warm'] },
        },
        {
            comment: 'rulers default to authority',
            when: { is_ruler: true },
            pick_from: { personality_tags_any: ['stern', 'noble', 'warm'] },
        },
        {
            comment: 'catch-all: gender + age band still apply automatically, then any voice',
            when: {},
            pick_from: {},
        },
    ],
};
