const path = require("node:path");
const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const { spawn } = require("node:child_process");

const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".m4v", ".mov", ".qt", ".mkv", ".webm", ".avi", ".wmv", ".asf",
  ".flv", ".f4v", ".ts", ".mts", ".m2ts", ".m2t", ".mpeg", ".mpg", ".mpe",
  ".vob", ".ogv", ".3gp", ".3g2", ".mxf", ".dv", ".rm", ".rmvb", ".nut", ".y4m"
]);
const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".mp2", ".mpa", ".wav", ".wave", ".m4a", ".m4b", ".aac", ".flac",
  ".ogg", ".oga", ".opus", ".wma", ".amr", ".awb", ".aiff", ".aif", ".aifc",
  ".caf", ".ape", ".wv", ".tta", ".mka", ".ac3", ".eac3", ".dts", ".thd",
  ".au", ".snd", ".voc", ".ra", ".dsf", ".dff", ".tak"
]);
const MEDIA_DIALOG_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]
  .map((extension) => extension.slice(1))
  .sort();

class MediaService {
  constructor({ appPath, resourcesPath, workspaceDir }) {
    this.appPath = appPath;
    this.resourcesPath = resourcesPath;
    this.workspaceDir = workspaceDir;
  }

  isSupported(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return VIDEO_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext);
  }

  async inspectFiles(filePaths = []) {
    const results = [];
    for (const filePath of filePaths) {
      try {
        const stats = await fs.stat(filePath);
        if (!stats.isFile()) {
          results.push({ path: filePath, accepted: false, reason: "只能添加文件，暂不支持文件夹。" });
          continue;
        }
        const probe = await this.probe(filePath);
        if (!probe.hasAudio) {
          results.push({ path: filePath, accepted: false, reason: "文件中没有可识别的音频轨道。" });
          continue;
        }
        results.push({
          path: filePath,
          accepted: true,
          size: stats.size,
          duration: probe.duration,
          formatName: probe.formatName,
          knownExtension: this.isSupported(filePath)
        });
      } catch (error) {
        results.push({
          path: filePath,
          accepted: false,
          reason: friendlyProbeError(error)
        });
      }
    }
    return results;
  }

  async probe(filePath, options = {}) {
    const ffprobe = this.findBinary("ffprobe");
    const { stdout } = await runProcess(ffprobe, [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath
    ], options);
    const metadata = JSON.parse(stdout || "{}");
    const audioStreams = (metadata.streams || []).filter((stream) => stream.codec_type === "audio");
    return {
      duration: Number(metadata.format?.duration || 0),
      bitrate: Number(metadata.format?.bit_rate || 0),
      formatName: metadata.format?.format_name || "",
      audioStreams,
      hasAudio: audioStreams.length > 0
    };
  }

  async convertToAsrAudio(inputPath, options = {}, runOptions = {}) {
    let probe;
    try {
      probe = await this.probe(inputPath, runOptions);
    } catch (error) {
      throw new Error(`无法读取该媒体文件：${friendlyProbeError(error)}`);
    }
    if (!probe.hasAudio) {
      throw new Error("该文件没有可识别的音频轨道。");
    }

    const outputFormat = options.outputFormat === "mp3" ? "mp3" : "wav";
    const outputDir = path.join(this.workspaceDir, "converted");
    await fs.mkdir(outputDir, { recursive: true });

    const safeName = sanitizeBaseName(path.basename(inputPath, path.extname(inputPath)));
    const outputPath = path.join(outputDir, `${safeName}-${Date.now()}.${outputFormat}`);
    const ffmpeg = this.findBinary("ffmpeg");
    const args = ["-y", "-i", inputPath, "-vn"];

    if (outputFormat === "mp3") {
      args.push("-ac", String(options.channels || 1), "-ar", String(options.sampleRate || 16000), "-acodec", "libmp3lame", "-b:a", "64k", outputPath);
    } else {
      args.push("-ac", String(options.channels || 1), "-ar", String(options.sampleRate || 16000), "-c:a", "pcm_s16le", outputPath);
    }

    await runProcess(ffmpeg, args, runOptions);
    return { outputPath, probe, outputFormat };
  }

  async splitAudioBySize(inputPath, { maxBytes = 4_500_000, force = false, signal } = {}) {
    const stats = await fs.stat(inputPath);
    if (stats.size <= maxBytes && !force) return [inputPath];

    const probe = await this.probe(inputPath, { signal });
    const duration = probe.duration;
    if (!duration || duration <= 0) {
      throw new Error("音频时长读取失败，无法自动切片。");
    }

    const totalParts = Math.max(force ? 2 : 1, Math.ceil(stats.size / maxBytes));
    const segmentSeconds = Math.max(3, Math.floor((duration / totalParts) * 0.82));
    const segmentDir = path.join(this.workspaceDir, "converted", `segments-${Date.now()}`);
    await fs.mkdir(segmentDir, { recursive: true });

    const ext = path.extname(inputPath).toLowerCase() || ".mp3";
    const baseName = sanitizeBaseName(path.basename(inputPath, ext));
    const outputPattern = path.join(segmentDir, `${baseName}-%03d${ext}`);
    const ffmpeg = this.findBinary("ffmpeg");
    const args = [
      "-y",
      "-i", inputPath,
      "-f", "segment",
      "-segment_time", String(segmentSeconds),
      "-reset_timestamps", "1",
      ...getSegmentCodecArgs(ext),
      outputPattern
    ];

    await runProcess(ffmpeg, args, { signal });
    const segments = (await fs.readdir(segmentDir))
      .filter((file) => file.toLowerCase().endsWith(ext))
      .map((file) => path.join(segmentDir, file))
      .sort();

    const safeSegments = await this.ensureSegmentsUnderLimit(segments, maxBytes, signal);
    if (!safeSegments.length) throw new Error("音频切片失败，没有生成可识别的小文件。");
    return safeSegments;
  }

  async ensureSegmentsUnderLimit(segments, maxBytes, signal) {
    const result = [];
    for (const segment of segments) {
      const stats = await fs.stat(segment);
      if (stats.size <= maxBytes) {
        result.push(segment);
        continue;
      }

      const nested = await this.splitAudioBySize(segment, {
        maxBytes: Math.max(500_000, Math.floor(maxBytes * 0.8)),
        force: true,
        signal
      });
      result.push(...nested);
    }
    return result;
  }

  findBinary(name) {
    const executable = process.platform === "win32" ? `${name}.exe` : name;
    const candidates = [
      path.join(this.resourcesPath, "ffmpeg", executable),
      path.join(this.appPath, "resources", "ffmpeg", executable),
      path.join(process.cwd(), "resources", "ffmpeg", executable),
      executable
    ];
    const found = candidates.find((candidate) => candidate === executable || existsSync(candidate));
    if (!found) {
      throw new Error(`未找到 ${executable}。请把 FFmpeg 放入 resources/ffmpeg，或安装到系统 PATH。`);
    }
    return found;
  }
}

