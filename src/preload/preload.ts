import { contextBridge, ipcRenderer } from 'electron';
import type { LLMProviderConfig, AppSettings, ILLMModel } from '../main/llmProviders/types'; // Adjusted import path

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Sends a message to the main process to set the window's mouse event ignoring state.
   * @param ignore True to ignore mouse events (click-through), false to capture them.
   */
  setIgnoreMouseEvents: (ignore: boolean): void => {
    ipcRenderer.send('set-ignore-mouse-events', ignore);
  },
  toggleConfigPanel: (): Promise<void> => ipcRenderer.invoke('toggle-config-panel'),
  hideWindow: (): void => ipcRenderer.send('chat-hide'),
  onChatReset: (callback: () => void) => {
    ipcRenderer.on('chat-reset', callback);
    return () => ipcRenderer.removeListener('chat-reset', callback);
  },
  onToggleSettings: (callback: () => void) => {
    ipcRenderer.on('toggle-settings', callback);
    return () => ipcRenderer.removeListener('toggle-settings', callback);
  },
  onHideChat: (callback: () => void) => {
    ipcRenderer.on('chat-hide', callback);
    return () => ipcRenderer.removeListener('chat-hide', callback);
  },
  onToggleMinimize: (callback: () => void) => {
    ipcRenderer.on('toggle-minimize', callback);
    return () => ipcRenderer.removeListener('toggle-minimize', callback);
  },
  openExternal: (url: string): Promise<{ success: boolean; error?: string }> => 
    ipcRenderer.invoke('shell:openExternal', url),
  collectAndOpenLogs: (): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('logs:collectAndOpen'),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  onOverlayVisibilityChange: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('overlay-visibility-change', subscription);
    // Return a function to remove the listener
    return () => ipcRenderer.removeListener('overlay-visibility-change', subscription);
  },

});

contextBridge.exposeInMainWorld('llmConfigAPI', {
  getAppSettings: (): Promise<AppSettings> => ipcRenderer.invoke('llm:getAppSettings'),
  saveProviderConfig: (config: LLMProviderConfig): Promise<LLMProviderConfig> => ipcRenderer.invoke('llm:saveProviderConfig', config),
  deletePreset: (instanceId: string): Promise<void> => ipcRenderer.invoke('llm:deletePreset', instanceId), // Renamed
  setActiveProvider: (instanceId: string | null): Promise<void> => ipcRenderer.invoke('llm:setActiveProvider', instanceId),
  listModels: (): Promise<ILLMModel[] | { error: string }> => ipcRenderer.invoke('llm:listModels'),
  testConnection: (): Promise<{success: boolean, error?: string, message?: string}> => ipcRenderer.invoke('llm:testConnection'),
  checkPlayer2Health: (): Promise<{success: boolean, client_version?: string, error?: string, message?: string, code?: number}> => ipcRenderer.invoke('llm:checkPlayer2Health'),
  setCK3Folder: (path: string | null): Promise<void> => ipcRenderer.invoke('llm:setCK3Folder', path),
  setModLocationPath: (path: string | null): Promise<void> => ipcRenderer.invoke('llm:setModLocationPath', path),
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectFolder'),
  saveGlobalStreamSetting: (enabled: boolean): Promise<void> => ipcRenderer.invoke('llm:saveGlobalStreamSetting', enabled),
  savePauseOnRegenerationSetting: (enabled: boolean): Promise<void> => ipcRenderer.invoke('llm:savePauseOnRegenerationSetting', enabled),
  saveGenerateFollowingMessagesSetting: (enabled: boolean): Promise<void> => ipcRenderer.invoke('llm:saveGenerateFollowingMessagesSetting', enabled),
  saveMessageFontSize: (fontSize: number): Promise<void> => ipcRenderer.invoke('llm:saveMessageFontSize', fontSize),
  saveShowSettingsOnStartupSetting: (enabled: boolean): Promise<void> => ipcRenderer.invoke('llm:saveShowSettingsOnStartupSetting', enabled),
  getLanguage: (): Promise<string> => ipcRenderer.invoke('llm:getLanguage'),
  saveLanguage: (language: string): Promise<void> => ipcRenderer.invoke('llm:saveLanguage', language),
  getAllowPrerelease: (): Promise<boolean> => ipcRenderer.invoke('llm:getAllowPrerelease'),
  saveAllowPrerelease: (allow: boolean): Promise<void> => ipcRenderer.invoke('llm:saveAllowPrerelease', allow),
  getCurrentContextLength: (): Promise<number> => ipcRenderer.invoke('llm:getCurrentContextLength'),
  getMaxContextLength: (): Promise<number> => ipcRenderer.invoke('llm:getMaxContextLength'),
  setCustomContextLength: (contextLength: number): Promise<void> => ipcRenderer.invoke('llm:setCustomContextLength', contextLength),
  clearCustomContextLength: (): Promise<void> => ipcRenderer.invoke('llm:clearCustomContextLength'),
  importLegacySummaries: (): Promise<{success: boolean, message: string, filesCopied?: number, errors?: string[]}> => ipcRenderer.invoke('llm:importLegacySummaries'),
  // Provider override methods
  getActionsProviderId: (): Promise<string | null> => ipcRenderer.invoke('llm:getActionsProviderId'),
  setActionsProviderId: (instanceId: string | null): Promise<void> => ipcRenderer.invoke('llm:setActionsProviderId', instanceId),
  getSummaryProviderId: (): Promise<string | null> => ipcRenderer.invoke('llm:getSummaryProviderId'),
  setSummaryProviderId: (instanceId: string | null): Promise<void> => ipcRenderer.invoke('llm:setSummaryProviderId', instanceId),
  getActionApprovalSettings: (): Promise<any> => ipcRenderer.invoke('llm:getActionApprovalSettings'),
  saveActionApprovalSettings: (settings: any): Promise<void> => ipcRenderer.invoke('llm:saveActionApprovalSettings', settings),
  getSummaryPromptSettings: (): Promise<{ rollingPrompt: string; finalPrompt: string; letterSummaryPrompt: string }> => ipcRenderer.invoke('llm:getSummaryPromptSettings'),
  saveSummaryPromptSettings: (settings: { rollingPrompt: string; finalPrompt: string; letterSummaryPrompt: string }): Promise<void> => ipcRenderer.invoke('llm:saveSummaryPromptSettings', settings),
});

