const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createInterface } = require('node:readline');
app.setName('Bach to Basics');
// Keep packaged validation separate from an already-running practice session.
if (process.env.BACH_SMOKE_PROFILE) app.setPath('userData', process.env.BACH_SMOKE_PROFILE);

const ORIGIN = 'bach://piano';
const token = randomBytes(32).toString('hex');
const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'staging');
const webRoot = path.join(resources, 'frontend');
let window, backend, backendURL, quitting = false, rendererReady = false;
let pendingFiles = [];
let log;
const isLocal = (url) => {
  try { const u = new URL(url); return u.protocol === 'bach:' && u.host === 'piano'; }
  catch { return false; }
};

protocol.registerSchemesAsPrivileged([{
  scheme: 'bach', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.on('open-file', (event, file) => {
    event.preventDefault();
    pendingFiles.push(file);
    if (backendURL && !window) void createWindow().catch(fail);
    window?.show();
    void flushFiles();
  });
  app.whenReady().then(start).catch(fail);
}

async function startBackend() {
  const executable = path.join(resources, 'backend', 'bach-backend');
  backend = spawn(executable, [], {
    cwd: app.getPath('userData'),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BACKEND_API_KEY: token, REQUIRE_AUTH: '1', ALLOWED_ORIGINS: ORIGIN,
      RATE_LIMIT_PER_MIN: '0', PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin` },
  });
  backend.stderr.on('data', (chunk) => log.write(chunk));
  backend.on('exit', (code) => {
    if (!quitting) fail(new Error(`Music service stopped (code ${code}). Reopen the app to restart it.`));
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Music service did not start within 30 seconds.')), 30000);
    const lines = createInterface({ input: backend.stdout });
    lines.on('line', (line) => {
      try {
        const value = JSON.parse(line);
        if (Number.isInteger(value.port) && value.port > 0 && value.port < 65536) {
          clearTimeout(timer); resolve(value.port);
        }
      } catch { log.write(`${line}\n`); }
    });
    backend.once('error', (error) => { clearTimeout(timer); reject(error); });
    backend.once('exit', () => { clearTimeout(timer); reject(new Error('Music service failed to launch.')); });
  });
  backendURL = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const response = await fetch(`${backendURL}/health`, {
        headers: { 'X-API-Key': token }, signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Music service health check timed out.');
}

async function start() {
  fs.mkdirSync(app.getPath('logs'), { recursive: true });
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  log = fs.createWriteStream(path.join(app.getPath('logs'), 'desktop.log'), { flags: 'w' });
  await startBackend();
  protocol.handle('bach', async (request) => {
    if (!isLocal(request.url)) return new Response('Forbidden', { status: 403 });
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const headers = new Headers(request.headers);
      headers.delete('host'); headers.delete('origin');
      headers.set('X-API-Key', token);
      try {
        return await fetch(`${backendURL}${url.pathname.slice(4)}${url.search}`, {
          method: request.method, headers,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
          signal: AbortSignal.timeout(180000),
        });
      } catch {
        return Response.json({ detail: 'The music service is unavailable. Reopen the app and try again.' }, { status: 503 });
      }
    }
    let relative;
    try { relative = decodeURIComponent(url.pathname); }
    catch { return new Response('Bad path', { status: 400 }); }
    const file = path.resolve(webRoot, `.${relative === '/' ? '/index.html' : relative}`);
    if (!file.startsWith(webRoot + path.sep)) return new Response('Forbidden', { status: 403 });
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      log?.write(`Missing bundled asset: ${url.pathname}\n`);
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).href);
  });
  const allowed = new Set(['midi', 'midiSysex']);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(allowed.has(permission) && isLocal(details.requestingUrl || contents.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) => allowed.has(permission) && isLocal(origin));
  session.defaultSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: 'Export music', defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
  });
  ipcMain.on('music-renderer-ready', (event) => {
    if (event.sender !== window?.webContents || !isLocal(event.senderFrame?.url)) return;
    rendererReady = true;
    void flushFiles();
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [{ label: 'Open Music…', accelerator: 'CmdOrCtrl+O', click: openMusic }, { role: 'close' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Mac App Guide', click: () => shell.openPath(path.join(resources, 'MAC-APP.md')) }, { label: 'Show Diagnostic Log', click: () => shell.showItemInFolder(path.join(app.getPath('logs'), 'desktop.log')) }] },
  ]));
  await createWindow();
  if (process.env.BACH_SMOKE_OUTPUT) {
    try {
      await require('./smoke.cjs')({ window, resources, backendURL, token });
      app.exitCode = 0;
    } catch (error) {
      const text = await window.webContents.executeJavaScript('document.body.innerText');
      const html = await window.webContents.executeJavaScript('document.body.innerHTML');
      fs.writeFileSync(process.env.BACH_SMOKE_OUTPUT + '.html', html);
      fs.writeFileSync(process.env.BACH_SMOKE_OUTPUT + '.png', (await window.webContents.capturePage()).toPNG());
      fs.writeFileSync(process.env.BACH_SMOKE_OUTPUT, JSON.stringify({ error: error.stack, text }, null, 2));
      app.exitCode = 1;
    }
    app.quit();
  }
}

async function createWindow() {
  rendererReady = false;
  window = new BrowserWindow({
    width: 1440, height: 960, minWidth: 960, minHeight: 640,
    title: 'Bach to Basics', backgroundColor: '#0a0a0a', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.webContents.on('did-start-loading', () => { rendererReady = false; });
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') log?.write(`Renderer ${event.level}: ${event.message}\n`);
  });
  window.webContents.on('will-navigate', (event, url) => { if (!isLocal(url)) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('render-process-gone', (_event, details) => fail(new Error(`App window stopped: ${details.reason}`)));
  window.on('closed', () => { window = null; rendererReady = false; });
  await window.loadURL(`${ORIGIN}/`);
  window.show();
}

async function openMusic() {
  const result = await dialog.showOpenDialog(window, {
    title: 'Open Music', properties: ['openFile'],
    filters: [{ name: 'Music and sheet music', extensions: ['mid', 'midi', 'xml', 'musicxml', 'mxl', 'pdf', 'mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'] }],
  });
  if (!result.canceled) { pendingFiles.push(...result.filePaths); await flushFiles(); }
}

async function flushFiles() {
  if (!rendererReady || !window) return;
  for (const file of pendingFiles.splice(0)) {
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile() || stat.size > 50 * 1024 * 1024) throw new Error('Choose a music file smaller than 50 MB.');
      const bytes = await fs.promises.readFile(file);
      window.webContents.send('open-music-file', { name: path.basename(file), bytes });
      app.addRecentDocument(file);
    } catch (error) { dialog.showErrorBox('Could not open music', error.message); }
  }
}

function fail(error) {
  if (quitting) return;
  log?.write(`${error.stack || error}\n`);
  dialog.showErrorBox('Bach to Basics could not continue', `${error.message}\n\nSee ~/Library/Logs/${app.name}/desktop.log for details.`);
  app.quit();
}

app.on('activate', () => { if (!window && backendURL && !quitting) void createWindow().catch(fail); });
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  if (backend?.pid) {
    event.preventDefault();
    try { process.kill(-backend.pid, 'SIGTERM'); } catch {}
    // Terminate music21 workers too, including a worker stuck on a malformed score.
    setTimeout(() => {
      try { process.kill(-backend.pid, 'SIGKILL'); } catch {}
      app.exit(app.exitCode || 0);
    }, 1500);
  }
});
