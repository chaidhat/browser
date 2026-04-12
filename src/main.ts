import { app, BrowserWindow, ipcMain, Menu, nativeTheme, dialog, shell, session, desktopCapturer, systemPreferences } from 'electron';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { consultModelToolSpec, consultOpenclawToolSpec, searchToolSpec, bashToolSpec, thinkingToolSpec, readDiscordToolSpec, readEmailToolSpec, rememberToolSpec, type CustomToolSpec } from './customTools';

app.name = 'Pause';
// Theme is applied after settings are loaded (see app.whenReady)

if (app.isPackaged) {
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
}

interface EmailAccount {
  id: string;
  label: string;
  email: string;
  imap: { host: string; port: number; security: 'tls' | 'starttls' | 'none'; username: string; password: string };
  smtp: { host: string; port: number; security: 'tls' | 'starttls' | 'none'; username: string; password: string };
}

interface Settings {
  openaiKey: string;
  anthropicKey: string;
  googleKey: string;
  braveKey: string;
  serperKey: string;
  openclawUrl: string;
  openclawToken: string;
  openclawSetupScript: string;
  emailAccounts: EmailAccount[];
  discordBotToken: string;
  discordChannelIds: string;
  font: 'geist' | 'pt-serif';
  theme: 'light' | 'sunset' | 'dark' | 'system';
  selfPrompt: string;
  memories: string;
}

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const tabsPath = path.join(app.getPath('userData'), 'tabs.json');
const historyPath = path.join(app.getPath('userData'), 'history.json');
const messagesDbPath = path.join(app.getPath('userData'), 'messages.db');
const cursorsPath = path.join(app.getPath('userData'), 'message-cursors.json');
const notesDir = path.join(app.getPath('userData'), 'notes');

// SQLite messages database (sql.js — pure JS, no native module)
let _sqlJsDb: any = null;
let _sqlJsDirty = false;

async function getMessagesDb(): Promise<any> {
  if (_sqlJsDb) return _sqlJsDb;
  const initSqlJs = require('sql.js/dist/sql-asm.js');
  const SQL = await initSqlJs();
  try {
    const buffer = fs.readFileSync(messagesDbPath);
    _sqlJsDb = new SQL.Database(new Uint8Array(buffer));
  } catch {
    _sqlJsDb = new SQL.Database();
  }
  _sqlJsDb.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      time INTEGER NOT NULL,
      email_subject TEXT,
      email_from TEXT,
      email_preview TEXT,
      email_seq INTEGER,
      email_uid INTEGER,
      discord_author TEXT,
      discord_content TEXT,
      discord_attachments INTEGER DEFAULT 0,
      date_str TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(time);
    CREATE INDEX IF NOT EXISTS idx_messages_source ON messages(source);

    CREATE TABLE IF NOT EXISTS email_bodies (
      uid INTEGER PRIMARY KEY,
      subject TEXT,
      sender TEXT,
      recipient TEXT,
      date_str TEXT,
      body TEXT,
      html TEXT,
      fetched_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS custom_messages (
      id TEXT PRIMARY KEY,
      time INTEGER NOT NULL,
      subject TEXT,
      sender TEXT,
      body TEXT
    );

    CREATE TABLE IF NOT EXISTS discord_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL
    );
  `);
  // Migration: add status and workspace_num columns to messages
  try { _sqlJsDb.exec("ALTER TABLE messages ADD COLUMN status TEXT DEFAULT 'UNREAD'"); } catch {}
  try { _sqlJsDb.exec("ALTER TABLE messages ADD COLUMN workspace_num INTEGER"); } catch {}
  try { _sqlJsDb.exec("ALTER TABLE messages ADD COLUMN summary TEXT"); } catch {}
  try { _sqlJsDb.exec("CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status)"); } catch {}
  try { _sqlJsDb.exec("ALTER TABLE messages ADD COLUMN message_id TEXT"); } catch {}
  return _sqlJsDb;
}

// Save Discord user ID→username mappings and resolve mentions in text
async function saveDiscordUsers(users: Map<string, string>) {
  if (users.size === 0) return;
  const db = await getMessagesDb();
  for (const [id, username] of users) {
    db.run('INSERT OR REPLACE INTO discord_users (id, username) VALUES (?, ?)', [id, username]);
  }
  scheduleDbSave();
}

async function fetchDiscordUser(userId: string): Promise<string | null> {
  const s = loadSettings();
  const token = s.discordBotToken?.trim();
  if (!token) return null;
  try {
    const res = await fetch(`https://discord.com/api/v10/users/${userId}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    if (user.username) {
      const db = await getMessagesDb();
      db.run('INSERT OR REPLACE INTO discord_users (id, username) VALUES (?, ?)', [userId, user.username]);
      scheduleDbSave();
      return user.username;
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveDiscordMentions(text: string): Promise<string> {
  const mentionPattern = /<@!?(\d+)>/g;
  if (!mentionPattern.test(text)) return text;
  const db = await getMessagesDb();
  // Collect all unique IDs first
  const ids = new Set<string>();
  text.replace(/<@!?(\d+)>/g, (_, id) => { ids.add(id); return ''; });
  // Resolve unknown IDs from Discord API
  for (const id of ids) {
    const row = dbGet(db, 'SELECT username FROM discord_users WHERE id = ?', [id]);
    if (!row) {
      await fetchDiscordUser(id);
    }
  }
  // Now replace all mentions
  return text.replace(/<@!?(\d+)>/g, (_, id) => {
    const row = dbGet(db, 'SELECT username FROM discord_users WHERE id = ?', [id]);
    return row ? `@${row.username}` : `@unknown(${id})`;
  });
}

function saveDbToDisk() {
  if (!_sqlJsDb) return;
  const data = _sqlJsDb.export();
  fs.writeFileSync(messagesDbPath, Buffer.from(data));
  _sqlJsDirty = false;
}

// Debounced save — write to disk at most every 2 seconds
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleDbSave() {
  _sqlJsDirty = true;
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    if (_sqlJsDirty) saveDbToDisk();
  }, 2000);
}

function saveCursors(cursors: { emailOldestSeq?: number | null; discordOldestId?: string | null; nextWorkspaceNum?: number }) {
  fs.writeFileSync(cursorsPath, JSON.stringify(cursors));
}

function loadCursors(): { emailOldestSeq?: number | null; discordOldestId?: string | null; nextWorkspaceNum?: number } {
  try {
    return JSON.parse(fs.readFileSync(cursorsPath, 'utf-8'));
  } catch {
    return {};
  }
}

const settingsDefaults: Settings = { openaiKey: '', anthropicKey: '', googleKey: '', braveKey: '', serperKey: '', openclawUrl: 'http://localhost:28789', openclawToken: '740c59dae82325593b9ecc4672662f163f6e15f5e027bb4f', openclawSetupScript: 'lsof -ti :28789 | xargs kill -9 2>/dev/null; sleep 1; ssh -i /Users/chai/conductor/workspaces/browser/bordeaux/.context/attachments/chai-server-key.pem -L 28789:localhost:18789 -N -f -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 ubuntu@54.254.27.39', emailAccounts: [], discordBotToken: '', discordChannelIds: '', font: 'pt-serif', theme: 'system', selfPrompt: '', memories: '' };

function applyTheme(theme: Settings['theme']): void {
  // 'sunset' is treated as dark at the OS level; the renderer handles the warm tint
  nativeTheme.themeSource = theme === 'sunset' ? 'dark' : theme;
}

function loadSettings(): Settings {
  try {
    const data = fs.readFileSync(settingsPath, 'utf-8');
    return { ...settingsDefaults, ...JSON.parse(data) };
  } catch {
    return { ...settingsDefaults };
  }
}

function saveSettings(settings: Settings): void {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 720,
    height: 520,
    resizable: false,
    minimizable: false,
    maximizable: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    transparent: true,
    vibrancy: 'sidebar',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    parent: mainWindow || undefined,
  });

  const indexPath = path.join(__dirname, '..', 'ui', 'index.html');
  settingsWindow.loadFile(indexPath, { query: { settings: '1' } });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
    // Notify main window to reload settings (e.g. font change)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('settings-changed');
    }
  });
}