function getSegmentCodecArgs(ext) {
  if (ext === ".mp3") {
    return ["-ac", "1", "-ar", "16000", "-acodec", "libmp3lame", "-b:a", "64k"];
  }
  if (ext === ".wav") {
    return ["-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"];
  }
  return ["-c", "copy"];
}

function runProcess(command, args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createCancellationError());
      return;
    }
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let canceled = false;
    const abort = () => {
      canceled = true;
      child.kill("SIGTERM");
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", abort);
      reject(canceled ? createCancellationError() : error);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (canceled) {
        reject(createCancellationError());
        return;
      }
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

function createCancellationError() {
  const error = new Error("任务已暂停");
  error.name = "AbortError";
  return error;
}

function sanitizeBaseName(value) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 80) || "media";
}

function friendlyProbeError(error) {
  const message = String(error?.message || "");
  if (/no such file|cannot find|ENOENT/i.test(message)) return "文件不存在或已被移动。";
  if (/permission denied|access is denied|EACCES/i.test(message)) return "没有权限读取该文件。";
  if (/invalid data|could not find codec parameters|moov atom not found/i.test(message)) {
    return "文件已损坏，或不是可识别的音视频媒体。";
  }
  return "FFmpeg 无法识别该文件，可能是格式、编码或文件内容不受支持。";
}

module.exports = { MediaService, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, MEDIA_DIALOG_EXTENSIONS };
