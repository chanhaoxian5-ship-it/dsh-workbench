import { previewApi } from './catalog.js';
import { createExperience } from './experience.js';
import { iconPaths } from './icons/icons.js';
import { ICONS as kitIcons } from './icons/kit-icons.js';
import * as motion from './motion.js';
const $ = (id) => document.getElementById(id);
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  inbox: '<path d="m4 4-2 11v5h20v-5L20 4Z"/><path d="M2 15h6l2 3h4l2-3h6"/>',
  settings: '<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
  refresh: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  link: '<path d="m10 14 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  'arrow-up': '<path d="M6 18 18 6M6 6h12v12"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  leaf: '<path d="M20 3C9 2 3 7 5 15c4 7 17 3 15-12ZM4 21 16 9m-6 7v-5m3 2h5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  sort: '<path d="M7 4v16m-3-3 3 3 3-3m4-12h7m-7 5h5m-5 5h3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  document: '<path d="M5 3h9l5 5v13H5Z"/><path d="M14 3v6h5M8 13h8m-8 4h6"/>',
  chat: '<path d="M21 11a9 9 0 0 1-13 8l-5 2 1-5a9 9 0 1 1 17-5Z"/><path d="M8 10h8m-8 4h5"/>',
  flask: '<path d="M9 3h6m-5 0v7L4 20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1l-6-10V3M7 15h10"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
};