function updateAppIcon(): void {
  if (process.platform !== 'darwin' || !mainWindow) return;
  const icnsName = 'icon_dark.icns';
  const icnsPath = app.isPackaged
    ? path.join(process.resourcesPath, icnsName)
    : path.join(__dirname, '..', 'icon', icnsName);
  console.log('Setting icon:', icnsPath, 'exists:', fs.existsSync(icnsPath));
  if (fs.existsSync(icnsPath)) {
    mainWindow.setIcon(icnsPath);
    app.dock?.setIcon(icnsPath);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    transparent: true,
    vibrancy: 'sidebar',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));

  // Set dock icon based on theme and update when it changes
  updateAppIcon();
  nativeTheme.on('updated', updateAppIcon);

  // Intercept Cmd+T and Cmd+F from the main window itself (e.g., when focus is in a text input)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.meta && input.type === 'keyDown') {
      if (input.key === 't' && !input.alt || input.key === 'f') {
        event.preventDefault();
        mainWindow?.webContents.send('shortcut-from-webview', input.key, false);
      } else if (input.alt && (input.key === 't' || input.key === '†' || input.key === 'ArrowUp' || input.key === 'ArrowDown')) {
        event.preventDefault();
        mainWindow?.webContents.send('shortcut-from-webview', input.key, true);
      }
    }
  });

  // Allow all permission requests from webviews (camera, mic, notifications, WebAuthn/passkeys, etc.)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    // Always grant at the Electron level — macOS will enforce its own camera/mic/screen prompts
    if (permission === 'media') {
      // Trigger macOS permission dialogs (fire-and-forget; macOS caches the result)
      systemPreferences.askForMediaAccess('camera').catch(() => {});
      systemPreferences.askForMediaAccess('microphone').catch(() => {});
    }
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return true;
  });

  // Handle screen sharing requests — show native macOS source picker
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    // Auto-select the first screen source (entire screen)
    if (sources.length > 0) {
      callback({ video: sources[0] });
    } else {
      callback({});
    }
  });

  // Track webview webContents by ID for find-in-page
  const webviewContentsMap = new Map<number, Electron.WebContents>();

  // Handle new windows opened by webview guests (target="_blank" links, window.open)
  mainWindow.webContents.on('did-attach-webview', (_event, webContents) => {
    const id = webContents.id;
    webviewContentsMap.set(id, webContents);
    webContents.on('destroyed', () => {
      webviewContentsMap.delete(id);
    });

    // Handle HTTP Basic/Digest authentication (e.g., password-protected university pages)
    webContents.on('login', (event, _authenticationResponseDetails, _authInfo, callback) => {
      event.preventDefault();
      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      const loginWin = new BrowserWindow({
        width: 380,
        height: 220,
        parent: win || undefined,
        modal: true,
        show: false,
        resizable: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
        },
      });
      loginWin.removeMenu();
      const html = `<!DOCTYPE html><html><head><style>
        body{font-family:-apple-system,system-ui,sans-serif;padding:20px;background:#f5f5f5}
        h3{margin:0 0 12px}input{width:100%;padding:6px 8px;margin:4px 0 10px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px}
        .btns{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
        button{padding:6px 16px;border-radius:4px;border:1px solid #ccc;cursor:pointer}
        button.primary{background:#007AFF;color:#fff;border:none}
      </style></head><body>
        <h3>Sign In</h3>
        <label>Username</label><input id="u" autofocus>
        <label>Password</label><input id="p" type="password">
        <div class="btns"><button onclick="require('electron').ipcRenderer.send('login-cancel')">Cancel</button>
        <button class="primary" onclick="require('electron').ipcRenderer.send('login-submit',document.getElementById('u').value,document.getElementById('p').value)">Log In</button></div>
        <script>document.getElementById('p').addEventListener('keydown',e=>{if(e.key==='Enter')document.querySelector('.primary').click()})</script>
      </body></html>`;
      loginWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      loginWin.once('ready-to-show', () => loginWin.show());

      const onSubmit = (_e: any, username: string, password: string) => {
        callback(username, password);
        cleanup();
        loginWin.close();
      };
      const onCancel = () => {
        callback();
        cleanup();
        loginWin.close();
      };
      const cleanup = () => {
        ipcMain.removeListener('login-submit', onSubmit);
        ipcMain.removeListener('login-cancel', onCancel);
      };
      ipcMain.once('login-submit', onSubmit);
      ipcMain.once('login-cancel', onCancel);
      loginWin.on('closed', () => {
        cleanup();
      });
    });
    // Popup handling is done globally via app.on('web-contents-created')

    // Enable pinch-to-zoom on webview content
    webContents.setVisualZoomLevelLimits(1, 5);

    // Intercept Cmd+T and Cmd+F from webview so the app always handles them
    webContents.on('before-input-event', (event, input) => {
      if (input.meta && input.type === 'keyDown') {
        if (input.key === 't' && !input.alt || input.key === 'f') {
          event.preventDefault();
          mainWindow?.webContents.send('shortcut-from-webview', input.key, false);
        } else if (input.alt && (input.key === 't' || input.key === '†' || input.key === 'ArrowUp' || input.key === 'ArrowDown')) {
          event.preventDefault();
          mainWindow?.webContents.send('shortcut-from-webview', input.key, true);
        }
      }
    });

  });

  // Handle downloads — register once on the default session to avoid listener leaks
  session.defaultSession.on('will-download', (_dlEvent, item) => {
    const fileName = item.getFilename();
    const totalBytes = item.getTotalBytes();
    const downloadId = Date.now().toString();
    const savePath = path.join(app.getPath('downloads'), fileName);
    item.setSavePath(savePath);

    mainWindow?.webContents.send('download-started', {
      id: downloadId,
      fileName,
      totalBytes,
      savePath,
    });

    item.on('updated', (_updEvent, state) => {
      if (state === 'progressing') {
        mainWindow?.webContents.send('download-progress', {
          id: downloadId,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
        });
      }
    });

    item.once('done', (_doneEvent, state) => {
      mainWindow?.webContents.send('download-done', {
        id: downloadId,
        state, // 'completed', 'cancelled', 'interrupted'
        savePath: item.getSavePath(),
      });
    });
  });
}

// Navigation IPC — forward to webview via renderer
ipcMain.on('webview-navigate', (_event, url: string) => {
  // handled in renderer directly
});

// Settings IPC
ipcMain.handle('get-settings', () => {
  return loadSettings();
});

ipcMain.handle('save-settings', (_event, settings: Settings) => {
  saveSettings(settings);
  applyTheme(settings.theme);
  return true;
});

ipcMain.handle('set-theme', (_event, theme: Settings['theme']) => {
  applyTheme(theme);
  return true;
});

ipcMain.handle('open-settings', () => {
  openSettingsWindow();
  return true;
});

ipcMain.handle('close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && win !== mainWindow) win.close();
  return true;
});

ipcMain.handle('clear-site-data', async (_event, origin: string) => {
  const ses = session.defaultSession;
  await ses.clearStorageData({ origin, storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'] });
  await ses.clearCache();
  return true;
});

// Test IMAP connection
ipcMain.handle('test-imap', async (_event, account: EmailAccount) => {
  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.security === 'tls',
    auth: {
      user: account.imap.username,
      pass: account.imap.password,
    },
    logger: false,
    tls: account.imap.security === 'starttls' ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const messageCount = client.mailbox?.exists || 0;
      const sample: { subject: string; from: string }[] = [];
      if (messageCount > 0) {
        const startSeq = Math.max(1, messageCount - 4);
        for await (const msg of client.fetch(`${startSeq}:*`, { envelope: true })) {
          sample.push({
            subject: msg.envelope.subject || '(no subject)',
            from: msg.envelope.from?.[0]?.address || 'unknown',
          });
        }
      }
      return { success: true, messageCount, sample };
    } finally {
      lock.release();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
});

// Direct email/discord fetch IPC (for dedicated tabs)
ipcMain.handle('read-email', async (_event, opts?: { accountLabel?: string; limit?: number; beforeSeq?: number }) => {
  const s = loadSettings();
  if (!s.emailAccounts || s.emailAccounts.length === 0) return { error: 'No email accounts configured. Open Settings > Email to add one.' };
  const account = opts?.accountLabel
    ? s.emailAccounts.find((a: EmailAccount) => a.label.toLowerCase() === opts.accountLabel!.toLowerCase() || a.email.toLowerCase() === opts.accountLabel!.toLowerCase())
    : s.emailAccounts[0];
  if (!account) return { error: `Email account "${opts?.accountLabel}" not found.` };
  if (!account.imap.host || !account.imap.username) return { error: `IMAP not configured for ${account.label || account.email}. Open Settings > Email.` };

  const count = Math.min(opts?.limit || 20, 50);
  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.security === 'tls',
    auth: { user: account.imap.username, pass: account.imap.password },
    logger: false,
    tls: account.imap.security === 'starttls' ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const messageCount = client.mailbox?.exists || 0;
      if (messageCount === 0) return { account: account.label || account.email, messageCount: 0, messages: [] };

      const upperBound = opts?.beforeSeq ? opts.beforeSeq - 1 : messageCount;
      if (upperBound < 1) return { account: account.label || account.email, messageCount, messages: [] };
      const startSeq = Math.max(1, upperBound - count + 1);

      const messages: { subject: string; from: string; date: string; preview: string; seq: number; uid: number }[] = [];
      for await (const msg of client.fetch(`${startSeq}:${upperBound}`, { envelope: true, bodyStructure: true, source: { maxLength: 2000 }, uid: true })) {
        const bodyText = msg.source ? msg.source.toString().replace(/[\r\n]+/g, ' ').slice(0, 200) : '';
        messages.push({
          subject: msg.envelope.subject || '(no subject)',
          from: msg.envelope.from?.[0]?.address || 'unknown',
          date: msg.envelope.date?.toISOString?.() || '',
          preview: bodyText,
          seq: msg.seq,
          uid: msg.uid,
        });
      }
      messages.reverse();
      return { account: account.label || account.email, messageCount, messages };
    } finally {
      lock.release();
    }
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
});

ipcMain.handle('read-email-message', async (_event, opts: { uid: number; accountLabel?: string }) => {
  const s = loadSettings();
  if (!s.emailAccounts || s.emailAccounts.length === 0) return { error: 'No email accounts configured.' };
  const account = opts.accountLabel
    ? s.emailAccounts.find((a: EmailAccount) => a.label.toLowerCase() === opts.accountLabel!.toLowerCase() || a.email.toLowerCase() === opts.accountLabel!.toLowerCase())
    : s.emailAccounts[0];
  if (!account) return { error: 'Email account not found.' };

  const { ImapFlow } = require('imapflow');
  const { simpleParser } = require('mailparser');
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.security === 'tls',
    auth: { user: account.imap.username, pass: account.imap.password },
    logger: false,
    tls: account.imap.security === 'starttls' ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      let result: { subject: string; from: string; to: string; date: string; body: string; html: string } | null = null;
      for await (const msg of client.fetch(`${opts.uid}`, { envelope: true, source: true }, { uid: true })) {
        const parsed = await simpleParser(msg.source);
        result = {
          subject: msg.envelope.subject || '(no subject)',
          from: msg.envelope.from?.[0]?.address || 'unknown',
          to: msg.envelope.to?.map((a: { address?: string }) => a.address).join(', ') || '',
          date: msg.envelope.date?.toISOString?.() || '',
          body: parsed.text || '',
          html: parsed.html || '',
        };
      }
      return result || { error: 'Message not found.' };
    } finally {
      lock.release();
    }
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
});

ipcMain.handle('archive-email', async (_event, opts: { uid: number; accountLabel?: string }) => {
  const s = loadSettings();
  if (!s.emailAccounts || s.emailAccounts.length === 0) return { error: 'No email accounts configured.' };
  const account = opts.accountLabel
    ? s.emailAccounts.find((a: EmailAccount) => a.label.toLowerCase() === opts.accountLabel!.toLowerCase() || a.email.toLowerCase() === opts.accountLabel!.toLowerCase())
    : s.emailAccounts[0];
  if (!account) return { error: 'Email account not found.' };

  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.security === 'tls',
    auth: { user: account.imap.username, pass: account.imap.password },
    logger: false,
    tls: account.imap.security === 'starttls' ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // List mailboxes to find the archive folder
      const mailboxes = await client.list();
      const archiveNames = ['Archive', '[Gmail]/All Mail', 'Archives', 'ARCHIVE'];
      let archiveFolder: string | null = null;
      for (const name of archiveNames) {
        if (mailboxes.some((mb: { path: string }) => mb.path === name)) {
          archiveFolder = name;
          break;
        }
      }
      if (!archiveFolder) {
        // No archive folder found — try creating one
        try {
          await client.mailboxCreate('Archive');
          archiveFolder = 'Archive';
        } catch {
          return { error: 'No archive folder found and could not create one.' };
        }
      }
      await client.messageMove(`${opts.uid}`, archiveFolder, { uid: true });
      return { success: true };
    } finally {
      lock.release();
    }
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
});

