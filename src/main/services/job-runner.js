const path = require("node:path");
const fs = require("node:fs/promises");

const MIMO_MAX_AUDIO_BYTES = 4_500_000;
const MIMO_RETRY_MIN_BYTES = 900_000;
const MIMO_MAX_RETRY_DEPTH = 4;
const ASR_RATE_LIMIT_MAX_RETRIES = 6;
const ASR_RATE_LIMIT_BASE_DELAY_MS = 8000;
const ASR_RATE_LIMIT_MAX_DELAY_MS = 90000;

class JobRunner {
  constructor({ mediaService, transcriptionService, formattingService, settingsStore, workspaceDir, errorLogStore, emit }) {
    this.mediaService = mediaService;
    this.transcriptionService = transcriptionService;
    this.formattingService = formattingService;
    this.settingsStore = settingsStore;
    this.workspaceDir = workspaceDir;
    this.errorLogStore = errorLogStore;
    this.emit = emit;
    this.activeJobs = new Map();
  }

  async run({ inputPath, prompt, queueId }) {
    if (this.activeJobs.size > 0) {
      return {
        ok: false,
        busy: true,
        jobId: queueId || "",
        error: "已有任务正在处理，请等待当前任务结束后再试。"
      };
    }
    const settings = this.settingsStore.get();
    const jobId = queueId || `${Date.now()}`;
    const controller = new AbortController();
    this.activeJobs.set(jobId, controller);
    const startedAt = new Date();
    let currentStage = "queued";
    let convertedAudioPath = "";
    let transcriptPath = "";

    try {
      currentStage = "started";
      this.send(jobId, "started", "开始处理文件");
      if (!inputPath) throw new Error("请先选择一个音视频文件。");
      throwIfCanceled(controller.signal);

      if (settings.asr.provider === "mimo-asr") {
        settings.media.outputFormat = "mp3";
      }

      currentStage = "probing";
      this.send(jobId, "probing", "正在检测媒体信息");
      const converted = await this.mediaService.convertToAsrAudio(inputPath, settings.media, { signal: controller.signal });
      throwIfCanceled(controller.signal);
      convertedAudioPath = converted.outputPath;
      this.send(jobId, "converted", "音频已准备好", { audioPath: converted.outputPath });

      currentStage = "splitting";
      const audioParts = await this.prepareAudioParts(jobId, converted.outputPath, settings, controller.signal);
      currentStage = "transcribing";
      this.send(jobId, "transcribing", `正在调用语音识别接口，共 ${audioParts.length} 段`);
      const transcriptResult = await this.transcribeParts(jobId, audioParts, settings.asr, controller.signal);
      throwIfCanceled(controller.signal);
      transcriptPath = await this.writeOutput("transcripts", inputPath, "txt", transcriptResult.text);
      this.send(jobId, "transcribed", "原始文字稿已生成", { transcriptPath });

      currentStage = "formatting";
      this.send(jobId, "formatting", "正在调用文本模型排版");
      const finalPrompt = prompt?.trim() || "";
      const markdownResult = await this.runWithRateLimitRetry(
        jobId,
        "formatting",
        "文本排版模型请求过于频繁，正在等待后重试",
        () => this.formattingService.format(transcriptResult.text, finalPrompt, settings.llm, { signal: controller.signal }),
        controller.signal
      );
      this.send(jobId, "completed", "Markdown 已生成，请预览后选择保存位置", {
        audioPath: converted.outputPath,
        transcriptPath,
        markdown: markdownResult.markdown
      });

      return {
        ok: true,
        jobId,
        audioPath: converted.outputPath,
        transcriptPath,
        markdown: markdownResult.markdown
      };
    } catch (error) {
      if (isCancellationError(error)) {
        this.send(jobId, "canceled", "任务已暂停");
        return { ok: false, canceled: true, jobId, error: "任务已暂停" };
      }
      const logEntry = await this.writeFailureLog({
        jobId,
        inputPath,
        convertedAudioPath,
        transcriptPath,
        startedAt,
        failedAt: new Date(),
        stage: currentStage,
        error,
        settings
      });
      this.send(jobId, "failed", error.message, { errorLogId: logEntry?.id });
      return { ok: false, jobId, error: error.message, errorLogId: logEntry?.id };
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  cancel(jobId) {
    const controller = this.activeJobs.get(jobId);
    if (!controller) return { ok: false, canceled: false };
    controller.abort();
    return { ok: true, canceled: true };
  }

  async prepareAudioParts(jobId, audioPath, settings, signal) {
    if (settings.asr.provider !== "mimo-asr") return [audioPath];
    throwIfCanceled(signal);

    const stats = await fs.stat(audioPath);
    if (stats.size <= MIMO_MAX_AUDIO_BYTES) return [audioPath];

    this.send(jobId, "splitting", "音频较长，正在自动切成适合 ASR 模型上下文限制的小段");
    const parts = await this.mediaService.splitAudioBySize(audioPath, { maxBytes: MIMO_MAX_AUDIO_BYTES, signal });
    this.send(jobId, "splitting", `已切成 ${parts.length} 段，每段会尽量控制在安全范围内`);
    return parts;
  }

  async transcribeParts(jobId, audioParts, asrSettings, signal) {
    const texts = [];

    for (let index = 0; index < audioParts.length; index += 1) {
      throwIfCanceled(signal);
      const label = `${index + 1}/${audioParts.length}`;
      const text = await this.transcribePartWithRetry(jobId, audioParts[index], asrSettings, label, 0, 0, signal);
      if (text.trim()) texts.push(text.trim());
    }

    return {
      text: texts.join("\n\n")
    };
  }

  async transcribePartWithRetry(jobId, audioPath, asrSettings, label, depth, rateLimitRetryCount, signal) {
    throwIfCanceled(signal);
    this.send(jobId, "transcribing", `正在识别第 ${label} 段`);

    try {
      const result = await this.transcriptionService.transcribe(audioPath, asrSettings, { signal });
      return result.text || "";
    } catch (error) {
      if (isRateLimitError(error) && rateLimitRetryCount < ASR_RATE_LIMIT_MAX_RETRIES) {
        const delayMs = getRateLimitDelay(rateLimitRetryCount);
        this.send(jobId, "transcribing", `语音识别接口限流，${Math.ceil(delayMs / 1000)} 秒后自动重试第 ${label} 段`);
        await delay(delayMs, signal);
        return this.transcribePartWithRetry(jobId, audioPath, asrSettings, label, depth, rateLimitRetryCount + 1, signal);
      }

      if (asrSettings.provider !== "mimo-asr" || !isContextLimitError(error) || depth >= MIMO_MAX_RETRY_DEPTH) {
        throw error;
      }

      const stats = await fs.stat(audioPath);
      const nextLimit = Math.max(MIMO_RETRY_MIN_BYTES, Math.floor(stats.size * 0.55));
      this.send(jobId, "splitting", `第 ${label} 段仍超过 ASR 模型上下文限制，正在继续切小后重试`);
      const smallerParts = await this.mediaService.splitAudioBySize(audioPath, {
        maxBytes: nextLimit,
        force: true,
        signal
      });

      const texts = [];
      for (let index = 0; index < smallerParts.length; index += 1) {
        const subLabel = `${label}.${index + 1}`;
        const text = await this.transcribePartWithRetry(jobId, smallerParts[index], asrSettings, subLabel, depth + 1, 0, signal);
        if (text.trim()) texts.push(text.trim());
      }
      return texts.join("\n\n");
    }
  }

  async runWithRateLimitRetry(jobId, stage, message, operation, signal) {
    for (let retryCount = 0; retryCount <= ASR_RATE_LIMIT_MAX_RETRIES; retryCount += 1) {
      throwIfCanceled(signal);
      try {
        return await operation();
      } catch (error) {
        if (isCancellationError(error)) throw error;
        if (!isRateLimitError(error) || retryCount >= ASR_RATE_LIMIT_MAX_RETRIES) throw error;
        const delayMs = getRateLimitDelay(retryCount);
        this.send(jobId, stage, `${message}，${Math.ceil(delayMs / 1000)} 秒后重试`);
        await delay(delayMs, signal);
      }
    }
    throw new Error("请求重试次数已用尽。");
  }

  async writeOutput(folder, inputPath, extension, content) {
    const outputDir = path.join(this.workspaceDir, folder);
    await fs.mkdir(outputDir, { recursive: true });
    const baseName = path.basename(inputPath, path.extname(inputPath)).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 80) || "output";
    const outputPath = path.join(outputDir, `${baseName}-${Date.now()}.${extension}`);
    await fs.writeFile(outputPath, content, "utf8");
    return outputPath;
  }

  async writeFailureLog({ jobId, inputPath, convertedAudioPath, transcriptPath, startedAt, failedAt, stage, error, settings }) {
    if (!this.errorLogStore) return null;
    const inputStats = await safeStat(inputPath);
    const convertedStats = await safeStat(convertedAudioPath);
    const durationMs = failedAt.getTime() - startedAt.getTime();
    const entry = {
      id: `${failedAt.getTime()}-${Math.random().toString(16).slice(2)}`,
      jobId,
      status: "failed",
      stage,
      stageLabel: STAGE_LABELS[stage] || stage,
      reason: error?.message || "未知错误",
      file: {
        name: inputPath ? path.basename(inputPath) : "未选择文件",
        path: inputPath || "",
        size: inputStats?.size || 0,
        sizeLabel: formatBytes(inputStats?.size || 0)
      },
      generated: {
        audioPath: convertedAudioPath || "",
        audioSize: convertedStats?.size || 0,
        audioSizeLabel: formatBytes(convertedStats?.size || 0),
        transcriptPath: transcriptPath || ""
      },
      timing: {
        startedAt: startedAt.toISOString(),
        failedAt: failedAt.toISOString(),
        durationMs,
        durationLabel: formatDuration(durationMs)
      },
      settings: {
        asrProvider: settings?.asr?.provider || "",
        asrModel: settings?.asr?.model || "",
        llmProvider: settings?.llm?.provider || "",
        llmModel: settings?.llm?.model || "",
        mediaOutputFormat: settings?.media?.outputFormat || ""
      },
      stack: error?.stack || ""
    };
    return this.errorLogStore.add(entry);
  }

  send(jobId, stage, message, data = {}) {
    this.emit({ jobId, stage, message, ...data, time: new Date().toISOString() });
  }
}

const STAGE_LABELS = {
  queued: "等待处理",
  started: "开始处理",
  probing: "检测媒体信息",
  splitting: "音频切片",
  transcribing: "语音识别",
  formatting: "Markdown 排版"
};

async function safeStat(filePath) {
  if (!filePath) return null;
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "未知";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return `${minutes} 分 ${restSeconds} 秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

function isContextLimitError(error) {
  const message = String(error?.message || "");
  return /maximum context length|context length|Requested token count exceeds|上下文|token/i.test(message);
}

function isRateLimitError(error) {
  const message = String(error?.message || "");
  return /429|too many requests|rate limit|rate_limit|limitation|限流|请求过于频繁/i.test(message);
}

function getRateLimitDelay(retryCount) {
  const exponential = ASR_RATE_LIMIT_BASE_DELAY_MS * 2 ** retryCount;
  const jitter = Math.floor(Math.random() * 2500);
  return Math.min(ASR_RATE_LIMIT_MAX_DELAY_MS, exponential + jitter);
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createCancellationError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(createCancellationError());
    }, { once: true });
  });
}

function throwIfCanceled(signal) {
  if (signal?.aborted) throw createCancellationError();
}

function createCancellationError() {
  const error = new Error("任务已暂停");
  error.name = "AbortError";
  return error;
}

function isCancellationError(error) {
  return error?.name === "AbortError" || /任务已暂停|aborted|abort/i.test(String(error?.message || ""));
}

module.exports = { JobRunner };
