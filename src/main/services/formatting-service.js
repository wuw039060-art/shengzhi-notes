const { apiFetch } = require("./api-fetch");
const { getByPath } = require("./http-utils");

class FormattingService {
  async format(transcript, prompt, settings, options = {}) {
    if (!transcript.trim()) throw new Error("没有可排版的转写文本。");
    if (!settings.apiKey) throw new Error("请先填写文本排版模型 API Key。");
    if (!settings.model) throw new Error("请先选择或填写文本排版模型。");

    if (settings.provider === "anthropic") {
      return this.formatWithAnthropic(transcript, prompt, settings, options);
    }
    return this.formatWithOpenAICompatible(transcript, prompt, settings, options);
  }

  async formatWithOpenAICompatible(transcript, prompt, settings, { signal } = {}) {
    const baseUrl = (settings.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    const headers = parseHeaders(settings.customHeadersJson);
    const response = await apiFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
        ...headers
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: Number(settings.temperature ?? 0.2),
        messages: [
          {
            role: "system",
            content: "你是专业中文编辑。你正在使用文本排版模型处理 ASR 原始转写稿。只输出 Markdown 正文，不输出解释，不添加原文没有的事实。"
          },
          {
            role: "user",
            content: `${prompt || "请将原始转写稿整理为结构清晰、可直接阅读的 Markdown 文档。"}\n\n以下是原始转写稿：\n\n${transcript}`
          }
        ]
      }),
      signal
    });

    const text = await response.text();
    if (!response.ok) throw new Error(`文本排版模型调用失败：${response.status} ${text}`);

    const data = parseMaybeJson(text);
    const markdown = getByPath(data, "choices.0.message.content") || data.output_text || "";
    if (!markdown) throw new Error("文本排版模型没有返回 Markdown 内容。");
    return { markdown, raw: data };
  }

  async formatWithAnthropic(transcript, prompt, settings, { signal } = {}) {
    const baseUrl = (settings.baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
    const response = await apiFetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 8192,
        temperature: Number(settings.temperature ?? 0.2),
        system: "你是专业中文编辑。你正在使用文本排版模型处理 ASR 原始转写稿。只输出 Markdown 正文，不输出解释，不添加原文没有的事实。",
        messages: [
          {
            role: "user",
            content: `${prompt || "请将原始转写稿整理为结构清晰、可直接阅读的 Markdown 文档。"}\n\n以下是原始转写稿：\n\n${transcript}`
          }
        ]
      }),
      signal
    });

    const text = await response.text();
    if (!response.ok) throw new Error(`文本排版模型调用失败：${response.status} ${text}`);

    const data = parseMaybeJson(text);
    const markdown = getByPath(data, "content.0.text") || data.output_text || "";
    if (!markdown) throw new Error("文本排版模型没有返回 Markdown 内容。");
    return { markdown, raw: data };
  }
}

function parseHeaders(headersJson) {
  try {
    return JSON.parse(headersJson || "{}");
  } catch {
    throw new Error("文本模型自定义请求头不是合法 JSON。");
  }
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { output_text: text };
  }
}

module.exports = { FormattingService };
