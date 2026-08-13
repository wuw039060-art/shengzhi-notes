const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { apiFetch } = require("./api-fetch");
const { requestMultipart, getByPath } = require("./http-utils");

const XFYUN_SLICE_BYTES = 10 * 1024 * 1024;
const XFYUN_MAX_POLLS = 120;
const XFYUN_POLL_INTERVAL_MS = 5000;

class TranscriptionService {
  async transcribe(audioPath, settings, options = {}) {
    if (settings.provider === "mimo-asr" || isMiMoBaseUrl(settings.baseUrl)) {
      return this.transcribeWithMiMoAsr(audioPath, settings, options);
    }
    if (settings.provider === "xfyun-lfasr") {
      return this.transcribeWithXfyunLfasr(audioPath, settings, options);
    }
    if (settings.provider === "openai-chat-audio-compatible") {
      return this.transcribeWithOpenAIChatAudio(audioPath, settings, options);
    }
    if (settings.provider === "anthropic-compatible") {
      return this.transcribeWithAnthropicCompatible(audioPath, settings, options);
    }
    return this.transcribeWithOpenAITranscriptions(audioPath, settings, options);
  }

  async transcribeWithOpenAITranscriptions(audioPath, settings, { signal } = {}) {
    assertRequired(settings.apiKey, "请先填写语音识别 API Key。");
    assertRequired(settings.model, "请先选择或填写 ASR 模型。");

    const baseUrl = normalizeBaseUrl(settings.baseUrl || "https://api.openai.com/v1");
    const url = buildOpenAITranscriptionUrl(baseUrl);
    const response = await requestMultipart(url, {
      headers: {
        Authorization: `Bearer ${settings.apiKey}`
      },
      fields: {
        model: settings.model,
        language: settings.language || "",
        response_format: settings.responseFormat || "json"
      },
      file: {
        field: "file",
        path: audioPath
      },
      signal
    });

    if (!response.ok) {
      throw new Error(`语音识别失败：${response.status}。请求地址：${url}。如果这里是 404，说明该服务不支持 /audio/transcriptions，请改选对应的 ASR 协议。返回内容：${response.text}`);
    }

    const data = parseMaybeJson(response.text);
    if (typeof data === "string") return { text: data, raw: data };
    return { text: data.text || data.result || "", raw: data };
  }