ipcMain.handle('archive-emails-bulk', async (_event, uids: number[]) => {
  if (!uids || uids.length === 0) return { success: true, archived: 0 };
  const s = loadSettings();
  if (!s.emailAccounts || s.emailAccounts.length === 0) return { error: 'No email accounts configured.' };
  const account = s.emailAccounts[0];

  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.security === 'tls',
    auth: { user: account.imap.username, pass: account.imap.password },
    logger: false,
    tls: account.imap.security === 'starttls' ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const mailboxes = await client.list();
      const archiveNames = ['Archive', '[Gmail]/All Mail', 'Archives', 'ARCHIVE'];
      let archiveFolder: string | null = null;
      for (const name of archiveNames) {
        if (mailboxes.some((mb: { path: string }) => mb.path === name)) {
          archiveFolder = name;
          break;
        }
      }
      if (!archiveFolder) {
        try {
          await client.mailboxCreate('Archive');
          archiveFolder = 'Archive';
        } catch {
          return { error: 'No archive folder found and could not create one.' };
        }
      }
      const uidSet = uids.join(',');
      await client.messageMove(uidSet, archiveFolder, { uid: true });
      return { success: true, archived: uids.length };
    } finally {
      lock.release();
    }
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
});

ipcMain.handle('read-discord', async (_event, opts?: { channelId?: string; limit?: number; before?: string }) => {
  const s = loadSettings();
  const token = s.discordBotToken?.trim();
  if (!token) return { error: 'No Discord bot token configured. Open Settings > Discord to add one.' };
  const channelIds = s.discordChannelIds.split('\n').map((id: string) => id.trim()).filter(Boolean);
  const targetChannel = opts?.channelId?.trim() || channelIds[0];
  if (!targetChannel) return { error: 'No channel ID provided and none configured in Settings > Discord.' };

  const count = Math.min(opts?.limit || 25, 50);
  let url = `https://discord.com/api/v10/channels/${targetChannel}/messages?limit=${count}`;
  if (opts?.before) url += `&before=${opts.before}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: `Discord API returned ${res.status} ${res.statusText}${body ? ': ' + body : ''}` };
    }
    const messages = await res.json();
    const userMap = new Map<string, string>();
    for (const m of messages) {
      if (m.author?.id) userMap.set(m.author.id, m.author.username);
      if (m.mentions) for (const u of m.mentions) { if (u.id) userMap.set(u.id, u.username); }
    }
    saveDiscordUsers(userMap).catch(() => {});
    const resolveMentions = (text: string) => text.replace(/<@!?(\d+)>/g, (_, id) => {
      const name = userMap.get(id);
      return name ? `@${name}` : `@unknown(${id})`;
    });
    const formatted = messages.map((m: { id: string; author: { username: string }; content: string; timestamp: string; attachments?: { url: string }[]; mentions?: { id: string; username: string }[] }) => ({
      id: m.id,
      author: m.author.username,
      content: resolveMentions(m.content || '(no text)'),
      time: m.timestamp,
      attachments: m.attachments?.length || 0,
    }));
    return { channelId: targetChannel, messages: formatted, availableChannels: channelIds };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

// IMAP IDLE — persistent connection for real-time email notifications
let imapIdleClient: any = null;
let imapIdleReconnectTimer: ReturnType<typeof setTimeout> | null = null;

async function startImapIdle() {
  stopImapIdle();
  const s = loadSettings();
  if (!s.emailAccounts || s.emailAccounts.length === 0) return;
  const account = s.emailAccounts[0];
  if (!account.imap.host || !account.imap.username) return;

  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.security === 'tls',
    auth: { user: account.imap.username, pass: account.imap.password },
    logger: false,
    tls: account.imap.security === 'starttls' ? { rejectUnauthorized: false } : undefined,
    emitLogs: false,
  });

  try {
    await client.connect();
    imapIdleClient = client;
    const lock = await client.getMailboxLock('INBOX');

    // UID reconciliation on connect — sync local DB with server state
    try {
      const serverUids: number[] = [];
      const searchResult = await client.search({ all: true });
      if (searchResult && searchResult.length > 0) {
        // searchResult is sequence numbers; fetch UIDs for all
        for await (const msg of client.fetch('1:*', { uid: true })) {
          serverUids.push(msg.uid);
        }
      }

      if (serverUids.length > 0) {
        const db = await getMessagesDb();
        // Get all email UIDs in our local DB
        const localRows = dbAll(db, "SELECT email_uid FROM messages WHERE source = 'email' AND email_uid IS NOT NULL");
        const localUids = new Set(localRows.map((r: any) => r.email_uid));
        const serverUidSet = new Set(serverUids);

        // UIDs in local but not on server → removed/archived elsewhere, delete from local
        const removedUids: number[] = [];
        for (const uid of localUids) {
          if (!serverUidSet.has(uid)) removedUids.push(uid);
        }
        if (removedUids.length > 0) {
          for (const uid of removedUids) {
            db.run("DELETE FROM messages WHERE id = ?", [`email:${uid}`]);
          }
          scheduleDbSave();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('emails-removed', removedUids);
          }
        }

        // UIDs on server but not local → new messages, fetch them
        const newUids = serverUids.filter(uid => !localUids.has(uid));
        if (newUids.length > 0) {
          const messages: any[] = [];
          const uidRange = newUids.join(',');
          for await (const msg of client.fetch(uidRange, { envelope: true, bodyStructure: true, source: { maxLength: 2000 }, uid: true }, { uid: true })) {
            const bodyText = msg.source ? msg.source.toString().replace(/[\r\n]+/g, ' ').slice(0, 200) : '';
            messages.push({
              subject: msg.envelope.subject || '(no subject)',
              from: msg.envelope.from?.[0]?.address || 'unknown',
              date: msg.envelope.date?.toISOString?.() || '',
              preview: bodyText,
              seq: msg.seq,
              uid: msg.uid,
            });
          }
          if (messages.length > 0) {
            for (const msg of messages) {
              const time = msg.date ? new Date(msg.date).getTime() : Date.now();
              db.run(`INSERT INTO messages (id, source, time, email_subject, email_from, email_preview, email_seq, email_uid, date_str, status)
                VALUES (?, 'email', ?, ?, ?, ?, ?, ?, ?, 'UNREAD')
                ON CONFLICT(id) DO UPDATE SET
                  time=excluded.time, email_subject=excluded.email_subject, email_from=excluded.email_from,
                  email_preview=excluded.email_preview, email_seq=excluded.email_seq, email_uid=excluded.email_uid,
                  date_str=excluded.date_str`,
                [`email:${msg.uid}`, time, msg.subject, msg.from, msg.preview, msg.seq, msg.uid, msg.date]);
            }
            scheduleDbSave();
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('new-emails', messages);
            }
          }
        }
      }
    } catch { /* reconciliation failed, not critical */ }

    // Track the current message count to detect new arrivals
    let knownCount = client.mailbox?.exists || 0;

    client.on('exists', async (newCount: number) => {
      if (newCount <= knownCount) { knownCount = newCount; return; }
      // Fetch new messages
      const startSeq = knownCount + 1;
      knownCount = newCount;
      try {
        const messages: any[] = [];
        for await (const msg of client.fetch(`${startSeq}:*`, { envelope: true, bodyStructure: true, source: { maxLength: 2000 }, uid: true })) {
          const bodyText = msg.source ? msg.source.toString().replace(/[\r\n]+/g, ' ').slice(0, 200) : '';
          messages.push({
            subject: msg.envelope.subject || '(no subject)',
            from: msg.envelope.from?.[0]?.address || 'unknown',
            date: msg.envelope.date?.toISOString?.() || '',
            preview: bodyText,
            seq: msg.seq,
            uid: msg.uid,
          });
        }
        if (messages.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('new-emails', messages);
          const db = await getMessagesDb();
          for (const msg of messages) {
            const time = msg.date ? new Date(msg.date).getTime() : Date.now();
            db.run(`INSERT INTO messages (id, source, time, email_subject, email_from, email_preview, email_seq, email_uid, date_str, status)
              VALUES (?, 'email', ?, ?, ?, ?, ?, ?, ?, 'UNREAD')
              ON CONFLICT(id) DO UPDATE SET
                time=excluded.time, email_subject=excluded.email_subject, email_from=excluded.email_from,
                email_preview=excluded.email_preview, email_seq=excluded.email_seq, email_uid=excluded.email_uid,
                date_str=excluded.date_str`,
              [`email:${msg.uid}`, time, msg.subject, msg.from, msg.preview, msg.seq, msg.uid, msg.date]);
          }
          scheduleDbSave();
        }
      } catch { /* fetch failed, will get them next sync */ }
    });

    // Handle EXPUNGE — message removed from INBOX while connected
    client.on('expunge', async (info: { seq: number }) => {
      // We can't easily map seq→uid during expunge since the seq changes.
      // Instead, do a quick reconciliation: fetch all current UIDs and diff.
      try {
        const currentUids: number[] = [];
        for await (const msg of client.fetch('1:*', { uid: true })) {
          currentUids.push(msg.uid);
        }
        const currentUidSet = new Set(currentUids);
        const db = await getMessagesDb();
        const localRows = dbAll(db, "SELECT email_uid FROM messages WHERE source = 'email' AND email_uid IS NOT NULL");
        const removedUids: number[] = [];
        for (const row of localRows) {
          if (!currentUidSet.has(row.email_uid)) removedUids.push(row.email_uid);
        }
        if (removedUids.length > 0) {
          for (const uid of removedUids) {
            db.run("DELETE FROM messages WHERE id = ?", [`email:${uid}`]);
          }
          scheduleDbSave();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('emails-removed', removedUids);
          }
        }
        knownCount = currentUids.length;
      } catch { /* reconciliation failed */ }
    });

    // Handle connection errors — suppress crash dialog and reconnect
    client.on('error', (err: any) => {
      console.error('IMAP IDLE error:', err?.code || err?.message || err);
      imapIdleClient = null;
      imapIdleReconnectTimer = setTimeout(startImapIdle, 10000);
    });

    // Handle connection close — reconnect
    client.on('close', () => {
      imapIdleClient = null;
      imapIdleReconnectTimer = setTimeout(startImapIdle, 10000);
    });

  } catch (err) {
    console.error('IMAP IDLE connect failed:', err);
    imapIdleClient = null;
    imapIdleReconnectTimer = setTimeout(startImapIdle, 30000);
  }
}

function stopImapIdle() {
  if (imapIdleReconnectTimer) { clearTimeout(imapIdleReconnectTimer); imapIdleReconnectTimer = null; }
  if (imapIdleClient) {
    try { imapIdleClient.logout(); } catch { /* ignore */ }
    imapIdleClient = null;
  }
}

// Discord polling — check for new messages every 60 seconds
let discordPollTimer: ReturnType<typeof setTimeout> | null = null;
let discordLatestId: string | null = null;

async function initDiscordLatestId() {
  try {
    const db = await getMessagesDb();
    const row = dbGet(db, "SELECT id FROM messages WHERE source = 'discord' ORDER BY time DESC LIMIT 1", []);
    if (row?.id) {
      discordLatestId = row.id.replace('discord:', '');
    }
  } catch {}
}

async function pollDiscord() {
  const s = loadSettings();
  const token = s.discordBotToken?.trim();
  if (!token) return;
  const channelIds = s.discordChannelIds.split('\n').map((id: string) => id.trim()).filter(Boolean);
  if (channelIds.length === 0) return;

  for (const channelId of channelIds) {
    try {
      let url = `https://discord.com/api/v10/channels/${channelId}/messages?limit=10`;
      const res = await fetch(url, { headers: { Authorization: `Bot ${token}` } });
      if (!res.ok) continue;
      const messages = await res.json();
      const userMap = new Map<string, string>();
      for (const m of messages) {
        if (m.author?.id) userMap.set(m.author.id, m.author.username);
        if (m.mentions) for (const u of m.mentions) { if (u.id) userMap.set(u.id, u.username); }
      }
      saveDiscordUsers(userMap).catch(() => {});
      const resolveMentions = (text: string) => text.replace(/<@!?(\d+)>/g, (_, id: string) => {
        const name = userMap.get(id);
        return name ? `@${name}` : `@unknown(${id})`;
      });
      const formatted = messages
        .filter((m: { id: string }) => !discordLatestId || m.id > discordLatestId)
        .map((m: { id: string; author: { username: string }; content: string; timestamp: string; attachments?: { url: string }[] }) => ({
          id: m.id,
          author: m.author.username,
          content: resolveMentions(m.content || '(no text)'),
          time: m.timestamp,
          attachments: m.attachments?.length || 0,
        }));
      if (formatted.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('new-discord-messages', formatted);
        // Update latest ID
        const maxId = messages.reduce((max: string, m: { id: string }) => m.id > max ? m.id : max, discordLatestId || '0');
        discordLatestId = maxId;
        // Cache in DB (preserve status and workspace_num)
        const db = await getMessagesDb();
        for (const msg of formatted) {
          const time = msg.time ? new Date(msg.time).getTime() : Date.now();
          db.run(`INSERT INTO messages (id, source, time, discord_author, discord_content, discord_attachments, date_str, status)
            VALUES (?, 'discord', ?, ?, ?, ?, ?, 'UNREAD')
            ON CONFLICT(id) DO UPDATE SET
              time=excluded.time, discord_author=excluded.discord_author,
              discord_content=excluded.discord_content, discord_attachments=excluded.discord_attachments,
              date_str=excluded.date_str`,
            [`discord:${msg.id}`, time, msg.author, msg.content, msg.attachments, msg.time]);
        }
        scheduleDbSave();
      }
      // Track the latest ID even if we didn't send to renderer
      if (messages.length > 0 && !discordLatestId) {
        discordLatestId = messages[0].id;
      }
    } catch { /* skip */ }
  }
}

