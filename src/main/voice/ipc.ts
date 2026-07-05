import { ipcMain, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { settingsRepository } from '../SettingsRepository';
import { VoiceSettings } from '../llmProviders/types';
import { VOTC_DATA_DIR } from '../utils/paths';
import { ttsService } from './TTSService';
import { voiceManager } from './VoiceManager';

/** All voice-mode IPC endpoints, registered with one call from main.ts. */
export function registerVoiceIpcHandlers(): void {
    ipcMain.handle('voice:getSettings', () => settingsRepository.getVoiceSettings());

    ipcMain.handle('voice:saveSettings', (_, patch: Partial<VoiceSettings>) => {
        settingsRepository.saveVoiceSettings(patch);
        if (patch.enabled === false) {
            voiceManager.clearQueue(); // master OFF: stop speaking immediately
        }
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
        const voicesDir = path.join(VOTC_DATA_DIR, 'voices');
        fs.mkdirSync(voicesDir, { recursive: true });
        const error = await shell.openPath(voicesDir);
        return { success: !error, error: error || undefined };
    });

    ipcMain.handle('voice:speakTestLine', () => voiceManager.speakTestLine());
    ipcMain.handle('voice:clearQueue', () => voiceManager.clearQueue());
    ipcMain.handle('voice:playbackCommand', (_, cmd: 'stop' | 'skip') => voiceManager.playbackCommand(cmd));

    console.log('Voice IPC handlers registered successfully');
}