// 图标优先用资产包的 71 枚业务/通用图标；本项目的旧名映射过去，
// 资产里没有的名字再回落到项目原有的一套（如 flask、chart、spark）。
const kitAlias = {
  folder: 'workspace', document: 'file-ref', spark: 'eye', grid: 'canvas', chat: 'feedback',
  book: 'plan', timeline: 'stage', version: 'version', chevron: 'chevron-down', down: 'chevron-down',
  'arrow-up': 'export', external: 'share', shield: 'lock', refresh: 'retry', inbox: 'archive',
  more: 'more', filter: 'filter', sort: 'sort', advisor: 'advisor', evidence: 'evidence',
  milestone: 'milestone', plan: 'plan', task: 'task', citation: 'citation', figure: 'figure',
  submission: 'submission', draft: 'draft', deadline: 'deadline', rubric: 'rubric', branch: 'branch',
  merge: 'merge', comment: 'comment', tag: 'tag', history: 'history', bookmark: 'bookmark',
  pin: 'pin', sync: 'sync', upload: 'upload', download: 'download', edit: 'edit', trash: 'trash',
};
function icon(name) {
  const wrap = document.createElement('span');
  // Only these static SVG constants enter this markup sink; API text never does.
  const aliases = { grid: 'canvas', inbox: 'folder', chat: 'book', 'arrow-up': 'external', down: 'chevron', sort: 'filter' };
  // 文件类型图标走本地这套「纸 + 类型记号」，优先于资产包：资产包里没有文件类型这一层，
  // 用业务图标代替（如把 docx 画成图表）会让用户读错文件。名字以 file- 开头即代表文件类型。
  const fileType = name.startsWith('file-') ? iconPaths[name] : '';
  const kit = fileType ? null : kitIcons[kitAlias[name] || name] || kitIcons[name];
  // 业务图标来自资产包：同一 24 网格、1.5 描边，颜色仍继承 currentColor。
  wrap.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${fileType || (kit ? kit.body : iconPaths[name] || iconPaths[aliases[name]] || paths[name] || paths.info)}</svg>`;
  return wrap;
}
document.querySelectorAll('[data-icon]').forEach((node) => node.replaceWith(icon(node.dataset.icon)));

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, action, className = 'text-button') {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function tag(text, tone = '') { return el('span', `tag ${tone}`, text); }
function text(id, value) { $(id).textContent = value; }
function visible(id, show) { $(id).hidden = !show; }
function display(value) { return value === null || value === undefined || value === '' ? '未提供' : String(value); }
const state = { token: '', preview: false, view: 'home', items: [], next: null, window: {}, status: 'disconnected', listRequest: null, detailRequest: null, loading: false, detailId: null, pendingQuery: undefined };
// 读取期间也可以打字：输入值始终记录，等这一轮读完再按最终输入渲染一次。
const prefersReduced = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let experience;
let discoveryFilter = '全部';
const dateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' });
const timeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
function formatTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? display(value) : timeFormat.format(date); }
text('today-date', dateFormat.format(new Date()));

async function api(path, signal, token = state.token, body = null) {
  if (state.preview && token === state.token) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (body !== null) throw new Error('界面预览不能提交真实操作。');
    return structuredClone(previewApi(path));
  }
  const request = new AbortController();
  let timedOut = false;
  const abort = () => request.abort();
  if (signal?.aborted) request.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; request.abort(); }, 12000);
  try {
    const response = await fetch(path, { method: body === null ? 'GET' : 'POST', body: body === null ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${token}`, ...(body === null ? {} : {'Content-Type': 'application/json'}) }, cache: 'no-store', signal: request.signal, credentials: 'omit', redirect: 'error' });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(response.status === 401 ? '令牌无效或已更换，请重新连接。' : response.status === 404 ? '这条记录不存在，或已切换到其他数据目录。' : response.status === 503 ? '暂时无法读取数据，请稍后重试。' : `读取失败（${response.status}）：${result.error?.code || '未知错误'}`);
      error.status = response.status;
      error.code = result.error?.code;
      throw error;
    }
    if (result.schema_version !== 1) throw new Error('接口版本不兼容，请检查前后端版本。');
    return result;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timedOut) throw new Error('读取超时，请确认本地服务仍在运行后重试。');
    if (error instanceof TypeError) throw new Error('无法连接本地服务，请确认服务正在运行。');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function setStatus(status) {
  state.status = status;
  const ok = status === 'connected' && !state.preview;
  $('connection-status').classList.toggle('connected', ok);
  const label = state.preview ? '界面预览' : { connected: '本机已连接', disconnected: '未连接', error: '连接中断', loading: '正在读取' }[status];
  text('connection-label', label);
  visible('connect-banner', !state.token && !state.preview);
  visible('disconnect', Boolean(state.token));
  const offline = !state.token && !state.preview;
  document.body.classList.toggle('is-offline', offline);
  $('refresh').hidden = offline;
  $('refresh').disabled = offline || state.loading;
}
// 证据边界声明：每张卡都会出现，所以样式降级为安静注脚；
// 但它仍是证据契约的一部分，三态文案与语气一律不改。
function semanticTag(record) {
  const value = record.verification.semantic.status;
  const mark = (text, tone) => { const node = tag(text, tone); node.classList.add('verify'); return node; };
  if (value === 'rejected') return mark('解释已拒绝 · 生产者声明', 'red');
  if (value === 'confirmed') return mark('声称已确认 · 未认证', 'amber');
  return mark('解释待审阅', 'amber');
}
function mechanicalTag(record) {
  const value = record.verification.mechanical.status;
  return tag(value === 'pass' ? '机械通过 · 生产者声明' : value === 'fail' ? '机械未通过 · 生产者声明' : '机械未检查', value === 'fail' ? 'red' : '');
}
function showEmpty(title, message, type = 'inbox', action = null) {
  const block = el('div', 'empty-state');
  const mark = el('div', 'empty-icon'); mark.append(icon(type));
  block.append(mark, el('h3', '', title), el('p', '', message));
  if (action) block.append(button(action.label, action.run, 'button secondary'));
  $('discovery-list').replaceChildren(block);
}
function renderList() {
  const term = $('search').value.trim().toLocaleLowerCase();
  const filters = state.preview ? ['全部', '学术表达', '方法与证据', '工具与方法', '论文阅读'] : ['全部', '待审阅', '声称已确认', '解释已拒绝'];
  if (!filters.includes(discoveryFilter)) discoveryFilter = '全部';
  const filterBar = $('discovery-filters'); filterBar.replaceChildren();
  if (state.view === 'all') filters.forEach(label => filterBar.append(button(label, () => { discoveryFilter = label; renderList(); }, `chip${discoveryFilter === label ? ' selected' : ''}`)));
  const records = state.items.filter((d) => {
    const matchesFilter = discoveryFilter === '全部' || (state.preview ? d.theme === discoveryFilter : d.verification.semantic.status === ({'待审阅':'not_reviewed','声称已确认':'confirmed','解释已拒绝':'rejected'}[discoveryFilter]));
    return matchesFilter && [d.title, d.excerpt, d.interpretation, d.record_id].some((v) => v.toLocaleLowerCase().includes(term));
  });
  if (!state.token && !state.preview) {
    showEmpty('你的发现，从这里开始', '连接本地工作台后，查看 Agent 已交付的发现。', 'inbox');
    text('list-summary', '尚未读取发现'); text('loaded-count', '—');
  } else if (!records.length) {
    showEmpty(term ? '没有匹配的发现' : state.view === 'home' ? '今天还没有收到发现' : '还没有收到发现', term ? '搜索仅筛选已载入的记录。可以清空搜索，或加载更多后继续查找。' : 'Agent 向接收入口交付发现后，点击刷新即可在这里看到。', term ? 'search' : 'inbox');
    text('list-summary', `已载入 ${state.items.length} 条${term ? ' · 匹配 0 条' : ''}`);
    text('loaded-count', String(state.items.length));
  } else {
    const fragment = document.createDocumentFragment();
    records.forEach((d, index) => {
      // 一行一条的清单：左列放主题（稳定分类），中间标题+摘录，右列时间与入口。
      // 清单比等大卡片网格更容易竖着扫，一屏能看五六条而不是三条。
      const row = button('', () => openDetail(d.record_id), 'discovery-row');
      const rail = el('div', 'row-rail');
      // 分类是"它属于哪一类"，不是"它很急"。用语义填充色会和琥珀抢注意力，
      // 所以分类一律中性；只有证据边界与"需要关注"才配用语义色。
      const theme = tag(state.preview ? d.theme : d.source.type === 'zotero_pdf' ? '文献发现' : d.source.type === 'local_pdf' ? '文件发现' : '来源待补充');
      theme.classList.add('theme-tag');
      rail.append(theme);
      if (d.is_test) rail.append(tag('测试', 'amber'));
      if (d.revision_of) rail.append(tag('修订'));

      const body = el('div', 'row-body');
      body.append(el('h3', '', d.title));
      body.append(el('p', 'row-excerpt', state.preview ? d.interpretation : d.excerpt));
      // 时间、来源、证据边界、入口全部收进正文下方这一行：
      // 它们回答的是同一件事"这条值不值得点开"，不该分散在左右两端。
      const meta = el('div', 'row-meta');
      const source = el('span'); source.append(icon('document'), document.createTextNode(state.preview ? '学习内容 · 自编' : d.source.pdf_page ? `PDF 第 ${d.source.pdf_page} 页` : '页序未提供'));
      meta.append(source, semanticTag(d), el('span', 'row-time', formatTime(d.received_at)));
      const arrow = el('span', 'row-open', '查看发现'); arrow.append(icon('arrow'));
      meta.append(arrow);
      body.append(meta);

      row.append(rail, body);
      fragment.append(row);
    });
    $('discovery-list').replaceChildren(fragment);
    text('loaded-count', String(state.items.length));
    text('list-summary', `已载入 ${state.items.length} 条${term ? ` · 匹配 ${records.length} 条` : ''} · 包含修订版本`);
  }
  visible('load-more', Boolean((state.token || state.preview) && state.next));
  visible('test-banner', $('include-test').checked);
}
function clearData() {
  state.items = []; state.next = null; state.window = {};
  state.changeRequest?.abort(); spot.today = 0; useAdapter(null);
  visible('load-more', false);
  text('freshness', '显式刷新以获取新发现 · 日期按上海时间');
  renderList();
}
function disconnect() {
  state.listRequest?.abort(); state.detailRequest?.abort();
  state.token = ''; state.loading = false; state.detailId = null;
  closeDialog($('detail-dialog')); $('token').value = ''; $('search').value = '';
  visible('page-error', false); visible('connect-error', false);
  setStatus('disconnected'); clearData();
  experience?.render(state.view);
}
function errorPage(error, append = false) {
  if (error.status === 401) disconnect();
  else setStatus('error');
  text('page-error', error.message); visible('page-error', true);
  if (!append && state.token) {
    state.items = []; state.next = null;
    text('loaded-count', '—'); text('list-summary', '未能完成读取');
    showEmpty('暂时无法读取发现', error.message, 'info', { label: '重新读取', run: () => refresh() });
    visible('load-more', false);
    text('freshness', '读取失败，当前没有展示旧结果');
  }
}
async function refresh(append = false) {
  if (!state.token && !state.preview) return;
  state.listRequest?.abort();
  const controller = new AbortController(); state.listRequest = controller;
  state.loading = true; setStatus('loading');
  visible('page-error', false); $('load-more').disabled = true;
  if (!append) {
    if (state.view === 'home' && !spot.adapter) { deck.set([]); renderHero(false); }
    state.items = []; state.next = null;
    text('loaded-count', '—'); text('list-summary', '正在读取…'); visible('load-more', false);
    // 读取中：用资产包的骨架屏按清单行的高度占位，比一个孤零零的转圈更接近最终版式。
    const block = el('div', 'empty-state'); block.append(el('div', 'loading-mark'), el('p', '', '正在读取本地发现…'));
    const skeleton = el('div', 'skeleton-list');
    skeleton.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i += 1) {
      const row = el('div', 'skeleton-row');
      row.append(el('span', 'wb-skeleton skeleton-chip'), el('span', 'wb-skeleton skeleton-title'), el('span', 'wb-skeleton skeleton-line'));
      skeleton.append(row);
    }
    $('discovery-list').replaceChildren(block, skeleton);
  }
  $('discovery-list').setAttribute('aria-busy', 'true');
  const params = new URLSearchParams({ limit: '12', include_test: String($('include-test').checked) });
  try {
    let page;
    if (append) {
      params.set('before', String(state.next));
      for (const [key, value] of Object.entries(state.window)) if (value) params.set(key, value);
      page = await api(`/v1/discoveries?${params}`, controller.signal);
    } else {
      const home = await api(`/v1/home?${params}`, controller.signal);
      if (controller.signal.aborted) return;
      spot.today = home.today_discoveries.items.length;
      if (!state.preview) useAdapter(realAdapter(home.important_changes, home.important_changes_page?.next_before));
      // Use the server's Shanghai date rather than the browser's timezone or clock.
      spot.date = new Date(`${home.date}T12:00:00+08:00`);
      text('today-date', dateFormat.format(spot.date));
      page = state.view === 'home' ? home.today_discoveries : await api(`/v1/discoveries?${params}`, controller.signal);
    }
    if (controller.signal.aborted) return;
    const addedFrom = append ? state.items.length : 0;
    state.items = append ? [...state.items, ...page.items] : page.items;
    state.next = page.next_before; state.window = page.window;
    setStatus('connected'); renderList(); renderHero(false); syncCounts(false);
    if (!append) maybeIntro();
    // 追加模式下只让新到的条目弹入，已在屏幕上的旧条目不动
    if (append && addedFrom > 0) {
      [...$('discovery-list').children].slice(addedFrom).forEach((row) => motion.reveal(row, { scroll: false }));
    }
    text('freshness', state.preview ? '' : `上次读取 ${formatTime(new Date().toISOString())} · 上海时间 · 显式刷新`);
    $('freshness').parentElement.hidden = state.preview;
  } catch (error) {
    if (!controller.signal.aborted) errorPage(error, append);
  } finally {
    if (state.listRequest === controller) {
      state.loading = false; $('refresh').disabled = !state.token && !state.preview;
      $('load-more').disabled = false; $('discovery-list').setAttribute('aria-busy', 'false');
      // 读取期间打的字在这里生效：输入框始终可编辑，读完按当前输入补渲染一次。
      const hadDeferredQuery = state.pendingQuery !== undefined;
      state.pendingQuery = undefined;
      if (hadDeferredQuery && !controller.signal.aborted && state.status !== 'error') renderList();
    }
  }
}

