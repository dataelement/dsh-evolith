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
    const saved = this.sessions[id];
    return saved === undefined ? true : saved.enabled === true && saved.owner === this.owner();
  }
  set(id, enabled) {
    if (typeof id !== "string" || !id || typeof enabled !== "boolean") throw new TypeError("Invalid session consent");
    const op = this.queue.catch(() => {
    }).then(async () => {
      await this.ready;
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