function startDiscordPolling() {
  stopDiscordPolling();
  initDiscordLatestId().then(() => {
    pollDiscord();
    discordPollTimer = setInterval(pollDiscord, 60000);
  });
}

function stopDiscordPolling() {
  if (discordPollTimer) { clearInterval(discordPollTimer); discordPollTimer = null; }
}

// Start/stop listeners via IPC
ipcMain.handle('start-message-sync', async () => {
  startImapIdle();
  startDiscordPolling();
  return { success: true };
});

ipcMain.handle('stop-message-sync', () => {
  stopImapIdle();
  stopDiscordPolling();
  return { success: true };
});

// Helper: run a SELECT and return all rows as objects
function dbAll(db: any, sql: string, params: any[] = []): any[] {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Helper: run a SELECT and return first row as object, or null
function dbGet(db: any, sql: string, params: any[] = []): any | null {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

// Messages DB IPC
ipcMain.handle('db-upsert-messages', async (_event, messages: any[]) => {
  const db = await getMessagesDb();
  for (const msg of messages) {
    const messageId = msg.message_id || uuidv4();
    db.run(`INSERT INTO messages (id, source, time, email_subject, email_from, email_preview, email_seq, email_uid, discord_author, discord_content, discord_attachments, date_str, status, message_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNREAD', ?)
      ON CONFLICT(id) DO UPDATE SET
        source=excluded.source, time=excluded.time, email_subject=excluded.email_subject,
        email_from=excluded.email_from, email_preview=excluded.email_preview,
        email_seq=excluded.email_seq, email_uid=excluded.email_uid,
        discord_author=excluded.discord_author, discord_content=excluded.discord_content,
        discord_attachments=excluded.discord_attachments, date_str=excluded.date_str,
        message_id=COALESCE(messages.message_id, excluded.message_id)`,
      [msg.id, msg.source, msg.time, msg.email_subject, msg.email_from, msg.email_preview, msg.email_seq, msg.email_uid, msg.discord_author, msg.discord_content, msg.discord_attachments, msg.date_str, messageId]);
  }
  scheduleDbSave();
  return { success: true };
});

ipcMain.handle('db-get-messages', async (_event, opts?: { source?: string; beforeTime?: number; limit?: number }) => {
  const db = await getMessagesDb();
  const limit = opts?.limit || 50;
  let query = 'SELECT * FROM messages';
  const params: any[] = [];
  const conditions: string[] = [];
  if (opts?.source) { conditions.push('source = ?'); params.push(opts.source); }
  if (opts?.beforeTime) { conditions.push('time < ?'); params.push(opts.beforeTime); }
  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY time DESC LIMIT ?';
  params.push(limit);
  const rows = dbAll(db, query, params);
  // Resolve Discord mentions — fetch unknown users from API
  for (const row of rows) {
    if (row.source === 'discord' && row.discord_content && /<@!?\d+>/.test(row.discord_content)) {
      row.discord_content = await resolveDiscordMentions(row.discord_content);
    }
  }
  return rows;
});

ipcMain.handle('db-get-messages-by-ids', async (_event, messageIds: string[]) => {
  if (!messageIds.length) return [];
  const db = await getMessagesDb();
  const placeholders = messageIds.map(() => '?').join(',');
  return dbAll(db, `SELECT * FROM messages WHERE message_id IN (${placeholders})`, messageIds);
});

ipcMain.handle('db-delete-messages', async (_event, ids: string[]) => {
  if (!ids.length) return { success: true };
  const db = await getMessagesDb();
  const placeholders = ids.map(() => '?').join(',');
  db.run(`DELETE FROM messages WHERE id IN (${placeholders})`, ids);
  scheduleDbSave();
  return { success: true };
});

ipcMain.handle('db-get-email-body', async (_event, uid: number) => {
  const db = await getMessagesDb();
  return dbGet(db, 'SELECT * FROM email_bodies WHERE uid = ?', [uid]);
});

ipcMain.handle('db-save-email-body', async (_event, body: { uid: number; subject: string; sender: string; recipient: string; date_str: string; body: string; html: string }) => {
  const db = await getMessagesDb();
  db.run(`INSERT OR REPLACE INTO email_bodies (uid, subject, sender, recipient, date_str, body, html, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [body.uid, body.subject, body.sender, body.recipient, body.date_str, body.body, body.html, Date.now()]);
  scheduleDbSave();
  return { success: true };
});

ipcMain.handle('db-create-custom-message', async (_event, msg: { subject: string; sender: string; body: string }) => {
  const db = await getMessagesDb();
  const id = `custom:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const messageId = uuidv4();
  const time = Date.now();
  db.run('INSERT INTO custom_messages (id, time, subject, sender, body) VALUES (?, ?, ?, ?, ?)',
    [id, time, msg.subject, msg.sender, msg.body]);
  db.run(`INSERT INTO messages (id, source, time, email_subject, email_from, email_preview, email_seq, email_uid, discord_author, discord_content, discord_attachments, date_str, message_id)
    VALUES (?, 'custom', ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, ?, ?)`,
    [id, time, msg.subject, msg.sender, msg.body.slice(0, 200), new Date(time).toISOString(), messageId]);
  scheduleDbSave();
  return { id, messageId, time };
});

ipcMain.handle('db-get-custom-message', async (_event, id: string) => {
  const db = await getMessagesDb();
  return dbGet(db, 'SELECT * FROM custom_messages WHERE id = ?', [id]);
});

ipcMain.handle('db-save-cursors', (_event, cursors: any) => {
  const existing = loadCursors();
  saveCursors({ ...existing, ...cursors });
  return { success: true };
});

ipcMain.handle('db-load-cursors', () => {
  return loadCursors();
});

// Tabs persistence IPC
ipcMain.handle('load-tabs', () => {
  try {
    const data = fs.readFileSync(tabsPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
});

ipcMain.handle('save-tabs', (_event, data: unknown) => {
  fs.writeFileSync(tabsPath, JSON.stringify(data));
  return true;
});

// History persistence IPC
ipcMain.handle('load-history', () => {
  try {
    const data = fs.readFileSync(historyPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
});

ipcMain.handle('save-history', (_event, data: unknown) => {
  fs.writeFileSync(historyPath, JSON.stringify(data));
  return true;
});

// Show downloaded file in Finder
ipcMain.on('show-in-folder', (_event, filePath: string) => {
  shell.showItemInFolder(filePath);
});

// Find in page - route through main process for reliability
ipcMain.on('find-in-page', (event, webContentsId: number, text: string, forward: boolean) => {
  const wc = mainWindow?.webContents;
  if (!wc) return;
  // Find the webview's webContents from all attached webviews
  const allWebContents = require('electron').webContents.getAllWebContents();
  const target = allWebContents.find((c: Electron.WebContents) => c.id === webContentsId);
  if (target) {
    target.findInPage(text, { forward, findNext: true });
    // Listen for result and forward to renderer
    target.once('found-in-page', (_e: Electron.Event, result: Electron.FoundInPageResult) => {
      event.sender.send('found-in-page-result', result.activeMatchOrdinal, result.matches);
    });
  }
});

ipcMain.on('stop-find-in-page', (_event, webContentsId: number) => {
  const allWebContents = require('electron').webContents.getAllWebContents();
  const target = allWebContents.find((c: Electron.WebContents) => c.id === webContentsId);
  if (target) {
    target.stopFindInPage('clearSelection');
  }
});

// Native context menu IPC
ipcMain.handle('show-context-menu', (_event, items: { label: string; id: string }[]) => {
  return new Promise<string | null>((resolve) => {
    const menu = Menu.buildFromTemplate(
      items.map(item => ({
        label: item.label,
        click: () => resolve(item.id),
      }))
    );
    menu.popup({
      window: mainWindow || undefined,
      callback: () => resolve(null),
    });
  });
});

// Serper Search IPC
ipcMain.handle('serper-search', async (_event, query: string) => {
  const settings = loadSettings();
  if (!settings.serperKey) return null;
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': settings.serperKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: 5 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = (data.organic || []).slice(0, 5).map((r: any) => ({
      title: r.title,
      link: r.link,
      snippet: r.snippet,
    }));
    return results;
  } catch {
    return null;
  }
});

// Serper Image Search IPC
ipcMain.handle('serper-image-search', async (_event, query: string) => {
  const settings = loadSettings();
  if (!settings.serperKey) return null;
  try {
    const res = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY': settings.serperKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: 8 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.images || []).slice(0, 8).map((r: any) => ({
      title: r.title,
      imageUrl: r.imageUrl,
      link: r.link,
    }));
  } catch {
    return null;
  }
});

