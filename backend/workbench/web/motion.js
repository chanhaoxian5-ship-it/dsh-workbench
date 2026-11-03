/*
 * Workbench 交互反馈动效模块（原生 ES Module，无依赖）
 * 配合 motion.css 使用。时长与缓动从 motion.css 的 :root 变量读取，改一处即可，
 * JS 的等待时间不再写死，与 CSS 保持一致。
 *
 * 处理的情况：快速连点、动画被打断、重复调用、系统「减少动态效果」偏好
 * （此时不等待动画，直接到达最终状态），以及缺少 Web Animations / <dialog> 的旧浏览器。
 */

const HAS_DOM = typeof window !== 'undefined' && typeof document !== 'undefined';
const MQ = HAS_DOM && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;
const reduced = () => !!(MQ && MQ.matches);
const CAN_ANIMATE = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
const SUPPORTS_SMOOTH = HAS_DOM && 'scrollBehavior' in document.documentElement.style;

/* 读取 CSS 变量时长，返回毫秒。减少动效时一律为 0。 */
function cssTime(name, fallback) {
  if (reduced()) return 0;
  const raw = HAS_DOM ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
  const n = parseFloat(raw);
  if (!raw || Number.isNaN(n)) return fallback;
  return /ms$/.test(raw) ? n : n * 1000;
}

/* 读取 CSS 变量缓动字符串，直接交给 Web Animations 使用。 */
function cssEase(name, fallback) {
  const raw = HAS_DOM ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
  return raw || fallback;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, reduced() ? 0 : ms));

/* 每个元素的调用序号：后一次调用会让前一次的后续步骤失效 */
const tokens = new WeakMap();
const nextToken = (el) => {
  const t = (tokens.get(el) || 0) + 1;
  tokens.set(el, t);
  return t;
};
const isCurrent = (el, t) => tokens.get(el) === t;

/* 每个元素、每个 key 只保留一个定时器：后一次调用会取消前一次，避免提前清掉新动画的 class */
const slots = new WeakMap();
function later(el, key, fn, delay) {
  let map = slots.get(el);
  if (!map) {
    map = Object.create(null);
    slots.set(el, map);
  }
  clearTimeout(map[key]);
  map[key] = setTimeout(() => {
    map[key] = 0;
    fn();
  }, delay);
}

/* 重新触发一次 CSS 动画 */
function restart(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/* 等待元素自身的动画结束；有超时兜底，避免动画被打断时 Promise 永远不结束 */
function settle(el, fallbackMs) {
  if (reduced()) return Promise.resolve();
  if (typeof el.getAnimations !== 'function') return wait(fallbackMs);
  const running = el.getAnimations().map((a) => a.finished.catch(() => {}));
  if (!running.length) return Promise.resolve();
  const timeout = new Promise((resolve) => setTimeout(resolve, fallbackMs + 60));
  return Promise.race([Promise.all(running), timeout]);
}

/* 滚动到指定位置：不支持 smooth 的浏览器直接设置，不抛错 */
function scrollTop(target, top) {
  const smooth = !reduced() && SUPPORTS_SMOOTH;
  if (target === window) {
    if (smooth) window.scrollTo({ top, behavior: 'smooth' });
    else window.scrollTo(0, top);
    return;
  }
  if (smooth && typeof target.scrollTo === 'function') target.scrollTo({ top, behavior: 'smooth' });
  else target.scrollTop = top;
}

/* ---------- 1. 视图切换：左右滑动，旧内容反向滑出，新内容从对侧进入 ----------
 * dir: 1 = 向右切换（新内容从右侧进入）；-1 = 向左切换（从左侧进入）。默认 1。
 */
async function swapView(container, update, { dir = 1 } = {}) {
  const t = nextToken(container);
  const sign = dir < 0 ? -1 : 1;
  container.style.setProperty('--wb-dx', `${sign * 36}px`);
  container.classList.remove('wb-view-in');
  container.classList.add('wb-view-out');
  await wait(cssTime('--wb-view-out-dur', 110));
  if (!isCurrent(container, t)) return;
  try {
    await update();
  } finally {
    if (isCurrent(container, t)) {
      container.classList.remove('wb-view-out');
      restart(container, 'wb-view-in');
      later(container, 'viewIn', () => {
        if (isCurrent(container, t)) container.classList.remove('wb-view-in');
      }, cssTime('--wb-view-in-dur', 240));
    }
  }
}

/* ---------- 2. 展开 / 收起（配合 [data-wb-expand] 结构） ---------- */
const esc = (s) => (HAS_DOM && window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&'));

function expand(el, open) {
  const next = typeof open === 'boolean' ? open : el.getAttribute('data-open') !== 'true';
  el.setAttribute('data-open', String(next));
  if (next) el.removeAttribute('inert');
  else el.setAttribute('inert', '');
  if (el.id) {
    document
      .querySelectorAll(`[aria-controls="${esc(el.id)}"]`)
      .forEach((trigger) => trigger.setAttribute('aria-expanded', String(next)));
  }
  return next;
}

/* ---------- 3. 新条目出现并短暂强调 ---------- */
function nearestScroller(el) {
  let p = el.parentElement;
  while (p && p !== document.body && p !== document.documentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 1) return p;
    p = p.parentElement;
  }
  return null;
}

/* 只滚最近的可滚动容器，避免 scrollIntoView 连带滚动整页或预览外层 */
function scrollIntoViewSafe(el) {
  if (typeof el.getBoundingClientRect !== 'function') return;
  const r = el.getBoundingClientRect();
  const scroller = nearestScroller(el);
  if (scroller) {
    const box = scroller.getBoundingClientRect();
    if (r.top < box.top + 8 || r.bottom > box.bottom - 8) {
      scrollTop(scroller, scroller.scrollTop + r.top - box.top - 8);
    }
    return;
  }
  if (r.top < 8 || r.bottom > window.innerHeight - 8) {
    scrollTop(window, Math.max(0, window.scrollY + r.top - 72));
  }
}

function reveal(el, { scroll = true, flash = true } = {}) {
  const t = nextToken(el);
  el.classList.remove('wb-enter', 'wb-flash');
  restart(el, 'wb-enter');
  if (flash) el.classList.add('wb-flash');
  if (scroll) scrollIntoViewSafe(el);
  if (flash) later(el, 'reveal:burst', () => isCurrent(el, t) && burst(el, { count: 10, distance: 36 }), 180);
  later(el, 'reveal:clean', () => {
    if (isCurrent(el, t)) el.classList.remove('wb-enter', 'wb-flash');
  }, reduced() ? 0 : cssTime('--wb-flash', 1200) + 100);
}

/* ---------- 3b. 粒子迸发：从元素中心向外弹出小圆点，结束后自动清理 ---------- */
const BURST_COLORS = ['#2f52c9', '#e0b357', '#1f7a4d', '#8a5a12', '#6ec89a'];
const MAX_PARTICLES = 96; // 同屏粒子上限，连续触发时保证帧率
let burstLayer = null;
let burstHost = null;
const layerHosts = new WeakSet();

/* native modal dialog 在 top-layer，会盖住 body 上任何 z-index。
 * 所以粒子层要跟 toast 一样搬进当前打开的 dialog，才不会被挡在下面。 */
function currentLayerHost() {
  if (!HAS_DOM) return null;
  return (
    document.querySelector('dialog[open]:not([data-wb-closing])') ||
    document.querySelector('dialog[open]') ||
    document.body
  );
}

/* dialog 关闭时清掉它内部的粒子层，不留空节点 */
function watchLayerHost(host) {
  if (!host || host === document.body || layerHosts.has(host)) return;
  layerHosts.add(host);
  host.addEventListener('close', () => {
    host.querySelectorAll('.wb-burst-layer').forEach((layer) => {
      if (!layer.childElementCount) layer.remove();
      else settleLayer(layer);
    });
    if (burstLayer && !burstLayer.isConnected) {
      burstLayer = null;
      burstHost = null;
    }
  });
}

/* 层里还有粒子在飞：等它们播完再删；已经空了就立刻删 */
function settleLayer(layer) {
  if (!layer || !layer.isConnected) return;
  const flyers = Array.from(layer.children).map((node) =>
    typeof node.getAnimations === 'function' ? node.getAnimations()[0] : null
  ).filter(Boolean);
  const drop = () => {
    if (layer.isConnected && !layer.childElementCount) layer.remove();
  };
  if (!flyers.length) {
    drop();
    return;
  }
  Promise.all(flyers.map((a) => a.finished.catch(() => {}))).then(drop);
}

function getBurstLayer() {
  const host = currentLayerHost() || document.body;
  if (!burstLayer || !burstLayer.isConnected || burstHost !== host) {
    const previous = burstLayer && burstLayer.isConnected ? burstLayer : null;
    burstLayer = document.createElement('div');
    burstLayer.className = 'wb-burst-layer';
    burstLayer.setAttribute('aria-hidden', 'true');
    host.append(burstLayer);
    burstHost = host;
    watchLayerHost(host);
    if (previous && previous !== burstLayer) settleLayer(previous);
  }
  return burstLayer;
}

/* burst(el, { count, distance, colors, duration }) —— 从 el 中心迸出粒子。
 * 减少动态效果、页面不可见、不支持 Web Animations、或粒子已满时直接不生成。 */
function burst(el, { count = 14, distance = 56, colors = BURST_COLORS, duration = 560 } = {}) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return;
  if (reduced() || !CAN_ANIMATE || document.hidden) return;
  const layer = getBurstLayer();
  const room = MAX_PARTICLES - layer.childElementCount;
  if (room <= 0) return;
  const n = Math.min(count, room);
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const easing = cssEase('--wb-ease-out', 'cubic-bezier(0.2, 0.7, 0.2, 1)');
  const frag = document.createDocumentFragment();
  const jobs = [];

  for (let i = 0; i < n; i++) {
    const p = document.createElement('span');
    p.className = 'wb-particle';
    const angle = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.4;
    const dist = distance * (0.7 + Math.random() * 0.5);
    const size = 4 + Math.random() * 4;
    p.style.width = size + 'px';
    p.style.height = size + 'px';
    p.style.background = colors[i % colors.length];
    frag.append(p);
    jobs.push({
      p,
      size,
      x0: cx - size / 2,
      y0: cy - size / 2,
      x1: cx + Math.cos(angle) * dist - size / 2,
      y1: cy + Math.sin(angle) * dist - size / 2,
      dur: duration + Math.random() * 160,
    });
  }
  layer.append(frag);

  // 只写 transform / opacity，交给合成层执行；写入后再统一起动，减少样式重算
  jobs.forEach((job) => {
    const anim = job.p.animate(
      [
        { transform: `translate3d(${job.x0}px, ${job.y0}px, 0) scale(1)`, opacity: 1 },
        { transform: `translate3d(${job.x1}px, ${job.y1}px, 0) scale(0.3)`, opacity: 0 },
      ],
      { duration: job.dur, easing }
    );
    const done = () => {
      job.p.remove();
      // 最后一批粒子落定后把空层收掉，别在 dialog 里留一个空节点
      if (layer.isConnected && !layer.childElementCount) {
        layer.remove();
        if (burstLayer === layer) {
          burstLayer = null;
          burstHost = null;
        }
      }
    };
    anim.onfinish = done;
    anim.oncancel = done;
  });
}

