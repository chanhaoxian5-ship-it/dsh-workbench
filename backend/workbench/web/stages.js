// 阶段线与里程碑：同一条日期轴上的两条轨，各自独立滚动。
// 阶段说的是“发生了什么”，里程碑说的是“在哪一刻冻结了一版”。
//
// 性能上的三条硬规矩：
// 1. 两条轨各自只是一个 translate3d —— 滚动过程中不碰布局、不碰绘制。
// 2. 连线层整体挂在左轨的位移上（合成层平移），所以连线不必每帧重算。
// 3. 只有两条轨之间的落差变了，才重写 path 的 d；落差没变就一个字节都不写。
// 这样正常滚动的每帧开销 = 2 次 transform 字符串写入。
//
// 并入 stage-version-v2 的改版：
// - 联动高亮：悬停/聚焦阶段或版本，只亮它自己的连线与名下卡片；
// - 连线按阶段着色：阶段版本实线带箭头，阶段内留档细虚线；
// - 每张版本卡带“所属阶段”标记，阶段版本是主卡、普通留档低一级；
// - 两条轨各有一条“今天”横线，“回到当前”把两轨带回当前阶段；
// - 点阶段名滚到该阶段第一个版本并展开；窄屏单列。
import { ICONS as KIT_ICONS } from './icons/kit-icons.js';

const NS = 'http://www.w3.org/2000/svg';
const DAY = 86400000;
const PX_PER_DAY = 9;    // 日期轴的密度：比例优先，挤到才让位
const STAGE_GAP = 84;
const CARD_GAP = 14;
// 顶部留白：滚到最上面时，第一个阶段点不能被画布边缘或渐隐压掉。
const PAD_TOP = 26;
// 底部留白：滚到底时，最后一段和最后一张卡要能整个读出来。
const PAD_BOTTOM = 28;
const LINK_STEM = 34;
const ANCHOR = 24;       // 连线落点相对卡片顶端的偏移
const FAN_PAD = 10;      // 连线层左右各留一点，免得端点在层边缘被裁

// 每个阶段一个色相：阶段点、连线、卡片底色共用同一个 tone，
// 阶段与版本的归属靠颜色也读得出来。六个色相配白字都够对比度。
// 聚光：阶段色只用于归属，取低饱和、互相可分的六色；避开暖橙（需要你）与靛蓝（Agent 交付）。白底与 8% 浅底上均 ≥5.3:1。
const STAGE_TONES = ['#4A6587', '#2F6B66', '#56662E', '#7A5B2E', '#7B4F6B', '#3F4A5A'];
let boardSeq = 0;

// 手感参数全部按「时间」算，不按帧数：120Hz 和 60Hz 的屏滑起来才是同一种滑动。
// 正在被推的那条轨几乎 1:1（这点时间只用来吃掉单格滚轮的硬跳），
// 被牵引的那条慢一些，落差越大追得越快。按钮跳转用一个更长的 τ，走成一段缓动。
const TAU_DRIVE = 0.016;
// 鼠标滚轮不是跟手拖动：一格滚轮给的是固定的大步长（通常 100px 上下），
// 用 TAU_DRIVE 会瞬间跳过去，看起来一格一格。滚轮单独用更长的 τ，连滚几格会叠成一段连续滑动。
const TAU_WHEEL = 0.085;
const TAU_FOLLOW = 0.075;
const TAU_PULL = 0.10;
const TAU_JUMP = 0.09;
// 松手后两轨归位的时间常数：比牵引慢，不抢拖动，又不至于一直歪着。
const TAU_ALIGN = 0.26;
const REST = 0.4;        // 小于这个距离直接吸附，不留看不见的尾巴
const DRAG_SLOP = 6;     // 指针走不到这个距离就还当点击，不抢卡的展开
// 展开/收起的补间：四条边一起动，用同一条曲线、同一个时长收尾。
const FLIP_MS = 240;
const FLIP_ID = 'board-flip';

// 松手后的惯性：只认最近 100ms 的速度，再按 160ms 的时长投影落点。
// 160 不是动画时长——速度越快落点越远，收尾仍然是同一条 τ 曲线。
const PROJECT_MS = 160;
const INERTIA_GAP = 100;
const INERTIA_MIN = 0.08;  // px/ms；比这更慢就当是停下来松手，不投影
// 软边界：最多越界 48px，越拉越沉（指数阻尼），松手弹回。
// 数值是“上限”不是“常量偏移”：拉得再狠也只多出去 48px。
const EDGE_MAX = 48;