contextBridge.exposeInMainWorld('promptsAPI', {
  getSettings: (): Promise<any> => ipcRenderer.invoke('prompts:getSettings'),
  saveSettings: (settings: any): Promise<void> => ipcRenderer.invoke('prompts:saveSettings', settings),
  getLetterSettings: (): Promise<any> => ipcRenderer.invoke('prompts:getLetterSettings'),
  saveLetterSettings: (settings: any): Promise<void> => ipcRenderer.invoke('prompts:saveLetterSettings', settings),
  listFiles: (category: 'system' | 'character_description' | 'example_messages' | 'helpers'): Promise<string[]> =>
    ipcRenderer.invoke('prompts:list', category),
  readFile: (relativePath: string): Promise<string> => ipcRenderer.invoke('prompts:readFile', relativePath),
  saveFile: (relativePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('prompts:saveFile', relativePath, content),
  getDefaultMain: (): Promise<string> => ipcRenderer.invoke('prompts:getDefaultMain'),
  getDefaultLetterMain: (): Promise<string> => ipcRenderer.invoke('prompts:getDefaultLetterMain'),
  listPresets: (): Promise<any[]> => ipcRenderer.invoke('prompts:listPresets'),
  savePreset: (preset: any): Promise<any> => ipcRenderer.invoke('prompts:savePreset', preset),
  deletePreset: (id: string): Promise<void> => ipcRenderer.invoke('prompts:deletePreset', id),
  openPromptsFolder: (): Promise<void> => ipcRenderer.invoke('prompts:openPromptsFolder'),
  openPromptFile: (relativePath: string): Promise<void> => ipcRenderer.invoke('prompts:openPromptFile', relativePath),
  exportZip: (payload: { settings?: any, path?: string }): Promise<{ success?: boolean; cancelled?: boolean; path?: string }> =>
    ipcRenderer.invoke('prompts:exportZip', payload),
  validateTemplate: (templateString: string): Promise<{ valid: boolean; error?: string; line?: number; column?: number }> =>
    ipcRenderer.invoke('prompts:validateTemplate', templateString),
});

contextBridge.exposeInMainWorld('lettersAPI', {
  getPromptPreview: (): Promise<string | null> =>
    ipcRenderer.invoke('letter:getPromptPreview'),
  getStatuses: (): Promise<any> =>
    ipcRenderer.invoke('letters:getStatuses'),
  getLetterDetails: (letterId: string): Promise<any | null> =>
    ipcRenderer.invoke('letters:getLetterDetails', letterId),
  clearOldStatuses: (daysThreshold: number): Promise<{success: boolean, error?: string}> =>
    ipcRenderer.invoke('letters:clearOldStatuses', daysThreshold),
});
contextBridge.exposeInMainWorld('conversationAPI', {
  sendMessage: (userMessage: string): Promise<{streamStarted?: boolean, message?: any, error?: string}> => {
    return ipcRenderer.invoke('conversation:sendMessage', { message: userMessage });
  },
  reset: (): Promise<boolean> => {
    return ipcRenderer.invoke('conversation:reset');
  },
  getConversationEntries: (): Promise<any[]> => {
    return ipcRenderer.invoke('conversation:getEntries');
  },
  onConversationUpdate: (callback: (entries: any[]) => void) => {
    const handler = (_event: any, entries: any[]) => callback(entries);
    ipcRenderer.on('conversation:updated', handler);
    return () => ipcRenderer.removeListener('conversation:updated', handler);
  },
  cancelStream: (): Promise<void> => {
    return ipcRenderer.invoke('conversation:cancelStream');
  },
  pauseConversation: (): Promise<void> => {
    return ipcRenderer.invoke('conversation:pause');
  },
  resumeConversation: (): Promise<void> => {
    return ipcRenderer.invoke('conversation:resume');
  },
  getConversationState: (): Promise<{ isPaused: boolean; queueLength: number }> => {
    return ipcRenderer.invoke('conversation:getState');
  },
  regenerateMessage: (messageId: number): Promise<{success: boolean, error?: string}> => {
    return ipcRenderer.invoke('conversation:regenerateMessage', { messageId });
  },
  editUserMessage: (messageId: number, newContent: string): Promise<{success: boolean, error?: string}> => {
    return ipcRenderer.invoke('conversation:editUserMessage', { messageId, newContent });
  },
  regenerateError: (messageId: number): Promise<{success: boolean, error?: string}> => {
    return ipcRenderer.invoke('conversation:regenerateError', { messageId });
  },
  acceptSummaryImport: (characterId: number, sourcePlayerId: string): Promise<{success: boolean, error?: string}> =>
    ipcRenderer.invoke('conversation:acceptSummaryImport', { characterId, sourcePlayerId }),
  declineSummaryImport: (characterId: number, sourcePlayerId: string): Promise<{success: boolean, error?: string}> =>
    ipcRenderer.invoke('conversation:declineSummaryImport', { characterId, sourcePlayerId }),
  openSummaryFile: (filePath: string): Promise<{success: boolean, error?: string}> =>
    ipcRenderer.invoke('conversation:openSummaryFile', { filePath }),
  getActiveConversationData: (): Promise<any> =>
    ipcRenderer.invoke('conversation:getActiveConversationData'),
  getPromptPreview: (characterId: number): Promise<any> =>
    ipcRenderer.invoke('conversation:getPromptPreview', { characterId }),
  openSummariesFolder: (): Promise<{success: boolean, error?: string}> =>
    ipcRenderer.invoke('conversation:openSummariesFolder'),
  clearSummaries: (): Promise<{success: boolean, error?: string}> =>
    ipcRenderer.invoke('conversation:clearSummaries'),
  approveActions: (approvalEntryId: number): Promise<void> =>
    ipcRenderer.invoke('conversation:approveActions', { approvalEntryId }),
  declineActions: (approvalEntryId: number): Promise<void> =>
    ipcRenderer.invoke('conversation:declineActions', { approvalEntryId }),
  // Summaries manager methods
  listAllSummaries: (): Promise<any[]> =>
    ipcRenderer.invoke('conversation:listAllSummaries'),
  getSummariesForCharacter: (playerId: string, characterId: string): Promise<any[]> =>
    ipcRenderer.invoke('conversation:getSummariesForCharacter', { playerId, characterId }),
  updateSummary: (playerId: string, characterId: string, summaryIndex: number, newContent: string): Promise<{success: boolean, error?: string}> =>
    ipcRenderer.invoke('conversation:updateSummary', { playerId, characterId, summaryIndex, newContent }),
  deleteSummary: (playerId: string, characterId: string, summaryIndex: number): Promise<{success: boolean, error?: string}> =>
    ipcRenderer.invoke('conversation:deleteSummary', { playerId, characterId, summaryIndex }),
  deleteCharacterSummaries: (playerId: string, characterId: string): Promise<{success: boolean, error?: string}> =>
    ipcRenderer.invoke('conversation:deleteCharacterSummaries', { playerId, characterId }),
 });
 
 // voice-mode fork: TTS settings, service control, and playback events
contextBridge.exposeInMainWorld('voiceAPI', {
  getSettings: (): Promise<any> => ipcRenderer.invoke('voice:getSettings'),
  saveSettings: (patch: any): Promise<any> => ipcRenderer.invoke('voice:saveSettings', patch),
  getStatus: (): Promise<any> => ipcRenderer.invoke('voice:getStatus'),
  startService: (): Promise<void> => ipcRenderer.invoke('voice:startService'),
  restartService: (): Promise<void> => ipcRenderer.invoke('voice:restartService'),
  reloadLibrary: (): Promise<{ success: boolean; voices?: number; error?: string }> =>
    ipcRenderer.invoke('voice:reloadLibrary'),
  openVoicesFolder: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('voice:openVoicesFolder'),
  speakTestLine: (voiceId?: string): Promise<void> => ipcRenderer.invoke('voice:speakTestLine', voiceId),
  // Library Curator
  pickClips: (): Promise<string[]> => ipcRenderer.invoke('voice:pickClips'),
  listVoices: (): Promise<any[]> => ipcRenderer.invoke('voice:listVoices'),
  curatorAnalyze: (sourcePath: string): Promise<any> => ipcRenderer.invoke('voice:curatorAnalyze', sourcePath),
  curatorSave: (payload: any): Promise<any> => ipcRenderer.invoke('voice:curatorSave', payload),
  curatorUpdate: (payload: any): Promise<any> => ipcRenderer.invoke('voice:curatorUpdate', payload),
  curatorRename: (oldId: string, newId: string): Promise<any> => ipcRenderer.invoke('voice:curatorRename', oldId, newId),
  curatorDelete: (voiceId: string): Promise<any> => ipcRenderer.invoke('voice:curatorDelete', voiceId),
  curatorRetranscribe: (voiceId: string): Promise<any> => ipcRenderer.invoke('voice:curatorRetranscribe', voiceId),
  getAudio: (kind: 'voice' | 'temp', ident: string): Promise<any> => ipcRenderer.invoke('voice:getAudio', kind, ident),
  clearQueue: (): Promise<void> => ipcRenderer.invoke('voice:clearQueue'),
  playbackCommand: (cmd: 'stop' | 'skip'): Promise<void> => ipcRenderer.invoke('voice:playbackCommand', cmd),
  onStatus: (callback: (status: any) => void) => {
    const handler = (_event: any, status: any) => callback(status);
    ipcRenderer.on('voice:status', handler);
    return () => ipcRenderer.removeListener('voice:status', handler);
  },
  onEnqueue: (callback: (utterance: any) => void) => {
    const handler = (_event: any, utterance: any) => callback(utterance);
    ipcRenderer.on('voice:enqueue', handler);
    return () => ipcRenderer.removeListener('voice:enqueue', handler);
  },
  onClear: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('voice:clear', handler);
    return () => ipcRenderer.removeListener('voice:clear', handler);
  },
  onCommand: (callback: (cmd: 'stop' | 'skip') => void) => {
    const handler = (_event: any, cmd: 'stop' | 'skip') => callback(cmd);
    ipcRenderer.on('voice:command', handler);
    return () => ipcRenderer.removeListener('voice:command', handler);
  },
});