/* ---------- 3c. 弹跳：给元素加一次性 pop 动画（class 由 motion.css 定义） ---------- */
/* 读元素当前 CSS 动画的首个时长（毫秒）。时长写在 CSS 里，JS 不再猜一个数字。 */
function animationTime(el) {
  if (!HAS_DOM || !el || typeof getComputedStyle !== 'function') return 0;
  const raw = (getComputedStyle(el).animationDuration || '').split(',')[0].trim();
  const n = parseFloat(raw);
  if (!raw || Number.isNaN(n)) return 0;
  return /ms$/.test(raw) ? n : n * 1000;
}

/* 默认时长取元素实际在播的 CSS 动画（如 .wb-bounce-once 的 520ms），
 * 不再由调用方硬编码。以前传 420ms 会在回弹尾巴前把 class 摘掉，最后 100ms 被截断。 */
function bounce(el, cls = 'wb-bounce-once', dur = null) {
  if (!el || reduced()) return;
  restart(el, cls);
  const ms = dur != null ? dur : animationTime(el) || cssTime('--wb-bounce-dur', 520);
  later(el, 'bounce:' + cls, () => el.classList.remove(cls), ms);
}

/* ---------- 4. 保存：提交中 / 成功 / 失败，不提前报成功 ---------- */
const saveTimers = new WeakMap();
const savePending = new WeakMap();

function setSaveState(button, state, text) {
  clearTimeout(saveTimers.get(button));
  button.setAttribute('data-wb-state', state);
  button.setAttribute('aria-disabled', state === 'pending' ? 'true' : 'false');
  const icon = button.querySelector('.wb-save-icon');
  const label = button.querySelector('.wb-save-text');
  if (icon) icon.textContent = state === 'error' ? '!' : '';
  if (label) {
    if (!button.hasAttribute('data-wb-label-idle')) {
      button.setAttribute('data-wb-label-idle', label.textContent);
    }
    const fallback = {
      idle: button.getAttribute('data-wb-label-idle'),
      pending: button.getAttribute('data-wb-label-pending') || '保存中…',
      success: button.getAttribute('data-wb-label-success') || '已保存',
      error: button.getAttribute('data-wb-label-error') || '保存失败，点击重试',
    };
    label.textContent = text || fallback[state];
  }
}

/* task 可以是 Promise 或返回 Promise 的函数。返回 { ok, value | error }，从不抛出。 */
function trackSave(button, task, { resetAfter = 1800 } = {}) {
  if (savePending.has(button)) return savePending.get(button); // 防重复提交
  setSaveState(button, 'pending');
  const run = (async () => {
    try {
      const value = await (typeof task === 'function' ? task() : task);
      setSaveState(button, 'success');
      burst(button, { count: 16, distance: 64 });
      saveTimers.set(button, setTimeout(() => setSaveState(button, 'idle'), resetAfter));
      return { ok: true, value };
    } catch (error) {
      setSaveState(button, 'error'); // 失败保持，直到用户再次点击
      return { ok: false, error };
    } finally {
      savePending.delete(button);
    }
  })();
  savePending.set(button, run);
  return run;
}

