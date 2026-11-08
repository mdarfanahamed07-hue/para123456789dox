'use strict';

const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_VERSION = '1.0.0';
const CONNECTOR_NAMESPACE = 'paradox-command-center/v1';
let mainWindow = null;
let credentials = null;
let requestInFlight = 0;

function credentialFile() {
  return path.join(app.getPath('userData'), 'connection.bin');
}

function normalizeSiteUrl(input) {
  let url;
  try {
    url = new URL(String(input || '').trim());
  } catch {
    throw new Error('Enter a valid website URL, for example https://paradox-prime.online');
  }
  if (url.protocol !== 'https:') {
    throw new Error('For security, Command Center only connects to websites using HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('The website URL must not contain a username, password, query string or fragment.');
  }
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local') || !url.hostname.includes('.')) {
    throw new Error('Local and non-public hostnames are not supported.');
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

function loadSavedCredentials() {
  try {
    if (!fs.existsSync(credentialFile())) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    const encrypted = fs.readFileSync(credentialFile());
    const parsed = JSON.parse(safeStorage.decryptString(encrypted));
    return {
      siteUrl: normalizeSiteUrl(parsed.siteUrl),
      username: String(parsed.username || ''),
      appPassword: String(parsed.appPassword || '')
    };
  } catch {
    return null;
  }
}

function saveCredentials(next) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows secure credential storage is unavailable. Credentials were not saved.');
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(next));
  fs.mkdirSync(path.dirname(credentialFile()), { recursive: true });
  fs.writeFileSync(credentialFile(), encrypted, { mode: 0o600 });
}

function clearCredentials() {
  credentials = null;
  try { fs.rmSync(credentialFile(), { force: true }); } catch { /* best effort */ }
}

function authHeader() {
  if (!credentials) throw new Error('Not connected. Connect to your WordPress site first.');
  const password = credentials.appPassword.replace(/\s+/g, '');
  return `Basic ${Buffer.from(`${credentials.username}:${password}`, 'utf8').toString('base64')}`;
}

async function apiRequest(endpoint, options = {}) {
  if (!credentials) throw new Error('Not connected. Connect to your WordPress site first.');
  const cleanEndpoint = String(endpoint || '').replace(/^\/+/, '');
  if (cleanEndpoint.includes('..') || cleanEndpoint.includes('://')) {
    throw new Error('Invalid API endpoint.');
  }
  const url = `${credentials.siteUrl}/wp-json/${CONNECTOR_NAMESPACE}/${cleanEndpoint}`;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 30000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', authHeader());
  headers.set('Accept', 'application/json');
  let body = options.body;
  if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  requestInFlight += 1;
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body,
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store'
    });
    const raw = await response.text();
    let payload;
    try { payload = raw ? JSON.parse(raw) : {}; }
    catch { throw new Error(`The website returned an unreadable response (HTTP ${response.status}).`); }
    if (!response.ok) {
      const message = payload?.message || payload?.data?.message || `Website request failed (HTTP ${response.status}).`;
      throw new Error(String(message).slice(0, 600));
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The website took too long to respond. Check the connection and try again.');
    if (error.name === 'TypeError') throw new Error('Could not reach the website. Check your internet connection and the site URL.');
    throw error;
  } finally {
    clearTimeout(timeout);
    requestInFlight = Math.max(0, requestInFlight - 1);
  }
}