// OpenAI Chat IPC (using Vercel AI SDK)
import { generateObject, generateText, streamObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

interface ChatContentBlock {
  type: 'text' | 'image_url' | 'file';
  text?: string;
  image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
  file?: { url: string; mimeType: string };
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ChatContentBlock[];
}

function toSdkMessages(messages: ChatMessage[]) {
  return messages.map(m => {
    if (Array.isArray(m.content)) {
      const parts = m.content.map(block => {
        if (block.type === 'file' && block.file) {
          const url = block.file.url;
          const dataMatch = url.match(/^data:([^;]+);base64,(.+)$/s);
          if (dataMatch) {
            return { type: 'file' as const, data: dataMatch[2], mediaType: dataMatch[1] };
          }
          if (url.startsWith('data:')) {
            const commaIdx = url.indexOf(',');
            if (commaIdx !== -1) {
              return { type: 'file' as const, data: url.substring(commaIdx + 1), mediaType: block.file.mimeType };
            }
          }
          return { type: 'file' as const, data: new URL(url), mediaType: block.file.mimeType };
        }
        if (block.type === 'image_url' && block.image_url) {
          const url = block.image_url.url;
          // data: URIs need base64 extracted — SDK rejects data: scheme as URL
          const dataMatch = url.match(/^data:([^;]+);base64,(.+)$/s);
          if (dataMatch) {
            return { type: 'image' as const, image: dataMatch[2], mediaType: dataMatch[1] };
          }
          // If it's still a data: URI that didn't match, try extracting after the comma
          if (url.startsWith('data:')) {
            const commaIdx = url.indexOf(',');
            if (commaIdx !== -1) {
              const mimeMatch = url.match(/^data:([^;,]+)/);
              return { type: 'image' as const, image: url.substring(commaIdx + 1), mediaType: mimeMatch?.[1] || 'image/png' };
            }
          }
          return { type: 'image' as const, image: new URL(url) };
        }
        return { type: 'text' as const, text: block.text || '' };
      });
      return { role: m.role as 'user' | 'assistant' | 'system', content: parts };
    }
    return { role: m.role as 'user' | 'assistant' | 'system', content: m.content };
  });
}

function getModelForId(settings: Settings, modelId: string, hasFiles = false) {
  switch (modelId) {
    case 'claude-opus-4-6': {
      if (!settings.anthropicKey) return { error: 'No Anthropic API key configured. Open Settings to add one.' };
      const anthropic = createAnthropic({ apiKey: settings.anthropicKey });
      return { model: anthropic('claude-opus-4-6') };
    }
    case 'gemini-3.1-pro': {
      if (!settings.googleKey) return { error: 'No Google API key configured. Open Settings to add one.' };
      const google = createGoogleGenerativeAI({
        apiKey: settings.googleKey,
        baseURL: 'https://generativelanguage.googleapis.com/v1alpha',
      });
      return { model: google('gemini-3.1-pro-preview') };
    }
    case 'gpt-5.4': {
      if (!settings.openaiKey) return { error: 'No OpenAI API key configured. Open Settings to add one.' };
      const openai = createOpenAI({ apiKey: settings.openaiKey });
      if (hasFiles) {
        return { model: openai.chat('gpt-5.4'), isOpenAI: true, isChatCompletions: true };
      }
      return { model: openai.responses('gpt-5.4'), isOpenAI: true };
    }
    case 'gpt-5.4-mini':
    default: {
      if (!settings.openaiKey) return { error: 'No OpenAI API key configured. Open Settings to add one.' };
      const openai = createOpenAI({ apiKey: settings.openaiKey });
      if (hasFiles) {
        return { model: openai.chat('gpt-5.4-mini'), isOpenAI: true, isChatCompletions: true };
      }
      return { model: openai.responses('gpt-5.4-mini'), isOpenAI: true };
    }
  }
}

interface CustomToolDef extends CustomToolSpec {
  inputSchema: z.ZodTypeAny;
  execute: (args: any, ctx: { messages: ChatMessage[], settings: Settings, abortSignal: AbortSignal }) => Promise<string>;
}

function buildToolCallSchema(customTools: CustomToolDef[]) {
  const schemas = customTools.map((tool) => z.object({
    name: z.literal(tool.name),
    input: tool.inputSchema,
  }));

  if (schemas.length === 0) {
    return z.object({
      name: z.string(),
      input: z.record(z.string(), z.any()),
    });
  }

  if (schemas.length === 1) {
    return schemas[0];
  }

  return z.union([schemas[0], schemas[1], ...schemas.slice(2)] as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

function buildCustomTools(settings: Settings): CustomToolDef[] {
  return [
    {
      ...searchToolSpec,
      inputSchema: z.object({
        query: z.string(),
      }),
      execute: async ({ query }, { settings: s }) => {
        if (!query || typeof query !== 'string') return 'Error: Missing query';
        if (!s.braveKey) return 'Error: No Brave Search API key configured. Open Settings to add one.';
        const trimmedQuery = query.trim();
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(trimmedQuery)}&count=5`;
        const webPromise = fetch(url, {
          headers: { 'X-Subscription-Token': s.braveKey, Accept: 'application/json' },
        }).then(async (res) => {
          if (!res.ok) return [];
          const data = await res.json();
          return (data.web?.results || []).slice(0, 5).map((r: any) => ({
            title: r.title,
            link: r.url,
            snippet: r.description,
          }));
        }).catch(() => []);

        const imagePromise = s.serperKey
          ? fetch('https://google.serper.dev/images', {
              method: 'POST',
              headers: { 'X-API-KEY': s.serperKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({ q: trimmedQuery, num: 10 }),
            }).then(async (res) => {
              if (!res.ok) return [];
              const data = await res.json();
              return (data.images || []).slice(0, 10).map((img: any) => ({
                title: img.title || '',
                imageUrl: img.imageUrl || '',
                link: img.link || '',
              }));
            }).catch(() => [])
          : Promise.resolve([]);

        const [results, images] = await Promise.all([webPromise, imagePromise]);
        if (results.length === 0) return 'Error: Brave Search failed';
        return JSON.stringify({
          query: trimmedQuery,
          results,
          ...(images.length > 0 ? { images } : {}),
        });
      },
    },
    {
      ...consultModelToolSpec,
      inputSchema: z.object({
        model: z.enum(['gpt-5.4', 'gemini-3.1-pro', 'claude-opus-4-6']),
        question: z.string(),
      }),
      execute: async ({ model: modelId, question }, { settings: s, abortSignal }) => {
        if (!question || typeof question !== 'string') return 'Error: Missing question';
        const resolved = getModelForId(s, modelId);
        if ('error' in resolved) return `Error: ${resolved.error}`;
        const result = await generateText({
          model: resolved.model,
          messages: [{ role: 'user', content: question.trim() }] as any,
          abortSignal,
        });
        return result.text || '(empty response)';
      },
    },
    {
      ...consultOpenclawToolSpec,
      inputSchema: z.object({
        question: z.string(),
      }),
      execute: async ({ question }, { settings: s, abortSignal }) => {
        if (!question || typeof question !== 'string') return 'Error: Missing question';

        // Run setup script if configured (e.g. SSH tunnel) — only once per session
        if (s.openclawSetupScript && !openclawSetupRan) {
          openclawSetupRan = true;
          await new Promise<void>((resolve) => {
            exec(s.openclawSetupScript, { timeout: 30000, shell: process.env.SHELL || '/bin/zsh' }, (err) => {
              if (err) console.log('[openclaw] setup script error (may be ok if tunnel already exists):', err.message);
              else console.log('[openclaw] setup script completed');
              resolve();
            });
          });
          // Give the tunnel a moment to establish
          await new Promise(r => setTimeout(r, 2000));
        }

        if (!s.openclawUrl) return 'Error: No OpenClaw server URL configured. Open Settings > OpenClaw to add one.';
        if (!s.openclawToken) return 'Error: No OpenClaw gateway token configured. Open Settings > OpenClaw to add one.';

        const OC_TOKEN = s.openclawToken;
        const OC_DEVICE_ID = 'b915a2ddfc8b3991b09a8634b44d8ab179fea7ae2c9bd53a0c48f7510a6cb593';
        const OC_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIOUsDLrys5GNNo30bOOdYSBcxBcUcVS22y1iFJjnF1Qz\n-----END PRIVATE KEY-----';
        const OC_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA9QyOLuLvrYRaaDSesj6US4RwmMB/Cc4jU1Fl8OObAhY=\n-----END PUBLIC KEY-----';
        const pubDer = crypto.createPublicKey(OC_PUBLIC_KEY).export({ type: 'spki', format: 'der' });
        const pubB64url = pubDer.subarray(-32).toString('base64url');

        const wsUrl = s.openclawUrl.replace(/\/+$/, '').replace(/^http/, 'ws') + '/ws';
        const originUrl = s.openclawUrl.replace(/\/+$/, '');

        return new Promise<string>((resolve) => {
          const ws = new WebSocket(wsUrl, { headers: { Origin: originUrl } } as any);
          let settled = false;
          let connected = false;
          let fullText = '';
          const finish = (result: string) => { if (!settled) { settled = true; try { ws.close(); } catch {} resolve(result); } };
          const timeout = setTimeout(() => finish(fullText || 'Error: OpenClaw timed out (10m)'), 600000);

          abortSignal?.addEventListener('abort', () => { clearTimeout(timeout); finish(fullText || 'Error: Request aborted'); }, { once: true });

          ws.onmessage = (event: any) => {
            try {
              const msg = JSON.parse(String(event.data));

              // Step 1: Respond to challenge
              if (msg.type === 'event' && msg.event === 'connect.challenge') {
                const nonce = msg.payload.nonce;
                const signedAt = Date.now();
                const payload = ['v2', OC_DEVICE_ID, 'cli', 'cli', 'operator', 'operator.admin', String(signedAt), OC_TOKEN, nonce].join('|');
                const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), crypto.createPrivateKey(OC_PRIVATE_KEY));
                ws.send(JSON.stringify({
                  type: 'req', id: crypto.randomUUID(), method: 'connect',
                  params: {
                    minProtocol: 3, maxProtocol: 3,
                    client: { id: 'cli', version: 'dev', platform: 'linux', mode: 'cli', instanceId: crypto.randomUUID() },
                    role: 'operator', scopes: ['operator.admin'],
                    device: { id: OC_DEVICE_ID, publicKey: pubB64url, signature: sig.toString('base64url'), signedAt, nonce },
                    caps: [], auth: { token: OC_TOKEN }, userAgent: 'bordeaux', locale: 'en',
                  },
                }));
                return;
              }

              // Step 2: After connect OK, send chat
              if (msg.type === 'res' && msg.ok && !connected) {
                connected = true;
                ws.send(JSON.stringify({
                  type: 'req', id: crypto.randomUUID(), method: 'chat.send',
                  params: {
                    sessionKey: 'agent:main:bordeaux-' + crypto.randomUUID(),
                    idempotencyKey: crypto.randomUUID(),
                    message: question.trim(),
                  },
                }));
                return;
              }

              // Step 3: Collect streaming response
              if (msg.type === 'event' && msg.event === 'agent' && msg.payload?.stream === 'assistant' && msg.payload?.data?.delta) {
                fullText += msg.payload.data.delta;
              }

              // Step 4: Done when lifecycle phase=end
              if (msg.type === 'event' && msg.event === 'agent' && msg.payload?.stream === 'lifecycle' && msg.payload?.data?.phase === 'end') {
                clearTimeout(timeout);
                finish(fullText || '(empty response)');
              }

              // Handle errors
              if (msg.type === 'res' && !msg.ok) {
                clearTimeout(timeout);
                finish(`Error: ${msg.error?.message || JSON.stringify(msg.error)}`);
              }
            } catch {
              // ignore parse errors for non-JSON frames
            }
          };

          ws.onerror = (err: any) => { clearTimeout(timeout); finish(`Error: WebSocket error: ${err?.message || 'connection failed'}`); };
          ws.onclose = () => { clearTimeout(timeout); finish(fullText || 'Error: WebSocket closed before response'); };
        });
      },
    },
    {
      ...bashToolSpec,
      inputSchema: z.object({
        command: z.string(),
      }),
      execute: async ({ command }, { abortSignal }) => {
        if (!command || typeof command !== 'string') return 'Error: Missing command';
        const trimmed = command.trim();
        if (!trimmed) return 'Error: Empty command';
        return new Promise<string>((resolve) => {
          const child = exec(trimmed, { timeout: 30000, maxBuffer: 1024 * 1024, shell: process.env.SHELL || '/bin/zsh' }, (error, stdout, stderr) => {
            const parts: string[] = [];
            if (stdout) parts.push(stdout);
            if (stderr) parts.push(`stderr:\n${stderr}`);
            if (error && error.killed) parts.push('Error: Command timed out (30s)');
            else if (error) parts.push(`Exit code: ${error.code}`);
            resolve(parts.join('\n').trim() || '(no output)');
          });
          abortSignal?.addEventListener('abort', () => child.kill(), { once: true });
        });
      },
    },
    {
      ...thinkingToolSpec,
      inputSchema: z.object({
        thought: z.string(),
      }),
      execute: async ({ thought }) => {
        return thought || '(empty thought)';
      },
    },
    {
      ...readDiscordToolSpec,
      inputSchema: z.object({
        channelId: z.string(),
        limit: z.number(),
      }),
      execute: async ({ channelId, limit }: { channelId: string; limit: number }, { settings: s }) => {
        const token = s.discordBotToken?.trim();
        if (!token) return 'Error: No Discord bot token configured. Open Settings > Discord to add one.';
        const channelIds = s.discordChannelIds.split('\n').map((id: string) => id.trim()).filter(Boolean);
        const targetChannel = (channelId && channelId.trim()) || channelIds[0];
        if (!targetChannel) return 'Error: No channel ID provided and none configured in Settings > Discord.';

        const count = Math.min(limit || 25, 50);
        try {
          const res = await fetch(`https://discord.com/api/v10/channels/${targetChannel}/messages?limit=${count}`, {
            headers: { Authorization: `Bot ${token}` },
          });
          if (!res.ok) return `Error: Discord API returned ${res.status} ${res.statusText}`;
          const messages = await res.json();
          const userMap = new Map<string, string>();
          for (const m of messages) {
            if (m.author?.id) userMap.set(m.author.id, m.author.username);
            if (m.mentions) for (const u of m.mentions) { if (u.id) userMap.set(u.id, u.username); }
          }
          saveDiscordUsers(userMap).catch(() => {});
          const resolveMentions = (text: string) => text.replace(/<@!?(\d+)>/g, (_: string, id: string) => {
            const name = userMap.get(id);
            return name ? `@${name}` : `@unknown(${id})`;
          });
          const formatted = messages.map((m: { author: { username: string }; content: string; timestamp: string; attachments?: { url: string }[] }) => ({
            author: m.author.username,
            content: resolveMentions(m.content || '(no text)'),
            time: m.timestamp,
            attachments: m.attachments?.length || 0,
          }));
          return JSON.stringify({ channelId: targetChannel, messages: formatted, availableChannels: channelIds });
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      ...readEmailToolSpec,
      inputSchema: z.object({
        accountLabel: z.string(),
        limit: z.number(),
      }),
      execute: async ({ accountLabel, limit }: { accountLabel: string; limit: number }, { settings: s }) => {
        if (!s.emailAccounts || s.emailAccounts.length === 0) return 'Error: No email accounts configured. Open Settings > Email to add one.';
        const account = (accountLabel && accountLabel.trim())
          ? s.emailAccounts.find((a: EmailAccount) => a.label.toLowerCase() === accountLabel.toLowerCase() || a.email.toLowerCase() === accountLabel.toLowerCase())
          : s.emailAccounts[0];
        if (!account) return `Error: Email account "${accountLabel}" not found. Available: ${s.emailAccounts.map((a: EmailAccount) => a.label || a.email).join(', ')}`;
        if (!account.imap.host || !account.imap.username) return `Error: IMAP not configured for ${account.label || account.email}. Open Settings > Email.`;

        const count = Math.min(limit || 10, 30);
        const { ImapFlow } = require('imapflow');
        const client = new ImapFlow({
          host: account.imap.host,
          port: account.imap.port,
          secure: account.imap.security === 'tls',
          auth: { user: account.imap.username, pass: account.imap.password },
          logger: false,
          tls: account.imap.security === 'starttls' ? { rejectUnauthorized: false } : undefined,
        });

        try {
          await client.connect();
          const lock = await client.getMailboxLock('INBOX');
          try {
            const messageCount = client.mailbox?.exists || 0;
            if (messageCount === 0) return JSON.stringify({ account: account.label || account.email, messageCount: 0, messages: [] });

            const startSeq = Math.max(1, messageCount - count + 1);
            const messages: { subject: string; from: string; date: string; preview: string }[] = [];
            for await (const msg of client.fetch(`${startSeq}:*`, { envelope: true, bodyStructure: true, source: { maxLength: 2000 } })) {
              const bodyText = msg.source ? msg.source.toString().replace(/[\r\n]+/g, ' ').slice(0, 200) : '';
              messages.push({
                subject: msg.envelope.subject || '(no subject)',
                from: msg.envelope.from?.[0]?.address || 'unknown',
                date: msg.envelope.date?.toISOString?.() || '',
                preview: bodyText,
              });
            }
            messages.reverse();
            return JSON.stringify({ account: account.label || account.email, messageCount, messages });
          } finally {
            lock.release();
          }
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        } finally {
          try { await client.logout(); } catch { /* ignore */ }
        }
      },
    },
    {
      ...rememberToolSpec,
      inputSchema: z.object({
        mode: z.enum(['append', 'edit']),
        content: z.string(),
        lineNumbers: z.array(z.number()),
      }),
      execute: async ({ mode, content, lineNumbers }, { settings: s }) => {
        const currentMemories = s.memories || '';
        const lines = currentMemories ? currentMemories.split('\n') : [];

        if (mode === 'append') {
          lines.push(...content.split('\n'));
        } else if (mode === 'edit' && lineNumbers && lineNumbers.length > 0) {
          const newLines = content.split('\n');
          // Sort line numbers descending to avoid index shifting
          const sorted = [...lineNumbers].sort((a, b) => b - a);
          for (const ln of sorted) {
            if (ln >= 1 && ln <= lines.length) {
              lines.splice(ln - 1, 1);
            }
          }
          // Insert new content at the position of the first (smallest) line number
          const insertAt = Math.min(...lineNumbers) - 1;
          lines.splice(Math.max(0, insertAt), 0, ...newLines);
        }

        const updated = lines.join('\n');
        const current = loadSettings();
        saveSettings({ ...current, memories: updated });
        // Notify renderer of settings change
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('settings-changed');
        }
        return `Memory updated. Current memories:\n${updated}`;
      },
    },
  ];
}

