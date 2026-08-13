const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("studio", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  listModels: (settings) => ipcRenderer.invoke("models:list", settings),
  selectFile: () => ipcRenderer.invoke("dialog:select-file"),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  inspectMediaFiles: (filePaths) => ipcRenderer.invoke("media:inspect-files", filePaths),
  saveMarkdown: (payload) => ipcRenderer.invoke("dialog:save-markdown", payload),
  startJob: (payload) => ipcRenderer.invoke("job:start", payload),
  cancelJob: (jobId) => ipcRenderer.invoke("job:cancel", jobId),
  listLogs: () => ipcRenderer.invoke("logs:list"),
  clearLogs: () => ipcRenderer.invoke("logs:clear"),
  revealLogs: () => ipcRenderer.invoke("logs:reveal"),
  revealFile: (filePath) => ipcRenderer.invoke("file:reveal", filePath),
  onJobEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("job:event", listener);
    return () => ipcRenderer.removeListener("job:event", listener);
  },
  onOpenHelp: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("help:open", listener);
    return () => ipcRenderer.removeListener("help:open", listener);
  },
  onOpenLogs: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("logs:open", listener);
    return () => ipcRenderer.removeListener("logs:open", listener);
  },
  onOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("settings:open", listener);
    return () => ipcRenderer.removeListener("settings:open", listener);
  },
  onStartQueue: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("menu:start-queue", listener);
    return () => ipcRenderer.removeListener("menu:start-queue", listener);
  },
  onPauseQueue: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("menu:pause-queue", listener);
    return () => ipcRenderer.removeListener("menu:pause-queue", listener);
  },
  onSaveCurrent: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("menu:save-current", listener);
    return () => ipcRenderer.removeListener("menu:save-current", listener);
  },
  onAddFiles: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("menu:add-files", listener);
    return () => ipcRenderer.removeListener("menu:add-files", listener);
  }
});