  async transcribeWithOpenAIChatAudio(audioPath, settings, { signal } = {}) {
    assertRequired(settings.apiKey, "请先填写语音识别 API Key。");
    assertRequired(settings.model, "请先选择或填写 ASR 模型。");

    const baseUrl = normalizeBaseUrl(settings.baseUrl || "https://api.openai.com/v1");
    const url = buildChatCompletionsUrl(baseUrl);
    const audioBase64 = await fs.readFile(audioPath, "base64");
    const response = await apiFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "请对这段音频做逐字语音识别，只输出原始文字稿，不要总结，不要排版，不要添加原音频没有的信息。"
              },
              {
                type: "input_audio",
                input_audio: {
                  data: audioBase64,
                  format: getOpenAIAudioFormat(audioPath)
                }
              }
            ]
          }
        ]
      }),
      signal
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`语音识别失败：${response.status}。请求地址：${url}。返回内容：${text}`);
    }

    const data = parseMaybeJson(text);
    return { text: extractChatText(data), raw: data };
  }

  async transcribeWithMiMoAsr(audioPath, settings, { signal } = {}) {
    assertRequired(settings.apiKey, "请先填写 MiMo API Key。");

    const baseUrl = normalizeBaseUrl(settings.baseUrl || "https://api.xiaomimimo.com/v1");
    const url = buildChatCompletionsUrl(baseUrl);
    const audioBase64 = await fs.readFile(audioPath, "base64");
    const mimeType = guessAudioMime(audioPath);
    const model = settings.model || "mimo-v2.5-asr";
    const response = await apiFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": settings.apiKey
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: {
                  data: `data:${mimeType};base64,${audioBase64}`
                }
              }
            ]
          }
        ],
        asr_options: {
          language: settings.language || "zh"
        }
      }),
      signal
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`语音识别失败：${response.status}。请求地址：${url}。返回内容：${text}`);
    }

    const data = parseMaybeJson(text);
    return { text: extractChatText(data), raw: data };
  }

  async transcribeWithAnthropicCompatible(audioPath, settings, { signal } = {}) {
    assertRequired(settings.apiKey, "请先填写语音识别 API Key。");
    assertRequired(settings.model, "请先选择或填写 ASR 模型。");

    const baseUrl = normalizeBaseUrl(settings.baseUrl || "https://api.anthropic.com/v1");
    const url = `${baseUrl}/messages`;
    const audioBase64 = await fs.readFile(audioPath, "base64");
    const mimeType = guessAudioMime(audioPath);
    const response = await apiFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": settings.anthropicVersion || "2023-06-01"
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "请对这个音频做逐字语音识别，只输出原始文字稿，不要总结，不要排版。"
              },
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: mimeType,
                  data: audioBase64
                }
              }
            ]
          }
        ]
      }),
      signal
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`语音识别失败：${response.status}。请求地址：${url}。返回内容：${text}`);
    }

    const data = parseMaybeJson(text);
    return { text: getByPath(data, "content.0.text") || data.text || "", raw: data };
  }

  async transcribeWithXfyunLfasr(audioPath, settings, { signal } = {}) {
    const { appId, secretKey } = parseXfyunCredentials(settings.apiKey);
    const baseUrl = normalizeBaseUrl(settings.baseUrl || "https://raasr.xfyun.cn/api");
    const stats = await fs.stat(audioPath);
    const fileName = path.basename(audioPath);
    const sliceNum = Math.max(1, Math.ceil(stats.size / XFYUN_SLICE_BYTES));

    const prepared = await xfyunFormRequest(baseUrl, "prepare", appId, secretKey, {
      file_len: String(stats.size),
      file_name: fileName,
      slice_num: String(sliceNum),
      lfasr_type: "0",
      has_participle: "false",
      has_smooth: "true",
      language: mapXfyunLanguage(settings.language)
    }, signal);
    const taskId = prepared.data || prepared.task_id;
    if (!taskId) throw new Error(`讯飞听见转写失败：prepare 未返回 task_id。返回内容：${JSON.stringify(prepared)}`);

    const fileBuffer = await fs.readFile(audioPath);
    const sliceIds = new SliceIdGenerator();
    for (let index = 0; index < sliceNum; index += 1) {
      const start = index * XFYUN_SLICE_BYTES;
      const end = Math.min(fileBuffer.length, start + XFYUN_SLICE_BYTES);
      throwIfCanceled(signal);
      await xfyunUploadSlice(baseUrl, appId, secretKey, {
        taskId,
        sliceId: sliceIds.next(),
        fileName,
        content: fileBuffer.subarray(start, end)
      }, signal);
    }

    await xfyunFormRequest(baseUrl, "merge", appId, secretKey, { task_id: taskId }, signal);
    await waitForXfyunResult(baseUrl, appId, secretKey, taskId, signal);
    const result = await xfyunFormRequest(baseUrl, "getResult", appId, secretKey, { task_id: taskId }, signal);
    return { text: parseXfyunResult(result), raw: result };
  }
}

function extractChatText(data) {
  const content = getByPath(data, "choices.0.message.content") || data.output_text || data.text || "";
  if (Array.isArray(content)) {
    return content.map((item) => item.text || item.content || "").join("\n").trim();
  }
  return String(content || "").trim();
}

function buildOpenAITranscriptionUrl(baseUrl) {
  if (/\/audio\/transcriptions\/?$/.test(baseUrl)) return baseUrl;
  return `${baseUrl}/audio/transcriptions`;
}

function buildChatCompletionsUrl(baseUrl) {
  if (/\/chat\/completions\/?$/.test(baseUrl)) return baseUrl;
  return `${baseUrl}/chat/completions`;
}

function getOpenAIAudioFormat(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  if (["mp3", "wav"].includes(ext)) return ext;
  if (ext === "m4a") return "mp4";
  return "wav";
}

function guessAudioMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".ogg" || ext === ".opus") return "audio/ogg";
  return "application/octet-stream";
}

function parseXfyunCredentials(apiKey) {
  assertRequired(apiKey, "请先填写讯飞听见转写密钥。格式：app_id:secret_key。");
  try {
    const parsed = JSON.parse(apiKey);
    if (parsed.app_id && parsed.secret_key) return { appId: parsed.app_id, secretKey: parsed.secret_key };
    if (parsed.appId && parsed.secretKey) return { appId: parsed.appId, secretKey: parsed.secretKey };
  } catch {
    // Continue with compact text formats.
  }

  const [appId, secretKey] = String(apiKey).split(/[:|,，\s]+/).filter(Boolean);
  if (!appId || !secretKey) {
    throw new Error("讯飞听见转写密钥格式不正确。请在 ASR API Key 中填写 app_id:secret_key，或填写 JSON：{\"app_id\":\"...\",\"secret_key\":\"...\"}。");
  }
  return { appId, secretKey };
}