let openclawSetupRan = false;
const activeAbortControllers = new Map<string, AbortController>();

ipcMain.on('chat-abort-stream', (_event, requestId: string) => {
  const controller = activeAbortControllers.get(requestId);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(requestId);
  }
});

ipcMain.on('chat-send-stream', async (event, requestId: string, messages: ChatMessage[], modelId: string) => {
  const settings = loadSettings();
  const hasFiles = messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'file'));
  const resolved = getModelForId(settings, modelId || 'gpt-5.4-mini', hasFiles);
  if ('error' in resolved) {
    event.sender.send('chat-stream-error', requestId, resolved.error);
    return;
  }

  const abortController = new AbortController();
  activeAbortControllers.set(requestId, abortController);

  const customTools = buildCustomTools(settings);
  const toolMap = Object.fromEntries(customTools.map(t => [t.name, t]));
  const toolCallSchema = buildToolCallSchema(customTools);
  const responseSchema = z.object({
    outputType: z.enum(['text', 'toolCalls']),
    output: z.string().nullable(),
    toolCalls: z.array(toolCallSchema).min(1).nullable(),
  });
  const MAX_TOOL_ROUNDS = 10;
  const MAX_RETRIES = 3;
  const conversationMessages: ChatMessage[] = [];
  // Inject self prompt and memories as system context
  const memoryParts: string[] = [];
  if (settings.selfPrompt) memoryParts.push(`## About the user\n${settings.selfPrompt}`);
  if (settings.memories) memoryParts.push(`## Memories\n${settings.memories}`);
  if (memoryParts.length > 0) {
    conversationMessages.push({ role: 'system', content: memoryParts.join('\n\n') });
  }
  conversationMessages.push(...messages);
  let toolCallCounter = 0;

  // Force a search tool call on the first message in a conversation
  const userMessages = messages.filter(m => m.role === 'user');
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  if (userMessages.length === 1 && assistantMessages.length === 0 && toolMap['search']) {
    const userText = typeof userMessages[0].content === 'string'
      ? userMessages[0].content
      : Array.isArray(userMessages[0].content)
        ? userMessages[0].content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ')
        : '';
    if (userText.trim()) {
      const tcId = `tc-${toolCallCounter++}`;
      event.sender.send('chat-stream-tool-call', requestId, {
        toolCallId: tcId, toolName: 'search', toolArgs: { query: userText.trim() }, status: 'running',
      });
      try {
        const result = await toolMap['search'].execute({ query: userText.trim() }, {
          messages: conversationMessages, settings, abortSignal: abortController.signal,
        });
        event.sender.send('chat-stream-tool-call', requestId, {
          toolCallId: tcId, toolName: 'search', toolArgs: { query: userText.trim() }, result, status: 'done',
        });
        conversationMessages.push(
          { role: 'assistant', content: JSON.stringify({ outputType: 'toolCalls', output: null, toolCalls: [{ name: 'search', input: { query: userText.trim() } }] }) },
          { role: 'user', content: JSON.stringify({ toolResults: [{ tool: 'search', result }] }) },
        );
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        event.sender.send('chat-stream-tool-call', requestId, {
          toolCallId: tcId, toolName: 'search', toolArgs: { query: userText.trim() }, result: errMsg, status: 'error',
        });
      }
    }
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (abortController.signal.aborted) {
      activeAbortControllers.delete(requestId);
      event.sender.send('chat-stream-done', requestId);
      return;
    }

    let responseObject: z.infer<typeof responseSchema> | null = null;
    let succeeded = false;
    let lastStreamedLength = 0;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (abortController.signal.aborted) {
        activeAbortControllers.delete(requestId);
        event.sender.send('chat-stream-done', requestId);
        return;
      }
      try {
        const stream = streamObject({
          model: resolved.model,
          schema: responseSchema,
          messages: toSdkMessages(conversationMessages) as any,
          abortSignal: abortController.signal,
        });

        // Stream partial output to the renderer as it arrives
        lastStreamedLength = 0;
        for await (const partial of stream.partialObjectStream) {
          if (abortController.signal.aborted) break;
          // If partial has an output field, send only the new delta
          if (partial.outputType === 'text' && typeof partial.output === 'string' && partial.output.length > lastStreamedLength) {
            const delta = partial.output.slice(lastStreamedLength);
            event.sender.send('chat-stream-chunk', requestId, delta);
            lastStreamedLength = partial.output.length;
          }
        }

        responseObject = await stream.object;
        const hasTextOutput = responseObject.outputType === 'text' && typeof responseObject.output === 'string' && !!responseObject.output.trim();
        const hasToolCalls = responseObject.outputType === 'toolCalls' && Array.isArray(responseObject.toolCalls) && responseObject.toolCalls.length > 0;
        if (!hasTextOutput && !hasToolCalls && attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
          continue;
        }
        succeeded = true;
        break;
      } catch (err: unknown) {
        if (abortController.signal.aborted) {
          activeAbortControllers.delete(requestId);
          event.sender.send('chat-stream-done', requestId);
          return;
        }
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
          continue;
        }
        activeAbortControllers.delete(requestId);
        const message = err instanceof Error ? err.message : String(err);
        event.sender.send('chat-stream-error', requestId, `Request failed: ${message}`);
        return;
      }
    }

    if (!succeeded) {
      activeAbortControllers.delete(requestId);
      event.sender.send('chat-stream-error', requestId, 'Request failed after retries');
      return;
    }

    if (!responseObject) {
      activeAbortControllers.delete(requestId);
      event.sender.send('chat-stream-error', requestId, 'Request failed: no structured response');
      return;
    }

    if (responseObject.outputType === 'toolCalls' && Array.isArray(responseObject.toolCalls) && responseObject.toolCalls.length > 0) {
      // Assign IDs and notify renderer (status: running)
      const toolCalls = responseObject.toolCalls.map((tc: any) => {
        const id = `tc-${toolCallCounter++}`;
        event.sender.send('chat-stream-tool-call', requestId, {
          toolCallId: id, toolName: tc.name, toolArgs: tc.input || {}, status: 'running',
        });
        return { ...tc, toolCallId: id };
      });

      // Execute all tools in parallel
      const results = await Promise.all(toolCalls.map(async (tc: any) => {
        const toolDef = toolMap[tc.name];
        if (!toolDef) {
          const errMsg = `Unknown tool: ${tc.name}`;
          event.sender.send('chat-stream-tool-call', requestId, {
            toolCallId: tc.toolCallId, toolName: tc.name, toolArgs: tc.input || {}, result: errMsg, status: 'error',
          });
          return { tool: tc.name, error: errMsg };
        }
        try {
          const result = await toolDef.execute(tc.input || {}, {
            messages: conversationMessages, settings, abortSignal: abortController.signal,
          });
          event.sender.send('chat-stream-tool-call', requestId, {
            toolCallId: tc.toolCallId, toolName: tc.name, toolArgs: tc.input || {}, result, status: 'done',
          });
          return { tool: tc.name, result };
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          event.sender.send('chat-stream-tool-call', requestId, {
            toolCallId: tc.toolCallId, toolName: tc.name, toolArgs: tc.input || {}, result: errMsg, status: 'error',
          });
          return { tool: tc.name, error: errMsg };
        }
      }));

      // Append tool call + results to conversation for next round
      conversationMessages.push(
        { role: 'assistant', content: JSON.stringify(responseObject) },
        { role: 'user', content: JSON.stringify({ toolResults: results }) },
      );
      continue;
    }

    // Send any remaining output not yet streamed
    const finalOutput = typeof responseObject.output === 'string' ? responseObject.output : '';
    if (finalOutput.length > lastStreamedLength) {
      event.sender.send('chat-stream-chunk', requestId, finalOutput.slice(lastStreamedLength));
    }
    activeAbortControllers.delete(requestId);
    event.sender.send('chat-stream-done', requestId);
    return;
  }

  // Max tool rounds exceeded
  activeAbortControllers.delete(requestId);
  event.sender.send('chat-stream-error', requestId, 'Tool calling loop exceeded maximum rounds');
});

