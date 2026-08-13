const state = {
  queue: [],
  selectedTaskId: "",
  savedOutputPath: "",
  lastMarkdown: "",
  settings: null,
  activeCount: 0,
  isRunning: false,
  isPaused: false,
  draggingTaskId: "",
  contextTaskId: "",
  lastWheelMoveAt: 0
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  appShell: $("#appShell"),
  connectionStrip: $("#connectionStrip"),
  connectionTitle: $("#connectionTitle"),
  connectionDetail: $("#connectionDetail"),
  openSettingsInline: $("#openSettingsInline"),
  settingsToggle: $("#settingsToggle"),
  logsToggle: $("#logsToggle"),
  logsModal: $("#logsModal"),
  closeLogs: $("#closeLogs"),
  logsBody: $("#logsBody"),
  logsSubtitle: $("#logsSubtitle"),
  revealLogs: $("#revealLogs"),
  clearLogs: $("#clearLogs"),
  helpToggle: $("#helpToggle"),
  helpModal: $("#helpModal"),
  closeHelp: $("#closeHelp"),
  helpBody: $("#helpBody"),
  settingsPanel: $("#settingsPanel"),
  closeSettings: $("#closeSettings"),
  dropZone: $("#dropZone"),
  dropHint: $("#dropHint"),
  dropFeedback: $("#dropFeedback"),
  fileInput: $("#fileInput"),
  selectFile: $("#selectFile"),
  queueList: $("#queueList"),
  queueContextMenu: $("#queueContextMenu"),
  contextRemove: $("#contextRemove"),
  startJob: $("#startJob"),
  pauseJob: $("#pauseJob"),
  statusText: $("#statusText"),
  promptTemplate: $("#promptTemplate"),
  promptInput: $("#promptInput"),
  activePromptPreview: $("#activePromptPreview"),
  previewTitle: $("#previewTitle"),
  preview: $("#preview"),
  saveOutput: $("#saveOutput"),
  revealOutput: $("#revealOutput"),
  mediaOutputFormat: $("#mediaOutputFormat"),
  asrProvider: $("#asrProvider"),
  asrBaseUrl: $("#asrBaseUrl"),
  asrBaseUrlHint: $("#asrBaseUrlHint"),
  asrApiKey: $("#asrApiKey"),
  asrModel: $("#asrModel"),
  asrModelSelect: $("#asrModelSelect"),
  refreshAsrModels: $("#refreshAsrModels"),
  asrModelHint: $("#asrModelHint"),
  llmProvider: $("#llmProvider"),
  llmBaseUrl: $("#llmBaseUrl"),
  llmApiKey: $("#llmApiKey"),
  llmModel: $("#llmModel"),
  llmModelSelect: $("#llmModelSelect"),
  refreshModels: $("#refreshModels"),
  modelHint: $("#modelHint"),
  saveSettings: $("#saveSettings")
};

window.studio.onJobEvent((event) => {
  const task = findTask(event.jobId);
  if (task) {
    task.stage = event.stage;
    task.message = event.message;
    if (event.stage === "failed") task.status = "failed";
    if (event.stage === "completed") task.status = "completed";
    if (event.stage === "canceled") {
      task.status = "pending";
      task.stage = "queued";
      task.message = "已暂停，可重新开始";
    }
    if (event.markdown) {
      task.markdown = event.markdown;
      task.savedOutputPath = "";
    }
    renderQueue();
    if (state.selectedTaskId === task.id) renderSelectedTask();
  }

  if (!state.selectedTaskId || state.selectedTaskId === event.jobId) {
    elements.statusText.textContent = event.message;
    setStage(event.stage);
  }
});

init();

async function init() {
  state.settings = await window.studio.getSettings();
  bindSettings(state.settings);
  elements.promptTemplate.value = "liveReview";
  elements.promptInput.value = PROMPT_TEMPLATES.liveReview;
  updateConnectionState();
  setSettingsOpen(!state.settings?.ui?.hasSeenSetup);
  attachEvents();
  renderHelp();
  renderQueue();
}

function attachEvents() {
  elements.logsToggle.addEventListener("click", openLogs);
  elements.closeLogs.addEventListener("click", closeLogs);
  elements.logsModal.addEventListener("click", (event) => {
    if (event.target === elements.logsModal) closeLogs();
  });
  elements.revealLogs.addEventListener("click", () => window.studio.revealLogs());
  elements.clearLogs.addEventListener("click", clearLogs);
  elements.helpToggle.addEventListener("click", openHelp);
  elements.closeHelp.addEventListener("click", closeHelp);
  elements.helpModal.addEventListener("click", (event) => {
    if (event.target === elements.helpModal) closeHelp();
  });
  window.studio.onOpenHelp(openHelp);
  window.studio.onOpenLogs(openLogs);
  window.studio.onOpenSettings(() => setSettingsOpen(true));
  window.studio.onStartQueue(startQueue);
  window.studio.onPauseQueue(pauseQueue);
  window.studio.onSaveCurrent(saveSelectedMarkdown);
  window.studio.onAddFiles(openFileDialog);

  elements.openSettingsInline.addEventListener("click", () => setSettingsOpen(true));
  elements.settingsToggle.addEventListener("click", () => setSettingsOpen(true));
  elements.closeSettings.addEventListener("click", () => setSettingsOpen(false));

  elements.promptTemplate.addEventListener("change", () => {
    const template = PROMPT_TEMPLATES[elements.promptTemplate.value];
    if (template !== undefined) elements.promptInput.value = template;
  });

  elements.selectFile.addEventListener("click", openFileDialog);
  document.addEventListener("dragover", handleFileDragOver);
  document.addEventListener("dragleave", handleFileDragLeave);
  document.addEventListener("drop", handleFileDrop);

  elements.queueList.addEventListener("click", (event) => {
    const row = event.target.closest("[data-task-id]");
    if (!row) return;
    selectTask(row.dataset.taskId);
  });
  elements.queueList.addEventListener("contextmenu", openQueueContextMenu);
  elements.queueList.addEventListener("wheel", handleQueueWheel, { passive: false });
  elements.queueList.addEventListener("dragstart", handleQueueDragStart);
  elements.queueList.addEventListener("dragover", handleQueueDragOver);
  elements.queueList.addEventListener("drop", handleQueueDrop);
  elements.queueList.addEventListener("dragend", handleQueueDragEnd);
  elements.contextRemove.addEventListener("click", removeContextTask);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".queue-context-menu")) closeQueueContextMenu();
  });

  elements.asrProvider.addEventListener("change", () => applyAsrPreset(elements.asrProvider.value, true));
  elements.asrModelSelect.addEventListener("change", () => {
    if (elements.asrModelSelect.value) elements.asrModel.value = elements.asrModelSelect.value;
  });
  elements.refreshAsrModels.addEventListener("click", refreshAsrModelList);

  elements.llmProvider.addEventListener("change", () => {
    const preset = LLM_PRESETS[elements.llmProvider.value];
    if (!preset) return;
    elements.llmBaseUrl.value = preset.baseUrl;
    elements.llmModel.value = preset.model;
    setModelOptions(elements.llmModelSelect, preset.models, preset.model);
    elements.modelHint.textContent = preset.hint;
  });
  elements.llmModelSelect.addEventListener("change", () => {
    if (!elements.llmModelSelect.value) return;
    elements.llmModel.value = elements.llmModelSelect.value;
    const preset = LLM_PRESETS[elements.llmProvider.value];
    if (preset?.baseUrl) elements.llmBaseUrl.value = preset.baseUrl;
  });
  elements.refreshModels.addEventListener("click", refreshTextModelList);

  elements.saveSettings.addEventListener("click", async () => {
    const nextSettings = collectSettings({ markSetupSeen: true });
    state.settings = await window.studio.saveSettings(nextSettings);
    elements.statusText.textContent = "设置已保存";
    updateConnectionState();
    if (hasRequiredApiSettings(state.settings)) setSettingsOpen(false);
  });

  elements.startJob.addEventListener("click", startQueue);
  elements.pauseJob.addEventListener("click", pauseQueue);
  elements.preview.addEventListener("input", () => {
    const selected = getSelectedTask();
    if (!selected) return;
    selected.markdown = elements.preview.value;
    state.lastMarkdown = elements.preview.value;
    elements.saveOutput.disabled = !state.lastMarkdown.trim();
    renderQueue();
  });
  elements.saveOutput.addEventListener("click", saveSelectedMarkdown);
  elements.revealOutput.addEventListener("click", () => {
    const selected = getSelectedTask();
    if (selected?.savedOutputPath) window.studio.revealFile(selected.savedOutputPath);
  });
}

