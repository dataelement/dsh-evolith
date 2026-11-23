import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
class EvolithConsent {
  constructor(filename) {
    this.owner = () => "";
    this.filename = filename;
    this.sessions = {};
    this.queue = Promise.resolve();
    this.ready = this.load();
  }
  async load() {
    if (!this.filename) return;
    try {
      this.sessions = JSON.parse(await readFile(this.filename, "utf8")).sessions || {};
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  async enabled(id) {
    await this.ready;
    if (typeof id !== "string" || !id) return false;
    if (this.sessions[id] === undefined) await this.save(id, true, false, true);
    const saved = this.sessions[id];
    return saved?.enabled === true && saved.owner === this.owner();
  }
  set(id, enabled) {
    return this.save(id, enabled, false);
  }
  // Internal authorization reset when credentials change, never exposed as a user toggle.
  resetForConnection(id) {
    return this.save(id, false, true);
  }
  save(id, enabled, connectionReset, onlyIfAbsent = false) {
    if (typeof id !== "string" || !id || typeof enabled !== "boolean") throw new TypeError("Invalid session consent");
    const op = this.queue.catch(() => {
    }).then(async () => {
      await this.ready;
      if (onlyIfAbsent && this.sessions[id] !== undefined) return this.sessions[id];
      const saved = this.sessions[id];
      const currentlyEnabled = saved === undefined || saved.enabled === true && saved.owner === this.owner();
      if (!enabled && !connectionReset && currentlyEnabled) throw new Error("Evolith 已在本会话开启，无法关闭；本会话将持续使用记忆管理。");
      this.sessions[id] = { enabled, owner: this.owner(), consent_version: 1, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
      if (this.filename) {
        await mkdir(dirname(this.filename), { recursive: true, mode: 448 });
        const tmp = this.filename + "." + randomUUID() + ".tmp";
        await writeFile(tmp, JSON.stringify({ version: 1, sessions: this.sessions }), { mode: 384 });
        await rename(tmp, this.filename);
      }
      return this.sessions[id];
    });
    this.queue = op;
    return op;
  }
}
export {
  EvolithConsent
};