const dayMs = (day) => Date.parse(day + 'T00:00:00+08:00');
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
// 每帧都 matchMedia 会新建一个 MediaQueryList；查一次，之后只读 matches。
let reduceQuery = null;
const reducedMotion = () => {
  if (reduceQuery === null) {
    try { reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { reduceQuery = false; }
  }
  return reduceQuery ? reduceQuery.matches : false;
};

// 展开状态挂在模块上：切 tab、断点重建都不会丢；再写进 localStorage，
// 刷新后还能回到上次看的那几张卡。展开是多选，可以同时开好几张。
const EXPANDED_KEY = 'workbench:milestone-expanded';
let expandedIds = null;

function resolveExpanded(ordered) {
  if (expandedIds) return expandedIds;
  let saved = null;
  try { saved = JSON.parse(window.localStorage.getItem(EXPANDED_KEY) || 'null'); } catch { saved = null; }
  if (Array.isArray(saved)) {
    const known = new Set(ordered.map((v) => v.id));
    expandedIds = new Set(saved.filter((id) => known.has(id)));
  } else {
    expandedIds = new Set(ordered.filter((v) => v.state === '进行中').map((v) => v.id));
  }
  return expandedIds;
}

function persistExpanded() {
  if (!expandedIds) return;
  try { window.localStorage.setItem(EXPANDED_KEY, JSON.stringify(Array.from(expandedIds))); } catch { /* 隐私模式写不进去就算了 */ }
}

// 先按日期比例落位，再保证相邻元素不重叠：挤到一起的就往下让。
function pack(items) {
  let bottom = null;
  const out = [];
  items.forEach((item, index) => {
    let y = item.raw;
    if (index > 0 && bottom !== null && y < bottom + item.gap) y = bottom + item.gap;
    out.push(y);
    bottom = y + item.h;
  });
  return out;
}

export function createStageBoard(ctx) {
  const { el, button, tag, stages, versions, files, onOpenDetail } = ctx;
  const ordered = versions.slice().sort((a, b) => a.day.localeCompare(b.day));
  const stageById = (id) => stages.find((s) => s.id === id) || null;
  const toneById = new Map(stages.map((s, index) => [s.id, STAGE_TONES[index % STAGE_TONES.length]]));
  // “今天”不再另外造一个数据源：进行中的那个版本，就是今天这一格。
  const todayVersion = versions.find((v) => v.state === '进行中');
  const TODAY = todayVersion ? todayVersion.day : (ordered.length ? ordered[ordered.length - 1].day : stages[0].day);
  // “此刻”和“数据里写的那一天”是两回事：过几天再看，这条线要落在真的今天上，
  // 而不是永远停在进行中那一版被冻结的日期。夹在首尾之间，不把未来推成过去。
  const daysBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / DAY);
  const uid = ++boardSeq;
  const t0 = Math.min.apply(null, stages.concat(ordered).map((item) => dayMs(item.day)));
  // 从最后一个已经发生的东西走到线的起点：日期比例决定落点，剩下的空档交给版式——
  // 卡片叠起来一多，底部会空出一大片，那正是给“回到当前”和后续留的白。
  function spacingOf(h) {
    const last = ordered.length ? ordered[ordered.length - 1].day : stages[stages.length - 1].day;
    const room = Math.max(0, (lastDayMs - t0) / DAY);
    if (!room) return PX_PER_DAY;
    return clamp((h - PAD_TOP - PAD_BOTTOM) / room, PX_PER_DAY, PX_PER_DAY * 2.4);
  }
  const lastDayMs = Math.max.apply(null, stages.concat(ordered).map((item) => dayMs(item.day)));
  let pxPerDay = PX_PER_DAY;
  const raw = (day) => PAD_TOP + ((dayMs(day) - t0) / DAY) * pxPerDay;
  const clockMs = Math.min(Math.max(Date.now(), t0), lastDayMs);

  const root = el('section', 'surface stage-board');
  const head = el('div', 'board-head');
  const title = el('h2');
  title.append(boardIcon('stage'), el('span', '', '阶段线与里程碑'));
  head.append(title);

  // 抬头右半边是一条"当前位置"读数：读到哪一段、今天是第几天、离起始多少天。
  // 它只回答一件事，所以只占一行；下面轨里的阶段卡和卡片重复写这些字，全部撤掉。
  const meta = el('div', 'board-meta');
  meta.setAttribute('aria-live', 'off');
  const metaNow = el('span', 'meta-now');
  const metaCount = el('span', 'meta-count');
  meta.append(metaNow, metaCount);
  head.append(meta);

  const nowBtn = el('button', 'board-jump');
  nowBtn.type = 'button';
  nowBtn.append(boardIcon('clock'), el('span', '', '回到当前'));
  nowBtn.addEventListener('click', goNow);
  head.append(nowBtn);
  const legend = el('div', 'board-legend');
  [['阶段点', 'legend-dot'], ['阶段版本（实线）', 'legend-link strong'], ['阶段内留档（虚线）', 'legend-link']].forEach((pair) => {
    const item = el('span', 'legend-item');
    item.append(el('i', pair[1]), el('span', '', pair[0]));
    legend.append(item);
  });
  head.append(legend);
  root.append(head);

  const viewport = el('div', 'board-viewport');
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'group');
  viewport.setAttribute('aria-label', '阶段线与里程碑，两条轨可以分别上下滚动');
  root.append(viewport);

  // a/b 是视觉位置，ta/tb 是目标位置；offset 已经被吸附到设备像素上。
  // va/vb 是松手那一刻两轨各自的速度（px/ms），只用来继续推一段惯性，归零后就完全停下。
  const view = { a: 0, b: 0, ta: 0, tb: 0, driver: 'a', max: 0, limit: 110, stamp: 0, slow: false, glide: false, touchedAt: 0, va: 0, vb: 0 };
  const geo = { vpH: 0, stageAx: 0, msBx: 0, vpLeft: 0, splitA: 0, splitB: 0, fanLeft: 0, fanWidth: 0, contentH: 0 };
  let dual = false;
  let dpr = 1;
  let innerA = null;
  let innerB = null;
  let fan = null;
  let svg = null;
  let nowA = null;
  let nowB = null;
  let stackedNow = null;
  let stageRows = [];
  let msRows = [];
  let links = [];
  let raf = 0;
  // 拖完那一下 pointerup 会跟一个 click；只在真的拖动了才拦，且只拦很短一段时间。
  let dragEndedAt = 0;
  let lastA = NaN;
  let lastB = NaN;
  let lastSkew = NaN;
  let placed = false;
  // 边界状态（顶住 / 越界）与它上一次被写进 DOM 的值，避免每帧碰 classList。
  let edgeState = '';
  let edgeHoldUntil = 0;
  let edgeTimer = 0;

  // 里程碑卡两种形态：折叠态只留标题行 + 一句摘要；展开态再放文件条与
  // 变更记录。默认只有正在进行的那个版本展开，之后跟随用户上次的选择。
  const expanded = resolveExpanded(ordered);

  const snap = (value) => Math.round(value * dpr) / dpr;

  // 图标仍走 app.js 的 icon()（ctx 带进来就用它）；没带时用同一份资产包兜底，
  // 不新增图标数据源，也不把任何外部文本拼进 innerHTML。
  function boardIcon(name) {
    if (typeof ctx.icon === 'function') return ctx.icon(name);
    const wrap = el('span', 'board-icon');
    const kit = KIT_ICONS[name];
    wrap.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (kit ? kit.body : '') + '</svg>';
    return wrap;
  }

  // 软边界：允许最多 EDGE_MAX 的越界，越界越沉。超过上限后 1px 的拖动只给约 0.02 的位移。
  function resist(over) {
    if (!over) return 0;
    return Math.sign(over) * EDGE_MAX * (1 - Math.exp(-Math.abs(over) / EDGE_MAX));
  }

  // 越界的目标位置：按住时留在界外，松手后按 TAU_JUMP 指数回到界内。
  // 复用已有的 τ 体系，不引入新的手感参数；reduced-motion 下直接归位。
  // 回弹走指数衰减：dt 越密衰减越少，不同帧率到手是同一种手感。
  // 按住时停在界外（橡皮筋被拉着），不做任何补间。
  function settleEdge(value, holding, ease, dt) {
    const bound = clamp(value, 0, view.max);
    if (bound === value) return value;
    // 按住时停在界外：这样即使 reduced-motion 不做弹性，边界状态类也读得出来。
    if (holding) return value;
    if (ease) return bound;                      // reduced-motion：直接落到界内
    return bound + (value - bound) * Math.exp(-dt / TAU_JUMP);
  }

  // 单条轨的越界量：负数 = 越过上边，正数 = 越过下边，0 = 在界内。
  // 视觉位置和目标位置都读：手还按着时目标会先出界，那一下也该亮起来。
  // 阈值留 1px 余量，好让「顶住」时那两像素的弹性位移也能被认出来。
  function over(v) {
    if (!view.max) return 0;
    const hi = Math.max(v, 0);
    if (hi > view.max + 1) return hi - view.max;
    if (v < -1) return v;
    return 0;
  }

  // 两轨都可能越界（拖动时常常只有被驱动的那条先出界），所以取最狠的一条：
  // 上边界看两轨里最负的，下边界看最正的。目标位置同样参与，反馈才跟手。
  function edgeOvers() {
    const pairs = [[view.a, view.ta], [view.b, view.tb]];
    let top = 0;
    let bottom = 0;
    for (let i = 0; i < pairs.length; i++) {
      const p = over(pairs[i][0]) || 0;
      const t = over(pairs[i][1]) || 0;
      const hi = Math.max(p, t);
      const lo = Math.min(p, t);
      if (hi > bottom) bottom = hi;
      if (lo < top) top = lo;
    }
    return { top: top, bottom: bottom };
  }

  // 「顶住了」是信息，reduced-motion 下也必须出现；只是不再做弹性位移。
  // 只写变化的那一刻：正常滚动时这里每帧都会被调，但一次 classList 都不会碰。
  function paintEdge() {
    if (!dual) { edgeState = ''; return; }
    const { top, bottom } = edgeOvers();
    let next = '';
    if (top < -0.5) next = 'edge-top';
    else if (bottom > 0.5) next = 'edge-bottom';
    // 滚轮刚顶住的那一小段时间里，位置其实还夹在边上（没有越界）；
    // 这段时间内别让每帧的复检把提示收掉，否则阴影会一闪一闪。
    if (!next && performance.now() < edgeHoldUntil) return;
    if (next === edgeState) return;
    if (edgeState) viewport.classList.remove(edgeState);
    edgeState = next;
    if (next) viewport.classList.add(next);
  }

  // 滚轮到边被吃掉时切一次状态类，160ms 后如果没有继续滚就收掉。
  // 连滚只把时间往后推，不重置 class：按住不放就一直是「顶住了」。
  function edgeHold(kind) {
    if (!dual) return;
    if (edgeState && edgeState !== kind) viewport.classList.remove(edgeState);
    viewport.classList.add(kind);
    edgeState = kind;
    edgeHoldUntil = performance.now() + 160;
    if (!edgeTimer) {
      edgeTimer = window.setTimeout(() => {
        edgeTimer = 0;
        edgeHoldUntil = 0;
        paintEdge();
      }, 176);
    }
  }

  // 联动高亮只改 class：变淡的是卡片内容，底色保持不透明，底下的线不会透出来。
  function setFocus(stageId) {
    for (let i = 0; i < stageRows.length; i++) {
      const row = stageRows[i];
      const on = !!stageId && row.stage.id === stageId;
      row.item.classList.toggle('dim', !!stageId && !on);
      row.item.classList.toggle('lit', on);
    }
    for (let i = 0; i < msRows.length; i++) {
      const row = msRows[i];
      const on = !!stageId && row.version.stageId === stageId;
      row.el.classList.toggle('dim', !!stageId && !on);
      row.el.classList.toggle('lit', on);
    }
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const on = !!stageId && link.stage === stageId;
      link.path.classList.toggle('dim', !!stageId && !on);
      link.path.classList.toggle('lit', on);
    }
  }

  function stateText(s) {
    return s.state === 'done' ? '已完成' : s.state === 'current' ? '进行中' : '预计';
  }

  // 抬头读数：现在是哪一段、这条线走到第几天。整块画布只在这里写一次“位置”，
  // 阶段卡和版本卡都不再重复日期，读者也就不必在三个地方核对同一个数。
  function updateMeta() {
    const first = stages[0];
    const current = stages.find((s) => s.state === 'current');
    // 倒计时也算真的今天：数据里那一版什么时候冻结的，不该决定“还剩几天”。
    const next = stages.find((s) => dayMs(s.day) > clockMs);
    const span = Math.max(1, Math.round((dayMs(stages[stages.length - 1].day) - dayMs(first.day)) / DAY));
    // 读数只写两件事：现在在那一段的名字、离下一个节点几天。
    // “进行中”不写在字面上——圆点的颜色就是状态，卡片上还有一枚专门的标记。
    const dot = el('i', 'meta-dot');
    metaNow.replaceChildren(dot, el('span', '', current ? current.title : '全部阶段已完成'));
    // 读数只回答两件事：现在在哪一段、离下一个节点还有几天。
    // 没有下一段时退回整条线的长度；两个数都从同一份数据算，不另存一份。
    // 天数单独包一层，等宽数字锁住位数，跳动时不推着左边的字移动。
    if (next) {
      const days = Math.max(0, Math.round((dayMs(next.day) - clockMs) / DAY));
      metaCount.replaceChildren(
        document.createTextNode('距' + next.title),
        el('b', '', String(days)),
        document.createTextNode('天'),
      );
    } else {
      metaCount.replaceChildren(document.createTextNode('全程'), el('b', '', String(span)), document.createTextNode('天'));
    }
    meta.classList.toggle('all-done', !current);
  }

  function changeList(v) {
    const box = el('div', 'change-list');
    box.append(el('p', 'change-caption', '相对上一版改了什么'));
    const changes = Array.isArray(v.changes) ? v.changes : [];
    if (!changes.length) {
      // 内容后期由 agent 填，这里先把槽位立起来。
      const empty = el('div', 'change-empty');
      empty.append(
        el('p', 'change-empty-title', '这一版还没有变更记录'),
        el('p', 'change-empty-hint', '每一处改动会按文件列在这里：改了什么、改在哪一节。'),
      );
      box.append(empty);
      return box;
    }
    changes.forEach((change) => {
      const group = el('div', 'change-group');
      if (change.file) group.append(el('p', 'change-file', change.file));
      group.append(el('p', 'change-title', change.title || ''));
      if (change.summary) group.append(el('p', 'change-summary', change.summary));
      if (change.note) {
        const note = el('p', 'change-note');
        note.append(el('span', 'change-note-label', '你的注释'), el('span', '', change.note));
        group.append(note);
      }
      box.append(group);
    });
    return box;
  }

  function milestoneCard(v) {
    const owner = stageById(v.stageId);
    const tone = toneById.get(v.stageId) || STAGE_TONES[0];
    const isOpen = expanded.has(v.id);
    const cls = 'version-card milestone'
      + (v.state === '进行中' ? ' current' : '')
      + (v.state === '预计' ? ' planned' : '')
      + (v.stageVersion ? ' stage-version' : '')
      + (isOpen ? ' expanded' : '');
    const item = el('div', cls);
    item.style.setProperty('--tone', tone);
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-expanded', String(isOpen));
    // 高度过渡要有个可数的起点；具体时长由 stages.css 的 transition 决定。
    item.style.setProperty('--open', isOpen ? '1' : '0');
    item.setAttribute('aria-label', v.number + ' ' + v.name + '，' + (owner ? owner.title + '阶段' : '未归入阶段') + (v.stageVersion ? '的正式版本' : '的阶段内留档') + '，' + v.state);

    const top = el('div', 'milestone-head');
    // 版本号是这张卡的脸：数字用等宽字形锁住宽度，整条线扫下来，量级自己会说话。
    const num = el('span', 'version-number');
    num.dataset.version = v.number;
    num.append(el('b', 'vn-prefix', 'v'), el('b', 'vn-body', v.number.replace(/^v/, '')));
    top.append(num, el('span', 'milestone-name', v.name));
    if (v.state === '进行中') top.append(tag('进行中', 'blue'));
    // 只标少数派：阶段版本是该阶段的常态（8 张里 6 张），给它挂一枚胶囊，
    // 等于把“正常”写成例外。真正需要一眼认出来的是段内留档。
    if (!v.stageVersion) top.append(el('span', 'chip flag', '段内留档'));
    // 日期退到第二行、贴着摘要：它是存档时间，不是用来扫的量。
    top.append(el('span', 'milestone-chevron'));
    const sub = el('div', 'milestone-sub');
    sub.append(el('span', 'version-date', v.date));
    if (v.files.length) sub.append(el('span', 'milestone-sub-sep', '·'), el('span', 'milestone-files', v.files.length + ' 个文件'));
    // 全部落实时这个数字信息量为零，只留未达成的进度。
    if (v.total && v.done < v.total) sub.append(el('span', 'milestone-sub-sep', '·'), el('span', 'milestone-done', v.done + '/' + v.total + ' 项已落实'));
    item.append(top, sub, el('p', 'version-summary milestone-summary', v.summary));

    // 展开体是「就地生长」：外层是一行 0fr→1fr 的网格，内层负责裁切，
    // 内容高度变了也不会把卡片撑得跳一下。内层再包一层是因为
    // grid-template-rows 只认直接子元素，而这里要同时管文件条和变更列表。
    const detail = el('div', 'milestone-detail');
    const detailBody = el('div', 'milestone-detail-body');
    if (v.files.length) {
      const strip = el('div', 'version-files');
      v.files.slice(0, 4).forEach((id) => {
        const found = files.find((file) => file.id === id);
        if (found) strip.append(el('span', 'version-file', found.name));
      });
      if (v.files.length > 4) strip.append(el('span', 'version-file more', '+' + (v.files.length - 4)));
      detailBody.append(strip);
    }
    detailBody.append(changeList(v));
    const openDetail = el('button', 'milestone-open', '查看完整版本 →');
    openDetail.type = 'button';
    openDetail.addEventListener('click', (event) => { event.stopPropagation(); onOpenDetail(v); });
    detailBody.append(openDetail);
    detail.append(detailBody);
    item.append(detail);

    // 展开/收起：卡片高度变了，整条轨要重排。
    // 这里不等下一帧再量：class 已经改完，先量旧位置（FLIP-before），
    // 同一次任务里立刻重排（会强制一次布局），再把反向位移补间掉，
    // 于是「展开」是一段连续的生长，而不是一次瞬移。
    // 连点两次也安全：每次 applyOpen 一进来就收掉上一轮的补间，不排队。
    const applyOpen = (open) => {
      if (dual) {
        flipPrepare();
        applyOpenNow(open);
        apply();
        layout();
        flipPlay();
      } else {
        applyOpenNow(open);
      }
      persistExpanded();
      item.setAttribute('aria-expanded', String(open));
      if (!dual) return;
      revealItem(item);
      // 画布本身可能就在页面下方，展开后把页面也带到能看见的位置。
      const rect = item.getBoundingClientRect();
      const vh = window.innerHeight || 800;
      if (rect.bottom > vh - 16) window.scrollBy({ top: rect.bottom - vh + 16, behavior: reducedMotion() ? 'auto' : 'smooth' });
      else if (rect.top < 16) window.scrollBy({ top: rect.top - 16, behavior: reducedMotion() ? 'auto' : 'smooth' });
    };
    const applyOpenNow = (open) => {
      if (open) expanded.add(v.id); else expanded.delete(v.id);
      item.classList.toggle('expanded', open);
      // 收起的卡里那几条链接不该还能被 Tab 到（视觉上已经压成 0 高）。
      const detail = item.querySelector('.milestone-detail');
      if (detail) {
        if (open) detail.removeAttribute('inert');
        else detail.setAttribute('inert', '');
      }
      item.style.setProperty('--open', open ? '1' : '0');
    };
    // 抽屉收起时，里面那些组件的焦点会被 inert 拿走；把焦点还给卡片本身，别掉到 body。
    const onInertFocusLoss = () => { if (!expanded.has(v.id)) item.focus({ preventScroll: true }); };
    const detailBox = item.querySelector('.milestone-detail');
    if (detailBox) detailBox.addEventListener('focusin', () => { if (!expanded.has(v.id)) onInertFocusLoss(); });
    if (!expanded.has(v.id) && detailBox) detailBox.setAttribute('inert', '');
    const toggle = () => {
      // 刚拖过轨的那一下 pointerup 会跟一个 click：只有真的拖动过才拦，且只拦 120ms。
      if (performance.now() - dragEndedAt < 120) return;
      applyOpen(!expanded.has(v.id));
    };
    item.addEventListener('click', toggle);
    item.addEventListener('keydown', (event) => {
      if (event.target === item && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggle(); }
    });
    item.addEventListener('pointerenter', () => setFocus(v.stageId));
    item.addEventListener('pointerleave', () => setFocus(null));
    item.addEventListener('focus', () => setFocus(v.stageId));
    item.addEventListener('blur', () => setFocus(null));
    item._expand = () => { if (!expanded.has(v.id)) applyOpen(true); };
    return item;
  }

  // ---------- 展开/收起的 FLIP ----------
  // 为什么不直接 import motion.js 的 reorder：那版按 list.children 的 dy 补间，
  // 一次只认一条轨。这里两条轨要同时动，而且轨内条目是用 top 定位、
  // 轨容器自己还有一个 translate —— 在条目上再叠一层 transform，
  // 合成顺序是「容器平移 + 条目位移」，两者相加就是新的落点，互不覆盖。
  // 反过来，如果按「改完再反向平移」的常见写法，读到的 b.top 里已经含了
  // 容器的位移，画布正滚着的时候会把已有位移重复算一遍 —— 整块板会抖一下。
  // 所以这里先固定「before → after」的容器位移，再让条目从旧位置滑过去。

  // 每一轮补间挂在自己身上，连点时先收掉上一轮，再从头量 —— 不排队。
  function cancelFlips() {
    [innerA, innerB].forEach((inner) => {
      if (!inner) return;
      for (const child of inner.children) {
        if (typeof child.getAnimations !== 'function') continue;
        for (const anim of child.getAnimations()) if (anim.id === FLIP_ID) anim.cancel();
      }
    });
  }

  function flipTargets() {
    const out = [];
    if (innerA) for (const child of innerA.children) out.push(child);
    if (innerB) for (const child of innerB.children) out.push(child);
    return out;
  }

  function flipPrepare() {
    if (reducedMotion()) return null;
    cancelFlips();
    const shop = { a: view.a, b: view.b };
    const rects = flipTargets().map((node) => [node, node.getBoundingClientRect()]);
    return { shop, rects };
  }

  function flipPlay(shot) {
    if (!shot || reducedMotion()) return;
    // 容器位移是同一帧改的，所以「容器多走了多少」等于 shot 与此刻的差；
    // 条目只要补上「自身在轨内新旧的差」，两段相加正好落回原处。
    const shiftA = view.a - shot.shop.a;
    const shiftB = view.b - shot.shop.b;
    const hits = [];
    for (const [node, before] of shot.rects) {
      if (!node.isConnected) continue;
      const shift = node.parentElement === innerA ? shiftA : node.parentElement === innerB ? shiftB : 0;
      const after = node.getBoundingClientRect();
      const dy = before.top - (after.top - shift);
      if (Math.abs(dy) < 1) continue;
      node.animate(
        [{ transform: 'translate3d(0,' + dy.toFixed(2) + 'px,0)' }, { transform: 'translate3d(0,0,0)' }],
        { duration: FLIP_MS, easing: 'cubic-bezier(.2,.7,.2,1)' },
      ).id = FLIP_ID;
      hits.push(node);
    }
    return hits;
  }

  // 展开后如果这张卡跑出视线，就把它拉回来；没跑出去则不动，避免页面乱跳。
  function revealItem(item) {
    if (!dual || !geo.vpH) return;
    const y = Number(item.dataset.y || 0);
    const h = item.offsetHeight;
    const margin = 16;
    let delta = 0;
    if (y - view.b < margin) delta = y - view.b - margin;
    else if (y + h - view.b > geo.vpH - margin) delta = Math.min(y + h - view.b - (geo.vpH - margin), Math.max(0, y - view.b - margin));
    if (!delta) return;
    view.tb = clampSoft(view.tb + delta);
    view.ta = clampSoft(view.ta + delta);
    view.driver = 'b';
    kick();
  }

  function scrollToNode(node, topRatio) {
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const room = Math.max(16, window.innerHeight * (topRatio || 0.45) - rect.height / 2);
    window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - room), behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  // 点阶段名：右轨滚到该阶段的第一个版本并展开。
  function jumpToStage(s) {
    if (performance.now() - dragEndedAt < 120) return;
    const first = msRows.find((row) => row.version.stageId === s.id);
    if (!first) return;
    first.el._expand();
    if (!dual) { scrollToNode(first.el, 0.35); return; }
    const y = Number(first.el.dataset.y || 0);
    view.driver = 'b';
    view.slow = true;
    view.tb = clamp(y - 40, 0, view.max);
    kick();
  }

  // “现在”落在哪一屏：把当前这一段放到画布上方三分之一处，再对齐到卡片边界。
  // 第一次画出来就停在这里，不是停在最上面——这条线回答的是“我走到哪了”，
  // 开局停在三个月前，得先拉一遍画布才看得见答案。
  // 首次打开和点“回到当前”走同一个函数：同一个动作，两个入口，落点必须一致。
  function nowTarget() {
    const current = stageRows.find((row) => row.stage.state === 'current') || stageRows[stageRows.length - 1];
    if (!current) return null;
    const y = Number(current.item.dataset.y || 0);
    // 落点对齐到卡片边界：顶边露出一半的卡，比“恰好居中”更像没对准。
    // 先按“当前段放到上方三分之一”取一个期望位置，再退回不越过它的那张卡顶边——
    // 于是当前段之上还能露出完整的一段或一版，读者一眼知道自己从哪来。
    const desired = clamp(y - geo.vpH * 0.26, 0, view.max);
    const above = msRows
      .map((row) => Number(row.el.dataset.y || 0))
      .filter((cardY) => cardY <= desired)
      .sort((p, q) => q - p)[0];
    return above !== undefined ? clamp(above - 8, 0, view.max) : desired;
  }

  function placeAtNow() {
    if (!dual || !geo.vpH) return false;
    const target = nowTarget();
    if (target === null) return false;
    view.a = view.b = view.ta = view.tb = target;
    view.driver = 'both';
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    lastA = NaN; lastB = NaN; lastSkew = NaN;
    apply();
    return true;
  }

  // 回到当前阶段：两轨同时回位，不把当前阶段顶到画布最上面。
  function goNow() {
    if (!dual) {
      const target = stackedNow || (stageRows.find((row) => row.stage.state === 'current') || {}).item;
      if (target) scrollToNode(target, 0.3);
      return;
    }
    const target = nowTarget();
    if (target === null) return;
    view.driver = 'both';
    view.slow = true;
    view.touchedAt = performance.now();
    view.ta = target;
    view.tb = target;
    kick();
  }

  function stageBlock(s) {
    const item = el('div', 'stage-item ' + s.state);
    item.style.setProperty('--tone', toneById.get(s.id) || STAGE_TONES[0]);
    const marker = el('span', 'stage-marker');
    marker.setAttribute('aria-hidden', 'true');
    if (s.state === 'done') marker.textContent = '✓';
    const rail = el('span', 'stage-rail');
    rail.setAttribute('aria-hidden', 'true');
    // 可聚焦、可触发的是抬头本身；整块区域仍可点，单列里版本卡嵌在内部，
    // 不会变成按钮套按钮。
    const label = el('div', 'stage-label');
    label.tabIndex = 0;
    label.setAttribute('role', 'button');
    label.setAttribute('aria-label', s.title + '，' + s.date + '，' + stateText(s) + '，定位到它的第一个版本');
    const title = el('h3', '', s.title);
    label.append(title, el('p', 'stage-note', s.lines.join(' · ')));
    item.append(marker, rail, label);
    item.addEventListener('pointerenter', () => setFocus(s.id));
    item.addEventListener('pointerleave', () => setFocus(null));
    label.addEventListener('focus', () => setFocus(s.id));
    label.addEventListener('blur', () => setFocus(null));
    item.addEventListener('click', (event) => {
      // 单列时版本卡嵌在阶段卡里，点卡片的展开不该顺手把页面带走。
      if (event.target instanceof Element && event.target.closest('.version-card')) return;
      jumpToStage(s);
    });
    label.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); jumpToStage(s); }
    });
    return { item, rail, title, stage: s };
  }

  // 键盘 Tab 到屏外的卡时，浏览器会直接给 .lane 一个原生 scrollTop，
  // 而两条轨的位置是我们自己用 transform 管的——原生滚动一出现，两轨立刻错位，
  // 连线端点、“今天”线全对不上，而且松手也回不来。
  // 处理方式：把这次原生滚动换算成组件自己的位移（两轨一起走），再把原生滚动清零。
  function absorbNativeScroll(laneEl) {
    laneEl.addEventListener('scroll', () => {
      if (!dual) return;
      const d = laneEl.scrollTop;
      if (!d) return;
      laneEl.scrollTop = 0;
      const step = clamp(d, 0, view.max - view.a);
      view.a = clamp(view.a + step, 0, view.max);
      view.b = clamp(view.b + step, 0, view.max);
      view.ta = view.a;
      view.tb = view.b;
      view.driver = 'both';
      view.touchedAt = performance.now();
      lastA = NaN; lastB = NaN; lastSkew = NaN;
      apply();
    }, { passive: true });
  }

  function buildDual() {
    const laneA = el('div', 'lane stage-lane');
    const laneB = el('div', 'lane milestone-lane');
    innerA = el('div', 'lane-inner');
    innerB = el('div', 'lane-inner');
    laneA.append(innerA);
    laneB.append(innerB);

    // 连线层：一个跟着左轨一起平移的合成层。连线的几何写在「左轨内容坐标」里，
    // 于是两条轨同步时它一动不动；只有落差变了才需要重写 path。
    fan = el('div', 'link-layer');
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'link-svg');
    svg.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS(NS, 'defs');
    // 箭头按阶段取色：同一阶段的主线与留档共用一支箭头，颜色即归属。
    stages.forEach((s) => {
      const marker = document.createElementNS(NS, 'marker');
      marker.setAttribute('id', 'stage-arrow-' + uid + '-' + s.id);
      marker.setAttribute('viewBox', '0 0 8 8');
      marker.setAttribute('refX', '7');
      marker.setAttribute('refY', '4');
      // 箭头按固定像素，不随线宽放大：高亮时不会盖到斜线上。
      marker.setAttribute('markerUnits', 'userSpaceOnUse');
      marker.setAttribute('markerWidth', '9');
      marker.setAttribute('markerHeight', '9');
      marker.setAttribute('orient', 'auto');
      const tip = document.createElementNS(NS, 'path');
      tip.setAttribute('d', 'M 0 0.8 L 7.4 4 L 0 7.2 z');
      tip.setAttribute('fill', toneById.get(s.id) || STAGE_TONES[0]);
      marker.append(tip);
      defs.append(marker);
    });
    svg.append(defs);
    fan.append(svg);
    // 连线层放在两条轨下面：线可以从阶段文字下方穿过去，文字始终压在线上。
    viewport.replaceChildren(fan, laneA, laneB);
    absorbNativeScroll(laneA);
    absorbNativeScroll(laneB);

    // 「今天」横线放在各自轨道里，跟着自己的轨道滚动；两轨错位时会短暂分开。
    nowA = el('div', 'now-line');
    nowA.append(el('span', '', '今天'));
    nowA.setAttribute('aria-hidden', 'true');
    nowB = el('div', 'now-line');
    nowB.append(el('span', '', '今天'));
    nowB.setAttribute('aria-hidden', 'true');
    innerA.append(nowA);
    innerB.append(nowB);

    stageRows = stages.map((s, i) => {
      const row = stageBlock(s);
      // “走到哪了”靠颜色也读得出：进行中那一段的 tone 提到抬头读数上，
      // 读数里的圆点因而与画布里的那一段同色，不必靠文字对齐去找。
      if (s.state === 'current') meta.style.setProperty('--tone-live', toneById.get(s.id) || STAGE_TONES[0]);
      if (s.state === 'current') root.dataset.stageIndex = String(i);
      innerA.append(row.item);
      return row;
    });
    msRows = ordered.map((v) => {
      const card = milestoneCard(v);
      innerB.append(card);
      return { el: card, version: v, anchor: ANCHOR };
    });
    links = [];
    stages.forEach((s) => {
      ordered.filter((v) => v.stageId === s.id).forEach((v) => {
        const path = document.createElementNS(NS, 'path');
        const cls = 'version-link' + (v.stageVersion ? ' strong' : '') + (v.state === '预计' ? ' planned' : '');
        path.setAttribute('class', cls);
        path.style.setProperty('--tone', toneById.get(s.id) || STAGE_TONES[0]);
        // 只有阶段版本带箭头：它是这一段正式交出的那一版；段内留档是同一条线上的工作副本。
        if (v.stageVersion) path.setAttribute('marker-end', 'url(#stage-arrow-' + uid + '-' + s.id + ')');
        svg.append(path);
        links.push({ path: path, stage: s.id, version: v.id, prefix: '', suffix: '' });
      });
    });
    setFocus(null);
  }

  function buildStacked() {
    const list = el('div', 'stacked-list');
    stackedNow = null;
    stageRows = [];
    msRows = [];
    links = [];
    stages.forEach((s) => {
      if (s.state === 'current') {
        stackedNow = el('div', 'stacked-now');
        stackedNow.append(el('span', '', '今天'));
        list.append(stackedNow);
      }
      const row = stageBlock(s);
      stageRows.push(row);
      const group = el('div', 'stacked-milestones');
      const owned = ordered.filter((v) => v.stageId === s.id);
      if (owned.length) {
        owned.forEach((v) => {
          const card = milestoneCard(v);
          msRows.push({ el: card, version: v });
          group.append(card);
        });
      } else group.append(el('p', 'version-empty', '此阶段尚无冻结版本'));
      row.item.append(group);
      list.append(row.item);
    });
    viewport.replaceChildren(list);
    setFocus(null);
  }

  function layout() {
    if (!dual || !innerA || !innerB || !fan) {
      view.a = view.b = view.ta = view.tb = 0;
      view.max = 0;
      return;
    }
    dpr = Math.max(1, Math.round((window.devicePixelRatio || 1) * 4) / 4);
    const vpH = viewport.clientHeight;
    // 线走不动的时候不再硬挤出空白：数据只有两三段时，把日期比例摊到画布里，
    // 免得整条时间线缩在顶上、下面一大片空。挤得下就回到基准密度。
    pxPerDay = spacingOf(vpH);
    root.dataset.ppd = pxPerDay.toFixed(2);
    // 高度先一口气读完，再统一写 top：读一次写一次会触发两次强制重排。
    const stageH = stageRows.map((row) => row.item.offsetHeight);
    const cardH = msRows.map((row) => row.el.offsetHeight);
    const msY = pack(ordered.map((v, i) => ({ raw: raw(v.day), h: cardH[i], gap: CARD_GAP })));
    // 阶段块跟着版本轨被挤下去的量一起下移：右轨挤出来的高度，左轨也占同样的位置，
    // 这样“今天”和阶段点在两条轨上指的是同一天。
    const shiftAt = (day) => {
      let k = ordered.findIndex((v) => dayMs(v.day) >= dayMs(day));
      if (k < 0) k = ordered.length - 1;
      return msY[k] - raw(ordered[k].day);
    };
    const stageY = pack(stages.map((s, i) => ({ raw: raw(s.day) + Math.max(0, shiftAt(s.day)), h: stageH[i], gap: STAGE_GAP })));

    // 用 top 而不是 transform 定位条目：整页截图时合成层会让卡片错位，
    // 而条目本身只在尺寸变化时移动，用布局定位反而更稳。
    stageY.forEach((y, i) => { stageRows[i].item.style.top = y + 'px'; stageRows[i].item.dataset.y = String(y); });
    msY.forEach((y, i) => { msRows[i].el.style.top = y + 'px'; msRows[i].el.dataset.y = String(y); });

    const railH = stageY.map((y, i) => (i === stageY.length - 1 ? 0 : Math.max(12, stageY[i + 1] - y - 22)));
    stageY.forEach((y, i) => {
      const rail = stageRows[i].rail;
      if (i === stageY.length - 1) { rail.style.display = 'none'; return; }
      rail.style.display = '';
      rail.style.height = railH[i] + 'px';
    });

    const stageBottom = stageY[stageY.length - 1] + stageH[stageH.length - 1];
    const msBottom = msY[msY.length - 1] + cardH[cardH.length - 1];
    // 底部留白：最后一张卡和最后一段也能滚到画框里，而不是永远贴着裁切边。
    const contentH = Math.max(stageBottom + PAD_BOTTOM, msBottom + PAD_BOTTOM, vpH);
    innerA.style.height = contentH + 'px';
    innerB.style.height = contentH + 'px';

    // 两轨的“今天”取同一个内容坐标（含版本卡挤压量），平时对齐。
    // 用真正的此刻，而不是数据里那一版被冻结的日期：数据不动，线照样往前走。
    const todayDay = new Date(clockMs).toISOString().slice(0, 10);
    const nowY = raw(todayDay) + Math.max(0, shiftAt(todayDay));
    if (nowA) nowA.style.top = nowY + 'px';
    if (nowB) nowB.style.top = nowY + 'px';

    const vpRect = viewport.getBoundingClientRect();
    const laneARect = innerA.parentElement.getBoundingClientRect();
    const laneBRect = innerB.parentElement.getBoundingClientRect();
    geo.vpH = vpH;
    geo.contentH = contentH;
    geo.vpLeft = vpRect.left;
    geo.msBx = Math.round(laneBRect.left - vpRect.left);
    // 连线从阶段点本身（圆点中心那条竖线）起笔，不是从文字栏右缘：
    // 29 = 阶段块右缩进 8 + 点位右缩进 10 + 点半径 11，改 CSS 时这两处必须一起改。
    geo.stageAx = Math.round(laneARect.right - vpRect.left - 29);
    // 指针落点判定用的两条分界线：左轨右缘、右轨左缘，中间那条缝归「两轨一起走」。
    geo.splitA = laneARect.right - vpRect.left;
    geo.splitB = laneBRect.left - vpRect.left;
    geo.fanLeft = geo.stageAx - FAN_PAD;
    geo.fanWidth = Math.max(32, geo.msBx - geo.stageAx + FAN_PAD * 2);
    view.max = Math.max(0, contentH - vpH);
    view.limit = clamp(Math.round((geo.msBx - geo.stageAx) * 0.45), 64, 168);

    // 连线层只覆盖两轨之间的扇区：既省掉整块重绘的面积，也让合成层小一半。
    fan.style.left = geo.fanLeft + 'px';
    fan.style.width = geo.fanWidth + 'px';
    fan.style.height = contentH + 'px';
    svg.setAttribute('viewBox', '0 0 ' + geo.fanWidth + ' ' + contentH);
    svg.setAttribute('width', geo.fanWidth);
    svg.setAttribute('height', contentH);

    // 每条连线的静态几何只在这里算一次：起笔的横向段、拐点、落点、收笔的横向段。
    const stageAt = new Map(stageRows.map((row, i) => [row.stage.id, i]));
    const cardAt = new Map(msRows.map((row) => [row.version.id, row]));
    const x1 = geo.stageAx - geo.fanLeft;
    const x2 = geo.msBx - geo.fanLeft;
    const turn = x1 + Math.min(LINK_STEM, Math.max(16, (x2 - x1) * 0.3));
    const landing = x2 - 13;
    links.forEach((link) => {
      const sIndex = stageAt.get(link.stage);
      const mRow = cardAt.get(link.version);
      if (sIndex === undefined || !mRow) return;
      // 起笔点落在阶段干线的哪一段，由这个里程碑自己的日期决定：
      // 同一阶段的几个里程碑因此从干线的不同高度伸出，而不是挤成一个点。
      const rowAt = stageRows[sIndex];
      const from = Number(rowAt.item.dataset.y || 0);
      const next = stageRows[sIndex + 1];
      // 起笔落在阶段点的圆心高度（块内 10 + 半径 11），不是文字第一行。
      let ty = from + 21;
      if (next) {
        const to = Number(next.item.dataset.y || 0);
        const span = dayMs(next.stage.day) - dayMs(rowAt.stage.day);
        const progress = span > 0 ? (dayMs(mRow.version.day) - dayMs(rowAt.stage.day)) / span : 0;
        ty = from + 21 + clamp(progress, 0.06, 0.94) * Math.max(0, to - from - 21);
      }
      link.ty = ty;
      link.cy = Number(mRow.el.dataset.y || 0) + mRow.anchor;
      link.prefix = 'M ' + x1 + ' ' + ty.toFixed(1) + ' H ' + turn + ' L ' + landing + ' ';
      link.suffix = ' H ' + x2;
    });

    lastA = NaN; lastB = NaN; lastSkew = NaN;
    view.ta = clamp(view.ta, 0, view.max);
    view.tb = clamp(view.tb, 0, view.max);
    view.a = clamp(view.a, 0, view.max);
    view.b = clamp(view.b, 0, view.max);
    apply();
    // 画布第一次量到真实高度时才落位：{ } 里量不到高度，等到挂进页面再算。
    if (!placed) placed = placeAtNow();
  }

  // 落差变了才重写 d：两条轨同步滚动时这里一次都不会被调用。
  function paintLinks(skew) {
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      if (!link.prefix) continue;
      link.path.setAttribute('d', link.prefix + (link.cy + skew).toFixed(1) + link.suffix);
    }
  }

  function apply() {
    if (!dual || !innerA || !innerB || !fan) return;
    const ease = reducedMotion();
    paintEdge();
    const qa = snap(ease ? clamp(view.a, 0, view.max) : visible(view.a));
    const qb = snap(ease ? clamp(view.b, 0, view.max) : visible(view.b));
    if (qa !== lastA) {
      innerA.style.transform = 'translate3d(0,' + (Math.round(-qa * dpr) / dpr) + 'px,0)';
      fan.style.transform = 'translate3d(0,' + (Math.round(-qa * dpr) / dpr) + 'px,0)';
      lastA = qa;
    }
    if (qb !== lastB) {
      innerB.style.transform = 'translate3d(0,' + (Math.round(-qb * dpr) / dpr) + 'px,0)';
      lastB = qb;
    }
    const skew = Math.round((qa - qb) * dpr) / dpr;
    if (skew !== lastSkew) {
      paintLinks(skew);
      lastSkew = skew;
    }
  }

  // 两条轨的牵引：左轨驱动时右轨按距离追回同一位置（不是闪回，落差越大追得越快）；
  // 右轨单独走时，连线斜过阈值才把左轨一起拽过来。
  function step(now) {
    raf = 0;
    if (!dual) return;
    const dt = clamp((now - view.stamp) / 1000, 0.0005, 0.05);
    view.stamp = now;
    const ease = reducedMotion();
    // 滚轮/拖拽跟手（τ 很小）；按钮跳转用更长的 τ 走成缓动；
    // 滚轮单独一档，把"一格一格"摊成一段平滑滑动。
    const kd = ease ? 1 : 1 - Math.exp(-dt / (view.slow ? TAU_JUMP : (view.glide ? TAU_WHEEL : TAU_DRIVE)));
    const kp = ease ? 1 : 1 - Math.exp(-dt / (view.glide ? TAU_WHEEL : TAU_PULL));
    // 惯性用「松手那一刻记下的速度」，按同一个 τ 衰减；不另起一套缓动。
    const ki = ease ? 1 : Math.exp(-dt / TAU_JUMP);
    // 正在被手指按住时允许停在界外；松手立刻开始弹回。
    const dragOn = viewport.classList.contains('dragging');

    if (view.driver === 'b') {
      view.b += (view.tb - view.b) * kd;
      let over = view.b - view.a;
      if (Math.abs(over) > view.limit) {
        view.a += (over - (over > 0 ? view.limit : -view.limit)) * kp;
        over = view.b - view.a;
      }
      // 手停下来 420ms 之后，剩下的落差也收干净：两轨停在同一条轴上。
      // 连线是按落差画出来的，停在一个偏着的状态上，线会一直斜着、第一段还可能被顶出画布。
      // 拖的时候放它偏（那是在挑版本），停下来就归位。
      if (now - view.touchedAt > 420 && Math.abs(over) > REST) {
        view.a += over * (ease ? 1 : 1 - Math.exp(-dt / TAU_ALIGN));
      }
      view.ta = view.a;
    } else if (view.driver === 'both') {
      view.a += (view.ta - view.a) * kd;
      view.b += (view.tb - view.b) * kd;
    } else {
      view.a += (view.ta - view.a) * kd;
      // 右轨直接追左轨：只保留一级滞后，不再串两级缓动。
      const gap = view.a - view.b;
      if (Math.abs(gap) > REST) {
        // 滚轮驱动时左轨的逆向牵引放慢 1.4 倍，两条轨一起顺滑，不出现"一条滑一条跳"。
        const tau = TAU_FOLLOW * (view.glide ? 1.4 : 1) * (Math.abs(gap) > 240 ? 0.55 : 1);
        view.b += gap * (ease ? 1 : 1 - Math.exp(-dt / tau));
      } else {
        view.b = view.a;
      }
      view.tb = view.b;
    }

    // 惯性：目标位置按 v * dt 继续推出去，速度自己按 τ 衰减。
    // 两轨同步时推同一个值，落差不会被惯性拉歪。
    if (view.va || view.vb) {
      const dvA = view.va * dt * 1000;
      const dvB = view.vb * dt * 1000;
      if (view.driver === 'both' || Math.abs(view.va - view.vb) < 0.02) {
        const dv = (dvA + dvB) / 2;
        view.ta += dv;
        view.tb += dv;
      } else if (view.driver === 'b') {
        view.tb += dvB;
      } else if (view.driver === 'a') {
        view.ta += dvA;
      }
      view.ta = clampSoft(view.ta);
      view.tb = clampSoft(view.tb);
      view.va *= ki;
      view.vb *= ki;
      if (Math.abs(view.va) < 0.004) view.va = 0;
      if (Math.abs(view.vb) < 0.004) view.vb = 0;
    }

    // 吸附：距离小到看不出来就收干净，免得留一条慢慢爬的尾巴。
    if (Math.abs(view.ta - view.a) < REST) view.a = view.ta;
    if (Math.abs(view.tb - view.b) < REST) view.b = view.tb;
    // 软边界：越界最多 EDGE_MAX。按住不放时让它停在界外（橡皮筋），
    // 手一松就按同一条 τ 指数弹回界内 —— 不新增参数，也不做弹簧振荡。
    view.ta = settleEdge(view.ta, dragOn, ease, dt);
    view.tb = settleEdge(view.tb, dragOn, ease, dt);
    // 吸附之后再把目标夹回「最多越界 EDGE_MAX」：顺序很关键，
    // 先夹会把 REST 吸附带来的那点位移抹掉，边界上就会原地抖。
    view.ta = clampSoft(view.ta);
    view.tb = clampSoft(view.tb);
    // 彻底停下来时把视觉位置也收进界内：REST 吸附可能留下 1~2px 的尾巴，
    // 留在界外会让边界状态永远亮着，看起来像卡住了。
    // 只有「手松开了、惯性也没了、两轨都落定」之后才收残余：
    // 橡皮筋拉着的时候不能收，否则边界状态刚亮就被抹掉。
    const quiet = !dragOn && !view.va && !view.vb
      && Math.abs(view.ta - view.a) <= REST && Math.abs(view.tb - view.b) <= REST;
    if (quiet) {
      view.a = view.ta = clamp(view.ta, 0, view.max);
      view.b = view.tb = clamp(view.tb, 0, view.max);
    }
    apply();

    // 归位也算“还在动”：不然松手后停在偏着的状态，谁也不会把它拉回来。
    const alignBusy = view.driver === 'b' && now - view.touchedAt > 420 && Math.abs(view.a - view.b) > 0.5;
    const { top: edgeTop, bottom: edgeBottom } = edgeOvers();
    const edgeBusy = edgeTop !== 0 || edgeBottom !== 0;
    const busy = Math.abs(view.ta - view.a) > 0.05 || Math.abs(view.tb - view.b) > 0.05 || Math.abs(view.a - view.b) > 0.05 || alignBusy || edgeBusy || !!view.va || !!view.vb;
    if (busy) kick();
  }

  function kick() {
    if (raf) return;
    if (!view.stamp) view.stamp = performance.now() - 16;
    raf = requestAnimationFrame(step);
  }

  function setDriver(next) {
    if (view.driver === next) return;
    if (next === 'a') view.ta = view.a;
    else if (next === 'b') view.tb = view.b;
    else { view.ta = view.a; view.tb = view.b; }
    view.driver = next;
  }

  // nudge = 这一次是「顶住了」的反馈：不停在边上，而是稍稍出一小段界，
  // 让一次 2px 的弹性位移和边界状态类都看得见，之后由 settleEdge 收回。
  function push(delta, driver, glide, nudge) {
    view.slow = false;
    view.glide = !!glide;
    view.touchedAt = performance.now();
    // 新的输入永远接管上一次的惯性：不排队、不叠加。
    view.va = 0; view.vb = 0;
    setDriver(driver);
    const next = (value) => {
      const moved = value + delta;
      if (!nudge) return clampSoft(moved);
      if (moved > view.max) return view.max + Math.abs(delta);
      if (moved < 0) return -Math.abs(delta);
      return clampSoft(moved);
    };
    if (driver === 'a') view.ta = next(view.ta);
    else if (driver === 'b') view.tb = next(view.tb);
    else { view.ta = next(view.ta); view.tb = next(view.tb); }
    kick();
  }

  function room(driver, dir) {
    if (driver === 'b') return dir > 0 ? view.max - view.tb : view.tb;
    if (driver === 'both') return dir > 0 ? Math.min(view.max - view.ta, view.max - view.tb) : Math.min(view.ta, view.tb);
    return dir > 0 ? view.max - view.ta : view.ta;
  }

  // 目标位置只夹到「界外一小段」为止：再推也只多出去，不会一路飞走。
  // 这里必须是幂等的——每帧都会调，一次 resist 叠一次就会被自己慢慢抹平。
  function clampSoft(value) {
    return clamp(value, -EDGE_MAX, view.max + EDGE_MAX);
  }

  // 真正画出去的位置：界外的部分过一次阻尼。存的是原始值，所以每帧重算都一样。
  function visible(pos) {
    if (pos < 0) return resist(pos);
    if (pos > view.max) return view.max + resist(pos - view.max);
    return pos;
  }

  function bind() {
    // 整个画布都接管滚轮：指针落在两轨之间（连线扇区）时两轨一起走，
    // 不再因为落点没压在某条轨上就把页面滚走。
    // 到边缘也不立刻把整页滚走：同一次手势（含触控板惯性）继续滚的部分先吃掉，
    // 停手超过 EDGE_DWELL 之后的新手势才交给页面。
    const WHEEL_GAP = 160, EDGE_DWELL = 400;
    let wheelAt = 0, wheelMode = '', wheelLane = '', lastEdge = 0;
    viewport.addEventListener('wheel', (event) => {
      if (!dual) return;
      // ctrl/⌘ + 滚轮是缩放（触控板捏合也走这里），必须原样交给浏览器。
      if (event.ctrlKey || event.metaKey) return;
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * geo.vpH : event.deltaY;
      if (!delta) return;
      const x = event.clientX - geo.vpLeft;
      const lane = x < geo.splitA ? 'a' : (x >= geo.splitB ? 'b' : 'both');
      const now = performance.now(), gap = now - wheelAt;
      wheelAt = now;
      // 手势间隔超过 WHEEL_GAP 或换了轨，算新手势。
      if (gap > WHEEL_GAP || lane !== wheelLane) { wheelMode = ''; wheelLane = lane; }
      if (room(lane, delta) >= 0.5) {
        wheelMode = 'drive'; lastEdge = now;
        event.preventDefault();
        push(delta, lane, true);
        return;
      }
      // 顶住了：同一套边界状态 + 一次 2px 的弹性位移，让「滚不动」变成「到头了」。
      edgeHold(delta > 0 ? 'edge-bottom' : 'edge-top');
      push(delta > 0 ? 2 : -2, lane, true, true);
      // 到了边缘：只要用户还在滚，就一直吃掉位移，别把整页带走；
      // 停手超过 EDGE_DWELL 之后重新开始的手势才放行给页面。
      // 注意 EDGE_DWELL 要从"最后一次滚到边上"算起——按最后一次真正滚动算的话，
      // 快速滚到底时 400ms 早就过去了，页面会立刻跟上，正是要避免的那种手感。
      if (wheelMode === 'pass') { lastEdge = now; return; }
      if (wheelMode === '') {
        if (now - lastEdge > EDGE_DWELL) { wheelMode = 'pass'; lastEdge = now; return; }
        wheelMode = 'hold';
      }
      lastEdge = now;
      event.preventDefault();
    }, { passive: false });

    // 整块画布都能拖：卡片上方、中间扇区都不再是死区。
    // 6px 阈值把「点一下展开」和「按住拖轨」分开，拖完那一下点击不算点击。
    viewport.addEventListener('pointerdown', (event) => {
      if (!dual || event.button !== 0) return;
      const x = event.clientX - geo.vpLeft;
      const driver = x < geo.splitA ? 'a' : (x >= geo.splitB ? 'b' : 'both');
      const startY = event.clientY;
      const baseA = view.ta;
      const baseB = view.tb;
      let active = false;
      let moved = false;
      // 最近 100ms 的位移：只留一个滑窗，算速度用（px/ms，正 = 把内容往上推）。
      const trail = [{ t: performance.now(), y: startY }];
      const velocityOf = (now, y) => {
        while (trail.length > 1 && now - trail[0].t > INERTIA_GAP) trail.shift();
        const first = trail[0];
        const dt = now - first.t;
        if (dt < 8) return 0;
        const v = (first.y - y) / dt;
        return Math.abs(v) < INERTIA_MIN ? 0 : v;
      };
      const place = (ev) => {
        const dy = startY - ev.clientY;
        if (!active) {
          if (Math.abs(dy) < DRAG_SLOP) return;
          active = true;
          view.slow = false;
          view.glide = false;
          viewport.classList.add('dragging');
          try { viewport.setPointerCapture(event.pointerId); } catch { /* 已释放 */ }
          setDriver(driver);
          // 开始拖的时候先停掉上一次的惯性，不能一边拖一边被推。
          view.va = 0; view.vb = 0;
        }
        moved = true;
        // 拖动期间挡掉浏览器的默认行为：不然往下拖到画布外，浏览器会顺手
        // 选中文字、或者把页面一起滚走，画布就跟着跑出视口了。
        if (ev.cancelable) ev.preventDefault();
        const now = performance.now();
        trail.push({ t: now, y: ev.clientY });
        while (trail.length > 2 && now - trail[0].t > INERTIA_GAP) trail.shift();
        view.touchedAt = now;
        // 拖拽本身就是软边界：拉过界越拉越沉，手一松就弹回。
        if (driver === 'b') view.tb = clampSoft(baseB + dy);
        else if (driver === 'a') view.ta = clampSoft(baseA + dy);
        else { view.ta = clampSoft(baseA + dy); view.tb = clampSoft(baseB + dy); }
        kick();
      };
      const detach = (ev) => {
        viewport.removeEventListener('pointermove', place);
        viewport.removeEventListener('pointerup', detach);
        viewport.removeEventListener('pointercancel', detach);
        if (!active) return;
        viewport.classList.remove('dragging');
        dragEndedAt = performance.now();
        // 速度 × 160ms 的投影：落点再往手指方向多走一段，之后同一条 τ 收尾。
        // reduced-motion 下不做惯性，直接落到夹住后的位置。
        if (moved && ev && ev.type === 'pointerup' && !reducedMotion()) {
          const v = velocityOf(performance.now(), ev.clientY);
          if (v) {
            if (driver === 'b' || driver === 'both') view.vb = v;
            if (driver === 'a' || driver === 'both') view.va = v;
            if (driver === 'b') { view.ta = view.a; }
            else if (driver === 'a') { view.tb = view.b; }
            view.touchedAt = performance.now();
          }
        }
        view.ta = clampSoft(view.ta);
        view.tb = clampSoft(view.tb);
        kick();
      };
      viewport.addEventListener('pointermove', place);
      viewport.addEventListener('pointerup', detach);
      viewport.addEventListener('pointercancel', detach);
    });

    viewport.addEventListener('keydown', (event) => {
      if (!dual || event.target !== viewport) return;
      const small = 64;
      if (event.key === 'ArrowDown' || event.key === 'PageDown') { event.preventDefault(); push(event.key === 'PageDown' ? 320 : small, 'a'); }
      else if (event.key === 'ArrowUp' || event.key === 'PageUp') { event.preventDefault(); push(event.key === 'PageUp' ? -320 : -small, 'a'); }
    });

    const observer = new ResizeObserver(() => layout());
    observer.observe(root);

    // 断点在单列和双轨之间切换时要重建树，只改样式会把两条轨的位移留在原地。
    // 700px 以下内容宽度已经放不下两条轨，改成一列。
    const narrow = window.matchMedia('(max-width: 700px)');
    const onBreakpoint = () => mount();
    if (narrow.addEventListener) narrow.addEventListener('change', onBreakpoint);
    else if (narrow.addListener) narrow.addListener(onBreakpoint);
  }

  function mount() {
    const stacked = window.matchMedia('(max-width: 700px)').matches;
    root.classList.toggle('stacked', stacked);
    dual = !stacked;
    stageRows = [];
    msRows = [];
    links = [];
    svg = null;
    fan = null;
    nowA = null;
    nowB = null;
    stackedNow = null;
    innerA = null;
    innerB = null;
    view.a = view.b = view.ta = view.tb = 0;
    view.driver = 'a';
    view.slow = false;
    // 单列里没有可滚动的双轨，viewport 不再是一个键盘停靠点。
    viewport.tabIndex = stacked ? -1 : 0;
    viewport.classList.toggle('stacked', stacked);
    viewport.setAttribute('aria-label', stacked ? '阶段线与里程碑，按阶段列出各版本' : '阶段线与里程碑，两条轨可以分别上下滚动');
    // 重建时把“已经落位”改回 false：断点切换会换掉整棵树，
    // 从窄屏张开到双轨时若沿用旧标记，新版画布就停在最上面。
    placed = false;
    if (stacked) buildStacked(); else buildDual();
    layout();
  }

  bind();
  mount();
  updateMeta();
  requestAnimationFrame(() => layout());
  return root;
}