/* ---------- 5. 阶段推进：就地改变状态 ---------- */
function setStage(list, index) {
  const items = Array.from(list.children);
  if (!items.length) return 0;
  const i = Math.max(0, Math.min(index, items.length - 1));
  const raw = list.getAttribute('data-index');
  const prev = raw === null ? -1 : Number(raw);
  items.forEach((item, n) => {
    item.setAttribute('data-state', n < i ? 'done' : n === i ? 'current' : 'todo');
    if (n === i) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
  list.setAttribute('data-index', String(i));
  // 当前点的弹跳由 CSS（[data-state="current"] .wb-stage-dot）负责；这里只补粒子，不再叠加 class 动画
  if (i !== prev && items[i]) {
    burst(items[i].querySelector('.wb-stage-dot') || items[i], { count: 12, distance: 44 });
  }
  return i;
}

/* ---------- 6. 任务完成 ---------- */
function completeTask(taskEl, done = true) {
  const was = taskEl.getAttribute('data-done') === 'true';
  taskEl.setAttribute('data-done', String(done));
  const box = taskEl.querySelector('[role="checkbox"]');
  if (box) box.setAttribute('aria-checked', String(done));
  if (done && !was) burst(box || taskEl, { count: 12, distance: 40 });
}

/* ---------- 7. 弹窗与侧面板（原生 <dialog>） ---------- */
const openers = new WeakMap();
const bound = new WeakSet();

function bindCancel(dialog) {
  if (bound.has(dialog)) return;
  bound.add(dialog);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault(); // 拦截 Esc，改走带动画的关闭
    closeLayer(dialog);
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeLayer(dialog); // 点击遮罩关闭
  });
}

function openLayer(dialog, opener) {
  bindCancel(dialog);
  nextToken(dialog); // 中断进行中的关闭
  dialog.removeAttribute('data-wb-closing');
  if (opener) openers.set(dialog, opener);
  if (!dialog.open) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', ''); // 不支持 <dialog> 的旧浏览器：至少能显示
  }
  const focusTarget = dialog.querySelector('[autofocus], [data-wb-close]') || dialog;
  requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
}

async function closeLayer(dialog) {
  if (!dialog.open || dialog.hasAttribute('data-wb-closing')) return;
  const t = nextToken(dialog);
  dialog.setAttribute('data-wb-closing', '');
  // 等退出动画结束再关闭。::backdrop 的动画不在 dialog.getAnimations() 里，
  // 所以这里直接按 CSS 时长等待，避免遮罩淡出被截断。
  await wait(cssTime('--wb-fast', 150));
  if (!isCurrent(dialog, t)) return; // 关闭期间被重新打开
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
  dialog.removeAttribute('data-wb-closing');
  const opener = openers.get(dialog);
  if (opener && opener.isConnected) opener.focus({ preventScroll: true });
}

/* 作废进行中的退场：递增 token 让 closeLayer 的等待失效，立刻摘掉 data-wb-closing，
 * 元素就停在「已经打开」的状态，可以被新内容直接接管。
 * 用 CSS animation 播放的退场由取消动画一并停掉，不会留下半透明的残影。 */
function cancelClose(dialog) {
  if (!dialog) return;
  nextToken(dialog);
  if (!dialog.hasAttribute('data-wb-closing')) return;
  // 先停掉正在播的退场 CSS 动画，再摘属性，避免一帧里出现半透明的中间态
  if (typeof dialog.getAnimations === 'function') {
    dialog.getAnimations().forEach((anim) => anim.cancel());
  }
  dialog.removeAttribute('data-wb-closing');
}

/* ---------- 8. 延迟显示的加载提示：短请求不闪烁 ---------- */
async function withLoading(region, task, { delay = 300, minShow = 350 } = {}) {
  if (region.dataset.wbLoadingBusy === 'true') return;
  region.dataset.wbLoadingBusy = 'true';
  const loader = region.querySelector('[data-wb-loading]');
  let shownAt = 0;
  region.setAttribute('aria-busy', 'true');
  const timer = setTimeout(() => {
    shownAt = performance.now();
    if (loader) loader.hidden = false;
  }, reduced() ? 0 : delay);
  try {
    return await (typeof task === 'function' ? task() : task);
  } finally {
    clearTimeout(timer);
    if (shownAt) {
      const rest = minShow - (performance.now() - shownAt);
      if (rest > 0) await wait(rest); // 已显示就至少停留一会，避免一闪而过
    }
    if (loader) loader.hidden = true;
    region.removeAttribute('aria-busy');
    delete region.dataset.wbLoadingBusy;
  }
}

/* ---------- 9. 提示条：单例，连续触发只更新文字 ---------- */
let toastNode = null;
let toastTimer = 0;
let toastCloseTimer = 0;
let toastToken = 0;

function toast(text, { tone = 'info', duration = 2400 } = {}) {
  if (!HAS_DOM) return;
  if (!toastNode) {
    toastNode = document.createElement('div');
    toastNode.className = 'wb-toast';
    toastNode.setAttribute('role', 'status');
    toastNode.setAttribute('aria-live', 'polite');
    toastNode.hidden = true;
    document.body.append(toastNode);
  }
  const t = ++toastToken;
  clearTimeout(toastTimer);
  clearTimeout(toastCloseTimer);
  toastNode.textContent = text;
  toastNode.setAttribute('data-tone', tone);
  if (toastNode.hidden) {
    toastNode.hidden = false;
    void toastNode.offsetWidth; // 先上屏再加 data-open，进入动画才会播放
  }
  toastNode.setAttribute('data-open', 'true');
  if (tone === 'success') bounce(toastNode, 'wb-toast-pop', 480);
  toastTimer = setTimeout(() => {
    if (t !== toastToken) return;
    toastNode.setAttribute('data-open', 'false');
    // 等 transform 完全收回（--wb-toast-dur）后再隐藏，否则收尾动画会被截断
    toastCloseTimer = setTimeout(() => {
      if (t === toastToken) toastNode.hidden = true;
    }, cssTime('--wb-toast-dur', 380));
  }, duration);
}

/* ---------- 10. 列表重排：先量旧位置，改完 DOM 再补间回新位置 ---------- */
function reorder(list, mutate, { duration } = {}) {
  if (!CAN_ANIMATE) {
    if (typeof mutate === 'function') mutate();
    return;
  }
  const dur = duration != null ? duration : cssTime('--wb-slow', 300);
  const items = Array.from(list.children);
  // 先收掉上一轮补间，避免带着 transform 量位置
  items.forEach((el) => {
    if (typeof el.getAnimations !== 'function') return;
    el.getAnimations().forEach((a) => {
      if (a.id === 'wb-flip') a.cancel();
    });
  });
  const before = new Map(items.map((el) => [el, el.getBoundingClientRect()]));
  if (typeof mutate === 'function') mutate();
  if (reduced() || !dur) return;
  const easing = cssEase('--wb-ease-out', 'cubic-bezier(0.2, 0.7, 0.2, 1)');
  Array.from(list.children).forEach((el) => {
    const a = before.get(el);
    if (!a) return;
    const b = el.getBoundingClientRect();
    const dy = a.top - b.top;
    if (Math.abs(dy) < 1) return;
    const anim = el.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
      { duration: dur, easing }
    );
    anim.id = 'wb-flip';
  });
}