// Actions API exposed to renderer
 // Appends to existing preload bridges

 contextBridge.exposeInMainWorld('actionsAPI', {
   reload: (): Promise<{ success: boolean; error?: string }> =>
     ipcRenderer.invoke('actions:reload'),
   getAll: (): Promise<Array<{
     id: string;
     title: string;
     scope: 'standard' | 'custom';
     filePath: string;
     validation: { valid: boolean; message?: string };
     disabled: boolean;
     isDestructive: boolean;
     hasDestructiveOverride: boolean;
   }>> => ipcRenderer.invoke('actions:getAll'),
   setDisabled: (actionId: string, disabled: boolean): Promise<{ success: boolean; error?: string }> =>
     ipcRenderer.invoke('actions:setDisabled', { actionId, disabled }),
   setDestructiveOverride: (actionId: string, isDestructive: boolean | null): Promise<{ success: boolean; error?: string }> =>
     ipcRenderer.invoke('actions:setDestructiveOverride', { actionId, isDestructive }),
   getSettings: (): Promise<{ disabledActions: string[]; validation: Record<string, { valid: boolean; message?: string }> }> =>
     ipcRenderer.invoke('actions:getSettings'),
   openFolder: (): Promise<void> =>
     ipcRenderer.invoke('actions:openFolder'),
   openFile: (filePath: string): Promise<{ success: boolean; error?: string }> =>
     ipcRenderer.invoke('actions:openFile', { filePath }),
   getDetails: (actionId: string, sourceCharacterId: number): Promise<{
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
   }> => ipcRenderer.invoke('actions:getDetails', { actionId, sourceCharacterId }),
   execute: (params: { actionId: string; sourceCharacterId: number; targetCharacterId?: number | null; args: Record<string, any> }): Promise<{
     actionId: string;
     success: boolean;
     feedback?: { message: string; sentiment: 'positive' | 'negative' | 'neutral' };
     error?: string;
   }> => ipcRenderer.invoke('actions:execute', params),
 });
