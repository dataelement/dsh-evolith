const $ = s => document.querySelector(s)
let account, view = 'keys', pendingDelete = null, portal
const render = () => portal.refresh()
const date = value => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(value)) : '尚未使用'
function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n }
function message(text, error = false) { $('#notice').textContent = text; $('#notice').hidden = !text; $('#notice').className = 'notice' + (error ? ' error' : '') }
async function api(path, method = 'GET', body) {
  const r = await fetch('/v1/' + path, { method, cache: 'no-store', headers: body ? { 'content-type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) })
  if (r.status === 401) { location.replace('/login'); throw new Error('请重新登录') }
  if (r.status === 204) return null
  const value = await r.json()
  if (!r.ok) throw new Error(typeof value.detail === 'string' ? value.detail : '操作未完成，请检查输入后重试')
  return value
}
function action(text, fn, cls = 'text-button') { const b = el('button', text, cls); b.type = 'button'; b.onclick = () => Promise.resolve().then(fn).catch(e => message(e.message, true)); return b }
function table(headers) { const wrap = el('div', null, 'table-scroll'), t = el('table'), head = el('thead'), tr = el('tr'), body = el('tbody'); for (const text of headers) tr.append(el('th', text)); head.append(tr); t.append(head, body); wrap.append(t); return { wrap, body } }
function isActive(key) { return !key.revoked_at && (!key.expires_at || key.expires_at * 1000 > Date.now()) }
function showKey(value, title = '访问密钥') {
  $('#keyDialogTitle').textContent = title
  $('#createdKey').value = value; $('#createdKey').type = 'password'; $('#revealKey').checked = false; $('#copyStatus').textContent = ''; $('#keyDialog').showModal()
}
async function keysView() {
  const keys = await api('auth/api-keys'); if (view !== 'keys') return
  const area = $('#content'), form = el('form', null, 'key-create quick-create'), intro = el('div', null, 'key-create-intro'), field = el('div', null, 'field'), label = el('label', '密钥名称（选填）'), name = el('input'), submit = el('button', '一键生成访问密钥', 'button primary')
  intro.append(el('h2', '生成新的访问密钥'), el('p', '密钥内容和名称由系统自动生成，每个密钥对应一个独立记忆空间。', 'subtle'))
  label.htmlFor = name.id = 'keyName'; name.placeholder = '留空自动命名，也可填写：个人项目、实验 A'; name.maxLength = 64
  field.append(label, name); const options = el('details', null, 'key-name-options'); options.append(el('summary', '自定义名称（选填）'), field)
  submit.type = 'submit'; form.append(intro, submit, options)
  form.onsubmit = async e => {
    e.preventDefault(); if (submit.disabled) return; submit.disabled = true; submit.textContent = '正在生成…'
    try {
      const key = await api('auth/api-keys', 'POST', name.value.trim() ? { name: name.value.trim() } : {})
      showKey(key.api_key, '访问密钥已生成')
      try { await portal.refreshSpaces(); await render() } catch { message('密钥已生成，请先复制保存。列表暂时未刷新，可稍后点击刷新。', true) }
    } catch (e) { message(e.message, true) } finally { submit.disabled = false; submit.textContent = '一键生成访问密钥' }
  }
  const t = table(['名称 / 密钥前缀', '状态', '创建时间', '最近使用', '操作'])
  for (const key of keys) {
    const row = el('tr'), title = el('td'), status = el('td'), actions = el('td'), controls = el('div', null, 'actions')
    title.append(el('div', key.name, 'name'), el('div', key.prefix + '…', 'subtle'))
    if (isActive(key) && !key.reveal_available) title.append(el('div', '旧版密钥：成功连接后可再次查看', 'subtle'))
    status.append(el('span', key.revoked_at ? '已删除' : isActive(key) ? '可用' : '已过期', 'badge' + (isActive(key) ? '' : ' muted')))
    if (isActive(key)) {
      controls.append(action('查看 / 复制', async () => { const value = await api('auth/api-keys/' + encodeURIComponent(key.key_id) + '/reveal', 'POST'); showKey(value.api_key, key.name) }))
      const link = el('a', '进入记忆空间', 'text-button'); link.href = '?space=' + encodeURIComponent(key.key_id) + '#groups'; link.onclick = e => { e.preventDefault(); portal.openSpace(key.key_id).catch(e => message(e.message, true)) }; controls.append(link)
    }
    if (!key.revoked_at) controls.append(action('删除', () => { pendingDelete = key; $('#deleteDescription').textContent = '即将删除“' + key.name + '”。'; $('#deleteError').textContent = ''; $('#deleteDialog').showModal() }, 'text-button danger-text'))
    else controls.append(el('span', '空间数据已保留', 'subtle'))
    actions.append(controls); row.append(title, status, el('td', date(key.created_at), 'subtle'), el('td', date(key.last_used_at), 'subtle'), actions); t.body.append(row)
  }
  area.replaceChildren(form, el('p', keys.filter(isActive).length + ' 个可用密钥 · 各空间的记忆、分组和处理记录相互独立。', 'account-count'), t.wrap)
  if (!keys.length) area.append(el('p', '还没有访问密钥。点击“一键生成访问密钥”即可开始使用。', 'empty'))
}
async function accountsView() {
  const [data, company] = await Promise.all([api('admin/accounts'), api('admin/company-model')])
  const items = data.accounts; if (view !== 'accounts') return
  const area = $('#content'), input = el('input', null, 'account-search'), results = el('div')
  const selected = new Set(), bulk = el('div', null, 'bulk-actions'), count = el('span', '已选择 0 个账户', 'subtle')
  const update = async (userIds, enabled) => { await api('admin/accounts/company-model', 'PUT', { user_ids: userIds, enabled }); await render(); message(enabled ? '已为选定账户开启公司模型，记忆空间保持独立。' : '已关闭选定账户的公司模型授权，恢复使用各账户自己的模型配置。') }
  const enable = action('为选中账户开启公司模型', () => update([...selected], true), 'button primary')
  const disable = action('关闭选中账户的授权', () => update([...selected], false), 'button secondary')
  const sync = () => { count.textContent = '已选择 ' + selected.size + ' 个账户'; enable.disabled = !selected.size || !company.configured; disable.disabled = !selected.size }
  bulk.append(count, enable, disable); sync()
  input.type = 'search'; input.placeholder = '搜索账号'; input.setAttribute('aria-label', '搜索账号')
  function draw() {
    const t = table(['选择', '账号', '身份', '状态', '配置模型', '可用 / 全部密钥', '注册时间', '操作']); t.wrap.querySelector('table').className = 'accounts-table'
    for (const user of items.filter(u => u.username.toLowerCase().includes(input.value.trim().toLowerCase()))) {
      const row = el('tr'), choose = el('td'), check = el('input'), source = el('td'), operations = el('td')
      check.type = 'checkbox'; check.checked = selected.has(user.user_id); check.setAttribute('aria-label', '选择账户 ' + user.username)
      check.onchange = () => { check.checked ? selected.add(user.user_id) : selected.delete(user.user_id); sync() }; choose.append(check)
      source.append(el('span', user.use_company_model ? '公司模型' : '个人模型', 'badge' + (user.use_company_model ? '' : ' muted')))
      operations.append(action('查看详情', () => portal.navigate('accounts/' + encodeURIComponent(user.user_id))))
      const toggle = action(user.use_company_model ? '关闭公司模型' : '开启公司模型', () => update([user.user_id], !user.use_company_model))
      toggle.disabled = !user.use_company_model && !company.configured; operations.append(toggle)
      row.append(choose, el('td', user.username, 'name'), el('td', user.role === 'admin' ? '管理员' : '普通用户'), el('td', user.status === 'active' ? '正常' : '已停用'), source, el('td', user.active_key_count + ' / ' + user.key_count), el('td', date(user.created_at), 'subtle'), operations); t.body.append(row)
    }
    results.replaceChildren(t.wrap)
    if (!t.body.children.length) results.append(el('p', '没有匹配的账户。', 'empty'))
  }
  input.oninput = draw; area.replaceChildren(el('p', '共 ' + items.length + ' 个账户 · 公司模型仅对已授权的账户生效。', 'account-count'))
  if (!company.configured) area.append(action('公司模型尚未配置，点击前往配置', async () => { await portal.navigate('company') }, 'button secondary'))
  area.append(input, bulk, results); draw()
}
async function companyView() {
  const config = await api('admin/company-model'); if (view !== 'company') return
  const form = el('form', null, 'company-form'), fields = {}
  for (const [name, label, type, placeholder] of [['base_url','模型服务地址','url','例如 https://模型服务地址/v1'],['model','模型名称','text','填写服务提供的模型名称'],['api_key','公司模型密钥','password',config.configured ? '已保存，留空保留原密钥' : '填写公司模型的完整密钥']]) {
    const wrap = el('div', null, 'field'), l = el('label', label), input = el('input'); l.htmlFor = input.id = 'company-' + name; input.type = type; input.placeholder = placeholder; input.value = name === 'api_key' ? '' : config[name] || ''; input.required = name !== 'api_key' || !config.configured; input.autocomplete = name === 'api_key' ? 'new-password' : 'off'; fields[name] = input; wrap.append(l, input); form.append(wrap)
  }
  const submit = el('button', '保存公司模型', 'button primary'); submit.type = 'submit'; form.append(el('p', config.configured ? '已保存的密钥：' + config.api_key_masked + '。完整值不会再次显示。' : '尚未配置公司模型。保存后，可在账户管理中为选定账户开启。', 'subtle'), submit)
  form.onsubmit = async e => { e.preventDefault(); submit.disabled = true; try { await api('admin/company-model', 'PUT', Object.fromEntries(Object.entries(fields).map(([name, input]) => [name, input.value]))); await render(); message('公司模型配置已保存。请到“账户管理”为需要的账户开启使用。') } catch (e) { message(e.message, true) } finally { submit.disabled = false } }
  $('#content').replaceChildren(el('p', '公司模型由管理员统一配置。只有被管理员选中的账户会使用它；其他账户继续使用自己的模型配置。所有记忆空间保持独立。', 'account-count'), form)
}
function statistics(usage) {
  const wrap = el('section'), list = el('dl', null, 'facts')
  for (const [label, key] of [['记忆组','group_count'],['记忆条数','memory_count'],['读取次数','read_count'],['已上报模型调用','model_calls'],['输入用量（token）','input_tokens'],['输出用量（token）','output_tokens']]) {
    const item = el('div', null, 'fact'); item.append(el('dt', label), el('dd', new Intl.NumberFormat('zh-CN').format(usage[key] || 0))); list.append(item)
  }
  wrap.append(list,el('p','提炼任务 ' + (usage.job_count || 0) + ' · 处理中 ' + (usage.active_jobs || 0) + ' · 失败 ' + (usage.failed_jobs || 0),'usage-note'))
  return wrap
}
function keyStatus(key) { return key.revoked_at ? '已删除 · 数据保留' : isActive(key) ? '可用' : '已过期 · 数据保留' }
function detailSection(title, table, emptyText) {
  const section = el('section', null, 'details'); section.append(el('h2', title), table.wrap)
  if (!table.body.children.length) section.append(el('p', emptyText, 'empty'))
  return section
}
async function accountDetailView(page) {
  const segments = page.split('/'), userId = segments[1], spaceId = segments[3], groupId = segments[5]
  if (!userId || (segments.length > 2 && (segments[2] !== 'spaces' || !spaceId)) || (segments.length > 4 && (segments[4] !== 'groups' || !groupId)) || segments.length > 6) throw new Error('账户详情地址无效')
  const base = 'admin/accounts/' + encodeURIComponent(decodeURIComponent(userId))
  const path = base + (spaceId ? '/spaces/' + encodeURIComponent(decodeURIComponent(spaceId)) : '') + (groupId ? '/groups/' + encodeURIComponent(decodeURIComponent(groupId)) : '')
  const data = await api(path); if (view !== page) return
  const area = $('#content'), crumbs = el('nav', null, 'breadcrumbs'); crumbs.setAttribute('aria-label','账户详情路径')
  crumbs.append(action('全部账户', () => portal.navigate('accounts')))
  if (spaceId) crumbs.append(action(data.account.username, () => portal.navigate('accounts/' + userId)))
  else crumbs.append(el('span', data.account.username))
  if (spaceId && groupId) crumbs.append(action(data.space.name, () => portal.navigate('accounts/' + userId + '/spaces/' + spaceId)))
  else if (spaceId) crumbs.append(el('span', data.space.name))
  if (groupId) crumbs.append(el('span', data.group.name))
  $('#pageTitle').textContent = groupId ? data.group.name + ' 的记忆' : spaceId ? data.space.name : data.account.username + ' · 账户详情'
  area.replaceChildren(crumbs, el('p','管理员只读查看 · 密码和完整访问密钥不会展示。','usage-note'))
  if (!spaceId) {
    const user = data.account, overview = el('div', null, 'account-overview')
    overview.append(el('p', (user.role === 'admin' ? '管理员' : '普通用户') + ' · ' + (user.status === 'active' ? '正常' : '已停用') + ' · 注册于 ' + date(user.created_at)), el('p', '配置模型：' + (user.use_company_model ? '公司模型' : data.personal_model.configured ? data.personal_model.model + '（个人模型）' : '尚未配置个人模型'), 'subtle'))
    area.append(overview, statistics(data.usage), el('p', data.usage_scope + ' token 是模型计量文本用量的单位。','usage-note'))
    const t = table(['密钥空间 / 前缀','状态','记忆组 / 记忆','读取次数','最近使用','操作'])
    for (const key of data.spaces) {
      const row = el('tr'), title = el('td'), controls = el('td'); title.append(el('div',key.name,'name'),el('div',key.prefix + '…','subtle'))
      controls.append(action('查看空间详情', () => portal.navigate('accounts/' + userId + '/spaces/' + encodeURIComponent(key.key_id))))
      row.append(title,el('td',keyStatus(key)),el('td',key.usage.group_count + ' / ' + key.usage.memory_count),el('td',key.usage.read_count),el('td',date(key.last_used_at),'subtle'),controls); t.body.append(row)
    }
    area.append(detailSection('密钥空间',t,'此账户还没有创建访问密钥。')); return
  }
  if (groupId) {
    const group = data.group, u = group.usage
    area.append(el('p',decodeURIComponent(groupId) + ' · ' + keyStatus(data.space),'subtle'))
    const t = table(['类型','记忆正文','来源','更新时间'])
    for (const claim of group.claims) {
      const row = el('tr'); row.append(el('td',({fact:'事实',policy:'处理步骤',observation:'观察'})[claim.content_kind] || claim.content_kind),el('td',claim.claim,'memory-text'),el('td',({manual:'人工',manual_edit:'人工修改',import:'导入'})[claim.management_source] || '对话'),el('td',date(claim.management_updated_at || claim.management_created_at),'subtle')); t.body.append(row)
    }
    area.append(detailSection('已保存的记忆',t,'此组暂时没有记忆。'),el('p','此处显示已保存内容，不会触发读取、提炼或修改。任务统计最多展示最近 100 条；用量仅含插件已上报的主聊天。','usage-note'),statistics({ ...u, group_count:1, memory_count:group.claim_count, job_count:u.jobs.length, active_jobs:u.jobs.filter(j => ['queued','running'].includes(j.status)).length, failed_jobs:u.jobs.filter(j => j.status === 'failed').length })); return
  }
  area.append(el('p',keyStatus(data.space) + ' · ' + data.space.prefix + '…','subtle'),statistics(data.usage),el('p','用量仅统计插件已上报的主聊天，不含记忆提炼及标题生成。token 是模型计量文本用量的单位。','usage-note'))
  const groups = table(['名称 / Group ID','记忆条数','读取次数','绑定工作区','操作'])
  for (const group of data.groups) {
    const row = el('tr'), title = el('td'), controls = el('td'); title.append(el('div',group.name,'name'),el('div',group.group_id,'subtle'))
    controls.append(action('查看记忆', () => portal.navigate('accounts/' + userId + '/spaces/' + spaceId + '/groups/' + encodeURIComponent(group.group_id))))
    row.append(title,el('td',group.claim_count),el('td',group.read_count),el('td',group.workspace_count),controls); groups.body.append(row)
  }
  area.append(detailSection('记忆组',groups,'此密钥空间还没有记忆组。'))
  const jobs = table(['记忆组','状态','新增记忆','处理时间','错误说明'])
  for (const job of data.jobs) {
    const row = el('tr'), cell = el('td'); cell.append(el('span',({queued:'等待处理',running:'正在提炼',succeeded:job.new_memory_count ? '已提炼并保存' : '处理完成，未新增',failed:'提炼失败'})[job.status] || job.status,'badge status-' + job.status))
    row.append(el('td',job.group_id),cell,el('td',job.new_memory_count),el('td',date(job.completed_at || job.updated_at),'subtle'),el('td',job.error || '—','subtle')); jobs.body.append(row)
  }
  area.append(detailSection('最近提炼任务（最多 200 条）',jobs,'没有提炼任务。'))
  const workspaces = table(['工作区','路径','记忆组','更新时间'])
  for (const w of data.workspaces) { const row = el('tr'); row.append(el('td',w.name),el('td',w.path_hint || w.workspace_id,'subtle'),el('td',w.group_id),el('td',date(w.updated_at),'subtle')); workspaces.body.append(row) }
  area.append(detailSection('已绑定工作区',workspaces,'没有已绑定的工作区。'))
  const events = table(['时间','操作','记忆组','详情'])
  const eventLabels = {'group.update':'保存记忆组','group.delete':'删除记忆组','memory.create':'新增记忆','memory.update':'修改记忆','memory.delete':'删除记忆','workspace.bind':'绑定工作区','workspace.detach':'解除绑定','workspace.delete_with_memory':'移除工作区及记忆'}
  for (const e of data.events) { const row = el('tr'); row.append(el('td',date(e.created_at),'subtle'),el('td',eventLabels[e.action] || e.action),el('td',e.group_id || '—'),el('td',e.detail.name || e.detail.claim_id || e.detail.workspace_id || '—','subtle')); events.body.append(row) }
  area.append(detailSection('最近管理记录（最多 200 条）',events,'没有管理记录。'))
}
export async function renderAccountView(page) {
  view = page
  if (page.startsWith('accounts/')) await accountDetailView(page)
  else if (page === 'accounts') await accountsView()
  else if (page === 'company') await companyView()
  else await keysView()
}
export function initializeAccounts(context) {
  portal = context; account = context.account
$('#logout').onclick = async () => { try { await api('auth/logout', 'POST'); location.replace('/login') } catch (e) { message(e.message, true) } }
$('#revealKey').onchange = e => { $('#createdKey').type = e.target.checked ? 'text' : 'password' }
$('#keyDialog').addEventListener('close', () => { $('#createdKey').value = ''; $('#copyStatus').textContent = '' })
$('#copyKey').onclick = async () => { try { if (!navigator.clipboard?.writeText) throw new Error(); await navigator.clipboard.writeText($('#createdKey').value); $('#copyStatus').textContent = '已复制，可以粘贴到 DSH 插件。' } catch { $('#createdKey').type = 'text'; $('#revealKey').checked = true; $('#createdKey').select(); $('#copyStatus').textContent = '已选中密钥，请按 Ctrl+C 或使用复制菜单。' } }
$('#cancelDelete').onclick = () => $('#deleteDialog').close()
$('#deleteForm').onsubmit = async e => { e.preventDefault(); const b = e.target.querySelector('[type=submit]'); b.disabled = true; try { await api('auth/api-keys/' + encodeURIComponent(pendingDelete.key_id), 'DELETE'); $('#deleteDialog').close(); await portal.refreshSpaces(); await render(); message('密钥已删除，连接已停用，空间数据保留。') } catch (e) { $('#deleteError').textContent = e.message } finally { b.disabled = false } }
}