async function openFileDialog() {
  const result = await window.studio.selectFile();
  const paths = Array.isArray(result) ? result : [result].filter(Boolean);
  await addFiles(paths);
}

async function addFiles(paths) {
  const uniquePaths = [...new Set(paths)]
    .filter((filePath) => filePath && !state.queue.some((task) => task.path.toLowerCase() === filePath.toLowerCase()));
  if (!uniquePaths.length) {
    showDropFeedback("没有新增文件；重复文件已自动忽略。", "neutral");
    return;
  }

  elements.dropZone.classList.add("checking");
  elements.dropHint.textContent = `正在检查 ${uniquePaths.length} 个文件...`;
  let inspections;
  try {
    inspections = await window.studio.inspectMediaFiles(uniquePaths);
  } catch (error) {
    elements.dropZone.classList.remove("checking");
    elements.dropHint.textContent = "把文件拖到这里，松手即可加入";
    showDropFeedback(error.message || "文件检查失败，请重新添加。", "error");
    elements.statusText.textContent = "文件检查失败";
    return;
  }
  const accepted = inspections.filter((item) => item.accepted);
  const rejected = inspections.filter((item) => !item.accepted);

  for (const item of accepted) {
    const filePath = item.path;
    state.queue.push({
      id: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      path: filePath,
      status: "pending",
      stage: "queued",
      message: "等待处理",
      markdown: "",
      error: "",
      prompt: "",
      promptTemplate: "",
      savedOutputPath: ""
    });
  }
  elements.dropZone.classList.remove("checking");
  elements.dropHint.textContent = "把文件拖到这里，松手即可加入";
  if (!state.selectedTaskId && state.queue[0]) state.selectedTaskId = state.queue[0].id;
  updateFileInput();
  renderQueue();
  renderSelectedTask();
  if (accepted.length) elements.statusText.textContent = `已添加 ${accepted.length} 个任务，将按顺序逐个处理`;
  if (rejected.length) {
    const first = rejected[0];
    const extra = rejected.length > 1 ? `，另有 ${rejected.length - 1} 个文件未加入` : "";
    showDropFeedback(`${getFileName(first.path)}：${first.reason}${extra}`, "error");
  } else {
    showDropFeedback(`已加入 ${accepted.length} 个文件`, "success");
  }
}

function startQueue() {
  if (!hasRequiredApiSettings(state.settings)) {
    setSettingsOpen(true);
    elements.statusText.textContent = "请先完成 ASR 和文本排版模型设置";
    return;
  }
  if (!state.queue.some((task) => task.status === "pending")) {
    elements.statusText.textContent = "队列里没有等待处理的任务";
    return;
  }
  if (elements.promptTemplate.value === "custom" && !getActivePrompt()) {
    elements.statusText.textContent = "请先选择整理方式，或填写自定义 Prompt";
    elements.promptTemplate.focus();
    return;
  }
  snapshotPromptForPendingTasks();
  state.isRunning = true;
  state.isPaused = false;
  elements.statusText.textContent = "队列开始处理";
  updateRunControls();
  runNextTasks();
}

function runNextTasks() {
  if (!state.isRunning || state.isPaused) {
    updateRunControls();
    return;
  }
  if (state.activeCount > 0) {
    updateRunControls();
    return;
  }
  const task = state.queue.find((item) => item.status === "pending");
  if (task) runTask(task);

  if (state.activeCount === 0 && !state.queue.some((task) => task.status === "pending")) {
    state.isRunning = false;
    state.isPaused = false;
    elements.statusText.textContent = "队列处理完成";
    renderQueue();
  }
  updateRunControls();
}

async function runTask(task) {
  task.status = "running";
  task.message = "准备开始";
  task.prompt = task.prompt || getActivePrompt();
  task.promptTemplate = task.promptTemplate || elements.promptTemplate.value;
  state.activeCount += 1;
  renderQueue();
  if (state.selectedTaskId === task.id) renderSelectedTask();

  try {
    const result = await window.studio.startJob({
      queueId: task.id,
      inputPath: task.path,
      prompt: task.prompt
    });
    if (result.ok) {
      task.status = "completed";
      task.markdown = result.markdown || task.markdown;
      task.audioPath = result.audioPath;
      task.transcriptPath = result.transcriptPath;
      task.message = "已完成";
    } else if (result.canceled) {
      task.status = "pending";
      task.stage = "queued";
      task.message = "已暂停，可重新开始";
      task.error = "";
    } else if (result.busy) {
      task.status = "pending";
      task.stage = "queued";
      task.message = "等待前一任务完成";
    } else {
      task.status = "failed";
      task.error = result.error || "处理失败";
      task.errorLogId = result.errorLogId || "";
      task.message = task.error;
    }
  } catch (error) {
    task.status = "failed";
    task.error = error.message || "处理失败";
    task.message = task.error;
  } finally {
    state.activeCount -= 1;
    renderQueue();
    if (state.selectedTaskId === task.id) renderSelectedTask();
    if (state.isRunning && !state.isPaused) runNextTasks();
    else updateRunControls();
  }
}

