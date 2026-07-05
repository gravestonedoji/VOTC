import type { LLMProviderConfig, AppSettings, ILLMModel, PromptSettings, ActionApprovalSettings, VoiceSettings } from '../main/llmProviders/types';

// voice-mode fork
export interface VoiceServiceStatus {
  state: 'stopped' | 'starting' | 'running' | 'error';
  port: number | null;
  voices: number;
  device: string | null;
  detail?: string;
}

export interface VoiceUtterance {
  utteranceId: number;
  speaker: string;
  volume: number;
  wavBase64: string;
}

export interface VoiceCard {
  voice_id: string;
  display_name: string;
  gender: string;
  age_band: string;
  personality_tags: string[];
  accent_tag: string;
  mod_tags: string[];
  source_note: string;
  created?: string;
  transcript?: string;
}

export interface AnalyzedClip {
  temp_id: string;
  source_name: string;
  duration_s: number;
  transcript: string;
  warnings: string[];
}

export type CuratorResult<T> = { success: true; data: T } | { success: false; error: string };

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

// Types for summaries manager
export interface ConversationSummary {
  date: string;
  totalDays: number;
  content: string;
  characterName?: string; // Optional for backward compatibility
}

export interface SummaryMetadata {
  playerId: string;
  playerName?: string; // If we can derive it
  characterId: string;
  characterName: string; // From file or fallback to ID
  summaries: ConversationSummary[];
  filePath: string;
}