/* ---------- 11. 移除条目：收起高度和透明度后再删除 ----------
 * 注意：这里补间的是 height / margin，会触发布局，只用于低频的列表删除。 */
async function removeItem(el, { duration } = {}) {
  if (!el || el.dataset.wbLeaving === 'true') return;
  el.dataset.wbLeaving = 'true';
  const dur = duration != null ? duration : cssTime('--wb-base', 220);
  if (reduced() || !CAN_ANIMATE || !dur || typeof el.animate !== 'function') {
    el.remove();
    return;
  }
  const style = getComputedStyle(el);
  const h = el.getBoundingClientRect().height;
  const mt = parseFloat(style.marginTop) || 0;
  const mb = parseFloat(style.marginBottom) || 0;
  el.style.overflow = 'hidden';
  el.style.transformOrigin = 'center';
  // 第一段：先轻微弹起，给用户一个“被选中、将移除”的确认感（约 40% 时长）
  const popDur = Math.round(dur * 0.4);
  const pop = el.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.03)', offset: 0.5 },
      { transform: 'scale(0.98)', offset: 0.8 },
      { transform: 'scale(1)' },
    ],
    { duration: popDur, easing: cssEase('--wb-ease-spring', 'cubic-bezier(0.34, 1.56, 0.64, 1)') }
  );
  burst(el, { count: 10, distance: 32, duration: 420 }); // 弹起瞬间迸出少量粒子
  await pop.finished.catch(() => {});
  // 第二段：横向飞出并收起高度，略带弹性的收尾
  const collapseDur = dur - popDur;
  const anim = el.animate(
    [
      { height: h + 'px', marginTop: mt + 'px', marginBottom: mb + 'px', opacity: 1, transform: 'translateX(0) scale(1)' },
      { height: h + 'px', marginTop: mt + 'px', marginBottom: mb + 'px', opacity: 0.6, transform: 'translateX(28px) scale(0.96)', offset: 0.35 },
      { height: '0px', marginTop: '0px', marginBottom: '0px', opacity: 0, transform: 'translateX(40px) scale(0.92)' },
    ],
    { duration: collapseDur, easing: cssEase('--wb-ease-in', 'cubic-bezier(0.4, 0, 1, 1)') }
  );
  await anim.finished.catch(() => {});
  el.remove();
}

/* ---------- 12. 分段切换：指示条跟随选中项滑动 ---------- */
function initTabs(root) {
  const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
  const indicator = root.querySelector('.wb-tab-indicator');
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls') || ''));
  if (!tabs.length) return { select() {} };
  let current = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
  if (current < 0) current = 0;

  const place = (animate) => {
    const tab = tabs[current];
    if (!indicator || !tab) return;
    const r = tab.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    if (!animate) indicator.style.transition = 'none';
    indicator.style.width = r.width + 'px';
    indicator.style.transform = `translateX(${r.left - box.left - (root.clientLeft || 0)}px)`;
    if (!animate) {
      void indicator.offsetWidth;
      indicator.style.transition = '';
    }
  };

  const select = (index, { focus = false, animate = true } = {}) => {
    current = Math.max(0, Math.min(index, tabs.length - 1));
    tabs.forEach((tab, i) => {
      const on = i === current;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (panels[i]) panels[i].hidden = !on;
    });
    place(animate);
    if (focus) tabs[current].focus({ preventScroll: true });
    return current;
  };

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(i));
    tab.addEventListener('keydown', (event) => {
      let next = null;
      if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      select(next, { focus: true });
    });
  });

  select(current, { animate: false });
  requestAnimationFrame(() => place(false));
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => place(false)).observe(root);
  return { select: (index) => select(index) };
}

/* ---------- 13. 骨架屏：短请求不闪，已显示则至少停留一会 ---------- */
async function withSkeleton(region, task, { delay = 200, minShow = 500 } = {}) {
  if (region.dataset.wbSkeletonBusy === 'true') return;
  region.dataset.wbSkeletonBusy = 'true';
  const skeleton = region.querySelector('[data-wb-skeleton]');
  const content = region.querySelector('.wb-content');
  let shownAt = 0;
  region.setAttribute('aria-busy', 'true');
  const timer = setTimeout(() => {
    shownAt = performance.now();
    if (skeleton) skeleton.hidden = false;
    if (content) content.hidden = true;
  }, reduced() ? 0 : delay);
  try {
    return await (typeof task === 'function' ? task() : task);
  } finally {
    clearTimeout(timer);
    if (shownAt) {
      const rest = minShow - (performance.now() - shownAt);
      if (rest > 0) await wait(rest);
    }
    if (skeleton) skeleton.hidden = true;
    if (content) content.hidden = false;
    region.removeAttribute('aria-busy');
    delete region.dataset.wbSkeletonBusy;
  }
}

/* ============================================================================
 * 9. 聚光（2026-11-03 重塑）：弹簧曲线、跟手底板、滚动数字、形状接力、卡片叠、首次进入
 *    这里只管「怎么动」；数据、文案和业务状态都由调用方传入。
 * ========================================================================== */

/* 弹簧：按刚度 k / 阻尼 c 数值积分，写成 CSS linear()。不支持 linear() 的浏览器退回近似贝塞尔。 */
function springCurve(k, c) {
  let x = 0, v = 0, t = 0, still = 0;
  const dt = 1 / 600, pts = [];
  while (t < 2.5) {
    const a = -k * (x - 1) - c * v; v += a * dt; x += v * dt; t += dt; pts.push(x);
    if (Math.abs(x - 1) < 0.003 && Math.abs(v) < 0.02) { if (!still) still = t; if (t - still > 0.04) break; } else still = 0;
  }
  const N = 40, out = [];
  for (let i = 0; i <= N; i += 1) {
    const idx = Math.min(pts.length - 1, Math.round((i / N) * (pts.length - 1)));
    out.push(i === 0 ? 0 : i === N ? 1 : +pts[idx].toFixed(4));
  }
  return { easing: 'linear(' + out.join(',') + ')', duration: Math.round(t * 1000) };
}
const CAN_LINEAR = HAS_DOM && typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
  && CSS.supports('transition-timing-function', 'linear(0, 1)');
const SPRING_FALLBACK = { click: 'cubic-bezier(.2,.9,.3,1.1)', slide: 'cubic-bezier(.2,.85,.25,1)', pop: 'cubic-bezier(.3,1.5,.5,1)' };
// 咔嗒：导航底板与按压回弹，约 2% 过冲；滑入：卡片归位、面板展开，几乎不过冲；回弹：计数徽章这类小东西。
const SPRINGS = { click: springCurve(420, 32), slide: springCurve(240, 28), pop: springCurve(560, 17) };
if (HAS_DOM && CAN_LINEAR) {
  // CSSOM 写变量不受 style-src 'self' 限制；CSS 里写的是不支持 linear() 时的退路。
  for (const [name, s] of Object.entries(SPRINGS)) {
    document.documentElement.style.setProperty('--spr-' + name, s.easing);
    document.documentElement.style.setProperty('--spr-' + name + '-d', s.duration + 'ms');
  }
}
const springEase = (name) => (CAN_LINEAR ? SPRINGS[name].easing : SPRING_FALLBACK[name]);
const springMs = (name) => (reduced() ? 1 : SPRINGS[name].duration);
const clampNum = (v, a, b) => Math.min(b, Math.max(a, v));

