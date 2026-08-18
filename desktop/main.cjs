const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = 38727;
let serverProcess;

function waitForServer(attempts = 100) {
  return new Promise((resolve, reject) => {
    const tryConnect = (remaining) => {
      const socket = net.createConnection({ host: HOST, port: PORT });
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error", () => {
        socket.destroy();
        if (remaining <= 0) reject(new Error("Místní server se nepodařilo spustit."));
        else setTimeout(() => tryConnect(remaining - 1), 100);
      });
    };
    tryConnect(attempts);
  });
}

async function createWindow() {
  const serverRoot = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "dist", "standalone")
    : path.join(__dirname, "..", "dist", "standalone");
  const serverFile = path.join(serverRoot, "server.js");
  serverProcess = spawn(process.execPath, [serverFile], {
    cwd: serverRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", HOST, PORT: String(PORT) },
    windowsHide: true,
    stdio: "ignore",
  });

  try {
    await waitForServer();
  } catch (error) {
    dialog.showErrorBox("Plánovač směn", String(error.message ?? error));
    app.quit();
    return;
  }

  const window = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1000,
    minHeight: 700,
    title: "Plánovač směn 2027",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await window.loadURL(`http://${HOST}:${PORT}/`);
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => serverProcess?.kill());
