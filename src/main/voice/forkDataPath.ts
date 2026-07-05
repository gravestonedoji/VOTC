import { app } from 'electron';
import path from 'path';

// This fork must never share user data with the installed VOTC app.
// The installed app resolves userData to %APPDATA%\VOTC (from productName);
// we redirect to a sibling folder before any other module reads a path.
// This module must stay the FIRST import in main.ts — settingsRepository,
// initLogger and the VOTC_*_DIR constants all resolve paths at import time.
const FORK_DATA_DIR_NAME = 'VOTC-Voice';

app.setPath('userData', path.join(app.getPath('appData'), FORK_DATA_DIR_NAME));