declare global {
  interface Window {
    // voice-mode fork
    voiceAPI: {
      getSettings: () => Promise<VoiceSettings>;
      saveSettings: (patch: Partial<VoiceSettings>) => Promise<VoiceSettings>;
      getStatus: () => Promise<VoiceServiceStatus>;
      startService: () => Promise<void>;
      restartService: () => Promise<void>;
      reloadLibrary: () => Promise<{ success: boolean; voices?: number; error?: string }>;
      openVoicesFolder: () => Promise<{ success: boolean; error?: string }>;
      speakTestLine: (voiceId?: string) => Promise<void>;
      pickClips: () => Promise<string[]>;
      listVoices: () => Promise<VoiceCard[]>;
      curatorAnalyze: (sourcePath: string) => Promise<CuratorResult<AnalyzedClip>>;
      curatorSave: (payload: VoiceCard & { temp_id: string; transcript: string }) => Promise<CuratorResult<VoiceCard>>;
      curatorUpdate: (payload: VoiceCard & { transcript?: string }) => Promise<CuratorResult<VoiceCard>>;
      curatorRename: (oldId: string, newId: string) => Promise<CuratorResult<VoiceCard>>;
      curatorDelete: (voiceId: string) => Promise<CuratorResult<{ success: boolean }>>;
      curatorRetranscribe: (voiceId: string) => Promise<CuratorResult<{ transcript: string }>>;
      getAudio: (kind: 'voice' | 'temp', ident: string) => Promise<CuratorResult<string>>;
      getAssignmentInfo: () => Promise<AssignmentInfo>;
      setOverride: (characterId: number, voiceId: string | null) => Promise<void>;
      reloadMapping: () => Promise<{ success: boolean; error?: string; ruleCount?: number }>;
      openMappingFile: () => Promise<{ success: boolean; error?: string }>;
      clearQueue: () => Promise<void>;
      playbackCommand: (cmd: 'stop' | 'skip') => Promise<void>;
      onStatus: (callback: (status: VoiceServiceStatus) => void) => () => void;
      onEnqueue: (callback: (utterance: VoiceUtterance) => void) => () => void;
      onClear: (callback: () => void) => () => void;
      onCommand: (callback: (cmd: 'stop' | 'skip') => void) => () => void;
    };
    conversationAPI: {
      sendMessage: (userMessage: string) => Promise<{streamStarted?: boolean, message?: any, error?: string}>;
      reset: () => Promise<boolean>;
      getConversationEntries: () => Promise<any[]>;
      onConversationUpdate: (callback: (entries: any[]) => void) => () => void;
      cancelStream: () => Promise<void>;
      pauseConversation: () => Promise<void>;
      resumeConversation: () => Promise<void>;
      getConversationState: () => Promise<{ isPaused: boolean; queueLength: number }>;
      regenerateMessage: (messageId: number) => Promise<{success: boolean, error?: string}>;
      editUserMessage: (messageId: number, newContent: string) => Promise<{success: boolean, error?: string}>;
      regenerateError: (messageId: number) => Promise<{success: boolean, error?: string}>;
      acceptSummaryImport: (characterId: number, sourcePlayerId: string) => Promise<{success: boolean, error?: string}>;
      declineSummaryImport: (characterId: number, sourcePlayerId: string) => Promise<{success: boolean, error?: string}>;
      openSummaryFile: (filePath: string) => Promise<{success: boolean, error?: string}>;
      getActiveConversationData: () => Promise<any>;
      approveActions: (approvalEntryId: number) => Promise<void>;
      declineActions: (approvalEntryId: number) => Promise<void>;
      getPromptPreview: (characterId: number) => Promise<any>;
      openSummariesFolder: () => Promise<{success: boolean, error?: string}>;
      clearSummaries: () => Promise<{success: boolean, error?: string}>;
      // Summaries manager methods
      listAllSummaries: () => Promise<SummaryMetadata[]>;
      getSummariesForCharacter: (playerId: string, characterId: string) => Promise<ConversationSummary[]>;
      updateSummary: (playerId: string, characterId: string, summaryIndex: number, newContent: string) => Promise<{success: boolean, error?: string}>;
      deleteSummary: (playerId: string, characterId: string, summaryIndex: number) => Promise<{success: boolean, error?: string}>;
      deleteCharacterSummaries: (playerId: string, characterId: string) => Promise<{success: boolean, error?: string}>;
    };
    electronAPI: {
      setIgnoreMouseEvents: (ignore: boolean) => void;
      toggleConfigPanel: () => Promise<void>;
      hideWindow: () => void;
      onChatReset: (callback: () => void) => () => void;
      onToggleSettings: (callback: () => void) => () => void;
      onHideChat: (callback: () => void) => () => void;
      onToggleMinimize: (callback: () => void) => () => void;
      openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
      collectAndOpenLogs: () => Promise<{ success: boolean; path?: string; error?: string }>;
      getAppVersion: () => Promise<string>;
      onOverlayVisibilityChange: (callback: (isVisible: boolean) => void) => () => void;
    };
    llmConfigAPI: {
      getAppSettings: () => Promise<AppSettings>;
      saveProviderConfig: (config: LLMProviderConfig) => Promise<LLMProviderConfig>;
      deletePreset: (instanceId: string) => Promise<void>; // Renamed
      setActiveProvider: (instanceId: string | null) => Promise<void>;
      listModels: () => Promise<ILLMModel[] | { error: string }>;
      testConnection: () => Promise<{success: boolean, error?: string, message?: string}>;
      checkPlayer2Health: () => Promise<{success: boolean, client_version?: string, error?: string, message?: string, code?: number}>;
      setCK3Folder: (path: string | null) => Promise<void>;
      setModLocationPath: (path: string | null) => Promise<void>;
      selectFolder: () => Promise<string | null>;
      saveGlobalStreamSetting: (enabled: boolean) => Promise<void>;
      savePauseOnRegenerationSetting: (enabled: boolean) => Promise<void>;
      saveGenerateFollowingMessagesSetting: (enabled: boolean) => Promise<void>;
      saveMessageFontSize: (fontSize: number) => Promise<void>;
      saveShowSettingsOnStartupSetting: (enabled: boolean) => Promise<void>;
      getLanguage: () => Promise<string>;
      saveLanguage: (language: string) => Promise<void>;
      getAllowPrerelease: () => Promise<boolean>;
      saveAllowPrerelease: (allow: boolean) => Promise<void>;
      importLegacySummaries: () => Promise<{success: boolean, message: string, filesCopied?: number, errors?: string[]}>;
      // Provider override methods
      getActionsProviderId: () => Promise<string | null>;
      setActionsProviderId: (instanceId: string | null) => Promise<void>;
      getSummaryProviderId: () => Promise<string | null>;
      setSummaryProviderId: (instanceId: string | null) => Promise<void>;
      getActionApprovalSettings: () => Promise<ActionApprovalSettings>;
      saveActionApprovalSettings: (settings: ActionApprovalSettings) => Promise<void>;
      getSummaryPromptSettings: () => Promise<{ rollingPrompt: string; finalPrompt: string, letterSummaryPrompt: string }>;
      saveSummaryPromptSettings: (settings: { rollingPrompt: string; finalPrompt: string, letterSummaryPrompt: string}) => Promise<void>;
    };
    promptsAPI: {
      getSettings: () => Promise<PromptSettings>;
      saveSettings: (settings: PromptSettings) => Promise<void>;
      getLetterSettings: () => Promise<PromptSettings>;
      saveLetterSettings: (settings: PromptSettings) => Promise<void>;
      listFiles: (category: 'system' | 'character_description' | 'example_messages' | 'helpers') => Promise<string[]>;
      readFile: (relativePath: string) => Promise<string>;
      saveFile: (relativePath: string, content: string) => Promise<void>;
      getDefaultMain: () => Promise<string>;
      getDefaultLetterMain: () => Promise<string>;
      listPresets: () => Promise<any[]>;
      savePreset: (preset: any) => Promise<any>;
      deletePreset: (id: string) => Promise<void>;
      openPromptsFolder: () => Promise<void>;
      openPromptFile: (relativePath: string) => Promise<void>;
      exportZip: (payload: { settings?: any, path?: string }) => Promise<{ success?: boolean; cancelled?: boolean; path?: string }>;
      validateTemplate: (templateString: string) => Promise<{ valid: boolean; error?: string; line?: number; column?: number }>;
    };
    lettersAPI: {
      getPromptPreview: () => Promise<string | null>;
      getStatuses: () => Promise<any>;
      getLetterDetails: (letterId: string) => Promise<any | null>;
      clearOldStatuses: (daysThreshold: number) => Promise<{success: boolean, error?: string}>;
    };
    actionsAPI: {
      reload: () => Promise<{ success: boolean; error?: string }>;
      getAll: () => Promise<Array<{
        id: string;
        title: string;
        scope: 'standard' | 'custom';
        filePath: string;
        validation: { valid: boolean; message?: string };
        disabled: boolean;
        isDestructive: boolean;
        hasDestructiveOverride: boolean;
      }>>;
      setDisabled: (actionId: string, disabled: boolean) => Promise<{ success: boolean; error?: string }>;
      setDestructiveOverride: (actionId: string, isDestructive: boolean | null) => Promise<{ success: boolean; error?: string }>;
      getSettings: () => Promise<{ disabledActions: string[]; validation: Record<string, { valid: boolean; message?: string }> }>;
      openFolder: () => Promise<void>;
      openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
      getDetails: (actionId: string, sourceCharacterId: number) => Promise<{
        valid: boolean;
        error?: string;
        canExecute?: boolean;
        id?: string;
        title?: string;
        args?: Array<{
          name: string;
          type: 'number' | 'string' | 'enum' | 'boolean';
          description: string;
          displayName?: string;
          required?: boolean;
          min?: number;
          max?: number;
          step?: number;
          maxLength?: number;
          minLength?: number;
          options?: string[];
        }>;
        requiresTarget?: boolean;
        validTargetCharacterIds?: number[];
        isDestructive?: boolean;
      }>;
      execute: (params: { actionId: string; sourceCharacterId: number; targetCharacterId?: number | null; args: Record<string, any> }) => Promise<{
        actionId: string;
        success: boolean;
        feedback?: { message: string; sentiment: 'positive' | 'negative' | 'neutral' };
        error?: string;
      }>;
    };
  }
}
// For now, using 'any' to get the structure in place.
export {};
