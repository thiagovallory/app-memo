const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, protocol, net } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);
const THUMB_SIZE = 640;

const kiosk = process.argv.includes('--kiosk');

protocol.registerSchemesAsPrivileged([
  { scheme: 'memo', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

let win = null;
let library = { root: null, files: new Map() }; // id -> absolute path

const configFile = () => path.join(app.getPath('userData'), 'config.json');
const thumbDir = () => path.join(app.getPath('userData'), 'thumbs');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; }
}

function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2));
  return next;
}

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

async function scan(root) {
  const items = [];
  const files = new Map();

  async function walk(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(abs); continue; }
      const ext = path.extname(e.name).toLowerCase();
      const type = IMAGE_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : null;
      if (!type) continue;
      let st;
      try { st = await fsp.stat(abs); } catch { continue; }
      const rel = path.relative(root, abs).split(path.sep).join('/');
      const id = hash(rel);
      const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      files.set(id, { abs, mtime: st.mtimeMs, size: st.size });
      items.push({ id, type, name: path.basename(e.name, ext), ext: ext.slice(1), rel, folder, mtime: st.mtimeMs });
    }
  }

  await walk(root);
  library = { root, files };
  return items;
}

async function loadLibrary() {
  const { folder } = readConfig();
  if (!folder || !fs.existsSync(folder)) return { folder: null, items: [] };
  return { folder, items: await scan(folder) };
}

async function chooseFolder() {
  const res = await dialog.showOpenDialog(win, {
    title: 'Escolha a pasta com suas fotos e vídeos',
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  writeConfig({ folder: res.filePaths[0] });
  return loadLibrary();
}

// Thumbnails: decoded once by the main process, cached on disk as JPEG.
const thumbJobs = new Map();
let thumbActive = 0;
const thumbWaiting = [];

function withThumbSlot(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      thumbActive++;
      fn().then(resolve, reject).finally(() => { thumbActive--; thumbWaiting.shift()?.(); });
    };
    thumbActive < 3 ? run() : thumbWaiting.push(run);
  });
}

async function thumbFor(id) {
  const f = library.files.get(id);
  if (!f) return null;
  const out = path.join(thumbDir(), `${hash(f.abs + f.mtime + f.size)}.jpg`);
  if (fs.existsSync(out)) return out;
  if (!thumbJobs.has(out)) {
    thumbJobs.set(out, withThumbSlot(async () => {
      try {
        const img = nativeImage.createFromPath(f.abs);
        if (img.isEmpty()) return null;
        const { width, height } = img.getSize();
        const scale = THUMB_SIZE / Math.min(width, height);
        const small = scale < 1
          ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' })
          : img;
        await fsp.mkdir(thumbDir(), { recursive: true });
        await fsp.writeFile(out, small.toJPEG(82));
        return out;
      } catch { return null; } finally { thumbJobs.delete(out); }
    }));
  }
  return thumbJobs.get(out);
}

function registerProtocol() {
  protocol.handle('memo', async (request) => {
    const url = new URL(request.url);
    const [kind, id] = url.pathname.split('/').filter(Boolean);
    const f = library.files.get(id);
    if (!f) return new Response('not found', { status: 404 });
    if (kind === 'file') {
      return net.fetch(pathToFileURL(f.abs).toString(), { headers: request.headers });
    }
    if (kind === 'thumb') {
      const thumb = await thumbFor(id);
      if (!thumb) return net.fetch(pathToFileURL(f.abs).toString());
      return net.fetch(pathToFileURL(thumb).toString());
    }
    return new Response('bad request', { status: 400 });
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#07080d',
    title: 'Memo',
    // no macOS, passar fullscreen: false desativa a tela cheia, então a opção só entra no modo kiosk
    ...(kiosk ? { fullscreen: true, kiosk: true } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false));
}

app.whenReady().then(() => {
  // no Mac o menu é necessário para Cmd+Q e para copiar/colar no campo de busca
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { label: 'Visualizar', submenu: [{ role: 'togglefullscreen', label: 'Tela cheia' }] },
    ])
    : null);
  registerProtocol();

  ipcMain.handle('library:load', () => loadLibrary());
  ipcMain.handle('library:choose', () => chooseFolder());
  ipcMain.handle('window:toggleFullscreen', () => {
    win.setFullScreen(!win.isFullScreen());
    return win.isFullScreen();
  });
  ipcMain.handle('window:isFullscreen', () => win.isFullScreen());
  ipcMain.handle('app:quit', () => app.quit());

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
