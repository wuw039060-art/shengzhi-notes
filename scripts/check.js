const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const releaseMode = process.argv.includes("--release");

const requiredFiles = [
  "package.json",
  "README.md",
  "src/main/main.js",
  "src/main/preload.js",
  "src/main/services/api-fetch.js",
  "src/main/services/media-service.js",
  "src/main/services/transcription-service.js",
  "src/main/services/formatting-service.js",
  "src/main/services/job-runner.js",
  "src/renderer/index.html",
  "src/renderer/renderer.js",
  "src/renderer/styles.css"
];

let ok = true;
for (const file of requiredFiles) {
  const fullPath = path.join(process.cwd(), file);
  if (!fs.existsSync(fullPath)) {
    console.error(`Missing ${file}`);
    ok = false;
  }
}

const requiredBinaries = [
  "resources/icons/app-icon.ico",
  "resources/ffmpeg/ffmpeg.exe",
  "resources/ffmpeg/ffprobe.exe"
];

for (const file of requiredBinaries) {
  const fullPath = path.join(process.cwd(), file);
  if (releaseMode && !fs.existsSync(fullPath)) {
    console.error(`Missing bundled runtime file: ${file}`);
    ok = false;
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
const readme = fs.readFileSync(path.join(process.cwd(), "README.md"), "utf8");
const rendererHtml = fs.readFileSync(path.join(process.cwd(), "src/renderer/index.html"), "utf8");
const rendererCss = fs.readFileSync(path.join(process.cwd(), "src/renderer/styles.css"), "utf8");
const rendererJs = fs.readFileSync(path.join(process.cwd(), "src/renderer/renderer.js"), "utf8");
const mainJs = fs.readFileSync(path.join(process.cwd(), "src/main/main.js"), "utf8");
const preloadJs = fs.readFileSync(path.join(process.cwd(), "src/main/preload.js"), "utf8");
const jobRunnerJs = fs.readFileSync(path.join(process.cwd(), "src/main/services/job-runner.js"), "utf8");
const mediaServiceJs = fs.readFileSync(path.join(process.cwd(), "src/main/services/media-service.js"), "utf8");

const guideControls = [
  ["连接设置", rendererHtml],
  ["语音识别 ASR", rendererHtml],
  ["文本排版模型", rendererHtml],
  ["添加文件", rendererHtml],
  ["2. 选择渲染方式", rendererHtml],
  ["3. 开始转录", rendererHtml],
  ["暂停", rendererHtml],
  ["继续转录", rendererJs],
  ["输出预览", rendererHtml],
  ["保存 Markdown", rendererHtml],
  ["处理日志", rendererHtml]
];
for (const [label, source] of guideControls) {
  if (!readme.includes(label) || !source.includes(label)) {
    console.error(`README guide and application UI must both contain: ${label}`);
    ok = false;
  }
}

const releaseAssetName = `Setup.${packageJson.version}.exe`;
const expectedReleaseUrl = `https://github.com/wuw039060-art/shengzhi-notes/releases/download/v${packageJson.version}/${encodeURIComponent(releaseAssetName)}`;
if (!readme.includes(expectedReleaseUrl)) {
  console.error(`README must provide the direct installer URL for v${packageJson.version}.`);
  ok = false;
}
if (!readme.includes("取消当前处理并暂停队列") || !rendererJs.includes("cancelJob(task.id)")) {
  console.error("README pause behavior must match the application's cancel-and-restart behavior.");
  ok = false;
}
for (const internalDoc of ["GITHUB_SUBMISSION.md", "LAUNCH_KIT.md", "RELEASE_TEMPLATE.md", "OBSIDIAN_WORKFLOW.md"]) {
  if (readme.includes(internalDoc)) {
    console.error(`README must not expose internal presentation material: ${internalDoc}`);
    ok = false;
  }
}
const requiredRendererIds = [
  "startJob",
  "pauseJob",
  "activePromptPreview",
  "settingsToggle",
  "logsToggle",
  "openSettingsInline"
];
for (const id of requiredRendererIds) {
  if (!rendererHtml.includes(`id="${id}"`)) {
    console.error(`Missing renderer control: #${id}`);
    ok = false;
  }
}

if (rendererHtml.includes('id="concurrencySelect"') || rendererJs.includes("concurrencySelect")) {
  console.error("Parallel processing controls must not be exposed; jobs are strictly sequential.");
  ok = false;
}
if (!rendererJs.includes("if (state.activeCount > 0)")) {
  console.error("Renderer queue must dispatch only one active task at a time.");
  ok = false;
}
if (!jobRunnerJs.includes("this.activeJobs.size > 0")) {
  console.error("JobRunner must reject concurrent jobs at the main-process boundary.");
  ok = false;
}
if (!mainJs.includes('"media:inspect-files"') || !preloadJs.includes("inspectMediaFiles")) {
  console.error("Dragged and selected files must be validated through media inspection.");
  ok = false;
}
if (rendererJs.includes("autoResizePreview") || /preview\.style\.height/.test(rendererJs)) {
  console.error("Markdown preview must keep a stable viewport and scroll internally; do not auto-grow it to the full document height.");
  ok = false;
}
for (const extension of [".mts", ".m2ts", ".mxf", ".vob", ".3gp", ".caf", ".aiff", ".ape", ".mka", ".ac3", ".dts"]) {
  if (!mediaServiceJs.includes(`"${extension}"`)) {
    console.error(`Expanded media support is missing ${extension}.`);
    ok = false;
  }
}

const requiredLayoutMarkers = [
  ".main-grid",
  ".left-rail",
  ".right-rail",
  ".app-shell.settings-open .workspace",
  ".prompt-runtime"
];
for (const marker of requiredLayoutMarkers) {
  if (!rendererHtml.includes(marker.replace(".", "")) && !rendererCss.includes(marker)) {
    console.error(`Missing layout marker: ${marker}`);
    ok = false;
  }
}

const desktopCss = rendererCss.split(/\n@media\s*\(/)[0];

function readDesktopCssBlock(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...desktopCss.matchAll(new RegExp(`(^|\\n)\\s*${escapedSelector}\\s*\\{`, "g"))];
  const match = matches.at(-1);
  const start = match ? match.index + match[1].length : -1;
  if (start === -1) return "";
  const end = desktopCss.indexOf("}", start);
  return end === -1 ? desktopCss.slice(start) : desktopCss.slice(start, end + 1);
}

const requiredLayoutRules = [
  {
    selector: "body",
    test: (block) => /overflow\s*:\s*hidden/.test(block),
    message: "body must hide page-level overflow so the desktop app stays on one screen."
  },
  {
    selector: ".workspace",
    test: (block) => /height\s*:\s*100vh/.test(block) && /overflow\s*:\s*hidden/.test(block),
    message: ".workspace must be a fixed one-screen workbench."
  },
  {
    selector: ".main-grid",
    test: (block) => /grid-template-columns/.test(block) && /overflow\s*:\s*hidden/.test(block),
    message: ".main-grid must keep desktop content inside the viewport."
  },
  {
    selector: ".queue-panel",
    test: (block) => /overflow\s*:\s*hidden/.test(block),
    message: ".queue-panel must contain its own scrolling list."
  },
  {
    selector: ".result-panel",
    test: (block) => /overflow\s*:\s*hidden/.test(block),
    message: ".result-panel must contain the preview inside the viewport."
  },
  {
    selector: "#preview",
    test: (block) => /height\s*:\s*100%/.test(block)
      && /min-height\s*:\s*0/.test(block)
      && /overflow(?:-y)?\s*:\s*auto/.test(block)
      && /overscroll-behavior\s*:\s*contain/.test(block),
    message: "#preview must be a fixed internal scroll viewport for long Markdown documents."
  }
];
for (const rule of requiredLayoutRules) {
  const block = readDesktopCssBlock(rule.selector);
  if (!block) {
    console.error(`Missing CSS block: ${rule.selector}`);
    ok = false;
  } else if (!rule.test(block)) {
    console.error(rule.message);
    ok = false;
  }
}

const extraResources = packageJson.build?.extraResources || [];
const bundlesFfmpeg = extraResources.some((entry) => entry.from === "resources/ffmpeg" && entry.to === "ffmpeg");
const targetsNsis = packageJson.build?.win?.target?.includes("nsis");
const hasWindowsIcon = packageJson.build?.win?.icon === "resources/icons/app-icon.ico";
if (!bundlesFfmpeg) {
  console.error("package.json must bundle resources/ffmpeg as an extraResource.");
  ok = false;
}
if (!targetsNsis) {
  console.error("package.json must build a Windows NSIS installer.");
  ok = false;
}
if (!hasWindowsIcon) {
  console.error("package.json must configure the Windows app icon.");
  ok = false;
}

for (const file of requiredFiles.filter((name) => name.endsWith(".js"))) {
  const result = spawnSync(process.execPath, ["--check", path.join(process.cwd(), file)], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    ok = false;
  }
}

if (!ok) process.exit(1);
console.log("Project structure, JavaScript modules, and README usage guide look OK.");