/* 先不播过渡、直接到位：首帧定位、跨视口重排时用。 */
function placeNow(el, fn) {
  el.style.transition = 'none';
  fn();
  void el.offsetWidth;
  el.style.transition = '';
}

/* 跟手底板：一块底板在一组按钮之间滑动，代替各自的选中底色。axis 'y' 用于侧栏，'x' 用于底部标签栏。 */
function slidePlate(plate, target, { axis = 'y', animate = true } = {}) {
  if (!plate) return;
  if (!target || !target.offsetParent) { plate.style.opacity = '0'; return; }
  const apply = () => {
    plate.style.opacity = '1';
    if (axis === 'y') {
      plate.style.transform = 'translate3d(0,' + target.offsetTop + 'px,0)';
      plate.style.height = target.offsetHeight + 'px';
    } else {
      plate.style.transform = 'translate3d(' + target.offsetLeft + 'px,0,0)';
      plate.style.width = target.offsetWidth + 'px';
    }
  };
  if (animate && !reduced() && plate.dataset.placed === 'true') apply();
  else placeNow(plate, apply);
  plate.dataset.placed = 'true';
}

/* 悬停底板：鼠标在一列条目间移动时，同一块底板跟着滑过去；触摸不触发。
   列表被整体重绘时底板会被一起清掉，所以每次悬停都确认它还在。 */
function hoverPlate(container, itemSelector) {
  if (!container || container.dataset.wbHoverPlate === 'true') return;
  container.dataset.wbHoverPlate = 'true';
  let shown = false;
  const plate = () => {
    let node = container.querySelector(':scope > .hover-plate');
    if (!node) {
      node = document.createElement('span');
      node.className = 'hover-plate';
      node.setAttribute('aria-hidden', 'true');
      container.prepend(node);
      shown = false;
    }
    return node;
  };
  container.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const item = event.target.closest(itemSelector);
    if (!item || !container.contains(item)) return;
    const node = plate();
    const apply = () => {
      node.style.transform = 'translate3d(0,' + item.offsetTop + 'px,0)';
      node.style.height = item.offsetHeight + 'px';
    };
    if (shown && !reduced()) apply(); else placeNow(node, apply);
    node.style.opacity = '1';
    shown = true;
  });
  container.addEventListener('pointerleave', () => {
    const node = container.querySelector(':scope > .hover-plate');
    if (node) node.style.opacity = '0';
    shown = false;
  });
}

