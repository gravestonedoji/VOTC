import { app, dialog, ipcMain, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { settingsRepository } from '../SettingsRepository';
import { VoiceSettings } from '../llmProviders/types';
import { VOTC_DATA_DIR } from '../utils/paths';
import { ttsService } from './TTSService';
import { voiceManager } from './VoiceManager';
import { voiceAssigner } from './VoiceAssigner';

/** All voice-mode IPC endpoints, registered with one call from main.ts. */
export function registerVoiceIpcHandlers(): void {
    ipcMain.handle('voice:getSettings', () => settingsRepository.getVoiceSettings());

    ipcMain.handle('voice:saveSettings', (_, patch: Partial<VoiceSettings>) => {
        try {
            settingsRepository.saveVoiceSettings(patch);
        } catch (err) {
            console.error('[voice] saving settings failed:', err);
        }
        if (patch.enabled === false) {
            voiceManager.clearQueue(); // master OFF: stop speaking immediately
        }
        // Always return the store's actual state so the UI can't drift from reality.
        return settingsRepository.getVoiceSettings();
    });

    ipcMain.handle('voice:getStatus', () => ttsService.getStatus());

    ipcMain.handle('voice:startService', () => {
        ttsService.start(settingsRepository.getVoiceSettings().servicePort);
    });

    ipcMain.handle('voice:restartService', () => {
        ttsService.restart(settingsRepository.getVoiceSettings().servicePort);
    });

    ipcMain.handle('voice:reloadLibrary', async () => {
        try {
            return { success: true, voices: await ttsService.reloadLibrary() };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    });

    ipcMain.handle('voice:openVoicesFolder', async () => {
        try {
            const voicesDir = path.join(VOTC_DATA_DIR, 'voices');
            fs.mkdirSync(voicesDir, { recursive: true });
            const error = await shell.openPath(voicesDir);
            return { success: !error, error: error || undefined };
        } catch (err) {
            return { success: false, error: (err as Error).message };
        }
    });

    ipcMain.handle('voice:speakTestLine', (_, voiceId?: string) => voiceManager.speakTestLine(voiceId));
    ipcMain.handle('voice:clearQueue', () => voiceManager.clearQueue());
    ipcMain.handle('voice:playbackCommand', (_, cmd: 'stop' | 'skip') => voiceManager.playbackCommand(cmd));

    // ---- Library Curator ----

    ipcMain.handle('voice:pickClips', async () => {
        const result = await dialog.showOpenDialog({
            title: 'Choose voice clips to import',
            defaultPath: path.join(app.getAppPath(), 'voice-clips'),
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: 'Audio and video', extensions: ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'opus', 'aac', 'wma', 'mp4', 'mkv', 'webm', 'mov'] },
                { name: 'All files', extensions: ['*'] },
            ],
        });
        return result.canceled ? [] : result.filePaths;
    });

    ipcMain.handle('voice:listVoices', () => ttsService.listVoices());

    // Each curator call returns {success, data|error} so the UI can show
    // the service's plain-language message instead of a stack trace.
    const curatorCall = <T>(fn: () => Promise<T>) =>
        fn().then((data) => ({ success: true as const, data }))
            .catch((err: Error) => ({ success: false as const, error: err.message }));

    ipcMain.handle('voice:curatorAnalyze', (_, sourcePath: string) =>
        curatorCall(() => ttsService.curatorPost('/curator/analyze', { source_path: sourcePath })));
    ipcMain.handle('voice:curatorSave', (_, payload: unknown) =>
        curatorCall(() => ttsService.curatorPost('/curator/save', payload)));
    ipcMain.handle('voice:curatorUpdate', (_, payload: unknown) =>
        curatorCall(() => ttsService.curatorPost('/curator/update', payload)));
    ipcMain.handle('voice:curatorRename', (_, oldId: string, newId: string) =>
        curatorCall(() => ttsService.curatorPost('/curator/rename', { old_id: oldId, new_id: newId })));
    ipcMain.handle('voice:curatorDelete', (_, voiceId: string) =>
        curatorCall(() => ttsService.curatorPost('/curator/delete', { voice_id: voiceId })));
    ipcMain.handle('voice:curatorRetranscribe', (_, voiceId: string) =>
        curatorCall(() => ttsService.curatorPost('/curator/retranscribe', { voice_id: voiceId })));
    ipcMain.handle('voice:getAudio', (_, kind: 'voice' | 'temp', ident: string) =>
        curatorCall(async () => (await ttsService.fetchAudio(kind, ident)).toString('base64')));

    // ---- Assignment engine ----

    ipcMain.handle('voice:getAssignmentInfo', () => voiceAssigner.getInfo());
    ipcMain.handle('voice:setOverride', (_, characterId: number, voiceId: string | null) =>
        voiceAssigner.setOverride(characterId, voiceId));
    ipcMain.handle('voice:reloadMapping', () => voiceAssigner.reloadMapping());
    ipcMain.handle('voice:openMappingFile', async () => {
        const error = await shell.openPath(voiceAssigner.getMappingPath());
        return { success: !error, error: error || undefined };
    });

    console.log('Voice IPC handlers registered successfully');
}
