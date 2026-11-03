window.__ModuleLoader__.load({
  id: 'dsh-memory-bridge-profile',
  factory: require => {
    const React = require('react'), h = React.createElement, API = '/dsh-memory-bridge/manager/'
    // Keep the implementation available while its settings entry is hidden.
    const SHOW_AUTO_JOIN_SETTINGS = false
    const css = [
      '.dshMemorySection{--memory-accent:var(--dsw-alias-brand-primary,#2563eb);width:100%;min-width:0;max-width:1100px;container-type:inline-size;display:flex;flex-direction:column;gap:24px;color:var(--dsw-alias-label-primary,#17212b);font-size:14px;line-height:1.6}',
      '.dshMemorySection *{box-sizing:border-box}.dshMemorySection h2{font-size:24px;line-height:1.35;margin:0;font-weight:650;letter-spacing:-.4px}.dshMemorySection h3{font-size:16px;margin:0;font-weight:600}',
      '.dshMemoryRow,.dshMemoryActions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.dshMemoryActions{justify-content:flex-start}.dshMemoryHeader{align-items:flex-start}.dshMemoryHeader p{margin-top:6px}',
      '.dshMemoryPanel{padding:22px 24px;border:1px solid var(--dsw-alias-border-l2,#e3e7ed);border-radius:12px;background:var(--dsw-alias-bg-module-platform,#fff)}.dshMemoryPanel>div+div{margin-top:16px}.dshMemoryPanelHead{margin-bottom:18px}.dshMemoryFormSection+.dshMemoryFormSection{margin-top:24px;padding-top:24px;border-top:1px solid var(--dsw-alias-border-l2,#e3e7ed)}',
      '.dshMemoryStep{display:flex;align-items:center;gap:10px;font-weight:600;margin:0 0 14px}.dshMemoryStep b{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,#f1f4f8);font-size:12px;color:var(--dsw-alias-label-secondary,#667085)}',
      '.dshMemoryInput{width:100%;min-height:42px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l3,#cdd5df);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;font-size:14px}.dshMemoryInput:focus-visible{outline:2px solid var(--memory-accent);outline-offset:2px}.dshMemoryInput[aria-invalid=true]{border-color:#b42318}',
      '.dshMemoryButton{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:8px 14px;min-height:38px;border:1px solid var(--dsw-alias-border-l3,#cdd5df);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;font-size:13px;cursor:pointer;text-decoration:none;white-space:nowrap}.dshMemoryButton:hover{background:var(--dsw-alias-bg-layer-2,#f3f5f8)}.dshMemoryButton:disabled{opacity:.45;cursor:not-allowed}.dshMemoryButton.primary{background:var(--memory-accent);border-color:transparent;color:var(--dsw-alias-label-on-color,#fff)}',
      '.dshMemoryHint{margin:6px 0 0;color:var(--dsw-alias-label-secondary,#667085);font-size:12px;line-height:1.7;overflow-wrap:anywhere}.dshMemoryNotice{padding:12px 14px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f3f5f8);font-size:13px;margin:0;line-height:1.7}.dshMemoryError{color:var(--dsw-alias-state-error-primary,#b42318)}',
      '.dshMemoryGrid{display:grid;grid-template-columns:1.3fr 1fr;gap:16px}.dshMemoryField{display:flex;flex-direction:column;gap:7px;font-size:13px}.dshMemoryField .dshMemoryHint{margin:0}.dshMemoryStack{display:flex;flex-direction:column;gap:12px}',
      '.dshMemoryCheck{display:flex;align-items:flex-start;gap:9px;font-size:13px;cursor:pointer}.dshMemoryCheck input{margin-top:4px;accent-color:var(--memory-accent)}.dshMemorySessions{max-height:240px;overflow:auto;border:1px solid var(--dsw-alias-border-l2,#e3e7ed);border-radius:8px;margin-top:12px}.dshMemorySessionRow{padding:11px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#e3e7ed)}.dshMemorySessionRow:last-child{border-bottom:0}.dshMemorySessionRow details{margin-left:23px;font-size:11px;color:var(--dsw-alias-label-secondary,#667085)}',
      '.dshMemoryItem{padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#e3e7ed)}.dshMemoryItem:last-child{border-bottom:0;padding-bottom:0}.dshMemoryItem:first-child{padding-top:0}.dshMemoryMeta{display:flex;gap:8px 16px;flex-wrap:wrap;margin-top:5px;color:var(--dsw-alias-label-secondary,#667085);font-size:12px}.dshMemoryMono{font:11px/1.7 ui-monospace,monospace;overflow-wrap:anywhere}',
      '.dshMemoryStatus{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:500}.dshMemoryDot{width:7px;height:7px;border-radius:50%;background:#98a2b3;flex-shrink:0}.dshMemoryStatus.good .dshMemoryDot{background:#16956b}.dshMemoryStatus.busy .dshMemoryDot{background:#3b82f6}.dshMemoryStatus.bad .dshMemoryDot{background:#d14343}.dshMemoryStatus.good{color:#16815d}.dshMemoryStatus.bad{color:#b42318}',
      '.dshMemoryProgress{width:100%;height:7px;accent-color:var(--memory-accent);margin-top:10px}.dshMemorySection summary{cursor:pointer}.dshMemoryEmpty{padding:16px 0;color:var(--dsw-alias-label-secondary,#667085);font-size:13px}.dshMemoryFooter{padding-top:18px;margin-top:22px;border-top:1px solid var(--dsw-alias-border-l2,#e3e7ed)}',
      '.dshMemoryDashboard{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;align-items:stretch;transition:grid-template-columns 400ms cubic-bezier(.22,1,.36,1)}.dshMemoryDashboard[data-active=status]{grid-template-columns:minmax(0,1.6fr) minmax(0,.8fr)}.dshMemoryDashboard[data-active=workspaces]{grid-template-columns:minmax(0,.8fr) minmax(0,1.6fr)}',
      '.dshMemoryDashboardPanel{min-width:0;min-height:0;height:clamp(390px,56vh,560px);display:flex;flex-direction:column;padding:20px;overflow:hidden;transition:border-color 400ms ease,box-shadow 400ms ease,transform 400ms cubic-bezier(.22,1,.36,1)}.dshMemoryDashboardPanel .dshMemoryPanelHead{margin-bottom:14px;flex-shrink:0}.dshMemoryDashboardPanel>div+div{margin-top:0}.dshMemoryDashboardBody{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding-right:5px}.dshMemoryDashboardFooter{flex-shrink:0;padding-top:12px;margin-top:10px;border-top:1px solid var(--dsw-alias-border-l2,#e3e7ed)}',
      '.dshMemoryDashboardPanel:focus-visible{outline:2px solid var(--memory-accent);outline-offset:3px}.dshMemoryDashboard[data-active=status] .dshMemoryProcessingPanel,.dshMemoryDashboard[data-active=workspaces] .dshMemoryWorkspacePanel{border-color:var(--memory-accent);box-shadow:0 8px 26px color-mix(in srgb,var(--memory-accent) 10%,transparent);transform:translateY(-2px)}.dshMemoryDashboardPanel .dshMemoryItem strong{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}.dshMemoryDashboardPanel .dshMemoryActions{gap:7px}.dshMemoryDashboardPanel .dshMemoryButton{min-height:34px;padding:6px 10px;font-size:12px}.dshMemoryDashboardPanel .dshMemoryItem>.dshMemoryRow{gap:8px;align-items:flex-start}.dshMemoryDashboardPath{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshMemoryDashboardSearch{margin-bottom:12px;flex-shrink:0}.dshMemoryDashboardNudge{font-size:11px;font-weight:400;white-space:nowrap;color:var(--dsw-alias-label-secondary,#667085)}',
      '@container(max-width:680px){.dshMemoryDashboard{gap:12px}.dshMemoryDashboardPanel{padding:14px}.dshMemoryDashboardPanel .dshMemoryPanelHead{gap:6px}.dshMemoryDashboardNudge{display:none}.dshMemoryDashboard[data-active=status] .dshMemoryWorkspacePanel .dshMemoryItem>p,.dshMemoryDashboard[data-active=status] .dshMemoryWorkspacePanel .dshMemoryItem .dshMemoryButton,.dshMemoryDashboard[data-active=workspaces] .dshMemoryProcessingPanel .dshMemoryItem>:not(:first-child){display:none}}',
      '@container(max-width:440px){.dshMemoryDashboard,.dshMemoryDashboard[data-active]{grid-template-columns:minmax(0,1fr)}.dshMemoryDashboardPanel{height:auto;min-height:300px;max-height:520px;transform:none!important}.dshMemoryDashboardBody{max-height:350px}.dshMemoryDashboard[data-active=status] .dshMemoryWorkspacePanel .dshMemoryItem>p,.dshMemoryDashboard[data-active=workspaces] .dshMemoryProcessingPanel .dshMemoryItem>:not(:first-child){display:block}.dshMemoryDashboard[data-active=status] .dshMemoryWorkspacePanel .dshMemoryItem .dshMemoryButton{display:inline-flex}.dshMemoryDashboard[data-active=workspaces] .dshMemoryProcessingPanel .dshMemoryItem>.dshMemoryMeta{display:flex}}@media(hover:none){.dshMemoryDashboard,.dshMemoryDashboard[data-active]{grid-template-columns:minmax(0,1fr)}.dshMemoryDashboardPanel{height:auto;min-height:300px;max-height:520px;transform:none!important}.dshMemoryDashboardBody{max-height:350px}.dshMemoryDashboardNudge{display:none}.dshMemoryDashboard[data-active=status] .dshMemoryWorkspacePanel .dshMemoryItem>p,.dshMemoryDashboard[data-active=workspaces] .dshMemoryProcessingPanel .dshMemoryItem>:not(:first-child){display:block}.dshMemoryDashboard[data-active=status] .dshMemoryWorkspacePanel .dshMemoryItem .dshMemoryButton{display:inline-flex}.dshMemoryDashboard[data-active=workspaces] .dshMemoryProcessingPanel .dshMemoryItem>.dshMemoryMeta{display:flex}}@media(prefers-reduced-motion:reduce){.dshMemoryDashboard,.dshMemoryDashboardPanel{transition:none!important;transform:none!important}}',
      '.dshMemoryAutoJoin>.dshMemoryCheck{margin-bottom:14px}.dshMemoryAutoJoin>.dshMemoryActions{margin-top:16px}.dshMemoryAutoJoin .dshMemoryField{max-width:640px}',
      '@media(max-width:760px){.dshMemoryGrid{grid-template-columns:1fr}.dshMemoryPanel{padding:18px}.dshMemorySection{gap:18px}.dshMemoryHeader .dshMemoryActions{width:100%}.dshMemoryButton{min-height:40px}}'
    ].join('\n')
    async function request(path, method = 'GET', body) {
      const r = await fetch(API + path, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'content-type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) })
      const value = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(value.error || value.detail || '请求失败：HTTP ' + r.status)
      return value
    }
    async function status() {
      const r = await fetch('/dsh-memory-bridge/status', { credentials: 'same-origin', cache: 'no-store' })
      if (!r.ok) throw new Error('无法读取记忆连接设置')
      return r.json()
    }
    const phaseLabels = { idle: '尚无处理记录', judging: '正在判断反馈', not_triggered: '未触发提炼', queued: '等待处理', running: '正在提炼', extracting: '正在提炼', saving: '确认保存结果', saved: '已提炼并保存', succeeded: '已提炼并保存', no_changes: '处理完成，未新增', failed: '处理失败', unselected: '未启用记忆' }
    const busyPhases = new Set(['judging', 'queued', 'running', 'extracting', 'saving'])
    const stamp = value => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : ''
    const elapsed = value => { const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000)); return Number.isFinite(seconds) ? (seconds < 60 ? seconds + ' 秒' : Math.floor(seconds / 60) + ' 分 ' + seconds % 60 + ' 秒') : '' }
    const hint = text => h('p', { className: 'dshMemoryHint' }, text)
    const button = (text, onClick, disabled = false, primary = false) => h('button', { type: 'button', className: 'dshMemoryButton' + (primary ? ' primary' : ''), onClick, disabled }, text)
    const field = (text, input, help) => h('label', { className: 'dshMemoryField' }, h('span', null, text), input, help ? hint(help) : null)
    const badge = (text, phase) => h('span', { className: 'dshMemoryStatus ' + (['saved', 'succeeded', 'connected'].includes(phase) ? 'good' : busyPhases.has(phase) ? 'busy' : phase === 'failed' ? 'bad' : '') }, h('span', { className: 'dshMemoryDot', 'aria-hidden': true }), text)
    function MemoryBridgeSection() {
      const [data, setData] = React.useState({ workspaces: [], bindings: [], uploads: [] }), [connection, setConnection] = React.useState()
      const [groups, setGroups] = React.useState([]), [processing, setProcessing] = React.useState({ jobs: [] })
      const [workspace, setWorkspace] = React.useState(''), [sessions, setSessions] = React.useState([])
      const [all, setAll] = React.useState(true), [selected, setSelected] = React.useState(new Set())
      const [groupMode, setGroupMode] = React.useState('none'), [existingGroup, setExistingGroup] = React.useState(''), [newId, setNewId] = React.useState(''), [newName, setNewName] = React.useState('')
      const [search, setSearch] = React.useState(''), [showJoined, setShowJoined] = React.useState(false), [showHistory, setShowHistory] = React.useState(false)
      const [loading, setLoading] = React.useState(false), [saving, setSaving] = React.useState(false), [error, setError] = React.useState(''), [message, setMessage] = React.useState('')
      const [urlDraft, setUrlDraft] = React.useState(''), [token, setToken] = React.useState(''), [savingConnection, setSavingConnection] = React.useState(false), [connectionDirty, setConnectionDirty] = React.useState(false)
      const [checking, setChecking] = React.useState(false), [checked, setChecked] = React.useState(null)
      const [autoEnabled, setAutoEnabled] = React.useState(false), [autoGroup, setAutoGroup] = React.useState(''), [autoDirty, setAutoDirty] = React.useState(false), [savingAuto, setSavingAuto] = React.useState(false)
      const [hoveredPanel, setHoveredPanel] = React.useState(''), [focusedPanel, setFocusedPanel] = React.useState(''), [joinedSearch, setJoinedSearch] = React.useState('')
      const activePanel = hoveredPanel || focusedPanel
      const panelEvents = name => ({ tabIndex: 0, onPointerEnter: e => { if (e.pointerType === 'mouse') setHoveredPanel(name) }, onFocusCapture: e => { if (e.target.matches(':focus-visible')) setFocusedPanel(name) } })
      const form = React.useRef(null)
      const load = React.useCallback(async (includeGroups = false) => {
        try {
          const [d, c, p] = await Promise.all([request('catalog'), status(), request('processing').catch(e => ({ jobs: [], error: e.message }))])
          setData(d); setConnection(c); setProcessing(p)
          if (includeGroups && c.server?.token_configured) { try { setGroups((await request('groups')).groups) } catch (e) { setError(e.message) } }
        } catch (e) { setError(e.message) }
      }, [])
      React.useEffect(() => { void load(true); const timer = setInterval(() => load(), 4000); return () => clearInterval(timer) }, [load])
      React.useEffect(() => { if (!connectionDirty && connection?.server?.url) setUrlDraft(connection.server.url) }, [connectionDirty, connection?.server?.url])
      React.useEffect(() => { if (!autoDirty && data.auto_join) { setAutoEnabled(data.auto_join.enabled); setAutoGroup(data.auto_join.group_id || '') } }, [autoDirty, data.auto_join?.enabled, data.auto_join?.group_id])
      React.useEffect(() => {
        let active = true; setSessions([])
        if (!workspace) return () => { active = false }
        setLoading(true)
        const read = () => request('catalog/' + encodeURIComponent(workspace)).then(d => { if (active) setSessions(d.sessions) }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
        void read(); const timer = setInterval(read, 8000)
        return () => { active = false; clearInterval(timer) }
      }, [workspace])
      function choose(id) {
        const w = data.workspaces.find(x => x.dsh_workspace_id === id), b = w && data.bindings.find(x => x.workspace_id === w.workspace_id)
        const defaultGroup = b ? b.group_id : data.auto_join?.group_id || ''
        setWorkspace(id); setExistingGroup(defaultGroup || ''); setGroupMode(defaultGroup ? 'existing' : 'none')
        setAll(b?.session_selection !== 'selected'); setSelected(new Set(b?.session_ids || [])); setError(''); setMessage('')
      }
      function check(id, value) { const next = new Set(all ? sessions.map(x => x.session_id) : selected); value ? next.add(id) : next.delete(id); setSelected(next); setAll(false) }
      const groupId = groupMode === 'new' ? newId.trim().toLowerCase() : groupMode === 'existing' ? existingGroup : ''
      const idError = groupMode === 'new' && groupId && !/^[a-z0-9][a-z0-9._:-]{2,127}$/.test(groupId) ? '组编号不支持中文。请使用 3–128 位小写英文字母、数字或 . _ : -，并以字母或数字开头。' : ''
      async function join(e) {
        e.preventDefault(); if (idError) { setError(idError); return }
        setSaving(true); setError(''); setMessage('')
        try {
          const result = await request('selection', 'PUT', { dsh_workspace_id: workspace, session_selection: all ? 'all' : 'selected', session_ids: all ? sessions.map(s => s.session_id) : [...selected], group_id: groupId, ...(groupMode === 'new' && newName.trim() ? { group_name: newName.trim() } : {}) })
          setMessage(result.awaiting_group ? '工作区已加入，当前待绑定记忆组。会话选择已保留，绑定后才会上传并启用记忆。' : '记忆组已绑定，历史会话开始处理。请在“记忆处理状态”确认是否完成保存。')
          if (groupMode === 'new') { setExistingGroup(groupId); setGroupMode('existing'); setNewId(''); setNewName('') }
          await load(true)
        } catch (e) { setError(e.message) } finally { setSaving(false) }
      }
      async function remove(b) {
        if (!window.confirm('移除“' + b.name + '”的记忆设置？线上记忆、DSH 工作区及聊天记录都会保留。')) return
        try { await request('workspaces/' + encodeURIComponent(b.workspace_id), 'DELETE'); setMessage('已移除记忆设置，线上记忆、工作区及聊天记录保留；不会被自动加回，可手动重新加入。'); await load() } catch (e) { setError(e.message) }
      }
      async function saveConnection() {
        setSavingConnection(true); setError('')
        try { await request('registry', 'PUT', { server_url: urlDraft, ...(token.trim() ? { api_token: token.trim() } : {}) }); setToken(''); setConnectionDirty(false); setChecked(null); setMessage('连接配置已保存，可以检查连接。'); await load(true) }
        catch (e) { setError(e.message) } finally { setSavingConnection(false) }
      }
      async function checkConnection() {
        setChecking(true); setError('')
        try { await request('info'); setChecked(true); setMessage('线上记忆服务连接正常。'); await load(true) }
        catch (e) { setChecked(false); setError(e.message) } finally { setChecking(false) }
      }
      async function saveAutoJoin(e) {
        e.preventDefault(); setSavingAuto(true); setError(''); setMessage('')
        try {
          await request('auto-join', 'PUT', { enabled: autoEnabled, group_id: autoGroup })
          setAutoDirty(false); setMessage(autoEnabled ? '自动加入已开启：未手动设置和今后新建的工作区将加入指定组，全部会话在后台处理。' : '自动加入已关闭，已加入工作区保留原有绑定。')
          await load(true)
        } catch (e) { setError(e.message) } finally { setSavingAuto(false) }
      }
      const checkbox = (text, isChecked, change) => h('label', { className: 'dshMemoryCheck' }, h('input', { type: 'checkbox', checked: isChecked, disabled: saving, onChange: e => change(e.target.checked) }), h('span', null, text))
      const step = (n, text) => h('p', { className: 'dshMemoryStep' }, h('b', null, n), text)
      const query = search.trim().toLowerCase(), matches = w => !query || (w.name + ' ' + w.path).toLowerCase().includes(query)
      const workspaces = data.workspaces.filter(w => matches(w) || w.dsh_workspace_id === workspace)
      const bindings = [...data.bindings].reverse().filter(w => !joinedSearch.trim() || (w.name + ' ' + w.path + ' ' + (w.group_id || '')).toLowerCase().includes(joinedSearch.trim().toLowerCase())), visibleBindings = showJoined ? bindings : bindings.slice(0, 5)
      const selectedWorkspace = data.workspaces.find(w => w.dsh_workspace_id === workspace)
      const scopedBinding = selectedWorkspace && data.bindings.find(b => b.workspace_id === selectedWorkspace.workspace_id)
      const groupNames = new Map(groups.map(g => [g.group_id, g.name]))
      const groupTitle = id => (groupNames.get(id) || id) + (groupNames.get(id) && groupNames.get(id) !== id ? ' · ' + id : '')
      const boundGroups = new Set(data.bindings.filter(b => b.mode === 'server').map(b => b.group_id))
      const localActivities = (connection?.sessions || []).filter(s => boundGroups.has(s.group_id) && s.processing && s.processing.status !== 'idle' && (!scopedBinding || s.group_id === scopedBinding.group_id)).map(s => ({ ...s.processing, id: s.session_id, group_id: s.group_id, title: s.title || '会话处理', read_error: s.last_read_ok === false ? s.last_read_error : null }))
      const knownJobs = new Set(localActivities.map(x => x.job_id).filter(Boolean))
      const remoteActivities = (processing.jobs || []).filter(j => boundGroups.has(j.group_id) && !knownJobs.has(j.job_id) && (!scopedBinding || j.group_id === scopedBinding.group_id)).map(j => ({ ...j, id: j.job_id, title: '服务器提炼任务', status: j.status === 'succeeded' ? (j.new_memory_count ? 'saved' : 'no_changes') : j.status }))
      const activities = [...localActivities, ...remoteActivities].sort((a, b) => Number(busyPhases.has(b.status)) - Number(busyPhases.has(a.status)) || new Date(b.updated_at || 0) - new Date(a.updated_at || 0)).slice(0, 8)
      const selectedCount = all ? sessions.length : selected.size
      const connectionChanged = connectionDirty || Boolean(token.trim())
      return h('section', { className: 'dshMemorySection' },
        h('div', { className: 'dshMemoryRow dshMemoryHeader' }, h('div', null, h('h2', null, '记忆'), hint('选择哪些会话共享经验，并查看每次记忆是否真正保存。')), h('div', { className: 'dshMemoryActions' }, button('刷新', () => load(true)), h('a', { className: 'dshMemoryButton', href: '/dsh-memory-bridge/workbench', target: 'dsh-memory-workbench' }, '记忆管理'))),
        error ? h('p', { role: 'alert', className: 'dshMemoryNotice dshMemoryError' }, error) : null,
        message ? h('p', { role: 'status', className: 'dshMemoryNotice' }, message) : null,
        h('section', { className: 'dshMemoryPanel', 'aria-label': '线上服务连接' },
          h('div', { className: 'dshMemoryRow dshMemoryPanelHead' }, h('div', null, h('h3', null, '线上服务连接'), hint('先保存连接配置，再检查服务是否可访问。')), h('div', { className: 'dshMemoryActions' }, badge(checking ? '正在检查' : checked === true ? '连接正常' : checked === false ? '连接失败' : '尚未检查', checking ? 'judging' : checked === true ? 'connected' : checked === false ? 'failed' : 'idle'), button(checking ? '检查中…' : '检查连接', checkConnection, checking || savingConnection || connectionChanged || !connection?.server?.token_configured))),
          h('div', { className: 'dshMemoryGrid' }, field('服务器地址', h('input', { className: 'dshMemoryInput', type: 'url', value: urlDraft, onChange: e => { setUrlDraft(e.target.value); setConnectionDirty(true); setChecked(null) }, placeholder: 'http://服务器地址:端口' })), field('访问密钥', h('input', { className: 'dshMemoryInput', type: 'password', autoComplete: 'new-password', value: token, onChange: e => { setToken(e.target.value); setChecked(null) }, placeholder: connection?.server?.token_configured ? '已保存，留空则保留' : '填写 Memory 访问密钥' }))),
          h('div', { className: 'dshMemoryActions' }, button(savingConnection ? '保存中…' : '保存连接配置', saveConnection, savingConnection || !urlDraft.trim()), hint(connectionChanged ? '配置有修改，保存后才能检查新连接。' : '完整密钥可在网页“访问密钥”列表中再次查看、复制；它与聊天模型的密钥不同。')),
          h('p', { className: 'dshMemoryHint' }, '点击上方“记忆管理”，在同一网页注册、生成密钥并管理记忆。每个密钥对应独立空间，切换密钥后请重新确认工作区与会话。')),
        h('div', { className: 'dshMemoryDashboard', 'data-active': activePanel || 'balanced', onPointerLeave: () => setHoveredPanel(''), onBlurCapture: e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocusedPanel('') } },
          h('section', { className: 'dshMemoryPanel dshMemoryDashboardPanel dshMemoryProcessingPanel', 'aria-label': '记忆处理状态', ...panelEvents('status') },
          h('div', { className: 'dshMemoryRow dshMemoryPanelHead' }, h('div', null, h('h3', null, '记忆处理状态'), hint(scopedBinding ? '当前组：' + (scopedBinding.group_id || '待绑定') : '最近的反馈与提炼结果')), h('span', { className: 'dshMemoryDashboardNudge', 'aria-hidden': true }, '移入展开 ↔')),
          h('div', { className: 'dshMemoryDashboardBody' }, activities.length ? h('div', null, ...activities.map(a => h('div', { key: a.id, className: 'dshMemoryItem' }, h('div', { className: 'dshMemoryRow' }, h('strong', null, a.title), badge(phaseLabels[a.status] || a.status, a.status)), h('div', { className: 'dshMemoryMeta' }, h('span', null, groupTitle(a.group_id)), h('span', null, busyPhases.has(a.status) ? '已等待 ' + elapsed(a.started_at || a.created_at || a.updated_at) : stamp(a.completed_at || a.updated_at)), ['saved', 'no_changes'].includes(a.status) ? h('span', null, '新增 ' + (a.new_memory_count || 0) + ' 条') : null), hint(a.message || (a.status === 'saved' ? '已保存到服务器，可供同组后续会话读取。' : busyPhases.has(a.status) ? '服务器处理中，尚未保存完成。' : '')), a.status === 'not_triggered' ? hint('未触发与处理慢不同：本轮没有生成提炼任务。') : null, a.error ? h('p', { className: 'dshMemoryHint dshMemoryError' }, a.error) : null, a.read_error ? h('p', { className: 'dshMemoryHint dshMemoryError' }, '最新读取失败，本轮回答可能未使用记忆：' + a.read_error) : null, a.reason ? h('details', { className: 'dshMemoryHint' }, h('summary', null, '查看判断说明'), a.reason) : null))) : h('p', { className: 'dshMemoryEmpty' }, scopedBinding?.mode === 'pending' ? '这个工作区还没有绑定记忆组。' : '暂无处理记录。完成对话后，后台会判断是否需要提炼。')),
          processing.error && connection?.server?.token_configured ? hint('服务器提炼记录暂不可用：' + processing.error) : null,
          h('div', { className: 'dshMemoryDashboardFooter' }, hint('每 4 秒刷新。以“已提炼并保存”和实际新增内容确认结果。'))),
          h('section', { className: 'dshMemoryPanel dshMemoryDashboardPanel dshMemoryWorkspacePanel', 'aria-label': '已加入的工作区', ...panelEvents('workspaces') }, h('div', { className: 'dshMemoryRow dshMemoryPanelHead' }, h('div', null, h('h3', null, '已加入的工作区'), hint(bindings.length + ' 个工作区')), h('span', { className: 'dshMemoryDashboardNudge', 'aria-hidden': true }, '移入展开 ↔')),
          h('input', { type: 'search', className: 'dshMemoryInput dshMemoryDashboardSearch', value: joinedSearch, onChange: e => setJoinedSearch(e.target.value), placeholder: '搜索名称、路径或组号', 'aria-label': '搜索已加入的工作区' }),
          h('div', { className: 'dshMemoryDashboardBody' }, visibleBindings.length ? h('div', null, ...visibleBindings.map(b => h('div', { className: 'dshMemoryItem', key: b.workspace_id }, h('div', { className: 'dshMemoryRow' }, h('strong', null, b.name), h('div', { className: 'dshMemoryActions' }, badge(b.mode === 'pending' ? '待绑定记忆组' : '已启用记忆', b.mode === 'pending' ? 'idle' : 'connected'), button(b.mode === 'pending' ? '绑定记忆组' : '修改选择', () => { const w = data.workspaces.find(w => w.workspace_id === b.workspace_id); if (w) { choose(w.dsh_workspace_id); form.current?.scrollIntoView({ behavior: 'smooth' }) } else setError('该工作区已不在 DSH 中，可刷新列表或移除旧设置。') }), button('移除', () => remove(b)))), h('p', { className: 'dshMemoryHint dshMemoryDashboardPath', title: b.path }, b.path), hint((b.group_id ? '记忆组：' + groupTitle(b.group_id) + ' · ' : '') + (b.session_selection === 'selected' ? '指定 ' + b.session_ids.length + ' 个会话' : '全部会话，含以后新建的会话'))))) : h('p', { className: 'dshMemoryEmpty' }, joinedSearch ? '没有匹配的已加入工作区。' : '还没有已加入的工作区。')),
          h('div', { className: 'dshMemoryDashboardFooter' }, bindings.length > 5 ? button(showJoined ? '收起列表' : '显示全部 ' + bindings.length + ' 个工作区', () => setShowJoined(!showJoined)) : hint('修改选择后，在下方确认记忆组与会话。')))),
        SHOW_AUTO_JOIN_SETTINGS && h('form', { className: 'dshMemoryPanel dshMemoryAutoJoin', onSubmit: saveAutoJoin, 'aria-label': '自动加入工作区' },
          h('div', { className: 'dshMemoryRow dshMemoryPanelHead' }, h('h3', null, '自动加入工作区'), badge(({ disabled: '已关闭', ready: '已开启', running: '正在加入', paused: '需要重新确认', failed: '部分加入失败' })[data.auto_join?.status || 'disabled'], data.auto_join?.status === 'ready' ? 'connected' : data.auto_join?.status === 'running' ? 'running' : data.auto_join?.status === 'failed' ? 'failed' : 'idle')),
          h('label', { className: 'dshMemoryCheck' }, h('input', { type: 'checkbox', checked: autoEnabled, disabled: savingAuto, onChange: e => { setAutoEnabled(e.target.checked); setAutoDirty(true) } }), h('span', null, '自动加入未手动设置及今后新建的工作区')),
          field('默认记忆组', h('select', { className: 'dshMemoryInput', value: autoGroup, disabled: savingAuto, onChange: e => { setAutoGroup(e.target.value); setAutoDirty(true) }, 'aria-label': '自动加入默认记忆组' }, h('option', { value: '' }, '请选择默认记忆组'), ...groups.filter(g => g.role === 'owner').map(g => h('option', { key: g.group_id, value: g.group_id }, (g.name || g.group_id) + ' / ' + g.group_id)))),
          hint('开启后，全部会话（含历史和未来会话）会在后台处理；只收集会话，不扫描文件。手动设置和手动移除优先，移除后不会自动加回。'),
          hint('修改默认组只影响后续加入，关闭开关不会解除已有绑定。默认组也会用于手动选择新工作区时的预选。'),
          data.auto_join?.message ? h('p', { className: 'dshMemoryHint dshMemoryError' }, data.auto_join.message) : null,
          !groups.length ? hint('请先在“记忆管理”中创建记忆组，然后刷新此页。') : null,
          h('div', { className: 'dshMemoryActions' }, h('button', { type: 'submit', className: 'dshMemoryButton primary', disabled: savingAuto || connectionChanged || autoEnabled && (!groups.some(g => g.group_id === autoGroup && g.role === 'owner') || !connection?.server?.token_configured) }, savingAuto ? '正在保存…' : '保存自动加入设置'), hint(autoDirty ? '修改后保存才会生效。' : '后台每 10 秒检查一次；新会话开始时会立即检查。'))),
        h('form', { className: 'dshMemoryPanel', onSubmit: join, ref: form },
          h('div', { className: 'dshMemoryFormSection' }, step(1, '选择工作区与会话'),
            h('div', { className: 'dshMemoryStack' }, h('input', { type: 'search', className: 'dshMemoryInput', value: search, onChange: e => setSearch(e.target.value), placeholder: '搜索工作区名称或路径', 'aria-label': '搜索工作区' }), h('select', { className: 'dshMemoryInput', 'aria-label': '选择 DSH 工作区', value: workspace, onChange: e => choose(e.target.value), disabled: saving }, h('option', { value: '' }, '请选择 DSH 中已有的工作区'), ...workspaces.map(w => h('option', { key: w.dsh_workspace_id, value: w.dsh_workspace_id }, w.name + ' · ' + w.session_count + ' 个会话')))),
            hint(selectedWorkspace?.path || '需要新工作区时，先在 DSH 左侧添加。这里不会另建工作区或会话。'),
            !workspace ? null : loading ? hint('正在读取会话列表…') : h('div', { style: { marginTop: 16 } }, checkbox('全部会话，包含以后新建的会话', all, value => { setAll(value); setSelected(new Set(value ? sessions.map(x => x.session_id) : [])) }),
              sessions.length ? h('div', { className: 'dshMemorySessions', 'aria-label': '会话选择' }, ...sessions.map(s => h('div', { key: s.session_id, className: 'dshMemorySessionRow' }, checkbox(s.title, all || selected.has(s.session_id), value => check(s.session_id, value)), h('details', null, h('summary', null, '会话编号'), h('span', { className: 'dshMemoryMono' }, s.session_id))))) : hint('还没有会话。保持“全部会话”，以后新建的会话会自动加入选择。'),
              hint('已选择 ' + selectedCount + ' / ' + sessions.length + ' 个会话。未选择的会话不上传，也不启用本组记忆。'))),
          h('div', { className: 'dshMemoryFormSection dshMemoryStack' }, step(2, '选择记忆组，也可以稍后绑定'),
            field('记忆组', h('select', { className: 'dshMemoryInput', value: groupMode, onChange: e => setGroupMode(e.target.value), disabled: saving }, h('option', { value: 'none' }, '暂不绑定，先加入工作区'), h('option', { value: 'existing' }, '使用已有记忆组'), h('option', { value: 'new' }, '创建新记忆组'))),
            groupMode === 'existing' ? h(React.Fragment, null, field('已有记忆组', h('select', { className: 'dshMemoryInput', value: existingGroup, onChange: e => setExistingGroup(e.target.value), disabled: saving }, h('option', { value: '' }, '选择当前账号有权限的组'), ...(existingGroup && !groups.some(g => g.group_id === existingGroup) ? [h('option', { key: existingGroup, value: existingGroup }, existingGroup)] : []), ...groups.map(g => h('option', { key: g.group_id, value: g.group_id }, g.name + (g.name !== g.group_id ? ' · ' + g.group_id : ''))))), hint('绑定后即可读取这个组已有的记忆；本次选择的历史会话也会上传至该组。')) : null,
            groupMode === 'new' ? h(React.Fragment, null, h('div', { className: 'dshMemoryGrid' }, field('Group ID（组编号）', h('input', { className: 'dshMemoryInput', value: newId, onChange: e => setNewId(e.target.value), placeholder: '例如 team-alpha', maxLength: 128, autoCapitalize: 'none', spellCheck: false, 'aria-invalid': Boolean(idError), disabled: saving }), '不支持中文。3–128 位小写英文字母、数字或 . _ : -，以字母或数字开头。'), field('显示名称（选填）', h('input', { className: 'dshMemoryInput', value: newName, onChange: e => setNewName(e.target.value), placeholder: '例如 项目讨论组', maxLength: 120, disabled: saving }), '显示名称可以使用中文。')), idError ? h('p', { className: 'dshMemoryHint dshMemoryError', role: 'alert' }, idError) : null) : null,
            groupMode === 'none' ? h('p', { className: 'dshMemoryNotice' }, '先保留工作区和会话选择。当前不上传、不读取记忆；之后可在“已加入的工作区”中绑定记忆组。') : hint('记忆按组共享。历史上传后仍需判断反馈，并不保证每句话都生成记忆。')),
          h('div', { className: 'dshMemoryActions dshMemoryFooter' }, h('button', { type: 'submit', className: 'dshMemoryButton primary', disabled: saving || loading || !workspace || Boolean(idError) || groupMode !== 'none' && (!groupId || !connection?.server?.token_configured) || !all && !selected.size }, saving ? '正在保存…' : groupMode === 'none' ? '加入工作区，稍后绑定' : groupMode === 'new' ? '创建记忆组并加入' : '绑定记忆组并上传'), hint(groupMode === 'none' ? '这一步只保存选择。' : '保存完成状态以后台任务结果为准。'))),
        data.uploads.length ? h('section', { className: 'dshMemoryPanel' }, h('div', { className: 'dshMemoryRow' }, h('h3', null, '历史会话上传'), button(showHistory ? '收起记录' : '查看最近记录', () => setShowHistory(!showHistory))),
          showHistory ? h('div', null, ...data.uploads.slice(-5).reverse().map(job => h('div', { key: job.id, className: 'dshMemoryItem' }, h('div', { className: 'dshMemoryRow' }, h('strong', null, groupTitle(job.group_id)), badge(({ queued: '等待上传', running: '历史处理中', succeeded: '历史处理完成', partial_failed: '部分会话失败', failed: '上传失败' })[job.status] || job.status, job.status === 'partial_failed' ? 'failed' : job.status)), hint(job.completed + ' / ' + job.total + ' 个会话 · 本次新增 ' + (job.new_memory_count || 0) + ' 条'), h('progress', { className: 'dshMemoryProgress', value: job.completed, max: Math.max(job.total, 1), 'aria-label': '历史会话上传进度' }), job.status === 'succeeded' && !job.new_memory_count ? hint('没有新增：可能未触发反馈提炼，或相同内容已保存。') : null, job.error ? h('p', { className: 'dshMemoryHint dshMemoryError' }, job.error) : null, ...job.sessions.filter(s => s.error).map(s => h('p', { key: s.session_id, className: 'dshMemoryHint dshMemoryError' }, s.session_id + '：' + s.error))))) : hint('历史上传结果与后续自动提炼分别记录。')) : null)
    }
    function apply(ctx) {
      ctx.effect(() => {
        let style = document.querySelector('style[data-plugin-css="dsh-memory-bridge"]')
        if (!style) { style = document.createElement('style'); style.dataset.pluginCss = 'dsh-memory-bridge'; document.head.appendChild(style) }
        style.textContent = css
        return () => style.remove()
      })
      ctx.effect(() => ctx.locale.register('settings.memoryBridge', { zh: { nav: '记忆' }, en: { nav: 'Memory' } }), 'memory settings copy')
      const t = ctx.locale.bind('settings.memoryBridge')
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'memory-bridge', order: 45, label: () => t('nav') }, MemoryBridgeSection))
    }
    return { apply, inject: ['slots', 'locale'] }
  }
})
