import fs from 'fs';
import path from 'path';
import { Character } from '../gameData/Character';
import { VOTC_DATA_DIR } from '../utils/paths';
import {
    AssignmentResult,
    CharacterFacts,
    MappingFile,
    VoiceCardLite,
    ageToBand,
    assignVoice,
} from './assignmentCore';
import { DEFAULT_MAPPING } from './defaultMapping';

const MAX_RECENT_SPEAKERS = 30;
const LOG_ROTATE_BYTES = 512 * 1024;

export interface RecentSpeaker {
    id: number;
    name: string;
    lastVoiceId: string;
    pinned: boolean;
    lastSpokeAt: string;
}

export interface AssignmentInfo {
    recent: RecentSpeaker[];
    overrides: Record<string, string>;
    mappingPath: string;
    mappingError: string | null;
    ruleCount: number;
}

/**
 * voice-mode fork: file-facing half of the assignment engine.
 * Owns voice-mapping.json (rules, seeded on first launch),
 * voice-overrides.json (pins + recent speakers), and the rolling
 * assignment debug log. The pure decision logic lives in assignmentCore.
 */
class VoiceAssigner {
    private mappingPath = path.join(VOTC_DATA_DIR, 'voice-mapping.json');
    private overridesPath = path.join(VOTC_DATA_DIR, 'voice-overrides.json');
    private logPath = path.join(VOTC_DATA_DIR, 'logs', 'voice-assignments.log');

    private mapping: MappingFile = DEFAULT_MAPPING;
    private mappingError: string | null = null;
    private overrides: Record<string, string> = {};
    private recent: RecentSpeaker[] = [];

    /** Called once on app start. Seeds the mapping file so Moe can find and edit it. */
    init(): void {
        try {
            if (!fs.existsSync(this.mappingPath)) {
                fs.mkdirSync(VOTC_DATA_DIR, { recursive: true });
                fs.writeFileSync(this.mappingPath, JSON.stringify(DEFAULT_MAPPING, null, 2), 'utf-8');
                console.log('[voice] seeded default voice-mapping.json');
            }
        } catch (err) {
            console.error('[voice] could not seed voice-mapping.json:', err);
        }
        this.reloadMapping();
        this.loadOverrides();
    }