let toastTimer;
/* Native modal dialogs sit above ordinary z-index layers, so overlays that live on
   <body> (toast, burst layer) are re-parented into the open dialog while it exists. */
function overlayHost() {
  // A dialog that is already playing its exit must not adopt an overlay: it will be
  // display:none in 150ms and take the message with it. Fall back to <body> instead.
  const host = [$('panel-dialog'), $('workspace-dialog'), $('detail-dialog'), $('connect-dialog')]
    .find((dialog) => dialog.open);
  return host && !host.hasAttribute('data-wb-closing') ? host : document.body;
}
// 承载 toast 的 dialog 关掉时把 toast 收回 <body>，否则它跟着 display:none 一起消失。
for (const id of ['detail-dialog', 'panel-dialog', 'workspace-dialog', 'connect-dialog']) {
  $(id)?.addEventListener('close', () => {
    if ($(id).contains($('toast'))) document.body.append($('toast'));
  });
}
/* 提示条：说出结果本身；可撤销的操作带一个「撤销」。用独立的 translate/scale 动，
   不覆盖定位用的 transform，所以在 <body> 和抽屉里都能用。 */
function toast(message, tone = 'info', action = null) {
  const node = $('toast');
  overlayHost().append(node);
  clearTimeout(toastTimer);
  const fresh = node.hidden;
  node.replaceChildren(el('span', 'toast-text', message));
  node.dataset.tone = tone;
  if (action) node.append(button(action.label, () => { action.run(); }, 'toast-action'));
  node.hidden = false;
  if (!prefersReduced() && typeof node.animate === 'function') {
    node.getAnimations().forEach((a) => a.cancel());
    node.animate(fresh ? [{ opacity: 0, translate: '0 14px', scale: '.96' }, { opacity: 1, translate: '0 0', scale: '1' }] : [{ scale: '1.03' }, { scale: '1' }],
      { duration: motion.springMs('click'), easing: motion.springEase('click') });
  }
  toastTimer = setTimeout(hideToast, action ? 5200 : 4000);
}
function hideToast() {
  const node = $('toast');
  clearTimeout(toastTimer);
  if (node.hidden) return;
  if (prefersReduced() || typeof node.animate !== 'function') { node.hidden = true; return; }
  node.animate([{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: '0 10px' }], { duration: 160, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
    .finished.then((a) => { node.hidden = true; a.cancel(); }, () => {});
}
/* 弹窗开合：进入/退场动画由 motion.css 的 keyframes 负责（v26）。
   这里保留本项目原来的关闭语义：只有点遮罩外侧才关，Esc 也走同一条退场动画。 */
function dialogAnimMs() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--wb-fast').trim();
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return 150;
  return raw.endsWith('ms') ? value : value * 1000;
}
const dialogTokens = new WeakMap();
const dialogToken = (dialog) => dialogTokens.get(dialog) || 0;
/* 关闭动画播到一半时又要开：作废这轮退场，直接把它拉回「已打开」，
   新内容就地接管，而不是先等它关完再重新打开。 */
function cancelDialogClose(dialog) {
  if (!dialog) return;
  motion.cancelClose(dialog);
  dialogTokens.set(dialog, dialogToken(dialog) + 1);
  dialog.removeAttribute('data-wb-closing');
}
function openDialog(dialog) {
  if (!dialog) return;
  cancelDialogClose(dialog); // 作废进行中的关闭
  if (dialog.open) return;
  dialog.showModal();
  const target = dialog.querySelector('input:not([type="hidden"])') || dialog;
  requestAnimationFrame(() => { try { target.focus({ preventScroll: true }); } catch {} });
}
function closeDialog(dialog) {
  if (!dialog || !dialog.open || dialog.hasAttribute('data-wb-closing')) return;
  const token = dialogToken(dialog) + 1;
  dialogTokens.set(dialog, token);
  dialog.setAttribute('data-wb-closing', '');
  setTimeout(() => {
    if (dialogToken(dialog) !== token) return; // 期间被重新打开，放弃这次关闭
    if (dialog.open) dialog.close();
    dialog.removeAttribute('data-wb-closing');
  }, dialogAnimMs());
}
/* 退场还没播完就要立刻收场（用户已经在操作下一件事）。 */
function finishCloseNow(dialog) {
  motion.cancelClose(dialog);
  dialogTokens.set(dialog, dialogToken(dialog) + 1);
  if (dialog.open) dialog.close();
  dialog.removeAttribute('data-wb-closing');
}
/* native modal 在退场那 150ms 里仍然是 top-layer：整页 inert，点在遮罩上的那一下
   只会落到 dialog 本身——「关掉一条马上点下一条」就变成点了没反应。
   这里让退场期间的这一下穿过去：按下就先收场，松开时命中下面的元素并触发它。 */
const ACTIONABLE = 'button, a, [role="button"], input, select, textarea, [tabindex]';
// 退场期间按在遮罩上的这一下：记下起点，立刻收场，再把松开时命中的元素当成一次真实点击。
let clickAway = null;
function forwardClickAway(event) {
  const start = clickAway;
  clickAway = null;
  document.removeEventListener('pointerup', forwardClickAway, true);
  document.removeEventListener('pointercancel', cancelClickAway, true);
  if (!start || start.pointerId !== event.pointerId) return;
  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) return; // 拖动不算点击
  const hit = event.target.closest?.(ACTIONABLE);
  if (hit && !hit.closest('dialog') && typeof hit.click === 'function') hit.click();
}
function cancelClickAway() {
  clickAway = null;
  document.removeEventListener('pointerup', forwardClickAway, true);
  document.removeEventListener('pointercancel', cancelClickAway, true);
}
for (const id of ['detail-dialog', 'panel-dialog', 'connect-dialog', 'workspace-dialog']) {
  const dialog = $(id);
  if (!dialog || dialog.dataset.wbForward === 'true') continue;
  dialog.dataset.wbForward = 'true';
  dialog.addEventListener('pointerdown', (event) => {
    // 只有点在遮罩上（event.target 就是 dialog 本身）才算「关掉之后在点别处」
    if (!dialog.hasAttribute('data-wb-closing') || event.target !== dialog) return;
    clickAway = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    document.addEventListener('pointerup', forwardClickAway, true);
    document.addEventListener('pointercancel', cancelClickAway, true);
    finishCloseNow(dialog); // 先收掉 top-layer，下面那一层才重新参与命中
  }, true);
}
function copyButton(value, label = '复制', container = null) {
  return button(label, async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(value);
      toast('已复制', 'success');
    } catch {
      toast('复制失败，请手动选取下方文本');
      const parent = container || $('detail-content');
      let area = parent.querySelector('.manual-copy');
      if (!area) { area = el('textarea', 'manual-copy'); area.readOnly = true; area.setAttribute('aria-label', '复制失败，请手动选取以下文本'); parent.append(area); }
      area.value = value; area.focus(); area.select();
    }
  });
}
function kv(entries) {
  const list = el('dl', 'key-values');
  entries.forEach(([key, value]) => list.append(el('dt', '', key), el('dd', '', display(value))));
  return list;
}
function section(title, iconName) {
  const node = el('section', 'detail-section'); const heading = el('h3'); heading.append(icon(iconName), document.createTextNode(title)); node.append(heading); return node;
}
function renderDetail(d) {
  const content = $('detail-content');
  const badges = el('div', 'detail-status'); badges.append(tag(d.is_test ? '测试发现' : '发现', d.is_test ? 'amber' : 'green'), semanticTag(d));
  if (d.revision_of) badges.append(tag('修订版本'));
  const title = el('h2', '', d.title); title.id = 'detail-title';
  const excerpt = section(state.preview ? '学习内容 · 自编示例' : '原始摘录', 'document'); excerpt.append(el('blockquote', 'excerpt-block', d.excerpt));
  const interpretation = section('解释与推断', 'spark'); interpretation.append(el('p', 'interpretation', d.interpretation));
  const check = section('核验状态', 'shield'); const checkBadges = el('div', 'detail-status'); checkBadges.append(mechanicalTag(d), semanticTag(d));
  check.append(checkBadges, el('p', 'evidence-note', '后端仅检查输入结构与提交关系，未核对文献指纹、摘录页码或解释。生产者填写的审阅者身份尚未认证。'));
  const evidence = el('details', 'detail-disclosure'); evidence.append(el('summary', '', '查看生产者核验声明'), kv([
    ['机械检查范围', d.verification.mechanical.scope], ['机械检查依据', d.verification.mechanical.evidence],
    ['声称审阅者', d.verification.semantic.reviewed_by], ['语义审阅依据', d.verification.semantic.evidence],
  ])); check.append(evidence);

  const source = section('来源定位', 'document');
  const states = { not_provided: '尚未提供本地路径', missing: '来源文件缺失', inaccessible: '来源文件无法访问', exists_unverified: '文件存在 · 指纹与页码未核验', not_checked_on_this_platform: '此平台未检查文件' };
  source.append(tag(states[d.source_locator.status] || '来源状态未知', ['missing', 'inaccessible'].includes(d.source_locator.status) ? 'red' : ''));
  const sourceBox = el('div', 'locator-box');
  const sourceValues = [['来源类型', { zotero_pdf: 'Zotero PDF', local_pdf: '本地 PDF', unknown: '未知' }[d.source.type]], ['PDF 页序', d.source.pdf_page ? `第 ${d.source.pdf_page} 页（从 1 起）` : null], ['印刷页码', d.source.printed_page], ['父项键', d.source.parent_key], ['附件键', d.source.attachment_key], ['本地路径', d.source.local_path]];
  const sourceCopy = sourceValues.map(([key, value]) => `${key}：${display(value)}`).join('\n') + `\nSHA-256：${display(d.source.sha256)}`;
  const sourceHeader = el('div', 'copy-row'); sourceHeader.append(el('h4', '', '按文件与页序手动定位'), copyButton(sourceCopy, '复制来源定位', sourceBox));
  sourceBox.append(sourceHeader, kv(sourceValues), el('p', '', '此处保留来源信息；尚未提供文件打开或精确跳页入口。'));
  const fingerprint = el('details', 'detail-disclosure'); fingerprint.append(el('summary', '', '完整 SHA-256 声明'), kv([['SHA-256', d.source.sha256]])); sourceBox.append(fingerprint); source.append(sourceBox);

  const session = section('原生主会话', 'chat');
  const sessionBox = el('div', 'locator-box'); const sessionHead = el('div', 'copy-row');
  const sessionValues = [['Harness', d.producer.harness], ['Profile', d.producer.profile], ['工作目录', d.producer.working_directory], ['主会话 ID', d.producer.main_session_id], ['主会话标题', d.producer.main_session_title]];
  sessionHead.append(el('h4', '', '回到准确的主会话'), copyButton(sessionValues.map(([key, value]) => `${key}：${display(value)}`).join('\n'), '复制主会话定位', sessionBox));
  sessionBox.append(sessionHead, kv(sessionValues), el('p', '', '请在原生 Harness 中按身份手动定位。子会话仅用于追溯，不代替主会话。'));
  const producer = el('details', 'detail-disclosure'); producer.append(el('summary', '', '生产运行信息'), kv([['生产会话 ID', d.producer.production_session_id], ['Run ID', d.producer.run_id]])); sessionBox.append(producer); session.append(sessionBox);

  const history = section('记录与修订', 'clock');
  const recordRow = el('div', 'copy-row'); recordRow.append(el('span', 'quiet-text', '不可变记录 · 按接收顺序排列'), copyButton(d.record_id, '复制记录 ID', history)); history.append(recordRow);
  history.append(kv([['当前记录 ID', d.record_id], ['修订目标', d.revision_of], ['后继记录', d.superseded_by]]));
  const revisions = el('div', 'revision-list');
  d.revision_history.forEach((id) => {
    const node = button(id === d.record_id ? `${id} · 当前查看` : id, () => openDetail(id), `revision-link${id === d.record_id ? ' current' : ''}`);
    if (id === d.record_id) node.setAttribute('aria-current', 'true');
    revisions.append(node);
  }); history.append(revisions);
  const storage = el('details', 'detail-disclosure'); storage.append(el('summary', '', '提交信息'), kv([['内容摘要', d.content_sha256], ['接收序号', d.sequence]])); history.append(storage);
  content.replaceChildren(badges, title, el('p', 'detail-meta', `生成时间：${formatTime(d.generated_at)}\n接收时间：${formatTime(d.received_at)}（上海时间）`), excerpt, interpretation, check, source, session, history);
}
async function openDetail(id) {
  clearTimeout(toastTimer); visible('toast', false);
  const dialog = $('detail-dialog');
  const focusContent = dialog.open;
  state.detailRequest?.abort();
  const controller = new AbortController(); state.detailRequest = controller; state.detailId = id;
  // 关闭中的抽屉必须能被下一条发现接管：先作废那 150ms 的退场，再无条件写入新内容。
  // 以前这里只在 !dialog.open 时才开，关闭中的点击会被静默吞掉。
  if (dialog.hasAttribute('data-wb-closing')) cancelDialogClose(dialog);
  const title = el('h2', '', '正在读取发现…'); title.id = 'detail-title';
  $('detail-content').replaceChildren(title, el('div', 'loading-mark'));
  openDialog(dialog);
  dialog.scrollTop = 0;
  try {
    const d = await api(`/v1/discoveries/${encodeURIComponent(id)}`, controller.signal);
    if (!controller.signal.aborted) {
      renderDetail(d);
      if (focusContent) { $('detail-title').tabIndex = -1; $('detail-title').focus({ preventScroll: true }); }
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    if (error.status === 401) { disconnect(); text('page-error', error.message); visible('page-error', true); return; }
    const heading = el('h2', '', '详情读取失败'); heading.id = 'detail-title';
    $('detail-content').replaceChildren(heading, el('p', 'form-error', error.message), button('重试', () => openDetail(id), 'button secondary'));
  }
}

function openConnection() {
  if (state.preview) setPreview(false);
  visible('connect-error', false); $('token').value = ''; openDialog($('connect-dialog'));
}
['connect-main', 'connection-status'].forEach((id) => $(id).addEventListener('click', openConnection));
$('close-connect').addEventListener('click', () => closeDialog($('connect-dialog')));
$('connect-dialog').addEventListener('close', () => { $('token').value = ''; });
$('disconnect').addEventListener('click', () => { disconnect(); closeDialog($('connect-dialog')); toast('已断开连接，令牌已从页面清除'); });
$('connect-form').addEventListener('submit', async (event) => {
  event.preventDefault(); visible('connect-error', false);
  const token = $('token').value.trim();
  const controller = new AbortController();
  const abort = () => controller.abort(); $('connect-dialog').addEventListener('close', abort, { once: true });
  const result = await motion.trackSave($('connect-submit'), () => api('/v1/health', controller.signal, token), { resetAfter: 900 });
  if (controller.signal.aborted) return;
  if (result.ok) {
    // 成功态（已连接 + jelly + 粒子）至少要被看见一瞬，再随退场消失。
    // 预置 reduced-motion 的用户不等待，但 toast 仍然给，反馈不因偏好而缺席。
    if (!prefersReduced()) {
      await new Promise((resolve) => setTimeout(resolve, 260));
      if (controller.signal.aborted) return;
    }
    disconnect(); state.token = token; setStatus('connected');
    changeView('home');
    closeDialog($('connect-dialog'));
    toast('已连接本机工作台', 'success');
  } else if (!controller.signal.aborted) {
    // 失败态留在原地，错误文案不会被紧接着的关闭动作盖掉。
    text('connect-error', result.error.message); visible('connect-error', true);
  }
  $('connect-dialog').removeEventListener('close', abort);
});
$('close-detail').addEventListener('click', () => closeDialog($('detail-dialog')));
$('detail-dialog').addEventListener('close', () => {
  // close 事件是排队派发的：期间如果已经被下一条发现重新打开，这次关闭就不算数，
  // 不能把刚渲染好的内容清掉。
  if ($('detail-dialog').open) return;
  state.detailRequest?.abort(); state.detailId = null; $('detail-content').replaceChildren();
  if ($('detail-dialog').contains($('toast'))) { clearTimeout(toastTimer); visible('toast', false); }
});
for (const id of ['detail-dialog', 'connect-dialog']) $(id).addEventListener('click', (event) => {
  if (event.target !== $(id)) return;
  const box = $(id).getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDialog($(id));
});
// Esc 关闭弹窗：native 的 cancel 会瞬间消失，这里改走带退场动画的 closeDialog
for (const id of ['connect-dialog', 'detail-dialog', 'panel-dialog', 'workspace-dialog']) {
  const dialog = $(id);
  dialog?.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(dialog); });
}
$('refresh').addEventListener('click', () => refresh());
$('load-more').addEventListener('click', () => refresh(true));
// 刷新中子列表正在被替换，但输入绝不能被吞：始终记下当前输入，读完再补渲染一次。
$('search').addEventListener('input', () => {
  state.pendingQuery = $('search').value;
  if (!state.loading) renderList();
});
// 「更多」是个 popover：点外面、按 Esc 都收起，别让它一直挂在那儿。
const headMore = $('head-more');
document.addEventListener('click', (event) => { if (headMore?.open && !headMore.contains(event.target)) headMore.open = false; });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && headMore?.open) { headMore.open = false; headMore.querySelector('summary')?.focus(); } });
$('include-test').addEventListener('change', () => {
  closeDialog($('detail-dialog')); state.detailRequest?.abort();
  visible('test-banner', $('include-test').checked);
  if (state.token) refresh();
});
function changeView(view) {
  state.changeRequest?.abort();
  clearTimeout(toastTimer); visible('toast', false);
  state.listRequest?.abort(); state.loading = false;
  closeDialog($('detail-dialog')); closeDialog($('panel-dialog'));
  state.view = view; $('search').value = ''; discoveryFilter = '全部';
  for (const name of ['home', 'all']) {
    $(`nav-${name}`).classList.toggle('active', view === name);
    if (view === name) $(`nav-${name}`).setAttribute('aria-current', 'page'); else $(`nav-${name}`).removeAttribute('aria-current');
  }
  // 移动端底栏现在把四个锁定目的地都接上了：首页 / 工作空间 / 发现 / 资料。
  // 工作空间与资料由 experience 渲染，不走发现列表。
  const isFeed = view === 'home' || view === 'all';
  const titles = { home: '今日概览', all: '全部发现', projects: '工作空间', files: '资料' };
  const subtitles = {
    home: '把新的发现，放回你的工作脉络。',
    all: '按接收顺序，回看每一条发现与修订。',
    projects: '回到正在推进的工作，知道下一步在哪里。',
    files: '连接已有文件，在上下文中查看它们。',
  };
  if (view !== 'home') { $('page-title').replaceChildren(document.createTextNode(titles[view] || '')); text('page-subtitle', subtitles[view] || ''); }
  $('discoveries-title').textContent = view === 'home' ? 'Agent 今日发现' : '发现收件箱';
  // 视图类别挂到 body 上：首页的问候是配角，工作空间/资料这类页标题是身份，字号不同。
  // 项目内页、搜索与设置各有自己的类，样式不再借用资料页的类。
  document.body.classList.remove('view-home', 'view-feed', 'view-projects', 'view-files', 'view-project', 'view-search', 'view-settings');
  document.body.classList.add({ home: 'view-home', all: 'view-feed', projects: 'view-projects', project: 'view-project', search: 'view-search', settings: 'view-settings' }[view] || 'view-files');
  // 只有发现流才显示发现工作区与右栏；工作空间/资料用自己的版式。
  visible('discovery-workspace', isFeed);
  document.querySelectorAll('.mobile-nav [data-view]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  experience?.render(view);
  if (isFeed) {
    if (state.token || state.preview) refresh(); else renderList();
  }
}
$('nav-home').addEventListener('click', () => changeView('home'));
$('nav-all').addEventListener('click', () => changeView('all'));
function setPreview(on) {
  state.changeRequest?.abort(); spot.adapter = null; spot.lastJob = null;
  state.listRequest?.abort(); state.detailRequest?.abort();
  closeDialog($('detail-dialog')); closeDialog($('panel-dialog')); closeDialog($('workspace-dialog'));
  state.preview = on; state.items = []; state.next = null; state.loading = false;
  document.body.classList.toggle('preview-mode', on);
  $('freshness').parentElement.hidden = on;
  experience?.resetPreview();
  $('include-test').checked = false; visible('test-banner', false);
  const url = new URL(location.href); if (on) url.searchParams.set('preview', '1'); else url.searchParams.delete('preview'); history.replaceState(null, '', url);
  setStatus(state.token ? 'connected' : 'disconnected');
  changeView('home');
}
/* ============================================================================
   首页：聚光（2026-11-03）
   标题只说一件事：几件事等你决定。卡片叠一次只处理最上面一张，右甩/→ 知道了，左甩/← 稍后，
   Ctrl+Z 撤销。预览与真实工作台共用这一套界面，区别只在数据源（adapter）。
   ========================================================================== */
const spot = { adapter: null, lastJob: null, today: 0, date: null, introPlayed: false };
function greetingNow() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(new Date()));
  return hour < 6 ? '夜深了' : hour < 11 ? '上午好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
}
function objectIcon(symbol, tone) { const node = el('span', `object-icon ${tone || 'slate'}`); node.append(icon(symbol || 'document')); return node; }
function kbd(textValue) { const node = el('kbd', '', textValue); node.setAttribute('aria-hidden', 'true'); return node; }
function deckCard(item) {
  const frag = document.createDocumentFragment();
  const top = el('header', 'deck-top');
  const flag = el('span', `deck-flag${item.flag?.warm ? ' is-warm' : ''}`);
  const dot = el('i'); dot.setAttribute('aria-hidden', 'true');
  flag.append(dot, document.createTextNode(item.flag?.label || '重要变化'));
  top.append(flag, el('span', 'deck-src', [item.source, item.time].filter(Boolean).join(' · ')));
  frag.append(top, el('h3', 'deck-title', item.title), el('p', 'deck-sum', item.summary));
  if (item.extra) { const extra = el('div', 'deck-extra'); extra.append(...item.extra()); frag.append(extra); }
  if (item.context) {
    const ctxRow = el('p', 'deck-ctx'); const label = el('span');
    label.append(el('b', '', item.context.name), document.createTextNode(` · ${item.context.status} · 下一步：${item.context.next}`));
    ctxRow.append(objectIcon(item.context.symbol, item.context.tone), label); frag.append(ctxRow);
  }
  const actions = el('footer', 'deck-actions');
  const open = el('button', 'button primary deck-open', item.openLabel || '查看详情'); open.type = 'button'; open.dataset.deckAct = 'open'; open.append(icon('arrow'));
  const later = el('button', 'button ghost'); later.type = 'button'; later.dataset.deckAct = 'later'; later.setAttribute('aria-keyshortcuts', 'ArrowLeft'); later.append(kbd('←'), document.createTextNode('稍后'));
  const ack = el('button', 'button soft'); ack.type = 'button'; ack.dataset.deckAct = 'ack'; ack.setAttribute('aria-keyshortcuts', 'ArrowRight'); ack.append(document.createTextNode('知道了'), kbd('→'));
  actions.append(open, el('span', 'grow'), later, ack);
  frag.append(actions);
  return frag;
}
function deckEmpty() {
  if (!state.token && !state.preview) return null;
  if (!spot.adapter) {
    const wait = el('div', 'deck-done is-loading'); wait.append(el('div', 'loading-mark'), el('strong', '', '正在读取等你决定的事…')); return wait;
  }
  const done = el('div', 'deck-done');
  const mark = el('span', 'deck-done-mark'); mark.setAttribute('aria-hidden', 'true');
  // 只有这一处静态 SVG 进入 innerHTML，不含任何接口文本。
  mark.innerHTML = '<svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="26"/><path d="M18 29l7 7 13-15"/></svg>';
  done.append(mark, el('strong', '', '等你决定的事都处理完了'), el('span', '', spot.adapter.emptyText || ''));
  return done;
}
const deck = motion.createDeck($('deck'), {
  renderCard: deckCard, renderEmpty: deckEmpty, icon,
  onAction: (item, action) => deckAction(item, action),
  onOpen: (item, card) => deckOpen(item, card),
  onChange: () => { renderHero(true); syncCounts(true); },
});
function renderHero(animate = true) {
  if (state.view !== 'home') return;
  const date = dateFormat.format(spot.date || new Date());
  text('page-kicker', `${date} · ${greetingNow()}`);
  const title = $('page-title');
  if (!state.token && !state.preview) { title.replaceChildren(document.createTextNode('先连接本地工作台')); text('page-subtitle', ''); return; }
  if (!spot.adapter) { title.replaceChildren(document.createTextNode('正在读取工作台…')); text('page-subtitle', ''); return; }
  let num = $('hero-num'), words = $('hero-text');
  if (!num || !title.contains(num)) {
    num = el('span', 'roll hero-num'); num.id = 'hero-num'; num.append(el('span', '', String(deck.items.length)));
    words = el('span', 'hero-text'); words.id = 'hero-text';
    title.replaceChildren(num, words);
    animate = false;
  }
  const n = deck.items.length;
  motion.rollNumber(num, n, { animate });
  num.classList.toggle('is-zero', n === 0);
  words.textContent = n ? '件事等你决定' : '件事等你决定，今天清空了';
  text('page-subtitle', spot.adapter.subtitle?.() || '');
}
function syncCounts(animate = true) {
  const n = spot.adapter ? deck.items.length : 0;
  document.querySelectorAll('[data-count="home"]').forEach((node) => motion.popCount(node, n, { animate }));
  document.querySelectorAll('[data-count="all"]').forEach((node) => motion.popCount(node, (state.token || state.preview) ? spot.today : 0, { animate }));
  syncPending();
  const dots = $('deck-dots'); dots.replaceChildren(...deck.items.slice(0, 8).map((_, i) => el('i', i === 0 ? 'on' : '')));
  text('deck-pos', deck.items.length ? `还剩 ${deck.items.length} 件` : '');
  const shelf = $('deck-shelf');
  const label = spot.adapter?.shelfLabel?.() || '';
  shelf.hidden = !label; shelf.replaceChildren(document.createTextNode(label), icon('arrow'));
}
function syncPending() {
  const counts = new Map();
  if (spot.adapter) deck.items.forEach((item) => { if (item.project) counts.set(item.project, (counts.get(item.project) || 0) + 1); });
  document.querySelectorAll('[data-pending]').forEach((node) => { node.dataset.n = String(counts.get(node.dataset.pending) || 0); });
}
function useAdapter(adapter) {
  const changed = spot.adapter?.kind !== adapter?.kind;
  spot.adapter = adapter;
  if (changed) spot.lastJob = null;
  deck.set(adapter ? adapter.items() : [], { keepLast: !changed });
  renderHero(false); syncCounts(false);
}
async function deckAction(item, action) {
  const adapter = spot.adapter;
  if (!adapter) return;
  const job = { item, action, adapter, promise: null };
  spot.lastJob = job;
  toast(action === 'ack' ? `已标记知道了：${item.title}` : `已放进稍后：${item.title}`, 'info', { label: '撤销', run: undoDeck });
  job.promise = Promise.resolve().then(() => adapter.act(item, action));
  try {
    job.receipt = await job.promise;
    if (spot.adapter === adapter) syncCounts(true);
    if (adapter.kind === 'real' && spot.adapter === adapter && !deck.items.length && adapter.hasMore) refresh();
  } catch (error) {
    if (spot.adapter !== adapter) return;
    if (error.status === 401) { disconnect(); return; }
    if (spot.lastJob === job) { spot.lastJob = null; deck.clearLast(); }
    deck.restore(item, { from: action === 'ack' ? 1 : -1 });
    toast(error.status === 409 ? '这件事已有更新，已重新读取。' : '操作结果未确认，已放回原处，请刷新核对。');
    if (error.status === 409) refresh();
  }
}
async function undoDeck() {
  const job = spot.lastJob;
  if (!job || job.adapter !== spot.adapter) return;
  spot.lastJob = null;
  if (!deck.undo()) return;
  hideToast();
  try {
    const receipt = await job.promise;
    await job.adapter.undo(job.item, job.action, receipt);
    if (spot.adapter === job.adapter) syncCounts(true);
  } catch (error) {
    if (error.status === 401) { disconnect(); return; }
    if (spot.adapter !== job.adapter) return;
    toast('撤销结果未确认，已重新读取。');
    refresh();
  }
}
function deckOpen(item, card) {
  const from = card.getBoundingClientRect();
  spot.adapter?.open(item);
  // 详情从卡片原位长出来：等对话框进入布局后再量它的位置。
  requestAnimationFrame(() => {
    const dialog = [...document.querySelectorAll('dialog[open]')].pop();
    if (dialog) motion.growFrom(dialog, from, { radius: 22, endRadius: parseFloat(getComputedStyle(dialog).borderTopLeftRadius) || 0 });
  });
}
const changeState = (event, target, token = state.token) => api(`/v1/changes/${encodeURIComponent(event.change_id)}/state`, null, token,
  { schema_version: 1, action_key: crypto.randomUUID(), expected_version: event.version, expected_state_version: event.state_version, state: target });
