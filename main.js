// EZ Hub — Pulsar (Bibimbap) + Razer Synapse Web in one window.
const {
  app, BrowserWindow, WebContentsView, session, ipcMain, shell, Menu,
} = require('electron');
const path = require('path');
const fs = require('fs');

// ---------- config ----------
const SIDEBAR_WIDTH = 72;
const BG = '#0d0e12';

// minWidth/minHeight: the smallest page size the site works at. If its pane is
// smaller, EZ Hub zooms that page out so the site still gets that much room.
const TOOLS = {
// fit: 'zoom' = browser zoom (fine for normal sites); 'emulate' = give the page a full-size
// virtual screen and scale the picture down (needed for Flutter sites like Pulsar's).
  pulsar: { name: 'Pulsar', url: 'https://bbb.pulsar.gg/', domains: ['pulsar.gg'], minWidth: 1280, minHeight: 720, fit: 'emulate' },
  razer: { name: 'Razer', url: 'https://synapse.razer.com/', domains: ['razer.com'], minWidth: 1300, minHeight: 740, fit: 'zoom' },
};
const MODES = ['pulsar', 'razer', 'split'];
const ALLOWED_DOMAINS = Object.values(TOOLS).flatMap((t) => t.domains);

function hostAllowed(url) {
  try {
    const host = new URL(url).hostname;
    return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

// Present as plain Chrome so the sites don't reject the browser.
function chromeUserAgent() {
  const chrome = process.versions.chrome;
  const os =
    process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64'
    : process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7'
    : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}
app.userAgentFallback = chromeUserAgent();

// ---------- tiny settings store ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}
function saveSettings(s) {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); } catch { /* ignore */ }
}

// ---------- state ----------
let mainWin = null;
let views = {};
let settings = {};
let mode = 'split';
let picker = null; // { win, callback, devices, origin, done }

// ---------- layout ----------
function fitZoom(id) {
  const view = views[id];
  const tool = TOOLS[id];
  if (!view || !tool) return;
  const { width, height } = view.getBounds();
  if (!width || !height) return;
  let zoom = 1;
  if (tool.minWidth) zoom = Math.min(zoom, width / tool.minWidth);
  if (tool.minHeight) zoom = Math.min(zoom, height / tool.minHeight);
  zoom = Math.max(0.5, Math.round(zoom * 100) / 100);
  const wc = view.webContents;

  if (tool.fit === 'emulate') {
    if (wc.getZoomFactor() !== 1) wc.setZoomFactor(1);
    const key = `${width}x${height}@${zoom}`;
    if (view._emuKey !== key) {
      view._emuKey = key;
      if (zoom >= 1) {
        wc.disableDeviceEmulation();
      } else {
        wc.enableDeviceEmulation({
          screenPosition: 'desktop',
          screenSize: { width: Math.round(width / zoom), height: Math.round(height / zoom) },
          viewPosition: { x: 0, y: 0 },
          viewSize: { width: Math.round(width / zoom), height: Math.round(height / zoom) },
          deviceScaleFactor: 0,
          scale: zoom,
        });
      }
    }
  } else if (Math.abs(wc.getZoomFactor() - zoom) > 0.005) {
    wc.setZoomFactor(zoom);
  }
  // Force a full repaint so the page doesn't stay half-drawn after a resize/zoom.
  setTimeout(() => { if (!view.webContents.isDestroyed()) view.webContents.invalidate(); }, 50);
}

function layout() {
  if (!mainWin || mainWin.isDestroyed()) return;
  const [w, h] = mainWin.getContentSize();
  const x = SIDEBAR_WIDTH;
  const width = Math.max(0, w - SIDEBAR_WIDTH);

  if (mode === 'split') {
    const half = Math.floor(width / 2);
    views.pulsar.setBounds({ x, y: 0, width: half - 1, height: h });
    views.razer.setBounds({ x: x + half + 1, y: 0, width: width - half - 1, height: h });
    views.pulsar.setVisible(true);
    views.razer.setVisible(true);
  } else {
    for (const id of Object.keys(views)) {
      views[id].setBounds({ x, y: 0, width, height: h });
      views[id].setVisible(id === mode);
    }
  }
  for (const id of Object.keys(views)) fitZoom(id);
}

function sendState() {
  if (!mainWin || mainWin.isDestroyed()) return;
  const status = {};
  for (const [id, v] of Object.entries(views)) {
    status[id] = v.webContents.isLoading() ? 'loading' : (v._failed ? 'error' : 'ready');
  }
  mainWin.webContents.send('ui:state', { mode, status });
}

