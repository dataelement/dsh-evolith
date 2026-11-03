import { workspaceId } from './workspaces.js'

/** Metadata is local; conversation text is loaded only for a confirmed selection. */
export class DshCatalog {
  constructor(ctx) { this.ctx = ctx }
  registry() { return this.ctx.get?.('workspaceRegistry') ?? this.ctx.workspaceRegistry }
  query() { return this.ctx.get?.('sessionQuery') ?? this.ctx.sessionQuery }
  workspaces() {
    const registry = this.registry()
    if (!registry?.list) throw new Error('当前 DSH 未提供工作区目录，请升级 DSH 后重试')
    return registry.list().map(w => ({ dsh_workspace_id: String(w.id), workspace_id: workspaceId(w.path), path: w.path, name: w.title || w.path, session_ids: [...w.sessionIds].map(String), session_count: w.sessionIds.length }))
  }
  workspace(id) {
    const w = this.workspaces().find(x => x.dsh_workspace_id === id)
    if (!w) throw new Error('该工作区已不在 DSH 中，请刷新后重新选择')
    return w
  }
  workspaceFor(session) {
    const registry = this.registry()
    if (!registry?.list) return session.header?.cwd // older test doubles only
    return this.workspaces().find(w => w.session_ids.includes(String(session.id)))?.path
  }
  async sessions(id) {
    const w = this.workspace(id), query = this.query()
    if (!query?.readTitleSnapshots) throw new Error('当前 DSH 未提供会话目录，请升级 DSH 后重试')
    const titles = await query.readTitleSnapshots(w.session_ids)
    return { ...w, sessions: w.session_ids.map((session_id, i) => {
      const value = titles[i]?.status === 'fulfilled' ? titles[i].value : null
      const t = value?.title
      return { session_id, title: typeof t === 'string' ? t : t?.text || t?.title || '未命名会话', created_at: value?.session?.createdAt, available: !!value }
    }) }
  }
  async read(id, sessionId) {
    const w = this.workspace(id)
    if (!w.session_ids.includes(sessionId)) throw new Error('该会话已移出所选工作区，未上传')
    const result = await this.query().readSession(sessionId)
    // Never send a still-generating turn or force a neutral/unfinished turn positive.
    let end = -1
    for (let i = 0; i < result.events.length; i++) if (result.events[i].type === 'turn/end') end = i
    const events = result.events.slice(0, end + 1)
    return { id: sessionId, header: { ...result.session, cwd: w.path }, snapshotEvents: () => events }
  }
}
