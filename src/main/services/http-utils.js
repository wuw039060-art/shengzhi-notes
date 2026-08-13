const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { apiFetch } = require("./api-fetch");

async function requestMultipart(url, { method = "POST", headers = {}, fields = {}, file, signal }) {
  const boundary = `----studio-${crypto.randomBytes(12).toString("hex")}`;
  const chunks = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${escapeName(key)}"\r\n\r\n`));
    chunks.push(Buffer.from(String(value)));
    chunks.push(Buffer.from("\r\n"));
  }

  const fileBuffer = await fs.readFile(file.path);
  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(Buffer.from(`Content-Disposition: form-data; name="${escapeName(file.field)}"; filename="${escapeName(path.basename(file.path))}"\r\n`));
  chunks.push(Buffer.from(`Content-Type: ${guessMime(file.path)}\r\n\r\n`));
  chunks.push(fileBuffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const response = await apiFetch(url, {
    method,
    headers: {
      ...headers,
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    body: Buffer.concat(chunks),
    signal
  });

  return {
    ok: response.ok,
    status: response.status,
    text: await response.text()
  };
}

function getByPath(source, pathExpression) {
  if (!source || !pathExpression) return undefined;
  return pathExpression.split(".").reduce((value, key) => {
    if (value === undefined || value === null) return undefined;
    if (/^\d+$/.test(key)) return value[Number(key)];
    return value[key];
  }, source);
}

function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".ogg" || ext === ".opus") return "audio/ogg";
  return "application/octet-stream";
}

function escapeName(value) {
  return String(value).replace(/"/g, "%22");
}

module.exports = { requestMultipart, getByPath };