function sourceLabel(d) {
  return d.source?.type === 'zotero_pdf' ? '文献发现' : d.source?.type === 'local_pdf' ? '文件发现' : '来源待补充';
}
function realAdapter(events, next) {
  const items = () => events.map((event) => {
    const d = event.discovery;
    return {
      id: event.change_id, rev: `${event.version}:${event.state_version}`, title: d.title, summary: d.interpretation,
      flag: { label: event.priority === 'high' ? '优先关注' : '重要变化', warm: event.priority === 'high' },
      source: sourceLabel(d) + (d.is_test ? ' · 测试' : ''), time: formatTime(event.updated_at), openLabel: '查看依据',
      extra: () => [semanticTag(d)], raw: event,
    };
  });
  return {
    kind: 'real', items, hasMore: Boolean(next),
    async act(item, action) { return changeState(item.raw, action === 'ack' ? 'known' : 'later'); },
    async undo(item, action, receipt) {
      const back = await changeState({ change_id: item.raw.change_id, version: receipt.version, state_version: receipt.state_version }, 'open');
      item.raw.version = back.version; item.raw.state_version = back.state_version; item.rev = `${back.version}:${back.state_version}`;
    },
    open(item) { openDetail(item.raw.record_id); },
    shelfLabel: () => '稍后与已知晓',
    openShelf: realShelf,
    subtitle: () => (spot.today ? `今天收到 ${spot.today} 条 Agent 发现；知道了与稍后都保存在本机。` : '今天还没有收到新的发现；知道了与稍后都保存在本机。'),
    emptyText: 'Agent 交付新的重要变化后，会出现在这里。',
    introRecords: () => [...state.items.map((_, i) => ({ kind: 'disc', i })), ...events.map(() => ({ kind: 'change' }))],
  };
}
async function realShelf() {
  const body = el('div', 'panel-stack'); body.append(el('p', 'muted-note', '正在读取…'));
  experience.panel('稍后与已知晓', body, '重要变化');
  const token = state.token;
  const params = (s) => new URLSearchParams({ limit: '30', state: s, include_test: String($('include-test').checked) });
  try {
    const [later, known] = await Promise.all([api(`/v1/changes?${params('later')}`, null, token), api(`/v1/changes?${params('known')}`, null, token)]);
    if (token !== state.token || state.preview) return;
    body.replaceChildren();
    for (const [label, page] of [['稍后', later], ['已知晓', known]]) {
      const head = el('div', 'section-heading'); head.append(el('h2', '', label), el('p', '', page.items.length ? `${page.items.length}${page.next_before ? '+' : ''} 件` : ''));
      body.append(head);
      if (!page.items.length) { body.append(el('p', 'muted-note', '这里暂时没有变化。')); continue; }
      const list = el('div', 'shelf-list');
      page.items.forEach((event) => {
        const row = el('div', 'shelf-row'), main = el('div', 'shelf-main');
        main.append(el('strong', '', event.discovery.title), el('span', 'quiet-text', formatTime(event.updated_at)));
        const acts = el('div', 'shelf-actions');
        const reopen = button('重新关注', async () => {
          reopen.disabled = true;
          try { await changeState(event, 'open', token); if (token !== state.token) return; row.remove(); toast('已重新关注：' + event.discovery.title); refresh(); }
          catch (error) { if (error.status === 401) { disconnect(); return; } toast(error.status === 409 ? '这件事已有更新，请重新打开。' : '操作结果未确认，请刷新核对。'); reopen.disabled = false; }
        }, 'quiet-button');
        acts.append(button('查看依据', () => openDetail(event.record_id), 'text-button'), reopen);
        row.append(main, acts); list.append(row);
      });
      body.append(list);
    }
  } catch (error) {
    if (error.status === 401) { disconnect(); return; }
    body.replaceChildren(el('p', 'form-error', error.message));
  }
}
$('deck-shelf').addEventListener('click', () => spot.adapter?.openShelf?.());
function syncNav(animate = true) {
  const active = state.view === 'project' ? 'projects' : state.view;
  const item = document.querySelector(`.navigation #nav-${active}`);
  motion.slidePlate(document.querySelector('.nav-plate'), item, { axis: 'y', animate });
  const tab = document.querySelector(`.mobile-nav [data-view="${active}"]`);
  motion.slidePlate(document.querySelector('.tab-plate'), tab, { axis: 'x', animate });
}
addEventListener('resize', () => syncNav(false));
document.fonts?.ready?.then(() => syncNav(false));
motion.hoverPlate($('discovery-list'), '.discovery-row');
document.addEventListener('keydown', (event) => {
  if (state.view !== 'home' || !spot.adapter || event.defaultPrevented || event.altKey) return;
  if (document.querySelector('dialog[open]') || event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { if (spot.lastJob) { event.preventDefault(); undoDeck(); } return; }
  if (event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key === 'ArrowRight' && deck.items.length) { event.preventDefault(); deck.throwTop(1); }
  else if (event.key === 'ArrowLeft' && deck.items.length) { event.preventDefault(); deck.throwTop(-1); }
});
/* 首次进入：每个浏览器会话播一次；地址加 #intro=1 强制重播，#intro=0 跳过（服务只接受固定查询串，所以放在 # 后）。记录太少时不播。 */
function maybeIntro() {
  if (state.view !== 'home' || !spot.adapter || spot.introPlayed || prefersReduced()) return;
  const q = new URLSearchParams(location.hash.slice(1)).get('intro');
  if (q === '0') return;
  if (q !== '1') { try { if (sessionStorage.getItem('wb-intro')) return; } catch {} }
  const records = spot.adapter.introRecords?.() || [];
  if (records.length < 6) return;
  spot.introPlayed = true;
  try { sessionStorage.setItem('wb-intro', '1'); } catch {}
  const head = document.querySelector('.page-head'), top = document.querySelector('.topbar');
  const early = [top, $('deck-foot'), document.querySelector('.discoveries .section-head'), document.querySelector('.list-footer'), document.querySelector('.list-footnote'), $('context-rail')].filter(Boolean);
  const rows = [...$('discovery-list').querySelectorAll('.discovery-row')];
  [head, $('deck'), ...early, ...rows].forEach((node) => node.setAttribute('data-intro', ''));
  document.querySelectorAll('[data-count]').forEach((node) => motion.popCount(node, 0, { animate: false }));
  const shown = (node) => node && node.offsetParent && node.getBoundingClientRect().width > 0;
  const fallback = (view) => { const side = $(`nav-${view}`); return shown(side) ? side.querySelector('span') : document.querySelector(`.mobile-nav [data-view="${view}"] span`); };
  motion.playIntro({
    records, area: $('main'), cards: deck.cards(), heroNumber: $('hero-num'), heroParts: [head], early,
    target(it) {
      if (it.kind === 'disc') {
        const row = rows[it.i];
        if (row && row.getBoundingClientRect().top < innerHeight - 60) return { el: row, land: true };
        return { el: fallback('all') };
      }
      const short = document.querySelector(`#project-shortcuts [data-proj="${it.proj}"] .object-icon`);
      return { el: shown(short) ? short : fallback('projects') };
    },
    onCount(kind, n) {
      if (kind === 'disc') document.querySelectorAll('[data-count="all"]').forEach((node) => motion.popCount(node, Math.min(n, spot.today), { animate: true }));
      else document.querySelectorAll('[data-count="home"]').forEach((node) => motion.popCount(node, n, { animate: true }));
    },
    onFinish() { syncCounts(false); syncNav(false); },
  });
}
const home = {
  show(adapter) { if (adapter) useAdapter(adapter); else if (!state.token) useAdapter(null); renderHero(false); },
  reload() { if (spot.adapter) { deck.set(spot.adapter.items()); renderHero(true); syncCounts(true); } },
  syncPending,
};
experience = createExperience({el,button,icon,tag,state,toast,copyButton,openDetail,openConnection,api,disconnect,navigate:changeView,setPreview,openDialog,closeDialog,home,syncNav});
$('preview-toggle').addEventListener('click', () => setPreview(!state.preview));
$('nav-projects').addEventListener('click', () => changeView('projects'));
$('nav-files').addEventListener('click', () => changeView('files'));
$('see-all').addEventListener('click', () => changeView('all'));
document.querySelectorAll('.mobile-nav [data-view]').forEach(b => b.addEventListener('click', () => changeView(b.dataset.view)));
setStatus('disconnected'); renderList(); experience.render('home');
if (new URLSearchParams(location.search).get('preview') === '1') setPreview(true);
