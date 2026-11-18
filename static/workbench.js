import { initializeAccounts, renderAccountView } from './account.js?v=0.13.1'
const $ = selector => document.querySelector(selector)
const BASE = $('meta[name="api-base"]').content
const hostManaged = BASE.startsWith('/dsh-memory-bridge/')
const state = { page: 'groups', location: 'server', spaceId: '', spaceMissing: false, groups: [], selected: null, snapshot: null, search: '', memorySearch: '', checked: new Set(), registry: null, info: null, busy: false }
const titles = { groups: '记忆组', workspaces: '工作区', events: '使用记录', settings: '配置模型', help: '使用说明', keys: '我的访问密钥', accounts: '账户管理', company: '公司模型' }
const kindNames = { observation: '观察', fact: '事实', policy: '处理步骤' }
const sourceNames = { conversation: '对话', manual: '人工', manual_edit: '人工修改', import: '导入' }
const date = value => value ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—'
const number = value => new Intl.NumberFormat('zh-CN').format(value || 0)
function node(tag, text, cls) { const el = document.createElement(tag); if (text !== undefined && text !== null) el.textContent = String(text); if (cls) el.className = cls; return el }
function button(text, fn, cls = 'link-button') { const el = node('button', text, cls); el.type = 'button'; el.addEventListener('click', () => Promise.resolve().then(fn).catch(error => notice(error.message, true))); return el }
function notice(text, error = false) { const el = $('#notice'); el.hidden = !text; el.textContent = text || ''; el.className = 'notice' + (error ? ' error' : '') }
async function api(path, { method = 'GET', body, location = state.location } = {}) {
  const separator = path.includes('?') ? '&' : '?'
  const response = await fetch(BASE + '/' + path + separator + 'location=' + encodeURIComponent(location), { method, cache: 'no-store', headers: { ...(hostManaged ? { 'x-dsh-memory-request': '1' } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(state.spaceId && !hostManaged && path !== 'info' ? { 'x-memory-space': state.spaceId } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  if (response.status === 401 && !hostManaged) { location.replace('/login'); throw new Error('请重新登录') }
  if (response.status === 204) return null
  const content = await response.json().catch(() => ({ error: '服务返回了无法识别的结果，请检查登录或服务地址' }))
  if (!response.ok) throw new Error(typeof content.detail === 'string' ? content.detail : content.error || JSON.stringify(content.detail || response.status))
  return content
}
function table(headers, cls = '') {
  const wrap = node('div', null, 'table-scroll'), table = node('table', null, cls), head = node('thead'), row = node('tr'), body = node('tbody')
  for (const label of headers) row.append(node('th', label))
  head.append(row); table.append(head, body); wrap.append(table); return { wrap, body }
}
function empty(body, count, text) { const tr = node('tr'), td = node('td', text, 'empty'); td.colSpan = count; tr.append(td); body.append(tr) }
function search(placeholder, value, onInput) {
  const wrap = node('div', null, 'search-field'), input = node('input', null, 'search'); input.type = 'search'; input.placeholder = placeholder; input.setAttribute('aria-label', placeholder); input.value = value; input.addEventListener('input', () => onInput(input.value))
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true')
  const circle = document.createElementNS(icon.namespaceURI, 'circle'); circle.setAttribute('cx', '10'); circle.setAttribute('cy', '10'); circle.setAttribute('r', '7')
  const handle = document.createElementNS(icon.namespaceURI, 'path'); handle.setAttribute('d', 'm15 15 6 6'); icon.append(circle, handle); wrap.append(icon, input); return wrap
}
function field(name, label, type = 'text', value = '', hint = '', options = []) {
  const wrap = node('div', null, 'field'), l = node('label', label); l.htmlFor = 'field-' + name
  const input = node(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input'); input.name = name; input.id = l.htmlFor
  if (!['textarea', 'select'].includes(type)) input.type = type
  if (type === 'select') for (const option of options) { const el = node('option', option.label); el.value = option.value; input.append(el) }
  input.value = value; wrap.append(l, input); if (hint) wrap.append(node('small', hint)); return { wrap, input }
}
function dialog(title, fields, action, saveText = '保存', danger = false) {
  $('#dialogTitle').textContent = title; $('#fields').replaceChildren(...fields); $('#dialogError').textContent = ''; $('#saveDialog').textContent = saveText; $('#saveDialog').className = 'button ' + (danger ? 'danger' : 'primary')
  $('#editorForm').onsubmit = async event => {
    event.preventDefault(); $('#saveDialog').disabled = true; $('#dialogError').textContent = ''
    try { await action(new FormData($('#editorForm'))); $('#editor').close(); await render() }
    catch (e) { $('#dialogError').textContent = e.message }
    finally { $('#saveDialog').disabled = false }
  }
  $('#editor').showModal()
}
$('#closeDialog').onclick = $('#cancelDialog').onclick = () => $('#editor').close()

async function loadGroups() {
  state.info = await api('info')
  state.groups = (await api('groups')).groups
  if (!state.groups.some(g => g.group_id === state.selected)) state.selected = state.groups[0]?.group_id || null
  state.snapshot = state.selected ? await api('groups/' + encodeURIComponent(state.selected)) : null
}
const canCreate = () => state.info?.scopes?.includes('groups:manage')
const canManage = group => canCreate() && group?.role === 'owner'
const canWrite = group => state.info?.scopes?.includes('memory:write') && ['owner', 'editor'].includes(group?.role)
function groupEditor(group) {
  const id = field('group_id', 'Group ID', 'text', group?.group_id || '', '不支持中文。使用 3–128 位小写英文字母、数字或 . _ : -，并以字母或数字开头；创建后编号固定。')
  id.input.required = true; id.input.pattern = '[a-z0-9][a-z0-9._:-]{2,127}'; id.input.readOnly = !!group
  id.input.oninput = () => { id.input.value = id.input.value.toLowerCase(); id.input.setCustomValidity(/^[a-z0-9][a-z0-9._:-]{2,127}$/.test(id.input.value) ? '' : '组编号不支持中文，请按输入框下方的格式填写。') }
  const name = field('name', '显示名称', 'text', group?.name || '', '可以使用中文，绑定与读取仍使用组编号。'); name.input.required = true; name.input.maxLength = 120
  const description = field('description', '说明', 'textarea', group?.description || '')
  dialog(group ? '编辑记忆组' : '新建记忆组', [id.wrap, name.wrap, description.wrap], async form => {
    const body = { name: form.get('name').trim(), description: form.get('description').trim(), ...(!group ? { group_id: form.get('group_id').trim() } : {}) }
    const result = await api(group ? 'groups/' + encodeURIComponent(group.group_id) : 'groups', { method: group ? 'PATCH' : 'POST', body })
    state.selected = result.group_id; notice('记忆组已保存')
  })
}
function groupDelete(group) {
  const confirm = field('confirm', '请输入 Group ID 确认删除', 'text', '', group.group_id); confirm.input.required = true
  dialog('删除记忆组', [node('p', `将删除“${group.name}”及组内全部记忆。已绑定工作区或正在写入的组无法直接删除。`, 'hint'), confirm.wrap], async form => {
    if (form.get('confirm') !== group.group_id) throw new Error('Group ID 不匹配')
    await api('groups/' + encodeURIComponent(group.group_id), { method: 'DELETE' }); state.selected = null; notice('记忆组已删除')
  }, '删除记忆组', true)
}
function memoryEditor(claim) {
  const kind = field('kind', '类型', 'select', claim?.content_kind || 'fact', '', Object.entries(kindNames).map(([value, label]) => ({ value, label })))
  const content = field('content', '记忆内容', 'textarea', claim?.claim || '', '人工操作保留来源标记。编辑会生成新版本，旧内容的奖励与使用记录不会转给新内容。'); content.input.required = true; content.input.maxLength = 50000
  const policy = field('policy', '处理步骤结构（仅处理步骤类型，可选 JSON）', 'textarea', claim?.policy ? JSON.stringify(claim.policy, null, 2) : '')
  dialog(claim ? '编辑记忆' : '新增记忆', [kind.wrap, content.wrap, policy.wrap], async form => {
    const body = { kind: form.get('kind'), content: form.get('content').trim(), policy: form.get('policy').trim() ? JSON.parse(form.get('policy')) : null }
    await api('groups/' + encodeURIComponent(state.selected) + '/memories' + (claim ? '/' + encodeURIComponent(claim.claim_id) : ''), { method: claim ? 'PATCH' : 'POST', body }); notice('记忆已保存，后续读取使用更新后的内容')
  })
}
function memoryDelete(claim) {
  dialog('删除这条记忆', [node('p', claim.claim, 'memory-text'), node('p', '删除后不再用于后续读取；操作记录保留。', 'hint')], async () => {
    await api('groups/' + encodeURIComponent(state.selected) + '/memories/' + encodeURIComponent(claim.claim_id), { method: 'DELETE' }); state.checked.delete(claim.claim_id); notice('记忆已删除')
  }, '删除记忆', true)
}
function groupsView() {
  const area = $('#content'); area.replaceChildren()
  const list = node('div'); const drawRows = () => {
    const t = table(['名称 / Group ID', '记忆条数', '绑定工作区', '最近更新', '操作'])
    const visible = state.groups.filter(g => (g.name + g.group_id).toLowerCase().includes(state.search.toLowerCase()))
    for (const group of visible) {
      const row = node('tr', null, group.group_id === state.selected ? 'selected' : ''), title = node('td'); title.append(node('div', group.name, 'group-title'), node('div', group.group_id, 'subtle'))
      const actions = node('td', null, 'row-actions'); actions.append(button('查看', async () => { state.selected = group.group_id; state.checked.clear(); await render() }))
      if (canManage(group)) actions.append(button('编辑', () => groupEditor(group)), button('删除', () => groupDelete(group), 'link-button danger-link'))
      row.append(title, node('td', number(group.claim_count)), node('td', number(group.workspace_count)), node('td', date(group.updated_at || group.created_at)), actions); t.body.append(row)
    }
    if (!visible.length) empty(t.body, 5, state.groups.length ? '没有匹配的记忆组' : '还没有记忆组，点击“新建记忆组”开始')
    list.replaceChildren(t.wrap)
  }
  area.append(search('搜索名称或 Group ID', state.search, value => { state.search = value; drawRows() }), list); drawRows()
  if (state.snapshot) {
    const detail = node('section', null, 'details'), heading = node('div', null, 'section-heading'), actions = node('div', null, 'actions')
    heading.append(node('h2', state.snapshot.name + ' 的记忆'))
    const selectedGroup = state.groups.find(g => g.group_id === state.selected)
    if (canWrite(selectedGroup)) actions.append(button('新增记忆', () => memoryEditor(), 'button primary')); heading.append(actions); detail.append(heading)
    const memories = node('div'); const drawMemories = () => {
      const t = table(['', '类型', '内容', '来源', '创建时间', '操作'], 'memory-table')
      const items = state.snapshot.claims.filter(c => (c.claim + c.claim_id).toLowerCase().includes(state.memorySearch.toLowerCase()))
      for (const claim of items) {
        const row = node('tr'), select = node('td', null, 'select-cell')
        const kind = node('td'); kind.append(node('span', kindNames[claim.content_kind] || claim.content_kind, 'badge ' + claim.content_kind))
        const content = node('td', claim.claim, 'memory-text'), source = node('td', sourceNames[claim.management_source] || '对话', 'subtle'), buttons = node('td', null, 'row-actions')
        if (canWrite(selectedGroup)) buttons.append(button('编辑', () => memoryEditor(claim)), button('删除', () => memoryDelete(claim), 'link-button danger-link')); row.append(select, kind, content, source, node('td', date(claim.management_created_at), 'subtle'), buttons); t.body.append(row)
      }
      if (!items.length) empty(t.body, 6, '该组暂时没有记忆；可手工新增，或完成任务并给出实际反馈')
      memories.replaceChildren(t.wrap)
    }
    detail.append(search('搜索记忆内容', state.memorySearch, value => { state.memorySearch = value; drawMemories() }), memories); drawMemories()
    const utilities = node('div', null, 'actions'); utilities.style.marginTop = '16px'
    utilities.append(button('查看使用情况', () => navigate('events')), button('导出记忆文件', exportGroup)); if (canWrite(selectedGroup)) utilities.append(button('导入记忆文件', importDialog)); detail.append(utilities); area.append(detail)
  }
}
async function exportGroup() {
  const data = await api('groups/' + encodeURIComponent(state.selected) + '/export')
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), link = node('a'); link.href = url; link.download = 'memory-' + state.selected + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function importDialog() {
  const file = field('file', '选择工作台导出的 JSON 文件', 'file'); file.input.accept = '.json,application/json'; file.input.required = true
  const preview = node('p', '尚未选择文件', 'hint'); let data
  file.input.onchange = async () => {
    try { const selected = file.input.files[0]; if (selected.size > 5 * 1024 * 1024) throw new Error('文件不能超过 5 MB'); data = JSON.parse(await selected.text()); if (data.format !== 'dsh-memory-transfer' || data.version !== 1 || !Array.isArray(data.claims)) throw new Error('不是工作台导出的记忆文件'); preview.textContent = `将导入 ${data.claims.length} 条记忆，不复制奖励与使用统计。重复内容自动去重。` }
    catch (e) { data = null; preview.textContent = e.message }
  }
  dialog('导入记忆', [file.wrap, preview], async () => { if (!data) throw new Error('请先选择有效的记忆文件'); const result = await api('groups/' + encodeURIComponent(state.selected) + '/import', { method: 'POST', body: data }); notice(`已处理 ${result.imported} 条记忆，重复内容已去重`) }, '确认导入')
}
function workspaceDelete(item) {
  const label = node('label', null, 'check-label'), keep = node('input'); keep.type = 'checkbox'; keep.name = 'keep'; keep.checked = true; label.append(keep, node('span', '保留记忆（推荐）：只移除工作区绑定，以后可以重新绑定。'))
  const confirm = field('confirm', '若同时删除记忆，请输入 Group ID', 'text', '', item.group_id || '该工作区未启用 Memory')
  dialog('移除工作区', [node('p', item.name + ' · ' + (item.path || item.path_hint || item.workspace_id), 'hint'), label, confirm.wrap], async form => {
    const removeMemory = Boolean(item.group_id) && !form.has('keep')
    if (removeMemory && form.get('confirm') !== item.group_id) throw new Error('请填写 Group ID 确认删除记忆')
    await api('workspaces/' + encodeURIComponent(item.workspace_id) + '?delete_memory=' + removeMemory, { method: 'DELETE' }); notice(removeMemory ? '工作区绑定及关联记忆已删除，项目文件保留' : '工作区绑定已移除，记忆和项目文件保留')
  }, '移除工作区', true)
}
async function workspacesView() {
  const items = (await api('workspaces')).workspaces, t = table(['工作区', 'Group ID', '会话范围', '操作'])
  for (const item of items) {
    const row = node('tr'), title = node('td'); title.append(node('div', item.name, 'group-title'), node('div', item.path || item.path_hint || item.workspace_id, 'subtle'))
    const actions = node('td', null, 'row-actions'); actions.append(hostManaged ? button('移除', () => workspaceDelete(item), 'link-button danger-link') : node('span', '在 DSH 中修改/移除', 'subtle'))
    row.append(title, node('td', item.group_id || '待绑定记忆组'), node('td', item.session_selection === 'selected' ? '已选 ' + item.session_ids.length + ' 个会话' : '在 DSH 设置中管理'), actions); t.body.append(row)
  }
  if (!items.length) empty(t.body, 4, '还没有已加入的工作区')
  $('#content').replaceChildren(node('p', '选择或移除工作区、修改会话和 Group ID，请打开 DSH“设置 → 记忆”。这里查看线上绑定；在 DSH 移除时默认保留记忆。', 'usage-note'), t.wrap)
}
async function eventsView() {
  await loadGroups(); const area = $('#content'); area.replaceChildren()
  const group = field('usage_group', '查看记忆组', 'select', state.selected || '', '', state.groups.map(g => ({ value: g.group_id, label: g.name + ' / ' + g.group_id })))
  group.input.onchange = async () => { state.selected = group.input.value; await render() }; area.append(group.wrap)
  if (state.snapshot) {
    const u = state.snapshot.usage, facts = node('dl', null, 'facts')
    for (const [label, value] of [['读取次数', number(u.read_count)], ['完成的反馈任务', number(u.completed_episode_count)], ['记忆条数', number(state.snapshot.claim_count)], ['已上报模型调用', number(u.model_calls)], ['输入缓存占比', u.cached_input_ratio === null ? '未记录' : (u.cached_input_ratio * 100).toFixed(2) + '%'], ['命中字符比率', '供应商未提供']]) { const f = node('div', null, 'fact'); f.append(node('dt', label), node('dd', value)); facts.append(f) }
    area.append(facts, node('p', '缓存比例 = 缓存命中的输入 token ÷ 全部输入 token，不含输出。仅统计新版插件已上报的主聊天用量，不含标题生成和 Memory 提炼。token 不等于字符。', 'usage-note'))
    const jobs = table(['提炼任务', '状态', '新增记忆', '处理时间', '错误说明'])
    for (const job of u.jobs) {
      const tr = node('tr'), statusCell = node('td'), label = job.status === 'succeeded' && job.new_memory_count === 0 ? '处理完成，未新增' : ({ queued: '等待处理', running: '正在提炼，尚未保存', succeeded: '已提炼并保存', failed: '提炼失败' })[job.status] || job.status
      statusCell.append(node('span', label, 'badge status-' + job.status))
      const timing = node('td'); timing.append(node('div', date(job.completed_at || job.updated_at), 'subtle'))
      if (['queued', 'running'].includes(job.status)) timing.append(node('div', '已等待 ' + Math.max(0, Math.floor((Date.now() - new Date(job.started_at || job.created_at).getTime()) / 1000)) + ' 秒', 'subtle'))
      tr.append(node('td', job.job_id, 'subtle'), statusCell, node('td', job.new_memory_count === undefined ? '未记录' : job.new_memory_count + ' 条'), timing, node('td', job.error || '—', 'subtle')); jobs.body.append(tr)
    }
    if (!u.jobs.length) empty(jobs.body, 5, '没有后台提炼任务；未触发反馈提炼时不会创建任务'); area.append(node('h3', '后台提炼与保存'), node('p', '每 4 秒自动更新。只有“已提炼并保存”且新增条目内容正确，才能确认保存成功；未新增可能是重复内容。反馈是否触发，可在 DSH 设置 → 记忆查看。', 'usage-note'), jobs.wrap)
  }
  const events = (await api('events')).events, audit = table(['时间', '操作', '记忆组', '详情'])
  const labels = { 'group.update': '保存记忆组', 'group.delete': '删除记忆组', 'memory.create': '新增记忆', 'memory.update': '修改记忆', 'memory.delete': '删除记忆', 'workspace.bind': '绑定工作区', 'workspace.detach': '解除绑定', 'workspace.delete_with_memory': '移除工作区及记忆' }
  for (const e of events) { const row = node('tr'); row.append(node('td', date(e.created_at)), node('td', labels[e.action] || e.action), node('td', e.group_id || '—', 'subtle'), node('td', e.detail.name || e.detail.claim_id || e.detail.workspace_id || '—', 'subtle')); audit.body.append(row) }
  if (!events.length) empty(audit.body, 4, '暂时没有管理操作记录'); const section = node('section', null, 'details'); section.append(node('h3', '管理操作记录'), audit.wrap); area.append(section)
}
async function accountApi(path, method = 'GET', body) {
  const r = await fetch('/v1/auth/' + path, { method, cache:'no-store', headers:body ? {'content-type':'application/json'} : {}, ...(body ? {body:JSON.stringify(body)} : {}) })
  if (r.status === 401) { location.replace('/login'); throw new Error('请重新登录') }
  if (r.status === 204) return null
  const value = await r.json()
  if (!r.ok) { const error = new Error(typeof value.detail === 'string' ? value.detail : '请检查输入后重试'); error.status = r.status; throw error }
  return value
}
async function settingsView() {
  const area = $('#content'); area.replaceChildren()
  if (state.info?.credential_kind !== 'session') {
    area.append(node('p','模型配置在服务器网页账户中管理，记忆仍使用当前访问密钥。','usage-note'))
    if (hostManaged) {
      const link = node('a','打开账户与模型设置','button primary')
      link.href = '/dsh-memory-bridge/workbench'; link.target = '_blank'; link.rel = 'noopener'
      area.append(link)
    }
    return
  }
  let config
  try { config = await accountApi('model-provider') } catch (e) { if (e.status !== 404) throw e }
  const company = state.info.model_provider_mode === 'company', form = node('form',null,'settings-form'), fields = {}
  area.append(node('p',company ? '管理员已为此账户开启公司模型，当前提炼使用公司配置。下方个人配置会保留，关闭公司授权后恢复使用。' : '为此账户配置模型。账户内的密钥共用这份模型配置，各密钥的记忆仍独立保存。','usage-note'))
  for (const [name,label,type,hint] of [['base_url','模型服务地址','url','填写兼容服务的地址，例如 https://模型服务地址/v1'],['model','模型名称','text','填写服务提供的模型名称'],['api_key','个人模型密钥','password',config ? '已保存 ' + config.api_key_masked + '。修改配置时请重新填写完整密钥。' : '填写该模型服务的访问密钥。']]) {
    const item = field(name,label,type,name === 'api_key' ? '' : config?.[name] || '',hint); item.input.required = true; item.input.autocomplete = name === 'api_key' ? 'new-password' : 'off'; fields[name] = item.input; form.append(item.wrap)
  }
  const save = node('button','保存个人模型','button primary'); save.type = 'submit'; form.append(save)
  form.onsubmit = async e => { e.preventDefault(); save.disabled = true; try { await accountApi('model-provider','PUT',Object.fromEntries(Object.entries(fields).map(([name,input]) => [name,input.value]))); await render(); notice('个人模型配置已保存。' + (company ? '当前仍使用公司模型。' : '后续提炼将使用此配置。')) } catch(e) { notice(e.message,true) } finally { save.disabled = false } }
  area.append(form)
  const tests = node('section',null,'details'), result = node('p',null,'usage-note'), controls = node('div',null,'actions')
  const test = button('测试个人模型连接',async () => { test.disabled = true; try { const value = await accountApi('model-provider/test','POST'); result.textContent = value.ok ? '连接成功：' + value.model + ' · ' + value.response_preview : '连接未通过' } finally { test.disabled = false } },'button secondary')
  const writer = button('测试记忆提炼',async () => {
    writer.disabled = true
    try {
      let job = await accountApi('model-provider/writer-tests','POST'); sessionStorage.setItem('writerTest:' + state.info.user_id,job.job_id)
      await pollWriter(job.job_id,result,writer)
    } catch(e) { result.textContent = e.message; writer.disabled = false }
  },'button secondary')
  test.disabled = !config; writer.disabled = !config && !company
  controls.append(test,writer)
  if (config) controls.append(button('删除个人模型配置',() => dialog('删除个人模型配置',[node('p','删除后，未获公司模型授权的账户将无法自动提炼记忆。已保存的记忆保留。','hint')],async () => { await accountApi('model-provider','DELETE'); notice('个人模型配置已删除') },'确认删除',true),'link-button danger-link'))
  tests.append(node('h2','连接与提炼检查'),node('p','测试会向模型服务发送少量测试内容，可能产生用量；提炼测试使用独立测试数据。连接测试检查个人配置，提炼测试检查当前实际使用的模型。','usage-note'),controls,result); area.append(tests)
  const remembered = sessionStorage.getItem('writerTest:' + state.info.user_id)
  if (remembered) { writer.disabled = true; void pollWriter(remembered,result,writer) }
}
async function pollWriter(id,result,control) {
  try {
    while (result.isConnected) {
      const job = await accountApi('model-provider/writer-tests/' + encodeURIComponent(id))
      result.textContent = ({queued:'测试等待中…',running:'正在测试提炼…',succeeded:'提炼测试已完成',failed:'提炼测试失败：' + (job.error || '请检查模型配置')})[job.status] || job.status
      if (['succeeded','failed'].includes(job.status)) { sessionStorage.removeItem('writerTest:' + state.info.user_id); break }
      await new Promise(resolve => setTimeout(resolve,2000))
    }
  } catch(e) { result.textContent = e.message } finally { control.disabled = false }
}
function helpView() {
  const area = node('article', null, 'guide')
  const sections = [
    ['加入工作区', ['打开 DSH“设置 → 记忆”，先选择 DSH 工作区，再选择会话；默认全选并包含以后新建的会话。', '可以先加入工作区、稍后绑定记忆组；也可以选择已有组，或填写英文组编号创建新组。组编号不支持中文，显示名称可以使用中文。']],
    ['线上记忆如何生效', ['绑定记忆组后，所选历史会话发送到线上服务，按已有反馈规则提炼；未绑定的工作区显示“待绑定”，不启用记忆。中性反馈不会触发提炼，内容重复时可能不新增。', '只收集所选会话的对话，不扫描工作区中的全部文件。']],
    ['验证保存', ['在 DSH 设置的“记忆处理状态”查看反馈判断与自动提炼，在这里的“使用记录”查看服务器任务；只有保存完成后，新内容才可供后续会话使用。', '同组会话共享记忆。修改选择与组号后，对话历史保持原样，后续读取按确认后的配置执行。']],
    ['移除与统计', ['移除绑定默认保留线上记忆，也可输入准确组号明确删除；共享或忙碌中的记忆会阻止删除。项目文件保留。', '缓存比例只算输入 token，不含输出；没有字符统计时显示供应商未提供。']]
  ]
  for (const [title, paragraphs] of sections) { area.append(node('h2', title)); const list = node('ol'); for (const p of paragraphs) list.append(node('li', p)); area.append(list) }
  $('#content').replaceChildren(area)
}
async function render() {
  if (state.busy) { state.rerender = true; return }
  state.busy = true; $('#spaceSelect').disabled = true; $('#content').classList.add('loading')
  const section = state.page.split('/')[0], spacePage = ['groups','workspaces','events'].includes(section)
  $('#pageTitle').textContent = titles[section] || titles.groups
  $('#pageDescription').textContent = ({keys:'生成密钥后填入 DSH 插件，即可连接独立记忆空间。',accounts:'查看账户详情、记忆和使用情况，管理公司模型授权。',company:'统一配置模型，并为选定账户授权使用。',groups:'查看和管理当前密钥空间中已保存的记忆。',workspaces:'查看当前密钥空间的线上工作区绑定。',events:'查看已上报用量、记忆提炼状态和管理记录。',settings:'管理此账户的模型配置。'})[section] || ''
  $('#spaceContext').hidden = state.info?.credential_kind !== 'session' || !spacePage
  for (const b of document.querySelectorAll('[data-page]')) b.classList.toggle('active',b.dataset.page === section)
  const primary = $('#primary'); primary.hidden = section !== 'groups'; primary.textContent = '新建记忆组'
  primary.onclick = () => Promise.resolve().then(() => groupEditor()).catch(e => notice(e.message,true))
  try {
    if (spacePage && state.spaceMissing) {
      primary.hidden = true; $('#content').replaceChildren(node('p','先生成一个访问密钥，再进入它的独立记忆空间。','empty'),button('一键生成访问密钥',() => navigate('keys'),'button primary'))
    } else if (['keys','accounts','company'].includes(section)) {
      if (state.info?.credential_kind !== 'session') throw new Error('请登录网页账户后使用账户管理')
      if (section !== 'keys' && !state.info.is_admin) throw new Error('需要管理员账户')
      await renderAccountView(state.page)
    } else if (section === 'groups') { await loadGroups(); groupsView() }
    else if (section === 'workspaces') await workspacesView()
    else if (section === 'events') await eventsView()
    else if (section === 'settings') await settingsView()
    else helpView()
  } catch(e) { notice(e.message,true); $('#content').replaceChildren(node('p','当前内容未能加载，可刷新重试。','empty')) }
  finally { state.busy = false; $('#spaceSelect').disabled = false; $('#content').classList.remove('loading') }
  if (section === 'groups') primary.hidden = state.spaceMissing || !canCreate()
  $('#footer').textContent = section === 'accounts' ? '账户详情为管理员只读视图。各用户、各密钥的记忆空间保持独立。' : hostManaged ? '当前访问密钥的记忆空间。工作区与会话可在“工作区接入”中选择。' : '账户、密钥、模型和记忆统一在此管理。工作区与会话选择在 DSH 设置 → 记忆中配置。'
  if (state.rerender) { state.rerender = false; await render() }
}
function route() { const value = location.hash.slice(1); return Object.hasOwn(titles,value.split('/')[0]) ? value : 'groups' }
function navigate(page) { state.page = page; notice(''); history.pushState(null,'','#' + page); return render() }
function selectSpace(id) {
  if ($('#editor').open) $('#editor').close()
  state.spaceId = id; state.spaceMissing = !id; $('#spaceSelect').value = id
  if (id) sessionStorage.setItem('memorySpace:' + state.info.user_id,id)
  else sessionStorage.removeItem('memorySpace:' + state.info.user_id)
  const url = new URL(location.href); if (id) url.searchParams.set('space',id); else url.searchParams.delete('space'); history.replaceState(null,'',url)
  state.selected = null; state.snapshot = null; state.groups = []; state.checked.clear()
}
async function refreshSpaces() {
  if (state.info?.credential_kind !== 'session') return
  state.info = await api('info')
  const keys = (await accountApi('api-keys')).filter(k => !k.revoked_at && (!k.expires_at || k.expires_at * 1000 > Date.now()))
  const requested = state.spaceId || new URLSearchParams(location.search).get('space') || sessionStorage.getItem('memorySpace:' + state.info.user_id)
  const id = keys.some(k => k.key_id === requested) ? requested : keys[0]?.key_id || ''
  $('#spaceSelect').replaceChildren()
  for (const key of keys) { const option = node('option',key.name + ' · ' + key.prefix + '…'); option.value = key.key_id; $('#spaceSelect').append(option) }
  if (!keys.length) { const option = node('option','尚未创建密钥'); option.value = ''; $('#spaceSelect').append(option) }
  if (id !== state.spaceId) selectSpace(id)
  else { state.spaceMissing = !id; $('#spaceSelect').value = id }
}
for (const b of document.querySelectorAll('[data-page]')) b.onclick = () => navigate(b.dataset.page)
window.addEventListener('hashchange',() => { state.page = route(); notice(''); void render() })
window.addEventListener('popstate',() => { state.page = route(); notice(''); void render() })
$('#refresh').onclick = async () => { try { notice(''); await refreshSpaces(); await render() } catch(e) { notice(e.message,true) } }
$('#spaceSelect').onchange = e => { selectSpace(e.target.value); notice(''); void render() }
try {
  state.info = await api('info'); state.location = 'server'
  if (state.info.credential_kind === 'session') {
    state.account = await accountApi('me')
    initializeAccounts({ account:state.account, navigate, refresh:render, refreshSpaces, openSpace:async id => { await refreshSpaces(); if (![...$('#spaceSelect').options].some(o => o.value === id)) throw new Error('密钥已失效，请刷新列表'); selectSpace(id); await navigate('groups') } })
    $('#keysNav').hidden = false; $('#adminNav').hidden = $('#companyNav').hidden = $('#adminSection').hidden = !state.info.is_admin
    $('#identity').textContent = state.account.username + (state.info.is_admin ? ' · 管理员' : ''); $('#userContext').hidden = false
    await refreshSpaces()
  }
  state.page = location.hash ? route() : state.spaceMissing ? 'keys' : 'groups'; await render()
} catch(e) { notice(e.message,true) }
setInterval(() => { if (!document.hidden && state.page === 'events' && !state.busy && !$('#editor').open && !document.activeElement?.matches('input,select,textarea')) void render() },4000)
