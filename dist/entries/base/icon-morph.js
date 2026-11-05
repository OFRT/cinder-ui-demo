/* cinder-js:icon-morph | 1 file(s) | 独立入口，需 window.Cinder 命名空间 */
/* icon-morph.js · 图标真插值 M2（可选增强层）
 * 不加载时 .cin-icon-stack 的 M1 交叉淡化与静态两态完全可用；本文件只负责"一个图标真的长成另一个"。
 * 纪律：单 rAF 全页共用、多实例共用一帧、打断从当前中间态续、reduce 下不注册、不跑时瞬时替换。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const NS = "http://www.w3.org/2000/svg";
  const reduce = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const pts = new Map(); // d → 采样点（同形状只算一次）
  const jobs = new Map();
  let probe = null;
  let raf = 0;

  const dur = () => {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cin-motion-base-duration"));
    return (isFinite(v) && v > 0 ? v : 200);
  };
  const host = () => {
    if (probe && probe.isConnected) return probe;
    probe = document.createElementNS(NS, "svg");
    probe.setAttribute("aria-hidden", "true");
    probe.setAttribute("style", "position:absolute;inline-size:0;block-size:0;overflow:hidden;pointer-events:none");
    document.body.appendChild(probe);
    return probe;
  };
  const sample = (d) => {
    if (!d) return null;
    if (pts.has(d)) return pts.get(d);
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    const box = host();
    box.appendChild(p);
    let out = null;
    try {
      const len = p.getTotalLength();
      if (len > 0) {
        const n = d.length > 900 ? 40 : 56;
        out = [];
        for (let i = 0; i <= n; i++) {
          const at = p.getPointAtLength((len * i) / n);
          out.push([at.x, at.y]);
        }
      }
    } catch (e) { out = null; }
    box.removeChild(p);
    pts.set(d, out);
    return out;
  };
  const dOf = (a, b) => {
    let s = "M" + a[0][0].toFixed(2) + "," + a[0][1].toFixed(2);
    for (let i = 1; i < a.length; i++) s += "L" + a[i][0].toFixed(2) + "," + a[i][1].toFixed(2);
    return s + (b ? "Z" : "");
  };
  const lerp = (a, b, t) => a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t]);
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  // 取一层图标的 path d：支持内联 <path> 与 <use href="#id">（sprite 需已内联在文档里）
  const pathIn = (icon) => {
    if (!icon) return null;
    const own = icon.tagName.toLowerCase() === "path" ? icon : icon.querySelector("path");
    if (own) return own;
    const use = icon.querySelector("use");
    if (!use) return null;
    const id = (use.getAttribute("href") || use.getAttribute("xlink:href") || "").replace(/^#/, "");
    const src = id && document.getElementById(id);
    return src ? src.querySelector("path") : null;
  };

  const flush = () => {
    raf = 0;
    const now = Date.now();
    for (const [stack, job] of jobs) {
      const t = Math.min(1, (now - job.t0) / job.dur);
      const cur = lerp(job.from, job.to, ease(t));
      job.cur = cur;
      // 采样点多的形状每帧重算 d 很贵：按帧号降频写入，省主线程
      if (!job.dense || job.frame++ % 3 === 0 || t === 1) job.path.setAttribute("d", dOf(cur));
      if (t >= 1) {
        jobs.delete(stack);
        job.path.setAttribute("d", job.baseD || job.toD);
        if (job.hidden) job.other.style.visibility = "";
        stack.dataset.morphAnim = "idle";
      }
    }
    if (jobs.size) raf = requestAnimationFrame(flush);
  };

  const morph = (stack, state) => {
    const a = pathIn(stack.querySelector('[data-state="on"]'));
    const b = pathIn(stack.querySelector('[data-state="off"]'));
    const target = state === "off" ? b : a;
    if (!a || !b || !target) return;
    const baseD = stack.__iconMorphBase || (stack.__iconMorphBase = a.getAttribute("d"));
    const from = sample(baseD);
    const to = sample(b.getAttribute("d"));
    const prev = jobs.get(stack);
    if (!from || !to || from.length !== to.length) {
      // 形状点数对不上：退回 M1 硬切，绝不写半截路径
      if (prev) { jobs.delete(stack); if (prev.hidden) prev.other.style.visibility = ""; }
      stack.dataset.morph = state;
      return;
    }
    const job = prev || { path: a, other: b, hidden: true };
    job.baseD = baseD;
    job.from = prev && prev.cur ? prev.cur : from;
    job.to = to;
    job.toD = target.getAttribute("d");
    job.dur = dur();
    job.t0 = Date.now();
    job.frame = 0;
    job.dense = to.length > 64;
    b.style.visibility = "hidden"; // 插值期间只留一条路径，避免双层叠色
    jobs.set(stack, job);
    stack.dataset.morphAnim = "run";
    if (!raf) raf = requestAnimationFrame(flush);
  };

  const initAll = (root) => {
    const list = (root || document).querySelectorAll(".cin-icon-stack[data-morph]");
    for (const stack of list) {
      if (stack.dataset.morphReady) continue;
      stack.dataset.morphReady = "1";
      if (reduce()) continue; // reduce：不注册，静态显示 data-morph 对应的那一层
      const set = (state) => morph(stack, state);
      const api = {
        set state(v) { stack.dataset.morph = v; set(v); },
        get state() { return stack.dataset.morph; },
        toggle() { this.state = this.state === "off" ? "on" : "off"; }
      };
      stack.__iconMorph = api;
      set(stack.dataset.morph);
    }
    return list.length;
  };

  C.iconMorph = { initAll, morph, _jobs: jobs };
})();
