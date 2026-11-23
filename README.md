<p align="center"><img src="logo.svg" width="160" alt="EZ"></p>

# EZ Hub

One window for Pulsar's web driver (Bibimbap, bbb.pulsar.gg) and Razer Synapse Web (synapse.razer.com).
Switch between them from the sidebar, or show both side by side.

Built with Electron by EZGGco.

## Run it

1. Install Node.js LTS from nodejs.org.
2. In this folder:
   ```
   npm install
   npm start
   ```

### If Electron "failed to install correctly"

Newer npm versions block package install scripts, which Electron needs to download itself. Approve them, then reinstall:
```
npm install-scripts approve electron electron-winstaller
npm rebuild electron
```
If it still fails (seen on Node 26), download and unpack Electron by hand. Use the version listed in `node_modules\electron\package.json`:
```
curl -L -o electron.zip https://github.com/electron/electron/releases/download/v37.10.3/electron-v37.10.3-win32-x64.zip
rmdir /s /q node_modules\electron\dist
mkdir node_modules\electron\dist
tar -xf electron.zip -C node_modules\electron\dist
<nul set /p ="electron.exe" > node_modules\electron\path.txt
```

## Build a standalone .exe

```
npm run dist
```
The portable `EZ Hub x.x.x.exe` ends up in `dist/`. No install needed.

## Using it

- **Sidebar:** Pulsar / Razer / Split, plus Reload. A dot on a button means that tool is loading (orange) or failed to load (red).
- **Shortcuts:** `Ctrl+1` Pulsar, `Ctrl+2` Razer, `Ctrl+3` Split, `Ctrl+R` reload the visible tool, `Ctrl+Shift+R` reload both, `F12` dev tools.
- When a site asks to connect, EZ Hub shows its own **Connect a device** window. Pick your device and click Connect.
- Each site only gets the exact device connection you picked (like Chrome), and EZ Hub remembers it between launches.
- In Split view, each side is scaled down automatically if its pane is smaller than the site needs.
- Links to other sites open in your normal browser.

## Troubleshooting

- **Razer says "Synapse desktop app running":** quit Razer Synapse from the tray, then hit Reload.
- **Device doesn't show up in the picker:** check that the device is supported by that web driver, and close the vendor's desktop app (Pulsar Fusion / Synapse), which can hold the device.
- **Page is blank or shows a red dot:** each tool needs internet for its first load. Hit Reload.
- **Change which sites it loads:** edit the `TOOLS` list at the top of `main.js`.