// Generate inline suggestion using a lightweight model
ipcMain.handle('chat-suggest', async (_event, messages: ChatMessage[], partialInput: string) => {
  const settings = loadSettings();

  // Pick a lightweight model: OpenAI nano > Anthropic haiku > Google spark
  let suggestModel;
  if (settings.openaiKey) {
    const openai = createOpenAI({ apiKey: settings.openaiKey });
    suggestModel = openai.chat('gpt-5.4-nano');
  } else if (settings.anthropicKey) {
    const anthropic = createAnthropic({ apiKey: settings.anthropicKey });
    suggestModel = anthropic('claude-haiku-4-5-20251001');
  } else if (settings.googleKey) {
    const google = createGoogleGenerativeAI({ apiKey: settings.googleKey });
    suggestModel = google('gemini-2.0-flash-lite');
  } else {
    return null;
  }

  try {
    const contextMessages = messages.slice(-10).map(m => {
      const content = Array.isArray(m.content) ? m.content.filter(b => b.type === 'text').map(b => b.text).join(' ') : m.content;
      return `${m.role}: ${content}`;
    }).join('\n');

    const isEmpty = !partialInput;

    if (isEmpty) {
      const system = `You are an autocomplete engine inside a chat input. Suggest a short, natural question or message the user might want to type next based on the conversation context. Output ONLY the suggested text. Keep it short (under 15 words). If there's no conversation yet, suggest an interesting question.`;
      const prompt = contextMessages
        ? `Conversation so far:\n${contextMessages}\n\nSuggest what the user might type next:`
        : 'Suggest an interesting question the user might ask:';
      const result = await generateText({
        model: suggestModel,
        system,
        prompt,
        maxOutputTokens: 60,
      });
      return result.text?.trim() || null;
    }

    // For partial input: ask the model to complete the full message, then strip the prefix
    const system = `You are an autocomplete engine. The user is typing a message. Complete their message naturally. Output ONLY the full completed message (including what they already typed). Keep it short (under 20 words total). If you can't predict anything useful, repeat back exactly what they typed.`;
    const prompt = contextMessages
      ? `Conversation so far:\n${contextMessages}\n\nComplete this message: "${partialInput}"`
      : `Complete this message: "${partialInput}"`;

    const result = await generateText({
      model: suggestModel,
      system,
      prompt,
      maxOutputTokens: 60,
    });
    let full = result.text?.trim() || null;
    if (!full) return null;
    // Strip quotes if the model wrapped it
    if (full.startsWith('"') && full.endsWith('"')) full = full.slice(1, -1);
    // Find where the user's input appears and extract the continuation
    const lowerFull = full.toLowerCase();
    const lowerInput = partialInput.toLowerCase();
    const idx = lowerFull.indexOf(lowerInput);
    if (idx !== -1) {
      const continuation = full.substring(idx + partialInput.length);
      return continuation || null;
    }
    // Fallback: if model didn't include the prefix, add a space
    if (!full.startsWith(' ')) full = ' ' + full;
    return full;
  } catch {
    return null;
  }
});

// Google Autocomplete suggestions (no API key needed)
ipcMain.handle('autocomplete-suggest', async (_event, query: string) => {
  if (!query) return null;
  try {
    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const suggestions: string[] = data[1];
    if (!suggestions || suggestions.length === 0) return null;
    // Find the first suggestion that starts with what the user typed
    const lowerQuery = query.toLowerCase();
    for (const s of suggestions) {
      if (s.toLowerCase().startsWith(lowerQuery) && s.length > query.length) {
        return s.substring(query.length);
      }
    }
    return null;
  } catch {
    return null;
  }
});

// Generate chat title using a lightweight model
ipcMain.handle('chat-generate-title', async (_event, userMessage: string) => {
  const apiKey = loadSettings().openaiKey;
  if (!apiKey) return null;

  try {
    const openai = createOpenAI({ apiKey });
    const result = await generateText({
      model: openai.chat('gpt-5.4-nano'),
      system: 'Generate a very short title (max 5 words) for a chat that starts with the following message. Reply with only the title, no quotes or punctuation.',
      prompt: userMessage,
      maxOutputTokens: 20,
    });
    return result.text?.trim() || null;
  } catch (err) {
    console.error('Title generation error:', err);
    return null;
  }
});

