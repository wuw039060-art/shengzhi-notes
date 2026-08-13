const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const { MediaService, MEDIA_DIALOG_EXTENSIONS } = require("./services/media-service");
const { SettingsStore } = require("./services/settings-store");
const { TranscriptionService } = require("./services/transcription-service");
const { FormattingService } = require("./services/formatting-service");
const { JobRunner } = require("./services/job-runner");
const { apiFetch } = require("./services/api-fetch");
const { ErrorLogStore } = require("./services/error-log-store");

let mainWindow;
let settingsStore;
let jobRunner;
let errorLogStore;
let mediaService;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "声织笔记",
    icon: path.join(__dirname, "../../resources/icons/app-icon.ico"),
    backgroundColor: "#f8f8f5",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

function installApplicationMenu() {
  const template = [
    {
      label: "文件",
      submenu: [
        {
          label: "添加文件",
          accelerator: "Ctrl+O",
          click: () => mainWindow?.webContents.send("menu:add-files")
        },
        {
          label: "保存当前 Markdown",
          accelerator: "Ctrl+S",
          click: () => mainWindow?.webContents.send("menu:save-current")
        },
        { type: "separator" },
        { label: "退出", role: "quit" }
      ]
    },
    {
      label: "处理",
      submenu: [
        {
          label: "开始处理队列",
          accelerator: "Ctrl+Enter",
          click: () => mainWindow?.webContents.send("menu:start-queue")
        },
        {
          label: "暂停处理",
          accelerator: "Ctrl+.",
          click: () => mainWindow?.webContents.send("menu:pause-queue")
        },
        {
          label: "打开连接设置",
          accelerator: "Ctrl+,",
          click: () => mainWindow?.webContents.send("settings:open")
        },
        { type: "separator" },
        {
          label: "查看失败日志",
          accelerator: "Ctrl+L",
          click: () => mainWindow?.webContents.send("logs:open")
        },
        {
          label: "打开日志文件",
          click: () => revealLogFile()
        }
      ]
    },
    {
      label: "视图",
      submenu: [
        { label: "实际大小", role: "resetZoom" },
        { label: "放大", role: "zoomIn" },
        { label: "缩小", role: "zoomOut" },
        { type: "separator" },
        { label: "全屏", role: "togglefullscreen" }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { label: "最小化", role: "minimize" },
        { label: "重新加载界面", role: "reload" },
        { label: "关闭窗口", role: "close" }
      ]
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "使用指南",
          click: () => mainWindow?.webContents.send("help:open")
        },
        {
          label: "失败日志",
          click: () => mainWindow?.webContents.send("logs:open")
        },
        {
          label: "关于",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "关于声织笔记",
              message: "声织笔记",
              detail: "安装包已内置 FFmpeg 和 FFprobe。其他用户安装后只需要填写 API Key，即可在 Windows 10 / Windows 11 上使用。"
            });
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function revealLogFile() {
  const logPath = getErrorLogPath();
  shell.showItemInFolder(logPath);
}

function getErrorLogPath() {
  return path.join(app.getPath("userData"), "error-logs.json");
}

function ensureWorkspaceDirs() {
  const baseDir = path.join(app.getPath("documents"), "声织笔记");
  return Promise.all([
    fs.mkdir(baseDir, { recursive: true }),
    fs.mkdir(path.join(baseDir, "converted"), { recursive: true }),
    fs.mkdir(path.join(baseDir, "transcripts"), { recursive: true }),
    fs.mkdir(path.join(baseDir, "markdown"), { recursive: true })
  ]).then(() => baseDir);
}

app.whenReady().then(async () => {
  const workspaceDir = await ensureWorkspaceDirs();
  settingsStore = new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
  errorLogStore = new ErrorLogStore(getErrorLogPath());
  await settingsStore.load();

  mediaService = new MediaService({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    workspaceDir
  });

  jobRunner = new JobRunner({
    mediaService,
    transcriptionService: new TranscriptionService(),
    formattingService: new FormattingService(),
    settingsStore,
    workspaceDir,
    errorLogStore,
    emit: (event) => mainWindow?.webContents.send("job:event", event)
  });

  installApplicationMenu();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle("settings:get", async () => settingsStore.getPublicSettings());

ipcMain.handle("settings:save", async (_event, nextSettings) => {
  await settingsStore.save(nextSettings);
  return settingsStore.getPublicSettings();
});

ipcMain.handle("models:list", async (_event, settings) => {
  const protocol = settings?.protocol || "openai-compatible";
  const baseUrl = (settings?.baseUrl || "").replace(/\/+$/, "");
  const apiKey = settings?.apiKey || "";

  if (protocol === "mimo-asr") {
    return ["mimo-v2.5-asr"];
  }
  if (protocol === "xfyun-lfasr") {
    return ["讯飞听见长音频转写"];
  }

  if (!baseUrl) throw new Error("请先填写 Base URL。");
  if (!apiKey) throw new Error("请先填写 API Key。");

  if (protocol === "anthropic-compatible") {
    const response = await apiFetch(`${baseUrl}/models`, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": settings?.anthropicVersion || "2023-06-01"
      }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`获取模型列表失败：${response.status} ${text}`);
    return parseModelList(text);
  }

  const response = await apiFetch(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...parseJsonHeaders(settings?.customHeadersJson)
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`获取模型列表失败：${response.status} ${text}`);
  return parseModelList(text);
});

ipcMain.handle("dialog:select-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择音视频文件",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "音视频文件", extensions: MEDIA_DIALOG_EXTENSIONS },
      { name: "所有文件", extensions: ["*"] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  return result.filePaths;
});

ipcMain.handle("media:inspect-files", async (_event, filePaths) => {
  const paths = Array.isArray(filePaths) ? filePaths.filter((item) => typeof item === "string" && item.trim()) : [];
  return mediaService.inspectFiles(paths);
});

ipcMain.handle("dialog:save-markdown", async (_event, { markdown, defaultName }) => {
  if (!markdown?.trim()) throw new Error("没有可保存的 Markdown 内容。");
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "保存 Markdown 文档",
    defaultPath: defaultName || "转写文档.md",
    filters: [
      { name: "Markdown 文档", extensions: ["md"] },
      { name: "文本文件", extensions: ["txt"] }
    ]
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, markdown, "utf8");
  return result.filePath;
});

ipcMain.handle("job:start", async (_event, payload) => jobRunner.run(payload));

ipcMain.handle("job:cancel", async (_event, jobId) => jobRunner.cancel(jobId));

ipcMain.handle("logs:list", async () => errorLogStore.list());

ipcMain.handle("logs:clear", async () => {
  await errorLogStore.clear();
  return [];
});

ipcMain.handle("logs:reveal", async () => revealLogFile());

ipcMain.handle("file:reveal", async (_event, filePath) => {
  if (filePath && existsSync(filePath)) shell.showItemInFolder(filePath);
});

function parseModelList(text) {
  const data = JSON.parse(text);
  const models = Array.isArray(data.data)
    ? data.data.map((item) => item.id || item.name).filter(Boolean)
    : [];
  return models.sort((a, b) => a.localeCompare(b));
}

function parseJsonHeaders(headersJson) {
  if (!headersJson) return {};
  try {
    return JSON.parse(headersJson);
  } catch {
    throw new Error("文本模型自定义请求头不是合法 JSON。");
  }
}