/* 滚动数字：变少往上翻走，变多往下翻来。host 里只放数字本身。 */
function rollNumber(host, value, { animate = true } = {}) {
  if (!host) return;
  const text = String(value);
  [...host.children].slice(0, -1).forEach((node) => node.remove());
  const old = host.lastElementChild;
  if (old && old.textContent === text) return;
  const prev = old ? Number(old.textContent) : NaN;
  const next = document.createElement('span');
  next.textContent = text;
  host.append(next);
  if (!old) return;
  if (!animate || reduced() || !CAN_ANIMATE) { old.remove(); return; }
  const dir = Number(value) < prev ? -1 : 1;
  const out = old.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(' + dir * -70 + '%)', opacity: 0 }],
    { duration: 220, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
  out.finished.then(() => old.remove(), () => old.remove());
  next.animate([{ transform: 'translateY(' + dir * 70 + '%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
    { duration: springMs('click'), easing: springEase('click') });
}

/* 计数徽章：数字变了就弹一下；为 0 时由 CSS 收起。 */
function popCount(el, n, { animate = true } = {}) {
  if (!el) return;
  const was = Number(el.dataset.n || 0);
  el.dataset.n = String(n);
  el.textContent = String(n);
  if (animate && !reduced() && CAN_ANIMATE && n > 0 && was !== n) {
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.28)' }, { transform: 'scale(1)' }], { duration: springMs('pop'), easing: 'ease-out' });
  }
}

/* 形状接力：元素从 from 这块矩形里长出来（或收回去）。只动 clip-path，不改布局。 */
function insetFrom(from, to, r) {
  return 'inset(' + (from.top - to.top) + 'px ' + (to.right - from.right) + 'px ' + (to.bottom - from.bottom) + 'px ' + (from.left - to.left) + 'px round ' + r + 'px)';
}
function growFrom(el, from, { radius = 22, endRadius = radius, reverse = false } = {}) {
  if (!el || !from || reduced() || !CAN_ANIMATE) return Promise.resolve();
  const to = el.getBoundingClientRect();
  const a = insetFrom(from, to, radius), b = 'inset(0px 0px 0px 0px round ' + endRadius + 'px)';
  const duration = reverse ? Math.round(springMs('slide') * 0.6) : springMs('slide');
  const anim = el.animate(reverse ? [{ clipPath: b }, { clipPath: a }] : [{ clipPath: a }, { clipPath: b }],
    { duration, easing: reverse ? 'cubic-bezier(.4,0,.9,.6)' : springEase('slide') });
  return anim.finished.catch(() => {});
}

/* ---------- 卡片叠：一次只处理最上面一张 ----------
 * 右甩 / 「知道了」= ack，左甩 / 「稍后」= later。业务结果由 onAction 负责；
 * 失败时调用方用 restore() 把卡放回来，或者整体 set() 重新读取。 */
const STACK = [[0, 1], [18, 0.952], [34, 0.904], [46, 0.86]];
const stackTransform = (i) => { const [y, s] = STACK[Math.min(i, 3)]; return 'translate3d(0,' + y + 'px,0) scale(' + s + ')'; };

function createDeck(host, { renderCard, renderEmpty, onAction, onOpen, onChange, icon, labels = { ack: '知道了', later: '稍后' } } = {}) {
  let items = [];
  let drag = null;
  let flying = null;
  let last = null;
  const cards = () => [...host.children].filter((node) => node.classList.contains('deck-card') && !node.classList.contains('flying'));

  function intent(kind, label, iconName) {
    const node = document.createElement('span');
    node.className = 'deck-intent deck-intent-' + kind;
    node.setAttribute('aria-hidden', 'true');
    if (icon) node.append(icon(iconName));
    node.append(document.createTextNode(label));
    return node;
  }
  function build(item) {
    const card = document.createElement('article');
    card.className = 'deck-card';
    card.dataset.id = item.id;
    card.setAttribute('aria-roledescription', '卡片');
    card.setAttribute('aria-label', item.title || '');
    const inner = document.createElement('div');
    inner.className = 'deck-card-in';
    inner.append(renderCard(item));
    card.append(inner, intent('ack', labels.ack, 'check'), intent('later', labels.later, 'clock'));
    return card;
  }
  function size(list = cards()) {
    if (!list.length) { host.style.height = ''; return; }
    list.forEach((card) => { card.style.height = 'auto'; });
    const h = Math.max(...list.map((card) => card.offsetHeight));
    list.forEach((card) => { card.style.height = h + 'px'; });
    host.style.height = h + 'px';
  }
  function layout(animate = true) {
    const list = cards();
    list.forEach((card, i) => {
      const apply = () => {
        card.dataset.pos = String(Math.min(i, 3));
        card.style.zIndex = String(20 - i);
        card.style.transform = stackTransform(i);
        card.style.setProperty('--reveal', i === 0 ? '1' : '0');
        card.style.opacity = i > 2 ? '0' : '1';
      };
      if (animate && !reduced()) apply(); else placeNow(card, apply);
      card.inert = i !== 0;
      if (i === 0) card.removeAttribute('aria-hidden'); else card.setAttribute('aria-hidden', 'true');
    });
    size(list);
    host.classList.toggle('is-empty', !list.length);
    onChange?.(items.length);
  }
  function showEmpty(animate) {
    host.style.height = '';
    host.classList.add('is-empty');
    const node = renderEmpty ? renderEmpty() : null;
    host.replaceChildren(...(node ? [node] : []));
    if (node && animate && !reduced() && CAN_ANIMATE) {
      node.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: springMs('slide'), easing: springEase('slide') });
    }
    onChange?.(0);
  }
  function set(next, { keepLast = false } = {}) {
    if (flying) flying.finish();
    const same = next.length === items.length && next.every((item, i) => item.id === items[i].id && item.rev === items[i].rev);
    items = [...next];
    if (!keepLast) last = null;
    if (same && cards().length === items.length) { items.forEach((item, i) => { const c = cards()[i]; if (c) c.__item = item; }); onChange?.(items.length); return; }
    if (!items.length) { showEmpty(false); return; }
    host.replaceChildren(...items.map(build));
    layout(false);
  }
  function throwTop(dir, velocity = 1.8, fromDx = 0) {
    if (flying) flying.finish();
    const card = cards()[0];
    if (!card || !items.length) return null;
    const item = items[0];
    const action = dir > 0 ? 'ack' : 'later';
    const width = host.clientWidth || 600;
    const current = getComputedStyle(card).transform;
    card.classList.remove('dragging', 'armed-ack', 'armed-later');
    card.classList.add('flying');
    card.inert = true;
    card.style.setProperty(dir > 0 ? '--ack' : '--later', '1');
    card.style.setProperty(dir > 0 ? '--later' : '--ack', '0');
    last = { item, action };
    items.shift();
    layout(true);
    const tx = dir * (width * 1.05 + 180);
    const speed = Math.max(Math.abs(velocity), 1.4);
    const duration = reduced() ? 1 : clampNum(Math.abs(tx - fromDx) / speed, 180, 360);
    let anim = null;
    const done = () => {
      if (flying === anim) flying = null;
      card.remove();
      if (!items.length && !cards().length) showEmpty(true);
    };
    if (CAN_ANIMATE && !reduced()) {
      anim = card.animate([
        { transform: current === 'none' ? stackTransform(0) : current, opacity: 1 },
        { transform: 'translate3d(' + tx * 0.7 + 'px,-20px,0) rotate(' + dir * 12 + 'deg)', opacity: 1, offset: 0.7 },
        { transform: 'translate3d(' + tx + 'px,-28px,0) rotate(' + dir * 16 + 'deg)', opacity: 0 },
      ], { duration, easing: 'cubic-bezier(.25,.8,.45,1)', fill: 'forwards' });
      flying = anim;
      anim.finished.then(done, done);
    } else done();
    onAction?.(item, action);
    return last;
  }
  /* 把一张卡放回最上面：撤销或提交失败时用。from=1 从右边飞回，-1 从左边。 */
  function restore(item, { from = 1 } = {}) {
    if (flying) flying.finish();
    if (!cards().length) host.replaceChildren();
    items = [item, ...items.filter((other) => other.id !== item.id)];
    cards().filter((card) => card.dataset.id === item.id).forEach((card) => card.remove());
    const card = build(item);
    host.prepend(card);
    const width = host.clientWidth || 600;
    placeNow(card, () => {
      card.style.transform = 'translate3d(' + from * (width * 1.05 + 180) + 'px,-28px,0) rotate(' + from * 16 + 'deg)';
      card.style.opacity = '0';
      card.style.zIndex = '30';
    });
    layout(true);
  }
  function undo() {
    const step = last;
    if (!step) return null;
    last = null;
    restore(step.item, { from: step.action === 'ack' ? 1 : -1 });
    return step;
  }
  function paint(dx) {
    const width = host.clientWidth || 600;
    const r = clampNum(dx / width, -1, 1);
    drag.card.style.transform = 'translate3d(' + dx + 'px,' + -Math.abs(dx) * 0.04 + 'px,0) rotate(' + r * 8 + 'deg)';
    const ack = clampNum(dx / (width * 0.28), 0, 1), later = clampNum(-dx / (width * 0.28), 0, 1);
    drag.card.style.setProperty('--ack', ack.toFixed(3));
    drag.card.style.setProperty('--later', later.toFixed(3));
    const armed = ack >= 1 ? 1 : later >= 1 ? -1 : 0;
    if (armed !== drag.armed) {
      drag.armed = armed;
      drag.card.classList.toggle('armed-ack', armed === 1);
      drag.card.classList.toggle('armed-later', armed === -1);
      if (armed && navigator.vibrate) { try { navigator.vibrate(8); } catch {} }
    }
    if (drag.next) {
      const p = clampNum(Math.abs(dx) / (width * 0.5), 0, 1);
      const [y, s] = STACK[1];
      drag.next.style.transform = 'translate3d(0,' + y * (1 - p) + 'px,0) scale(' + (s + (1 - s) * p) + ')';
      drag.next.style.setProperty('--reveal', clampNum((p - 0.35) / 0.5, 0, 1).toFixed(3));
    }
  }
  host.addEventListener('click', (event) => {
    const b = event.target.closest('[data-deck-act]');
    if (!b || !host.contains(b)) return;
    const card = b.closest('.deck-card');
    if (!card || card !== cards()[0]) return;
    const act = b.dataset.deckAct;
    if (act === 'open') onOpen?.(items[0], card);
    else if (act === 'ack') throwTop(1);
    else if (act === 'later') throwTop(-1);
  });
  host.addEventListener('pointerdown', (event) => {
    const card = event.target.closest('.deck-card');
    if (!card || card !== cards()[0] || event.button !== 0) return;
    if (event.target.closest('button, a, input, select, textarea, summary')) return;
    drag = { card, id: event.pointerId, x0: event.clientX, y0: event.clientY, dx: 0, lock: null, armed: 0, samples: [[event.timeStamp, event.clientX]] };
  });
  window.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x0, dy = event.clientY - drag.y0;
    if (!drag.lock) {
      if (Math.hypot(dx, dy) < 6) return;
      drag.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.lock === 'y') { drag = null; return; }
      try { drag.card.setPointerCapture(event.pointerId); } catch {}
      drag.card.classList.add('dragging');
      drag.next = cards()[1];
      drag.next?.classList.add('follow');
    }
    event.preventDefault();
    drag.dx = dx;
    drag.samples.push([event.timeStamp, event.clientX]);
    while (drag.samples.length > 2 && event.timeStamp - drag.samples[0][0] > 100) drag.samples.shift();
    paint(dx);
  }, { passive: false });
  const end = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.lock !== 'x') return;
    const [t0, x0] = d.samples[0], [t1, x1] = d.samples[d.samples.length - 1];
    const v = t1 > t0 ? (x1 - x0) / (t1 - t0) : 0;
    const width = host.clientWidth || 600;
    const commit = event.type !== 'pointercancel' && (Math.abs(d.dx) > width * 0.28 || (Math.abs(v) > 0.55 && Math.sign(v) === Math.sign(d.dx) && Math.abs(d.dx) > 24));
    d.next?.classList.remove('follow');
    if (commit) throwTop(Math.sign(d.dx), v, d.dx);
    else {
      d.card.classList.remove('dragging', 'armed-ack', 'armed-later');
      void d.card.offsetWidth;
      d.card.style.setProperty('--ack', '0');
      d.card.style.setProperty('--later', '0');
      layout(true);
    }
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => { if (cards().length) size(); });
  document.fonts?.ready?.then(() => { if (cards().length) size(); });

  return {
    set, throwTop, undo, restore, size,
    get items() { return [...items]; },
    get last() { return last; },
    clearLast() { last = null; },
    get top() { return cards()[0] || null; },
    cards,
  };
}