async function pauseQueue() {
  if (!state.isRunning && state.activeCount === 0) return;
  state.isPaused = true;
  state.isRunning = false;
  elements.statusText.textContent = state.activeCount > 0
    ? "正在暂停，已停止派发新任务并尝试取消当前任务"
    : "队列已暂停";
  const runningTasks = state.queue.filter((task) => task.status === "running");
  for (const task of runningTasks) {
    task.message = "正在暂停";
    window.studio.cancelJob(task.id).catch(() => {});
  }
  renderQueue();
  renderSelectedTask();
  updateRunControls();
}

let fileDragLeaveTimer;

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function handleFileDragOver(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  clearTimeout(fileDragLeaveTimer);
  event.dataTransfer.dropEffect = "copy";
  elements.dropZone.classList.add("dragging");
  elements.dropHint.textContent = "松开鼠标，添加这些音视频文件";
}

function handleFileDragLeave(event) {
  if (!isFileDrag(event)) return;
  clearTimeout(fileDragLeaveTimer);
  fileDragLeaveTimer = setTimeout(resetFileDragState, 80);
}

async function handleFileDrop(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  clearTimeout(fileDragLeaveTimer);
  resetFileDragState();
  const paths = Array.from(event.dataTransfer.files || [])
    .map((file) => window.studio.getPathForFile(file))
    .filter(Boolean);
  await addFiles(paths);
}

function resetFileDragState() {
  elements.dropZone.classList.remove("dragging");
  if (!elements.dropZone.classList.contains("checking")) {
    elements.dropHint.textContent = "把文件拖到这里，松手即可加入";
  }
}

function showDropFeedback(message, tone) {
  elements.dropFeedback.textContent = message;
  elements.dropFeedback.className = `drop-feedback ${tone || "neutral"}`;
}

function selectTask(taskId) {
  state.selectedTaskId = taskId;
  renderQueue();
  renderSelectedTask();
}

function moveSelectedTask(direction) {
  const index = state.queue.findIndex((task) => task.id === state.selectedTaskId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= state.queue.length) return;
  if (state.queue[index].status === "running" || state.queue[targetIndex].status === "running") return;
  const [task] = state.queue.splice(index, 1);
  state.queue.splice(targetIndex, 0, task);
  renderQueue();
}

function removeSelectedTask() {
  const selected = getSelectedTask();
  if (!selected || selected.status === "running") return;
  state.queue = state.queue.filter((task) => task.id !== selected.id);
  state.selectedTaskId = state.queue[0]?.id || "";
  updateFileInput();
  renderQueue();
  renderSelectedTask();
}

function moveTaskById(taskId, direction) {
  state.selectedTaskId = taskId;
  moveSelectedTask(direction);
}

function openQueueContextMenu(event) {
  const row = event.target.closest("[data-task-id]");
  if (!row) return;
  event.preventDefault();
  const task = findTask(row.dataset.taskId);
  if (!task || task.status === "running") return;
  selectTask(task.id);
  state.contextTaskId = task.id;
  elements.queueContextMenu.style.left = `${event.clientX}px`;
  elements.queueContextMenu.style.top = `${event.clientY}px`;
  elements.queueContextMenu.classList.remove("hidden");
}

function closeQueueContextMenu() {
  elements.queueContextMenu.classList.add("hidden");
  state.contextTaskId = "";
}

function removeContextTask() {
  if (!state.contextTaskId) return;
  state.selectedTaskId = state.contextTaskId;
  removeSelectedTask();
  closeQueueContextMenu();
}

function handleQueueWheel(event) {
  const row = event.target.closest("[data-task-id]");
  if (!row || Math.abs(event.deltaY) < 4) return;
  const now = Date.now();
  if (now - state.lastWheelMoveAt < 180) {
    event.preventDefault();
    return;
  }
  const task = findTask(row.dataset.taskId);
  if (!task || task.status === "running") return;
  event.preventDefault();
  state.lastWheelMoveAt = now;
  moveTaskById(task.id, event.deltaY > 0 ? 1 : -1);
}

function handleQueueDragStart(event) {
  const row = event.target.closest("[data-task-id]");
  if (!row) return;
  const task = findTask(row.dataset.taskId);
  if (!task || task.status === "running") {
    event.preventDefault();
    return;
  }
  state.draggingTaskId = task.id;
  selectTask(task.id);
  row.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", task.id);
}

