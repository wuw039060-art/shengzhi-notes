const fs = require("node:fs/promises");

const DEFAULT_SETTINGS = {
  media: {
    outputFormat: "wav",
    sampleRate: 16000,
    channels: 1,
    keepIntermediateFiles: true
  },
  asr: {
    provider: "openai-transcriptions-compatible",
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-transcribe",
    language: "zh",
    responseFormat: "json",
    anthropicVersion: "2023-06-01"
  },
  llm: {
    provider: "openai",
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.5",
    temperature: 0.2,
    customHeadersJson: "{}"
  },
  prompt: {
    defaultPrompt: "请将以下语音转写稿整理为结构清晰的 Markdown 文档。要求：轻度整理，强保留原文；只去除明显口误、无意义停顿、少量口头禅和机械重复；按大主题分段，每个大主题前写 1-2 句主题总结，复杂内容可写 3-5 句；主题总结下方尽可能保留正文原话，原文保留程度控制在 70% 到 80% 左右；文末整理金句摘录、重点内容、关键反馈和重要数据；不要编造原文没有的信息。"
  },
  ui: {
    hasSeenSetup: false
  }
};

class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.settings = structuredClone(DEFAULT_SETTINGS);
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.settings = normalizeSettings(mergeSettings(DEFAULT_SETTINGS, migrateSettings(JSON.parse(raw))));
    } catch {
      await this.save(this.settings);
    }
  }

  async save(nextSettings) {
    this.settings = normalizeSettings(mergeSettings(DEFAULT_SETTINGS, nextSettings));
    await fs.mkdir(require("node:path").dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.settings, null, 2), "utf8");
  }

  get() {
    return structuredClone(this.settings);
  }

  getPublicSettings() {
    return this.get();
  }
}

function normalizeSettings(settings) {
  const normalized = structuredClone(settings);
  const baseUrl = normalized.asr.baseUrl || "";
  if (baseUrl.includes("xiaomimimo.com")) {
    normalized.asr.provider = "mimo-asr";
    normalized.asr.model = "mimo-v2.5-asr";
  } else if (baseUrl.includes("volces.com")) {
    normalized.asr.provider = "doubao-asr";
  } else if (baseUrl.includes("xfyun.cn")) {
    normalized.asr.provider = "xfyun-lfasr";
  } else if (["openai", "xiaomi", "custom", "openai-compatible"].includes(normalized.asr.provider)) {
    normalized.asr.provider = "openai-transcriptions-compatible";
  }
  delete normalized.asr.custom;
  return normalized;
}

function migrateSettings(settings) {
  if (!settings || typeof settings !== "object") return settings;
  const migrated = structuredClone(settings);
  if (!migrated.ui || typeof migrated.ui.hasSeenSetup !== "boolean") {
    migrated.ui = {
      ...migrated.ui,
      hasSeenSetup: hasRequiredApiSettings(migrated)
    };
  }
  return migrated;
}

function hasRequiredApiSettings(settings) {
  return Boolean(settings?.asr?.apiKey && settings?.llm?.apiKey && settings?.llm?.baseUrl && settings?.llm?.model);
}

function mergeSettings(base, override) {
  if (!override || typeof override !== "object") return structuredClone(base);
  const result = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key]) {
      result[key] = mergeSettings(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

module.exports = { SettingsStore };
