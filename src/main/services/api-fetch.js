const { net } = require("electron");

async function apiFetch(url, options = {}) {
  try {
    if (net?.fetch) {
      return await net.fetch(url, options);
    }
    return await fetch(url, options);
  } catch (error) {
    const target = getTargetUrl(url);
    const reason = error?.message || String(error);
    throw new Error(`网络请求失败：${reason}。请求地址：${target}。请检查网络连接、系统代理、API Base URL 和 API Key。`);
  }
}

function getTargetUrl(url) {
  if (typeof url === "string") return url;
  if (url?.url) return url.url;
  return String(url || "");
}

module.exports = { apiFetch };