function handleQueueDragOver(event) {
  const row = event.target.closest("[data-task-id]");
  if (!row || !state.draggingTaskId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  document.querySelectorAll(".queue-item.drop-target").forEach((item) => item.classList.remove("drop-target"));
  row.classList.add("drop-target");
}

function handleQueueDrop(event) {
  const row = event.target.closest("[data-task-id]");
  if (!row || !state.draggingTaskId) return;
  event.preventDefault();
  reorderTask(state.draggingTaskId, row.dataset.taskId);
  handleQueueDragEnd();
}

function handleQueueDragEnd() {
  state.draggingTaskId = "";
  document.querySelectorAll(".queue-item.dragging, .queue-item.drop-target").forEach((item) => {
    item.classList.remove("dragging", "drop-target");
  });
}

function reorderTask(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const sourceIndex = state.queue.findIndex((task) => task.id === sourceId);
  const targetIndex = state.queue.findIndex((task) => task.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  if (state.queue[sourceIndex].status === "running" || state.queue[targetIndex].status === "running") return;
  const [task] = state.queue.splice(sourceIndex, 1);
  state.queue.splice(targetIndex, 0, task);
  state.selectedTaskId = task.id;
  renderQueue();
}

function renderQueue() {
  if (!state.queue.length) {
    elements.queueList.className = "queue-list empty";
    elements.queueList.textContent = "还没有任务。请添加文件，或把文件拖入窗口。";
    updateQueueButtons();
    return;
  }

  elements.queueList.className = "queue-list";
  elements.queueList.innerHTML = state.queue.map((task, index) => {
    const selected = task.id === state.selectedTaskId ? " selected" : "";
    const statusLabel = STATUS_LABELS[task.status] || task.status;
    return `
      <button class="queue-item${selected}" data-task-id="${task.id}" draggable="${task.status !== "running"}">
        <span class="queue-index">${index + 1}</span>
        <span class="queue-name">${escapeHtml(getFileName(task.path))}</span>
        <span class="queue-message">${escapeHtml(task.message || statusLabel)}</span>
        <span class="queue-status ${task.status}">${statusLabel}</span>
      </button>
    `;
  }).join("");
  updateQueueButtons();
}

function renderSelectedTask() {
  const selected = getSelectedTask();
  if (!selected) {
    elements.previewTitle.textContent = "选择队列中的任务查看结果。";
    elements.preview.value = "";
    elements.activePromptPreview.textContent = "尚未开始任务。";
    elements.preview.readOnly = false;
    elements.saveOutput.disabled = true;
    elements.revealOutput.disabled = true;
    elements.saveOutput.classList.add("hidden");
    elements.revealOutput.classList.add("hidden");
    resetStages();
    return;
  }

  elements.previewTitle.textContent = `${getFileName(selected.path)} · ${STATUS_LABELS[selected.status] || selected.status}`;
  elements.preview.value = selected.markdown || buildFailurePreview(selected) || "";
  elements.activePromptPreview.textContent = selected.prompt?.trim()
    ? selected.prompt
    : "该任务尚未开始；开始转录时会使用上方文本框中的 Prompt。";
  elements.preview.readOnly = selected.status === "failed" && !selected.markdown;
  state.lastMarkdown = selected.markdown || "";
  state.savedOutputPath = selected.savedOutputPath || "";
  const hasMarkdown = Boolean(selected.markdown?.trim());
  elements.saveOutput.disabled = !hasMarkdown;
  elements.revealOutput.disabled = !selected.savedOutputPath;
  elements.saveOutput.classList.toggle("hidden", !hasMarkdown);
  elements.revealOutput.classList.toggle("hidden", !selected.savedOutputPath);
  if (selected.stage && selected.stage !== "queued") setStage(selected.stage);
  else resetStages();
}

function buildFailurePreview(task) {
  if (task.status !== "failed") return "";
  const logLine = task.errorLogId ? `\n日志编号：${task.errorLogId}` : "";
  return `处理失败\n\n${task.error || task.message || "请检查 API 设置后重试。"}${logLine}\n\n可通过顶部菜单“处理 > 查看失败日志”查看完整错误信息。`;
}

function updateQueueButtons() {
  closeQueueContextMenu();
  updateRunControls();
}

function updateRunControls() {
  const hasPending = state.queue.some((task) => task.status === "pending");
  const canPause = state.isRunning || state.activeCount > 0;
  elements.startJob.textContent = state.isPaused && hasPending ? "继续转录" : "3. 开始转录";
  elements.startJob.disabled = !hasPending || (state.isRunning && !state.isPaused);
  elements.pauseJob.disabled = !canPause;
}

function getActivePrompt() {
  return elements.promptInput.value.trim();
}

function snapshotPromptForPendingTasks() {
  const prompt = getActivePrompt();
  const promptTemplate = elements.promptTemplate.value;
  state.queue
    .filter((task) => task.status === "pending")
    .forEach((task) => {
      task.prompt = prompt;
      task.promptTemplate = promptTemplate;
      task.message = task.message === "已暂停，可重新开始" ? task.message : "等待处理";
    });
  const selected = getSelectedTask();
  if (selected) elements.activePromptPreview.textContent = selected.prompt || "当前 Prompt 为空，将使用内置默认整理提示。";
}

function updateFileInput() {
  if (!state.queue.length) {
    elements.fileInput.value = "";
    return;
  }
  elements.fileInput.value = state.queue.length === 1
    ? state.queue[0].path
    : `已添加 ${state.queue.length} 个文件`;
}

async function saveSelectedMarkdown() {
  const selected = getSelectedTask();
  if (!selected?.markdown?.trim()) return;
  try {
    const savedPath = await window.studio.saveMarkdown({
      markdown: selected.markdown,
      defaultName: buildDefaultOutputName(selected.path)
    });
    if (!savedPath) return;
    selected.savedOutputPath = savedPath;
    state.savedOutputPath = savedPath;
    elements.revealOutput.disabled = false;
    elements.statusText.textContent = "Markdown 已保存";
    renderQueue();
  } catch (error) {
    elements.statusText.textContent = error.message || "保存失败";
  }
}

async function refreshAsrModelList() {
  elements.refreshAsrModels.disabled = true;
  elements.asrModelHint.textContent = "正在获取 ASR 模型列表...";
  try {
    const models = await window.studio.listModels({
      protocol: elements.asrProvider.value,
      baseUrl: elements.asrBaseUrl.value.trim(),
      apiKey: elements.asrApiKey.value.trim(),
      anthropicVersion: "2023-06-01"
    });
    const selectedModel = chooseBestModel(models, elements.asrProvider.value, elements.asrModel.value);
    setModelOptions(elements.asrModelSelect, models, selectedModel);
    if (selectedModel) elements.asrModel.value = selectedModel;
    elements.asrModelHint.textContent = `已识别 ${models.length} 个 ASR 模型。`;
  } catch (error) {
    const preset = ASR_PRESETS[elements.asrProvider.value];
    setModelOptions(elements.asrModelSelect, preset?.models || [], elements.asrModel.value || preset?.model);
    elements.asrModelHint.textContent = `${error.message || "获取失败"} 可使用预设列表或手动输入。`;
  } finally {
    elements.refreshAsrModels.disabled = false;
  }
}

async function refreshTextModelList() {
  elements.refreshModels.disabled = true;
  elements.modelHint.textContent = "正在获取文本排版模型列表...";
  try {
    const models = await window.studio.listModels({
      protocol: elements.llmProvider.value === "anthropic" ? "anthropic-compatible" : "openai-compatible",
      baseUrl: elements.llmBaseUrl.value.trim(),
      apiKey: elements.llmApiKey.value.trim(),
      customHeadersJson: state.settings.llm.customHeadersJson || "{}"
    });
    if (!models.length) {
      elements.modelHint.textContent = "接口可用，但没有返回模型列表。可以手动输入模型名。";
      return;
    }
    const selectedModel = chooseBestModel(models, elements.llmProvider.value, elements.llmModel.value);
    setModelOptions(elements.llmModelSelect, models, selectedModel);
    if (selectedModel) elements.llmModel.value = selectedModel;
    elements.modelHint.textContent = `已获取 ${models.length} 个文本排版模型。`;
  } catch (error) {
    const preset = LLM_PRESETS[elements.llmProvider.value];
    const fallbackModels = preset?.models || [elements.llmModel.value].filter(Boolean);
    setModelOptions(elements.llmModelSelect, fallbackModels, elements.llmModel.value || preset?.model);
    elements.modelHint.textContent = `${error.message || "获取失败"} 可使用预设列表或手动输入。`;
  } finally {
    elements.refreshModels.disabled = false;
  }
}

function bindSettings(settings) {
  elements.mediaOutputFormat.value = settings.media.outputFormat;
  elements.asrProvider.value = normalizeAsrProvider(settings.asr.provider, settings.asr.baseUrl);
  elements.asrBaseUrl.value = settings.asr.baseUrl;
  elements.asrApiKey.value = settings.asr.apiKey;
  elements.asrModel.value = settings.asr.model;
  applyAsrPreset(elements.asrProvider.value, false);
  setModelOptions(elements.asrModelSelect, ASR_PRESETS[elements.asrProvider.value]?.models || [settings.asr.model], settings.asr.model);

  elements.llmProvider.value = settings.llm.provider || "openai";
  elements.llmBaseUrl.value = settings.llm.baseUrl;
  elements.llmApiKey.value = settings.llm.apiKey;
  elements.llmModel.value = settings.llm.model;

  const preset = LLM_PRESETS[elements.llmProvider.value];
  setModelOptions(elements.llmModelSelect, preset?.models || [settings.llm.model], settings.llm.model);
  elements.modelHint.textContent = preset?.hint || "选择供应商后会填入推荐模型和 Base URL。";
}

function collectSettings(options = {}) {
  return {
    ...state.settings,
    media: {
      ...state.settings.media,
      outputFormat: elements.mediaOutputFormat.value
    },
    asr: {
      ...state.settings.asr,
      provider: elements.asrProvider.value,
      baseUrl: elements.asrBaseUrl.value.trim(),
      apiKey: elements.asrApiKey.value.trim(),
      model: elements.asrModel.value.trim()
    },
    llm: {
      ...state.settings.llm,
      provider: elements.llmProvider.value,
      baseUrl: elements.llmBaseUrl.value.trim(),
      apiKey: elements.llmApiKey.value.trim(),
      model: elements.llmModel.value.trim()
    },
    ui: {
      ...state.settings.ui,
      hasSeenSetup: options.markSetupSeen ? true : Boolean(state.settings.ui?.hasSeenSetup)
    }
  };
}

function hasRequiredApiSettings(settings) {
  return Boolean(settings?.asr?.apiKey && settings?.llm?.apiKey && settings?.llm?.baseUrl && settings?.llm?.model);
}

function updateConnectionState() {
  const ready = hasRequiredApiSettings(state.settings);
  elements.connectionStrip.classList.toggle("ready", ready);
  elements.connectionTitle.textContent = ready ? "连接已就绪" : "需要完成连接设置";
  elements.connectionDetail.textContent = ready
    ? `${getAsrLabel(state.settings.asr.provider)} · 文本排版：${state.settings.llm.model}`
    : "未配置完整时仍可先导入文件；开始转录时会引导你补全模型设置。";
}

function setSettingsOpen(open) {
  elements.appShell.classList.toggle("settings-open", open);
  elements.settingsPanel.classList.toggle("hidden", !open);
}

function getAsrLabel(provider) {
  return ASR_LABELS[provider] || "ASR";
}

function applyAsrPreset(provider, overwriteValues) {
  const preset = ASR_PRESETS[provider];
  if (!preset) return;
  if (overwriteValues) {
    elements.asrBaseUrl.value = preset.baseUrl;
    elements.asrModel.value = preset.model;
  }
  elements.asrBaseUrlHint.textContent = preset.hint;
  elements.asrModelHint.textContent = preset.modelHint;
  setModelOptions(elements.asrModelSelect, preset.models, elements.asrModel.value || preset.model);
}

function normalizeAsrProvider(provider, baseUrl = "") {
  if (baseUrl.includes("xiaomimimo.com")) return "mimo-asr";
  if (baseUrl.includes("volces.com")) return "doubao-asr";
  if (baseUrl.includes("xfyun.cn")) return "xfyun-lfasr";
  if (["openai", "xiaomi", "custom", "openai-compatible"].includes(provider)) return "openai-transcriptions-compatible";
  return provider || "mimo-asr";
}

function setModelOptions(selectElement, models, selectedModel) {
  const uniqueModels = [...new Set(models.filter(Boolean))];
  selectElement.innerHTML = "";
  for (const model of uniqueModels) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    option.selected = model === selectedModel;
    selectElement.appendChild(option);
  }
  if (selectedModel && !uniqueModels.includes(selectedModel)) {
    const option = document.createElement("option");
    option.value = selectedModel;
    option.textContent = selectedModel;
    option.selected = true;
    selectElement.prepend(option);
  }
}

function chooseBestModel(models, provider, currentModel) {
  const candidates = [...new Set(models.filter(Boolean))];
  if (!candidates.length) return currentModel || "";
  const presetModels = [
    ...(provider === "anthropic" ? ["claude-fable-5", "claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"] : []),
    ...(provider === "openai" ? ["gpt-5.5", "gpt-5", "gpt-5-mini", "gpt-5.4", "gpt-5.4-mini", "gpt-4.1"] : []),
    ...(ASR_PRESETS[provider]?.models || []),
    ...(LLM_PRESETS[provider]?.models || [])
  ];
  return presetModels.find((model) => candidates.includes(model))
    || candidates.find((model) => /latest/i.test(model))
    || currentModel && candidates.includes(currentModel) && currentModel
    || candidates[0];
}

function buildDefaultOutputName(filePath) {
  const fileName = getFileName(filePath) || "转写文档";
  return fileName.replace(/\.[^.]+$/, "") + ".md";
}

function setStage(stage) {
  const stageOrder = {
    started: 0,
    probing: 0,
    splitting: 1,
    converted: 1,
    transcribing: 2,
    transcribed: 2,
    formatting: 3,
    completed: 3
  };
  const activeStep = stageOrder[stage] || 0;
  document.querySelectorAll(".step").forEach((step, index) => {
    const stepNumber = index + 1;
    step.classList.toggle("done", activeStep > stepNumber);
    step.classList.toggle("active", activeStep === stepNumber);
  });
}

function resetStages() {
  document.querySelectorAll(".step").forEach((step) => {
    step.classList.remove("done", "active");
  });
}

function openHelp() {
  renderHelp();
  elements.helpModal.classList.remove("hidden");
}

function closeHelp() {
  elements.helpModal.classList.add("hidden");
}

function renderHelp() {
  elements.helpBody.innerHTML = HELP_GUIDE;
}

async function openLogs() {
  elements.logsModal.classList.remove("hidden");
  await renderLogs();
}

function closeLogs() {
  elements.logsModal.classList.add("hidden");
}

async function clearLogs() {
  await window.studio.clearLogs();
  await renderLogs();
}

async function renderLogs() {
  const logs = await window.studio.listLogs();
  elements.logsSubtitle.textContent = logs.length
    ? `共 ${logs.length} 条失败记录，最新记录在最上方。`
    : "暂无失败记录。任务失败后会自动记录文件、阶段、耗时和错误原因。";

  if (!logs.length) {
    elements.logsBody.innerHTML = `<div class="logs-empty">还没有错误日志。</div>`;
    return;
  }

  elements.logsBody.innerHTML = logs.map((log) => `
    <article class="log-entry">
      <div class="log-entry-header">
        <div>
          <h3>${escapeHtml(log.file?.name || "未命名文件")}</h3>
          <p>${escapeHtml(formatDateTime(log.timing?.failedAt))} · ${escapeHtml(log.stageLabel || log.stage || "未知阶段")}</p>
        </div>
        <span>${escapeHtml(log.timing?.durationLabel || "未知耗时")}</span>
      </div>
      <dl class="log-grid">
        <div><dt>文件大小</dt><dd>${escapeHtml(log.file?.sizeLabel || "未知")}</dd></div>
        <div><dt>处理阶段</dt><dd>${escapeHtml(log.stageLabel || log.stage || "未知")}</dd></div>
        <div><dt>ASR</dt><dd>${escapeHtml(compactPair(log.settings?.asrProvider, log.settings?.asrModel))}</dd></div>
        <div><dt>文本模型</dt><dd>${escapeHtml(compactPair(log.settings?.llmProvider, log.settings?.llmModel))}</dd></div>
      </dl>
      <div class="log-reason">
        <strong>出错原因</strong>
        <p>${escapeHtml(log.reason || "未知错误")}</p>
      </div>
      <details>
        <summary>展开技术细节</summary>
        <pre>${escapeHtml(buildLogDetails(log))}</pre>
      </details>
    </article>
  `).join("");
}

function buildLogDetails(log) {
  return [
    `日志编号：${log.id || ""}`,
    `任务编号：${log.jobId || ""}`,
    `文件路径：${log.file?.path || ""}`,
    `中间音频：${log.generated?.audioPath || "未生成"}`,
    `中间音频大小：${log.generated?.audioSizeLabel || "0 B"}`,
    `原始转写稿：${log.generated?.transcriptPath || "未生成"}`,
    `开始时间：${formatDateTime(log.timing?.startedAt)}`,
    `失败时间：${formatDateTime(log.timing?.failedAt)}`,
    `媒体格式：${log.settings?.mediaOutputFormat || ""}`,
    "",
    log.stack || log.reason || ""
  ].join("\n");
}

function compactPair(left, right) {
  return [left, right].filter(Boolean).join(" / ") || "未记录";
}

function formatDateTime(value) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function findTask(id) {
  return state.queue.find((task) => task.id === id);
}

function getSelectedTask() {
  return findTask(state.selectedTaskId);
}

function getFileName(filePath) {
  return String(filePath || "").split(/[\\/]/).pop() || "";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STATUS_LABELS = {
  pending: "等待中",
  running: "处理中",
  completed: "已完成",
  failed: "失败"
};

const ASR_PRESETS = {
  "openai-transcriptions-compatible": {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-transcribe",
    models: ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"],
    hint: "会请求 Base URL + /audio/transcriptions，使用 Bearer API Key。",
    modelHint: "适用于 OpenAI 官方语音转写接口，或兼容 /audio/transcriptions 的服务。"
  },
  "mimo-asr": {
    baseUrl: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2.5-asr",
    models: ["mimo-v2.5-asr"],
    hint: "会请求 Base URL + /chat/completions，请求头使用 api-key，音频按接口要求转为 data URL。",
    modelHint: "当前仅支持 mimo-v2.5-asr。软件会按 ASR 接口限制自动切片，必要时继续切小并重试。"
  },
  "doubao-asr": {
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-asr-1-0",
    models: ["doubao-seed-asr-1-0", "doubao-asr"],
    hint: "会按火山方舟 OpenAI-compatible 地址请求 /audio/transcriptions；如果你的控制台模型名不同，点击刷新或手动输入。",
    modelHint: "适用于豆包/火山引擎提供的 ASR 模型；最终以控制台开通和接口返回的模型列表为准。"
  },
  "xfyun-lfasr": {
    baseUrl: "https://raasr.xfyun.cn/api",
    model: "讯飞听见长音频转写",
    models: ["讯飞听见长音频转写"],
    hint: "使用讯飞听见长音频转写 prepare / upload / merge / getResult 流程。ASR API Key 请填 app_id:secret_key。",
    modelHint: "讯飞听见不是 OpenAI 协议，不需要模型名；这里保留名称只是方便队列显示。"
  },
  "openai-chat-audio-compatible": {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-audio-preview",
    models: ["gpt-4o-audio-preview", "gpt-4o-mini-audio-preview"],
    hint: "会请求 Base URL + /chat/completions，并用 OpenAI input_audio 格式传入音频。",
    modelHint: "适用于支持 Chat Completions 音频输入的 OpenAI-compatible 服务。"
  },
  "anthropic-compatible": {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-fable-5",
    models: ["claude-fable-5", "claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"],
    hint: "会请求 Base URL + /messages。仅适用于支持音频输入的 Anthropic-compatible 服务。",
    modelHint: "如果服务不支持音频输入，这个模式会失败。"
  },
  "custom-asr": {
    baseUrl: "",
    model: "",
    models: [],
    hint: "自定义 OpenAI-compatible ASR 网关，会请求 Base URL + /audio/transcriptions。",
    modelHint: "适用于兼容 OpenAI 语音转写接口的第三方服务；点击刷新可尝试读取模型列表。"
  }
};

const ASR_LABELS = {
  "openai-transcriptions-compatible": "OpenAI 语音转写",
  "mimo-asr": "小米 MiMo ASR",
  "doubao-asr": "豆包 / 火山 ASR",
  "xfyun-lfasr": "讯飞听见转写",
  "openai-chat-audio-compatible": "Chat 音频",
  "anthropic-compatible": "Anthropic 兼容实验",
  "custom-asr": "自定义 ASR"
};

const LLM_PRESETS = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.5",
    models: ["gpt-5.5", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini", "gpt-4o"],
    hint: "OpenAI 官方 API Base URL；点击刷新后会以接口实际返回的模型列表为准。"
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    models: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
    hint: "DeepSeek 官方 OpenAI-compatible Base URL。"
  },
  tongyi: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    models: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen-long"],
    hint: "阿里云百炼 OpenAI 兼容地址；企业空间可换成 Workspace 专属域名。"
  },
  doubao: {
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-1-6-250615",
    models: ["doubao-seed-1-6-250615", "doubao-seed-1-6-flash-250615", "doubao-1-5-pro-32k-250115"],
    hint: "火山引擎 Ark OpenAI-compatible 地址。"
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-fable-5",
    models: ["claude-fable-5", "claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"],
    hint: "Anthropic 官方 Base URL，文本排版会使用 /messages 协议；点击刷新后会以接口实际返回的模型列表为准。"
  },
  custom: {
    baseUrl: "",
    model: "",
    models: [],
    hint: "自定义 OpenAI-compatible 网关，需要手动填写 Base URL 和模型名。"
  }
};

