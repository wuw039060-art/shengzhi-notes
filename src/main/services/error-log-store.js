const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_LOGS = 120;

class ErrorLogStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async list() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async add(entry) {
    const logs = await this.list();
    const nextLogs = [entry, ...logs].slice(0, MAX_LOGS);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(nextLogs, null, 2), "utf8");
    return entry;
  }

  async clear() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, "[]", "utf8");
  }
}

module.exports = { ErrorLogStore };