    reloadMapping(): { success: boolean; error?: string; ruleCount?: number } {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.mappingPath, 'utf-8')) as MappingFile;
            if (!Array.isArray(parsed.rules)) throw new Error('the file has no "rules" list');
            this.mapping = parsed;
            this.mappingError = null;
            console.log(`[voice] mapping loaded: ${parsed.rules.length} rule(s)`);
            return { success: true, ruleCount: parsed.rules.length };
        } catch (err) {
            // Keep the previous (or default) mapping working; surface the error in the UI.
            this.mappingError = `voice-mapping.json could not be read (${(err as Error).message}). Using the previous rules.`;
            console.error('[voice]', this.mappingError);
            return { success: false, error: this.mappingError };
        }
    }

    private loadOverrides(): void {
        try {
            if (fs.existsSync(this.overridesPath)) {
                const data = JSON.parse(fs.readFileSync(this.overridesPath, 'utf-8'));
                this.overrides = data.overrides ?? {};
                this.recent = Array.isArray(data.recent) ? data.recent : [];
            }
        } catch (err) {
            console.error('[voice] could not read voice-overrides.json, starting empty:', err);
            this.overrides = {};
            this.recent = [];
        }
    }

    private persistOverrides(): void {
        try {
            const tmp = this.overridesPath + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify({ overrides: this.overrides, recent: this.recent }, null, 2), 'utf-8');
            fs.renameSync(tmp, this.overridesPath);
        } catch (err) {
            console.error('[voice] could not persist voice-overrides.json:', err);
        }
    }

    factsFrom(npc: Character): CharacterFacts {
        const sheHe = String(npc.sheHe ?? '').toLowerCase();
        return {
            id: npc.id,
            name: npc.fullName,
            gender: sheHe === 'she' ? 'female' : sheHe === 'he' ? 'male' : null,
            ageBand: ageToBand(npc.age, this.mapping.config),
            traits: (npc.traits ?? []).map((t) => String(t.name ?? '').toLowerCase()),
            culture: npc.culture ?? '',
            faith: npc.faith ?? '',
            house: npc.house ?? '',
            personalityText: npc.personality ?? '',
            titleText: `${npc.primaryTitle ?? ''} ${npc.heldCourtAndCouncilPositions ?? ''}`.toLowerCase(),
            scores: {
                greed: npc.greed, boldness: npc.boldness, compassion: npc.compassion,
                energy: npc.energy, honor: npc.honor, rationality: npc.rationality,
                sociability: npc.sociability, vengefulness: npc.vengefulness,
                zeal: npc.zeal, prowess: npc.prowess,
            },
            isRuler: typeof npc.isRuler === 'boolean' ? npc.isRuler : null,
        };
    }

    /** Pick a voice for this NPC. Returns null only when the library is empty. */
    assign(npc: Character, voices: VoiceCardLite[]): string | null {
        if (voices.length === 0) return null;

        const override = this.overrides[String(npc.id)];
        if (override) {
            if (voices.some((v) => v.voice_id === override)) {
                this.recordSpeaker(npc, override, true);
                this.logLine(`char=${npc.id} "${npc.fullName}" -> ${override} (pinned override)`);
                return override;
            }
            this.logLine(`char=${npc.id} "${npc.fullName}" override '${override}' no longer in library; falling back to rules`);
        }

        const facts = this.factsFrom(npc);
        const result = assignVoice(facts, this.mapping, voices) as AssignmentResult;
        this.recordSpeaker(npc, result.voiceId, false);
        const ruleLabel = result.ruleIndex === -1 ? 'built-in catch-all' : `rule#${result.ruleIndex + 1} (${result.ruleComment || 'no comment'})`;
        this.logLine(
            `char=${npc.id} "${npc.fullName}" [${facts.gender ?? '?'} ${facts.ageBand ?? '?'} traits:${facts.traits.slice(0, 6).join('/') || '-'}] ` +
            `${ruleLabel} step=${result.ladderStep} candidates=${result.candidateCount} -> ${result.voiceId}`,
        );
        return result.voiceId;
    }

    private recordSpeaker(npc: Character, voiceId: string, pinned: boolean): void {
        this.recent = [
            { id: npc.id, name: npc.fullName, lastVoiceId: voiceId, pinned, lastSpokeAt: new Date().toISOString() },
            ...this.recent.filter((r) => r.id !== npc.id),
        ].slice(0, MAX_RECENT_SPEAKERS);
        this.persistOverrides();
    }

    setOverride(characterId: number, voiceId: string | null): void {
        if (voiceId) {
            this.overrides[String(characterId)] = voiceId;
        } else {
            delete this.overrides[String(characterId)];
        }
        this.recent = this.recent.map((r) =>
            r.id === characterId ? { ...r, pinned: voiceId !== null, lastVoiceId: voiceId ?? r.lastVoiceId } : r,
        );
        this.persistOverrides();
        this.logLine(voiceId
            ? `char=${characterId} pinned to ${voiceId} by user`
            : `char=${characterId} pin removed by user`);
    }

    getInfo(): AssignmentInfo {
        return {
            recent: this.recent,
            overrides: { ...this.overrides },
            mappingPath: this.mappingPath,
            mappingError: this.mappingError,
            ruleCount: this.mapping.rules?.length ?? 0,
        };
    }

    getMappingPath(): string {
        return this.mappingPath;
    }

    private logLine(line: string): void {
        try {
            fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
            try {
                if (fs.statSync(this.logPath).size > LOG_ROTATE_BYTES) {
                    fs.renameSync(this.logPath, this.logPath + '.old');
                }
            } catch { /* log file does not exist yet */ }
            fs.appendFileSync(this.logPath, `[${new Date().toISOString()}] ${line}\n`, 'utf-8');
        } catch { /* logging must never break the pipeline */ }
    }
}

export const voiceAssigner = new VoiceAssigner();