const PROMPT_TEMPLATES = {
  custom: "",
  speech: `请将以下演讲转写稿整理为 Markdown 演讲稿。
通用规则：轻度整理，强保留原文。只去除明显口误、无意义停顿、少量口头禅和机械重复，不要过度提炼，不要大幅改写，不要把正文压缩成摘要。正文原文保留程度控制在 70% 到 80% 左右。
要求：
1. 按演讲的自然推进划分大主题，如开场、背景、核心观点、论据案例、转折、总结号召。
2. 每个大主题标题下先写 1-2 句话主题总结；内容复杂时可写 3-5 句话。
3. 主题总结下方保留大量演讲者原话，尽量保持原有论证顺序、情绪推进、表达节奏和关键措辞。
4. 不要改写成论文腔或新闻稿，不要大量去重，不要只保留结论。
5. 对关键概念、判断、结论、重要数据和行动号召做加粗处理。
6. 文末输出“金句摘录”“重点内容”“关键反馈/听众反应”“重要数据与事实”“行动建议”。`,
  blog: `请将以下博客、文章或长文转写稿整理为 Markdown 文稿。
通用规则：轻度整理，强保留原文。只去除明显口误、无意义停顿、少量口头禅和机械重复，不要过度提炼，不要大幅改写，不要把正文压缩成摘要。正文原文保留程度控制在 70% 到 80% 左右。
要求：
1. 按文章主题、背景、核心观点、论据案例、方法步骤、结论延伸分层组织。
2. 每个大主题标题下先写 1-2 句话主题总结；内容复杂时可写 3-5 句话。
3. 主题总结下方尽可能保留作者原话，保留论证顺序、关键措辞、例子和转折关系。
4. 不要改写成营销稿或摘要稿，不要大量去重，不要只保留结论。
5. 对核心判断、重要概念、关键数据、方法步骤和结论做加粗处理。
6. 文末输出“金句摘录”“重点内容”“关键反馈/读者问题”“重要数据与事实”“可延伸选题”。`,
  podcast: `请将以下播客转写稿整理为结构清晰的 Markdown 文档。
通用规则：轻度整理，强保留原文。只去除明显口误、无意义停顿、少量口头禅和机械重复，不要过度提炼，不要大幅改写，不要把正文压缩成摘要。正文原文保留程度控制在 70% 到 80% 左右。
要求：
1. 按讨论主题做分级标题，不要简单按时间顺序堆砌，也不要只提炼最重要观点。
2. 每个大主题标题下先写 1-2 句话主题总结；内容复杂时可写 3-5 句话。
3. 主题总结下方尽可能保留主持人与嘉宾的原话，可用 Q / A 或对话段落呈现。
4. 只平滑处理中断、插话和跳跃造成的阅读障碍，不要编造新信息，不要把长回答改写成短摘要。
5. 对重点观点、关键判断、重要名词、数字和结论做加粗处理。
6. 保留人物表达风格、对话脉络和典型措辞，删去无意义寒暄、明显口癖和机械重复。
7. 文末输出“金句摘录”“重点内容”“关键反馈/听众反应”“重要数据与事实”“后续可追问的问题”。`,
  launch: `请将以下发布会或产品介绍转写稿整理为 Markdown 发布会纪要。
通用规则：轻度整理，强保留原文。只去除明显口误、无意义停顿、少量口头禅和机械重复，不要过度提炼，不要大幅改写，不要把正文压缩成摘要。正文原文保留程度控制在 70% 到 80% 左右。
要求：
1. 按发布主题、产品版本、核心功能、价格权益、发布时间、适用人群、现场 Q&A、待确认信息分区。
2. 每个大主题标题下先写 1-2 句话主题总结；信息密集时可写 3-5 句话。
3. 主题总结下方尽可能保留发布者原话，尤其是产品描述、场景解释、卖点表述和现场问答。
4. 明确保留数字、版本号、型号、时间、价格、权益、限制条件等关键信息，不要改写导致含义漂移。
5. 如需表格，只用于补充梳理功能点，并保留“原文依据”；不要用表格替代大段正文原话。
6. 对重点卖点、关键参数、重要结论、反馈和数据做加粗处理。
7. 文末输出“金句摘录”“重点内容”“关键反馈/现场问答”“重要数据与事实”“待确认信息”。`,
  meeting: `请将以下会议录音转写稿整理为 Markdown 会议纪要。
通用规则：轻度整理，强保留原文。只去除明显口误、无意义停顿、少量口头禅和机械重复，不要过度提炼，不要大幅改写，不要把正文压缩成摘要。正文原文保留程度控制在 70% 到 80% 左右。
要求：
1. 按会议主题、背景、讨论议题、决策事项、行动项、风险与未解决问题分区。
2. 每个大主题标题下先写 1-2 句话主题总结；讨论复杂时可写 3-5 句话。
3. 主题总结下方尽可能保留参会者原话，尤其是不同立场、争议点、关键判断、风险提醒和决策依据。
4. 可以将“决策”和“行动项”放在前面方便执行，但正文讨论过程仍要保留足够原文，不要只输出待办清单。
5. 自动归纳待办事项，包含负责人、任务、截止时间、依赖条件；没有提到则写“未明确”。
6. 对决策、截止时间、责任人、关键风险、重要数据和关键反馈做加粗处理。
7. 文末输出“金句摘录/关键原话”“重点内容”“关键反馈与分歧”“重要数据与事实”“行动项汇总”。`,
  course: `请将以下课程或培训转写稿整理为 Markdown 学习笔记。
通用规则：轻度整理，强保留原文。只去除明显口误、无意义停顿、少量口头禅和机械重复，不要过度提炼，不要大幅改写，不要把正文压缩成摘要。正文原文保留程度控制在 70% 到 80% 左右。
要求：
1. 按知识点分层组织标题，保留课程讲解顺序和知识递进。
2. 每个大主题标题下先写 1-2 句话主题总结；知识点密集时可写 3-5 句话。
3. 主题总结下方尽可能保留老师原话，尤其是定义、步骤、公式、命令、示例、类比、提醒和常见误区。
4. 不要把课程压缩成提纲；提纲可以有，但正文需要保留大量讲解原文。
5. 对核心概念、重点步骤、注意事项、结论、重要数据和关键事实做加粗处理。
6. 代码、命令和配置内容使用代码块，并尽量保留原始上下文说明。
7. 文末输出“金句摘录/关键原话”“重点内容”“关键反馈/常见问题”“重要数据与事实”“复习清单”和 5 道自测题。`,
  interview: `请将以下访谈转写稿整理为 Markdown 访谈稿。
通用规则：轻度整理，强保留原文。只去除明显口误、无意义停顿、少量口头禅和机械重复，不要过度提炼，不要大幅改写，不要把正文压缩成摘要。正文原文保留程度控制在 70% 到 80% 左右。
要求：
1. 尽量识别提问与回答，并用 Q / A 结构或清晰对话段落呈现。
2. 按主题分组，不要只按时间顺序堆砌，也不要把回答压缩成观点列表。
3. 每个大主题标题下先写 1-2 句话主题总结；内容复杂时可写 3-5 句话。
4. 主题总结下方尽可能保留提问者和被访者原话，尤其是人物立场、经历细节、判断依据和情绪表达。
5. 只平滑处理打断、插话和零碎回答，让问答关系清楚连贯；不要大量去重或替换表达。
6. 对重要观点、关键判断、人物立场、关键反馈和重要数据做加粗处理。
7. 文末输出“金句摘录”“重点内容”“关键反馈/人物立场”“重要数据与事实”“延伸问题”。`,
  liveReview: `请将以下直播或活动转写稿整理为 Markdown 复盘文档。
通用规则：轻度整理，强保留原文。只去除明显口误、无意义停顿、少量口头禅和机械重复，不要过度提炼，不要大幅改写，不要把正文压缩成摘要。正文原文保留程度控制在 70% 到 80% 左右。
要求：
1. 不要只提炼直播中最重要的内容；复盘正文要以保留直播原文为主。
2. 按活动主题、流程回顾、重点内容、观众问题、精彩片段、问题与改进组织。
3. 每个大主题标题下先写 1-2 句话主题总结；信息密集时可写 3-5 句话。
4. 主题总结下方尽可能保留主讲人、嘉宾或观众互动的原话，保留直播中的解释、铺垫、例子、反馈和现场语气。
5. 只删去无意义停顿、明显口癖、机械重复和完全跑题内容，不要进行大量去重。
6. 对重点内容、关键反馈、用户问题、重要数据、后续动作和待改进事项做加粗处理。
7. 文末输出“金句摘录”“重点内容”“关键反馈/用户问题”“重要数据与事实”“后续动作与改进”。`
};