/* ---------- 首次进入：汇流 ----------
 * 每条记录是一颗粒子：先按黄金角旋开成一朵花，荡开一圈冲击波；
 * 中性和冷色粒子沿弧线飞回各自的归处，暖色粒子留下，长成「等你决定」的卡片，
 * 数字最后落进标题。任意点击、按键、滚轮立刻跳到终态；减少动态效果时不播。
 * 被揭开的元素由调用方先打上 data-intro，CSS 在 body.wb-intro 期间把它们藏起来。 */
function playIntro({ records, area, target, cards = [], heroNumber, heroParts = [], early = [], onCount, onFinish, warmColor = '#e8501f' } = {}) {
  if (!HAS_DOM || reduced() || !CAN_ANIMATE || !records?.length || !area) { onFinish?.(); return () => {}; }
  const body = document.body;
  body.classList.add('wb-intro');
  const layer = document.createElement('div');
  layer.className = 'intro-layer';
  layer.setAttribute('aria-hidden', 'true');
  body.append(layer);
  const anims = [], timers = [];
  let ended = false;
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  const A = (el, kf, o) => { const a = el.animate(kf, o); anims.push(a); return a; };
  const ease = 'cubic-bezier(.16,1,.3,1)';
  const show = (el, kf, o) => {
    if (!el || !el.hasAttribute('data-intro')) return;
    el.removeAttribute('data-intro');
    A(el, kf || [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], o || { duration: 420, easing: ease });
  };
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  const finish = () => {
    if (ended) return;
    ended = true;
    timers.forEach(clearTimeout);
    anims.forEach((a) => { try { a.finish(); } catch {} });
    layer.remove();
    document.querySelectorAll('.intro-bloom').forEach((node) => node.remove());
    document.querySelectorAll('[data-intro]').forEach((node) => node.removeAttribute('data-intro'));
    body.classList.remove('wb-intro');
    events.forEach((type) => removeEventListener(type, finish, true));
    onFinish?.();
  };
  events.forEach((type) => addEventListener(type, finish, { capture: true, passive: true }));

  const m = area.getBoundingClientRect();
  const vis = Math.min(innerHeight, m.bottom) - Math.max(0, m.top);
  const cx = m.left + m.width / 2;
  const cy = Math.max(0, m.top) + Math.min(Math.max(vis, 320), 820) * 0.46;
  const items = records.map((r) => ({ ...r, s: r.kind === 'change' ? 14 : r.kind === 'disc' ? 11 : r.kind === 'issue' ? 8 : 10 }));
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = items.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  const N = items.length, K = 12;
  const R = Math.min(m.width * 0.46, Math.max(vis, 320) * 0.44, 470);
  const cc = R / Math.sqrt(N + K), GA = Math.PI * (3 - Math.sqrt(5));
  items.forEach((it, n) => {
    const r = cc * Math.sqrt(n + K), a = n * GA;
    it.r = r; it.a = a; it.x = cx + r * Math.cos(a); it.y = cy + r * Math.sin(a) * 0.82;
    const el = document.createElement('i');
    el.className = 'g ' + it.kind;
    el.style.width = el.style.height = it.s + 'px';
    layer.append(el);
    it.el = el;
  });
  const counter = document.createElement('div');
  counter.className = 'intro-count';
  counter.style.left = cx + 'px';
  counter.style.top = cy + 'px';
  const num = document.createElement('span'); num.className = 'intro-num'; num.textContent = '0';
  const cap = document.createElement('span'); cap.className = 'intro-cap'; cap.textContent = '项记录';
  counter.append(num, cap);
  layer.append(counter);
  const tween = (from, to, start, dur) => {
    const t0 = performance.now() + start;
    const step = (now) => {
      if (ended) return;
      const p = clampNum((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - p, 3);
      num.textContent = String(Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // 第一幕：从中心旋开，按黄金角排成一朵花
  const T0 = 100, ST = Math.max(3, Math.min(8, Math.round(300 / N)));
  A(counter, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.9)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { duration: 420, delay: 60, easing: ease, fill: 'backwards' });
  items.forEach((it, n) => {
    const kf = [];
    for (let i = 0; i <= 12; i += 1) {
      const t = i / 12, rr = it.r * t, aa = it.a - (1 - t) * 1.9;
      const x = cx + rr * Math.cos(aa), y = cy + rr * Math.sin(aa) * 0.82;
      kf.push({ transform: 'translate3d(' + (x - it.s / 2) + 'px,' + (y - it.s / 2) + 'px,0) scale(' + (0.15 + 0.85 * t) + ')', opacity: Math.min(1, t / 0.18) });
    }
    A(it.el, kf, { duration: 720, delay: T0 + n * ST, easing: ease, fill: 'both' });
  });
  const wave = document.createElement('i');
  wave.className = 'wave';
  Object.assign(wave.style, { left: cx + 'px', top: cy + 'px', width: R * 2 + 'px', height: R * 1.64 + 'px' });
  layer.append(wave);
  A(wave, [{ transform: 'translate(-50%,-50%) scale(.12)', opacity: 0 }, { opacity: 0.9, offset: 0.25 }, { transform: 'translate(-50%,-50%) scale(1.25)', opacity: 0 }],
    { duration: 900, delay: T0 + N * ST + 260, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' });
  tween(0, N, T0, N * ST + 380);

  // 第二幕：各归其位
  const warm = items.filter((it) => it.kind === 'change');
  const TB = T0 + N * ST + 540;
  const lastHit = new Map();
  const hit = (el) => {
    const now = performance.now();
    if (now - (lastHit.get(el) || 0) < 70) return;
    lastHit.set(el, now);
    A(el, [{ transform: 'scale(1)' }, { transform: 'scale(1.16)' }, { transform: 'scale(1)' }], { duration: springMs('pop'), easing: 'ease-out' });
  };
  at(TB, () => { cap.textContent = '正在归位'; });
  tween(N, warm.length, TB, 820);
  let discIn = 0;
  items.forEach((it) => {
    if (it.kind === 'change') return;
    const dest = target?.(it) || {};
    const el = dest.el && dest.el.isConnected ? dest.el : null;
    const r = el ? el.getBoundingClientRect() : { left: cx, top: innerHeight + 40, width: 0, height: 0 };
    const land = Boolean(dest.land && el);
    const p1 = land ? [r.left + 18, r.top + r.height / 2] : [r.left + r.width / 2, r.top + r.height / 2];
    const p0 = [it.x, it.y], dx = p1[0] - p0[0], dy = p1[1] - p0[1], dist = Math.hypot(dx, dy);
    const side = rnd() > 0.5 ? 1 : -1;
    const c = [(p0[0] + p1[0]) / 2 - dy * 0.28 * side, (p0[1] + p1[1]) / 2 + dx * 0.28 * side];
    const dur = clampNum(480 + dist * 0.38, 560, 900), delay = TB + rnd() * 240;
    const pre = [p0[0] + (cx - p0[0]) * 0.07, p0[1] + (cy - p0[1]) * 0.07];
    const kf = [
      { transform: 'translate3d(' + (p0[0] - it.s / 2) + 'px,' + (p0[1] - it.s / 2) + 'px,0) scale(1)', opacity: 1, offset: 0 },
      { transform: 'translate3d(' + (pre[0] - it.s / 2) + 'px,' + (pre[1] - it.s / 2) + 'px,0) scale(.9)', opacity: 1, offset: 0.14 },
    ];
    for (let i = 1; i <= 12; i += 1) {
      const t = i / 12, u = 1 - t;
      const x = u * u * pre[0] + 2 * u * t * c[0] + t * t * p1[0], y = u * u * pre[1] + 2 * u * t * c[1] + t * t * p1[1];
      const sc = land ? 0.9 + t * 0.3 : 0.9 - t * 0.5;
      kf.push({ transform: 'translate3d(' + (x - it.s / 2) + 'px,' + (y - it.s / 2) + 'px,0) scale(' + sc + ')', opacity: land ? 1 : t > 0.9 ? 0 : 1, offset: 0.14 + 0.86 * t });
    }
    kf[kf.length - 1].opacity = 0;
    A(it.el, kf, { duration: dur, delay, easing: 'cubic-bezier(.5,0,.25,1)', fill: 'forwards' });
    at(delay + dur - 30, () => {
      if (land) show(el, [{ opacity: 0, clipPath: 'inset(0 100% 0 0 round 14px)' }, { opacity: 1, clipPath: 'inset(0 0 0 0 round 14px)' }], { duration: 460, easing: ease });
      else if (el) hit(el);
      if (it.kind === 'disc') { discIn += 1; onCount?.('disc', discIn); }
      dest.after?.();
    });
  });
  warm.forEach((it, j) => {
    it.gx = cx + (j - (warm.length - 1) / 2) * 30;
    it.gy = cy + 92;
    A(it.el, [{ transform: 'translate3d(' + (it.x - it.s / 2) + 'px,' + (it.y - it.s / 2) + 'px,0) scale(1)' },
      { transform: 'translate3d(' + (it.gx - it.s / 2) + 'px,' + (it.gy - it.s / 2) + 'px,0) scale(1.35)' }],
    { duration: 760, delay: TB + 60, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' });
  });

  // 第三幕：数字落进标题，暖色粒子长成卡片
  const TC = TB + 840;
  at(220, () => early.forEach((el) => show(el)));
  at(TC - 120, () => { cap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' }); });
  at(TC, () => {
    num.textContent = String(warm.length);
    const revealHero = () => {
      counter.style.opacity = '0';
      heroParts.forEach((el, i) => show(el, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: i * 70, easing: ease, fill: 'backwards' }));
    };
    const targetNum = heroNumber && heroNumber.isConnected ? heroNumber : null;
    if (targetNum) {
      const tr = targetNum.getBoundingClientRect(), nr = num.getBoundingClientRect();
      const s = tr.height / Math.max(nr.height, 1);
      const dx = tr.left + tr.width / 2 - (nr.left + nr.width / 2), dy = tr.top + tr.height / 2 - (nr.top + nr.height / 2);
      A(num, [{ transform: 'none', color: getComputedStyle(num).color }, { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + s + ')', color: warmColor }],
        { duration: springMs('slide'), easing: springEase('slide'), fill: 'forwards' });
      at(Math.round(springMs('slide') * 0.82), revealHero);
    } else {
      A(counter, [{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: 'forwards' });
      at(200, revealHero);
    }
    const shown = cards.slice(0, 3);
    if (!shown.length) { warm.forEach((it) => A(it.el, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' })); }
    warm.forEach((it, j) => {
      const card = shown[j];
      if (!card) { if (shown.length) A(it.el, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }); return; }
      const cr = card.getBoundingClientRect();
      const pos = j;
      const bloom = document.createElement('div');
      bloom.className = 'intro-bloom';
      Object.assign(bloom.style, { left: cr.left + 'px', top: cr.top + 'px', width: cr.width + 'px', height: cr.height + 'px', zIndex: String(1030 - pos) });
      body.append(bloom);
      const end = getComputedStyle(card).backgroundColor || '#ffffff';
      const radius = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 22;
      const gr = { left: it.gx - it.s * 0.7, top: it.gy - it.s * 0.7, right: it.gx + it.s * 0.7, bottom: it.gy + it.s * 0.7 };
      at(pos * 70, () => {
        A(it.el, [{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: 'forwards' });
        const a = A(bloom, [
          { clipPath: insetFrom(gr, cr, 4), background: warmColor },
          { background: warmColor, offset: 0.25 },
          { clipPath: 'inset(0px 0px 0px 0px round ' + radius + 'px)', background: end },
        ], { duration: springMs('slide') + 80, easing: springEase('slide'), fill: 'forwards' });
        if (pos === 0) a.finished.then(() => {
          if (ended) return;
          const deck = card.parentElement;
          deck?.removeAttribute('data-intro');
          document.querySelectorAll('.intro-bloom').forEach((node) => node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).finished.then(() => node.remove(), () => node.remove()));
          if (deck) A(deck, [{ transform: 'scale(1.012)' }, { transform: 'scale(1)' }], { duration: springMs('click'), easing: springEase('click') });
          onCount?.('warm', warm.length);
        }, () => {});
      });
    });
  });
  at(TC + springMs('slide') + 700, finish);
  return finish;
}

/* ---------- 声明式绑定（可选） ----------
 * [data-wb-toggle="#id"]       点击展开 / 收起该元素
 * [data-wb-open-layer="#id"]   点击打开弹窗或侧面板
 * [data-wb-close]              在弹窗内点击关闭它
 */
function initMotion(root = document) {
  root.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-wb-toggle]');
    if (toggle) {
      const target = document.querySelector(toggle.getAttribute('data-wb-toggle'));
      if (target) expand(target);
      return;
    }
    const open = event.target.closest('[data-wb-open-layer]');
    if (open) {
      const target = document.querySelector(open.getAttribute('data-wb-open-layer'));
      if (target) openLayer(target, open);
      return;
    }
    const close = event.target.closest('[data-wb-close]');
    if (close) {
      const dialog = close.closest('dialog');
      if (dialog) closeLayer(dialog);
    }
  });
}

export {
  swapView,
  expand,
  reveal,
  burst,
  bounce,
  cancelClose,
  trackSave,
  setSaveState,
  setStage,
  completeTask,
  openLayer,
  closeLayer,
  withLoading,
  toast,
  reorder,
  removeItem,
  initTabs,
  withSkeleton,
  initMotion,
  springEase,
  springMs,
  slidePlate,
  hoverPlate,
  rollNumber,
  popCount,
  growFrom,
  createDeck,
  playIntro,
};