async function verifyCredentials(candidate) {
  const previous = credentials;
  credentials = candidate;
  try {
    // Validate the WordPress Application Password and identify the signed-in account.
    const url = `${credentials.siteUrl}/wp-json/wp/v2/users/me?context=edit`;
    const response = await fetch(url, {
      headers: { Authorization: authHeader(), Accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(20000)
    });
    let user;
    try { user = await response.json(); } catch { throw new Error('WordPress did not return a valid account response.'); }
    if (!response.ok) throw new Error(user?.message || 'WordPress rejected the Application Password.');
    if (!user?.id || !Array.isArray(user?.roles)) throw new Error('Could not verify the WordPress administrator account.');
    const status = await apiRequest('status');
    return { user: { id: user.id, name: user.name, roles: user.roles }, status };
  } catch (error) {
    credentials = previous;
    throw error;
  }
}

function publicConnection() {
  if (!credentials) return { connected: false, siteUrl: '' };
  return { connected: true, siteUrl: credentials.siteUrl };
}

function registerIpc() {
  ipcMain.handle('app:version', () => APP_VERSION);
  ipcMain.handle('connection:info', () => publicConnection());
  ipcMain.handle('connection:connect', async (_event, input) => {
    const candidate = {
      siteUrl: normalizeSiteUrl(input?.siteUrl),
      username: String(input?.username || '').trim(),
      appPassword: String(input?.appPassword || '').trim()
    };
    if (!candidate.username || !candidate.appPassword) throw new Error('Enter your WordPress username and an Application Password.');
    const verified = await verifyCredentials(candidate);
    saveCredentials(candidate);
    credentials = candidate;
    return { ...publicConnection(), user: verified.user, status: verified.status };
  });
  ipcMain.handle('connection:disconnect', () => {
    clearCredentials();
    return { connected: false };
  });
  ipcMain.handle('connection:ping', async () => {
    const status = await apiRequest('status', { timeoutMs: 15000 });
    return { connected: true, status, inFlight: requestInFlight };
  });
  ipcMain.handle('site:open-admin', async () => {
    if (!credentials) throw new Error('Connect first.');
    await shell.openExternal(`${credentials.siteUrl}/wp-admin/`);
    return true;
  });
  ipcMain.handle('plugins:list', () => apiRequest('plugins'));
  ipcMain.handle('plugins:action', async (_event, action, slug) => {
    const allowed = ['activate', 'deactivate', 'update', 'delete'];
    if (!allowed.includes(action)) throw new Error('Unsupported plugin action.');
    return apiRequest(`plugins/${action}`, { method: 'POST', body: { plugin: String(slug || '') } });
  });
  ipcMain.handle('plugins:install', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a WordPress plugin ZIP',
      properties: ['openFile'],
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };
    return uploadZip(result.filePaths[0], 'plugins/install', 20 * 1024 * 1024);
  });
  ipcMain.handle('themes:list', () => apiRequest('themes'));
  ipcMain.handle('themes:action', async (_event, action, slug) => {
    const allowed = ['activate', 'update', 'delete'];
    if (!allowed.includes(action)) throw new Error('Unsupported theme action.');
    return apiRequest(`themes/${action}`, { method: 'POST', body: { theme: String(slug || '') } });
  });
  ipcMain.handle('themes:install', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a WordPress theme ZIP',
      properties: ['openFile'],
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };
    return uploadZip(result.filePaths[0], 'themes/install', 30 * 1024 * 1024);
  });
  ipcMain.handle('activity:list', () => apiRequest('activity'));
  ipcMain.handle('connection:restore', async () => {
    if (!credentials) credentials = loadSavedCredentials();
    if (!credentials) return { connected: false, siteUrl: '' };
    try {
      const verified = await verifyCredentials(credentials);
      return { ...publicConnection(), user: verified.user, status: verified.status };
    } catch (error) {
      return { ...publicConnection(), connected: false, error: error.message };
    }
  });
}

async function uploadZip(filePath, endpoint, maxBytes) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) {
    throw new Error(`Choose a ZIP file smaller than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }
  if (path.extname(filePath).toLowerCase() !== '.zip') throw new Error('Only ZIP archives are accepted.');
  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('package', new Blob([bytes], { type: 'application/zip' }), path.basename(filePath));
  return apiRequest(endpoint, { method: 'POST', body: form, timeoutMs: 180000 });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#080811',
    title: 'Paradox Command Center',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== pathToFileURL(path.join(__dirname, 'index.html')).href) event.preventDefault();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  app.setAppUserModelId('online.paradoxprime.commandcenter');
  credentials = loadSavedCredentials();
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
});