const HELP_GUIDE = `
  <h3>一、安装与环境</h3>
  <ol>
    <li>安装包已经内置 FFmpeg 和 FFprobe，其他电脑不需要提前安装 FFmpeg、Python、Node.js 或任何本地模型。</li>
    <li>支持 Windows 10 和 Windows 11 的 64 位系统。安装后打开软件，填写 API Key 即可使用。</li>
    <li>软件会把中间文件保存到“文档 / 声织笔记”目录，最终 Markdown 由你手动选择保存位置。</li>
  </ol>
  <h3>二、首次配置</h3>
  <ol>
    <li>第一次打开时，连接设置会自动展开。</li>
    <li>ASR 用于语音识别，把音频转成原始文字稿；文本排版模型用于把原始文字稿整理成 Markdown，两者是两套独立设置。</li>
    <li>ASR 供应商可选 OpenAI、小米 MiMo、豆包 / 火山引擎、讯飞听见，以及自定义 OpenAI-compatible ASR。</li>
    <li>讯飞听见不是 OpenAI 协议，使用长音频转写流程；ASR API Key 请填写 <code>app_id:secret_key</code>，或 JSON：<code>{"app_id":"...","secret_key":"..."}</code>。</li>
    <li>文本排版模型可选 OpenAI、Anthropic、DeepSeek、通义千问、豆包等；点击“刷新”会读取当前 Base URL 和 API Key 实际可用的模型列表。</li>
    <li>内置模型名只是首次配置的候选项，真正处理时以你选择的模型名为准；如果供应商升级了模型，优先点击刷新并选择接口返回的新模型。</li>
  </ol>
  <h3>三、多文件队列</h3>
  <ol>
    <li>点击“添加文件”或把一个、多个文件拖到窗口任意位置，可以一次加入多个音频或视频。</li>
    <li>文件加入前会自动检测是否包含可识别的音轨；不支持或损坏的文件会直接说明原因，不会进入队列。</li>
    <li>左键点击任务即可选中；按住鼠标左键上下拖动，可以调整处理顺序。</li>
    <li>鼠标放在任务上使用滚轮，也可以让该任务上移或下移。</li>
    <li>右键点击任务会弹出“移除”按钮，可删除未开始或失败的任务。</li>
    <li>多个任务始终按照队列顺序逐个处理，同一时间只调用一个任务，减少接口并发、限流和超时。</li>
  </ol>
  <h3>四、Prompt 模板</h3>
  <p>你可以选择演讲稿、播客、发布会、会议、课程笔记、访谈、直播复盘等模板。所有内置模板都默认遵循：去除口语和重复成分，除此之外尽可能保留原文。模板只是起点，选中后仍然可以修改；选择“自定义 Prompt”则完全由你自己填写 Prompt。</p>
  <h3>五、输出与保存</h3>
  <p>每个任务完成后，选中该任务即可在“输出预览”中查看 Markdown。软件不会擅自保存最终文档，你可以先修改预览区内容，再点击“保存 Markdown”选择位置。</p>
  <h3>六、常见问题</h3>
  <ul>
    <li>如果提示 API Key 错误，先检查 ASR 和文本排版模型是否分别填写了 Key。</li>
    <li>如果 ASR 报 404，说明所选供应商的底层协议和 Base URL 不匹配，需要切换供应商或改成自定义 ASR。</li>
    <li>如果刷新模型失败，可以先使用预设模型或手动输入控制台里开通的模型名。</li>
    <li>如果长音频较慢，这是因为软件正在按 ASR 模型上下文限制自动切片并逐段识别。</li>
    <li>如果接口限流，软件会等待后自动重试；任务队列不会并发占用接口。</li>
  </ul>
`;