// Summarize the full inbox into a structured digest
ipcMain.handle('summarize-inbox', async (_event, rawSummary: string) => {
  const settings = loadSettings();
  const apiKey = settings.openaiKey;
  if (!apiKey) return null;
  try {
    const openai = createOpenAI({ apiKey });
    let userContext = '';
    if (settings.selfPrompt) userContext += `About the user: ${settings.selfPrompt}\n`;
    if (settings.memories) userContext += `Memories: ${settings.memories}\n`;

    const result = await generateText({
      model: openai.chat('gpt-5.4'),
      system: `You are an executive assistant. Distill the user's inbox into a structured context briefing that explains what's currently going on.
${userContext}
Output a concise structured overview in this format:

# What's Going On
A paragraph explaining the current situation — what projects are active, what conversations are happening, what's the general state of things. This should give someone who's never seen these messages enough context to understand any individual message.

## Active Threads & Conversations
- Ongoing discussions with who's involved and what they're about. Include current status of each.

## Key People
- Who's been communicating and their role/relationship to the user

## Important Context
- Deadlines, dates, numbers, decisions, or details that would be needed to understand future messages

This is NOT a todo list. Focus on providing context and situational awareness, not action items. Use names, dates, and specifics. Skip spam/noise entirely.`,
      prompt: rawSummary,
      maxOutputTokens: 2000,
    });
    return result.text?.trim() || null;
  } catch (err) {
    console.error('Inbox summarize error:', err);
    return null;
  }
});

// Build the messageSummary that the categorization model sees
async function buildMessageSummary(message: { source: string; subject?: string; from?: string; preview?: string; content?: string; author?: string; time?: number; uid?: number }): Promise<string> {
  if (message.source === 'email') {
    let emailBody = message.preview || '';
    if (message.uid) {
      try {
        const db = await getMessagesDb();
        const row = dbGet(db, 'SELECT body FROM email_bodies WHERE uid = ?', [message.uid]);
        if (row?.body) emailBody = row.body;
      } catch { /* fall back to preview */ }
    }
    return `Email from: ${message.from}\nSubject: ${message.subject}\nBody:\n${emailBody}`;
  } else if (message.source === 'discord') {
    let contextStr = '';
    try {
      const db = await getMessagesDb();
      const msgTime = message.time || 0;
      const before = dbAll(db,
        "SELECT discord_author, discord_content, time FROM messages WHERE source = 'discord' AND time < ? ORDER BY time DESC LIMIT 50",
        [msgTime]
      ).reverse();
      const after = dbAll(db,
        "SELECT discord_author, discord_content, time FROM messages WHERE source = 'discord' AND time > ? ORDER BY time ASC LIMIT 50",
        [msgTime]
      );
      const contextLines: string[] = [];
      for (const m of before) contextLines.push(`${m.discord_author}: ${await resolveDiscordMentions(m.discord_content || '')}`);
      contextLines.push(`>>> ${message.author}: ${await resolveDiscordMentions(message.content || '')} <<<  [THIS IS THE MESSAGE TO CLASSIFY]`);
      for (const m of after) contextLines.push(`${m.discord_author}: ${await resolveDiscordMentions(m.discord_content || '')}`);
      contextStr = contextLines.join('\n');
    } catch { /* ignore */ }
    if (contextStr) {
      return `Discord conversation context (the message to classify is marked with >>>):\n\n${contextStr}`;
    }
    return `Discord message from ${message.author}: ${message.content}`;
  }
  return `Message from ${message.from}: ${message.subject}\n${message.preview}`;
}

// Preview the exact prompt the model sees for a message
type CategorizeInput = { source: string; subject?: string; from?: string; preview?: string; content?: string; author?: string; time?: number; uid?: number; existingWorkspaces?: string[]; globalContext?: string };

async function buildCategorizePrompts(message: CategorizeInput): Promise<{ system: string; user: string }> {
  const settings = loadSettings();

  let userContext = '';
  if (settings.selfPrompt) userContext += `\n\nAbout the user: ${settings.selfPrompt}`;
  if (settings.memories) userContext += `\n\nMemories about the user:\n${settings.memories}`;

  const messageSummary = await buildMessageSummary(message);

  const rawBodyLength = message.source === 'email'
    ? (message.preview || '').length
    : (message.content || '').length;
  const needsSummary = rawBodyLength > 150;

  const system = `You categorize messages for a specific user. Your job is to decide if the message requires action FROM THIS USER and nobody else.
${userContext}

RULES:
1. A message is TODO ONLY if it explicitly mentions, tags, or addresses the user by name/username, OR is clearly their personal responsibility (e.g., sent directly to their email).
2. Conversations between OTHER people are ALWAYS DONE — even if the topic is relevant. If person A asks person B to do something, that is NOT the user's TODO.
3. Group chat messages not directed at the user are DONE.
4. Automated notifications, newsletters, CI/CD, build logs = SPAM.
5. For Discord: look at who is talking to whom. If the message is part of a conversation between other people, it is DONE regardless of topic.
6. If the user has been asked a question, requested to do something, or received a message that expects a reply — and the user has NOT yet responded (check the messages after it) — mark it as TODO.
7. For emails: any non-spam email sent TO the user that asks a question, requests action, or expects a reply should be TODO unless the email body itself shows a prior reply from the user (e.g. quoted reply text). If it's purely informational with no action needed, mark DONE.

Respond with JSON:
- "status": "SPAM" | "TODO" | "DONE"${needsSummary ? `
- "summary": REQUIRED. Write like you're taking notes in a meeting for your boss — only the important facts, decisions, requests, deadlines, names, and numbers. Skip greetings, filler, and pleasantries. Can be more than two sentences if the message contains key details (dates, amounts, action items, specific requirements).` : ''}
- "matchedWorkspaces": (only if TODO and it matches existing workspaces) array of workspace numbers, e.g. [29, 34]
- "todos": (only if TODO and no matchedWorkspaces) array of objects with:
  - "taskName": max 5 words
  - "notes": paragraph explaining the task, written as instructions TO the user (use "you" — e.g. "You need to create a spreadsheet..." not "The user should..."). If context is missing, say so first.

Only create MULTIPLE todos for truly parallel tasks. Sequential steps = one todo.

For Discord, surrounding conversation context may be provided. The message to classify is marked with >>>. Use the context to see who is being addressed and whether it's already resolved. If someone asks the user a question and the user has NOT replied in the messages after it, mark it as TODO — the user needs to respond.
${message.existingWorkspaces && message.existingWorkspaces.length > 0 ? `
The user already has these open workspaces/tasks:
${message.existingWorkspaces.map(n => `- ${n}`).join('\n')}
If a message relates to an existing workspace, still mark it as TODO but include "matchedWorkspaces" with the workspace numbers (e.g. [29, 34]) — do NOT create new todos for it. Only create new todos if the task is genuinely new and not covered by any existing workspace.` : ''}
Respond ONLY with valid JSON, no markdown.`;

  const user = `${messageSummary}${message.globalContext ? `\n\n--- GLOBAL CONTEXT: Summary of all messages in the inbox ---\n${message.globalContext}` : ''}`;

  return { system, user };
}

ipcMain.handle('preview-sync-payload', async (_event, message: CategorizeInput) => {
  try {
    const { system, user } = await buildCategorizePrompts(message);
    return `=== SYSTEM PROMPT ===\n\n${system}\n\n=== USER PROMPT ===\n\n${user}`;
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
});

// Categorize a message using LLM
ipcMain.handle('categorize-message', async (_event, message: CategorizeInput & { id: string }) => {
  const settings = loadSettings();
  const apiKey = settings.openaiKey;
  if (!apiKey) return null;
  try {
    const openai = createOpenAI({ apiKey });
    const { system, user } = await buildCategorizePrompts(message);

    const result = await generateText({
      model: openai.chat('gpt-5.4'),
      system,
      prompt: user,
      maxOutputTokens: 500,
    });
    return JSON.parse(result.text?.trim() || 'null');
  } catch (err) {
    console.error('Categorize error:', err);
    return null;
  }
});

// Update message status in DB
ipcMain.handle('db-update-message-status', async (_event, id: string, status: string, workspaceNums?: number[], summary?: string) => {
  const db = await getMessagesDb();
  const wsValue = workspaceNums && workspaceNums.length > 0 ? workspaceNums.join(',') : null;
  db.run('UPDATE messages SET status = ?, workspace_num = ?, summary = ? WHERE id = ?', [status, wsValue, summary || null, id]);
  scheduleDbSave();
  return { success: true };
});

// Reset all message statuses to UNREAD
ipcMain.handle('db-reset-all-statuses', async () => {
  const db = await getMessagesDb();
  db.run("UPDATE messages SET status = 'UNREAD', workspace_num = NULL, summary = NULL");
  scheduleDbSave();
  return { success: true };
});

// Get next workspace number and increment
ipcMain.handle('get-next-workspace-num', async () => {
  const cursors = loadCursors();
  const num = cursors.nextWorkspaceNum || 1;
  saveCursors({ ...cursors, nextWorkspaceNum: num + 1 });
  return num;
});

// Notes persistence
ipcMain.handle('save-note-content', (_event, tabId: number, content: string) => {
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(path.join(notesDir, `${tabId}.md`), content, 'utf-8');
  return { success: true };
});

ipcMain.handle('load-note-content', (_event, tabId: number) => {
  try {
    return fs.readFileSync(path.join(notesDir, `${tabId}.md`), 'utf-8');
  } catch {
    return '';
  }
});

// Catch ALL new webContents (including popup windows from webviews)
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url, disposition }) => {
    // Skip internal Google widget URLs
    try {
      const parsed = new URL(url);
      if (parsed.hostname.match(/^(ogs|contacts|people-pa|lh3|accounts)\.google\.com$/) && (url.includes('widget') || url.includes('gapi') || url.includes('hovercard'))) {
        return { action: 'deny' };
      }
    } catch {}
    // Allow OAuth popups (about:blank)
    if (disposition === 'new-window' && (!url || url === 'about:blank')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500, height: 700, autoHideMenuBar: true,
          webPreferences: { nodeIntegration: false, contextIsolation: true },
        },
      };
    }
    // Everything else → new tab
    mainWindow?.webContents.send('open-url-in-new-tab', url);
    return { action: 'deny' };
  });
});

app.whenReady().then(() => {
  applyTheme(loadSettings().theme);

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Pause',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: () => openSettingsWindow() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => mainWindow?.webContents.send('shortcut-from-webview', 't', false) },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => mainWindow?.webContents.send('shortcut-from-webview', 'w', false) },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => mainWindow?.webContents.send('shortcut-from-webview', 'f', false) },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();
});

app.on('window-all-closed', () => {
  stopImapIdle();
  stopDiscordPolling();
  saveDbToDisk();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Handle URLs opened when app is set as default browser
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.webContents.send('open-url-in-new-tab', url);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