async function xfyunFormRequest(baseUrl, endpoint, appId, secretKey, fields = {}, signal) {
  throwIfCanceled(signal);
  const auth = createXfyunAuth(appId, secretKey);
  const body = new URLSearchParams({
    app_id: appId,
    signa: auth.signa,
    ts: auth.ts,
    ...fields
  });
  const url = `${baseUrl}/${endpoint}`;
  const response = await apiFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    },
    body: body.toString(),
    signal
  });
  const text = await response.text();
  const data = parseMaybeJson(text);
  if (!response.ok || data.ok === -1) {
    throw new Error(`讯飞听见转写失败：${response.status}。请求地址：${url}。返回内容：${text}`);
  }
  return data;
}

async function xfyunUploadSlice(baseUrl, appId, secretKey, { taskId, sliceId, fileName, content }, signal) {
  throwIfCanceled(signal);
  const auth = createXfyunAuth(appId, secretKey);
  const boundary = `----shengzhi-${crypto.randomBytes(12).toString("hex")}`;
  const chunks = [];
  const fields = {
    app_id: appId,
    signa: auth.signa,
    ts: auth.ts,
    task_id: taskId,
    slice_id: sliceId
  };

  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(Buffer.from(`Content-Disposition: form-data; name="content"; filename="${escapeMultipartName(fileName)}"\r\n`));
  chunks.push(Buffer.from("Content-Type: application/octet-stream\r\n\r\n"));
  chunks.push(content);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const url = `${baseUrl}/upload`;
  const response = await apiFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    body: Buffer.concat(chunks),
    signal
  });
  const text = await response.text();
  const data = parseMaybeJson(text);
  if (!response.ok || data.ok === -1) {
    throw new Error(`讯飞听见分片上传失败：${response.status}。请求地址：${url}。返回内容：${text}`);
  }
  return data;
}

async function waitForXfyunResult(baseUrl, appId, secretKey, taskId, signal) {
  for (let attempt = 0; attempt < XFYUN_MAX_POLLS; attempt += 1) {
    const result = await xfyunFormRequest(baseUrl, "getProgress", appId, secretKey, { task_id: taskId }, signal);
    const progress = parseMaybeJson(result.data || "{}");
    if (Number(progress.status) === 9) return;
    if (progress.desc && /失败|错误|异常|failed|error/i.test(progress.desc)) {
      throw new Error(`讯飞听见转写失败：${progress.desc}`);
    }
    await delay(XFYUN_POLL_INTERVAL_MS, signal);
  }
  throw new Error("讯飞听见转写超时：长音频可能仍在服务端处理中，请稍后重试。");
}

function createXfyunAuth(appId, secretKey) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const md5 = crypto.createHash("md5").update(`${appId}${ts}`).digest("hex");
  const signa = crypto.createHmac("sha1", secretKey).update(md5).digest("base64");
  return { ts, signa };
}

function parseXfyunResult(result) {
  const rows = parseMaybeJson(result.data || "[]");
  if (Array.isArray(rows)) {
    return rows.map((item) => item.onebest || item.text || "").filter(Boolean).join("\n").trim();
  }
  if (typeof rows === "string") return rows;
  return rows?.onebest || rows?.text || "";
}

function mapXfyunLanguage(language) {
  if (language === "en") return "en";
  return "cn";
}

function escapeMultipartName(value) {
  return String(value).replace(/"/g, "%22");
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

class SliceIdGenerator {
  constructor() {
    this.current = "aaaaaaaaa`";
  }

  next() {
    const chars = this.current.split("");
    for (let index = chars.length - 1; index >= 0; index -= 1) {
      if (chars[index] !== "z") {
        chars[index] = String.fromCharCode(chars[index].charCodeAt(0) + 1);
        break;
      }
      chars[index] = "a";
    }
    this.current = chars.join("");
    return this.current;
  }
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

function isMiMoBaseUrl(baseUrl = "") {
  return String(baseUrl).includes("xiaomimimo.com");
}

function assertRequired(value, message) {
  if (!value) throw new Error(message);
}

module.exports = { TranscriptionService };