function setMode(m) {
  if (!MODES.includes(m)) return;
  mode = m;
  settings.mode = m;
  saveSettings(settings);
  layout();
  sendState();
  // focus the visible tool so keyboard input goes there
  const target = m === 'split' ? null : views[m];
  if (target) target.webContents.focus();
}

function reload(which) {
  const ids = which && views[which] ? [which] : (mode === 'split' ? Object.keys(views) : [mode]);
  for (const id of ids) {
    const v = views[id];
    v._failed = false;
    // If the page failed to load or navigated away, go back to the tool's start page.
    const cur = v.webContents.getURL();
    if (!cur || !hostAllowed(cur)) v.webContents.loadURL(TOOLS[id].url);
    else v.webContents.reload();
  }
}

// ---------- device grants (like Chrome: a site only sees devices you picked) ----------
// Stored per site by the exact HID interface (guid) you picked, like Chrome. A keyboard has
// several interfaces (typing, media keys, settings); granting all of them makes driver
// pages open the wrong one. Falls back to vendorId:productId only if Windows gives no guid.
const GRANTS_VERSION = 2;
function originOf(url) {
  try { return new URL(url).origin; } catch { return ''; }
}
function grantKey(d) {
  return d?.guid ? `guid:${d.guid}` : `${d?.vendorId}:${d?.productId}`;
}
function isGranted(origin, device) {
  const list = settings.hidGrants?.[originOf(origin)] || [];
  return list.includes(grantKey(device));
}
function addGrant(origin, device) {
  const o = originOf(origin);
  if (!o || !device) return;
  settings.hidGrants = settings.hidGrants || {};
  const list = (settings.hidGrants[o] = settings.hidGrants[o] || []);
  const key = grantKey(device);
  if (!list.includes(key)) {
    list.push(key);
    saveSettings(settings);
  }
}

// ---------- device picker (WebHID) ----------
function deviceSummary(d) {
  const hex = (n) => (n ?? 0).toString(16).padStart(4, '0').toUpperCase();
  return { deviceId: d.deviceId, name: d.name || 'Unknown HID device', id: `${hex(d.vendorId)}:${hex(d.productId)}` };
}

function sendPickerList() {
  if (!picker || picker.win.isDestroyed()) return;
  picker.win.webContents.send('picker:list', {
    origin: picker.origin,
    devices: picker.devices.map(deviceSummary),
  });
}

function finishPicker(deviceId) {
  if (!picker || picker.done) return;
  if (deviceId) {
    const device = picker.devices.find((d) => d.deviceId === deviceId);
    addGrant(picker.originUrl, device);
  }
  picker.done = true;
  try { picker.callback(deviceId || ''); } catch { /* request already gone */ }
  if (!picker.win.isDestroyed()) picker.win.close();
}

function openPicker(origin, originUrl, devices, callback) {
  if (picker) finishPicker(null); // cancel any older request

  const win = new BrowserWindow({
    parent: mainWin,
    modal: true,
    width: 440,
    height: 400,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    title: 'Connect a device',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: BG,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-picker.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  picker = { win, callback, devices: [...devices], origin, originUrl, done: false };

  win.loadFile(path.join(__dirname, 'picker.html'));
  win.webContents.once('did-finish-load', () => {
    win.show();
    win.focus();
    sendPickerList();
  });
  win.on('closed', () => {
    if (picker && picker.win === win) {
      if (!picker.done) { picker.done = true; try { callback(''); } catch { /* ignore */ } }
      picker = null;
    }
  });
}

function setupSession(ses) {
  // Allow HID (and other permission checks) only for the two driver sites.
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return hostAllowed(requestingOrigin);
  });
  ses.setPermissionRequestHandler((wc, _permission, cb, details) => {
    cb(hostAllowed(details?.requestingUrl || wc?.getURL() || ''));
  });
  // Only devices the user picked for this site — never every HID device on the PC.
  ses.setDevicePermissionHandler((details) => {
    if (details.deviceType !== 'hid' || !hostAllowed(details.origin)) return false;
    return isGranted(details.origin, details.device);
  });

  // Our own replacement for Chrome's "connect a device" prompt.
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const origin = details.frame?.url || '';
    const list = details.deviceList || [];
    if (!hostAllowed(origin)) { callback(''); return; }
    let host = origin;
    try { host = new URL(origin).hostname; } catch { /* keep raw */ }
    openPicker(host, origin, list, callback);
  });

  ses.on('hid-device-added', (_e, details) => {
    if (!picker || !details?.device) return;
    if (!picker.devices.some((d) => d.deviceId === details.device.deviceId)) {
      picker.devices.push(details.device);
      sendPickerList();
    }
  });
  ses.on('hid-device-removed', (_e, details) => {
    if (!picker || !details?.device) return;
    picker.devices = picker.devices.filter((d) => d.deviceId !== details.device.deviceId);
    sendPickerList();
  });
}

// ---------- tool views ----------
function createToolView(id, ses) {
  const tool = TOOLS[id];
  const view = new WebContentsView({
    webPreferences: { session: ses, contextIsolation: true, sandbox: true },
  });
  view.setBackgroundColor(BG);
  const wc = view.webContents;

  // Popups: keep Razer/Pulsar sign-in windows in the app, send everything else to the real browser.
  wc.setWindowOpenHandler(({ url }) => {
    if (hostAllowed(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: BG, parent: mainWin },
      };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!hostAllowed(url) && /^https?:/i.test(url)) { e.preventDefault(); shell.openExternal(url); }
  });

  wc.on('render-process-gone', (_e, d) => console.log(`[${id}] page crashed: ${d.reason}`));

  wc.on('did-start-loading', sendState);
  wc.on('did-stop-loading', sendState);
  wc.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) { view._failed = true; sendState(); } // -3 = aborted
  });
  wc.on('did-finish-load', () => { view._failed = false; view._emuKey = null; fitZoom(id); sendState(); });
  // Page navigations can reset zoom/emulation, so re-apply it.
  wc.on('did-navigate', () => { view._emuKey = null; fitZoom(id); });
  wc.on('did-navigate-in-page', () => fitZoom(id));

  wc.loadURL(tool.url);
  return view;
}

// ---------- menu / shortcuts ----------
function buildMenu() {
  const template = [
    {
      label: 'View',
      submenu: [
        { label: 'Pulsar', accelerator: 'CmdOrCtrl+1', click: () => setMode('pulsar') },
        { label: 'Razer', accelerator: 'CmdOrCtrl+2', click: () => setMode('razer') },
        { label: 'Split', accelerator: 'CmdOrCtrl+3', click: () => setMode('split') },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => reload() },
        { label: 'Reload both', accelerator: 'CmdOrCtrl+Shift+R', click: () => { reload('pulsar'); reload('razer'); } },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        {
          label: 'Developer tools (visible tool)',
          accelerator: 'F12',
          click: () => {
            const v = mode === 'split' ? views.pulsar : views[mode];
            v.webContents.toggleDevTools();
          },
        },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- app ----------
function createWindow() {
  settings = loadSettings();
  // Old saved grants were by model number (too broad) — clear them once.
  if (settings.hidGrantsVersion !== GRANTS_VERSION) {
    settings.hidGrants = {};
    settings.hidGrantsVersion = GRANTS_VERSION;
    saveSettings(settings);
  }
  mode =MODES.includes(settings.mode) ? settings.mode : 'split';
  const b = settings.bounds || {};

  mainWin = new BrowserWindow({
    width: b.width || 1440,
    height: b.height || 900,
    x: b.x,
    y: b.y,
    minWidth: 900,
    minHeight: 560,
    title: 'EZ Hub',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: BG,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-ui.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  if (settings.maximized) mainWin.maximize();
  mainWin.loadFile(path.join(__dirname, 'ui.html'));

  const ses = session.fromPartition('persist:ezhub');
  setupSession(ses);

  views = {
    pulsar: createToolView('pulsar', ses),
    razer: createToolView('razer', ses),
  };
  for (const v of Object.values(views)) mainWin.contentView.addChildView(v);

  layout();
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.webContents.on('did-finish-load', sendState);
  for (const evt of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    mainWin.on(evt, layout);
  }

  mainWin.on('close', () => {
    settings.maximized = mainWin.isMaximized();
    if (!settings.maximized) settings.bounds = mainWin.getBounds();
    saveSettings(settings);
  });
  mainWin.on('closed', () => { mainWin = null; views = {}; });
}

ipcMain.on('ui:mode', (_e, m) => setMode(m));
ipcMain.on('ui:reload', (_e, which) => reload(which));
ipcMain.on('ui:ready', sendState);
ipcMain.on('picker:choose', (_e, deviceId) => finishPicker(deviceId));
ipcMain.on('picker:cancel', () => finishPicker(null));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); }
  });
  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
