/* ---- primitives/durable.js ---- */
/* durable 原语 · 本地持久化（带版本迁移、配额降级、内存兜底）
   const d = P.durable.open("cinder.prefs", 1, (old, from) => old || {});
   d.get() / d.set(patch) / d.clear()。隐私模式或无配额时自动退化为内存。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const P = (C.Primitives = C.Primitives || {});
  const memory = new Map();
  let ok = true;
  try {
    const k = "__cin_probe__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
  } catch (e) { ok = false; }

  const store = {
    read: (k) => (ok ? localStorage.getItem(k) : memory.get(k) ?? null),
    write: (k, v) => {
      try { if (ok) localStorage.setItem(k, v); else memory.set(k, v); return true; }
      catch (e) { memory.set(k, v); ok = false; return false; }
    },
    remove: (k) => { memory.delete(k); try { if (ok) localStorage.removeItem(k); } catch (e) {} },
  };

  function open(key, version = 1, migrate) {
    const raw = store.read(key);
    let state = {};
    let downgraded = false;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.v === version) state = parsed.data || {};
        else {
          downgraded = true;
          const old = parsed && parsed.data ? parsed.data : {};
          state = typeof migrate === "function" ? migrate(old, parsed && parsed.v) || {} : old;
        }
      } catch (e) { state = {}; downgraded = true; }
    }
    const flush = () => store.write(key, JSON.stringify({ v: version, data: state }));
    return {
      get: () => ({ ...state }),
      set(patch) {
        state = { ...state, ...(patch || {}) };
        const saved = flush();
        if (!saved) ok = false;
        return state;
      },
      clear() { state = {}; store.remove(key); },
      get persistent() { return ok; },
      get migrated() { return downgraded; },
    };
  }

  P.durable = { open, get persistent() { return ok; } };
})();


/* ---- primitives/focus.js ---- */
/* focus 原语 · 焦点管理（roving tabindex + 归还栈）
   P.focus.roving(container, { selector, orientation }) → cleanup
   P.focus.remember() 记下当前元素，P.focus.restore() 还回去（还不到则退到 body）。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const P = (C.Primitives = C.Primitives || {});
  const stack = [];

  function roving(container, opts) {
    const o = Object.assign({ selector: "[role=tab],[role=menuitem],[role=option]", orientation: "horizontal", loop: true }, opts || {});
    const items = () => Array.from(container.querySelectorAll(o.selector)).filter((n) => !n.disabled);
    const focusAt = (i) => {
      const list = items();
      if (!list.length) return;
      let idx = i;
      if (o.loop) idx = (i + list.length) % list.length;
      idx = Math.max(0, Math.min(list.length - 1, idx));
      list.forEach((n, k) => n.setAttribute("tabindex", k === idx ? "0" : "-1"));
      list[idx].focus();
    };
    const onKey = (e) => {
      const list = items();
      const cur = list.indexOf(document.activeElement);
      const next = o.orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
      const prev = o.orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
      if (e.key === next) { e.preventDefault(); focusAt(cur + 1); }
      else if (e.key === prev) { e.preventDefault(); focusAt(cur - 1); }
      else if (e.key === "Home") { e.preventDefault(); focusAt(0); }
      else if (e.key === "End") { e.preventDefault(); focusAt(list.length - 1); }
    };
    container.addEventListener("keydown", onKey);
    const list = items();
    if (list.length && !list.some((n) => n.getAttribute("tabindex") === "0")) list[0].setAttribute("tabindex", "0");
    return () => container.removeEventListener("keydown", onKey);
  }

  const remember = () => { stack.push(document.activeElement); return stack.length; };
  const restore = () => {
    const el = stack.pop();
    if (el && el.focus && document.contains(el)) { el.focus(); return true; }
    return false;
  };

  P.focus = { roving, remember, restore, get depth() { return stack.length; } };
})();


/* ---- primitives/gate.js ---- */
/* gate 原语 · 围栏（焦点陷阱 + 滚动锁 + Esc 归还）
   P.gate.open(el, { onClose }) → 释放函数。栈式：嵌套打开按后进先出归还焦点。
   隐藏用 [inert]/aria-hidden，不用 display:none，保证过渡可播。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const P = (C.Primitives = C.Primitives || {});
  const SEL = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const stack = [];

  function open(el, opts) {
    const o = opts || {};
    const opener = document.activeElement;
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    el.removeAttribute("inert");
    el.setAttribute("data-cin-gate", "open");

    const items = () => Array.from(el.querySelectorAll(SEL)).filter((n) => n.offsetParent !== null);
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      const list = items();
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    let closed = false;
    function close(reason) {
      if (closed) return;
      closed = true;
      el.removeEventListener("keydown", onKey);
      el.setAttribute("data-cin-gate", "closed");
      el.setAttribute("inert", "");
      document.documentElement.style.overflow = prevOverflow;
      const i = stack.indexOf(close);
      if (i >= 0) stack.splice(i, 1);
      if (!stack.length && el.hasAttribute("inert")) el.removeAttribute("inert");
      if (opener && opener.focus) opener.focus();
      el.dispatchEvent(new CustomEvent("cin:gate-close", { bubbles: true, detail: { reason: reason || "manual" } }));
      if (typeof o.onClose === "function") o.onClose(reason || "manual");
    }

    el.addEventListener("keydown", onKey);
    stack.push(close);
    const first = items()[0] || el;
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    first.focus();
    return close;
  }

  P.gate = { open, get depth() { return stack.length; }, closeTop: () => stack[stack.length - 1] && stack[stack.length - 1]("stack") };
})();


/* ---- primitives/gesture.js ---- */
/* gesture 原语 · 手势（只在触摸/笔生效，桌面降级为回调式按钮）
   P.gesture.attach(el, { axis:"y"|"x", threshold:64, onSwipe, onPull, onMove })
   reduced-motion 不放宽阈值；指针离开即中止，不粘手。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const P = (C.Primitives = C.Primitives || {});

  function attach(el, opts) {
    const o = Object.assign({ axis: "y", threshold: 64 }, opts || {});
    let id = null, start = 0, startAt = 0, active = false;

    const coord = (e) => (o.axis === "x" ? e.clientX : e.clientY);
    const down = (e) => {
      if (e.pointerType === "mouse") return;
      id = e.pointerId; start = coord(e); startAt = Date.now(); active = true;
      el.setAttribute("data-cin-gesture", "tracking");
    };
    const move = (e) => {
      if (!active || e.pointerId !== id) return;
      const delta = coord(e) - start;
      if (Math.abs(delta) < 8) return;
      if (o.axis === "y" && delta > 0) el.setAttribute("data-cin-pull", String(Math.min(delta, o.threshold * 2)));
      if (typeof o.onMove === "function") o.onMove(delta, e);
    };
    const up = (e) => {
      if (!active || e.pointerId !== id) return;
      active = false; id = null;
      const delta = coord(e) - start;
      const dt = Date.now() - startAt || 1;
      const velocity = Math.abs(delta) / dt;
      el.removeAttribute("data-cin-pull");
      el.setAttribute("data-cin-gesture", "done");
      if (Math.abs(delta) < o.threshold && velocity < 0.5) {
        el.dispatchEvent(new CustomEvent("cin:gesture-cancel", { bubbles: true, detail: { delta } }));
        return;
      }
      const dir = delta < 0 ? (o.axis === "x" ? "left" : "up") : (o.axis === "x" ? "right" : "down");
      el.dispatchEvent(new CustomEvent("cin:gesture", { bubbles: true, detail: { dir, delta, velocity } }));
      if (o.axis === "y" && dir === "down" && typeof o.onPull === "function") o.onPull(delta, e);
      if (typeof o.onSwipe === "function") o.onSwipe(dir, delta, e);
    };

    el.addEventListener("pointerdown", down, { passive: true });
    el.addEventListener("pointermove", move, { passive: true });
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }

  P.gesture = { attach };
})();


/* ---- primitives/i18n.js ---- */
/* i18n 原语 · 文案字典 + 运行时切换
   零依赖：内置 zh-CN / en 两套字典，register() 可扩展任意语言，缺 key 回落 zh-CN，再缺回落调用处的中文兜底。
   用法：
     P.i18n.t("datepicker.today")                         // 当前语言取词
     P.i18n.t("otp.digit", null, { n: 3 })                // 带 {name} 插值
     P.i18n.tIn("en", "copy.done")                        // 按显式 locale 取词（组件接了 locale 参数时用）
     P.i18n.setLocale("en")                               // 切换语言：写 <html lang>、刷新 data-i18n、派发 cin:localechange
   静态 HTML 也能直接挂：<button data-i18n-aria="copy.done">、<span data-i18n="tree.noMatch">
   语言判定顺序：setLocale 显式指定 > <html lang> > navigator.language > zh-CN。
   组件未加载本文件时各自使用内置中文兜底，行为与接入前一致（惰性取值，core 晚加载也能生效）。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const P = (C.Primitives = C.Primitives || {});
  const DEFAULT = "zh-CN";

  const DICTS = {
    "zh-CN": {
      "carousel.roledescription": "轮播",
      "carousel.slide": "幻灯片",
      "carousel.label": "图片轮播",
      "carousel.prev": "上一张",
      "carousel.next": "下一张",
      "carousel.dot": "第 {n} 页",
      "cascader.label": "选择层级",
      "cascader.level": "第 {n} 级",
      "cascader.empty": "无可选项",
      "colorpicker.swatch": "预设色",
      "copy.done": "已复制",
      "copy.error": "复制失败",
      "datepicker.dialog": "选择日期",
      "datepicker.prev": "上个月",
      "datepicker.next": "下个月",
      "datepicker.month": "月份",
      "datepicker.year": "年份",
      "datepicker.today": "今天",
      "datepicker.clear": "清除",
      "datepicker.pickStart": "选起始日",
      "datepicker.pickEnd": "再选结束日",
      "diffview.enableWrap": "换行开",
      "diffview.disableWrap": "换行关",
      "fileinput.remove": "移除 {name}",
      "fileinput.rejectType": "不支持的类型",
      "fileinput.rejectSize": "超过 {n} MB",
      "fileinput.rejectCount": "最多 {n} 个文件",
      "fileinput.rejectOne": "“{name}”{reason}",
      "fileinput.rejectMany": "{count} 个文件未通过校验：“{name}”{reason}",
      "format.justNow": "刚刚",
      "format.ago": "{value} 前",
      "format.later": "{value} 后",
      "otp.digit": "第 {n} 位验证码",
      "overlay.close": "关闭提示",
      "overlay.tourPrev": "上一步",
      "overlay.tourNext": "下一步",
      "overlay.tourDone": "完成",
      "overlay.tourSkip": "跳过引导",
      "overlay.tourStep": "第 {n} / {total} 步",
      "overlay.tourAria": "第 {n} 步，共 {total} 步：{title}",
      "overlay.tourLabel": "功能引导",
      "promptbar.removeRef": "移除来源 {name}",
      "pullrefresh.pull": "下拉刷新",
      "pullrefresh.release": "松开刷新",
      "pwstrength.level0": "太短",
      "pwstrength.level1": "弱",
      "pwstrength.level2": "一般",
      "pwstrength.level3": "较强",
      "pwstrength.level4": "很强",
      "pwstrength.note": "强度：{level}",
      "qrcode.overflow": "内容过长，无法生成",
      "selactions.label": "选中文本操作",
      "selactions.close": "关闭",
      "selactions.failed": "操作未完成，请重试",
      "sidenav.expand": "展开导航",
      "sidenav.collapse": "收起导航",
      "splitpanel.label": "调整分栏宽度",
      "tags.remove": "移除",
      "timepicker.label": "选择时间",
      "timepicker.hour": "小时",
      "timepicker.minute": "分钟",
      "timepicker.now": "现在",
      "timepicker.clear": "清除",
      "transfer.allMoved": "全部已移入",
      "transfer.noneSelected": "尚未选择",
      "tree.noMatch": "没有匹配的节点",
      "virtualgrid.selectRow": "选择第 {n} 行",
      "stream.done": "生成完毕",
      "undo.done": "已执行",
      "undo.undo": "撤销",
      "status.unknown": "未知状态 {state}",
    },
    en: {
      "carousel.roledescription": "carousel",
      "carousel.slide": "slide",
      "carousel.label": "Image carousel",
      "carousel.prev": "Previous slide",
      "carousel.next": "Next slide",
      "carousel.dot": "Slide {n}",
      "cascader.label": "Choose level",
      "cascader.level": "Level {n}",
      "cascader.empty": "No options",
      "colorpicker.swatch": "Preset color",
      "copy.done": "Copied",
      "copy.error": "Copy failed",
      "datepicker.dialog": "Choose date",
      "datepicker.prev": "Previous month",
      "datepicker.next": "Next month",
      "datepicker.month": "Month",
      "datepicker.year": "Year",
      "datepicker.today": "Today",
      "datepicker.clear": "Clear",
      "datepicker.pickStart": "Pick start date",
      "datepicker.pickEnd": "Pick end date",
      "diffview.enableWrap": "Turn wrapping on",
      "diffview.disableWrap": "Turn wrapping off",
      "fileinput.remove": "Remove {name}",
      "fileinput.rejectType": "Unsupported file type",
      "fileinput.rejectSize": "Exceeds {n} MB",
      "fileinput.rejectCount": "At most {n} files",
      "fileinput.rejectOne": "\"{name}\": {reason}",
      "fileinput.rejectMany": "{count} files failed validation. \"{name}\": {reason}",
      "format.justNow": "just now",
      "format.ago": "{value} ago",
      "format.later": "in {value}",
      "otp.digit": "Digit {n}",
      "overlay.close": "Close",
      "overlay.tourPrev": "Previous",
      "overlay.tourNext": "Next",
      "overlay.tourDone": "Done",
      "overlay.tourSkip": "Skip",
      "overlay.tourStep": "Step {n} of {total}",
      "overlay.tourAria": "Step {n} of {total}: {title}",
      "overlay.tourLabel": "Product tour",
      "promptbar.removeRef": "Remove source {name}",
      "pullrefresh.pull": "Pull to refresh",
      "pullrefresh.release": "Release to refresh",
      "pwstrength.level0": "Too short",
      "pwstrength.level1": "Weak",
      "pwstrength.level2": "Fair",
      "pwstrength.level3": "Strong",
      "pwstrength.level4": "Very strong",
      "pwstrength.note": "Strength: {level}",
      "qrcode.overflow": "Content too long to encode",
      "selactions.label": "Selection actions",
      "selactions.close": "Close",
      "selactions.failed": "Action did not finish. Try again.",
      "sidenav.expand": "Expand navigation",
      "sidenav.collapse": "Collapse navigation",
      "splitpanel.label": "Resize panes",
      "tags.remove": "Remove",
      "timepicker.label": "Choose time",
      "timepicker.hour": "Hours",
      "timepicker.minute": "Minutes",
      "timepicker.now": "Now",
      "timepicker.clear": "Clear",
      "transfer.allMoved": "All moved",
      "transfer.noneSelected": "Nothing selected",
      "tree.noMatch": "No matching nodes",
      "virtualgrid.selectRow": "Select row {n}",
      "stream.done": "Generation complete",
      "undo.done": "Done",
      "undo.undo": "Undo",
      "status.unknown": "Unknown state {state}",
    },
  };

  let current = null;

  /* 归一化：精确命中 > 同语言前缀命中 > 默认。未注册的语言一律回落，避免 t() 返回 key。 */
  function normalize(tag) {
    if (!tag) return null;
    const raw = String(tag);
    if (DICTS[raw]) return raw;
    const low = raw.toLowerCase();
    const hit = Object.keys(DICTS).find(
      (k) => k.toLowerCase() === low || k.toLowerCase().split("-")[0] === low.split("-")[0]
    );
    return hit || null;
  }

  const getLocale = () => {
    if (current) return current;
    current = normalize(document.documentElement.lang) || normalize(navigator.language) || DEFAULT;
    return current;
  };

  const interpolate = (s, vars) =>
    s.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));

  function lookup(locale, key, fallback) {
    const dict = DICTS[locale];
    if (dict && dict[key] != null) return dict[key];
    const base = DICTS[DEFAULT];
    if (base && base[key] != null) return base[key];
    return fallback == null ? key : fallback;
  }

  function tIn(locale, key, fallback, vars) {
    return interpolate(lookup(normalize(locale) || DEFAULT, key, fallback), vars);
  }

  const t = (key, fallback, vars) => tIn(getLocale(), key, fallback, vars);

  /* 静态标记刷新：data-i18n 写文本，data-i18n-aria 写 aria-label */
  function apply(scope) {
    const root = scope || document;
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"), el.textContent);
    });
    root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria"), el.getAttribute("aria-label")));
    });
    return root;
  }

  function setLocale(tag, opt = {}) {
    const next = normalize(tag) || DEFAULT;
    const prev = getLocale();
    current = next;
    if (opt.lang !== false) {
      try {
        document.documentElement.lang = next;
      } catch {
        /* 无 DOM 环境忽略 */
      }
    }
    if (prev !== next) {
      if (opt.apply !== false) apply(document);
      document.dispatchEvent(
        new CustomEvent("cin:localechange", { detail: { from: prev, to: next } })
      );
    }
    return next;
  }

  const onLocaleChange = (fn) => {
    const h = (e) => fn(e.detail.to, e.detail.from);
    document.addEventListener("cin:localechange", h);
    return () => document.removeEventListener("cin:localechange", h);
  };

  /* 扩展语言：register("ja", {...})；已存在的语言做合并覆盖。 */
  function register(tag, dict) {
    if (!tag || !dict) return Object.keys(DICTS);
    DICTS[tag] = Object.assign({}, DICTS[tag] || {}, dict);
    return Object.keys(DICTS);
  }

  P.i18n = {
    DEFAULT,
    DICTS,
    locales: () => Object.keys(DICTS),
    getLocale,
    setLocale,
    t,
    tIn,
    apply,
    register,
    onLocaleChange,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => apply(document), { once: true });
  } else if (document.querySelector("[data-i18n]")) {
    apply(document);
  }
})();


/* ---- primitives/icons.js ---- */
/* icons 原语 · sprite 注入 + 声明式图标占位填充
   声明式：<i data-cin-icon="check" data-size="sm"></i>，mount() 后自动填成 <svg class="cin-icon"><use href="#cin-i-check"/></svg>
   为什么需要它：外部 <use href="cinder-icons.svg#id"> 在 file:// 与跨域下会被浏览器拦，
   所以把 sprite 拉进文档内联，此后同文档 #cin-i-* 一律可用。无 JS 时用 .cin-i-* 背景类或宿主自行内联 sprite。
   降级顺序：JS 注入 sprite → 宿主内联 sprite → dist/cinder-icons.css 背景类 → 文字/aria-label */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const P = (C.Primitives = C.Primitives || {});
  const NS = "http://www.w3.org/2000/svg";
  const HOST_ID = "cin-icon-sprite";

  let ready = false;
  let pending = null;
  let observer = null;

  const has = (name) => ready && !!document.getElementById(`cin-i-${name}`);

  function build(name, size) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "cin-icon");
    if (size) svg.setAttribute("data-size", size);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const use = document.createElementNS(NS, "use");
    use.setAttribute("href", `#cin-i-${name}`);
    svg.appendChild(use);
    return svg;
  }

  /* 把已存在的 [data-cin-icon] 占位填成真图标；缺图标名时保留占位并标记，不抛错 */
  function hydrate(root = document) {
    if (!ready) return 0;
    const nodes = (root.querySelectorAll ? root.querySelectorAll("[data-cin-icon]") : []);
    let n = 0;
    for (const el of nodes) {
      if (el.hasAttribute("data-cin-icon-ready")) continue;
      const name = el.getAttribute("data-cin-icon");
      if (!has(name)) {
        el.setAttribute("data-cin-icon-missing", name);
        continue;
      }
      if (el.getAttribute("aria-label") || el.getAttribute("role")) {
        // 承载语义的图标：保留可读名，不 aria-hidden
        const svg = build(name, el.getAttribute("data-size"));
        svg.removeAttribute("aria-hidden");
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", el.getAttribute("aria-label") || name);
        el.replaceChildren(svg);
      } else {
        el.replaceChildren(build(name, el.getAttribute("data-size")));
      }
      el.setAttribute("data-cin-icon-ready", "");
      n++;
    }
    return n;
  }

  function watch() {
    if (observer || typeof MutationObserver === "undefined") return;
    observer = new MutationObserver((records) => {
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches && node.matches("[data-cin-icon]")) hydrate(node.parentNode || document);
          else if (node.querySelector && node.querySelector("[data-cin-icon]")) hydrate(node);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  /* 注入 sprite。src 默认与 dist/ 同级；已注入则直接返回 true。失败只告警，不阻断页面 */
  function mount(src = "cinder-icons.svg") {
    if (ready) return Promise.resolve(true);
    if (pending) return pending;
    if (typeof fetch !== "function") {
      console.warn("icons: 环境无 fetch，改用 .cin-i-* 背景类或宿主内联 sprite");
      return Promise.resolve(false);
    }
    pending = fetch(src, { credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        const box = document.createElement("div");
        box.id = HOST_ID;
        box.hidden = true;
        box.setAttribute("aria-hidden", "true");
        box.innerHTML = text;
        document.body.appendChild(box);
        ready = true;
        hydrate(document);
        watch();
        document.dispatchEvent(new CustomEvent("cin:icons", { detail: { ready: true } }));
        return true;
      })
      .catch((err) => {
        console.warn(`icons: sprite 注入失败（${src}）：${err.message}；回退到 .cin-i-* 背景类或文字`);
        document.dispatchEvent(new CustomEvent("cin:icons", { detail: { ready: false, error: err.message } }));
        return false;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  /* 宿主已自行内联 sprite（无 JS 场景）时，跳过 fetch 直接接管 */
  function adopt() {
    if (document.getElementById(HOST_ID) || document.getElementById("cin-i-check")) {
      ready = true;
      hydrate(document);
      watch();
      return true;
    }
    return false;
  }

  P.icons = { mount, hydrate, adopt, has, build, get ready() { return ready; } };
  C.icons = P.icons;
})();


/* ---- primitives/optimism.js ---- */
/* optimism 原语 · 乐观更新 + 失败回滚
   用法：P.optimism.run({ apply, commit, rollback, timeout })
   apply/rollback 同步执行（改 DOM/本地状态），commit 返回 Promise；
   commit 失败或超时即回滚并外抛 cin:rollback。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const P = (C.Primitives = C.Primitives || {});
  const DEFAULTS = { timeout: 8000 };

  function run(opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    if (typeof o.apply !== "function" || typeof o.commit !== "function") {
      return Promise.reject(new Error("optimism: 需要 apply 与 commit"));
    }
    const rollback = typeof o.rollback === "function" ? o.rollback : () => {};
    let settled = false;
    o.apply();
    const guard = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("optimism: commit 超时")), o.timeout);
    });
    return Promise.race([Promise.resolve(o.commit()), guard]).then(
      (v) => { settled = true; return v; },
      (err) => {
        if (settled) throw err;
        settled = true;
        rollback();
        if (o.target && o.target.dispatchEvent) {
          o.target.dispatchEvent(new CustomEvent("cin:rollback", { bubbles: true, detail: { error: err } }));
        }
        throw err;
      }
    );
  }

  function queue(limit = 32) {
    const pending = new Set();
    const push = (task) => {
      if (pending.size >= limit) pending.delete(pending.values().next().value);
      const p = Promise.resolve().then(task);
      pending.add(p);
      p.catch(() => {}).finally(() => pending.delete(p));
      return p;
    };
    return { push, get size() { return pending.size; }, drain: () => Promise.allSettled([...pending]) };
  }

  P.optimism = { run, queue };
})();


/* ---- primitives/presence.js ---- */
/* presence 原语 · 进出场时机（先出，动画结束再真移除）
   P.presence.enter(el, cls="is-entering") / exit(el, cls="is-leaving", done)
   只监听 transitionend，不监听 animationend 的无限循环；降级：无过渡直接回调。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const P = (C.Primitives = C.Primitives || {});

  const once = (el, fn) => {
    let done = false;
    const run = () => { if (!done) { done = true; clearTimeout(t); el.removeEventListener("transitionend", onEnd); fn(); } };
    const onEnd = (e) => { if (e.target === el) run(); };
    el.addEventListener("transitionend", onEnd);
    const t = setTimeout(run, 600);
    return run;
  };

  /* 每个元素的待执行帧句柄：exit/重复 enter 时先取消，避免脱离文档后仍在跑 */
  const frames = new WeakMap();
  const stopFrame = (el) => {
    const id = frames.get(el);
    if (id) { cancelAnimationFrame(id); frames.delete(el); }
  };

  function enter(el, cls) {
    const c = cls || "is-entering";
    stopFrame(el);
    el.hidden = false;
    el.classList.add(c);
    const a = requestAnimationFrame(() => {
      const b = requestAnimationFrame(() => { frames.delete(el); el.classList.remove(c); });
      frames.set(el, b);
    });
    frames.set(el, a);
    el.dispatchEvent(new CustomEvent("cin:enter", { bubbles: true }));
  }

  function exit(el, cls, done) {
    const c = cls || "is-leaving";
    const finish = () => {
      stopFrame(el);
      el.classList.remove("is-entering");
      el.classList.remove(c);
      el.hidden = true;
      el.dispatchEvent(new CustomEvent("cin:exit", { bubbles: true }));
      if (typeof done === "function") done();
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return; }
    el.classList.add(c);
    once(el, finish);
  }

  P.presence = { enter, exit };
})();


/* ---- primitives/skin.js ---- */
/* primitives/skin.js · 皮肤切换统一入口（T43：View Transitions 渐进增强） */
(function (window, document) {
  "use strict";
  var C = window.Cinder = window.Cinder || {};
  var P = C.Primitives = C.Primitives || {};
  if (P.skin) { return; }

  var LIST = ["paper", "porcelain", "mist", "sage", "ledger", "industrial", "graphite", "ink"];
  var busy = false;

  function reduce() {
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (e) { return false; }
  }

  // data-transition：缺省 auto（沿用历史行为）、"theme" 显式开启、"none" 直接切（T43）
  function animMode() {
    var v = (document.documentElement.getAttribute("data-transition") || "").split(/\s+/);
    if (v.indexOf("theme") >= 0) { return "on"; }
    if (v.indexOf("none") >= 0 || v.indexOf("off") >= 0) { return "off"; }
    return "auto";
  }

  function canTransition() {
    if (animMode() === "off") { return false; }
    return typeof document.startViewTransition === "function" && !reduce();
  }

  function apply(id) {
    var root = document.documentElement;
    var prev = root.getAttribute("data-skin") || "";
    var next = id ? String(id) : "";
    if (next) { root.setAttribute("data-skin", next); } else { root.removeAttribute("data-skin"); }
    document.dispatchEvent(new CustomEvent("cin:skin", { detail: { skin: next, prev: prev, animated: false, transition: animMode() } }));
    return next;
  }

  function set(id, opts) {
    opts = opts || {};
    var commit = typeof opts.commit === "function" ? opts.commit : function () { apply(id); };
    if (opts.transition === false || !canTransition() || busy) { commit(); return false; }
    busy = true;
    var vt;
    try {
      vt = document.startViewTransition(function () { commit(); });
    } catch (e) {
      busy = false; commit(); return false;
    }
    var done = function () { busy = false; };
    if (vt && vt.finished && typeof vt.finished.then === "function") { vt.finished.then(done, done); }
    else { done(); }
    return true;
  }

  function current() {
    return document.documentElement.getAttribute("data-skin") || "";
  }

  P.skin = {
    LIST: LIST.slice(),
    current: current,
    apply: apply,
    set: set,
    clear: function (opts) { return set("", opts); },
    isSupported: canTransition
  };
})(window, document);


/* ---- primitives/status.js ---- */
/* status 原语 · 五态机（idle/busy/stale/empty/error/offline）
   声明式：<div data-cin-status="busy">，CSS 用 [data-cin-status] 出形态。
   只做三件事：写属性、配 aria（busy/live）、外抛 cin:status。不碰样式。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const P = (C.Primitives = C.Primitives || {});
  const tr = (k, f, v) => (P.i18n ? P.i18n.t(k, f, v) : f);
  const STATES = ["idle", "busy", "stale", "empty", "error", "offline"];
  const LIVE = { error: "assertive", offline: "assertive", busy: "polite", empty: "polite", stale: "polite" };

  function set(el, next) {
    if (!STATES.includes(next)) throw new Error(`status: ${tr("status.unknown", "未知状态 {state}", { state: next })}`);
    const prev = el.getAttribute("data-cin-status") || "idle";
    if (prev === next) return prev;
    el.setAttribute("data-cin-status", next);
    if (next === "busy") el.setAttribute("aria-busy", "true");
    else el.removeAttribute("aria-busy");
    const live = LIVE[next];
    if (live) {
      el.setAttribute("aria-live", live);
      if (!el.hasAttribute("role")) el.setAttribute("role", "status");
    } else {
      el.removeAttribute("aria-live");
      if (el.getAttribute("role") === "status") el.removeAttribute("role");
    }
    el.dispatchEvent(new CustomEvent("cin:status", { bubbles: true, detail: { from: prev, to: next } }));
    return next;
  }
  const get = (el) => el.getAttribute("data-cin-status") || "idle";
  const wrap = (el, fn) => {
    set(el, "busy");
    return Promise.resolve()
      .then(fn)
      .then((v) => { set(el, "idle"); return v; })
      .catch((e) => { set(el, "error"); throw e; });
  };
  const mount = (scope = document) => {
    scope.querySelectorAll("[data-cin-status]").forEach((el) => set(el, get(el)));
    return scope;
  };

  P.status = { STATES, set, get, wrap, mount };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => mount());
  else mount();
})();


/* ---- primitives/stream.js ---- */
/* stream 原语 · 流式文本
   把「分片到达」变成「不跳版 + 不念屏」：文本用 textContent 追加，
   播报走节流块（默认 800ms 一次，且只念已完成句子），支持中断。
   用法：const s = P.stream.attach(el); s.push("片段"); s.end(); s.abort(); */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const P = (C.Primitives = C.Primitives || {});
  const tr = (k, f, v) => (P.i18n ? P.i18n.t(k, f, v) : f);

  function attach(el, opts) {
    const o = Object.assign({ live: true, announceMs: 800, chunkChars: 240 }, opts || {});
    el.setAttribute("data-cin-stream", "on");
    el.setAttribute("aria-busy", "true");
    const sink = document.createElement("span");
    sink.className = "cin-sr-only";
    sink.setAttribute("aria-live", "polite");
    el.appendChild(sink);

    let buf = "", spoken = 0, timer = 0, aborted = false;
    const flush = () => {
      timer = 0;
      if (!o.live || aborted) return;
      const rest = buf.slice(spoken);
      const cut = Math.max(rest.lastIndexOf("。"), rest.lastIndexOf("\n"), rest.lastIndexOf("！"), rest.lastIndexOf("?"), rest.lastIndexOf("？"));
      if (cut < 0 && rest.length < o.chunkChars) return;
      const take = cut >= 0 ? rest.slice(0, cut + 1) : rest.slice(0, o.chunkChars);
      spoken += take.length;
      sink.textContent = take.slice(-160);
    };
    return {
      push(chunk) {
        if (aborted) return buf;
        buf += String(chunk);
        el.textContent = buf;
        el.appendChild(sink);
        if (!timer) timer = setTimeout(flush, o.announceMs);
        return buf;
      },
      end() {
        el.setAttribute("aria-busy", "false");
        el.setAttribute("data-cin-stream", "done");
        clearTimeout(timer);
        sink.textContent = tr("stream.done", "生成完毕");
        el.dispatchEvent(new CustomEvent("cin:stream-end", { bubbles: true, detail: { text: buf } }));
        return buf;
      },
      abort() {
        aborted = true;
        clearTimeout(timer);
        el.setAttribute("aria-busy", "false");
        el.setAttribute("data-cin-stream", "aborted");
        el.dispatchEvent(new CustomEvent("cin:stream-abort", { bubbles: true }));
      },
      get text() { return buf; },
    };
  }

  P.stream = { attach };
})();


/* ---- primitives/tempo.js ---- */
/* tempo 原语 · 节奏（防抖 / 节流 / 帧批处理）
   P.tempo.debounce(fn, ms) · P.tempo.throttle(fn, ms) · P.tempo.batch(fn)
   全部返回带 cancel/flush 的函数；flush 保证卸载时不留挂起写入。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const P = (C.Primitives = C.Primitives || {});

  function debounce(fn, ms = 200) {
    let t = 0, last;
    const d = (...a) => { last = a; clearTimeout(t); t = setTimeout(() => { t = 0; fn(...last); }, ms); };
    d.cancel = () => clearTimeout(t);
    d.flush = () => { if (t) { clearTimeout(t); t = 0; fn(...last); } };
    d.pending = () => !!t;
    return d;
  }

  function throttle(fn, ms = 120) {
    let t = 0, last = 0, tail;
    const run = (a) => { last = Date.now(); t = 0; fn(...a); };
    const th = (...a) => {
      const now = Date.now();
      const wait = ms - (now - last);
      if (wait <= 0) return run(a);
      tail = a;
      if (!t) t = setTimeout(() => { t = 0; if (tail) run(tail); }, wait);
    };
    th.cancel = () => { clearTimeout(t); t = 0; tail = null; };
    return th;
  }

  function batch(fn) {
    let q = [], raf = 0;
    const b = (item) => {
      q.push(item);
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; const list = q; q = []; fn(list); });
    };
    b.flush = () => { if (raf) cancelAnimationFrame(raf); raf = 0; const list = q; q = []; if (list.length) fn(list); };
    return b;
  }

  P.tempo = { debounce, throttle, batch };
})();


/* ---- primitives/undo.js ---- */
/* undo 原语 · 撤销窗口（默认 5s）
   P.undo.offer({ label, onUndo, ms }) → { commit(), revoke(), el }
   语义：窗口内 role=status 播报；撤销按钮可聚焦且是唯一交互点；超时自动 commit。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const P = (C.Primitives = C.Primitives || {});
  const tr = (k, f, v) => (P.i18n ? P.i18n.t(k, f, v) : f);
  const HOST_ID = "cin-undo-host";
  const host = () => {
    let h = document.getElementById(HOST_ID);
    if (!h) {
      h = document.createElement("div");
      h.id = HOST_ID;
      h.className = "cin-undo-host";
      h.setAttribute("role", "status");
      h.setAttribute("aria-live", "polite");
      document.body.appendChild(h);
    }
    return h;
  };

  function offer(o) {
    const ms = Number(o && o.ms) || 5000;
    const label = (o && o.label) || tr("undo.done", "已执行");
    const el = document.createElement("div");
    el.className = "cin-undo-bar";
    el.innerHTML = '<span class="cin-undo-text"></span><button type="button" class="cin-undo-btn">${tr("undo.undo", "撤销")}</button>';
    el.querySelector(".cin-undo-text").textContent = label;
    host().appendChild(el);

    let done = false;
    const finish = (mode) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.dataset.cinUndo = mode;
      el.dispatchEvent(new CustomEvent("cin:undo-" + mode, { bubbles: true }));
      el.remove();
    };
    const revoke = () => {
      if (done) return;
      try { o && typeof o.onUndo === "function" && o.onUndo(); } finally { finish("revoked"); }
    };
    const commit = () => finish("committed");
    el.querySelector(".cin-undo-btn").addEventListener("click", revoke);
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") commit(); });
    const timer = setTimeout(commit, ms);
    return { el, commit, revoke, get done() { return done; } };
  }

  P.undo = { offer };
})();


/* ---- carousel.js ---- */
/* ---- carousel.js ---- 轮播：滚动、吸附、惯性全部交给浏览器原生 scroll-snap，脚本只补按钮、指示点、键盘与自动播放 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;
  const SELECTOR = "[data-carousel]";
  const emit = (el, type, detail = {}) => el && el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  const reduced = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  let seq = 0;

  const init = (node) => {
    if (!node) return null;
    const root = node.closest ? node.closest(SELECTOR) || (node.hasAttribute && node.hasAttribute("data-carousel") ? node : null) : null;
    if (!root) return null;
    if (root.__cinCarousel) return root.__cinCarousel;
    const viewport = root.querySelector(".cin-carousel-viewport");
    const track = root.querySelector(".cin-carousel-track");
    if (!viewport || !track) return null;
    const slides = Array.from(track.children).filter((n) => n.nodeType === 1 && n.classList.contains("cin-carousel-slide"));
    if (!slides.length) return null;

    const count = slides.length;
    const loop = root.hasAttribute("data-loop");
    const delay = Math.max(0, Number(root.getAttribute("data-autoplay")) || 0);
    const dotsBox = root.querySelector(".cin-carousel-dots");
    const counter = root.querySelector(".cin-carousel-counter");
    const prevBtn = root.querySelector("[data-carousel-prev]");
    const nextBtn = root.querySelector("[data-carousel-next]");
    const state = { index: 0, pages: count, timer: 0, paused: false };

    if (!viewport.id) viewport.id = `cin-carousel-view-${++seq}`;
    const id = viewport.id;

    /* ---------- 结构与 ARIA ---------- */

    root.setAttribute("data-carousel-ready", "");
    if (!root.getAttribute("role")) root.setAttribute("role", "region");
    if (!root.getAttribute("aria-roledescription")) root.setAttribute("aria-roledescription", tr("carousel.roledescription", "轮播"));
    if (!root.getAttribute("aria-label") && !root.getAttribute("aria-labelledby")) root.setAttribute("aria-label", tr("carousel.label", "图片轮播"));
    viewport.setAttribute("aria-live", delay ? "off" : "polite");
    if (!viewport.hasAttribute("tabindex")) viewport.setAttribute("tabindex", "0");
    if (!track.getAttribute("role")) track.setAttribute("role", "group");

    slides.forEach((slide, i) => {
      if (!slide.getAttribute("role")) slide.setAttribute("role", "group");
      slide.setAttribute("aria-roledescription", tr("carousel.slide", "幻灯片"));
      if (!slide.getAttribute("aria-label")) slide.setAttribute("aria-label", `${i + 1} / ${count}`);
    });

    [prevBtn, nextBtn].forEach((btn) => {
      if (!btn) return;
      btn.setAttribute("aria-controls", id);
      if (!btn.getAttribute("aria-label")) btn.setAttribute("aria-label", btn === prevBtn ? tr("carousel.prev", "上一张") : tr("carousel.next", "下一张"));
      btn.setAttribute("type", btn.getAttribute("type") || "button");
    });

    /* ---------- 视图与分页 ----------
       一屏可能并排多张，能停住的位置只有 count - perView + 1 个，
       指示点按「页」而不是按「张」生成，最后一张才不会对不上高亮。 */

    const maxScroll = () => Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const offsetOf = (i) => slides[i].offsetLeft - slides[0].offsetLeft;
    const pageOffset = (p) => Math.min(offsetOf(p), maxScroll());

    const measure = () => {
      const gap = parseFloat(getComputedStyle(track).gap) || 0;
      const slideWidth = slides[0].getBoundingClientRect().width;
      let perView = 1;
      if (slideWidth > 0) perView = Math.round((viewport.clientWidth + gap) / (slideWidth + gap));
      perView = Math.max(1, Math.min(count, perView || 1));
      state.pages = Math.max(1, count - perView + 1);
      state.perView = perView;
      if (state.index > state.pages - 1) state.index = state.pages - 1;
    };

    let dots = [];
    let manualDots = false;

    const buildDots = () => {
      if (!dotsBox) return;
      const existing = Array.from(dotsBox.querySelectorAll(".cin-carousel-dot"));
      if (existing.length && manualDots) {
        dots = existing;
        return;
      }
      if (existing.length === state.pages) {
        dots = existing;
        return;
      }
      dotsBox.replaceChildren();
      dots = Array.from({ length: state.pages }, (_, i) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "cin-carousel-dot";
        dot.setAttribute("aria-label", tr("carousel.dot", "第 {n} 页", { n: i + 1 }));
        dotsBox.append(dot);
        return dot;
      });
    };

    measure();
    manualDots = !!(dotsBox && dotsBox.querySelector(".cin-carousel-dot"));
    buildDots();

    /* ---------- 同步 ---------- */

    const indexFromScroll = () => {
      const x = viewport.scrollLeft;
      let best = 0;
      let bestDistance = Infinity;
      for (let p = 0; p < state.pages; p += 1) {
        const distance = Math.abs(pageOffset(p) - x);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = p;
        }
      }
      return best;
    };

    const sync = (index, reason, force) => {
      const changed = state.index !== index;
      state.index = index;
      dots.forEach((dot, i) => {
        if (i === index) dot.setAttribute("aria-current", "true");
        else dot.removeAttribute("aria-current");
      });
      slides.forEach((slide, i) => {
        if (i === index) slide.setAttribute("data-active", "");
        else slide.removeAttribute("data-active");
      });
      if (counter) counter.textContent = `${index + 1} / ${state.pages}`;
      if (!loop) {
        if (prevBtn) prevBtn.disabled = index === 0;
        if (nextBtn) nextBtn.disabled = index === state.pages - 1;
      }
      if (changed || force) emit(root, "cin:carouselslide", { index, pages: state.pages, count, reason });
    };

    const goTo = (i, reason = "api", smooth = true) => {
      const pages = state.pages;
      const target = loop ? ((i % pages) + pages) % pages : Math.max(0, Math.min(pages - 1, i));
      const behavior = smooth && !reduced() ? "smooth" : "auto";
      sync(target, reason, true);
      viewport.scrollTo({ left: pageOffset(target), behavior });
      return target;
    };

    const next = (reason = "button") => goTo(state.index + 1, reason);
    const prev = (reason = "button") => goTo(state.index - 1, reason);

    /* ---------- 滚动同步 ----------
       点按钮时先按目标页立刻反馈，滚动动画期间的中间位置不回头覆盖状态，
       等滚动停稳（scrollend 或静默 140ms）再按实际位置校正一次。 */

    let settleTimer = 0;
    const settle = () => {
      if (settleTimer) {
        window.clearTimeout(settleTimer);
        settleTimer = 0;
      }
      const index = indexFromScroll();
      if (index !== state.index) sync(index, "scroll");
    };

    const onScroll = () => {
      if (settleTimer) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settleTimer = 0;
        const index = indexFromScroll();
        if (index !== state.index) sync(index, "scroll");
      }, 140);
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("scrollend", settle);

    /* ---------- 交互 ---------- */

    if (prevBtn) prevBtn.addEventListener("click", () => prev("button"));
    if (nextBtn) nextBtn.addEventListener("click", () => next("button"));

    if (dotsBox) {
      dotsBox.addEventListener("click", (event) => {
        const dot = event.target.closest(".cin-carousel-dot");
        if (!dot) return;
        const index = dots.indexOf(dot);
        if (index >= 0) goTo(index, "dot");
      });
    }

    viewport.addEventListener("keydown", (event) => {
      const key = event.key;
      if (key === "ArrowRight" || key === "ArrowDown") {
        event.preventDefault();
        next("keyboard");
      } else if (key === "ArrowLeft" || key === "ArrowUp") {
        event.preventDefault();
        prev("keyboard");
      } else if (key === "Home") {
        event.preventDefault();
        goTo(0, "keyboard");
      } else if (key === "End") {
        event.preventDefault();
        goTo(state.pages - 1, "keyboard");
      }
    });

    /* 按住拖动时先停自动播放，避免手指还没抬就翻页 */
    root.addEventListener("pointerdown", () => { state.paused = true; });

    /* ---------- 自动播放 ---------- */

    const tick = () => {
      if (state.paused || document.hidden) return;
      goTo(state.index + 1, "autoplay");
    };

    const play = () => {
      if (!delay || reduced() || state.timer) return;
      state.timer = window.setInterval(tick, delay);
    };

    const stop = () => {
      if (!state.timer) return;
      window.clearInterval(state.timer);
      state.timer = 0;
    };

    const pause = () => { state.paused = true; };
    const resume = () => { state.paused = false; };

    root.addEventListener("pointerenter", pause);
    root.addEventListener("pointerleave", resume);
    root.addEventListener("focusin", pause);
    root.addEventListener("focusout", (event) => {
      if (!root.contains(event.relatedTarget)) resume();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) pause();
      else resume();
    });

    /* ---------- 尺寸变化后重新测量并对齐 ---------- */

    let resizeRaf = 0;
    const remeasure = () => {
      const before = state.pages;
      measure();
      if (before !== state.pages) buildDots();
      sync(Math.min(state.index, state.pages - 1), "resize");
      viewport.scrollTo({ left: pageOffset(state.index), behavior: "auto" });
    };

    const onResize = () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        remeasure();
      });
    };
    window.addEventListener("resize", onResize);

    /* ---------- 对外接口 ---------- */

    const api = {
      get index() { return state.index; },
      get pages() { return state.pages; },
      get count() { return count; },
      get perView() { return state.perView; },
      get loop() { return loop; },
      get paused() { return state.paused; },
      next: (reason = "api") => next(reason),
      prev: (reason = "api") => prev(reason),
      goTo: (i, reason = "api") => goTo(i, reason),
      play,
      pause,
      resume,
      stop,
      refresh: () => remeasure(),
      destroy: () => {
        stop();
        if (settleTimer) window.clearTimeout(settleTimer);
        viewport.removeEventListener("scroll", onScroll);
        viewport.removeEventListener("scrollend", settle);
        window.removeEventListener("resize", onResize);
        if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = 0; }
        root.removeAttribute("data-carousel-ready");
        delete root.__cinCarousel;
      },
    };

    root.__cinCarousel = api;
    sync(0, "init", true);
    play();
    return api;
  };

  C.initCarousels = (scope = document) => {
    let bound = 0;
    Array.from(scope.querySelectorAll(SELECTOR)).forEach((el) => {
      if (el.__cinCarousel) return;
      if (init(el)) bound += 1;
    });
    return bound;
  };
  C.carousel = (el) => init(el);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { C.initCarousels(); }, { once: true });
  } else {
    C.initCarousels();
  }
})();


/* ---- cascader.js ---- */
/* cascader.js 约定：无脚本时输入框仍可手输「父/子」路径并提交，面板不弹，内容不丢。
   JS 只负责：按 options 树逐列展开、写回路径与 root[data-value]、面板夹进视口、键盘漫游，
   并外抛 cin:cascader* 事件。
   结构：<div class="cin-cascader" data-cascader data-options='[{"value":"zj","label":"浙江","children":[…]}]'>
           <div class="cin-cascader-fields"><span class="cin-cascader-field"><input data-cascader-field></span>
           <button class="cin-cascader-toggle"></button></div>
         </div> */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;
  const state = new WeakMap();
  let openRoot = null;

  const emit = (el, type, detail = {}) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  const split = (v) => String(v ?? "").split("/").map((s) => s.trim()).filter(Boolean);

  function optionsOf(root) {
    const st = state.get(root);
    if (st && st.options) return st.options;
    const raw = root.dataset.options;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function fieldOf(root) {
    return root.querySelector("[data-cascader-field], .cin-cascader-field > input");
  }

  function walk(root, values) {
    const path = [];
    let level = optionsOf(root);
    for (const v of values) {
      const node = (level || []).find((n) => String(n.value) === String(v));
      if (!node) return { nodes: path, level: level || [] };
      path.push(node);
      level = Array.isArray(node.children) ? node.children : [];
    }
    return { nodes: path, level: level || [] };
  }

  function textOf(root, values) {
    const { nodes } = walk(root, values);
    return nodes.map((n) => n.label ?? n.value).join(" / ");
  }

  function build(root) {
    const pop = document.createElement("div");
    pop.className = "cin-cascader-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-modal", "false");
    pop.setAttribute("aria-label", root.dataset.label || tr("cascader.label", "选择层级"));
    root.append(pop);
    return pop;
  }

  function column(level, depth, selected) {
    const col = document.createElement("div");
    col.className = "cin-cascader-col";
    col.setAttribute("role", "listbox");
    col.dataset.depth = String(depth);
    col.setAttribute("aria-label", tr("cascader.level", "第 {n} 级", { n: depth + 1 }));
    if (!level.length) {
      const empty = document.createElement("div");
      empty.className = "cin-cascader-empty";
      empty.textContent = tr("cascader.empty", "无可选项");
      col.append(empty);
    }
    level.forEach((node) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cin-cascader-opt";
      b.setAttribute("role", "option");
      b.dataset.value = String(node.value);
      b.dataset.depth = String(depth);
      const isSel = String(node.value) === String(selected[depth] ?? "");
      b.setAttribute("aria-selected", String(isSel));
      if (isSel && Array.isArray(node.children) && node.children.length) b.setAttribute("aria-expanded", "true");
      b.disabled = node.disabled === true;
      b.textContent = node.label ?? node.value;
      col.append(b);
    });
    return col;
  }

  function render(root) {
    const pop = root.querySelector(".cin-cascader-pop");
    if (!pop) return;
    const values = split(root.dataset.value);
    pop.textContent = "";
    const levels = [optionsOf(root)];
    const { nodes } = walk(root, values);
    nodes.forEach((n) => {
      if (Array.isArray(n.children) && n.children.length) levels.push(n.children);
    });
    levels.forEach((level, depth) => pop.append(column(level, depth, values)));
  }

  function place(root) {
    const pop = root.querySelector(".cin-cascader-pop");
    const fields = root.querySelector(".cin-cascader-fields");
    if (!pop || !fields) return;
    const r = fields.getBoundingClientRect();
    pop.style.visibility = "hidden";
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - w - 8);
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    pop.style.left = Math.max(8, left) + "px";
    pop.style.top = top + "px";
    pop.style.visibility = "";
  }

  function sync(root, reason) {
    const field = fieldOf(root);
    const values = split(root.dataset.value);
    const text = textOf(root, values);
    if (field) field.value = text;
    root.removeAttribute("data-invalid");
    const st = state.get(root);
    if (st) st.values = values;
    emit(root, "cin:cascaderchange", { value: root.dataset.value, labels: text, reason });
  }

  function open(root) {
    if (openRoot && openRoot !== root) close(openRoot, "switch");
    render(root);
    place(root);
    root.setAttribute("data-open", "");
    state.get(root).open = true;
    openRoot = root;
    const sel = root.querySelector('.cin-cascader-opt[aria-selected="true"]:not(:disabled)') || root.querySelector(".cin-cascader-opt:not(:disabled)");
    if (sel) sel.focus({ preventScroll: true });
    emit(root, "cin:cascaderopen", {});
  }

  function close(root, reason) {
    const st = state.get(root);
    if (!st || !st.open) return;
    root.removeAttribute("data-open");
    st.open = false;
    if (openRoot === root) openRoot = null;
    emit(root, "cin:cascaderclose", { reason });
  }

  function choose(root, opt) {
    const depth = Number(opt.dataset.depth || 0);
    const values = split(root.dataset.value).slice(0, depth);
    values[depth] = opt.dataset.value;
    root.dataset.value = values.join("/");
    const st = state.get(root);
    const level = (() => {
      let lv = optionsOf(root);
      for (const v of values.slice(0, depth)) {
        const n = (lv || []).find((x) => String(x.value) === String(v));
        lv = n && Array.isArray(n.children) ? n.children : [];
      }
      return lv || [];
    })();
    const picked = level.find((n) => String(n.value) === String(values[depth]));
    const hasChildren = !!(picked && Array.isArray(picked.children) && picked.children.length);
    if (hasChildren) {
      if (st) st.values = values;
      render(root);
      place(root);
      const nextCol = root.querySelector(`.cin-cascader-col[data-depth="${depth + 1}"]`);
      const target = nextCol && nextCol.querySelector(".cin-cascader-opt:not(:disabled)");
      if (target) target.focus({ preventScroll: true });
      sync(root, "drill");
      return;
    }
    sync(root, "select");
    emit(root, "cin:cascaderselect", { value: root.dataset.value, labels: textOf(root, values) });
    close(root, "select");
    const field = fieldOf(root);
    if (field) field.focus({ preventScroll: true });
  }

  function attach(root) {
    if (state.has(root)) return;
    state.set(root, { options: null, values: split(root.dataset.value), open: false });
    const field = fieldOf(root);
    build(root);
    if (field && root.dataset.value) field.value = textOf(root, split(root.dataset.value));

    root.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest(".cin-cascader-toggle")) {
        e.preventDefault();
        const st = state.get(root);
        if (st.open) close(root, "button");
        else open(root);
        return;
      }
      const opt = t.closest(".cin-cascader-opt");
      if (opt && !opt.disabled) choose(root, opt);
    });

    root.addEventListener("keydown", (e) => {
      const st = state.get(root);
      if (!st || !st.open) return;
      const cols = [...root.querySelectorAll(".cin-cascader-col")];
      const active = document.activeElement;
      const idx = cols.findIndex((c) => c.contains(active));
      if (idx < 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const opts = [...cols[idx].querySelectorAll(".cin-cascader-opt:not(:disabled)")];
        const i = opts.indexOf(active);
        const next = opts[Math.min(opts.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next) next.focus({ preventScroll: true });
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const nextCol = cols[idx + (e.key === "ArrowRight" ? 1 : -1)];
        if (!nextCol) return;
        const target = nextCol.querySelector('.cin-cascader-opt[aria-selected="true"]:not(:disabled)') || nextCol.querySelector(".cin-cascader-opt:not(:disabled)");
        if (target) target.focus({ preventScroll: true });
        return;
      }
      if (e.key === "Enter" && active instanceof HTMLElement && active.classList.contains("cin-cascader-opt") && !active.disabled) {
        e.preventDefault();
        choose(root, active);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        close(root, "escape");
        const f = fieldOf(root);
        if (f) f.focus({ preventScroll: true });
      }
    });

    if (field) {
      field.addEventListener("change", () => {
        root.dataset.value = split(field.value).join("/");
        sync(root, "type");
      });
    }

    document.addEventListener("pointerdown", (e) => {
      const st = state.get(root);
      if (!st || !st.open) return;
      if (!(e.target instanceof Element) || root.contains(e.target)) return;
      close(root, "outside");
    });

    window.addEventListener("resize", () => {
      const st = state.get(root);
      if (st && st.open) place(root);
    });
  }

  const roots = (scope) => (scope || document).querySelectorAll("[data-cascader], .cin-cascader");

  C.initCascaders = (scope = document) => {
    roots(scope).forEach(attach);
  };

  C.setCascaderOptions = (target, options) => {
    const root = target instanceof Element ? (target.matches("[data-cascader], .cin-cascader") ? target : target.closest("[data-cascader], .cin-cascader")) : null;
    if (!root || !Array.isArray(options)) return false;
    attach(root);
    state.get(root).options = options;
    render(root);
    return true;
  };

  C.setCascader = (target, value) => {
    const root = target instanceof Element ? (target.matches("[data-cascader], .cin-cascader") ? target : target.closest("[data-cascader], .cin-cascader")) : null;
    if (!root) return null;
    attach(root);
    root.dataset.value = split(value).join("/");
    const st = state.get(root);
    if (st && st.open) render(root);
    sync(root, "api");
    return root.dataset.value;
  };

  C.cascader = (target) => {
    const root = target instanceof Element ? (target.matches("[data-cascader], .cin-cascader") ? target : target.closest("[data-cascader], .cin-cascader")) : null;
    if (!root) return null;
    attach(root);
    return {
      open: () => open(root),
      close: () => close(root, "api"),
      get value() {
        return root.dataset.value || "";
      },
      get labels() {
        return textOf(root, split(root.dataset.value));
      },
      set: (v) => C.setCascader(root, v),
      setOptions: (o) => C.setCascaderOptions(root, o),
    };
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => C.initCascaders());
  else C.initCascaders();
})();


/* ---- colorpicker.js ---- */
/* colorpicker.js 约定：原生 input[type=color] 打底，没有脚本时点开的是系统取色盘；
   脚本接管后只做三件事，颜色计算与取值全部走本文件，不依赖任何库：
     1) 面板换皮：饱和度/明度区、色相条、透明度条、数值框、预设色全部读写同一份 HSV 状态；
     2) 格式转换：按 data-format（hex / rgb / hsl）把状态写成文本，回填色块与隐藏域；
     3) 外抛 cin:colorinput（拖动过程中）与 cin:colorchange（落定）。
   结构：
     <div class="cin-colorpicker" data-colorpicker data-value="#C04229" data-format="hex">
       <div class="cin-colorpicker-trigger">
         <input class="cin-colorpicker-native" type="color" aria-label="选择颜色">
         <span class="cin-colorpicker-chip"></span>
         <span class="cin-colorpicker-value"></span>
       </div>
       <div class="cin-colorpicker-pop" role="dialog" aria-label="取色">
         <div class="cin-colorpicker-area"><span class="cin-colorpicker-area-thumb"></span></div>
         <input class="cin-colorpicker-range cin-colorpicker-hue" type="range" min="0" max="360" step="1">
         <input class="cin-colorpicker-range cin-colorpicker-alpha" type="range" min="0" max="100" step="1">
         <div class="cin-colorpicker-fields">
           <label class="cin-colorpicker-field" data-span>HEX<input data-hex></label>
           <label class="cin-colorpicker-field">R<input data-r type="number" min="0" max="255"></label>
           …
         </div>
         <div class="cin-colorpicker-presets">
           <button class="cin-colorpicker-preset" type="button" data-color="#C04229" data-name="陶土红"></button>
         </div>
       </div>
     </div> */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;

  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  const collect = (scope, sel) => {
    if (!scope) return [];
    const list = [];
    if (scope.matches && scope.matches(sel)) list.push(scope);
    if (scope.querySelectorAll) list.push(...scope.querySelectorAll(sel));
    return list;
  };

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const round = (n) => Math.round(n);

  /* ---------------- 颜色换算 ---------------- */
  const HEX_3 = /^#?([0-9a-f]{3,4})$/i;
  const HEX_6 = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i;
  const RGB_FN = /^rgba?\(\s*([^)]+)\)$/i;
  const HSL_FN = /^hsla?\(\s*([^)]+)\)$/i;

  const hexPair = (n) => round(clamp(n, 0, 255)).toString(16).padStart(2, "0");

  function hsvToRgb(h, s, v) {
    const sat = s / 100;
    const val = v / 100;
    const c = val * sat;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const m = val - c;
    const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hp) % 6];
    return { r: (seg[0] + m) * 255, g: (seg[1] + m) * 255, b: (seg[2] + m) * 255 };
  }

  function rgbToHsv(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === rn) h = 60 * (((gn - bn) / d) % 6);
      else if (max === gn) h = 60 * ((bn - rn) / d + 2);
      else h = 60 * ((rn - gn) / d + 4);
    }
    return { h: (h + 360) % 360, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
  }

  function rgbToHsl(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0;
    let s = 0;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === rn) h = 60 * (((gn - bn) / d) % 6);
      else if (max === gn) h = 60 * ((bn - rn) / d + 2);
      else h = 60 * ((rn - gn) / d + 4);
    }
    return { h: (h + 360) % 360, s: s * 100, l: l * 100 };
  }

  const rgbToHex = (rgb, a) => {
    const base = `#${hexPair(rgb.r)}${hexPair(rgb.g)}${hexPair(rgb.b)}`;
    return a >= 100 ? base : `${base}${hexPair((a / 100) * 255)}`;
  };

  /** 接受 hex3 / hex4 / hex6 / hex8、rgb()/rgba()、hsl()/hsla()，返回 HSV + 透明度 */
  function parseColor(input) {
    const text = String(input == null ? "" : input).trim();
    if (!text) return null;

    let m = text.match(HEX_6);
    if (m) {
      const int = parseInt(m[1], 16);
      const a = m[2] ? (parseInt(m[2], 16) / 255) * 100 : 100;
      const hsv = rgbToHsv((int >> 16) & 255, (int >> 8) & 255, int & 255);
      return { ...hsv, a };
    }
    m = text.match(HEX_3);
    if (m) {
      const d = m[1].split("").map((c) => parseInt(c + c, 16));
      const a = d.length === 4 ? (d[3] / 255) * 100 : 100;
      const hsv = rgbToHsv(d[0], d[1], d[2]);
      return { ...hsv, a };
    }
    m = text.match(RGB_FN);
    if (m) {
      const parts = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
      if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
      const a = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] * 100 : 100;
      return { ...rgbToHsv(clamp(parts[0], 0, 255), clamp(parts[1], 0, 255), clamp(parts[2], 0, 255)), a };
    }
    m = text.match(HSL_FN);
    if (m) {
      const parts = m[1].split(/[,/\s]+/).filter(Boolean);
      const h = parseFloat(parts[0]);
      const s = parseFloat(parts[1]) / 100;
      const l = parseFloat(parts[2]) / 100;
      if (![h, s, l].every((n) => Number.isFinite(n))) return null;
      const a = parts.length > 3 && Number.isFinite(parseFloat(parts[3])) ? parseFloat(parts[3]) * 100 : 100;
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const hp = (((h % 360) + 360) % 360) / 60;
      const x = c * (1 - Math.abs((hp % 2) - 1));
      const mm = l - c / 2;
      const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hp) % 6];
      const rgb = { r: (seg[0] + mm) * 255, g: (seg[1] + mm) * 255, b: (seg[2] + mm) * 255 };
      return { ...rgbToHsv(rgb.r, rgb.g, rgb.b), a };
    }
    return null;
  }

  /* ---------------- 格式化 ---------------- */
  function formatValue(root, st) {
    const rgb = hsvToRgb(st.h, st.s, st.v);
    const withAlpha = root.hasAttribute("data-alpha");
    const a = withAlpha ? clamp(st.a, 0, 100) : 100;
    const alphaText = (a / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    const kind = (root.getAttribute("data-format") || "hex").toLowerCase();

    if (kind === "rgb") {
      const nums = `${round(rgb.r)}, ${round(rgb.g)}, ${round(rgb.b)}`;
      return a >= 100 ? `rgb(${nums})` : `rgba(${nums}, ${alphaText})`;
    }
    if (kind === "hsl") {
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      const nums = `${round(hsl.h)} ${round(hsl.s)}% ${round(hsl.l)}%`;
      return a >= 100 ? `hsl(${nums})` : `hsl(${nums} / ${alphaText})`;
    }
    return rgbToHex(rgb, a);
  }

  /* ---------------- 渲染 ---------------- */
  const q = (root, sel) => root.querySelector(sel);

  /* 已绑定的实例集合：外部点击、滚动、改窗口尺寸共用一份监听 */
  const ROOTS = new Set();
  let watching = false;

  function watchGlobal() {
    if (watching) return;
    watching = true;

    document.addEventListener("pointerdown", (event) => {
      ROOTS.forEach((root) => {
        if (!root.hasAttribute("data-open")) return;
        if (root.contains(event.target)) return;
        close(root);
      });
    });

    const replace = () => {
      ROOTS.forEach((root) => {
        if (!root.hasAttribute("data-open")) return;
        const pop = q(root, ".cin-colorpicker-pop");
        if (pop) place(root, pop);
      });
    };
    window.addEventListener("resize", replace);
    window.addEventListener("scroll", replace, true);
  }

  function paint(root, st) {
    const rgb = hsvToRgb(st.h, st.s, st.v);
    const withAlpha = root.hasAttribute("data-alpha");
    const a = withAlpha ? clamp(st.a, 0, 100) : 100;
    const filled = `rgba(${round(rgb.r)}, ${round(rgb.g)}, ${round(rgb.b)}, ${(a / 100).toFixed(3)})`;
    const text = formatValue(root, st);

    root.style.setProperty("--_c", filled);
    root.setAttribute("data-value", text);

    const out = q(root, ".cin-colorpicker-value");
    if (out && out.textContent !== text) out.textContent = text;

    const native = q(root, ".cin-colorpicker-native");
    if (native) {
      const hex = rgbToHex(rgb, 100);
      if (native.value !== hex) native.value = hex;
    }

    const pop = q(root, ".cin-colorpicker-pop");
    if (pop) {
      pop.style.setProperty("--_h", String(round(st.h)));
      pop.style.setProperty("--_s", `${st.s.toFixed(2)}%`);
      pop.style.setProperty("--_v", `${st.v.toFixed(2)}%`);
    }

    const hue = q(root, ".cin-colorpicker-hue");
    if (hue && document.activeElement !== hue && Number(hue.value) !== round(st.h)) hue.value = String(round(st.h));

    const alpha = q(root, ".cin-colorpicker-alpha");
    if (alpha) {
      alpha.style.setProperty("--_c", filled);
      if (document.activeElement !== alpha && Number(alpha.value) !== round(a)) alpha.value = String(round(a));
    }

    const hexInput = q(root, "[data-hex]");
    if (hexInput && document.activeElement !== hexInput) hexInput.value = rgbToHex(rgb, a);

    const fields = { "[data-r]": rgb.r, "[data-g]": rgb.g, "[data-b]": rgb.b, "[data-a]": a };
    Object.entries(fields).forEach(([sel, value]) => {
      const el = q(root, sel);
      if (el && document.activeElement !== el) el.value = String(round(value));
    });

    collect(root, ".cin-colorpicker-preset").forEach((btn) => {
      const same = parseColor(btn.getAttribute("data-color"));
      const hit = same && Math.abs(same.h - st.h) < 1.5 && Math.abs(same.s - st.s) < 1.5 && Math.abs(same.v - st.v) < 1.5;
      btn.setAttribute("aria-pressed", hit ? "true" : "false");
    });

    const hidden = q(root, "input[type=hidden]");
    if (hidden) hidden.value = text;

    return text;
  }

  function detail(root, st) {
    const rgb = hsvToRgb(st.h, st.s, st.v);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const withAlpha = root.hasAttribute("data-alpha");
    return {
      value: formatValue(root, st),
      hex: rgbToHex(rgb, withAlpha ? st.a : 100),
      rgb: { r: round(rgb.r), g: round(rgb.g), b: round(rgb.b) },
      hsl: { h: round(hsl.h), s: round(hsl.s), l: round(hsl.l) },
      alpha: withAlpha ? round(clamp(st.a, 0, 100)) : 100,
    };
  }

  function commit(root, st, type) {
    paint(root, st);
    emit(root, type, detail(root, st));
  }

  /* ---------------- 面板定位 ---------------- */
  function place(root, pop) {
    const anchor = q(root, ".cin-colorpicker-trigger") || root;
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    if (!pw || !ph) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const left = clamp(rect.left, margin, Math.max(margin, vw - pw - margin));
    let top = rect.bottom + 6;
    if (top + ph > vh - margin && rect.top - ph - 6 >= margin) top = rect.top - ph - 6;
    else top = clamp(top, margin, Math.max(margin, vh - ph - margin));

    pop.style.left = `${round(left)}px`;
    pop.style.top = `${round(top)}px`;
  }

  function open(root) {
    const st = root.__cinColor;
    const pop = q(root, ".cin-colorpicker-pop");
    if (!st || !pop || root.hasAttribute("data-disabled")) return;
    if (root.hasAttribute("data-open")) return;

    collect(document, "[data-colorpicker][data-open]").forEach((other) => {
      if (other !== root) close(other);
    });

    root.setAttribute("data-open", "");
    place(root, pop);

    const trigger = q(root, ".cin-colorpicker-native");
    if (trigger) trigger.setAttribute("aria-expanded", "true");

    const first = q(root, "[data-hex]") || pop.querySelector("button, input");
    if (first) first.focus({ preventScroll: true });

    emit(root, "cin:coloropen", detail(root, st));
  }

  function close(root) {
    const pop = q(root, ".cin-colorpicker-pop");
    if (!root.hasAttribute("data-open")) return;
    root.removeAttribute("data-open");
    const trigger = q(root, ".cin-colorpicker-native");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    if (root.__cinColor) emit(root, "cin:colorclose", detail(root, root.__cinColor));
    if (pop) pop.removeAttribute("data-open");
  }

  /* ---------------- 事件绑定 ---------------- */
  function applyFromArea(root, st, event) {
    const area = q(root, ".cin-colorpicker-area");
    if (!area) return;
    const rect = area.getBoundingClientRect();
    st.s = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
    st.v = clamp((1 - (event.clientY - rect.top) / rect.height) * 100, 0, 100);
  }

  function bind(root) {
    if (root.__cinColor) return false;

    const native = q(root, ".cin-colorpicker-native");
    const initial = parseColor(root.getAttribute("data-value") || (native && native.value) || "#C04229");
    const st = { ...(initial || { h: 12, s: 78, v: 75, a: 100 }) };
    root.__cinColor = st;
    root.setAttribute("data-ready", "");

    if (native) {
      native.setAttribute("aria-haspopup", "dialog");
      native.setAttribute("aria-expanded", "false");
    }

    paint(root, st);

    collect(root, ".cin-colorpicker-preset").forEach((btn) => {
      const color = btn.getAttribute("data-color");
      if (color) btn.style.setProperty("--_c", color);
      if (!btn.type) btn.type = "button";
      if (!btn.getAttribute("aria-label")) btn.setAttribute("aria-label", btn.getAttribute("data-name") || color || tr("colorpicker.swatch", "预设色"));
    });

    /* 触发器：拦下原生取色盘，改为打开自绘面板；键盘 Enter/Space 会以 click 形式走到这里 */
    const trigger = q(root, ".cin-colorpicker-trigger");
    if (trigger) {
      trigger.addEventListener("click", (event) => {
        if (root.hasAttribute("data-disabled")) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        if (root.hasAttribute("data-open")) close(root);
        else open(root);
      });
    }

    /* 面板内的交互一律截住冒泡，避免被外部点击关闭 */
    const pop = q(root, ".cin-colorpicker-pop");
    if (pop) {
      pop.addEventListener("click", (event) => event.stopPropagation());

      pop.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close(root);
          const focusBack = q(root, ".cin-colorpicker-native") || trigger;
          if (focusBack) focusBack.focus({ preventScroll: true });
        }
      });

      /* 饱和度/明度区：指针捕获后连续拖动 */
      const area = q(root, ".cin-colorpicker-area");
      if (area) {
        const move = (event) => {
          applyFromArea(root, st, event);
          commit(root, st, "cin:colorinput");
        };
        area.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          area.setPointerCapture(event.pointerId);
          applyFromArea(root, st, event);
          commit(root, st, "cin:colorinput");
        });
        area.addEventListener("pointermove", (event) => {
          if (!area.hasPointerCapture(event.pointerId)) return;
          move(event);
        });
        area.addEventListener("pointerup", (event) => {
          if (!area.hasPointerCapture(event.pointerId)) return;
          area.releasePointerCapture(event.pointerId);
          commit(root, st, "cin:colorchange");
        });
        area.addEventListener("pointercancel", (event) => {
          if (area.hasPointerCapture(event.pointerId)) area.releasePointerCapture(event.pointerId);
        });
      }

      const hue = q(root, ".cin-colorpicker-hue");
      if (hue) {
        hue.addEventListener("input", () => {
          st.h = Number(hue.value);
          commit(root, st, "cin:colorinput");
        });
        hue.addEventListener("change", () => commit(root, st, "cin:colorchange"));
      }

      const alpha = q(root, ".cin-colorpicker-alpha");
      if (alpha) {
        alpha.addEventListener("input", () => {
          st.a = Number(alpha.value);
          commit(root, st, "cin:colorinput");
        });
        alpha.addEventListener("change", () => commit(root, st, "cin:colorchange"));
      }

      /* 十六进制 / RGB / 透明度数值框：失焦或回车提交，非法值标红不写回状态 */
      const fields = ["[data-hex]", "[data-r]", "[data-g]", "[data-b]", "[data-a]"];
      fields.forEach((sel) => {
        const el = q(root, sel);
        if (!el) return;
        const apply = () => {
          let next = null;
          if (sel === "[data-hex]") {
            next = parseColor(el.value);
            if (next) next.a = root.hasAttribute("data-alpha") ? next.a : 100;
          } else if (sel === "[data-a]") {
            const v = parseFloat(el.value);
            if (Number.isFinite(v)) {
              st.a = clamp(v, 0, 100);
              next = { ...st };
            }
          } else {
            const rgb = {
              r: Number(q(root, "[data-r]") && q(root, "[data-r]").value) || 0,
              g: Number(q(root, "[data-g]") && q(root, "[data-g]").value) || 0,
              b: Number(q(root, "[data-b]") && q(root, "[data-b]").value) || 0,
            };
            next = { ...rgbToHsv(clamp(rgb.r, 0, 255), clamp(rgb.g, 0, 255), clamp(rgb.b, 0, 255)), a: st.a };
          }
          if (!next) {
            el.setAttribute("data-invalid", "");
            return;
          }
          el.removeAttribute("data-invalid");
          Object.assign(st, next);
          commit(root, st, "cin:colorchange");
        };
        el.addEventListener("change", apply);
        el.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            apply();
            el.blur();
          }
        });
        el.addEventListener("input", () => el.removeAttribute("data-invalid"));
      });

      collect(root, ".cin-colorpicker-preset").forEach((btn) => {
        btn.addEventListener("click", () => {
          const next = parseColor(btn.getAttribute("data-color"));
          if (!next) return;
          Object.assign(st, next);
          commit(root, st, "cin:colorchange");
        });
      });
    }

    /* 全局监听只在首个实例上挂一次，避免 N 个取色器挂 N 份监听 */
    ROOTS.add(root);
    watchGlobal();

    return true;
  }

  function initColorPickers(scope = document) {
    let n = 0;
    collect(scope, "[data-colorpicker], .cin-colorpicker").forEach((root) => {
      if (!q(root, ".cin-colorpicker-native") && !q(root, ".cin-colorpicker-trigger")) return;
      if (bind(root)) n += 1;
    });
    return n;
  }

  /** 脚本侧赋值：支持 hex / rgb() / hsl() 字符串；找不到容器返回 null */
  function setColorPicker(target, value) {
    const root = target && target.nodeType === 1 ? (target.matches("[data-colorpicker], .cin-colorpicker") ? target : target.closest("[data-colorpicker], .cin-colorpicker")) : null;
    if (!root || !root.__cinColor) return null;
    const next = parseColor(value);
    if (!next) return null;
    Object.assign(root.__cinColor, next);
    commit(root, root.__cinColor, "cin:colorchange");
    return formatValue(root, root.__cinColor);
  }

  C.initColorPickers = initColorPickers;
  C.setColorPicker = setColorPicker;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initColorPickers(), { once: true });
  } else {
    initColorPickers();
  }
})();


/* ---- combobox.js ---- */
/* combobox.js · ARIA 1.2 组合框
   结构：<div class="cin-combobox"><input class="cin-combobox-input" role="combobox" aria-expanded="false">
        <ul class="cin-combobox-list" role="listbox" hidden>…<li role="option"> */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  const P = () => C.Primitives || {};

  function init(root) {
    const input = root.querySelector(".cin-combobox-input");
    const list = root.querySelector(".cin-combobox-list");
    if (!input || !list || input.dataset.cinReady) return;
    input.dataset.cinReady = "1";
    if (!list.id) list.id = "cin-listbox-" + Math.random().toString(36).slice(2, 8);
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("role", "combobox");
    input.setAttribute("autocomplete", "off");

    const options = () => Array.from(list.querySelectorAll('[role="option"]'));
    const visible = () => options().filter((o) => !o.hidden);
    let active = -1;

    const setActive = (i) => {
      const list2 = visible();
      if (!list2.length) return;
      active = (i + list2.length) % list2.length;
      list2.forEach((o, k) => { if (k === active) o.setAttribute("data-active", ""); else o.removeAttribute("data-active"); });
      input.setAttribute("aria-activedescendant", list2[active].id || (list2[active].id = "cin-opt-" + Math.random().toString(36).slice(2, 7)));
      list2[active].scrollIntoView({ block: "nearest" });
    };
    const open = (v) => { list.hidden = !v; input.setAttribute("aria-expanded", String(v)); if (!v) { active = -1; input.removeAttribute("aria-activedescendant"); } };
    const filter = () => {
      const q = input.value.trim().toLowerCase();
      let hits = 0;
      options().forEach((o) => {
        const hit = !q || o.textContent.toLowerCase().includes(q);
        o.hidden = !hit;
        if (hit) hits++;
      });
      if (P().status) P().status.set(root, hits ? "idle" : "empty");
      open(true);
      return hits;
    };
    const choose = (o) => {
      if (!o) return;
      input.value = o.dataset.value || o.textContent.trim();
      options().forEach((n) => n.setAttribute("aria-selected", String(n === o)));
      open(false);
      emit(root, "cin:select", { value: input.value, el: o });
    };

    input.addEventListener("input", () => {
      if (input.dataset.composing) return;
      const debounced = P().tempo ? P().tempo.debounce(filter, 120) : filter;
      debounced();
    });
    input.addEventListener("compositionstart", () => { input.dataset.composing = "1"; });
    input.addEventListener("compositionend", () => { delete input.dataset.composing; filter(); });
    input.addEventListener("focus", () => { if (list.children.length) open(true); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) filter(); setActive(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
      else if (e.key === "Enter") {
        // 未用方向键时回车等价于选中首个可见项（搜索结果只有一个时的直觉行为）
        const v = visible()[active >= 0 ? active : 0];
        if (!list.hidden && v) { e.preventDefault(); choose(v); }
      }
      else if (e.key === "Escape") { if (!list.hidden) { e.preventDefault(); open(false); } }
      else if (e.key === "Tab") { open(false); }
    });
    list.addEventListener("mousedown", (e) => {
      const o = e.target.closest('[role="option"]');
      if (o) { e.preventDefault(); choose(o); }
    });
    root.addEventListener("focusout", (e) => { if (!root.contains(e.relatedTarget) && !root.contains(document.activeElement)) open(false); });
  }

  C.combobox = { init, initAll: (s = document) => s.querySelectorAll(".cin-combobox").forEach(init) };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", () => C.combobox.initAll()) : C.combobox.initAll();
})();


/* ---- copy.js ---- */
/* copy.js 约定：只做「取文本 → 写剪贴板 → 换 1.6s 成功态」。
   文案不写死在脚本里，按钮用 data-label / data-copied-label 自带；
   取值顺序：data-value（字面量）→ data-copy（选择器，取 value 或 textContent）
   → 同组 .cin-copy-group-value。不猜、不拼、不读 DOM 之外的东西。
   结构：
     <button class="cin-copy" data-copy="#orderNo" data-label="复制单号" data-copied-label="已复制">
       <span class="cin-copy-icon" aria-hidden="true"></span>
       <span data-copy-label>复制单号</span>
     </button> */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;

  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  const FLASH = 1600;

  /** 取按钮要复制的文本；取不到返回空串，由调用方判断失败 */
  function textOf(btn) {
    const literal = btn.getAttribute("data-value");
    if (literal !== null && literal !== "") return literal;

    const sel = btn.getAttribute("data-copy");
    if (sel) {
      let el = null;
      try {
        el = document.querySelector(sel);
      } catch {
        el = null;
      }
      if (el) {
        const val = typeof el.value === "string" && el.value !== "" ? el.value : el.textContent;
        return (val || "").trim();
      }
    }

    const group = btn.closest(".cin-copy-group");
    const holder = group && group.querySelector(".cin-copy-group-value");
    if (holder) {
      const val = typeof holder.value === "string" && holder.value !== "" ? holder.value : holder.textContent;
      return (val || "").trim();
    }
    return "";
  }

  /** 安全上下文用 Clipboard API；http 页面或旧浏览器退回 textarea + execCommand */
  async function writeClipboard(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* 落到下面的兜底 */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.insetBlockStart = "-1000px";
      ta.style.opacity = "0";
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function paint(btn, ok) {
    const label = btn.querySelector("[data-copy-label]") || btn.querySelector(".cin-copy-label");
    if (label && !btn.__cinCopyLabel) btn.__cinCopyLabel = label.textContent;
    const done = btn.getAttribute("data-copied-label") || tr("copy.done", "已复制");
    clearTimeout(btn.__cinCopyTimer);
    btn.toggleAttribute("data-copied", ok);
    btn.setAttribute("data-state", ok ? "copied" : "failed");
    if (label) label.textContent = ok ? done : btn.getAttribute("data-error-label") || tr("copy.error", "复制失败");
    btn.__cinCopyTimer = setTimeout(() => {
      btn.removeAttribute("data-copied");
      btn.removeAttribute("data-state");
      if (label && btn.__cinCopyLabel !== undefined) label.textContent = btn.__cinCopyLabel;
    }, FLASH);
  }

  function bind(btn) {
    if (btn.__cinCopyBound) return false;
    btn.__cinCopyBound = true;
    btn.addEventListener("click", async () => {
      if (btn.disabled || btn.hasAttribute("data-disabled")) return;
      const text = textOf(btn);
      const ok = await writeClipboard(text);
      paint(btn, ok);
      emit(btn, "cin:copy", { text, ok });
    });
    return true;
  }

  function initCopyButtons(scope = document) {
    let n = 0;
    const list = [];
    if (scope && scope.matches && scope.matches("[data-copy-button], .cin-copy")) list.push(scope);
    if (scope && scope.querySelectorAll) list.push(...scope.querySelectorAll("[data-copy-button], .cin-copy"));
    list.forEach((btn) => {
      if (btn.tagName === "BUTTON" && !btn.hasAttribute("type")) btn.setAttribute("type", "button");
      if (bind(btn)) n += 1;
    });
    return n;
  }

  C.initCopyButtons = initCopyButtons;
  C.copyText = writeClipboard;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initCopyButtons(), { once: true });
  } else {
    initCopyButtons();
  }
})();


/* ---- currency.js ---- */
/* currency.js · 金额输入（千分位 / 小数 / 负数 / IME 安全） */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  const format = (raw, decimals) => {
    let s = String(raw).replace(/[^\d.\-]/g, "");
    const negative = s.startsWith("-");
    s = s.replace(/-/g, "");
    const dot = s.indexOf(".");
    let int = dot >= 0 ? s.slice(0, dot) : s;
    let frac = dot >= 0 ? s.slice(dot + 1).replace(/\./g, "").slice(0, decimals) : "";
    int = int.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    let out = int;
    if (dot >= 0 && decimals > 0) out += "." + frac.padEnd(decimals, "0");
    if (negative) out = "-" + out;
    return out;
  };
  const toNumber = (s) => {
    const n = Number(String(s).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  function init(wrap) {
    if (wrap.dataset.cinReady) return;
    wrap.dataset.cinReady = "1";
    const input = wrap.querySelector(".cin-currency-input");
    if (!input) return;
    const decimals = Number(wrap.dataset.decimals ?? 2);
    const min = wrap.dataset.min !== undefined ? Number(wrap.dataset.min) : -Infinity;
    const max = wrap.dataset.max !== undefined ? Number(wrap.dataset.max) : Infinity;

    const validate = () => {
      if (!input.value.trim()) { wrap.removeAttribute("data-invalid"); return null; }
      const n = toNumber(input.value);
      const bad = n === null || n < min || n > max;
      if (bad) wrap.setAttribute("data-invalid", "true"); else wrap.removeAttribute("data-invalid");
      return bad ? n : null;
    };
    const digits = (v) => v.replace(/[^\d.\-]/g, "");
    const apply = () => {
      const active = document.activeElement === input;
      const raw = input.value;
      const caret = input.selectionStart ?? raw.length;
      const want = digits(raw.slice(0, caret)).length;
      input.value = format(raw, decimals);
      // 重写 value 会把光标弹回开头：按「已输入的有效字符数」映射回格式化串
      if (active && want > 0) {
        let seen = 0, pos = input.value.length;
        for (let i = 0; i < input.value.length; i++) {
          if (/[\d.\-]/.test(input.value[i])) seen++;
          if (seen === want) { pos = i + 1; break; }
        }
        if (want >= digits(input.value).length) pos = input.value.length;
        input.setSelectionRange(pos, pos);
      }
      const bad = validate();
      emit(wrap, "cin:currency-change", { value: toNumber(input.value), invalid: !!bad });
    };

    input.addEventListener("compositionstart", () => { input.dataset.composing = "1"; });
    input.addEventListener("compositionend", () => { delete input.dataset.composing; apply(); });
    input.addEventListener("input", () => { if (!input.dataset.composing) apply(); });
    input.addEventListener("blur", apply);
    // 不在 focus 时抢光标：否则会打断「全选后覆盖输入」，退化成追加


    const step = (d) => {
      const n = toNumber(input.value) ?? 0;
      input.value = String(Math.round((n + d) * 10 ** decimals) / 10 ** decimals);
      apply();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") { e.preventDefault(); step(1); }
      if (e.key === "ArrowDown") { e.preventDefault(); step(-1); }
    });
  }

  C.currency = { init, initAll: (s = document) => s.querySelectorAll(".cin-currency").forEach(init), format, toNumber };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", () => C.currency.initAll()) : C.currency.initAll();
})();


/* ---- datagrid.js ---- */
/**
 * cinder-erp · datagrid 行为层
 * 只做三件事：列 pop-in（按容器宽度收列并落到展开行）、多选、排序标记。
 * 无框架依赖；DOM 就绪后自动初始化，也可手动 window.CinderERP.initDataGrids(root)。
 */
(function () {
  const P = [4, 3, 2];

  function cellsOf(dg) {
    return dg.querySelectorAll("thead th, tbody td");
  }

  function reset(dg) {
    dg.querySelectorAll(".is-popped").forEach((el) => el.classList.remove("is-popped"));
    dg.removeAttribute("data-popped");
  }

  /** 收集被收起列到展开行 */
  function buildDetail(dg, rows) {
    rows.forEach((tr) => {
      let detail = tr.nextElementSibling;
      if (!detail || !detail.classList.contains("cin-dg-detail")) {
        detail = document.createElement("tr");
        detail.className = "cin-dg-detail";
        detail.innerHTML = `<td colspan="${tr.children.length}"><dl class="cin-dg-detail-grid"></dl></td>`;
        tr.after(detail);
      }
      const dl = detail.querySelector("dl");
      dl.innerHTML = "";
      const popped = [];
      Array.from(tr.children).forEach((td, i) => {
        if (!td.classList.contains("is-popped")) return;
        const th = dg.querySelector(`thead tr th:nth-child(${i + 1})`);
        const label = (td.dataset.label || (th && th.textContent) || "").trim();
        if (!label) return;
        const div = document.createElement("div");
        const dt = document.createElement("dt");
        const dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = td.textContent.trim();
        div.append(dt, dd);
        dl.append(div);
        popped.push(td);
      });
      if (!popped.length) {
        detail.remove();
      }
    });
  }

  function fit(dg) {
    const scroller = dg.querySelector(".cin-dg-scroll") || dg;
    const table = dg.querySelector("table");
    if (!table) return;
    reset(dg);
    const rows = Array.from(dg.querySelectorAll("tbody tr:not(.cin-dg-detail)"));
    if (!rows.length) return;

    if (table.scrollWidth <= scroller.clientWidth + 1) return;

    dg.setAttribute("data-popped", "1");
    for (const p of P) {
      const targets = dg.querySelectorAll(`[data-priority="${p}"]`);
      if (!targets.length) continue;
      targets.forEach((el) => el.classList.add("is-popped"));
      if (table.scrollWidth <= scroller.clientWidth + 1) break;
    }
    buildDetail(dg, rows);
  }

  function initSelection(dg) {
    const all = dg.querySelector("[data-check-all]");
    const boxes = () => Array.from(dg.querySelectorAll("tbody [data-check]"));

    function sync() {
      const list = boxes();
      const checked = list.filter((b) => b.checked);
      list.forEach((b) => b.closest("tr").setAttribute("aria-selected", b.checked ? "true" : "false"));
      dg.dispatchEvent(new CustomEvent("cin:selection", {
        bubbles: true,
        detail: { count: checked.length, values: checked.map((b) => b.value) },
      }));
      if (all) {
        all.checked = checked.length === list.length && list.length > 0;
        all.indeterminate = checked.length > 0 && checked.length < list.length;
      }
      document.querySelectorAll("[data-bulk-count]").forEach((el) => (el.textContent = String(checked.length)));
      document.querySelectorAll("[data-bulk]").forEach((el) => (el.hidden = checked.length === 0));
    }

    if (all) all.addEventListener("change", () => { boxes().forEach((b) => (b.checked = all.checked)); sync(); });
    dg.addEventListener("change", (e) => { if (e.target.matches("tbody [data-check]")) sync(); });
    sync();
  }

  function initSort(dg) {
    dg.querySelectorAll("thead th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const cur = th.getAttribute("aria-sort");
        dg.querySelectorAll("thead th[aria-sort]").forEach((o) => o.removeAttribute("aria-sort"));
        th.setAttribute("aria-sort", cur === "ascending" ? "descending" : "ascending");
        dg.dispatchEvent(new CustomEvent("cin:sort", {
          bubbles: true,
          detail: { key: th.dataset.sort, dir: th.getAttribute("aria-sort") },
        }));
      });
    });
  }

  function initToggle(dg) {
    dg.addEventListener("click", (e) => {
      const btn = e.target.closest(".cin-dg-toggle");
      if (!btn) return;
      const tr = btn.closest("tr");
      const detail = tr && tr.nextElementSibling;
      if (!detail || !detail.classList.contains("cin-dg-detail")) return;
      const open = detail.hasAttribute("data-open");
      detail.toggleAttribute("data-open", !open);
      btn.setAttribute("aria-expanded", String(!open));
    });
  }

  function initOne(dg) {
    if (dg.dataset.cinReady) return;
    dg.dataset.cinReady = "1";
    fit(dg);
    const scroller = dg.querySelector(".cin-dg-scroll") || dg;
    if (window.ResizeObserver) {
      let raf = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => fit(dg));
      });
      ro.observe(scroller);
    }
    /* 虚拟滚动表格（data-virtual）由 virtualgrid.js 接管选择与排序，
       这里只保留列优先级挤压，避免同一 th / checkbox 被两套逻辑各处理一次 */
    if (dg.hasAttribute("data-virtual")) return;
    initSelection(dg);
    initSort(dg);
    initToggle(dg);
  }

  function initDataGrids(root) {
    (root || document).querySelectorAll(".cin-dg").forEach(initOne);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initDataGrids());
  } else {
    initDataGrids();
  }

  window.CinderERP = Object.assign(window.CinderERP || {}, { initDataGrids });
})();


/* ---- datepicker.js ---- */
/* datepicker.js 约定：无脚本时文本框仍可手输 YYYY-MM-DD 并提交，日历按钮不弹面板，内容不丢。
   JS 只负责：按 data-mode 渲染单选/范围日历、min/max 与禁用日校验、键盘漫游、面板夹紧定位、
   写回 input 与 root[data-value]，并外抛 cin:date* 事件。
   结构：<div class="cin-datepicker" data-datepicker data-mode="single">
           <div class="cin-datepicker-fields">[field…]<button class="cin-datepicker-toggle"></button></div>
         </div>
   面板由脚本注入，避免示例页重复抄 30 行日历骨架。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;
  const state = new WeakMap();
  let seq = 0;
  let openRoot = null;

  const emit = (el, type, detail = {}) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const sameDay = (a, b) => !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const today = () => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const addMonths = (d, n) => {
    const y = d.getFullYear();
    const m = d.getMonth() + n;
    const last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(d.getDate(), last));
  };
  function parse(value) {
    const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(String(value || "").trim());
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    const ok = d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
    return ok ? d : null;
  }

  const fieldsOf = (root) => Array.from(root.querySelectorAll("[data-date-field]"));
  const toggleOf = (root) => root.querySelector(".cin-datepicker-toggle");
  const popOf = (root) => root.querySelector(".cin-datepicker-pop");
  const modeOf = (root) => (root.getAttribute("data-mode") === "range" ? "range" : "single");

  function localeOf(root) {
    return root.getAttribute("data-locale") || document.documentElement.lang || navigator.language || "zh-CN";
  }
  function weekStartOf(root) {
    const raw = root.getAttribute("data-week-start");
    const n = raw === null ? 1 : Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 6 ? n : 1;
  }
  function fmt(root, options) {
    try {
      return new Intl.DateTimeFormat(localeOf(root), options);
    } catch {
      return new Intl.DateTimeFormat("zh-CN", options);
    }
  }
  const label = (root, key, fallback) => root.getAttribute(`data-label-${key}`) || fallback;

  function limits(root) {
    return { min: parse(root.getAttribute("data-min")), max: parse(root.getAttribute("data-max")) };
  }
  function blocked(root, date) {
    const { min, max } = limits(root);
    if (min && date < min) return true;
    if (max && date > max) return true;
    const wd = (root.getAttribute("data-disable-weekdays") || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map(Number);
    if (wd.includes(date.getDay())) return true;
    const ex = (root.getAttribute("data-exclude") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return ex.includes(iso(date));
  }

  /* ---------------- 面板骨架 ---------------- */
  function buildPop(root) {
    if (popOf(root)) return popOf(root);
    const pop = document.createElement("div");
    pop.className = "cin-datepicker-pop";
    pop.id = `cin-datepicker-${++seq}`;
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", label(root, "dialog", tr("datepicker.dialog", "选择日期")));
    pop.hidden = true;
    const weekdays = Array.from({ length: 7 }, () => '<span></span>').join("");
    pop.innerHTML =
      '<div class="cin-datepicker-head">' +
      `<button class="cin-datepicker-nav" type="button" data-nav="prev" aria-label="${label(root, "prev", tr("datepicker.prev", "上个月"))}">‹</button>` +
      '<div class="cin-datepicker-jump">' +
      `<select data-month aria-label="${label(root, "month", tr("datepicker.month", "月份"))}"></select>` +
      `<select data-year aria-label="${label(root, "year", tr("datepicker.year", "年份"))}"></select>` +
      "</div>" +
      `<button class="cin-datepicker-nav" type="button" data-nav="next" aria-label="${label(root, "next", tr("datepicker.next", "下个月"))}">›</button>` +
      "</div>" +
      `<div class="cin-datepicker-weekdays" aria-hidden="true">${weekdays}</div>` +
      '<div class="cin-datepicker-grid" role="grid"></div>' +
      '<div class="cin-datepicker-foot">' +
      '<span class="cin-datepicker-hint" aria-live="polite"></span>' +
      "<span>" +
      `<button class="cin-datepicker-act" type="button" data-act="today">${label(root, "today", tr("datepicker.today", "今天"))}</button>` +
      `<button class="cin-datepicker-act" type="button" data-act="clear">${label(root, "clear", tr("datepicker.clear", "清除"))}</button>` +
      "</span></div>";
    const toggle = toggleOf(root);
    if (toggle) {
      toggle.setAttribute("aria-controls", pop.id);
      toggle.setAttribute("aria-expanded", "false");
    }
    root.appendChild(pop);
    bindPop(root, pop);
    return pop;
  }

  function monthOptions(root, pop) {
    const ms = fmt(root, { month: "short" });
    const days = new Date(2024, 0, 1);
    pop.querySelector("[data-month]").innerHTML = Array.from({ length: 12 }, (_, i) => {
      const name = ms.format(new Date(2024, i, 1));
      return `<option value="${i}">${name}</option>`;
    }).join("");
    const { min, max } = limits(root);
    const base = today().getFullYear();
    const from = min ? min.getFullYear() : base - 80;
    const to = max ? max.getFullYear() : base + 20;
    let years = "";
    for (let y = from; y <= to; y += 1) years += `<option value="${y}">${y}</option>`;
    pop.querySelector("[data-year]").innerHTML = years;
  }

  function weekdayHeader(root, pop) {
    const names = fmt(root, { weekday: "short" });
    const start = weekStartOf(root);
    const sunday = new Date(2024, 0, 7); // 2024-01-07 是周日
    const cells = Array.from({ length: 7 }, (_, i) => names.format(addDays(sunday, (start + i) % 7)));
    pop.querySelectorAll(".cin-datepicker-weekdays span").forEach((span, i) => {
      span.textContent = cells[i];
    });
  }

  /* ---------------- 渲染 ---------------- */
  function render(root) {
    const pop = popOf(root) || buildPop(root);
    const st = state.get(root);
    if (!st) return;
    const monthSel = pop.querySelector("[data-month]");
    const yearSel = pop.querySelector("[data-year]");
    if (monthSel.options.length !== 12) monthOptions(root, pop);
    if (!yearSel.options.length) monthOptions(root, pop);
    weekdayHeader(root, pop);
    monthSel.value = String(st.m);
    yearSel.value = String(st.y);
    renderGrid(root);
    const hint = pop.querySelector(".cin-datepicker-hint");
    if (hint) {
      hint.textContent =
        modeOf(root) === "range"
          ? st.value && !st.value2
            ? label(root, "pickEnd", tr("datepicker.pickEnd", "再选结束日"))
            : st.value
              ? `${st.value} → ${st.value2}`
              : label(root, "pickStart", tr("datepicker.pickStart", "选起始日"))
          : st.value || "";
    }
  }

  function renderGrid(root) {
    const pop = popOf(root);
    const st = state.get(root);
    if (!pop || !st) return;
    const grid = pop.querySelector(".cin-datepicker-grid");
    const first = new Date(st.y, st.m, 1);
    const offset = (first.getDay() - weekStartOf(root) + 7) % 7;
    const startDate = addDays(first, -offset);
    st.cells = [];
    const dayLabel = fmt(root, { year: "numeric", month: "long", day: "numeric" });
    const now = today();
    const start = st.value ? parse(st.value) : null;
    const end = st.value2 ? parse(st.value2) : null;
    const preview = modeOf(root) === "range" && start && !end && st.hover ? st.hover : null;
    let html = "";
    for (let i = 0; i < 42; i += 1) {
      const d = addDays(startDate, i);
      const key = iso(d);
      st.cells.push(d);
      const outside = d.getMonth() !== st.m;
      const disabled = blocked(root, d);
      const selected = sameDay(d, start) || sameDay(d, end);
      const inRange =
        (start && end && d > start && d < end) || (start && preview && ((d > start && d < preview) || (d < start && d > preview)));
      const focused = sameDay(d, st.focus) ? ' tabindex="0"' : ' tabindex="-1"';
      html +=
        `<button class="cin-datepicker-day" type="button" role="gridcell" data-date="${key}" aria-label="${dayLabel.format(d)}"` +
        `${outside ? " data-outside" : ""}${sameDay(d, now) ? " data-today" : ""}` +
        `${selected ? ' aria-selected="true"' : ' aria-selected="false"'}` +
        `${inRange ? " data-in-range" : ""}` +
        `${sameDay(d, start) && end ? " data-range-start" : ""}${sameDay(d, end) ? " data-range-end" : ""}` +
        `${disabled ? " disabled" : ""}${focused}>${d.getDate()}</button>`;
    }
    grid.innerHTML = html;
  }

  /* 悬浮预览只改属性，不重建 DOM：重建会导致 mousedown/up 落在不同节点，点击被吞 */
  function paintRange(root) {
    const pop = popOf(root);
    const st = state.get(root);
    if (!pop || !st) return;
    const start = st.value ? parse(st.value) : null;
    const end = st.value2 ? parse(st.value2) : null;
    pop.querySelectorAll(".cin-datepicker-day").forEach((btn) => {
      const d = parse(btn.getAttribute("data-date"));
      const inRange =
        start && end
          ? d > start && d < end
          : start && st.hover
            ? (d > start && d < st.hover) || (d < start && d > st.hover)
            : false;
      if (inRange) btn.setAttribute("data-in-range", "");
      else btn.removeAttribute("data-in-range");
    });
  }

  /* ---------------- 交互 ---------------- */
  function readValue(root) {
    const st = state.get(root);
    return { value: st && st.value ? st.value : "", value2: st && st.value2 ? st.value2 : "" };
  }
  function writeFields(root) {
    const st = state.get(root);
    if (!st) return;
    const fields = fieldsOf(root);
    (fields[0] || {}).value = st.value || "";
    if (fields[1]) fields[1].value = st.value2 || "";
    if (st.value) root.setAttribute("data-value", st.value);
    else root.removeAttribute("data-value");
    if (st.value2) root.setAttribute("data-value2", st.value2);
    else root.removeAttribute("data-value2");
    fields.forEach((f) => {
      const box = f.closest(".cin-datepicker-field");
      if (box) box.removeAttribute("data-invalid");
      f.removeAttribute("aria-invalid");
    });
  }
  function markInvalid(field) {
    const box = field.closest(".cin-datepicker-field");
    if (box) box.setAttribute("data-invalid", "");
    field.setAttribute("aria-invalid", "true");
  }
  function syncFocus(root) {
    const st = state.get(root);
    if (!st) return;
    const seed = st.value ? parse(st.value) : st.value2 ? parse(st.value2) : null;
    const base = seed && seed.getFullYear() === st.y && seed.getMonth() === st.m ? seed : today();
    if (!st.focus || st.focus.getFullYear() !== st.y || st.focus.getMonth() !== st.m) st.focus = base;
  }
  function goMonth(root, delta) {
    const st = state.get(root);
    const d = addMonths(new Date(st.y, st.m, 1), delta);
    st.y = d.getFullYear();
    st.m = d.getMonth();
    st.focus = new Date(st.y, st.m, 1);
    render(root);
    focusCell(root);
  }
  function focusCell(root) {
    const pop = popOf(root);
    const st = state.get(root);
    if (!pop || !st) return;
    const target = pop.querySelector(`.cin-datepicker-day[data-date="${iso(st.focus || today())}"]`);
    if (target) target.focus({ preventScroll: true });
  }
  function position(root) {
    const pop = popOf(root);
    const toggle = toggleOf(root) || fieldsOf(root)[0];
    if (!pop || !toggle || pop.hidden) return;
    const r = toggle.getBoundingClientRect();
    const pw = pop.offsetWidth || 304;
    const ph = pop.offsetHeight || 320;
    const margin = 8;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let top = r.bottom + 6;
    if (top + ph > vh - margin) {
      const above = r.top - ph - 6;
      top = above >= margin ? above : Math.max(margin, vh - ph - margin);
    }
    let left = r.left;
    if (left + pw > vw - margin) left = Math.max(margin, vw - pw - margin);
    if (left < margin) left = margin;
    pop.style.top = `${Math.round(top)}px`;
    pop.style.left = `${Math.round(left)}px`;
  }
  function open(root) {
    if (openRoot && openRoot !== root) close(openRoot);
    const pop = buildPop(root);
    pop.hidden = false;
    const st = state.get(root);
    const seed = st.value ? parse(st.value) : null;
    const base = seed || today();
    st.y = base.getFullYear();
    st.m = base.getMonth();
    st.focus = seed || today();
    root.setAttribute("data-open", "");
    const toggle = toggleOf(root);
    if (toggle) toggle.setAttribute("aria-expanded", "true");
    render(root);
    position(root);
    openRoot = root;
    focusCell(root);
    emit(root, "cin:dateopen", readValue(root));
  }
  function close(root, silent) {
    const pop = popOf(root);
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    root.removeAttribute("data-open");
    const toggle = toggleOf(root);
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    if (openRoot === root) openRoot = null;
    if (!silent) emit(root, "cin:dateclose", readValue(root));
  }
  function commit(root, reason) {
    writeFields(root);
    render(root);
    emit(root, "cin:datechange", { ...readValue(root), reason });
  }
  function pick(root, date) {
    const st = state.get(root);
    if (blocked(root, date)) return;
    if (modeOf(root) === "range") {
      if (!st.value || st.value2) {
        st.value = iso(date);
        st.value2 = "";
        st.hover = null;
        writeFields(root);
        render(root);
        focusCell(root);
        return;
      }
      let a = parse(st.value);
      let b = date;
      if (b < a) [a, b] = [b, a];
      st.value = iso(a);
      st.value2 = iso(b);
      st.hover = null;
    } else {
      st.value = iso(date);
    }
    commit(root, "pick");
    close(root);
    const field = fieldsOf(root)[0];
    if (field) field.focus({ preventScroll: true });
  }
  function setValue(root, value, value2) {
    const st = state.get(root);
    if (!st) return null;
    const single = parse(value);
    const second = parse(value2);
    if (!single) return null;
    if (blocked(root, single) || (second && blocked(root, second))) return null;
    const mode = modeOf(root);
    if (mode === "range") {
      const end = second || single;
      const [a, b] = end < single ? [end, single] : [single, end];
      st.value = iso(a);
      st.value2 = iso(b);
    } else {
      st.value = iso(single);
      st.value2 = "";
    }
    writeFields(root);
    render(root);
    return readValue(root);
  }

  function bindPop(root, pop) {
    pop.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-nav]");
      if (nav) {
        goMonth(root, nav.getAttribute("data-nav") === "prev" ? -1 : 1);
        return;
      }
      const act = event.target.closest("[data-act]");
      if (act) {
        const st = state.get(root);
        if (act.getAttribute("data-act") === "today") {
          if (!blocked(root, today())) {
            st.y = today().getFullYear();
            st.m = today().getMonth();
            st.focus = today();
            pick(root, today());
          }
        } else {
          st.value = "";
          st.value2 = "";
          commit(root, "clear");
          close(root);
        }
        return;
      }
      const day = event.target.closest(".cin-datepicker-day");
      if (day && !day.disabled) pick(root, parse(day.getAttribute("data-date")));
    });

    pop.addEventListener("pointerover", (event) => {
      const day = event.target.closest(".cin-datepicker-day");
      const st = state.get(root);
      if (!day || !st || modeOf(root) !== "range" || !st.value || st.value2) return;
      const next = parse(day.getAttribute("data-date"));
      if (!next || (st.hover && sameDay(next, st.hover))) return;
      st.hover = next;
      paintRange(root);
    });

    pop.addEventListener("change", (event) => {
      const st = state.get(root);
      if (event.target.matches("[data-month]")) {
        st.m = Number(event.target.value);
        st.focus = new Date(st.y, st.m, 1);
        render(root);
        focusCell(root);
      } else if (event.target.matches("[data-year]")) {
        st.y = Number(event.target.value);
        st.focus = new Date(st.y, st.m, 1);
        render(root);
        focusCell(root);
      }
    });

    pop.addEventListener("keydown", (event) => {
      const st = state.get(root);
      const cell = event.target.closest(".cin-datepicker-day");
      if (!cell || !st) return;
      const current = parse(cell.getAttribute("data-date")) || st.focus || today();
      const start = weekStartOf(root);
      let next = null;
      switch (event.key) {
        case "ArrowLeft": next = addDays(current, -1); break;
        case "ArrowRight": next = addDays(current, 1); break;
        case "ArrowUp": next = addDays(current, -7); break;
        case "ArrowDown": next = addDays(current, 7); break;
        case "Home": next = addDays(current, -((current.getDay() - start + 7) % 7)); break;
        case "End": next = addDays(current, 6 - ((current.getDay() - start + 7) % 7)); break;
        case "PageUp": next = addMonths(current, event.shiftKey ? -12 : -1); break;
        case "PageDown": next = addMonths(current, event.shiftKey ? 12 : 1); break;
        case "Escape": event.preventDefault(); close(root); fieldFocus(root); return;
        case "Enter":
        case " ":
          event.preventDefault();
          pick(root, current);
          return;
        case "Tab":
          return;
        default:
          return;
      }
      event.preventDefault();
      st.focus = next;
      if (next.getMonth() !== st.m || next.getFullYear() !== st.y) {
        st.y = next.getFullYear();
        st.m = next.getMonth();
      }
      render(root);
      focusCell(root);
    });
  }

  function fieldFocus(root) {
    const field = fieldsOf(root)[0];
    if (field) field.focus({ preventScroll: true });
  }

  function bindField(root, field, index) {
    const apply = () => {
      const st = state.get(root);
      const raw = field.value.trim();
      if (!raw) {
        if (index === 0) st.value = "";
        else st.value2 = "";
        writeFields(root);
        render(root);
        return;
      }
      const d = parse(raw);
      if (!d || blocked(root, d)) {
        markInvalid(field);
        return;
      }
      if (modeOf(root) === "range") {
        const other = parse(index === 0 ? st.value2 : st.value);
        if (other) {
          const [a, b] = d < other ? [d, other] : [other, d];
          st.value = iso(a);
          st.value2 = iso(b);
        } else if (index === 0) {
          st.value = iso(d);
          st.value2 = "";
        } else {
          st.value2 = iso(d);
        }
      } else {
        st.value = iso(d);
      }
      commit(root, "type");
    };
    field.addEventListener("change", apply);
    field.addEventListener("blur", apply);
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        apply();
        close(root);
      }
      if (event.key === "ArrowDown" && event.altKey) {
        event.preventDefault();
        open(root);
      }
    });
    field.addEventListener("input", () => {
      const box = field.closest(".cin-datepicker-field");
      if (box) box.removeAttribute("data-invalid");
      field.removeAttribute("aria-invalid");
    });
  }

  function bind(root) {
    const mode = modeOf(root);
    const fields = fieldsOf(root);
    if (!fields.length) return;
    if (mode === "range" && fields.length === 2 && !root.querySelector(".cin-datepicker-range-sep")) {
      const wrap = document.createElement("span");
      wrap.className = "cin-datepicker-range-sep";
      wrap.textContent = "→";
      fields[0].closest(".cin-datepicker-field").after(wrap);
    }
    fields.forEach((field, i) => {
      field.setAttribute("autocomplete", "off");
      field.setAttribute("spellcheck", "false");
      field.setAttribute("inputmode", "numeric");
      if (!field.getAttribute("placeholder")) field.setAttribute("placeholder", "YYYY-MM-DD");
      bindField(root, field, i);
    });
    const toggle = toggleOf(root);
    if (toggle) toggle.addEventListener("click", () => (popOf(root) && !popOf(root).hidden ? close(root) : open(root)));

    const initial = parse(root.getAttribute("data-value")) || (fields[0].value ? parse(fields[0].value) : null);
    const initial2 = parse(root.getAttribute("data-value2")) || (fields[1] && fields[1].value ? parse(fields[1].value) : null);
    const seed = initial || today();
    state.set(root, {
      y: seed.getFullYear(),
      m: seed.getMonth(),
      focus: initial || today(),
      value: initial ? iso(initial) : "",
      value2: initial2 ? iso(initial2) : "",
      hover: null,
      cells: [],
    });
    buildPop(root);
    writeFields(root);
    root.setAttribute("data-ready", "");
  }

  /* ---------------- 全局监听 ---------------- */
  document.addEventListener(
    "click",
    (event) => {
      if (!openRoot) return;
      if (openRoot.contains(event.target)) return;
      close(openRoot);
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && openRoot) {
        event.preventDefault();
        const root = openRoot;
        close(root);
        fieldFocus(root);
      }
    },
    true,
  );
  const reposition = () => openRoot && position(openRoot);
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);

  function initDatePickers(scope = document) {
    let count = 0;
    scope.querySelectorAll("[data-datepicker]").forEach((root) => {
      if (root.hasAttribute("data-ready")) return;
      bind(root);
      count += 1;
    });
    return count;
  }
  function setDatePicker(target, value, value2) {
    const root = target && target.closest ? target.closest("[data-datepicker]") : null;
    if (!root) return null;
    if (!root.hasAttribute("data-ready")) bind(root);
    const next = setValue(root, value, value2);
    if (next) emit(root, "cin:datechange", { ...next, reason: "api" });
    return next;
  }

  C.initDatePickers = initDatePickers;
  C.setDatePicker = setDatePicker;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initDatePickers());
  else initDatePickers();
})();


/* ---- diffview.js ---- */
/* diffview.js · 差异视图（换行开关 + 行导航 + 行选中 + 空态）
   结构：<div class="cin-diff" data-wrap="on">
          <div class="cin-diff-line" data-kind="hunk"><span class="cin-diff-num"></span><span class="cin-diff-num"></span><span class="cin-diff-marker">@@</span><span class="cin-diff-text">-1,3 +1,3 @@</span></div>
          <div class="cin-diff-line" data-kind="add">…</div>
        </div>
   data-kind ∈ add | del | hunk | same；data-wrap="off" 关闭自动换行。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;
  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  function init(root, opts) {
    if (root.dataset.cinReady) return;
    root.dataset.cinReady = "1";
    const o = Object.assign({ wrap: "on" }, opts || {});
    const lines = Array.from(root.querySelectorAll(".cin-diff-line"));
    if (!root.hasAttribute("data-wrap")) root.setAttribute("data-wrap", o.wrap);

    if (!lines.length) {
      root.setAttribute("data-cin-status", "empty");
      return;
    }
    lines.forEach((line, i) => {
      line.setAttribute("tabindex", i === 0 ? "0" : "-1");
      if (!line.hasAttribute("role")) line.setAttribute("role", "listitem");
    });
    root.setAttribute("role", root.getAttribute("role") || "list");

    const focusAt = (i) => {
      const n = lines[Math.max(0, Math.min(i, lines.length - 1))];
      lines.forEach((l) => l.setAttribute("tabindex", "-1"));
      n.setAttribute("tabindex", "0");
      n.focus();
      n.scrollIntoView({ block: "nearest" });
    };

    root.addEventListener("keydown", (e) => {
      const i = lines.indexOf(document.activeElement);
      if (i < 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        focusAt(i + (e.key === "ArrowDown" ? 1 : -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        lines.forEach((l) => l.removeAttribute("data-active"));
        lines[i].setAttribute("data-active", "");
        emit(root, "cin:diff-select", { index: i, kind: lines[i].dataset.kind || "same" });
      }
    });

    root.addEventListener("click", (e) => {
      const toggle = e.target.closest("[data-action=toggle-wrap]");
      if (toggle) {
        const next = root.getAttribute("data-wrap") === "off" ? "on" : "off";
        root.setAttribute("data-wrap", next);
        toggle.textContent = next === "off" ? tr("diffview.enableWrap", "换行开") : tr("diffview.disableWrap", "换行关");
        toggle.setAttribute("aria-pressed", String(next === "off"));
        emit(root, "cin:diff-wrap", { wrap: next });
        return;
      }
      const line = e.target.closest(".cin-diff-line");
      if (!line) return;
      lines.forEach((l) => l.removeAttribute("data-active"));
      line.setAttribute("data-active", "");
      emit(root, "cin:diff-select", { index: lines.indexOf(line), kind: line.dataset.kind || "same" });
    });
  }

  C.diffView = { init, initAll: (s = document, o) => s.querySelectorAll(".cin-diff").forEach((el) => init(el, o)) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => C.diffView.initAll());
  else C.diffView.initAll();
})();


/* ---- disclosure.js ---- */
/* Cinder 折叠面板行为层：details/summary 渐进增强
   约定：无 JS 时原生 details 仍可展开收起；JS 只负责互斥、高度动画、aria 同步与方向键漫游，
   不接管业务 DOM，状态变化通过 cin:accordiontoggle 外抛。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  let seq = 0;

  const emit = (el, type, detail = {}) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function baseDuration() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--cin-motion-base-duration");
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 200;
  }

  const triggerOf = (item) => item.querySelector(":scope > summary, :scope > .cin-accordion-trigger");
  const panelOf = (item) => item.querySelector(":scope > .cin-accordion-panel");

  function sync(item) {
    const trigger = triggerOf(item);
    const panel = panelOf(item);
    if (trigger) {
      trigger.setAttribute("aria-expanded", String(!!item.open));
      if (!item.hasAttribute("data-disabled")) trigger.removeAttribute("aria-disabled");
      else trigger.setAttribute("aria-disabled", "true");
    }
    if (!panel) return;
    if (!panel.id) panel.id = `cin-accordion-panel-${++seq}`;
    panel.setAttribute("role", "region");
    if (trigger) {
      if (!trigger.id) trigger.id = `cin-accordion-trigger-${panel.id.replace("cin-accordion-panel-", "cin-accordion-")}`;
      trigger.setAttribute("aria-controls", panel.id);
      panel.setAttribute("aria-labelledby", trigger.id);
    }
  }

  function clearSize(panel) {
    if (!panel) return;
    panel.style.blockSize = "";
    panel._cinTimer && clearTimeout(panel._cinTimer);
    panel._cinTimer = null;
    // 取消动画时必须同时摘掉 transitionend，否则旧回调会在下一次过渡结束时补刀
    if (panel._cinEnd) {
      panel.removeEventListener("transitionend", panel._cinEnd);
      panel._cinEnd = null;
    }
  }

  function animate(panel, from, to, done) {
    if (!panel) return done && done();
    if (reduced() || from === to) {
      clearSize(panel);
      return done && done();
    }
    panel.style.blockSize = `${from}px`;
    panel.getBoundingClientRect(); // 强制回流，保证起点高度生效
    panel.style.blockSize = `${to}px`;
    const finish = () => {
      if (panel._cinTimer) clearTimeout(panel._cinTimer);
      panel._cinTimer = null;
      panel.removeEventListener("transitionend", onEnd);
      panel._cinEnd = null;
      clearSize(panel);
      done && done();
    };
    const onEnd = (e) => {
      if (e.target === panel && e.propertyName === "block-size") finish();
    };
    panel._cinEnd = onEnd;
    panel.addEventListener("transitionend", onEnd);
    // 兜底：动画被合成层或隐藏容器吞掉时仍要收敛状态
    panel._cinTimer = setTimeout(finish, baseDuration() + 80);
  }

  /**
   * 同步强制关闭：状态先落地，动画直接取消。
   * 单开互斥必须走这条路：若沿用「等收起动画结束再落 open」，快速连点时
   * 前一项的关闭会被后一项的展开覆盖，出现两条同开（KN-001）。
   */
  function closeNow(item, source = "single") {
    const panel = panelOf(item);
    const wasOpen = item.open;
    item._cinClosing = false;
    clearSize(panel);
    item.open = false;
    sync(item);
    if (wasOpen) emit(item, "cin:accordiontoggle", { open: false, source });
  }

  function setOpen(item, want, source = "api") {
    if (!item || !item.matches(".cin-accordion-item")) return;
    want = !!want;
    if (item.hasAttribute("data-disabled") && want) return;

    const panel = panelOf(item);

    // 收起动画进行中又被要求打开：接管关闭流程，回到展开态，不叠加两层动画
    if (want && item._cinClosing) {
      item._cinClosing = false;
      clearSize(panel);
      item.open = true;
      sync(item);
      if (panel) {
        const height = panel.scrollHeight;
        animate(panel, 0, height);
      }
      emit(item, "cin:accordiontoggle", { open: true, source });
      return;
    }

    if (want === item.open) return;

    const group = item.closest(".cin-accordion");

    if (want) {
      if (group && group.hasAttribute("data-single")) {
        Array.from(group.children).forEach((other) => {
          if (other !== item && other.matches(".cin-accordion-item") && (other.open || other._cinClosing)) {
            closeNow(other, "single");
          }
        });
      }
      item.open = true;
      sync(item);
      if (panel) {
        const height = panel.scrollHeight;
        animate(panel, 0, height);
      }
      emit(item, "cin:accordiontoggle", { open: true, source });
    } else {
      emit(item, "cin:accordiontoggle", { open: false, source });
      if (!panel) {
        item.open = false;
        sync(item);
        return;
      }
      const height = panel.getBoundingClientRect().height;
      item._cinClosing = true;
      animate(panel, height, 0, () => {
        item._cinClosing = false;
        item.open = false;
        sync(item);
      });
    }
  }

  function moveFocus(trigger, step) {
    // 只在同一组内漫游；嵌套面板取最近一层，方向键不会跳到外层
    const group = trigger.closest(".cin-accordion");
    const items = group
      ? Array.from(group.querySelectorAll(":scope > .cin-accordion-item"))
      : Array.from(document.querySelectorAll(".cin-accordion-item"));
    const triggers = items
      .filter((el) => !el.hasAttribute("data-disabled"))
      .map((el) => triggerOf(el))
      .filter((el) => el && el.getClientRects().length > 0);
    const index = triggers.indexOf(trigger);
    if (index < 0 || !triggers.length) return;
    const next = step === "home" ? 0 : step === "end" ? triggers.length - 1 : (index + step + triggers.length) % triggers.length;
    triggers[next].focus({ preventScroll: false });
  }

  function bind(item) {
    if (item._cinDisclosure) return;
    item._cinDisclosure = true;
    const trigger = triggerOf(item);
    sync(item);
    if (!trigger) return;

    trigger.addEventListener("click", (e) => {
      // 触发器内的链接与按钮保持原生行为，避免把导航当折叠
      if (e.target.closest("a[href], button, input, select, textarea")) return;
      e.preventDefault();
      // 收起动画进行中被再次点击，视为「取消收起」，不能因为 open 仍为 true 而变成再次收起
      setOpen(item, item._cinClosing ? true : !item.open, "user");
    });

    trigger.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(trigger, 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(trigger, -1); }
      else if (e.key === "Home") { e.preventDefault(); moveFocus(trigger, "home"); }
      else if (e.key === "End") { e.preventDefault(); moveFocus(trigger, "end"); }
    });

    // 直接改 open 或外部触发 Ctrl+F 展开时，同步 aria 与高度
    item.addEventListener("toggle", () => {
      sync(item);
      const panel = panelOf(item);
      if (panel && !panel.style.blockSize) clearSize(panel);
    });
  }

  function init(root = document) {
    if (!root || !root.querySelectorAll) return;
    const scope = root.querySelectorAll ? root : document;
    if (scope.matches && scope.matches(".cin-accordion-item")) bind(scope);
    scope.querySelectorAll(".cin-accordion-item").forEach(bind);
    scope.querySelectorAll(".cin-accordion").forEach((group) => group.setAttribute("data-enhanced", ""));
  }

  C.initAccordions = init;
  C.setAccordion = (item, open) => setOpen(item, open, "api");

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => init());
  else init();
})();


/* ---- fileinput.js ---- */
/* 文件选择：拖拽、校验、预览与列表渲染。
   依赖结构：.cin-dropzone（内含 input[type=file]）+ 由 data-filelist 指向的 <ul>。
   上传本身由业务层完成，本行为只负责“选中之后”的本地呈现与事件外抛。 */
(function () {
  "use strict";

  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;
  const bound = new WeakSet();
  const IMAGE = /^image\//;

  function formatSize(bytes) {
    if (!Number.isFinite(bytes)) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  function extensionOf(name) {
    const i = name.lastIndexOf(".");
    return i > -1 ? name.slice(i + 1).toLowerCase() : "";
  }

  function matchesAccept(file, accept) {
    if (!accept) return true;
    const rules = accept
      .split(",")
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean);
    if (!rules.length) return true;
    const name = file.name.toLowerCase();
    const type = (file.type || "").toLowerCase();
    return rules.some((rule) => {
      if (rule.startsWith(".")) return name.endsWith(rule);
      if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
      return type === rule;
    });
  }

  function listFor(zone) {
    const ref = zone.getAttribute("data-filelist");
    if (!ref) return null;
    return ref.startsWith("#") ? document.getElementById(ref.slice(1)) : document.querySelector(ref);
  }

  function ensureList(zone) {
    if (zone._cin.list && zone._cin.list.isConnected) return zone._cin.list;
    let list = listFor(zone);
    if (!list) {
      list = document.createElement("ul");
      list.className = "cin-filelist";
      const target = zone.parentElement || zone;
      target.insertBefore(list, zone.nextSibling);
    }
    zone._cin.list = list;
    return list;
  }

  function bindList(zone) {
    const list = ensureList(zone);
    list._cinZone = zone;
    if (list._cinBound) return list;
    list._cinBound = true;
    list.addEventListener("click", (e) => {
      const remove = e.target.closest(".cin-fileitem-remove");
      if (!remove) return;
      e.preventDefault();
      removeItem(list._cinZone || zone, remove.closest(".cin-fileitem"), true);
    });
    return list;
  }

  function setError(zone, message) {
    const holder = zone._cin.error || (zone._cin.error = document.createElement("p"));
    holder.className = "cin-file-error";
    holder.setAttribute("role", "alert");
    holder.textContent = message;
    if (!holder.isConnected) {
      const anchor = listFor(zone) || zone;
      anchor.parentElement ? anchor.parentElement.insertBefore(holder, anchor.nextSibling) : zone.insertAdjacentElement("afterend", holder);
    }
    zone.dataset.status = "error";
  }

  function clearError(zone) {
    delete zone.dataset.status;
    if (zone._cin.error && zone._cin.error.isConnected) zone._cin.error.remove();
  }

  function thumbFor(file) {
    if (IMAGE.test(file.type || "")) {
      const url = URL.createObjectURL(file);
      const img = document.createElement("img");
      img.className = "cin-filethumb";
      img.alt = "";
      img.src = url;
      img.loading = "lazy";
      return { node: img, url };
    }
    const span = document.createElement("span");
    span.className = "cin-filethumb";
    span.setAttribute("aria-hidden", "true");
    span.textContent = (extensionOf(file.name) || "file").slice(0, 4);
    return { node: span, url: "" };
  }

  function renderItem(zone, file, status, meta) {
    const list = bindList(zone);
    const li = document.createElement("li");
    li.className = "cin-fileitem";
    li.dataset.status = status;
    const { node: thumb, url } = thumbFor(file);

    const main = document.createElement("div");
    main.className = "cin-fileitem-main";
    const name = document.createElement("span");
    name.className = "cin-fileitem-name";
    name.textContent = file.name;
    const info = document.createElement("span");
    info.className = "cin-fileitem-meta";
    info.textContent = meta || formatSize(file.size);
    const bar = document.createElement("div");
    bar.className = "cin-fileprogress";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", status === "done" ? "100" : "0");
    bar.innerHTML = "<span></span>";
    main.append(name, info, bar);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "cin-fileitem-remove";
    remove.setAttribute("aria-label", tr("fileinput.remove", "移除 {name}", { name: file.name }));
    remove.textContent = "×";

    li.append(thumb, main, remove);
    list.append(li);
    li._cin = { file, url };
    return li;
  }

  function removeItem(zone, li, notify) {
    const data = li._cin || {};
    if (data.url) URL.revokeObjectURL(data.url);
    if (data.file) {
      const i = zone._cin.files.indexOf(data.file);
      if (i > -1) zone._cin.files.splice(i, 1);
    }
    li.remove();
    if (notify) {
      zone.dispatchEvent(
        new CustomEvent("cin:fileremove", {
          bubbles: true,
          detail: { file: data.file || null, name: data.file ? data.file.name : "" },
        })
      );
    }
  }

  function addFiles(zone, fileList, source) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    clearError(zone);

    const cfg = zone._cin;
    const accept = cfg.input ? cfg.input.accept || zone.getAttribute("data-accept") || "" : zone.getAttribute("data-accept") || "";
    const maxMb = parseFloat(zone.getAttribute("data-max-size"));
    const maxFiles = parseInt(zone.getAttribute("data-max-files"), 10);
    const accepted = [];
    const rejected = [];

    for (const file of files) {
      if (!matchesAccept(file, accept)) {
        rejected.push({ file, reason: tr("fileinput.rejectType", "不支持的类型") });
      } else if (Number.isFinite(maxMb) && file.size > maxMb * 1024 * 1024) {
        rejected.push({ file, reason: tr("fileinput.rejectSize", "超过 {n} MB", { n: maxMb }) });
      } else if (Number.isFinite(maxFiles) && cfg.files.length + accepted.length >= maxFiles) {
        rejected.push({ file, reason: tr("fileinput.rejectCount", "最多 {n} 个文件", { n: maxFiles }) });
      } else {
        accepted.push(file);
      }
    }

    for (const file of accepted) {
      cfg.files.push(file);
      renderItem(zone, file, zone.getAttribute("data-auto-done") === "false" ? "uploading" : "done");
    }
    for (const item of rejected) renderItem(zone, item.file, "error", item.reason);

    if (rejected.length) {
      const head = rejected[0];
      setError(
        zone,
        rejected.length === 1
          ? tr("fileinput.rejectOne", "“{name}”{reason}", { name: head.file.name, reason: head.reason })
          : tr("fileinput.rejectMany", "{count} 个文件未通过校验：“{name}”{reason}", { count: rejected.length, name: head.file.name, reason: head.reason })
      );
    }

    if (accepted.length || rejected.length) {
      zone.dispatchEvent(
        new CustomEvent("cin:files", {
          bubbles: true,
          detail: {
            files: cfg.files.slice(),
            accepted,
            rejected: rejected.map((r) => ({ name: r.file.name, reason: r.reason })),
            source: source || "picker",
          },
        })
      );
    }
  }

  function bind(zone) {
    if (bound.has(zone) || zone.hasAttribute("data-disabled")) return;
    bound.add(zone);

    const input = zone.querySelector('input[type="file"]');
    zone._cin = { files: [], input, list: null, error: null };
    if (input) zone._cin.list = listFor(zone);
    if (zone._cin.list) bindList(zone);

    if (input) {
      input.addEventListener("change", () => {
        addFiles(zone, input.files, "picker");
        input.value = "";
      });
    }

    let depth = 0;
    zone.addEventListener("dragenter", (e) => {
      if (!input || zone.hasAttribute("data-disabled")) return;
      e.preventDefault();
      depth += 1;
      zone.setAttribute("data-dragover", "");
    });
    zone.addEventListener("dragover", (e) => {
      if (!input || zone.hasAttribute("data-disabled")) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });
    zone.addEventListener("dragleave", (e) => {
      if (e.relatedTarget && zone.contains(e.relatedTarget)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) zone.removeAttribute("data-dragover");
    });
    zone.addEventListener("drop", (e) => {
      if (!input || zone.hasAttribute("data-disabled")) return;
      e.preventDefault();
      depth = 0;
      zone.removeAttribute("data-dragover");
      if (e.dataTransfer && e.dataTransfer.files) addFiles(zone, e.dataTransfer.files, "drop");
    });

    zone.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target === zone) {
        e.preventDefault();
        input && input.click();
      }
    });
  }

  function initFileInputs(root) {
    (root || document).querySelectorAll(".cin-dropzone").forEach(bind);
  }

  function setFileProgress(target, percent, status) {
    const item = target && target.closest ? target.closest(".cin-fileitem") : null;
    if (!item) return false;
    const pct = Math.max(0, Math.min(100, Number(percent) || 0));
    const bar = item.querySelector(".cin-fileprogress");
    const fill = bar && bar.firstElementChild;
    if (fill) fill.style.inlineSize = pct + "%";
    if (bar) bar.setAttribute("aria-valuenow", String(Math.round(pct)));
    item.dataset.status = status || (pct >= 100 ? "done" : "uploading");
    return true;
  }

  C.initFileInputs = initFileInputs;
  C.setFileProgress = setFileProgress;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initFileInputs(document));
  } else {
    initFileInputs(document);
  }
})();


/* ---- format.js ---- */
/* format.js 约定：把「格式化」这件事收敛到四个纯函数 + 一个自动刷新器。
   - 纯函数不碰 DOM，可单独在模板里调用；
   - 时间展示统一读 <time datetime>，脚本只写可见文案与 title，不改语义；
   - 相对时间每分钟自刷一次，元素被移除即自动退订，不需要手动销毁。
   结构：
     <time class="cin-time" datetime="2026-11-01T09:12:00+08:00" data-format="relative">—</time> */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;

  const localeOf = (opt) => opt || document.documentElement.lang || navigator.language || "zh-CN";
  const isZh = (locale) => /^zh/i.test(locale);
  /* 按显式 locale 取词（组件可能传入与当前语言不同的 locale）。 */
  const tIn = (locale, k, f, v) => (C.Primitives && C.Primitives.i18n ? C.Primitives.i18n.tIn(locale, k, f, v) : (v ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m)) : f));

  const toDate = (value) => {
    if (value instanceof Date) return value;
    if (typeof value === "number") return new Date(value);
    if (typeof value === "string" && value.trim()) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return null;
  };

  /* ---------------- 数字 ---------------- */
  function formatNumber(value, opt = {}) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "—";
    const locale = localeOf(opt.locale);
    const opts = {
      minimumFractionDigits: opt.digits ?? 0,
      maximumFractionDigits: opt.digits ?? 2,
    };
    if (opt.style === "currency" && opt.currency) {
      opts.style = "currency";
      opts.currency = opt.currency;
    } else if (opt.style === "percent") {
      opts.style = "percent";
    }
    try {
      return new Intl.NumberFormat(locale, opts).format(num);
    } catch {
      return String(num);
    }
  }

  /* ---------------- 字节 ---------------- */
  const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];
  function formatBytes(bytes, opt = {}) {
    const num = Number(bytes);
    if (!Number.isFinite(num)) return "—";
    const base = opt.binary ? 1024 : 1000;
    let i = 0;
    let v = Math.abs(num);
    while (v >= base && i < BYTE_UNITS.length - 1) {
      v /= base;
      i += 1;
    }
    const digits = opt.digits ?? (i === 0 ? 0 : 1);
    const text = new Intl.NumberFormat(localeOf(opt.locale), {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(v);
    return `${num < 0 ? "-" : ""}${text} ${BYTE_UNITS[i]}`;
  }

  /* ---------------- 日期 ---------------- */
  function formatDate(value, opt = {}) {
    const d = toDate(value);
    if (!d) return "—";
    const locale = localeOf(opt.locale);
    const style = opt.format || "date";
    const pad = (n) => String(n).padStart(2, "0");
    if (style === "iso") return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (style === "time") {
      return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
    }
    if (style === "datetime") {
      return new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d);
    }
    if (style === "month") {
      return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit" }).format(d);
    }
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  }

  /* ---------------- 相对时间 ---------------- */
  function relativeTime(value, opt = {}) {
    const d = toDate(value);
    if (!d) return "—";
    const locale = localeOf(opt.locale);
    const base = opt.base === undefined ? Date.now() : new Date(opt.base).getTime();
    const diff = (d.getTime() - base) / 1000;
    const abs = Math.abs(diff);
    if (abs < 45) return tIn(locale, "format.justNow", isZh(locale) ? "刚刚" : "just now");

    const units = [
      ["year", 365 * 24 * 3600],
      ["month", 30 * 24 * 3600],
      ["day", 24 * 3600],
      ["hour", 3600],
      ["minute", 60],
    ];
    for (const [unit, sec] of units) {
      if (abs >= sec || unit === "minute") {
        const amount = Math.round(diff / sec);
        try {
          return new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "long" }).format(amount, unit);
        } catch {
          const value = `${Math.abs(amount)} ${unit}`;
          return diff < 0
            ? tIn(locale, "format.ago", "{value} 前", { value })
            : tIn(locale, "format.later", "{value} 后", { value });
        }
      }
    }
    return "—";
  }

  /* ---------------- 时间标签自动刷新 ---------------- */
  const registry = new Set();
  let ticker = null;

  function paint(el) {
    const raw = el.getAttribute("datetime") || el.getAttribute("data-time");
    const d = toDate(raw);
    if (!d) return;
    const format = el.getAttribute("data-format") || "relative";
    const locale = el.getAttribute("data-locale") || undefined;
    const abs = formatDate(d, { locale, format: el.getAttribute("data-abs-format") || "datetime" });

    if (format === "absolute") {
      el.textContent = abs;
    } else if (format === "both") {
      const rel = relativeTime(d, { locale });
      el.innerHTML = "";
      const strong = document.createElement("span");
      strong.className = "cin-time-rel";
      strong.textContent = rel;
      const sep = document.createElement("span");
      sep.className = "cin-time-dot";
      sep.setAttribute("aria-hidden", "true");
      const rest = document.createElement("span");
      rest.className = "cin-time-abs";
      rest.textContent = abs;
      el.append(strong, sep, rest);
    } else {
      el.textContent = relativeTime(d, { locale });
    }

    if (!el.hasAttribute("title")) el.setAttribute("title", abs);
    const delta = d.getTime() - Date.now();
    el.toggleAttribute("data-fresh", Math.abs(delta) < 48 * 3600 * 1000);
    el.toggleAttribute("data-future", delta > 0);
    el.toggleAttribute("data-due", delta > 0 && delta < 24 * 3600 * 1000);
    el.setAttribute("data-known-date", "");
  }

  function tick() {
    for (const el of registry) {
      if (!el.isConnected) {
        registry.delete(el);
        continue;
      }
      paint(el);
    }
    if (!registry.size && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  function initKnownDates(scope = document) {
    const list = [];
    if (scope && scope.matches && scope.matches("[data-knowndate], time.cin-time")) list.push(scope);
    if (scope && scope.querySelectorAll) list.push(...scope.querySelectorAll("[data-knowndate], time.cin-time"));
    list.forEach((el) => {
      registry.add(el);
      paint(el);
    });
    if (registry.size && !ticker) ticker = setInterval(tick, 60000);
    return list.length;
  }

  C.formatNumber = formatNumber;
  C.formatBytes = formatBytes;
  C.formatDate = formatDate;
  C.relativeTime = relativeTime;
  C.initKnownDates = initKnownDates;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initKnownDates(), { once: true });
  } else {
    initKnownDates();
  }
})();


/* ---- glass-dock.js ---- */
/* glass-dock.js · 玻璃 Dock 的可选吸附增强（不跑时 scroll-snap 静态完全可用） */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const reduce = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const near = (dock) => {
    const mid = dock.scrollLeft + dock.clientWidth / 2;
    let best = null;
    let gap = Infinity;
    for (const item of dock.children) {
      const center = item.offsetLeft + item.offsetWidth / 2;
      const d = Math.abs(center - mid);
      if (d < gap) {
        gap = d;
        best = item;
      }
    }
    return best;
  };
  const snap = (dock, item) => {
    if (!item) return;
    dock.scrollTo({
      left: item.offsetLeft - (dock.clientWidth - item.offsetWidth) / 2,
      behavior: reduce() ? "auto" : "smooth",
    });
  };
  function init(dock) {
    if (!dock || dock.dataset.cinGlassDock === "1") return;
    dock.dataset.cinGlassDock = "1";
    dock.addEventListener("wheel", (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      dock.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
    dock.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const items = [...dock.children];
      const i = items.indexOf(document.activeElement);
      const next = items[i + (e.key === "ArrowRight" ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      next.focus({ preventScroll: true });
      snap(dock, next);
    });
    dock.addEventListener("scrollend", () => snap(dock, near(dock)), { passive: true });
  }
  C.glassDock = {
    init,
    initAll: (s = document) => s.querySelectorAll("[data-glass-dock], .cin-glass-dock").forEach(init),
  };
  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", () => C.glassDock.initAll())
    : C.glassDock.initAll();
})();


/* ---- guard.js ---- */
/* guard.js · 确认闸门三件套（T34：hold/slide/cooldown，≤120 行）；无 JS 降级为普通按钮 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const HOLD_MS = 900, SLIDE_PASS = 92, COOLDOWN_MS = 4000;
  const clamp = (v) => Math.max(0, Math.min(100, v));
  const setP = (el, v) => el.style.setProperty("--cin-guard-progress", clamp(v).toFixed(1) + "%");
  const readP = (el) => parseFloat(el.style.getPropertyValue("--cin-guard-progress")) || 0;
  const busy = (el) => el.disabled || el.getAttribute("aria-disabled") === "true" || el.dataset.guardState === "cooling";
  const fire = (el) => {
    el.dataset.guardState = "done";
    el.dispatchEvent(new CustomEvent("cin:guard", { bubbles: true, detail: { guard: el.dataset.guard } }));
    el.click();
    setTimeout(() => { if (el.dataset.guardState === "done") delete el.dataset.guardState; }, 320);
  };
  const abort = (el) => {
    el.dataset.guardState = "aborted";
    el.dataset.guardMsg = el.dataset.guardMsg || "";
    setP(el, 0);
    setTimeout(() => { if (el.dataset.guardState === "aborted") (delete el.dataset.guardState, delete el.dataset.guardMsg); }, 640);
  };
  function hold(el) {
    let raf = 0, t0 = 0;
    const tick = () => {
      const p = ((performance.now() - t0) / HOLD_MS) * 100;
      setP(el, p);
      if (p >= 100) { raf = 0; fire(el); return; }
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (busy(el)) return;
      delete el.dataset.guardState;
      t0 = performance.now();
      setP(el, 0);
      raf = requestAnimationFrame(tick);
    };
    const end = () => {
      const running = raf;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (running && readP(el) < 99) abort(el);
      else setP(el, 0);
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      start();
    });
    ["pointerup", "pointercancel", "blur"].forEach((t) => el.addEventListener(t, end));
    el.addEventListener("keydown", (e) => { if (e.code === "Space" && !e.repeat) { e.preventDefault(); start(); } });
    el.addEventListener("keyup", (e) => { if (e.code === "Space") { e.preventDefault(); end(); } });
  }
  function slide(el) {
    let startX = 0, width = 1, dragging = false;
    const apply = (px) => { const p = clamp((px / Math.max(1, width - 24)) * 100); setP(el, p); return p; };
    el.addEventListener("pointerdown", (e) => {
      if (busy(el)) return;
      dragging = true;
      width = el.getBoundingClientRect().width;
      startX = e.clientX;
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      setP(el, 0);
    });
    el.addEventListener("pointermove", (e) => { if (dragging) apply(e.clientX - startX); });
    el.addEventListener("pointerup", (e) => {
      if (!dragging) return;
      dragging = false;
      const p = apply(e.clientX - startX);
      p >= SLIDE_PASS ? fire(el) : abort(el);
    });
    el.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 8 : e.key === "ArrowLeft" ? -8 : 0;
      if (!step || busy(el)) return;
      e.preventDefault();
      const p = clamp(readP(el) + step);
      setP(el, p);
      if (p >= 100) fire(el);
    });
    el.addEventListener("blur", () => { if (readP(el) > 0 && readP(el) < 100) abort(el); });
  }
  function cooldown(el) {
    const base = el.getAttribute("aria-label") || (el.textContent || "").trim();
    let timer = 0;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = 0;
      delete el.dataset.guardState;
      el.removeAttribute("aria-busy");
      el.setAttribute("aria-label", base);
      setP(el, 0);
    };
    el.addEventListener("click", () => {
      if (el.dataset.guardState === "cooling") return;
      el.dataset.guardState = "cooling";
      el.setAttribute("aria-busy", "true");
      const t0 = performance.now();
      const label = () => {
        const left = Math.max(0, COOLDOWN_MS - (performance.now() - t0));
        setP(el, (left / COOLDOWN_MS) * 100);
        el.setAttribute("aria-label", base + " " + (el.dataset.guardLabel || "{n}s").replace("{n}", Math.ceil(left / 1000)));
        if (left <= 0) stop();
      };
      label();
      timer = setInterval(label, 200);
    });
  }
  const MAP = { hold, slide, cooldown };
  function init(root) {
    if (!root || root.dataset.cinGuard) return;
    const kind = root.dataset.guard;
    if (!MAP[kind]) return;
    MAP[kind](root);
    root.dataset.cinGuard = "1";
  }
  function destroy(root) { (root ? [root] : [...document.querySelectorAll("[data-cin-guard]")]).forEach((el) => delete el.dataset.cinGuard); }
  C.guard = { init, initAll: (s = document) => s.querySelectorAll("[data-guard]").forEach(init), destroy };
  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", () => C.guard.initAll())
    : C.guard.initAll();
})();


/* ---- heatmap.js ---- */
/* heatmap.js · 热力图（强度分档 + 键盘遍历 + 可读标签）
   结构：<div class="cin-heatmap" data-max="12">
          <div class="cin-heatmap-grid"> <span class="cin-heatmap-cell" data-value="3" data-label="11-01 · 3 次"></span> </div>
        </div>
   网格为 7 行纵向流（grid-auto-flow: column），上下移动 = ±1，左右移动 = ±7。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  function init(root, opts) {
    if (root.dataset.cinReady) return;
    root.dataset.cinReady = "1";
    const o = Object.assign({ rows: 7, levels: 5 }, opts || {});
    const grid = root.querySelector(".cin-heatmap-grid");
    if (!grid) return;
    const rows = Number(root.dataset.rows) || o.rows;
    const levels = Number(root.dataset.levels) || o.levels;
    const cells = Array.from(grid.querySelectorAll(".cin-heatmap-cell"));

    if (!cells.length) {
      root.setAttribute("data-cin-status", "empty");
      return;
    }
    const max = Number(root.dataset.max) || 0;
    cells.forEach((cell) => {
      cell.setAttribute("tabindex", cell.hasAttribute("tabindex") ? cell.getAttribute("tabindex") : "-1");
      cell.setAttribute("role", "img");
      if (cell.dataset.label) cell.setAttribute("aria-label", cell.dataset.label);
      if (max > 0 && cell.dataset.value != null) {
        const ratio = Math.min(1, Math.max(0, Number(cell.dataset.value) / max));
        cell.setAttribute("data-level", String(Math.min(levels - 1, Math.ceil(ratio * (levels - 1)))));
      }
      if (!cell.hasAttribute("data-level")) cell.setAttribute("data-level", "0");
      cell.addEventListener("click", () => {
        grid.querySelectorAll('[data-active]').forEach((n) => n.removeAttribute("data-active"));
        cell.setAttribute("data-active", "");
        emit(root, "cin:heatmap-select", { label: cell.dataset.label || "", value: cell.dataset.value || "0" });
      });
    });
    if (cells[0]) cells[0].setAttribute("tabindex", "0");

    grid.addEventListener("keydown", (e) => {
      const i = cells.indexOf(document.activeElement);
      if (i < 0) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cells[i].click(); return; }
      const step = { ArrowDown: 1, ArrowUp: -1, ArrowRight: rows, ArrowLeft: -rows }[e.key];
      if (!step) return;
      const n = cells[i + step];
      if (!n) return;
      e.preventDefault();
      cells[i].setAttribute("tabindex", "-1");
      n.setAttribute("tabindex", "0");
      n.focus();
    });
  }

  C.heatmap = { init, initAll: (s = document, o) => s.querySelectorAll(".cin-heatmap").forEach((el) => init(el, o)) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => C.heatmap.initAll());
  else C.heatmap.initAll();
})();


/* ---- icon-morph.js ---- */
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


/* ---- inlineedit.js ---- */
/* inlineedit.js · 行内编辑（保存/取消/失焦策略 + 失败回滚）
   <div class="cin-inline-edit" data-state="idle">
     <span class="cin-inline-edit-value">标题</span>
     <input class="cin-inline-edit-input">
   </div>
   commit 返回 Promise：saving → idle | error（error 回滚原值）。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  function init(root, opts) {
    if (root.dataset.cinReady) return;
    root.dataset.cinReady = "1";
    const o = Object.assign({ blur: "save" }, opts || {});
    const view = root.querySelector(".cin-inline-edit-value");
    const input = root.querySelector(".cin-inline-edit-input");
    if (!view || !input) return;
    if (!root.hasAttribute("data-state")) root.setAttribute("data-state", "idle");
    let original = view.textContent;

    const start = () => {
      if (root.getAttribute("data-state") !== "idle") return;
      input.value = original;
      root.setAttribute("data-state", "editing");
      input.focus();
      input.select();
      emit(root, "cin:edit-start", { value: original });
    };
    const cancel = () => {
      input.value = original;
      root.setAttribute("data-state", "idle");
      view.focus();
      emit(root, "cin:edit-cancel", {});
    };
    const save = () => {
      const next = input.value;
      if (next === original) { root.setAttribute("data-state", "idle"); return; }
      root.setAttribute("data-state", "saving");
      const commit = typeof o.commit === "function" ? o.commit(next, original, root) : Promise.resolve();
      Promise.resolve(commit).then(
        () => {
          if (root.getAttribute("data-state") === "idle") return;
          original = next;
          view.textContent = next;
          root.setAttribute("data-state", "idle");
          emit(root, "cin:edit-save", { value: next });
        },
        (err) => {
          input.value = original;
          root.setAttribute("data-state", "error");
          emit(root, "cin:edit-error", { error: err });
        }
      );
    };

    view.setAttribute("tabindex", "0");
    view.setAttribute("role", "button");
    view.addEventListener("click", start);
    view.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); start(); } });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); save(); }
      else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
    input.addEventListener("blur", () => setTimeout(() => {
      if (!root.contains(document.activeElement) && o.blur === "save") save();
    }, 0));
    root.querySelectorAll("[data-action=save]").forEach((b) => b.addEventListener("click", save));
    root.querySelectorAll("[data-action=cancel]").forEach((b) => b.addEventListener("click", cancel));
  }

  C.inlineEdit = { init, initAll: (s = document, o) => s.querySelectorAll(".cin-inline-edit").forEach((el) => init(el, o)) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => C.inlineEdit.initAll());
  else C.inlineEdit.initAll();
})();


/* ---- input-number.js ---- */
/* input-number.js 约定：无脚本时 field 就是原生 type="number"，手输、提交照常，
   只是按不到加减。JS 只负责：步进夹取、长按连加、到边界禁按钮、非法输入回弹，
   并外抛 cin:numberchange 事件。
   结构：<div class="cin-input-number" data-input-number data-value="1" data-min="0" data-max="10" data-step="1">
           <button class="cin-input-number-step" data-step-dir="-1" aria-label="减少" type="button">−</button>
           <input class="cin-input-number-field" type="number" inputmode="decimal" aria-label="数量">
           <button class="cin-input-number-step" data-step-dir="1" aria-label="增加" type="button">+</button>
         </div> */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const state = new WeakMap();
  const HOLD_DELAY = 500;
  const HOLD_INTERVAL = 80;

  const emit = (el, type, detail = {}) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  const fieldOf = (root) => root.querySelector(".cin-input-number-field");
  const stepsOf = (root) => [...root.querySelectorAll(".cin-input-number-step")];
  const parseOr = (value, fallback) => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  };

  function conf(root) {
    const raw = root.dataset;
    const min = raw.min === undefined || raw.min === "" ? -Infinity : parseOr(raw.min, -Infinity);
    const max = raw.max === undefined || raw.max === "" ? Infinity : parseOr(raw.max, Infinity);
    const step = Math.abs(parseOr(raw.step, 1)) || 1;
    return { min, max, step };
  }

  function decimals(value) {
    const s = String(value);
    const dot = s.indexOf(".");
    return dot < 0 ? 0 : s.length - dot - 1;
  }

  // 0.1 累加会漂出 0.30000000000000004，按 step 精度四舍五入再夹一次
  function tidy(value, step) {
    const p = Math.min(decimals(step), 6);
    return parseOr((Math.round(value * 10 ** p) / 10 ** p).toFixed(p), value);
  }

  function readValue(root) {
    const c = conf(root);
    const fallback = Number.isFinite(c.min) ? c.min : 0;
    return parseOr(fieldOf(root)?.value, parseOr(root.dataset.value, fallback));
  }

  function refresh(root) {
    const c = conf(root);
    const value = readValue(root);
    const locked = "disabled" in root.dataset;
    root.dataset.value = String(value);
    for (const btn of stepsOf(root)) {
      const dir = parseOr(btn.dataset.stepDir, 0);
      const hit = dir < 0 ? value <= c.min : value >= c.max;
      btn.disabled = locked || hit;
    }
  }

  function setValue(root, next, reason) {
    const c = conf(root);
    const field = fieldOf(root);
    if (!field) return null;
    const previous = readValue(root);
    let value = tidy(parseOr(next, previous), c.step);
    if (value < c.min) value = c.min;
    if (value > c.max) value = c.max;
    value = tidy(value, c.step);
    field.value = String(value);
    field.removeAttribute("aria-invalid");
    delete root.dataset.invalid;
    refresh(root);
    if (value !== previous) emit(root, "cin:numberchange", { value, previous, reason });
    return value;
  }

  function step(root, dir) {
    const c = conf(root);
    return setValue(root, readValue(root) + Math.sign(dir || 1) * c.step, "step");
  }

  function bindStep(root, btn) {
    let holdTimer = 0;
    let repeatTimer = 0;
    const stop = () => {
      clearTimeout(holdTimer);
      clearInterval(repeatTimer);
      holdTimer = 0;
      repeatTimer = 0;
    };
    const dir = parseOr(btn.dataset.stepDir, 0);
    btn.addEventListener("pointerdown", () => {
      if (btn.disabled) return;
      step(root, dir);
      holdTimer = window.setTimeout(() => {
        repeatTimer = window.setInterval(() => step(root, dir), HOLD_INTERVAL);
      }, HOLD_DELAY);
    });
    for (const type of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(type, stop);
    // 鼠标/触摸的 click 已经由 pointerdown 走过一次，这里只收键盘触发的 click（detail 为 0）
    btn.addEventListener("click", (event) => {
      if (event.detail === 0 && !btn.disabled) step(root, dir);
    });
    btn.addEventListener("blur", stop);
  }

  function bindField(root) {
    const field = fieldOf(root);
    if (!field) return;
    const c = conf(root);
    const markInvalid = (bad) => {
      if (bad) {
        field.setAttribute("aria-invalid", "true");
        root.dataset.invalid = "";
      } else {
        field.removeAttribute("aria-invalid");
        delete root.dataset.invalid;
      }
    };
    field.addEventListener("input", () => {
      const raw = field.value.trim();
      const n = Number.parseFloat(raw);
      markInvalid(raw === "" || !Number.isFinite(n) || n < c.min || n > c.max);
    });
    field.addEventListener("change", () => {
      const raw = field.value.trim();
      const n = Number.parseFloat(raw);
      if (raw === "" || !Number.isFinite(n)) {
        setValue(root, readValue(root), "blur");
        markInvalid(false);
        return;
      }
      setValue(root, n, "input");
    });
    field.addEventListener("keydown", (event) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        step(root, 1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        step(root, -1);
      }
    });
  }

  function attach(root) {
    if (state.has(root)) return state.get(root);
    const field = fieldOf(root);
    if (!field) return null;
    const initial = root.dataset.value !== undefined && root.dataset.value !== "" ? root.dataset.value : field.value;
    field.value = String(tidy(parseOr(initial, Number.isFinite(conf(root).min) ? conf(root).min : 0), conf(root).step));
    for (const btn of stepsOf(root)) {
      if (!btn.getAttribute("type")) btn.setAttribute("type", "button");
      bindStep(root, btn);
    }
    bindField(root);
    refresh(root);
    state.set(root, true);
    return root;
  }

  const resolve = (target) =>
    target instanceof Element
      ? target.matches("[data-input-number], .cin-input-number")
        ? target
        : target.closest("[data-input-number], .cin-input-number")
      : null;

  C.initInputNumbers = (scope = document) => {
    const list = [...scope.querySelectorAll("[data-input-number], .cin-input-number")];
    for (const root of list) attach(root);
    return list.length;
  };

  C.setInputNumber = (target, value, reason = "api") => {
    const root = resolve(target);
    if (!root) return null;
    attach(root);
    return setValue(root, value, reason);
  };

  C.inputNumber = (target) => {
    const root = resolve(target);
    if (!root) return null;
    attach(root);
    return {
      get value() {
        return readValue(root);
      },
      get min() {
        return conf(root).min;
      },
      get max() {
        return conf(root).max;
      },
      get step() {
        return conf(root).step;
      },
      set: (value) => setValue(root, value, "api"),
      stepBy: (dir) => step(root, dir),
    };
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => C.initInputNumbers());
  else C.initInputNumbers();
})();


/* ---- keys.js ---- */
/* keys.js · 快捷键可视化（T36，≤40 行；只改 data-pressed，不劫持按键、不 preventDefault） */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  const norm = (s) => (s || "").replace(/⌘|Cmd|Command/gi, isMac ? "meta" : "ctrl").replace(/Ctrl|Control/gi, "ctrl").replace(/⌥|Alt|Option/gi, "alt").replace(/⇧|Shift/gi, "shift").replace(/\s+/g, "").toLowerCase();
  const keyOf = (e) => [e.metaKey && "meta", e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && "shift", String(e.key).toLowerCase()].filter(Boolean).join("").replace(/\s+/g, "");
  const toAria = (s) => (s || "").replace(/⌘/g, "Meta+").replace(/⇧/g, "Shift+").replace(/⌥/g, "Alt+").replace(/⌃/g, "Control+").replace(/\s+/g, "");
  const all = () => document.querySelectorAll("[data-keys][data-cin-keys]");
  const clear = () => all().forEach((el) => delete el.dataset.pressed);
  const onDown = (e) => {
    if (e.repeat) return;
    clear();
    const k = keyOf(e);
    all().forEach((el) => { if (norm(el.dataset.keys) === k) el.dataset.pressed = ""; });
  };
  function init(el) {
    if (!el || el.dataset.cinKeys) return;
    el.dataset.cinKeys = "1";
    if (el.dataset.keys) el.setAttribute("aria-keyshortcuts", toAria(el.dataset.keys));
  }
  C.keys = { init, initAll: (s = document) => s.querySelectorAll("[data-keys]").forEach(init), norm, isMac, toAria };
  const boot = () => {
    C.keys.initAll();
    if (boot.bound) return;
    boot.bound = true;
    document.addEventListener("keydown", onDown);
    document.addEventListener("keyup", clear);
    window.addEventListener("blur", clear);
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
})();


/* ---- lightbox.js ---- */
/* lightbox.js · 灯箱（围栏 + 预载 + 键盘翻页 + 点背景关闭）
   结构：<div class="cin-lightbox-wrap" hidden>
            <div class="cin-lightbox"><div class="cin-lightbox-stage"><img class="cin-lightbox-img" alt=""></div>
              <p class="cin-lightbox-caption"></p><span class="cin-lightbox-error">图片加载失败</span></div>
            <button class="cin-lightbox-nav" data-dir="prev">‹</button>
            <button class="cin-lightbox-nav" data-dir="next">›</button>
          </div>
   打开：C.lightbox.open(wrapEl, { items: ["a.jpg","b.jpg"], index: 0 }) */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  function open(wrap, opts) {
    const P = C.Primitives || {};
    const o = Object.assign({ index: 0, items: null, labels: null }, opts || {});
    const items = (o.items || []).slice();
    if (!items.length) wrap.querySelectorAll("[data-src]").forEach((n) => items.push(n.dataset.src));
    const box = wrap.querySelector(".cin-lightbox") || wrap;
    const img = wrap.querySelector(".cin-lightbox-img");
    const caption = wrap.querySelector(".cin-lightbox-caption");
    if (!img || !items.length) return () => {};

    wrap.hidden = false;
    if (items.length < 2) box.setAttribute("data-single", "");
    else box.removeAttribute("data-single");
    let i = Math.max(0, Math.min(o.index | 0, items.length - 1));

    const label = (n) => (o.labels && o.labels[n]) || (n + 1) + " / " + items.length;
    const show = (n) => {
      i = (n + items.length) % items.length;
      if (P.status) P.status.set(box, "busy"); else box.setAttribute("data-cin-status", "busy");
      img.setAttribute("data-state", "loading");
      const probe = new Image();
      probe.onload = () => {
        img.src = items[i];
        img.setAttribute("data-state", "ready");
        img.setAttribute("alt", label(i));
        if (caption) caption.textContent = label(i);
        if (P.status) P.status.set(box, "idle"); else box.setAttribute("data-cin-status", "idle");
        emit(wrap, "cin:lightbox-change", { index: i, src: items[i] });
      };
      probe.onerror = () => {
        img.removeAttribute("src");
        img.setAttribute("data-state", "error");
        if (P.status) P.status.set(box, "error"); else box.setAttribute("data-cin-status", "error");
        emit(wrap, "cin:lightbox-error", { index: i, src: items[i] });
      };
      probe.src = items[i];
    };

    const detach = [];
    const release = (reason) => {
      detach.forEach((fn) => fn());
      wrap.hidden = true;
      wrap.removeAttribute("data-open");
      emit(wrap, "cin:lightbox-close", { reason: reason || "api" });
    };

    const key = (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); show(i + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); show(i - 1); }
    };
    wrap.addEventListener("keydown", key);
    detach.push(() => wrap.removeEventListener("keydown", key));

    const click = (e) => {
      const nav = e.target.closest(".cin-lightbox-nav");
      if (nav) { show(nav.dataset.dir === "next" ? i + 1 : i - 1); return; }
      if (e.target === wrap) release("backdrop");
    };
    wrap.addEventListener("click", click);
    detach.push(() => wrap.removeEventListener("click", click));

    const esc = (e) => { if (e.key === "Escape") release("esc"); };
    document.addEventListener("keydown", esc);
    detach.push(() => document.removeEventListener("keydown", esc));

    wrap.setAttribute("data-open", "");
    if (P.gate) {
      const g = P.gate.open(wrap, { onClose: () => release("gate") });
      if (typeof g === "function") detach.push(g);
    }
    show(i);
    return release;
  }

  C.lightbox = { open };
})();


/* ---- markdown.js ---- */
/* markdown.js 约定：完整转义后再拼标签，绝不放行原始 HTML。
   支持：标题 / 段落 / 粗斜体 / 删除线 / 行内代码 / 围栏代码块 / 有序无序列表（一层嵌套）/
   引用 / 分隔线 / 链接 / 图片 / 表格。不支持 HTML 直出、脚注、数学公式——需要时请外部预渲染。
   链接与图片只放行 http(s)、mailto、协议相对与站点内相对地址，其余按纯文本输出。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

  const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/|\.{1,2}\/|#)/i;
  const safeHref = (raw) => {
    const url = String(raw).trim().replace(/^<|>$/g, "");
    if (!url) return "";
    if (SAFE_HREF.test(url)) return esc(url);
    return "";
  };

  /* ---------------- 行内 ---------------- */
  function inline(text) {
    const slots = [];
    const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;

    // 行内代码先摘出来，里面的 * _ [ ] 不参与后续解析
    let s = String(text).replace(/`([^`]+)`/g, (_, code) => keep(`<code>${esc(code)}</code>`));

    s = esc(s);

    // 图片 ![alt](src)
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (m, alt, src, title) => {
      const href = safeHref(src.replace(/&amp;/g, "&"));
      if (!href) return m;
      const t = title ? ` title="${esc(title)}"` : "";
      return keep(`<img src="${href}" alt="${esc(alt)}"${t} loading="lazy">`);
    });

    // 链接 [text](href)
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (m, label, href, title) => {
      const url = safeHref(href.replace(/&amp;/g, "&"));
      if (!url) return m;
      const t = title ? ` title="${esc(title)}"` : "";
      return keep(`<a href="${url}"${t}>${label}</a>`);
    });

    // 自动链接：裸 https:// 地址带上 <a>，已生成的标签在占位符里，不会被二次命中
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, lead, url) =>
      `${lead}${keep(`<a href="${esc(url)}">${esc(url)}</a>`)}`
    );

    s = s
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/(^|[^_])_([^_\s][^_]*)_/g, "$1<em>$2</em>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>");

    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
  }

  /* ---------------- 块级 ---------------- */
  const FENCE = /^\s{0,3}(```|~~~)\s*([\w+#-]*)\s*$/;
  const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const QUOTE = /^\s{0,3}>\s?/;
  const UL = /^(\s*)([-*+])\s+(.*)$/;
  const OL = /^(\s*)(\d+)[.)]\s+(.*)$/;
  const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function splitRow(line) {
    const trimmed = line.trim().replace(/^\||\|$/g, "");
    const cells = [];
    let buf = "";
    let inCode = false;
    for (const ch of trimmed) {
      if (ch === "`") inCode = !inCode;
      if (ch === "|" && !inCode) {
        cells.push(buf.trim());
        buf = "";
        continue;
      }
      buf += ch;
    }
    cells.push(buf.trim());
    return cells;
  }

  function renderTable(headLine, sepLine, bodyLines) {
    const heads = splitRow(headLine);
    const aligns = splitRow(sepLine).map((cell) => {
      const left = cell.startsWith(":");
      const right = cell.endsWith(":");
      if (left && right) return "center";
      if (right) return "right";
      if (left) return "left";
      return "";
    });
    const attr = (i) => (aligns[i] ? ` data-align="${aligns[i]}"` : "");
    const thead = `<thead><tr>${heads.map((h, i) => `<th${attr(i)}>${inline(h)}</th>`).join("")}</tr></thead>`;
    const rows = bodyLines.map((line) => {
      const cells = splitRow(line);
      const tds = heads.map((_, i) => `<td${attr(i)}>${inline(cells[i] ?? "")}</td>`).join("");
      return `<tr>${tds}</tr>`;
    });
    return `<table>${thead}<tbody>${rows.join("")}</tbody></table>`;
  }

  function renderList(items, ordered, start) {
    const tag = ordered ? "ol" : "ul";
    const attrs = ordered && start !== 1 ? ` start="${start}"` : "";
    const html = items
      .map((item) => {
        const children = item.children.length ? render(item.children.join("\n")) : "";
        return `<li>${inline(item.text)}${children}</li>`;
      })
      .join("");
    return `<${tag}${attrs}>${html}</${tag}>`;
  }

  function render(src) {
    const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) {
        i += 1;
        continue;
      }

      // 围栏代码块：不解析内部任何标记
      const fence = line.match(FENCE);
      if (fence) {
        const marker = fence[1];
        const lang = fence[2];
        const body = [];
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith(marker)) {
          body.push(lines[i]);
          i += 1;
        }
        i += 1; // 跳过闭合围栏
        const cls = lang ? ` class="language-${esc(lang)}"` : "";
        out.push(`<pre><code${cls}>${esc(body.join("\n"))}</code></pre>`);
        continue;
      }

      const heading = line.match(HEADING);
      if (heading) {
        const level = heading[1].length;
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        i += 1;
        continue;
      }

      if (HR.test(line)) {
        out.push("<hr>");
        i += 1;
        continue;
      }

      // 引用：连续 > 行整段递归
      if (QUOTE.test(line)) {
        const buf = [];
        while (i < lines.length && QUOTE.test(lines[i])) {
          buf.push(lines[i].replace(QUOTE, ""));
          i += 1;
        }
        out.push(`<blockquote>${render(buf.join("\n"))}</blockquote>`);
        continue;
      }

      // 表格：当前行含 |，下一行是分隔行
      if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
        const head = line;
        const sep = lines[i + 1];
        const body = [];
        i += 2;
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
          body.push(lines[i]);
          i += 1;
        }
        out.push(renderTable(head, sep, body));
        continue;
      }

      // 列表
      const ulMatch = line.match(UL);
      const olMatch = line.match(OL);
      if (ulMatch || olMatch) {
        const ordered = !!olMatch;
        const indent = (ulMatch ? ulMatch[1] : olMatch[1]).length;
        const start = ordered ? Number(olMatch[2]) : 1;
        const items = [];
        while (i < lines.length) {
          const cur = lines[i];
          const m = ordered ? cur.match(OL) : cur.match(UL);
          if (!m || m[1].length !== indent) break;
          const item = { text: m[3], children: [] };
          i += 1;
          // 子项：缩进更深的列表行先收着，交给递归
          while (i < lines.length) {
            const sub = lines[i];
            const subMatch = sub.match(UL) || sub.match(OL);
            if (subMatch && subMatch[1].length > indent) {
              item.children.push(sub);
              i += 1;
              continue;
            }
            // 列表项的续行（非空且不是新块）
            if (sub.trim() && !subMatch && !HEADING.test(sub) && !FENCE.test(sub) && !QUOTE.test(sub)) {
              item.text += ` ${sub.trim()}`;
              i += 1;
              continue;
            }
            break;
          }
          items.push(item);
        }
        out.push(renderList(items, ordered, start));
        continue;
      }

      // 段落：吃到空行或下一个块起始
      const buf = [line];
      i += 1;
      while (i < lines.length) {
        const cur = lines[i];
        if (
          !cur.trim() ||
          FENCE.test(cur) ||
          HEADING.test(cur) ||
          HR.test(cur) ||
          QUOTE.test(cur) ||
          UL.test(cur) ||
          OL.test(cur) ||
          (cur.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]))
        )
          break;
        buf.push(cur);
        i += 1;
      }
      out.push(`<p>${inline(buf.join(" "))}</p>`);
    }

    return out.join("\n");
  }

  /** 把 [data-markdown] / <script type="text/markdown"> 里的源文本渲染成 HTML */
  function initMarkdowns(scope = document) {
    const list = [];
    if (scope && scope.matches && scope.matches("[data-markdown]")) list.push(scope);
    if (scope && scope.querySelectorAll) list.push(...scope.querySelectorAll("[data-markdown]"));
    list.forEach((el) => {
      if (el.__cinMd) return;
      el.__cinMd = true;
      const source = el.querySelector('script[type="text/markdown"], template')?.innerHTML ?? el.textContent ?? "";
      const html = render(source);
      const target = el.querySelector("[data-markdown-target]");
      if (target) target.innerHTML = html;
      else el.innerHTML = html;
      el.setAttribute("data-markdown-ready", "");
    });
    return list.length;
  }

  C.renderMarkdown = render;
  C.initMarkdowns = initMarkdowns;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initMarkdowns(), { once: true });
  } else {
    initMarkdowns();
  }
})();


/* ---- mascot.js ---- */
/* mascot.js · 形象层注视（全页共用一帧循环，静止即停帧，reduce 下不注册） */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const reduce = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const live = new Map();
  let frame = 0;
  let cursor = null;
  const flush = () => {
    frame = 0;
    const p = cursor;
    cursor = null;
    if (p) for (const look of live.values()) look(p.x, p.y);
  };
  const onMove = (e) => {
    cursor = { x: e.clientX, y: e.clientY };
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const unbind = () => {
    document.removeEventListener("pointermove", onMove);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    cursor = null;
  };
  function init(root) {
    if (!root || live.has(root) || reduce()) return;
    const face = root.querySelector(".cin-mascot-body") || root;
    const clamp = (n) => Math.max(-1, Math.min(1, n));
    const look = (x, y) => {
      const r = face.getBoundingClientRect();
      if (!r.width || !r.height) return;
      root.style.setProperty("--cin-mascot-look-x", clamp(((x - r.left) / r.width) * 2 - 1).toFixed(3));
      root.style.setProperty("--cin-mascot-look-y", clamp(((y - r.top) / r.height) * 2 - 1).toFixed(3));
    };
    if (!live.size) document.addEventListener("pointermove", onMove, { passive: true });
    live.set(root, look);
    root.dataset.cinMascot = "1";
  }
  function destroy(root) {
    const clear = (el) => {
      delete el.dataset.cinMascot;
      el.style.removeProperty("--cin-mascot-look-x");
      el.style.removeProperty("--cin-mascot-look-y");
    };
    if (root) {
      live.delete(root);
      clear(root);
    } else {
      live.forEach((_, el) => clear(el));
      live.clear();
    }
    if (!live.size) unbind();
  }
  C.mascot = { init, initAll: (s = document) => s.querySelectorAll(".cin-mascot").forEach(init), destroy };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", () => C.mascot.initAll()) : C.mascot.initAll();
})();


/* ---- morph-button.js ---- */
/* morph-button.js · 五态形变 + 撤销窗口（单实例单计时器，reduce 下取消动效但保留状态） */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const UNDO_MS = 5000;
  const TICK_MS = 100;
  const STATES = ["idle", "hover", "press", "loading", "interrupted"];
  const timers = new WeakMap();
  const fire = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  function setState(el, next) {
    if (!el || !STATES.includes(next)) return;
    el.dataset.state = next;
    if (next === "loading") el.setAttribute("aria-busy", "true");
    else if (el.hasAttribute("aria-busy")) el.removeAttribute("aria-busy");
    fire(el, "cin:morph-state", { state: next });
  }

  function clearUndo(el) {
    const t = timers.get(el);
    if (t) clearInterval(t);
    timers.delete(el);
    delete el.dataset.undo;
    el.style.setProperty("--cin-morph-undo", "1");
  }

  function openUndo(el, ms = UNDO_MS) {
    clearUndo(el);
    const total = Math.max(500, ms);
    let left = total;
    el.dataset.undo = "1";
    el.style.setProperty("--cin-morph-undo", "1");
    setState(el, "idle");
    const timer = setInterval(() => {
      left -= TICK_MS;
      el.style.setProperty("--cin-morph-undo", String(Math.max(0, left / total).toFixed(3)));
      if (left > 0) return;
      clearUndo(el);
      fire(el, "cin:morph-undo-expired", {});
    }, TICK_MS);
    timers.set(el, timer);
  }

  function undo(el) {
    if (!el || el.dataset.undo !== "1") return false;
    clearUndo(el);
    setState(el, "idle");
    fire(el, "cin:morph-undo", {});
    return true;
  }

  function init(el) {
    if (!el || el.dataset.cinMorph) return;
    el.dataset.cinMorph = "1";
    if (!el.hasAttribute("data-state")) setState(el, "idle");
    const idle = () => (["hover", "press"].includes(el.dataset.state) ? setState(el, "idle") : null);
    el.addEventListener("pointerenter", () => el.dataset.state === "idle" && setState(el, "hover"));
    el.addEventListener("pointerleave", idle);
    el.addEventListener("pointerdown", () => {
      if (el.dataset.state === "hover" || el.dataset.state === "idle") setState(el, "press");
    });
    el.addEventListener("pointerup", idle);
    el.addEventListener("pointercancel", idle);
    el.addEventListener("focus", () => el.dataset.state === "idle" && setState(el, "hover"));
    el.addEventListener("blur", idle);
    el.addEventListener("click", () => {
      if (el.dataset.state === "interrupted") {
        setState(el, "idle");
        fire(el, "cin:morph-retry", {});
        return;
      }
      if (el.dataset.undo === "1") undo(el);
    });
  }

  function destroy(el) {
    clearUndo(el);
    if (!el) return;
    delete el.dataset.cinMorph;
    setState(el, "idle");
  }

  C.morph = {
    init,
    initAll: (scope = document) => scope.querySelectorAll(".cin-morph").forEach(init),
    setState,
    settle: (el, opts = {}) => (opts.undo === false ? setState(el, "idle") : openUndo(el, opts.ms)),
    undo,
    destroy,
    reduce: () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches),
  };

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", () => C.morph.initAll())
    : C.morph.initAll();
})();


/* ---- notice-bar.js ---- */
/* notice-bar.js 约定：无脚本时通告条照常静态展示，关闭按钮点了没反应，内容不丢。
   JS 只负责：关闭（移除/隐藏 + 外抛 cin:noticeclose）、显隐与内容替换 API。
   结构：<div class="cin-notice-bar" data-notice-bar data-type="info" role="status">
           <span class="cin-notice-bar-icon" aria-hidden="true">…</span>
           <div class="cin-notice-bar-content" data-notice-content>…</div>
           <button class="cin-notice-bar-action">查看</button>
           <button class="cin-notice-bar-close" aria-label="关闭"></button>
         </div> */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const state = new WeakMap();

  const emit = (el, type, detail = {}) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  function rootOf(target) {
    if (!(target instanceof Element)) return null;
    return target.matches("[data-notice-bar], .cin-notice-bar")
      ? target
      : target.closest("[data-notice-bar], .cin-notice-bar");
  }

  function contentOf(root) {
    return root.querySelector("[data-notice-content], .cin-notice-bar-content");
  }

  function close(root, reason) {
    const st = state.get(root);
    if (st) st.closed = true;
    if (root.dataset.closable === "remove" || root.hasAttribute("data-closable")) root.setAttribute("data-hidden", "");
    else root.setAttribute("hidden", "");
    root.setAttribute("aria-hidden", "true");
    emit(root, "cin:noticeclose", { reason });
    return true;
  }

  function open(root) {
    const st = state.get(root);
    if (st) st.closed = false;
    root.removeAttribute("data-hidden");
    root.removeAttribute("hidden");
    root.removeAttribute("aria-hidden");
    emit(root, "cin:noticeopen", {});
    return root;
  }

  function attach(root) {
    if (state.has(root)) return;
    state.set(root, { closed: root.hasAttribute("hidden") });
    if (!root.hasAttribute("role")) root.setAttribute("role", "status");
    root.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (!t.closest(".cin-notice-bar-close, [data-notice-close]")) return;
      e.preventDefault();
      close(root, "close");
    });
  }

  const roots = (scope) => (scope || document).querySelectorAll("[data-notice-bar], .cin-notice-bar");

  C.initNoticeBars = (scope = document) => {
    roots(scope).forEach(attach);
  };

  C.setNoticeBarText = (target, text) => {
    const root = rootOf(target);
    if (!root) return null;
    attach(root);
    const content = contentOf(root);
    if (!content) return null;
    const span = content.querySelector(":scope > span") || content;
    span.textContent = String(text ?? "");
    return root;
  };

  C.noticeBar = (target) => {
    const root = rootOf(target);
    if (!root) return null;
    attach(root);
    return {
      show: () => open(root),
      hide: (reason = "api") => close(root, reason),
      setText: (text) => C.setNoticeBarText(root, text),
      get closed() {
        const st = state.get(root);
        return !!(st && st.closed);
      },
    };
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => C.initNoticeBars());
  else C.initNoticeBars();
})();


/* ---- otp.js ---- */
/* otp.js 约定：格子是普通 input，脚本只补「自动前进 / 退格回退 / 粘贴分配 / 完成事件」。
   不改输入法、不吞按键，删掉脚本仍能一个格一个格地手输。
   结构：
     <div class="cin-otp" data-otp data-length="6" data-charset="numeric">
       <input class="cin-otp-input" aria-label="第 1 位验证码" autocomplete="one-time-code">
       …
     </div> */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;

  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  const SEL = "[data-otp], .cin-otp";

  const inputsOf = (root) => Array.from(root.querySelectorAll(".cin-otp-input"));
  const valueOf = (root) => inputsOf(root).map((i) => i.value).join("");
  const filled = (root) => inputsOf(root).every((i) => i.value.length === 1);

  function clean(root, raw) {
    const charset = root.getAttribute("data-charset") || "numeric";
    const text = String(raw || "");
    if (charset === "any") return text.replace(/\s+/g, "");
    const re = charset === "alnum" ? /[0-9a-z]/i : /[0-9]/;
    return Array.from(text).filter((ch) => re.test(ch)).join("");
  }

  function refresh(root) {
    const empty = !filled(root);
    if (empty) root.removeAttribute("data-complete");
    else root.setAttribute("data-complete", "");
    if (empty) root.__cinOtpLast = "";
    const value = valueOf(root);
    if (value !== root.__cinOtpLast) {
      root.__cinOtpLast = value;
      emit(root, "cin:otpchange", { value });
    }
    if (filled(root) && root.__cinOtpDone !== true) {
      root.__cinOtpDone = true;
      emit(root, "cin:otpcomplete", { value });
    }
    if (!filled(root)) root.__cinOtpDone = false;
  }

  function bind(root) {
    if (root.__cinOtp) return false;
    root.__cinOtp = true;

    const inputs = inputsOf(root);
    if (!inputs.length) return false;
    const length = Number(root.getAttribute("data-length") || inputs.length);

    inputs.forEach((input, i) => {
      input.setAttribute("maxlength", "1");
      if (!input.hasAttribute("autocomplete")) input.setAttribute("autocomplete", i === 0 ? "one-time-code" : "off");
      if (!input.hasAttribute("inputmode")) input.setAttribute("inputmode", root.getAttribute("data-charset") === "alnum" ? "text" : "numeric");
      if (!input.hasAttribute("aria-label")) input.setAttribute("aria-label", tr("otp.digit", "第 {n} 位验证码", { n: i + 1 }));

      input.addEventListener("input", () => {
        const raw = input.value;
        const cleaned = clean(root, raw);
        if (!cleaned) {
          input.value = "";
          refresh(root);
          return;
        }
        if (cleaned.length > 1) {
          // 输入法一次给了一串：从当前格开始铺开
          let cursor = i;
          for (const ch of cleaned) {
            if (cursor >= inputs.length) break;
            inputs[cursor].value = ch;
            cursor += 1;
          }
          const next = inputs[Math.min(cursor, inputs.length - 1)];
          (cursor >= inputs.length ? inputs[inputs.length - 1] : next).focus();
          refresh(root);
          return;
        }
        input.value = cleaned;
        if (i < inputs.length - 1) inputs[i + 1].focus();
        refresh(root);
      });

      input.addEventListener("keydown", (e) => {
        if (e.key === "Backspace") {
          if (input.value) return; // 有值让原生删除
          if (i > 0) {
            e.preventDefault();
            inputs[i - 1].value = "";
            inputs[i - 1].focus();
            refresh(root);
          }
          return;
        }
        if (e.key === "Delete") {
          input.value = "";
          refresh(root);
          return;
        }
        if (e.key === "ArrowLeft" && i > 0) {
          e.preventDefault();
          inputs[i - 1].focus();
          inputs[i - 1].select();
          return;
        }
        if (e.key === "ArrowRight" && i < inputs.length - 1) {
          e.preventDefault();
          inputs[i + 1].focus();
          inputs[i + 1].select();
          return;
        }
        if (e.key === "Home") {
          e.preventDefault();
          inputs[0].focus();
          inputs[0].select();
          return;
        }
        if (e.key === "End") {
          e.preventDefault();
          inputs[inputs.length - 1].focus();
          inputs[inputs.length - 1].select();
        }
      });

      input.addEventListener("focus", () => input.select());
      input.addEventListener("paste", (e) => {
        const text = (e.clipboardData || window.clipboardData)?.getData("text") || "";
        const cleaned = clean(root, text).slice(0, length);
        if (!cleaned) return;
        e.preventDefault();
        let cursor = i;
        for (const ch of cleaned) {
          if (cursor >= inputs.length) break;
          inputs[cursor].value = ch;
          cursor += 1;
        }
        inputs[Math.min(cursor, inputs.length - 1)].focus();
        refresh(root);
      });
    });

    refresh(root);
    return true;
  }

  function initOTPs(scope = document) {
    let n = 0;
    const list = [];
    if (scope && scope.matches && scope.matches(SEL)) list.push(scope);
    if (scope && scope.querySelectorAll) list.push(...scope.querySelectorAll(SEL));
    list.forEach((root) => {
      if (bind(root)) n += 1;
    });
    return n;
  }

  function resolve(target) {
    if (!target || target.nodeType !== 1) return null;
    return target.matches(SEL) ? target : target.closest(SEL);
  }

  /** 脚本侧填值：不足补空，超出截断 */
  function setOTP(target, value) {
    const root = resolve(target);
    if (!root) return null;
    const chars = clean(root, value).split("");
    inputsOf(root).forEach((input, i) => {
      input.value = chars[i] || "";
    });
    refresh(root);
    return valueOf(root);
  }

  function getOTP(target) {
    const root = resolve(target);
    return root ? valueOf(root) : "";
  }

  C.initOTPs = initOTPs;
  C.setOTP = setOTP;
  C.getOTP = getOTP;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initOTPs(), { once: true });
  } else {
    initOTPs();
  }
})();


/* ---- overlay.js ---- */
/* Cinder 浮层行为层：Toast / Dialog / Drawer / Popconfirm / Tooltip / Tour
   约定：只碰自己的 data-* 与 class，不改业务 DOM；状态变化全部通过 cin:* 事件外抛。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;
  const FOCUSABLE = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type='hidden'])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  const focusables = (root) =>
    Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => {
      if (el.hasAttribute("inert") || el.closest("[inert]")) return false;
      if (el.getClientRects().length === 0) return false;
      if (typeof el.checkVisibility === "function" && !el.checkVisibility()) return false;
      return true;
    });

  /** 模态焦点圈：keydown 只兜首尾回绕，focusin 兜焦点被外部抢走（点背景、脚本抢焦点） */
  function trapFocus(el) {
    const panelOf = () => el.querySelector(".cin-dialog-panel, .cin-drawer-panel") || el;
    const pull = (e) => {
      if (!el.open) return;
      const panel = panelOf();
      if (panel.contains(e.target) || el === e.target) return;
      const items = focusables(panel);
      const back = items[0] || panel;
      if (back === panel && !panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
      back.focus({ preventScroll: true });
    };
    el._cinTrapIn = pull;
    document.addEventListener("focusin", pull, true);
  }
  function releaseFocus(el) {
    if (el._cinTrapIn) {
      document.removeEventListener("focusin", el._cinTrapIn, true);
      el._cinTrapIn = null;
    }
  }

  let lockCount = 0;
  const lockScroll = () => {
    if (lockCount++ === 0) document.documentElement.classList.add("cin-scroll-lock");
  };
  const unlockScroll = () => {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) document.documentElement.classList.remove("cin-scroll-lock");
  };

  const emit = (el, type, detail = {}) =>
    el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  /* ---------------- 模态 / 抽屉 ---------------- */
  function openDialog(el, options = {}) {
    if (!el || el.open) return;
    el._cinOpener = options.opener || document.activeElement;
    if (typeof el.showModal === "function") el.showModal();
    else el.setAttribute("open", "");
    lockScroll();
    const panel = el.querySelector(".cin-dialog-panel, .cin-drawer-panel") || el;
    if (el.hasAttribute("data-static")) {
      const safe = el.querySelector("[data-safe-action]");
      if (safe) safe.focus({ preventScroll: true });
    }
    const target = el.querySelector("[data-autofocus]") || focusables(panel)[0] || panel;
    if (target === panel && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    emit(el, "cin:open", { trigger: el._cinOpener });
  }

  function closeDialog(el, reason = "programmatic") {
    if (!el || !el.open) return;
    if (typeof el.close === "function") el.close(reason);
    else el.removeAttribute("open");
  }

  function bindDialog(el) {
    if (el._cinBound) return;
    el._cinBound = true;
    el.addEventListener("cancel", (e) => {
      if (el.hasAttribute("data-static")) {
        e.preventDefault();
        emit(el, "cin:blocked", { reason: "static" });
      }
    });
    el.addEventListener("close", () => {
      unlockScroll();
      releaseFocus(el);
      const opener = el._cinOpener;
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
      el._cinOpener = null;
      emit(el, "cin:close", { reason: el.returnValue });
    });
    el.addEventListener("click", (e) => {
      if (e.target === el && el.hasAttribute("data-backdrop-close")) closeDialog(el, "backdrop");
    });
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const panel = el.querySelector(".cin-dialog-panel, .cin-drawer-panel") || el;
      const items = focusables(panel);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!panel.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    });
  }

  C.openDialog = openDialog;
  C.closeDialog = closeDialog;

  /* ---------------- 轻提示 Toast ---------------- */
  C.toast = function toast(input) {
    const opts = typeof input === "string" ? { message: input } : input || {};
    const {
      message = "",
      tone = "default",
      duration = 2400,
      action,
      placement = "bottom",
      region: customRegion,
    } = opts;
    let region = customRegion || document.querySelector(".cin-toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "cin-toast-region";
      document.body.appendChild(region);
    }
    region.dataset.placement = placement;
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", tone === "danger" ? "assertive" : "polite");
    region.setAttribute("aria-atomic", "true");

    const el = document.createElement("div");
    el.className = "cin-toast";
    el.dataset.tone = tone;
    el.setAttribute("role", tone === "danger" ? "alert" : "status");

    const text = document.createElement("span");
    text.className = "cin-toast-message";
    text.textContent = message;
    el.appendChild(text);

    if (action && action.label) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cin-toast-action";
      btn.textContent = action.label;
      btn.addEventListener("click", () => {
        action.onClick && action.onClick();
        dismiss();
      });
      el.appendChild(btn);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "cin-toast-close";
    close.setAttribute("aria-label", tr("overlay.close", "关闭提示"));
    close.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    close.addEventListener("click", () => dismiss());
    el.appendChild(close);

    let timer = null;
    let remaining = duration;
    let startedAt = 0;
    const start = () => {
      startedAt = Date.now();
      timer = setTimeout(dismiss, remaining);
    };
    const pause = () => {
      clearTimeout(timer);
      remaining -= Date.now() - startedAt;
    };
    const dismiss = () => {
      clearTimeout(timer);
      el.style.opacity = "0";
      el.style.transform = "translateY(4px)";
      setTimeout(() => el.remove(), 160);
      emit(region, "cin:toastclose", { message });
    };

    el.addEventListener("pointerenter", pause);
    el.addEventListener("pointerleave", () => {
      if (remaining > 200) start();
    });
    el.addEventListener("focusin", pause);
    el.addEventListener("focusout", () => {
      if (remaining > 200) start();
    });

    region.appendChild(el);
    if (duration > 0) start();
    emit(region, "cin:toast", { message, tone });
    return { el, dismiss };
  };

  /* ---------------- 气泡确认 Popconfirm ---------------- */
  function closePopconfirm(pop) {
    if (!pop) return;
    pop.removeAttribute("data-open");
    const wrap = pop.closest(".cin-popconfirm-wrap");
    const trigger = wrap && wrap.querySelector("[data-popconfirm]");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  }

  /* 气泡确认按视口夹紧：横向居中于触发元素且不出界，上方空间不足时翻到下向 */
  function placePopconfirm(pop, trigger) {
    if (!pop || !trigger) return;
    const wrap = trigger.closest(".cin-popconfirm-wrap") || trigger.parentElement;
    if (!wrap) return;
    const wr = wrap.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    if (!pr.width) return;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const want = wr.left + wr.width / 2 - pr.width / 2;
    const left = Math.min(Math.max(margin, want), Math.max(margin, vw - pr.width - margin));
    pop.style.left = left - wr.left + "px";

    const declared = pop.getAttribute("data-side") === "bottom" ? "bottom" : "top";
    const spaceAbove = wr.top - margin;
    const spaceBelow = vh - wr.bottom - margin;
    let side = declared;
    if (declared === "top" && spaceAbove < pr.height + 12 && spaceBelow > spaceAbove) side = "bottom";
    else if (declared === "bottom" && spaceBelow < pr.height + 12 && spaceAbove > spaceBelow) side = "top";
    pop.setAttribute("data-side", side);
  }

  function openPopconfirm(pop, trigger) {
    document.querySelectorAll(".cin-popconfirm[data-open]").forEach(closePopconfirm);
    placePopconfirm(pop, trigger);
    pop.setAttribute("data-open", "");
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    const first = pop.querySelector("[data-safe-action]") || focusables(pop)[0];
    if (first) first.focus({ preventScroll: true });
    emit(pop, "cin:popconfirmopen");
  }

  /* ---------------- 初始化与全局委托 ---------------- */
  function placeAllPopconfirms() {
    document.querySelectorAll(".cin-popconfirm").forEach((pop) => {
      const wrap = pop.closest(".cin-popconfirm-wrap");
      placePopconfirm(pop, wrap && wrap.querySelector("[data-popconfirm]"));
    });
  }

  function init(root = document) {
    root.querySelectorAll("dialog").forEach((el) => {
      if (el.classList.contains("cin-dialog") || el.classList.contains("cin-drawer")) bindDialog(el);
    });
    placeAllPopconfirms();
  }

  document.addEventListener("click", (e) => {
    const opener = e.target.closest("[data-open-dialog]");
    if (opener) {
      const sel = opener.getAttribute("data-open-dialog");
      const dlg = sel ? document.querySelector(sel) : null;
      if (dlg) {
        e.preventDefault();
        openDialog(dlg, { opener });
      }
      return;
    }

    const closer = e.target.closest("[data-close-dialog]");
    if (closer) {
      const dlg = closer.closest("dialog");
      if (dlg) {
        e.preventDefault();
        if (dlg.hasAttribute("data-static")) emit(dlg, "cin:blocked", { reason: "static" });
        else closeDialog(dlg, closer.getAttribute("data-close-dialog") || "action");
      }
      return;
    }

    const popTrigger = e.target.closest("[data-popconfirm]");
    if (popTrigger) {
      const sel = popTrigger.getAttribute("data-popconfirm");
      const pop = sel ? document.querySelector(sel) : popTrigger.closest(".cin-popconfirm-wrap").querySelector(".cin-popconfirm");
      if (pop) {
        e.preventDefault();
        if (pop.hasAttribute("data-open")) closePopconfirm(pop);
        else openPopconfirm(pop, popTrigger);
      }
      return;
    }

    const cancel = e.target.closest("[data-popconfirm-cancel]");
    if (cancel) {
      const pop = cancel.closest(".cin-popconfirm");
      closePopconfirm(pop);
      const trigger = cancel.closest(".cin-popconfirm-wrap") ? cancel.closest(".cin-popconfirm-wrap").querySelector("[data-popconfirm]") : null;
      if (trigger) trigger.focus({ preventScroll: true });
      return;
    }

    const ok = e.target.closest("[data-popconfirm-ok]");
    if (ok) {
      const pop = ok.closest(".cin-popconfirm");
      emit(pop, "cin:confirm", { value: ok.getAttribute("data-popconfirm-ok") || "" });
      closePopconfirm(pop);
      return;
    }

    if (!e.target.closest(".cin-popconfirm")) {
      document.querySelectorAll(".cin-popconfirm[data-open]").forEach(closePopconfirm);
    }

    // 触屏没有 hover：点按触发元素切换气泡提示
    const tipTrigger = e.target.closest("[aria-describedby]");
    if (tipTrigger && window.matchMedia("(hover: none)").matches) {
      const tip = document.getElementById(tipTrigger.getAttribute("aria-describedby"));
      if (tip && tip.classList.contains("cin-tooltip")) {
        const on = tip.toggleAttribute("data-open");
        tipTrigger.setAttribute("aria-expanded", String(on));
      }
    }
  });

  /* WCAG 1.4.13：悬停/聚焦出现的附加内容必须能在不移开指针的情况下关闭 */
  function dismissOnEsc(pop) {
    const wrap = pop.closest(".cin-tip-wrap, .cin-hovercard-wrap") || pop.parentElement;
    const active = pop.matches(":hover") || (wrap && (wrap.matches(":hover") || wrap.contains(document.activeElement)));
    if (!active) return false;
    pop.setAttribute("data-dismissed", "");
    if (wrap) {
      const clear = () => {
        pop.removeAttribute("data-dismissed");
        wrap.removeEventListener("pointerleave", clear);
        wrap.removeEventListener("focusout", clear);
      };
      wrap.addEventListener("pointerleave", clear);
      wrap.addEventListener("focusout", clear);
    }
    return true;
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".cin-tooltip[data-open]").forEach((el) => el.removeAttribute("data-open"));
    document.querySelectorAll(".cin-tooltip, .cin-hovercard").forEach(dismissOnEsc);
    document.querySelectorAll(".cin-popconfirm[data-open]").forEach((pop) => {
      const wrap = pop.closest(".cin-popconfirm-wrap");
      const trigger = wrap && wrap.querySelector("[data-popconfirm]");
      closePopconfirm(pop);
      if (trigger) trigger.focus({ preventScroll: true });
    });
  });

  window.addEventListener("resize", placeAllPopconfirms);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => init());
  else init();
  C.initOverlay = init;

  /* ---------------- 漫游式引导 Tour ---------------- */
  C.tour = function tour(config = {}) {
    const steps = (config.steps || []).filter((s) => s && s.target && document.querySelector(s.target));
    if (!steps.length) return null;
    const labels = Object.assign(
      {
        prev: tr("overlay.tourPrev", "上一步"),
        next: tr("overlay.tourNext", "下一步"),
        done: tr("overlay.tourDone", "完成"),
        skip: tr("overlay.tourSkip", "跳过引导"),
      },
      config.labels
    );
    let index = 0;
    let spot = null;
    let bubble = null;
    let root = null;
    let lastFocus = document.activeElement;

    // 定位只写 transform 与尺寸缓存键，滚动期间不产生 layout 抖动
    let rafId = 0;
    let spotKey = "";
    let bubbleKey = "";
    let bubbleW = 0;
    let bubbleH = 0;
    let watched = null;
    let ro = null;

    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => { rafId = 0; place(); });
    };
    const stopSchedule = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } };

    const watchTarget = (target) => {
      if (watched === target) return;
      watched = target;
      if (typeof ResizeObserver !== "function") return;
      if (!ro) ro = new ResizeObserver(() => schedule());
      ro.disconnect();
      ro.observe(target);
      if (document.documentElement) ro.observe(document.documentElement);
    };

    const place = () => {
      if (!root) return;
      const step = steps[index];
      const target = document.querySelector(step.target);
      if (!target) return;
      watchTarget(target);
      const pad = 6;
      const r = target.getBoundingClientRect();

      const nextSpot = r.width + "x" + r.height;
      if (nextSpot !== spotKey) {
        spotKey = nextSpot;
        spot.style.width = r.width + pad * 2 + "px";
        spot.style.height = r.height + pad * 2 + "px";
      }
      spot.style.transform = "translate3d(" + (r.left - pad) + "px," + (r.top - pad) + "px,0)";

      const nextBubble = index + "@" + window.innerWidth;
      if (nextBubble !== bubbleKey) {
        bubbleKey = nextBubble;
        bubbleW = bubble.offsetWidth;
        bubbleH = bubble.offsetHeight;
      }
      const margin = 12;
      let top = r.bottom + margin;
      if (top + bubbleH > window.innerHeight - 8) top = Math.max(8, r.top - bubbleH - margin);
      const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - bubbleW - 8));
      bubble.style.transform = "translate3d(" + left + "px," + top + "px,0)";
    };

    const render = () => {
      const step = steps[index];
      const target = document.querySelector(step.target);
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      }
      bubble.querySelector("[data-tour-step]").textContent = tr("overlay.tourStep", "第 {n} / {total} 步", { n: index + 1, total: steps.length });
      bubble.querySelector("[data-tour-title]").textContent = step.title || "";
      bubble.querySelector("[data-tour-text]").textContent = step.body || "";
      bubble.querySelector("[data-tour-live]").textContent =
        tr("overlay.tourAria", "第 {n} 步，共 {total} 步：{title}", {
            n: index + 1,
            total: steps.length,
            title: step.title || "",
          });
      const prev = bubble.querySelector("[data-tour-prev]");
      const next = bubble.querySelector("[data-tour-next]");
      prev.disabled = index === 0;
      next.textContent = index === steps.length - 1 ? labels.done : labels.next;
      const dots = bubble.querySelector("[data-tour-dots]");
      dots.innerHTML = "";
      steps.forEach((_, i) => {
        const dot = document.createElement("span");
        dot.className = "cin-tour-dot";
        if (i === index) dot.setAttribute("data-active", "");
        dots.appendChild(dot);
      });
      bubbleKey = "";
      spotKey = "";
      requestAnimationFrame(place);
      setTimeout(place, 320);
    };

    const onKey = (e) => {
      if (!root) return;
      if (e.key === "Escape") {
        e.preventDefault();
        finish("esc");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(index + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(index - 1);
      } else if (e.key === "Tab") {
        const items = focusables(bubble);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    const finish = (reason) => {
      if (!root) return;
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      stopSchedule();
      if (ro) { ro.disconnect(); ro = null; watched = null; }
      document.removeEventListener("keydown", onKey, true);
      root.remove();
      root = null;
      if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
      emit(document.body, "cin:tourdone", { reason, index, total: steps.length });
      if (config.onDone) config.onDone({ reason, index });
    };

    const go = (next) => {
      if (next < 0) return;
      if (next >= steps.length) return finish("done");
      index = next;
      render();
      emit(root, "cin:tourstep", { index, total: steps.length, target: steps[index].target });
    };

    const build = () => {
      root = document.createElement("div");
      root.className = "cin-tour";
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-modal", "true");
      root.setAttribute("aria-label", config.title || tr("overlay.tourLabel", "功能引导"));
      spot = document.createElement("div");
      spot.className = "cin-tour-spot";
      bubble = document.createElement("div");
      bubble.className = "cin-tour-bubble";
      bubble.innerHTML =
        '<p class="cin-tour-step" data-tour-step></p>' +
        '<h2 class="cin-tour-title" data-tour-title></h2>' +
        '<p class="cin-tour-text" data-tour-text></p>' +
        '<div class="cin-tour-foot">' +
        '  <div class="cin-tour-dots" data-tour-dots></div>' +
        '  <button type="button" class="cin-btn" data-size="sm" data-variant="ghost" data-tour-skip></button>' +
        '  <button type="button" class="cin-btn" data-size="sm" data-variant="secondary" data-tour-prev></button>' +
        '  <button type="button" class="cin-btn" data-size="sm" data-variant="primary" data-tour-next data-autofocus></button>' +
        "</div>" +
        '<p class="cin-sr-only" aria-live="polite" data-tour-live></p>';
      root.append(spot, bubble);
      document.body.appendChild(root);
      bubble.querySelector("[data-tour-skip]").textContent = labels.skip;
      bubble.querySelector("[data-tour-prev]").textContent = labels.prev;
      bubble.querySelector("[data-tour-next]").textContent = labels.next;
      bubble.addEventListener("click", (e) => {
        if (e.target.closest("[data-tour-next]")) go(index + 1);
        else if (e.target.closest("[data-tour-prev]")) go(index - 1);
        else if (e.target.closest("[data-tour-skip]")) finish("skip");
      });
      window.addEventListener("resize", schedule);
      // 兜底：passive 滚动监听只做 rAF 合帧重排 transform，不写 layout 属性
      document.addEventListener("scroll", schedule, { passive: true, capture: true });
      document.addEventListener("keydown", onKey, true);
    };

    build();
    render();
    emit(root, "cin:tourstart", { total: steps.length });
    return { next: () => go(index + 1), prev: () => go(index - 1), close: () => finish("api") };
  };
})();


/* ---- palette.js ---- */
/* palette.js · 命令面板（围栏 + 模糊过滤 + Esc 归还焦点） */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  function open(wrap, opts) {
    const P = C.Primitives || {};
    const o = opts || {};
    const input = wrap.querySelector(".cin-palette-input");
    const items = () => Array.from(wrap.querySelectorAll(".cin-palette-item"));
    wrap.hidden = false;
    if (P.presence) P.presence.enter(wrap, "is-entering");
    const release = P.gate ? P.gate.open(wrap, { onClose: () => { wrap.hidden = true; } }) : () => { wrap.hidden = true; };
    let active = 0;

    const mark = (text, q) => {
      if (!q) return text;
      const i = text.toLowerCase().indexOf(q);
      if (i < 0) return text;
      return text.slice(0, i) + "<mark>" + text.slice(i, i + q.length) + "</mark>" + text.slice(i + q.length);
    };
    const filter = () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      items().forEach((it) => {
        const label = it.dataset.label || it.textContent.trim();
        const hit = !q || label.toLowerCase().includes(q);
        it.hidden = !hit;
        if (hit) {
          shown++;
          const labelEl = it.querySelector(".cin-palette-label");
          if (labelEl) labelEl.innerHTML = mark(label, q);
        }
      });
      active = 0;
      paint();
      wrap.dispatchEvent(new CustomEvent("cin:palette-filter", { bubbles: true, detail: { shown } }));
    };
    const paint = () => {
      const vis = items().filter((i) => !i.hidden);
      vis.forEach((it, k) => it.setAttribute("aria-selected", String(k === active)));
      if (vis[active]) vis[active].scrollIntoView({ block: "nearest" });
    };
    const run = (it) => {
      if (!it) return;
      emit(it, "cin:palette-run", { id: it.dataset.id });
      if (typeof o.onRun === "function") o.onRun(it.dataset.id, it);
      release("run");
    };

    input.addEventListener("input", filter);
    wrap.addEventListener("keydown", (e) => {
      const vis = items().filter((i) => !i.hidden);
      if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % Math.max(vis.length, 1); paint(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + vis.length) % Math.max(vis.length, 1); paint(); }
      else if (e.key === "Enter") { e.preventDefault(); run(vis[active]); }
    });
    wrap.addEventListener("click", (e) => { const it = e.target.closest(".cin-palette-item"); if (it) run(it); });
    filter();
    if (input) { input.value = ""; input.focus(); }
    return release;
  }

  C.palette = { open };
})();


/* ---- prompt-bar.js ---- */
/* prompt-bar.js · 输入器行为层（可选）
   没有本脚本时：form + textarea + 提交按钮照常工作，菜单与听写按钮不出现。
   结构：
   <form class="cin-prompt">
     <div class="cin-prompt-refs"></div>
     <textarea class="cin-prompt-field"></textarea>
     <p class="cin-prompt-error" hidden></p>
     <ul class="cin-prompt-menu" data-menu="command" role="listbox" hidden>…<li role="option" data-value="/x">…</ul>
     <ul class="cin-prompt-menu" data-menu="mention" role="listbox" hidden>…</ul>
     <ul class="cin-prompt-menu" data-menu="model" role="listbox" hidden>…</ul>
     <div class="cin-prompt-foot">…<button class="cin-prompt-tool" data-trigger="command">…</button>…</div>
   </form> */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;
  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  const readRefs = (root) =>
    Array.from(root.querySelectorAll(".cin-prompt-ref")).map((chip) => ({
      kind: chip.querySelector(".cin-prompt-ref-kind")?.textContent.trim() || "",
      name: chip.querySelector(".cin-prompt-ref-name")?.textContent.trim() || "",
    }));

  function setError(root, message) {
    const box = root.querySelector(".cin-prompt-error");
    const field = root.querySelector(".cin-prompt-field");
    if (!box) return;
    if (message) {
      box.textContent = message;
      box.hidden = false;
      root.dataset.state = "failed";
      field?.setAttribute("aria-invalid", "true");
    } else {
      box.hidden = true;
      delete root.dataset.state;
      field?.removeAttribute("aria-invalid");
    }
  }

  function init(root) {
    if (root.dataset.cinReady || root.hasAttribute("data-cin-no-init")) return;
    const field = root.querySelector(".cin-prompt-field");
    if (!field) return;
    root.dataset.cinReady = "1";
    if (!root.dataset.state) root.dataset.state = "idle";

    const ac = new AbortController();
    const on = { signal: ac.signal };
    const refs = root.querySelector(".cin-prompt-refs");
    const menus = new Map();
    root.querySelectorAll(".cin-prompt-menu[data-menu]").forEach((m) => menus.set(m.dataset.menu, m));
    const tools = new Map();
    root.querySelectorAll("[data-trigger]").forEach((b) => tools.set(b.dataset.trigger, b));
    const modelBtn = root.querySelector(".cin-prompt-model");
    const modelValue = root.querySelector(".cin-prompt-model-value");
    const modelInput = root.querySelector('input[name="model"]');
    const commandInput = root.querySelector('input[name="command"]');
    const mic = root.querySelector("[data-dictate]");

    let opened = null;
    let active = -1;

    const options = (menu) =>
      Array.from(menu.querySelectorAll('[role="option"]')).filter(
        (o) => !o.hidden && o.getAttribute("aria-disabled") !== "true"
      );

    const autoGrow = typeof CSS !== "undefined" && CSS.supports && CSS.supports("field-sizing", "content");
    function autosize() {
      if (autoGrow) return;
      field.style.height = "auto";
      const max = parseFloat(getComputedStyle(field).maxHeight) || Infinity;
      field.style.height = Math.min(field.scrollHeight, max) + "px";
    }

    function closeMenu(back) {
      if (!opened) return;
      opened.menu.hidden = true;
      opened.anchor?.setAttribute("aria-expanded", "false");
      field.removeAttribute("aria-activedescendant");
      opened = null;
      active = -1;
      if (back) field.focus();
    }

    function setActive(i) {
      if (!opened) return;
      const list = options(opened.menu);
      if (!list.length) return;
      active = (i + list.length) % list.length;
      list.forEach((o, k) => (k === active ? o.setAttribute("data-active", "") : o.removeAttribute("data-active")));
      if (!list[active].id) list[active].id = "cin-prompt-opt-" + Math.random().toString(36).slice(2, 7);
      field.setAttribute("aria-activedescendant", list[active].id);
      list[active].scrollIntoView({ block: "nearest" });
    }

    function openMenu(kind, anchor, query) {
      const menu = menus.get(kind);
      if (!menu) return;
      if (opened && opened.menu !== menu) closeMenu(false);
      menu.hidden = false;
      anchor?.setAttribute("aria-expanded", "true");
      opened = { kind, menu, anchor };
      active = -1;
      const q = (query || "").trim().toLowerCase();
      let hits = 0;
      menu.querySelectorAll('[role="option"]').forEach((o) => {
        const hay = (o.dataset.value || o.textContent).toLowerCase();
        const hit = !q || hay.includes(q);
        o.hidden = !hit;
        if (hit) hits++;
      });
      const empty = menu.querySelector(".cin-prompt-menu-empty");
      if (empty) empty.hidden = hits > 0;
      if (hits) setActive(0);
    }

    function addRef(kind, name) {
      if (!refs) return;
      const chip = document.createElement("span");
      chip.className = "cin-prompt-ref";
      const k = document.createElement("span");
      k.className = "cin-prompt-ref-kind";
      k.textContent = kind || "@";
      const n = document.createElement("span");
      n.className = "cin-prompt-ref-name";
      n.textContent = name;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "cin-prompt-ref-remove";
      rm.textContent = "\u00d7";
      rm.setAttribute("aria-label", root.dataset.removeLabel || tr("promptbar.removeRef", "移除来源 {name}", { name }));
      chip.append(k, n, rm);
      refs.appendChild(chip);
      emit(root, "cin:prompt-refs", { refs: readRefs(root) });
    }

    function choose(option) {
      const kind = opened?.kind;
      const value = option.dataset.value || option.textContent.trim();
      if (kind === "command") {
        const at = field.value.lastIndexOf("/");
        field.value = (at >= 0 ? field.value.slice(0, at) : field.value) + value + " ";
        if (commandInput) commandInput.value = value;
      } else if (kind === "mention") {
        addRef(option.dataset.kind, value);
        const at = field.value.lastIndexOf("@");
        if (at >= 0) {
          const head = field.value.slice(0, at);
          const tail = field.value.slice(at).replace(/^@[^\s@]*/, "");
          field.value = head + tail;
        }
      } else if (kind === "model") {
        if (modelValue) modelValue.textContent = value;
        if (modelInput) modelInput.value = value;
        emit(root, "cin:prompt-model", { model: value });
      }
      closeMenu(true);
      autosize();
      field.focus();
    }

    function submit() {
      if (root.hasAttribute("data-disabled")) return;
      const text = field.value.trim();
      const list = readRefs(root);
      if (!text && !list.length) {
        emit(root, "cin:prompt-empty", {});
        field.focus();
        return;
      }
      emit(root, "cin:prompt-submit", {
        text,
        refs: list,
        command: commandInput?.value || "",
        model: modelInput?.value || "",
      });
    }

    field.addEventListener(
      "input",
      () => {
        autosize();
        const before = field.value.slice(0, field.selectionStart ?? field.value.length);
        const cmd = /(?:^|\s)\/([\w-]*)$/.exec(before);
        const at = /(?:^|\s)@([^\s@]*)$/.exec(before);
        if (cmd) openMenu("command", tools.get("command"), cmd[1]);
        else if (at) openMenu("mention", tools.get("mention"), at[1]);
        else closeMenu(false);
      },
      on
    );

    field.addEventListener(
      "keydown",
      (e) => {
        if (e.isComposing) return;
        if (opened) {
          const list = options(opened.menu);
          if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); return; }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); return; }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (list[active]) choose(list[active]);
            return;
          }
          if (e.key === "Escape") { e.preventDefault(); closeMenu(true); return; }
          if (e.key === "Tab") { closeMenu(false); return; }
        }
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
      },
      on
    );

    root.addEventListener(
      "click",
      (e) => {
        const rm = e.target.closest(".cin-prompt-ref-remove");
        if (rm) {
          e.preventDefault();
          rm.closest(".cin-prompt-ref")?.remove();
          emit(root, "cin:prompt-refs", { refs: readRefs(root) });
          return;
        }
        const opt = e.target.closest('.cin-prompt-option[role="option"]');
        if (opt && opened) { e.preventDefault(); choose(opt); return; }
        const tool = e.target.closest("[data-trigger]");
        if (tool) {
          e.preventDefault();
          const kind = tool.dataset.trigger;
          if (opened && opened.kind === kind) closeMenu(true);
          else { openMenu(kind, tool, ""); field.focus(); }
          return;
        }
        if (modelBtn && e.target.closest(".cin-prompt-model")) {
          e.preventDefault();
          if (opened && opened.kind === "model") closeMenu(true);
          else { openMenu("model", modelBtn, ""); field.focus(); }
        }
      },
      on
    );

    root.addEventListener("submit", (e) => { e.preventDefault(); submit(); }, on);

    mic?.addEventListener(
      "click",
      () => {
        const next = mic.getAttribute("aria-pressed") !== "true";
        mic.setAttribute("aria-pressed", String(next));
        root.dataset.state = next ? "working" : "idle";
        emit(root, "cin:prompt-dictate", { on: next });
        if (!next) field.focus();
      },
      on
    );

    document.addEventListener("pointerdown", (e) => { if (opened && !root.contains(e.target)) closeMenu(false); }, on);

    autosize();
    root.cinPrompt = {
      submit,
      setError: (msg) => setError(root, msg),
      setState: (s) => { root.dataset.state = s; },
      destroy() { ac.abort(); closeMenu(false); delete root.dataset.cinReady; },
    };
    return root.cinPrompt;
  }

  C.promptBar = {
    init,
    initAll: (scope = document) => Array.from(scope.querySelectorAll(".cin-prompt")).map(init),
    setError,
  };
  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", () => C.promptBar.initAll())
    : C.promptBar.initAll();
})();


/* ---- pullrefresh.js ---- */
/* pullrefresh.js · 下拉刷新（手势阈值 + reduced-motion 直通 + 桌面按钮降级）
   <div class="cin-ptr" data-cin-status="idle">
     <div class="cin-ptr-indicator"><span class="cin-ptr-spinner"></span>下拉刷新</div>
     <button type="button" class="cin-ptr-fallback">刷新</button>
   </div> */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;
  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  function init(root, opts) {
    if (root.dataset.cinReady) return;
    root.dataset.cinReady = "1";
    const P = C.Primitives || {};
    const o = Object.assign({ threshold: 64, onRefresh: null }, opts || {});
    const indicator = root.querySelector(".cin-ptr-indicator");
    const scroller = root.querySelector("[data-ptr-scroll]") || root;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!root.hasAttribute("data-cin-status")) root.setAttribute("data-cin-status", "idle");
    const setOffset = (px) => root.style.setProperty("--cin-ptr-offset", px + "px");

    const run = () => {
      if (root.getAttribute("data-cin-status") === "busy") return Promise.resolve();
      if (P.status) P.status.set(root, "busy"); else root.setAttribute("data-cin-status", "busy");
      setOffset(reduced ? 8 : 48);
      if (indicator) indicator.setAttribute("aria-busy", "true");
      const job = typeof o.onRefresh === "function" ? o.onRefresh(root) : Promise.resolve();
      return Promise.resolve(job).then(
        () => {
          if (P.status) P.status.set(root, "idle"); else root.setAttribute("data-cin-status", "idle");
          setOffset(0);
          if (indicator) indicator.setAttribute("aria-busy", "false");
          emit(root, "cin:refresh-done", { ok: true });
        },
        (err) => {
          if (P.status) P.status.set(root, "error"); else root.setAttribute("data-cin-status", "error");
          setOffset(0);
          // 失败只走事件与状态，不向全局抛错，避免调用方漏接 catch
          emit(root, "cin:refresh-failed", { error: err });
        }
      );
    };

    if (P.gesture) {
      P.gesture.attach(root, {
        axis: "y",
        threshold: o.threshold,
        onMove: (delta) => {
          if (scroller.scrollTop > 0 || delta <= 0) return;
          setOffset(Math.min(delta * 0.5, o.threshold));
          if (indicator) indicator.lastChild.textContent = delta >= o.threshold ? tr("pullrefresh.release", "松开刷新") : tr("pullrefresh.pull", "下拉刷新");
        },
        onPull: (delta) => { if (delta >= o.threshold) run(); else setOffset(0); },
      });
    }
    const btn = root.querySelector(".cin-ptr-fallback");
    if (btn) btn.addEventListener("click", run);
    root.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.altKey) run(); });
  }

  C.pullRefresh = { init, initAll: (s = document, o) => s.querySelectorAll(".cin-ptr").forEach((el) => init(el, o)) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => C.pullRefresh.initAll());
  else C.pullRefresh.initAll();
})();


/* ---- pwstrength.js ---- */
/* pwstrength.js · 口令强度（只看结构，不读也不存明文长度） */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;
  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  function score(v) {
    if (!v) return 0;
    let s = 0;
    if (v.length >= 8) s++;
    if (v.length >= 12) s++;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
    if (/\d/.test(v)) s++;
    if (/[^\w\s]/.test(v)) s++;
    if (/^(.)\1+$/.test(v) || /^(?:1+2*3*\d*|abc\d*|qwerty\d*|password\d*|admin\d*|iloveyou)$/i.test(v)) s = 1;
    return Math.max(0, Math.min(4, s - 1));
  }
  const LABEL = [
    tr("pwstrength.level0", "太短"),
    tr("pwstrength.level1", "弱"),
    tr("pwstrength.level2", "一般"),
    tr("pwstrength.level3", "较强"),
    tr("pwstrength.level4", "很强"),
  ];

  function init(root) {
    if (root.dataset.cinReady) return;
    root.dataset.cinReady = "1";
    const input = root.querySelector(".cin-pwstrength-input");
    const note = root.querySelector(".cin-pwstrength-note");
    const rules = Array.from(root.querySelectorAll(".cin-pwstrength-rules li"));
    const metrics = [
      (v) => v.length >= 8,
      (v) => /[a-z]/.test(v) && /[A-Z]/.test(v),
      (v) => /\d/.test(v),
      (v) => /[^\w\s]/.test(v),
    ];
    const update = () => {
      const v = input.value;
      const s = score(v);
      root.setAttribute("data-score", String(s));
      rules.forEach((li, i) => { if (metrics[i] && metrics[i](v)) li.setAttribute("data-ok", ""); else li.removeAttribute("data-ok"); });
      if (note) note.textContent = v ? tr("pwstrength.note", "强度：{level}", { level: LABEL[s] }) : "";
      emit(root, "cin:pwstrength", { score: s });
    };
    input.addEventListener("input", update);
    update();
  }

  C.pwstrength = { init, initAll: (s = document) => s.querySelectorAll(".cin-pwstrength").forEach(init), score };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", () => C.pwstrength.initAll()) : C.pwstrength.initAll();
})();


/* ---- qrcode.js ---- */
/* qrcode.js 约定：自带编码器，不引第三方库、不发网络请求。
   支持字节模式（UTF-8）、版本 1-10 自动选择、L/M/Q/H 四档纠错、8 种掩码按惩罚函数择优。
   输出内联 SVG（path 合并连续暗块），模块色走 currentColor，交给 CSS 定尺寸与配色。
   结构：
     <div class="cin-qr" data-qr data-value="SO-20261101-0042" data-ecc="M" data-quiet="4"></div> */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;

  /* ---------------- GF(256) ---------------- */
  const EXP = new Array(512);
  const LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  function genPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i += 1) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j += 1) {
        next[j] ^= poly[j];
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsRemainder(data, gen) {
    const res = new Array(gen.length - 1).fill(0);
    for (const byte of data) {
      const factor = byte ^ res[0];
      res.shift();
      res.push(0);
      for (let i = 0; i < res.length; i += 1) res[i] ^= mul(gen[i + 1], factor);
    }
    return res;
  }

  /* ---------------- 版本表：[ecLen, 组1块数, 组1数据码字, 组2块数, 组2数据码字] ---------------- */
  const TABLES = {
    1: { L: [7, 1, 19, 0, 0], M: [10, 1, 16, 0, 0], Q: [13, 1, 13, 0, 0], H: [17, 1, 9, 0, 0] },
    2: { L: [10, 1, 34, 0, 0], M: [16, 1, 28, 0, 0], Q: [22, 1, 22, 0, 0], H: [28, 1, 16, 0, 0] },
    3: { L: [15, 1, 55, 0, 0], M: [26, 1, 44, 0, 0], Q: [18, 2, 17, 0, 0], H: [22, 2, 13, 0, 0] },
    4: { L: [20, 1, 80, 0, 0], M: [18, 2, 32, 0, 0], Q: [26, 2, 24, 0, 0], H: [16, 4, 9, 0, 0] },
    5: { L: [26, 1, 108, 0, 0], M: [24, 2, 43, 0, 0], Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
    6: { L: [18, 2, 68, 0, 0], M: [16, 4, 27, 0, 0], Q: [24, 4, 19, 0, 0], H: [28, 4, 15, 0, 0] },
    7: { L: [20, 2, 78, 0, 0], M: [18, 4, 31, 0, 0], Q: [18, 2, 14, 4, 15], H: [26, 4, 13, 1, 14] },
    8: { L: [24, 2, 97, 0, 0], M: [22, 2, 38, 2, 39], Q: [22, 4, 18, 2, 19], H: [26, 4, 14, 2, 15] },
    9: { L: [30, 2, 116, 0, 0], M: [22, 3, 36, 2, 37], Q: [20, 4, 16, 4, 17], H: [24, 4, 12, 4, 13] },
    10: { L: [18, 2, 68, 2, 69], M: [26, 4, 43, 1, 44], Q: [24, 6, 19, 2, 20], H: [28, 6, 15, 2, 16] },
  };
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };
  const ECL_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  const ECL_ORDER = ["L", "M", "Q", "H"];

  const dataCapacity = (version, ecl) => {
    const [ec, b1, d1, b2, d2] = TABLES[version][ecl];
    return b1 * d1 + b2 * d2;
  };

  /* ---------------- 编码 ---------------- */
  function encode(text, opt = {}) {
    const ecc = ECL_ORDER.includes(String(opt.ecc || "M").toUpperCase()) ? String(opt.ecc || "M").toUpperCase() : "M";
    const bytes = Array.from(new TextEncoder().encode(String(text ?? "")));
    if (!bytes.length) return null;

    let version = Number(opt.version) || 0;
    if (version) {
      if (!TABLES[version]) return null;
    } else {
      for (let v = 1; v <= 10; v += 1) {
        const countBits = v <= 9 ? 8 : 16;
        if ((dataCapacity(v, ecc) * 8) - 4 - countBits >= bytes.length * 8) {
          version = v;
          break;
        }
      }
      if (!version) return null;
    }
    const countBits = version <= 9 ? 8 : 16;
    if (bytes.length >= 1 << countBits) return null;
    if ((dataCapacity(version, ecc) * 8) - 4 - countBits < bytes.length * 8) return null;

    /* 数据码字：模式 0100 + 长度 + 载荷 + 终止符 + 填充 */
    const bits = [];
    const push = (value, len) => {
      for (let i = len - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
    };
    push(4, 4);
    push(bytes.length, countBits);
    bytes.forEach((b) => push(b, 8));
    const capacityBits = dataCapacity(version, ecc) * 8;
    push(0, Math.min(4, capacityBits - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
      data.push(byte);
    }
    let pad = 0xec;
    while (data.length < dataCapacity(version, ecc)) {
      data.push(pad);
      pad = pad === 0xec ? 0x11 : 0xec;
    }

    /* 分块加纠错并交错 */
    const [ecLen, b1, d1, b2, d2] = TABLES[version][ecc];
    const blocks = [];
    let offset = 0;
    for (let i = 0; i < b1; i += 1) {
      blocks.push(data.slice(offset, offset + d1));
      offset += d1;
    }
    for (let i = 0; i < b2; i += 1) {
      blocks.push(data.slice(offset, offset + d2));
      offset += d2;
    }
    const gen = genPoly(ecLen);
    const eccs = blocks.map((block) => rsRemainder(block, gen));
    const codewords = [];
    const maxLen = Math.max(...blocks.map((b) => b.length));
    for (let i = 0; i < maxLen; i += 1) {
      for (const block of blocks) if (i < block.length) codewords.push(block[i]);
    }
    for (let i = 0; i < ecLen; i += 1) {
      for (const e of eccs) codewords.push(e[i]);
    }

    const modules = buildMatrix(version, ecc, codewords);
    return { version, size: modules.length, modules, ecc };
  }

  /* ---------------- 矩阵 ---------------- */
  function buildMatrix(version, ecc, codewords) {
    const size = version * 4 + 17;
    const mods = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));

    const set = (x, y, dark) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      mods[y][x] = !!dark;
      fn[y][x] = true;
    };

    // 定时图案
    for (let i = 0; i < size; i += 1) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    // 三个寻像图案（含分隔带）
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          set(cx + dx, cy + dy, dist !== 2 && dist !== 4);
        }
      }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    // 校正图案（跳过与寻像图案重叠的三处）
    const align = ALIGN[version];
    for (let i = 0; i < align.length; i += 1) {
      for (let j = 0; j < align.length; j += 1) {
        const corner = (i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0);
        if (corner) continue;
        const cx = align[i];
        const cy = align[j];
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }

    // 预留格式信息区（先落一遍占位，避免数据写进去）
    const drawFormat = (mask) => {
      const data = (ECL_BITS[ecc] << 3) | mask;
      let rem = data;
      for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      const bit = (i) => ((bits >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i += 1) set(8, i, bit(i));
      set(8, 7, bit(6));
      set(8, 8, bit(7));
      set(7, 8, bit(8));
      for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true); // 固定暗模块
    };
    drawFormat(0);

    // 版本信息（v7 起）
    if (version >= 7) {
      let rem = version;
      for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (version << 12) | rem;
      for (let i = 0; i < 18; i += 1) {
        const dark = ((bits >>> i) & 1) !== 0;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        set(a, b, dark);
        set(b, a, dark);
      }
    }

    // 数据放置：右下起，两列一组之字形，跳过第 6 列定时线
    let bitIndex = 0;
    const totalBits = codewords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (fn[y][x] || bitIndex >= totalBits) continue;
          mods[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
          bitIndex += 1;
        }
      }
    }

    // 掩码：逐个试，取惩罚最低的那一个
    const maskFn = [
      (x, y) => (x + y) % 2 === 0,
      (x, y) => y % 2 === 0,
      (x, y) => x % 3 === 0,
      (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
      (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
      (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    const apply = (mask) => {
      const out = mods.map((row) => row.slice());
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          if (!fn[y][x] && maskFn[mask](x, y)) out[y][x] = !out[y][x];
        }
      }
      return out;
    };
    const penalty = (m) => {
      let score = 0;
      for (let y = 0; y < size; y += 1) {
        let run = 1;
        for (let x = 1; x < size; x += 1) {
          if (m[y][x] === m[y][x - 1]) {
            run += 1;
            if (run === 5) score += 3;
            else if (run > 5) score += 1;
          } else run = 1;
        }
      }
      for (let x = 0; x < size; x += 1) {
        let run = 1;
        for (let y = 1; y < size; y += 1) {
          if (m[y][x] === m[y - 1][x]) {
            run += 1;
            if (run === 5) score += 3;
            else if (run > 5) score += 1;
          } else run = 1;
        }
      }
      for (let y = 0; y < size - 1; y += 1) {
        for (let x = 0; x < size - 1; x += 1) {
          const c = m[y][x];
          if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
        }
      }
      // 寻像图案近似（11 位窗口，ISO 的两条 1:1:3:1:1 变体）横向与纵向
      const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
      const P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
      const scanLine = (get) => {
        let line = 0;
        let i = 0;
        const limit = size - 11;
        while (i <= limit) {
          let hit1 = true;
          let hit2 = true;
          for (let j = 0; j < 11; j += 1) {
            const v = get(i + j) ? 1 : 0;
            if (v !== P1[j]) hit1 = false;
            if (v !== P2[j]) hit2 = false;
            if (!hit1 && !hit2) break;
          }
          if (hit1 || hit2) line += 40;
          // 末位为暗时下一个窗口起点至少后移 2，省掉不可能命中的位置
          i += get(i + 10) ? 2 : 1;
        }
        return line;
      };
      for (let y = 0; y < size; y += 1) score += scanLine((x) => m[y][x]);
      for (let x = 0; x < size; x += 1) score += scanLine((y) => m[y][x]);
      let dark = 0;
      for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (m[y][x]) dark += 1;
      const percent = (dark * 100) / (size * size);
      score += Math.floor(Math.abs(percent - 50) / 5) * 10;
      return score;
    };

    let best = 0;
    let bestMask = apply(0);
    let bestScore = penalty(bestMask);
    for (let mask = 1; mask < 8; mask += 1) {
      const cand = apply(mask);
      const score = penalty(cand);
      if (score < bestScore) {
        best = mask;
        bestScore = score;
        bestMask = cand;
      }
    }
    const final = bestMask;
    // 用选定的掩码重画格式信息（function 模块不参与掩码，直接覆盖即可）
    const setFinal = (x, y, dark) => {
      final[y][x] = !!dark;
    };
    const data2 = (ECL_BITS[ecc] << 3) | best;
    let rem2 = data2;
    for (let i = 0; i < 10; i += 1) rem2 = (rem2 << 1) ^ ((rem2 >>> 9) * 0x537);
    const bits2 = ((data2 << 10) | rem2) ^ 0x5412;
    const bit2 = (i) => ((bits2 >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i += 1) setFinal(8, i, bit2(i));
    setFinal(8, 7, bit2(6));
    setFinal(8, 8, bit2(7));
    setFinal(7, 8, bit2(8));
    for (let i = 9; i < 15; i += 1) setFinal(14 - i, 8, bit2(i));
    for (let i = 0; i < 8; i += 1) setFinal(size - 1 - i, 8, bit2(i));
    for (let i = 8; i < 15; i += 1) setFinal(8, size - 15 + i, bit2(i));
    setFinal(8, size - 8, true);

    return final;
  }

  /* ---------------- SVG ---------------- */
  function toSvg(matrix, opt = {}) {
    const quiet = Math.max(0, Number(opt.quiet ?? 4));
    const n = matrix.length;
    const dim = n + quiet * 2;
    let path = "";
    for (let y = 0; y < n; y += 1) {
      let x = 0;
      while (x < n) {
        if (!matrix[y][x]) {
          x += 1;
          continue;
        }
        let len = 1;
        while (x + len < n && matrix[y][x + len]) len += 1;
        path += `M${x + quiet} ${y + quiet}h${len}v1h-${len}z`;
        x += len;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" role="img" shape-rendering="crispEdges"><path d="${path}"/></svg>`;
  }

  function renderQRCode(text, opt = {}) {
    const data = encode(text, opt);
    if (!data) return "";
    return toSvg(data.modules, opt);
  }

  function initQRCodes(scope = document) {
    const list = [];
    if (scope && scope.matches && scope.matches("[data-qr]")) list.push(scope);
    if (scope && scope.querySelectorAll) list.push(...scope.querySelectorAll("[data-qr]"));
    let n = 0;
    list.forEach((el) => {
      if (el.__cinQr) return;
      el.__cinQr = true;
      const value = el.getAttribute("data-value") ?? (el.textContent || "").trim();
      const opt = {
        ecc: el.getAttribute("data-ecc") || "M",
        version: Number(el.getAttribute("data-version")) || 0,
        quiet: Number(el.getAttribute("data-quiet") ?? 4),
      };
      const svg = renderQRCode(value, opt);
      if (!svg) {
        el.setAttribute("data-error", "");
        el.textContent = el.getAttribute("data-error-text") || tr("qrcode.overflow", "内容过长，无法生成");
        return;
      }
      el.innerHTML = svg;
      const label = el.getAttribute("data-label") || value;
      const svgEl = el.querySelector("svg");
      if (svgEl && !svgEl.querySelector("title")) {
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = label;
        svgEl.prepend(title);
      }
      el.setAttribute("data-qr-ready", "");
      n += 1;
    });
    return n;
  }

  C.encodeQR = encode;
  C.renderQRCode = renderQRCode;
  C.initQRCodes = initQRCodes;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initQRCodes(), { once: true });
  } else {
    initQRCodes();
  }
})();


/* ---- rating.js ---- */
/* rating.js 约定：选中态的点亮完全由 CSS 负责（input:checked + :has 反向兄弟），
   脚本不介入配色，只补三件事：
     1) 悬停预览（给前 n 颗挂 is-preview，移出容器即清空）；
     2) 只读渲染（读 data-value 给前 n 颗挂 is-on，并禁用 radio 保留语义）；
     3) 数值输出同步与 cin:rate 外抛。
   结构：
     <fieldset class="cin-rating" data-rating>
       <div class="cin-rating-stars">
         <input class="cin-rating-input" type="radio" name="r1" id="r1-1" value="1">
         <label class="cin-rating-star" for="r1-1"><span class="cin-sr-only">1 星</span></label>
         …
       </div>
       <output class="cin-rating-output"></output>
     </fieldset> */
(() => {
  const C = (window.Cinder = window.Cinder || {});

  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  const collect = (scope, sel) => {
    if (!scope) return [];
    const list = [];
    if (scope.matches && scope.matches(sel)) list.push(scope);
    if (scope.querySelectorAll) list.push(...scope.querySelectorAll(sel));
    return list;
  };

  const starsOf = (root) => Array.from(root.querySelectorAll(".cin-rating-star"));
  const inputsOf = (root) => Array.from(root.querySelectorAll(".cin-rating-input"));

  const mark = (stars, n, cls) => {
    stars.forEach((star, i) => star.classList.toggle(cls, i < n));
  };

  function valueOf(root) {
    const checked = inputsOf(root).find((i) => i.checked);
    if (checked) return Number(checked.value);
    const fixed = root.getAttribute("data-value");
    return fixed === null ? 0 : Number(fixed);
  }

  function syncOutput(root, value) {
    const out = root.querySelector(".cin-rating-output");
    if (out && value > 0) out.textContent = value.toFixed(1);
  }

  function bind(root) {
    if (root.__cinRating) return false;
    root.__cinRating = true;

    const stars = starsOf(root);
    const inputs = inputsOf(root);
    const readonly = root.hasAttribute("data-readonly") || root.hasAttribute("readonly");

    if (readonly) {
      const value = Number(root.getAttribute("data-value") || 0);
      inputs.forEach((input) => {
        input.disabled = true;
      });
      mark(stars, Math.round(value), "is-on");
      syncOutput(root, value);
      return true;
    }

    stars.forEach((star, i) => {
      star.addEventListener("pointerenter", () => mark(stars, i + 1, "is-preview"));
      star.addEventListener("pointerleave", () => mark(stars, 0, "is-preview"));
    });
    root.addEventListener("pointerleave", () => mark(stars, 0, "is-preview"));

    inputs.forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        const value = Number(input.value);
        syncOutput(root, value);
        emit(root, "cin:rate", { value, max: inputs.length });
      });
    });

    const initial = valueOf(root);
    if (initial > 0) syncOutput(root, initial);

    return true;
  }

  function initRatings(scope = document) {
    let n = 0;
    collect(scope, "[data-rating], .cin-rating").forEach((root) => {
      if (bind(root)) n += 1;
    });
    return n;
  }

  /** 脚本侧选中：值和 radio 的 value 对齐即可，0 表示清空 */
  function setRating(target, value) {
    if (!target || target.nodeType !== 1) return null;
    const root = target.matches("[data-rating], .cin-rating") ? target : target.closest("[data-rating], .cin-rating");
    if (!root) return null;

    const v = Number(value);
    if (root.hasAttribute("data-readonly")) {
      root.setAttribute("data-value", String(v));
      mark(starsOf(root), Math.round(v), "is-on");
      syncOutput(root, v);
      return v;
    }

    const inputs = inputsOf(root);
    inputs.forEach((input) => {
      input.checked = Number(input.value) === v;
    });
    syncOutput(root, v);
    emit(root, "cin:rate", { value: v, max: inputs.length });
    return v;
  }

  C.initRatings = initRatings;
  C.setRating = setRating;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initRatings(), { once: true });
  } else {
    initRatings();
  }
})();


/* ---- reveal.js ---- */
/* reveal.js · 敏感值揭示（T37，按住或点按切换；键盘 Space 等价；失焦自动收回）
   纪律：明文只存在于 input.value 与 input.type，不写入任何 data-* 属性、不打印日志。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const HIDE = "password";
  const SHOW = "text";
  const isField = (el) => el && el.tagName === "INPUT" && (el.type === HIDE || el.type === SHOW);
  const show = (box) => {
    const inp = box.querySelector("input");
    if (!isField(inp)) return;
    inp.type = SHOW;
    box.dataset.revealed = "";
    inp.setAttribute("aria-pressed", "true");
  };
  const hide = (box) => {
    const inp = box.querySelector("input");
    if (!isField(inp)) return;
    if (inp.type === SHOW) inp.type = HIDE;
    delete box.dataset.revealed;
    inp.setAttribute("aria-pressed", "false");
  };
  const toggle = (box) => (box.dataset.revealed === "" ? hide(box) : show(box));

  function init(box) {
    if (!box || box.dataset.cinReveal) return;
    box.dataset.cinReveal = "1";
    const btn = box.querySelector(".cin-reveal-toggle");
    const inp = box.querySelector("input");
    if (!inp) return;
    if (!inp.hasAttribute("aria-pressed")) inp.setAttribute("aria-pressed", "false");
    if (btn) {
      btn.setAttribute("type", "button");
      btn.setAttribute("aria-controls", inp.id || "");
      btn.addEventListener("click", () => toggle(box));
    }
    /* 按住揭示：指针与键盘等价 */
    const press = (e) => {
      if (btn && e.target === btn) return;
      if (e.type === "keydown" && e.key !== " " && e.code !== "Space") return;
      if (e.type === "keydown" && e.repeat) return;
      show(box);
    };
    const release = () => hide(box);
    box.addEventListener("pointerdown", press);
    box.addEventListener("pointerup", release);
    box.addEventListener("pointercancel", release);
    box.addEventListener("pointerleave", release);
    box.addEventListener("keydown", press);
    box.addEventListener("keyup", release);
    /* 失焦 / 离开页面自动收回 */
    box.addEventListener("focusout", () => {
      if (!box.contains(document.activeElement)) hide(box);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) hide(box);
    });
  }
  function destroy(box) {
    (box ? [box] : [...document.querySelectorAll("[data-cin-reveal]")]).forEach((el) => {
      delete el.dataset.cinReveal;
      hide(el);
    });
  }
  C.reveal = { init, initAll: (s = document) => s.querySelectorAll(".cin-reveal").forEach(init), destroy };
  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", () => C.reveal.initAll())
    : C.reveal.initAll();
})();


/* ---- segmented.js ---- */
/* segmented.js 约定：无脚本时就是一组同 name 的原生 radio，点选与提交照常，
   选中态由 :checked 纯 CSS 表达；JS 只补 data-value 同步、方向键与 cin:segmentchange 事件。
   结构：<div class="cin-segmented" data-segmented data-value="day" role="radiogroup" aria-label="视图">
           <label class="cin-segmented-item"><input type="radio" name="view" value="day" checked><span class="cin-segmented-label">日</span></label>
           <label class="cin-segmented-item"><input type="radio" name="view" value="week"><span class="cin-segmented-label">周</span></label>
         </div> */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  const state = new WeakMap();

  const emit = (el, type, detail = {}) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  const itemsOf = (root) => [...root.querySelectorAll("input[type='radio']")];
  const checkedOf = (root) => itemsOf(root).find((input) => input.checked) || null;
  const valueOf = (root) => {
    const picked = checkedOf(root);
    return picked ? picked.value : "";
  };

  function sync(root, previous, reason = "click") {
    const value = valueOf(root);
    root.dataset.value = value;
    if (value !== previous) emit(root, "cin:segmentchange", { value, previous, reason });
    return value;
  }

  function select(root, input, reason = "api") {
    if (!input || input.disabled) return valueOf(root);
    const previous = valueOf(root);
    input.checked = true;
    return sync(root, previous, reason);
  }

  function attach(root) {
    if (state.has(root)) return state.get(root);
    const inputs = itemsOf(root);
    if (!inputs.length) return null;
    if (!root.getAttribute("role")) root.setAttribute("role", "radiogroup");
    const initial = root.dataset.value;
    if (initial !== undefined && initial !== "") {
      const wanted = inputs.find((input) => input.value === initial);
      if (wanted && !wanted.checked) wanted.checked = true;
    }
    root.dataset.value = valueOf(root);
    // 单选组靠 change 冒泡收口，不在每个 input 上挂监听
    root.addEventListener("change", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "radio") return;
      if (!root.contains(input)) return;
      const previous = root.dataset.value;
      sync(root, previous, "click");
    });
    root.addEventListener("keydown", (event) => {
      const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
      if (!keys.includes(event.key)) return;
      const active = itemsOf(root).filter((input) => !input.disabled);
      if (!active.length) return;
      const current = active.indexOf(document.activeElement instanceof HTMLInputElement ? document.activeElement : checkedOf(root));
      const last = active.length - 1;
      let next = current < 0 ? 0 : current;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = current <= 0 ? last : current - 1;
      else if (event.key === "ArrowRight" || event.key === "ArrowDown") next = current >= last ? 0 : current + 1;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = last;
      event.preventDefault();
      const target = active[next];
      target.focus();
      select(root, target, "keyboard");
    });
    state.set(root, true);
    return root;
  }

  const resolve = (target) =>
    target instanceof Element
      ? target.matches("[data-segmented], .cin-segmented")
        ? target
        : target.closest("[data-segmented], .cin-segmented")
      : null;

  C.initSegmenteds = (scope = document) => {
    const list = [...scope.querySelectorAll("[data-segmented], .cin-segmented")];
    for (const root of list) attach(root);
    return list.length;
  };

  C.setSegmented = (target, value) => {
    const root = resolve(target);
    if (!root) return null;
    attach(root);
    const picked = itemsOf(root).find((input) => input.value === String(value));
    if (!picked) return valueOf(root);
    return select(root, picked, "api");
  };

  C.segmented = (target) => {
    const root = resolve(target);
    if (!root) return null;
    attach(root);
    return {
      get value() {
        return valueOf(root);
      },
      set: (value) => C.setSegmented(root, value),
      get options() {
        return itemsOf(root).map((input) => ({ value: input.value, disabled: input.disabled }));
      },
    };
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => C.initSegmenteds());
  else C.initSegmenteds();
})();


/* ---- selection-actions.js ---- */
/* selection-actions：划词操作条行为层
   契约：
     - 无本脚本时组件不出现（CSS 基础态 display:none，挂载后才 data-ready）
     - 只挂 window.Cinder，不污染全局
     - 定位只写 --cin-selactions-x/y，翻转交给 CSS 的 data-placement
     - 不抢焦点：内部不自动 focus，键盘用方向键在动作间移动
     - 事件三件套：cin:selection-open / cin:selection-action / cin:selection-dismiss
     - 可销毁：AbortController 统一解绑 */
(function () {
  "use strict";

  const C = (window.Cinder = window.Cinder || {});

  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;

  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  const MIN_CHARS = 2;
  const MAX_CHARS = 4000;
  const PREVIEW_CHARS = 120;
  const GAP = 8;
  const EDGE = 8;
  const FOCUSABLE = ".cin-selactions-action, .cin-selactions-dismiss";
  const STATES = ["working", "failed"];

  const $ = (root, sel) => root.querySelector(sel);

  /* 读取当前文档选区；落在组件内部、太短、太长、无几何盒子的一律不弹 */
  function readSelection(root) {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!range || root.contains(range.commonAncestorContainer)) return null;
    const text = String(sel);
    const trimmed = text.trim();
    if (trimmed.length < MIN_CHARS || trimmed.length > MAX_CHARS) return null;
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return null;
    return { text, trimmed, rect };
  }

  function mount(root) {
    if (!root) return null;
    if (root.cinSelectionActions) return root.cinSelectionActions;

    const ac = new AbortController();
    const signal = ac.signal;
    const doc = root.ownerDocument || document;
    const win = doc.defaultView || window;
    const panel = $(root, ".cin-selactions-panel");
    const bar = $(root, ".cin-selactions-bar");
    const quote = $(root, ".cin-selactions-quote-text");
    const errorBox = $(root, ".cin-selactions-error");
    const dismiss = $(root, ".cin-selactions-dismiss");

    let text = "";
    let openedBy = "";

    root.setAttribute("data-ready", "");
    if (bar) bar.setAttribute("aria-label", tr("selactions.label", "选中文本操作"));
    if (dismiss) dismiss.setAttribute("aria-label", tr("selactions.close", "关闭"));
    if (errorBox) errorBox.hidden = true;

    const actions = () => Array.from(root.querySelectorAll(".cin-selactions-action"));
    const isOpen = () => root.hasAttribute("data-open");

    function clearError() {
      if (!errorBox) return;
      errorBox.textContent = "";
      errorBox.hidden = true;
    }

    function clearPressed() {
      actions().forEach((btn) => btn.removeAttribute("aria-pressed"));
    }

    function resetState() {
      STATES.forEach((s) => root.removeAttribute("data-state"));
      if (panel) panel.removeAttribute("aria-busy");
      clearPressed();
      clearError();
    }

    /* 只算位移量；上下翻转由 data-placement 决定 */
    function place(rect) {
      const vw = doc.documentElement.clientWidth || win.innerWidth || 0;
      const vh = doc.documentElement.clientHeight || win.innerHeight || 0;
      root.removeAttribute("data-placement");

      const w = root.offsetWidth || 0;
      const h = root.offsetHeight || 0;
      const roomAbove = rect.top - h - GAP >= EDGE;
      const roomBelow = rect.bottom + h + GAP <= vh - EDGE;
      const useAbove = roomAbove || (!roomBelow && rect.top > vh - rect.bottom);

      const x = Math.min(Math.max(rect.left + rect.width / 2 - w / 2, EDGE), Math.max(EDGE, vw - w - EDGE));
      const y = useAbove ? rect.top - GAP : rect.bottom + GAP;

      root.style.setProperty("--cin-selactions-x", `${Math.round(x)}px`);
      root.style.setProperty("--cin-selactions-y", `${Math.round(y)}px`);
      if (useAbove) root.setAttribute("data-placement", "above");
    }

    function preview(value) {
      const oneLine = value.replace(/\s+/g, " ");
      return oneLine.length > PREVIEW_CHARS ? `${oneLine.slice(0, PREVIEW_CHARS)}…` : oneLine;
    }

    function open(selection, trigger) {
      text = selection.text;
      openedBy = trigger || "pointer";
      resetState();
      if (quote) quote.textContent = preview(selection.trimmed);
      root.setAttribute("data-open", "");
      place(selection.rect);
      emit(root, "cin:selection-open", { text, trigger: openedBy });
    }

    function close(reason) {
      if (!isOpen()) return;
      root.removeAttribute("data-open");
      root.removeAttribute("data-placement");
      text = "";
      openedBy = "";
      emit(root, "cin:selection-dismiss", { reason: reason || "outside" });
    }

    function setState(state, message) {
      if (!state || state === "idle" || state === "done") {
        resetState();
        if (state === "done") close("done");
        return;
      }
      if (state === "working") {
        clearError();
        if (panel) panel.setAttribute("aria-busy", "true");
        root.setAttribute("data-state", "working");
        return;
      }
      if (state === "failed") {
        STATES.forEach((s) => root.removeAttribute("data-state"));
        if (panel) panel.removeAttribute("aria-busy");
        clearPressed();
        root.setAttribute("data-state", "failed");
        if (errorBox) {
          errorBox.textContent = message || tr("selactions.failed", "操作未完成，请重试");
          errorBox.hidden = false;
        }
      }
    }

    function focusStep(dir) {
      const list = actions().filter((btn) => !btn.disabled);
      if (!list.length) return;
      const current = list.indexOf(doc.activeElement);
      const next = current < 0 ? (dir > 0 ? 0 : list.length - 1) : (current + dir + list.length) % list.length;
      list[next].focus();
    }

    function trigger(btn, source) {
      if (!btn || root.getAttribute("data-state") === "working") return;
      clearPressed();
      btn.setAttribute("aria-pressed", "true");
      setState("working");
      emit(root, "cin:selection-action", {
        action: btn.getAttribute("data-action") || "",
        text,
        trigger: source,
      });
    }

    /* 选区变化：拖动/双击/键盘扩选都会走到这里 */
    function sync(reason) {
      const selection = readSelection(root);
      if (!selection) {
        if (isOpen() && reason !== "action") close(reason);
        return;
      }
      if (isOpen() && selection.text === text) {
        place(selection.rect);
        return;
      }
      open(selection, reason);
    }

    doc.addEventListener(
      "pointerup",
      (event) => {
        if (root.contains(event.target)) return;
        win.setTimeout(() => sync("pointer"), 0);
      },
      { signal }
    );

    doc.addEventListener(
      "keyup",
      (event) => {
        if (root.contains(event.target)) return;
        if (event.key === "Escape") return;
        if (event.shiftKey || event.key === "Shift" || event.key.indexOf("Arrow") === 0) {
          sync("keyboard");
        }
      },
      { signal }
    );

    doc.addEventListener("selectionchange", () => {
      const sel = doc.getSelection();
      if (!sel || sel.isCollapsed) return;
      if (root.contains(sel.anchorNode)) return;
      sync("selection");
    }, { signal });

    win.addEventListener("scroll", () => close("scroll"), { signal, capture: true });
    win.addEventListener("resize", () => close("resize"), { signal });

    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close("escape");
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        focusStep(1);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        focusStep(-1);
      }
    }, { signal });

    root.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof win.Element)) return;
      if (target.closest(".cin-selactions-dismiss")) {
        close("dismiss");
        return;
      }
      const btn = target.closest(".cin-selactions-action");
      if (btn) trigger(btn, "pointer");
    }, { signal });

    const api = {
      open() {
        const selection = readSelection(root);
        if (selection) open(selection, "api");
        return !!selection;
      },
      close,
      setState,
      setError: (message) => setState("failed", message),
      get text() {
        return text;
      },
      get open() {
        return isOpen();
      },
      destroy() {
        ac.abort();
        root.removeAttribute("data-ready");
        root.removeAttribute("data-open");
        root.removeAttribute("data-placement");
        delete root.cinSelectionActions;
      },
    };

    root.cinSelectionActions = api;
    return api;
  }

  function initAll(scope) {
    const host = scope || document;
    Array.from(host.querySelectorAll(".cin-selactions")).forEach(mount);
  }

  C.selectionActions = { mount, initAll };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initAll());
  } else {
    initAll();
  }
})();


/* ---- sidenav.js ---- */
/* sidenav.js 约定：无 JS 时子级全部展开可见、折叠按钮保持 hidden（不摆无效按钮），导航可正常点击。
   JS 只负责：折叠切换、子级展开/收起（aria-expanded + hidden）、窄屏抽屉（遮罩 / Esc / 焦点归还）、
   导航项 ↑↓ Home End 漫游（roving tabindex，展开时 ArrowDown 进子级、子级 ArrowLeft 回父级）、
   事件外抛 cin:sidenav-toggle / cin:sidenav-open / cin:sidenav-close。
   与 tabs.js 的分工：tabs 管同一区域内的多面板切换，sidenav 只管「去哪」的导航树，不承载面板显隐。
   与 shell.css 的分工：侧栏容器与宽度归 shell，本层只管导航树与抽屉状态（容器靠 :has 响应 data-drawer）。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  // 900px 是 tokens 里的 md 断点；用 .98 让分界点归宽屏，避免与 min-width:900 重叠
  const DRAWER_MQ = "(max-width: 899.98px)";

  const emit = (el, type, detail = {}) =>
    el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  const tr = (key, fallback) => {
    try {
      const i18n = C.Primitives && C.Primitives.i18n;
      return (i18n && i18n.t && i18n.t(key)) || fallback;
    } catch {
      return fallback;
    }
  };

  const q = (root, sel) => root.querySelector(sel);
  const qa = (root, sel) => Array.from(root.querySelectorAll(sel));

  const isDrawer = (root) => root.hasAttribute("data-drawer");
  const wideEnough = () => !window.matchMedia(DRAWER_MQ).matches;

  /** 顶层项：不落在 .cin-sidenav-sub 里的项，才是漫游主轴 */
  const topItems = (root) => qa(root, ".cin-sidenav-item").filter((el) => !el.closest(".cin-sidenav-sub"));
  const allItems = (root) => qa(root, ".cin-sidenav-item");
  /** 可见项：子级收起时其中的项不算，避免方向键把焦点送进 hidden 区域 */
  const visibleItems = (root) => allItems(root).filter((el) => !el.closest("[hidden]"));

  const hasSub = (el) => !!el.getAttribute("aria-controls");

  /** 单项可聚焦：全局 roving，同一时刻只有一个 tabindex=0 */
  function focusItem(root, el) {
    if (!el) return;
    allItems(root).forEach((it) => it.setAttribute("tabindex", it === el ? "0" : "-1"));
    el.focus();
  }

  function initRoving(root) {
    const first = visibleItems(root)[0];
    allItems(root).forEach((el) => el.setAttribute("tabindex", el === first ? "0" : "-1"));
  }

  /* ---------- 子级 ---------- */
  function setExpanded(trigger, open) {
    const id = trigger.getAttribute("aria-controls");
    if (!id) return;
    const sub = trigger.ownerDocument.getElementById(id);
    if (!sub) return;
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
    sub.hidden = !open;
  }

  /* ---------- 折叠 ---------- */
  function setCollapsed(root, collapsed) {
    root.toggleAttribute("data-collapsed", !!collapsed);
    const toggle = q(root, ".cin-sidenav-toggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.setAttribute("aria-label", collapsed ? tr("sidenav.expand", "展开导航") : tr("sidenav.collapse", "收起导航"));
    }
    // 侧栏容器宽度跟着切（shell.css 的 .cin-sidebar[data-collapsed]）
    const bar = root.closest(".cin-sidebar");
    if (bar) bar.toggleAttribute("data-collapsed", !!collapsed);
    emit(root, "cin:sidenav-toggle", { collapsed: !!collapsed });
  }

  /* ---------- 抽屉 ---------- */
  function ensureScrim(doc) {
    let scrim = doc.querySelector(".cin-sidenav-scrim");
    if (!scrim) {
      scrim = doc.createElement("div");
      scrim.className = "cin-sidenav-scrim";
      scrim.setAttribute("aria-hidden", "true");
      (doc.body || doc.documentElement).appendChild(scrim);
    }
    return scrim;
  }

  function openDrawer(root, opener) {
    // ≥900px 没有抽屉形态：侧栏本就常驻，打开请求视为无效，避免留下滚动锁与遮罩
    if (wideEnough()) return false;
    const doc = root.ownerDocument;
    const scrim = ensureScrim(doc);
    root._cinSidenavOpener = opener || doc.activeElement;
    root.setAttribute("data-open", "");
    scrim.setAttribute("data-open", "");
    if (doc.body) doc.body.style.setProperty("overflow", "hidden");
    // 容器 visibility 从 hidden 切过来，等一帧再抢焦点，否则 focus 会落空
    if (root._cinSidenavFrame) cancelAnimationFrame(root._cinSidenavFrame);
    root._cinSidenavFrame = requestAnimationFrame(() => {
      root._cinSidenavFrame = 0;
      if (!root.hasAttribute("data-open")) return;
      const first = visibleItems(root)[0];
      if (first) first.focus();
    });
    emit(root, "cin:sidenav-open", {});
    return true;
  }

  function closeDrawer(root, reason = "close") {
    const doc = root.ownerDocument;
    const wasOpen = root.hasAttribute("data-open");
    root.removeAttribute("data-open");
    const scrim = doc.querySelector(".cin-sidenav-scrim");
    if (scrim) scrim.removeAttribute("data-open");
    if (doc.body) doc.body.style.removeProperty("overflow");
    if (!wasOpen) return;
    const opener = root._cinSidenavOpener;
    root._cinSidenavOpener = null;
    if (opener && typeof opener.focus === "function" && doc.contains(opener)) opener.focus();
    emit(root, "cin:sidenav-close", { reason });
  }

  /* ---------- 键盘 ---------- */
  function onKeydown(root, e) {
    const doc = root.ownerDocument;

    if (e.key === "Escape") {
      if (isDrawer(root) && root.hasAttribute("data-open")) {
        e.preventDefault();
        closeDrawer(root, "escape");
      }
      return;
    }

    const inDrawer = isDrawer(root) && root.hasAttribute("data-open");
    if (inDrawer && e.key === "Tab") {
      // 抽屉内轻量焦点环：不把焦点漏到遮罩后面的页面
      const items = visibleItems(root).filter((el) => !el.hasAttribute("disabled"));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = doc.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        focusItem(root, last);
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        focusItem(root, first);
      }
      return;
    }

    const active = doc.activeElement;
    if (!active || !root.contains(active) || !active.classList.contains("cin-sidenav-item")) return;
    const items = visibleItems(root);
    const i = items.indexOf(active);
    const sub = active.closest(".cin-sidenav-sub");
    const isTop = !sub;

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        if (isTop && active.getAttribute("aria-expanded") === "true") {
          const subEl = doc.getElementById(active.getAttribute("aria-controls"));
          const first = subEl && !subEl.hidden ? subEl.querySelector(".cin-sidenav-item") : null;
          if (first) return focusItem(root, first);
        }
        if (items[i + 1]) return focusItem(root, items[i + 1]);
        return focusItem(root, items[0]);
      }
      case "ArrowUp": {
        e.preventDefault();
        if (sub) {
          const firstInSub = sub.querySelector(".cin-sidenav-item");
          if (active === firstInSub) {
            const trigger = sub.previousElementSibling;
            if (trigger) return focusItem(root, trigger);
          }
        }
        if (items[i - 1]) return focusItem(root, items[i - 1]);
        return focusItem(root, items[items.length - 1]);
      }
      case "Home":
        e.preventDefault();
        return focusItem(root, items[0]);
      case "End":
        e.preventDefault();
        return focusItem(root, items[items.length - 1]);
      case "ArrowRight":
        if (isTop && hasSub(active)) {
          e.preventDefault();
          setExpanded(active, true);
        }
        return;
      case "ArrowLeft":
        if (isTop && hasSub(active) && active.getAttribute("aria-expanded") === "true") {
          e.preventDefault();
          setExpanded(active, false);
        } else if (sub) {
          const trigger = sub.previousElementSibling;
          if (trigger) {
            e.preventDefault();
            setExpanded(trigger, false);
            focusItem(root, trigger);
          }
        }
        return;
      default:
        return;
    }
  }

  /* ---------- 挂载 ---------- */
  function mount(root) {
    if (!root || root._cinSidenavMounted) return root;
    root._cinSidenavMounted = true;
    const doc = root.ownerDocument;
    const ac = new AbortController();
    const signal = { signal: ac.signal };

    // 折叠按钮：脚本才让它出现
    const toggle = q(root, ".cin-sidenav-toggle");
    if (toggle) {
      toggle.removeAttribute("hidden");
      toggle.setAttribute("aria-expanded", root.hasAttribute("data-collapsed") ? "false" : "true");
      toggle.setAttribute("aria-label", root.hasAttribute("data-collapsed") ? tr("sidenav.expand", "展开导航") : tr("sidenav.collapse", "收起导航"));
      toggle.addEventListener("click", () => setCollapsed(root, !root.hasAttribute("data-collapsed")), signal);
    }

    // 有子级的项：按 aria-expanded 落状态（无 JS 时默认全展开，这里才收起）
    allItems(root).forEach((item) => {
      if (!hasSub(item)) return;
      if (!item.hasAttribute("aria-haspopup")) item.setAttribute("aria-haspopup", "true");
      setExpanded(item, item.getAttribute("aria-expanded") === "true");
      item.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          setExpanded(item, item.getAttribute("aria-expanded") !== "true");
        },
        signal
      );
    });

    initRoving(root);
    root.addEventListener("keydown", (e) => onKeydown(root, e), signal);

    if (isDrawer(root)) {
      const scrim = ensureScrim(doc);
      scrim.addEventListener("click", () => closeDrawer(root, "scrim"), signal);
      const mq = window.matchMedia(DRAWER_MQ);
      const onChange = () => {
        if (!mq.matches) closeDrawer(root, "resize");
      };
      if (mq.addEventListener) mq.addEventListener("change", onChange, signal);
    }

    root.cinSidenav = {
      toggle: (force) => setCollapsed(root, force === undefined ? !root.hasAttribute("data-collapsed") : !!force),
      open: (opener) => openDrawer(root, opener),
      close: () => closeDrawer(root, "api"),
      expand: (item, open) => setExpanded(item, !!open),
      closeAllSub: () => allItems(root).filter(hasSub).forEach((el) => setExpanded(el, false)),
      destroy() {
        ac.abort();
        if (root._cinSidenavFrame) { cancelAnimationFrame(root._cinSidenavFrame); root._cinSidenavFrame = 0; }
        root._cinSidenavMounted = false;
        delete root.cinSidenav;
      },
    };
    return root;
  }

  function initAll(scope) {
    const host = scope || (typeof document !== "undefined" ? document : null);
    if (!host) return [];
    return qa(host, ".cin-sidenav").map(mount);
  }

  C.sidenav = { mount, initAll, DRAWER_MQ };
  if (typeof document !== "undefined" && document.readyState !== "loading") initAll();
  else if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => initAll());
})();


/* ---- slider.js ---- */
/* slider.js 约定：取值、键盘、无障碍全部交给原生 input[type=range]，脚本不重造控件。
   脚本只补三件事：
     1) 把 --_p（已填充百分比）写到容器上，轨道渐变和数值气泡都读它；
     2) 同步容器上的 data-value 与 .cin-slider-value 文本；
     3) 外抛 cin:slideinput（拖动过程中）与 cin:slidechange（落定）。
   结构：
     <div class="cin-slider" data-slider>
       <div class="cin-slider-head"><label class="cin-slider-label">…</label><span class="cin-slider-value"></span></div>
       <div class="cin-slider-body"><input class="cin-slider-input" type="range"></div>
     </div> */
(() => {
  const C = (window.Cinder = window.Cinder || {});

  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  const collect = (scope, sel) => {
    if (!scope) return [];
    const list = [];
    if (scope.matches && scope.matches(sel)) list.push(scope);
    if (scope.querySelectorAll) list.push(...scope.querySelectorAll(sel));
    return list;
  };

  const rootOf = (node) => node.closest("[data-slider], .cin-slider") || node.parentElement;
  const inputOf = (node) => (node.matches && node.matches("input[type=range]") ? node : node.querySelector("input[type=range]"));

  /** data-format 里用 {v} 占位，例如 "¥{v}"；没写就按原值显示 */
  function format(input, value) {
    const tpl = input.getAttribute("data-format");
    const text = Number.isFinite(value) ? String(value) : "";
    return tpl ? tpl.split("{v}").join(text) : text;
  }

  function paint(root, input) {
    const min = input.min === "" ? 0 : Number(input.min);
    const max = input.max === "" ? 100 : Number(input.max);
    const value = Number(input.value);
    const span = max - min;
    const ratio = span === 0 ? 0 : (value - min) / span;
    const pct = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
    const text = format(input, value);

    root.style.setProperty("--_p", `${(pct * 100).toFixed(3)}%`);

    const body = root.querySelector(".cin-slider-body");
    if (body) body.setAttribute("data-value", text);

    const out = root.querySelector(".cin-slider-value");
    if (out && out.textContent !== text) out.textContent = text;

    input.setAttribute("aria-valuetext", text);
  }

  function bind(root) {
    const input = inputOf(root);
    if (!input || input.__cinSlider) return false;

    input.__cinSlider = true;
    input.setAttribute("data-ready", "");

    input.addEventListener("input", () => {
      paint(root, input);
      emit(root, "cin:slideinput", { value: Number(input.value) });
    });
    input.addEventListener("change", () => {
      paint(root, input);
      emit(root, "cin:slidechange", { value: Number(input.value) });
    });

    paint(root, input);
    return true;
  }

  function initSliders(scope = document) {
    const roots = collect(scope, "[data-slider], .cin-slider").filter((el) => !!inputOf(el));
    const extra = collect(scope, "input[type=range].cin-slider-input")
      .map(rootOf)
      .filter((el) => el && !roots.includes(el));

    let n = 0;
    [...roots, ...extra].forEach((root) => {
      if (bind(root)) n += 1;
    });
    return n;
  }

  /** 脚本侧赋值：写入后刷新并当作一次落定外抛 */
  function setSlider(target, value) {
    const root = target && target.nodeType === 1 ? (target.matches(".cin-slider, [data-slider]") ? target : rootOf(target)) : null;
    const input = root ? inputOf(root) : null;
    if (!input) return null;

    input.value = String(value);
    paint(root, input);
    emit(root, "cin:slidechange", { value: Number(input.value) });
    return Number(input.value);
  }

  C.initSliders = initSliders;
  C.setSlider = setSlider;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initSliders(), { once: true });
  } else {
    initSliders();
  }
})();


/* ---- splitpanel.js ---- */
/* splitpanel.js 约定：分栏尺寸只有 --_a 一个变量，拖动/键盘/复位都改它。
   脚本负责：指针拖拽（含越界夹紧）、键盘微调、双击复位、尺寸持久化、收起展开。
   结构：
     <div class="cin-split" data-split data-min="15" data-max="85" data-persist="inv-list">
       <div class="cin-split-pane">…</div>
       <div class="cin-split-bar"><span class="cin-split-grip"></span></div>
       <div class="cin-split-pane">…</div>
     </div> */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;

  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const SEL = "[data-split], .cin-split";

  function metrics(root) {
    const vertical = root.getAttribute("data-orientation") === "vertical";
    const total = vertical ? root.clientHeight : root.clientWidth;
    const bar = root.querySelector(":scope > .cin-split-bar");
    const barSize = bar ? (vertical ? bar.offsetHeight : bar.offsetWidth) : 0;
    return { vertical, total, bar, barSize, usable: Math.max(0, total - barSize) };
  }

  function bounds(root) {
    const min = clamp(Number(root.getAttribute("data-min") ?? 12) / 100, 0, 0.5);
    const max = clamp(Number(root.getAttribute("data-max") ?? 88) / 100, 0.5, 1);
    return { min, max };
  }

  function persistKey(root) {
    const key = root.getAttribute("data-persist");
    return key ? `cin-split:${key}` : "";
  }

  function apply(root, px, { save = true } = {}) {
    const { usable, bar } = metrics(root);
    if (!usable) return 0;
    const { min, max } = bounds(root);
    const next = Math.round(clamp(px, usable * min, usable * max));
    root.style.setProperty("--_a", `${next}px`);
    root.removeAttribute("data-collapsed");
    if (bar) {
      bar.setAttribute("aria-valuenow", String(Math.round((next / usable) * 100)));
      bar.setAttribute("aria-valuetext", `${Math.round((next / usable) * 100)}%`);
    }
    const key = persistKey(root);
    if (save && key) {
      try {
        localStorage.setItem(key, String(next));
      } catch {
        /* 隐私模式下写不了就跳过 */
      }
    }
    return next;
  }

  function percentOf(root) {
    const { usable } = metrics(root);
    const pane = root.querySelector(":scope > .cin-split-pane");
    if (!usable || !pane) return 50;
    const size = root.getAttribute("data-orientation") === "vertical" ? pane.offsetHeight : pane.offsetWidth;
    return Math.round((size / usable) * 100);
  }

  function bind(root) {
    if (root.__cinSplit) return false;
    const { bar, vertical } = metrics(root);
    if (!bar) return false;
    root.__cinSplit = true;

    if (!bar.hasAttribute("tabindex")) bar.setAttribute("tabindex", "0");
    bar.setAttribute("role", "separator");
    bar.setAttribute("aria-orientation", vertical ? "horizontal" : "vertical");
    bar.setAttribute("aria-label", root.getAttribute("data-label") || tr("splitpanel.label", "调整分栏宽度"));
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");

    // 恢复上次尺寸；没有存档时按 CSS 的 50% 落一个像素值，后续拖动才平滑
    const key = persistKey(root);
    let saved = null;
    if (key) {
      try {
        saved = Number(localStorage.getItem(key));
      } catch {
        saved = null;
      }
    }
    const { usable } = metrics(root);
    if (saved && saved > 0 && usable) apply(root, saved, { save: false });
    else if (usable) {
      const pane = root.querySelector(":scope > .cin-split-pane");
      const size = pane ? (vertical ? pane.offsetHeight : pane.offsetWidth) : usable / 2;
      apply(root, size || usable / 2, { save: false });
    }

    let drag = null;
    bar.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const m = metrics(root);
      const pane = root.querySelector(":scope > .cin-split-pane");
      const size = pane ? (m.vertical ? pane.offsetHeight : pane.offsetWidth) : m.usable / 2;
      drag = { id: e.pointerId, vertical: m.vertical, start: m.vertical ? e.clientY : e.clientX, size };
      root.setAttribute("data-dragging", "");
      try {
        bar.setPointerCapture(e.pointerId);
      } catch {
        /* 合成事件没有捕获能力，靠 window 兜底 */
      }
      e.preventDefault();
    });

    const move = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const delta = (drag.vertical ? e.clientY : e.clientX) - drag.start;
      const next = apply(root, drag.size + delta);
      emit(root, "cin:splitresize", { percent: Math.round((next / (metrics(root).usable || 1)) * 100), size: next });
    };
    const stop = (e) => {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      drag = null;
      root.removeAttribute("data-dragging");
      emit(root, "cin:splitchange", { percent: percentOf(root) });
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", stop);
    bar.addEventListener("pointercancel", stop);
    window.addEventListener("pointerup", stop);

    const rtl = () => getComputedStyle(root).direction === "rtl";
    bar.addEventListener("keydown", (e) => {
      const stepPct = Number(root.getAttribute("data-step") || (e.shiftKey ? 5 : 2));
      const m = metrics(root);
      const pane = root.querySelector(":scope > .cin-split-pane");
      const current = pane ? (m.vertical ? pane.offsetHeight : pane.offsetWidth) : m.usable / 2;
      const step = (m.usable * stepPct) / 100;
      const dirSign = !m.vertical && rtl() ? -1 : 1;
      let next = null;
      if (e.key === (m.vertical ? "ArrowUp" : "ArrowLeft")) next = current - step * dirSign;
      else if (e.key === (m.vertical ? "ArrowDown" : "ArrowRight")) next = current + step * dirSign;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = m.usable;
      else if (e.key === "Enter" || e.key === " ") next = m.usable / 2;
      else if (/^[0-9]$/.test(e.key)) next = (m.usable * clamp(Number(e.key) * 10, 0, 100)) / 100;
      if (next === null) return;
      e.preventDefault();
      apply(root, next);
      emit(root, "cin:splitchange", { percent: percentOf(root) });
    });

    bar.addEventListener("dblclick", () => {
      const { usable } = metrics(root);
      apply(root, usable / 2);
      emit(root, "cin:splitchange", { percent: 50 });
    });

    return true;
  }

  function initSplitPanels(scope = document) {
    let n = 0;
    const list = [];
    if (scope && scope.matches && scope.matches(SEL)) list.push(scope);
    if (scope && scope.querySelectorAll) list.push(...scope.querySelectorAll(SEL));
    list.forEach((root) => {
      if (bind(root)) n += 1;
    });
    return n;
  }

  function resolve(target) {
    if (!target || target.nodeType !== 1) return null;
    return target.matches(SEL) ? target : target.closest(SEL);
  }

  /** 按百分比设置分栏，0-100 */
  function setSplitSize(target, percent) {
    const root = resolve(target);
    if (!root) return null;
    const { usable } = metrics(root);
    const px = apply(root, (usable * clamp(Number(percent), 0, 100)) / 100);
    emit(root, "cin:splitchange", { percent: percentOf(root), size: px });
    return px;
  }

  /** 收起/展开指定栏；传 "a" 收第一栏，"b" 收第二栏，不传则切换 */
  function toggleSplitPanel(target, which = "a") {
    const root = resolve(target);
    if (!root) return null;
    const collapsed = root.getAttribute("data-collapsed") === which;
    if (collapsed) {
      const restore = Number(root.getAttribute("data-restore") || 0);
      const { usable } = metrics(root);
      apply(root, restore > 0 ? restore : usable / 2, { save: false });
      root.removeAttribute("data-restore");
      emit(root, "cin:splitchange", { percent: percentOf(root), collapsed: null });
      return false;
    }
    const pane = root.querySelector(":scope > .cin-split-pane");
    const vertical = root.getAttribute("data-orientation") === "vertical";
    const size = pane ? (vertical ? pane.offsetHeight : pane.offsetWidth) : 0;
    root.setAttribute("data-restore", String(Math.round(size)));
    root.setAttribute("data-collapsed", which);
    emit(root, "cin:splitchange", { percent: 0, collapsed: which });
    return true;
  }

  C.initSplitPanels = initSplitPanels;
  C.setSplitSize = setSplitSize;
  C.toggleSplitPanel = toggleSplitPanel;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initSplitPanels(), { once: true });
  } else {
    initSplitPanels();
  }
})();


/* ---- tabs.js ---- */
/* tabs.js 约定：无 JS 时所有 tabpanel 保持可见（脚本才写 hidden），内容不丢。
   JS 只负责：aria 关联补全、roving tabindex、方向键漫游、面板显隐、cin:tabchange 外抛。
   结构兼容两种写法：
     A) <div class="cin-tabs" data-tabs><div class="cin-tablist" role="tablist">...</div><div class="cin-tabpanel">...</div></div>
     B) <div class="cin-tabs" data-tabs role="tablist"> ...tab... </div>（扁平，与 toolbar.css 的静态标签栏同一 DOM） */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  let seq = 0;

  const emit = (el, type, detail = {}) =>
    el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  const isDisabled = (tab) =>
    tab.disabled === true || tab.hasAttribute("disabled") || tab.getAttribute("aria-disabled") === "true";

  const tablistOf = (root) =>
    root.matches('[role="tablist"]') ? root : root.querySelector(':scope > [role="tablist"], :scope > .cin-tablist');

  const tabsOf = (list) =>
    Array.from(list.querySelectorAll('[role="tab"], .cin-tab')).filter(
      (t, i, arr) => arr.indexOf(t) === i && !!t.closest('[role="tablist"], .cin-tablist')
    );

  const panelsOf = (root) =>
    Array.from(root.querySelectorAll(':scope > [role="tabpanel"], :scope > .cin-tabpanel'));

  const vertical = (root) => root.getAttribute("data-orientation") === "vertical";

  /** id 补全：tab 与 panel 双向关联，缺谁补谁 */
  function linkAria(root, tabs, panels) {
    const pairs = [];
    const used = new Set();
    tabs.forEach((tab, i) => {
      if (!tab.id) tab.id = `cin-tab-${++seq}`;
      tab.setAttribute("role", "tab");
      const controlled = tab.getAttribute("aria-controls");
      let panel = controlled
        ? panels.find((p) => p.id === controlled) || document.getElementById(controlled)
        : null;
      if (!panel || used.has(panel)) panel = panels[i] && !used.has(panels[i]) ? panels[i] : null;
      if (!panel) {
        pairs.push([tab, null]);
        return;
      }
      used.add(panel);
      if (!panel.id) panel.id = `cin-tabpanel-${++seq}`;
      panel.setAttribute("role", "tabpanel");
      tab.setAttribute("aria-controls", panel.id);
      panel.setAttribute("aria-labelledby", tab.id);
      if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "0");
      pairs.push([tab, panel]);
    });
    return pairs;
  }

  function sync(root, pairs, activeIndex, { focus = false } = {}) {
    pairs.forEach(([tab, panel], i) => {
      const on = i === activeIndex;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      if (panel) panel.hidden = !on;
    });
    const active = pairs[activeIndex];
    if (active) {
      if (focus) active[0].focus({ preventScroll: true });
      if (active[0].scrollIntoView && !vertical(root)) {
        const list = active[0].parentElement;
        if (list && list.scrollWidth > list.clientWidth) {
          active[0].scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      }
    }
  }

  function setTab(root, target, options = {}) {
    const ctx = root._cinTabs;
    if (!ctx) return;
    const { pairs } = ctx;
    let index = -1;
    if (typeof target === "number") index = target;
    else if (typeof target === "string") {
      index =
        pairs.findIndex(([tab]) => tab.id === target || tab.dataset.tab === target) ;
      if (index < 0) index = pairs.findIndex(([tab]) => (tab.textContent || "").trim() === target);
    } else if (target instanceof Element) {
      index = pairs.findIndex(([tab]) => tab === target);
    }
    if (index < 0 || index >= pairs.length || index === ctx.active) return;
    const [fromTab] = pairs[ctx.active] || [];
    const prev = ctx.active;
    ctx.active = index;
    sync(root, pairs, index, { focus: options.focus !== false });
    emit(root, "cin:tabchange", {
      from: fromTab ? fromTab.id : null,
      to: pairs[index][0].id,
      index,
      previous: prev,
      source: options.source || "api",
    });
  }

  function step(root, dir) {
    const { pairs, active } = root._cinTabs;
    const n = pairs.length;
    if (!n) return null;
    let i = active;
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      if (!isDisabled(pairs[i][0])) return i;
    }
    return null;
  }

  function onKeydown(root, e) {
    const ctx = root._cinTabs;
    if (!ctx) return;
    const vert = vertical(root);
    const nextKey = vert ? "ArrowDown" : "ArrowRight";
    const prevKey = vert ? "ArrowUp" : "ArrowLeft";
    const manual = root.getAttribute("data-activation") === "manual";
    let next = null;

    if (e.key === nextKey) next = step(root, 1);
    else if (e.key === prevKey) next = step(root, -1);
    else if (e.key === "Home") next = ctx.pairs.findIndex(([t]) => !isDisabled(t));
    else if (e.key === "End") {
      for (let i = ctx.pairs.length - 1; i >= 0; i--) {
        if (!isDisabled(ctx.pairs[i][0])) { next = i; break; }
      }
    } else return;

    if (next === null || next < 0) return;
    e.preventDefault();
    if (manual) {
      const { pairs } = ctx;
      pairs.forEach(([tab], i) => { tab.tabIndex = i === next ? 0 : -1; });
      pairs[next][0].focus({ preventScroll: true });
      ctx.pending = next;
    } else {
      setTab(root, next, { source: "keyboard", focus: true });
    }
  }

  function bind(root) {
    if (root._cinTabs) return;
    if (!root.hasAttribute("data-tabs")) root.setAttribute("data-tabs", "");
    const list = tablistOf(root);
    if (!list) return;
    if (!list.hasAttribute("role")) list.setAttribute("role", "tablist");
    if (!list.hasAttribute("aria-orientation") && vertical(root)) {
      list.setAttribute("aria-orientation", "vertical");
    }

    const tabs = tabsOf(list);
    if (!tabs.length) return;
    const pairs = linkAria(root, tabs, panelsOf(root));
    const initial = Math.max(
      0,
      tabs.findIndex((t) => t.getAttribute("aria-selected") === "true")
    );
    root._cinTabs = { list, pairs, active: initial, pending: initial };
    sync(root, pairs, initial);

    const manual = root.getAttribute("data-activation") === "manual";

    list.addEventListener("click", (e) => {
      const tab = e.target.closest('[role="tab"], .cin-tab');
      if (!tab || !pairs.some(([t]) => t === tab) || isDisabled(tab)) return;
      e.preventDefault();
      setTab(root, tab, { source: "user", focus: true });
    });

    list.addEventListener("keydown", (e) => onKeydown(root, e));

    if (manual) {
      list.addEventListener("focusin", (e) => {
        const tab = e.target.closest('[role="tab"], .cin-tab');
        if (!tab) return;
        const i = pairs.findIndex(([t]) => t === tab);
        if (i < 0) return;
        pairs.forEach(([t], k) => { t.tabIndex = k === i ? 0 : -1; });
        root._cinTabs.pending = i;
      });
    }

    emit(root, "cin:tabsready", { count: pairs.length, active: initial });
  }

  function initTabs(scope = document) {
    const roots = Array.from(
      (scope.matches && scope.matches("[data-tabs]") ? [scope] : []).concat(
        Array.from(scope.querySelectorAll ? scope.querySelectorAll("[data-tabs]") : [])
      )
    );
    roots.forEach(bind);
    return roots.length;
  }

  C.initTabs = initTabs;
  C.setTab = setTab;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initTabs(), { once: true });
  } else {
    initTabs();
  }
})();


/* ---- tags.js ---- */
/* tags.js · 标签输入（粘贴分隔 / 重复检测 / 退格删除） */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;
  const emit = (el, type, detail) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  const SEP = /[,;，；\n\t]/;

  function init(root) {
    if (root.dataset.cinReady) return;
    root.dataset.cinReady = "1";
    const field = root.querySelector(".cin-tags-field");
    const list = root.querySelector(".cin-tags-list") || (() => {
      const ul = document.createElement("ul");
      ul.className = "cin-tags-list";
      root.insertBefore(ul, field);
      return ul;
    })();
    const max = Number(root.dataset.max) || 0;

    const values = () => Array.from(root.querySelectorAll(".cin-tag")).map((t) => t.dataset.value);
    const sync = () => emit(root, "cin:tags-change", { values: values() });

    function add(raw, opts) {
      const value = String(raw || "").trim().slice(0, 64);
      if (!value) return false;
      const exists = values().includes(value);
      if (exists && !(opts && opts.allowDuplicate)) {
        const dup = Array.from(root.querySelectorAll(".cin-tag")).find((t) => t.dataset.value === value);
        if (dup) { dup.setAttribute("data-duplicate", ""); setTimeout(() => dup.removeAttribute("data-duplicate"), 1200); }
        emit(root, "cin:tag-duplicate", { value });
        return false;
      }
      if (max && values().length >= max) { emit(root, "cin:tag-limit", { max }); return false; }
      const li = document.createElement("li");
      li.className = "cin-tag";
      li.dataset.value = value;
      li.innerHTML = '<span class="cin-tag-label"></span><button type="button" class="cin-tag-remove" aria-label="${tr("tags.remove", "移除")}">×</button>';
      li.querySelector(".cin-tag-label").textContent = value;
      list.appendChild(li);
      sync();
      return true;
    }

    function commitField() {
      const parts = field.value.split(SEP).map((s) => s.trim()).filter(Boolean);
      if (!parts.length) return;
      parts.forEach((p) => add(p));
      field.value = "";
    }

    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || (e.key === " " && field.value.trim())) { e.preventDefault(); commitField(); }
      else if (e.key === "Backspace" && !field.value) {
        const tags = root.querySelectorAll(".cin-tag");
        const last = tags[tags.length - 1];
        if (last) { e.preventDefault(); last.remove(); sync(); }
      }
      else if (e.key === "ArrowLeft" && !field.value) { const t = root.querySelector(".cin-tag-remove"); if (t) t.focus(); }
    });
    field.addEventListener("paste", (e) => {
      const text = (e.clipboardData || window.clipboardData).getData("text");
      if (!text || !SEP.test(text)) return;
      e.preventDefault();
      text.split(SEP).map((s) => s.trim()).filter(Boolean).forEach((p) => add(p));
    });
    field.addEventListener("blur", commitField);
    root.addEventListener("click", (e) => {
      if (e.target.closest(".cin-tag-remove")) {
        const tag = e.target.closest(".cin-tag");
        tag.remove();
        sync();
        field.focus();
      } else if (e.target === root || e.target === list) field.focus();
    });
  }

  C.tags = { init, initAll: (s = document) => s.querySelectorAll(".cin-tags").forEach(init) };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", () => C.tags.initAll()) : C.tags.initAll();
})();


/* ---- timepicker.js ---- */
/* timepicker.js 约定：无脚本时文本框仍可手输 HH:mm 并提交，时钟按钮不弹面板，内容不丢。
   JS 只负责：按时/分两列生成面板、min/max 与 data-minute-step 夹取、面板夹进视口、
   键盘漫游、写回 input 与 root[data-value]，并外抛 cin:time* 事件。
   结构：<div class="cin-timepicker" data-timepicker data-value="09:30">
           <div class="cin-timepicker-fields"><span class="cin-timepicker-field"><input data-time-field></span>
           <button class="cin-timepicker-toggle"></button></div>
         </div>
   面板由脚本注入，示例页无需手写两列选项。 */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;
  const state = new WeakMap();
  let openRoot = null;

  const emit = (el, type, detail = {}) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  const pad = (n) => String(n).padStart(2, "0");
  const stepOf = (root) => {
    const n = Number(root.dataset.minuteStep);
    return Number.isFinite(n) && n > 0 && n <= 30 ? Math.round(n) : 5;
  };

  function parse(value) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  const toText = (total) => pad(Math.floor(total / 60)) + ":" + pad(total % 60);
  const bounds = (root) => ({
    min: parse(root.dataset.min) ?? 0,
    max: parse(root.dataset.max) ?? 23 * 60 + 59,
  });

  function fieldOf(root) {
    return root.querySelector("[data-time-field], .cin-timepicker-field > input");
  }

  function build(root) {
    const pop = document.createElement("div");
    pop.className = "cin-timepicker-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-modal", "false");
    pop.setAttribute("aria-label", root.dataset.label || tr("timepicker.label", "选择时间"));

    const cols = document.createElement("div");
    cols.className = "cin-timepicker-cols";

    const hours = document.createElement("div");
    hours.className = "cin-timepicker-col";
    hours.setAttribute("role", "listbox");
    hours.setAttribute("aria-label", tr("timepicker.hour", "小时"));
  hours.dataset.col = "hour";;
    for (let h = 0; h < 24; h += 1) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cin-timepicker-opt";
      b.setAttribute("role", "option");
      b.dataset.hour = String(h);
      b.textContent = pad(h);
      hours.append(b);
    }

    const minutes = document.createElement("div");
    minutes.className = "cin-timepicker-col";
    minutes.setAttribute("role", "listbox");
    minutes.setAttribute("aria-label", tr("timepicker.minute", "分钟"));
  minutes.dataset.col = "minute";;

    cols.append(hours, minutes);

    const foot = document.createElement("div");
    foot.className = "cin-timepicker-foot";
    const now = document.createElement("button");
    now.type = "button";
    now.dataset.timeNow = "";
    now.textContent = tr("timepicker.now", "现在");
    const clear = document.createElement("button");
    clear.type = "button";
    clear.dataset.timeClear = "";
    clear.textContent = tr("timepicker.clear", "清除");
    foot.append(now, clear);

    pop.append(cols, foot);
    root.append(pop);
    return pop;
  }

  function markSelected(root, total) {
    root.querySelectorAll(".cin-timepicker-opt").forEach((b) => {
      const isHour = b.dataset.hour !== undefined;
      const v = isHour ? Number(b.dataset.hour) * 60 : Number(b.dataset.minute);
      b.setAttribute("aria-selected", String(isHour ? Math.floor(total / 60) === Number(b.dataset.hour) : total % 60 === Number(b.dataset.minute)));
      void v;
    });
  }

  function paintMinutes(root, total) {
    const col = root.querySelector('.cin-timepicker-col[data-col="minute"]');
    if (!col) return;
    const step = stepOf(root);
    const { min, max } = bounds(root);
    const hour = Math.floor(total / 60);
    col.textContent = "";
    for (let mi = 0; mi < 60; mi += step) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cin-timepicker-opt";
      b.setAttribute("role", "option");
      b.dataset.minute = String(mi);
      b.textContent = pad(mi);
      const value = hour * 60 + mi;
      b.disabled = value < min || value > max;
      col.append(b);
    }
    markSelected(root, total);
  }

  function paintHours(root, total) {
    const { min, max } = bounds(root);
    root.querySelectorAll(".cin-timepicker-opt[data-hour]").forEach((b) => {
      const h = Number(b.dataset.hour);
      b.disabled = h * 60 + 59 < min || h * 60 > max;
    });
    markSelected(root, total);
  }

  function place(root) {
    const pop = root.querySelector(".cin-timepicker-pop");
    const fields = root.querySelector(".cin-timepicker-fields");
    if (!pop || !fields) return;
    const r = fields.getBoundingClientRect();
    pop.style.visibility = "hidden";
    pop.style.left = "0px";
    pop.style.top = "0px";
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = Math.min(r.left, vw - w - 8);
    let top = r.bottom + 4;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 4);
    pop.style.left = Math.max(8, left) + "px";
    pop.style.top = top + "px";
    pop.style.visibility = "";
  }

  function current(root) {
    const st = state.get(root);
    return parse(root.dataset.value) ?? (st ? st.value : null) ?? 9 * 60;
  }

  function commit(root, total, reason) {
    const field = fieldOf(root);
    const text = toText(total);
    root.dataset.value = text;
    if (field) field.value = text;
    root.removeAttribute("data-invalid");
    const st = state.get(root);
    if (st) st.value = total;
    emit(root, "cin:timechange", { value: text, reason });
  }

  function open(root) {
    const st = state.get(root);
    if (!st) return;
    if (openRoot && openRoot !== root) close(openRoot, "api");
    const total = current(root);
    paintHours(root, total);
    paintMinutes(root, total);
    place(root);
    root.setAttribute("data-open", "");
    st.open = true;
    openRoot = root;
    const selected = root.querySelector('.cin-timepicker-opt[aria-selected="true"]');
    (selected || root.querySelector(".cin-timepicker-opt")).focus({ preventScroll: true });
    emit(root, "cin:timeopen", {});
  }

  function close(root, reason) {
    const st = state.get(root);
    if (!st || !st.open) return;
    root.removeAttribute("data-open");
    st.open = false;
    if (openRoot === root) openRoot = null;
    emit(root, "cin:timeclose", { reason });
  }

  function toggle(root) {
    const st = state.get(root);
    if (!st) return;
    if (st.open) close(root, "button");
    else open(root);
  }

  function typeIn(root) {
    const field = fieldOf(root);
    if (!field) return;
    const total = parse(field.value);
    if (total === null) {
      root.setAttribute("data-invalid", "");
      return;
    }
    const { min, max } = bounds(root);
    if (total < min || total > max) {
      root.setAttribute("data-invalid", "");
      return;
    }
    commit(root, total, "type");
  }

  function moveFocus(root, delta, horizontal) {
    const cols = [...root.querySelectorAll(".cin-timepicker-col")];
    if (!cols.length) return;
    const active = document.activeElement;
    const colIndex = cols.findIndex((c) => c.contains(active));
    if (colIndex < 0) return;
    if (horizontal) {
      const next = cols[(colIndex + (delta > 0 ? 1 : cols.length - 1)) % cols.length];
      const target = next.querySelector('.cin-timepicker-opt[aria-selected="true"]:not(:disabled)') || next.querySelector(".cin-timepicker-opt:not(:disabled)");
      if (target) target.focus({ preventScroll: true });
      return;
    }
    const opts = [...cols[colIndex].querySelectorAll(".cin-timepicker-opt:not(:disabled)")];
    const i = opts.indexOf(active);
    const next = opts[Math.min(opts.length - 1, Math.max(0, i + delta))];
    if (next) next.focus({ preventScroll: true });
  }

  function pick(root, target) {
    const total = current(root);
    let hour = Math.floor(total / 60);
    let minute = total % 60;
    if (target.dataset.hour !== undefined) hour = Number(target.dataset.hour);
    if (target.dataset.minute !== undefined) minute = Number(target.dataset.minute);
    const { min, max } = bounds(root);
    const value = Math.min(max, Math.max(min, hour * 60 + minute));
    commit(root, value, "pick");
    paintHours(root, value);
    paintMinutes(root, value);
    close(root, "pick");
    const field = fieldOf(root);
    if (field) field.focus({ preventScroll: true });
  }

  function attach(root) {
    if (state.has(root)) return;
    const field = fieldOf(root);
    const st = { value: parse(root.dataset.value), open: false, field };
    state.set(root, st);
    if (field && root.dataset.value) field.value = root.dataset.value;
    build(root);

    root.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest(".cin-timepicker-toggle")) {
        e.preventDefault();
        toggle(root);
        return;
      }
      const opt = t.closest(".cin-timepicker-opt");
      if (opt && !opt.disabled) {
        pick(root, opt);
        return;
      }
      if (t.closest("[data-time-now]")) {
        const d = new Date();
        commit(root, d.getHours() * 60 + d.getMinutes(), "now");
        close(root, "now");
        return;
      }
      if (t.closest("[data-time-clear]")) {
        root.dataset.value = "";
        if (field) field.value = "";
        emit(root, "cin:timechange", { value: "", reason: "clear" });
        close(root, "clear");
      }
    });

    root.addEventListener("keydown", (e) => {
      const st2 = state.get(root);
      if (!st2) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (st2.open) {
          e.preventDefault();
          moveFocus(root, e.key === "ArrowDown" ? 1 : -1, false);
        }
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        if (st2.open) {
          e.preventDefault();
          moveFocus(root, e.key === "ArrowRight" ? 1 : -1, true);
        }
        return;
      }
      if (e.key === "Escape" && st2.open) {
        e.preventDefault();
        close(root, "escape");
        if (field) field.focus({ preventScroll: true });
        return;
      }
      if (e.key === "Enter") {
        const active = document.activeElement;
        if (st2.open && active instanceof HTMLElement && active.classList.contains("cin-timepicker-opt") && !active.disabled) {
          e.preventDefault();
          pick(root, active);
          return;
        }
        if (active === field) {
          e.preventDefault();
          typeIn(root);
        }
      }
    });

    if (field) {
      field.addEventListener("blur", () => typeIn(root));
      field.addEventListener("input", () => root.removeAttribute("data-invalid"));
    }

    document.addEventListener("pointerdown", (e) => {
      const st2 = state.get(root);
      if (!st2 || !st2.open) return;
      if (!(e.target instanceof Element) || root.contains(e.target)) return;
      close(root, "outside");
    });

    window.addEventListener("resize", () => {
      const st2 = state.get(root);
      if (st2 && st2.open) place(root);
    });
  }

  const roots = (scope) => (scope || document).querySelectorAll("[data-timepicker], .cin-timepicker");

  C.initTimePickers = (scope = document) => {
    roots(scope).forEach(attach);
  };

  C.setTimePicker = (target, value) => {
    const root = target instanceof Element ? (target.matches("[data-timepicker], .cin-timepicker") ? target : target.closest("[data-timepicker], .cin-timepicker")) : null;
    if (!root) return null;
    attach(root);
    const total = parse(value);
    if (total === null) return null;
    const { min, max } = bounds(root);
    if (total < min || total > max) return null;
    const st = state.get(root);
    const field = fieldOf(root);
    root.dataset.value = toText(total);
    if (field) field.value = root.dataset.value;
    if (st) st.value = total;
    if (st && st.open) {
      paintHours(root, total);
      paintMinutes(root, total);
    }
    emit(root, "cin:timechange", { value: root.dataset.value, reason: "api" });
    return root.dataset.value;
  };

  C.timePicker = (target) => {
    const root = target instanceof Element ? (target.matches("[data-timepicker], .cin-timepicker") ? target : target.closest("[data-timepicker], .cin-timepicker")) : null;
    if (!root) return null;
    attach(root);
    return {
      open: () => open(root),
      close: () => close(root, "api"),
      get value() {
        return root.dataset.value || "";
      },
      set: (v) => C.setTimePicker(root, v),
    };
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => C.initTimePickers());
  else C.initTimePickers();
})();


/* ---- transfer.js ---- */
/* transfer.js 约定：无脚本时两列 checkbox 仍在同一表单内，值照常提交，只是按不到「移动」。
   JS 只负责：按 data-value 初值搬运节点、点击移动、计数刷新、禁用未选中方向，
   并外抛 cin:transferchange 事件。
   结构：<div class="cin-transfer" data-transfer data-value="a,c">
           <div class="cin-transfer-panel"><header class="cin-transfer-head">…<span class="cin-transfer-count"></span></header>
             <div class="cin-transfer-list" data-side="source">
               <label class="cin-transfer-item" data-value="a"><input type="checkbox"><span>A</span></label>
             </div>
           </div>
           <div class="cin-transfer-actions"><button class="cin-transfer-move" data-transfer-to="target">→</button>
             <button class="cin-transfer-move" data-transfer-to="source">←</button></div>
           <div class="cin-transfer-panel">…data-side="target"…</div>
         </div> */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;
  const state = new WeakMap();

  const emit = (el, type, detail = {}) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  const sideOf = (root, name) => root.querySelector(`.cin-transfer-list[data-side="${name}"]`);
  const itemsIn = (root, name) => [...(sideOf(root, name)?.querySelectorAll(".cin-transfer-item") || [])];

  function selectedOf(root, name, onlyChecked) {
    return itemsIn(root, name).filter((it) => {
      const box = it.querySelector('input[type="checkbox"]');
      return onlyChecked ? !!(box && box.checked) : true;
    });
  }

  function values(root) {
    return itemsIn(root, "target").map((it) => it.dataset.value);
  }

  function refresh(root) {
    ["source", "target"].forEach((name) => {
      const list = sideOf(root, name);
      if (!list) return;
      const panel = list.closest(".cin-transfer-panel");
      const count = panel && panel.querySelector(".cin-transfer-count");
      const total = itemsIn(root, name).length;
      const checked = selectedOf(root, name, true).length;
      if (count) count.textContent = checked ? `${checked}/${total}` : String(total);
      let empty = list.querySelector(".cin-transfer-empty");
      if (!total) {
        if (!empty) {
          empty = document.createElement("div");
          empty.className = "cin-transfer-empty";
          empty.textContent = name === "source"
        ? tr("transfer.allMoved", "全部已移入")
        : tr("transfer.noneSelected", "尚未选择");
          list.append(empty);
        }
      } else if (empty) {
        empty.remove();
      }
      itemsIn(root, name).forEach((it) => {
        const box = it.querySelector('input[type="checkbox"]');
        if (box && box.checked) it.setAttribute("data-checked", "");
        else it.removeAttribute("data-checked");
      });
    });
    root.querySelectorAll("[data-transfer-to]").forEach((btn) => {
      const from = btn.dataset.transferTo === "target" ? "source" : "target";
      btn.disabled = selectedOf(root, from, true).length === 0 || root.hasAttribute("data-disabled");
    });
    const st = state.get(root);
    if (st) st.value = values(root);
    root.dataset.value = values(root).join(",");
    return root.dataset.value;
  }

  function move(root, direction) {
    const from = direction === "target" ? "source" : "target";
    const to = direction;
    const fromList = sideOf(root, from);
    const toList = sideOf(root, to);
    if (!fromList || !toList) return null;
    selectedOf(root, from, true).forEach((it) => {
      const box = it.querySelector('input[type="checkbox"]');
      if (box) box.checked = false;
      it.removeAttribute("data-checked");
      toList.append(it);
    });
    const value = refresh(root);
    emit(root, "cin:transferchange", { value: values(root), direction });
    return value;
  }

  function attach(root) {
    if (state.has(root)) return;
    state.set(root, { value: [] });

    const initial = String(root.dataset.value || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (initial.length) {
      const target = sideOf(root, "target");
      const source = sideOf(root, "source");
      initial.forEach((v) => {
        const it = source && [...source.querySelectorAll(".cin-transfer-item")].find((n) => n.dataset.value === v);
        if (it && target) target.append(it);
      });
    }
    refresh(root);

    root.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const btn = t.closest("[data-transfer-to]");
      if (btn && !btn.disabled) {
        e.preventDefault();
        move(root, btn.dataset.transferTo);
        return;
      }
      const item = t.closest(".cin-transfer-item");
      if (item) {
        window.setTimeout(() => refresh(root), 0);
      }
    });

    root.addEventListener("change", (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type === "checkbox") refresh(root);
    });
  }

  const roots = (scope) => (scope || document).querySelectorAll("[data-transfer], .cin-transfer");

  C.initTransfers = (scope = document) => {
    roots(scope).forEach(attach);
  };

  C.setTransfer = (target, list) => {
    const root = target instanceof Element ? (target.matches("[data-transfer], .cin-transfer") ? target : target.closest("[data-transfer], .cin-transfer")) : null;
    if (!root || !Array.isArray(list)) return null;
    attach(root);
    const source = sideOf(root, "source");
    const wanted = new Set(list.map(String));
    [...itemsIn(root, "source"), ...itemsIn(root, "target")].forEach((it) => {
      const box = it.querySelector('input[type="checkbox"]');
      if (box) box.checked = false;
      it.removeAttribute("data-checked");
      if (wanted.has(String(it.dataset.value))) sideOf(root, "target")?.append(it);
      else source?.append(it);
    });
    const value = refresh(root);
    emit(root, "cin:transferchange", { value: values(root), direction: "api" });
    return value;
  };

  C.transfer = (target) => {
    const root = target instanceof Element ? (target.matches("[data-transfer], .cin-transfer") ? target : target.closest("[data-transfer], .cin-transfer")) : null;
    if (!root) return null;
    attach(root);
    return {
      get value() {
        return values(root);
      },
      get source() {
        return valuesOfSide(root, "source");
      },
      get target() {
        return valuesOfSide(root, "target");
      },
      set: (l) => C.setTransfer(root, l),
      move: (dir) => move(root, dir),
    };
  };

  function valuesOfSide(root, name) {
    return itemsIn(root, name).map((it) => it.dataset.value);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => C.initTransfers());
  else C.initTransfers();
})();


/* ---- tree.js ---- */
/* ---- tree.js ---- 树形目录：脚本只补展开收起、选中、键盘漫游与过滤，结构与内容始终在 HTML 里 ---- */
(() => {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;
  const SELECTOR = "[data-tree]";
  const emit = (el, type, detail = {}) => el && el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  const itemOf = (el) => (el && el.closest ? el.closest(".cin-tree-item") : null);
  const rowOf = (item) => (item ? item.querySelector(":scope > .cin-tree-row") : null);
  const groupOf = (item) => (item ? item.querySelector(":scope > .cin-tree-group") : null);
  const rootOf = (el) => (el && el.closest ? el.closest(SELECTOR) : null);
  const itemsOf = (root) => (root ? Array.from(root.querySelectorAll(".cin-tree-item")) : []);
  const rowsOf = (root) => (root ? Array.from(root.querySelectorAll(".cin-tree-row")) : []);
  const parentItemOf = (item) => {
    const parent = item && item.parentElement;
    return parent ? parent.closest(".cin-tree-item") : null;
  };
  const childItemsOf = (item) => (item ? Array.from(item.querySelectorAll(":scope > .cin-tree-group > .cin-tree-item")) : []);
  const labelNodeOf = (row) => (row ? row.querySelector(".cin-tree-label") : null);
  const labelOf = (row) => {
    const node = labelNodeOf(row);
    return ((node ? node.textContent : row ? row.textContent : "") || "").trim();
  };
  const checkOf = (item) => (item ? item.querySelector(":scope > .cin-tree-row > .cin-tree-check") : null);
  const modeOf = (root) => (root && root.getAttribute("data-select")) || "single";
  const cascadeOf = (root) => !!root && root.hasAttribute("data-cascade");
  const isDisabled = (row) => !!row && (row.getAttribute("aria-disabled") === "true" || row.hasAttribute("disabled"));
  const isBranch = (item) => !!groupOf(item);

  /* ---------- 结构与 ARIA ---------- */

  const decorate = (root) => {
    if (!root) return;
    root.setAttribute("data-tree-ready", "");
    const list = root.querySelector(":scope > .cin-tree-groups");
    if (list && !list.getAttribute("role")) list.setAttribute("role", "tree");
    const multi = modeOf(root) !== "single";
    const seen = new Set();
    itemsOf(root).forEach((item) => {
      const row = rowOf(item);
      if (!row) return;
      const parent = parentItemOf(item);
      const group = groupOf(item);
      const siblings = parent ? childItemsOf(parent) : list ? Array.from(list.children).filter((n) => n.classList.contains("cin-tree-item")) : [item];
      const pos = siblings.indexOf(item);
      const level = (() => {
        let depth = 1;
        let cursor = parent;
        while (cursor) {
          depth += 1;
          cursor = parentItemOf(cursor);
        }
        return depth;
      })();

      item.setAttribute("role", "treeitem");
      item.setAttribute("aria-level", String(level));
      item.setAttribute("aria-setsize", String(siblings.length));
      item.setAttribute("aria-posinset", String(pos >= 0 ? pos + 1 : 1));
      if (group) {
        if (!group.getAttribute("role")) group.setAttribute("role", "group");
        row.setAttribute("aria-expanded", group.hidden ? "false" : "true");
        const id = row.id || `cin-tree-row-${(root.__cinSeq = (root.__cinSeq || 0) + 1)}`;
        row.id = id;
        group.setAttribute("aria-labelledby", id);
      } else {
        item.setAttribute("data-leaf", "");
        row.removeAttribute("aria-expanded");
        seen.add(item);
      }

      const box = checkOf(item);
      if (multi && box) {
        row.setAttribute("aria-checked", box.indeterminate ? "mixed" : String(box.checked));
        if (!box.hasAttribute("aria-label")) box.setAttribute("aria-label", labelOf(row));
      } else if (!multi) {
        row.setAttribute("aria-selected", row.getAttribute("aria-selected") === "true" ? "true" : "false");
        row.removeAttribute("aria-checked");
      } else {
        row.setAttribute("aria-selected", row.getAttribute("aria-selected") === "true" ? "true" : "false");
      }
      if (box && modeOf(root) !== "multiple") box.tabIndex = -1;
    });
    // roving tabindex：保证树里始终有一行可 Tab 进入
    const rows = rowsOf(root).filter((r) => !r.closest("[hidden]") && !isDisabled(r));
    if (rows.length) {
      // 原生 button 的 tabIndex 默认就是 0，不能靠它判断，必须显式重写
      const keep =
        rows.find((r) => r === document.activeElement) ||
        rows.find((r) => r.getAttribute("tabindex") === "0") ||
        rows[0];
      rowsOf(root).forEach((r) => {
        r.tabIndex = -1;
      });
      keep.tabIndex = 0;
    }
  };

  /* ---------- 展开 / 收起 ---------- */

  const expand = (item, opts = {}) => {
    const root = rootOf(item);
    const group = groupOf(item);
    const row = rowOf(item);
    if (!root || !group || !row) return false;
    if (row.dataset.loading === "true") return false;
    if (item.hasAttribute("data-lazy") && !item.hasAttribute("data-loaded")) {
      loadLazy(item);
      return true;
    }
    if (group.hidden === false) return false;
    group.hidden = false;
    row.setAttribute("aria-expanded", "true");
    if (!opts.silent) emit(root, "cin:treeexpand", { item, row });
    return true;
  };

  const collapse = (item, opts = {}) => {
    const root = rootOf(item);
    const group = groupOf(item);
    const row = rowOf(item);
    if (!root || !group || !row || group.hidden) return false;
    group.hidden = true;
    row.setAttribute("aria-expanded", "false");
    if (!opts.silent) emit(root, "cin:treecollapse", { item, row });
    return true;
  };

  const toggle = (item) => (isBranch(item) && !groupOf(item).hidden ? collapse(item) : expand(item));

  const loadLazy = (item) => {
    const root = rootOf(item);
    const row = rowOf(item);
    const group = groupOf(item);
    if (!root || !row || row.dataset.loading === "true") return;
    row.dataset.loading = "true";
    row.setAttribute("aria-busy", "true");
    let settled = false;
    const done = (nodes) => {
      if (settled) return;
      settled = true;
      row.dataset.loading = "false";
      row.removeAttribute("aria-busy");
      item.setAttribute("data-loaded", "");
      if (group && nodes && nodes.length) group.replaceChildren(...nodes);
      if (group) group.hidden = false;
      row.setAttribute("aria-expanded", "true");
      decorate(root);
      emit(root, "cin:treeexpand", { item, row, lazy: true });
    };
    emit(root, "cin:treeload", { item, row, done });
  };

  /* ---------- 选中 / 复选 ---------- */

  const syncRowCheck = (item) => {
    const multi = modeOf(rootOf(item)) !== "single";
    const row = rowOf(item);
    const box = checkOf(item);
    if (!row || !multi) return;
    if (box) {
      row.setAttribute("aria-checked", box.indeterminate ? "mixed" : String(box.checked));
      if (!box.hasAttribute("aria-label")) box.setAttribute("aria-label", labelOf(row));
    }
  };

  const syncAncestors = (item) => {
    let parent = parentItemOf(item);
    while (parent) {
      const box = checkOf(parent);
      if (box) {
        const kids = childItemsOf(parent).map(checkOf).filter(Boolean);
        if (kids.length) {
          const all = kids.every((k) => k.checked && !k.indeterminate);
          const none = kids.every((k) => !k.checked && !k.indeterminate);
          box.checked = all;
          box.indeterminate = !all && !none;
        }
      }
      parent = parentItemOf(parent);
    }
    // 祖先三态变化后，整棵树的行状态统一刷一遍
    decorate(rootOf(item));
  };

  const setChecked = (item, value, silent) => {
    const root = rootOf(item);
    const box = checkOf(item);
    if (!root || !box) return;
    const walk = (node, state) => {
      const target = checkOf(node);
      if (target) {
        target.checked = state;
        target.indeterminate = false;
      }
      const row = rowOf(node);
      if (row) row.setAttribute("aria-checked", String(state));
      if (cascadeOf(root)) childItemsOf(node).forEach((child) => walk(child, state));
    };
    walk(item, !!value);
    syncAncestors(item);
    if (!silent) emit(root, "cin:treecheck", { item, row: rowOf(item), checked: box.checked, indeterminate: box.indeterminate, cascade: cascadeOf(root) });
  };

  // 选中/定位一个被收起的深层节点时，先把祖先展开，否则用户看不到它
  const revealAncestors = (item) => {
    let parent = parentItemOf(item);
    while (parent) {
      if (isBranch(parent) && groupOf(parent).hidden && (!parent.hasAttribute("data-lazy") || parent.hasAttribute("data-loaded"))) {
        expand(parent, { silent: true });
      }
      parent = parentItemOf(parent);
    }
  };

  const select = (item, opts = {}) => {
    const root = rootOf(item);
    const row = rowOf(item);
    if (!root || !row) return;
    if (modeOf(root) === "single") revealAncestors(item);
    if (modeOf(root) === "multiple" && checkOf(item)) {
      setChecked(item, !checkOf(item).checked);
      return;
    }
    if (modeOf(root) === "single") {
      rowsOf(root).forEach((r) => r.setAttribute("aria-selected", "false"));
    } else if (row.getAttribute("aria-selected") === "true" && opts.toggle !== false) {
      row.setAttribute("aria-selected", "false");
    }
    row.setAttribute("aria-selected", "true");
    if (!opts.silent) emit(root, "cin:treeselect", { item, row, label: labelOf(row) });
  };

  /* ---------- 键盘漫游 ---------- */

  const focusRow = (row) => {
    const root = rootOf(row);
    if (!root) return;
    rowsOf(root).forEach((r) => {
      r.tabIndex = -1;
      r.__cinRoving = false;
    });
    row.tabIndex = 0;
    row.__cinRoving = true;
    row.focus();
  };

  const visibleRows = (root) => rowsOf(root).filter((r) => !r.closest("[hidden]") && !isDisabled(r));

  const onKeydown = (event) => {
    const row = event.target.closest ? event.target.closest(".cin-tree-row") : null;
    if (!row) return;
    const root = rootOf(row);
    const item = itemOf(row);
    if (!root || !item) return;
    const list = visibleRows(root);
    const at = list.indexOf(row);
    const typeahead = (root.__cinTypeahead = root.__cinTypeahead || { buffer: "", timer: 0 });

    const move = (step) => {
      const next = at + step;
      if (next >= 0 && next < list.length) focusRow(list[next]);
      return true;
    };

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        return;
      case "Home":
        event.preventDefault();
        if (list[0]) focusRow(list[0]);
        return;
      case "End":
        event.preventDefault();
        if (list.length) focusRow(list[list.length - 1]);
        return;
      case "ArrowRight": {
        event.preventDefault();
        if (!isBranch(item)) return;
        if (groupOf(item).hidden) expand(item);
        else {
          const first = childItemsOf(item)[0];
          if (first) focusRow(rowOf(first));
        }
        return;
      }
      case "ArrowLeft": {
        event.preventDefault();
        if (isBranch(item) && !groupOf(item).hidden) collapse(item);
        else {
          const parent = parentItemOf(item);
          if (parent) focusRow(rowOf(parent));
        }
        return;
      }
      case "Enter":
      case " ": {
        event.preventDefault();
        if (modeOf(root) === "multiple" && checkOf(item)) setChecked(item, !checkOf(item).checked);
        else select(item);
        return;
      }
      case "*": {
        event.preventDefault();
        const parent = parentItemOf(item);
        const siblings = parent ? childItemsOf(parent) : itemsOf(root).filter((node) => !parentItemOf(node));
        siblings.forEach((node) => {
          if (isBranch(node)) expand(node);
        });
        return;
      }
      default:
        break;
    }

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      typeahead.buffer += event.key.toLowerCase();
      clearTimeout(typeahead.timer);
      typeahead.timer = setTimeout(() => {
        typeahead.buffer = "";
      }, 600);
      const query = typeahead.buffer;
      const ordered = list.slice(at + 1).concat(list.slice(0, at + 1));
      const hit = ordered.find((node) => labelOf(node).toLowerCase().startsWith(query));
      if (hit) {
        event.preventDefault();
        focusRow(hit);
      }
    }
  };

  /* ---------- 过滤 ---------- */

  const ORIGINAL = new WeakMap();

  const restoreLabel = (row) => {
    const node = labelNodeOf(row);
    if (!node) return;
    if (ORIGINAL.has(node)) node.innerHTML = ORIGINAL.get(node);
  };

  const paintLabel = (row, query) => {
    const node = labelNodeOf(row);
    if (!node) return;
    if (!ORIGINAL.has(node)) ORIGINAL.set(node, node.innerHTML);
    const raw = ORIGINAL.get(node);
    if (!query) {
      node.innerHTML = raw;
      return;
    }
    const text = node.textContent || "";
    const lower = text.toLowerCase();
    const at = lower.indexOf(query);
    if (at < 0) {
      node.innerHTML = raw;
      return;
    }
    const escape = (value) => value.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
    node.innerHTML =
      escape(text.slice(0, at)) +
      '<mark class="cin-tree-mark">' +
      escape(text.slice(at, at + query.length)) +
      "</mark>" +
      escape(text.slice(at + query.length));
  };

  C.filterTree = (root, query) => {
    const targets = root ? [root] : Array.from(document.querySelectorAll(SELECTOR));
    const keyword = (query || "").trim().toLowerCase();
    let total = 0;
    targets.forEach((scope) => {
      const items = itemsOf(scope);
      const hits = new Map();
      const walk = (item) => {
        const row = rowOf(item);
        const own = !!keyword && labelOf(row).toLowerCase().includes(keyword);
        let childHit = false;
        childItemsOf(item).forEach((child) => {
          if (walk(child)) childHit = true;
        });
        const hit = own || childHit;
        hits.set(item, { own, childHit, hit });
        return hit;
      };
      const tops = items.filter((item) => !parentItemOf(item));
      tops.forEach(walk);

      items.forEach((item) => {
        const info = hits.get(item);
        if (!info) return;
        item.hidden = !info.hit;
        if (info.hit) {
          total += 1;
          if (info.childHit) expand(item, { silent: true });
        }
        paintLabel(rowOf(item), keyword);
      });

      const empty = scope.querySelector(":scope > .cin-tree-empty");
      const matched = items.some((item) => !item.hidden);
      if (keyword && !matched) {
        if (!empty) {
          const note = document.createElement("div");
          note.className = "cin-tree-empty";
          note.textContent = scope.getAttribute("data-empty-text") || tr("tree.noMatch", "没有匹配的节点");
          scope.append(note);
        }
      } else if (empty) {
        empty.remove();
      }
      decorate(scope);
    });
    return total;
  };

  /* ---------- 事件与初始化 ---------- */

  const bind = (root) => {
    if (root.__cinTreeBound) return;
    root.__cinTreeBound = true;

    root.addEventListener("click", (event) => {
      const row = event.target.closest(".cin-tree-row");
      if (!row || !root.contains(row) || isDisabled(row)) return;
      const item = itemOf(row);
      if (!item) return;
      if (event.target.closest(".cin-tree-toggle")) {
        if (isBranch(item)) {
          event.preventDefault();
          toggle(item);
        }
        return;
      }
      const box = event.target.closest(".cin-tree-check");
      if (box) return;
      // 还没取过数的懒节点，点行等于展开取数，避免选中一个空壳
      if (item.hasAttribute("data-lazy") && !item.hasAttribute("data-loaded") && isBranch(item)) {
        event.preventDefault();
        toggle(item);
        return;
      }
      select(item);
    });

    root.addEventListener("dblclick", (event) => {
      const row = event.target.closest(".cin-tree-row");
      if (!row || isDisabled(row)) return;
      const item = itemOf(row);
      if (item && isBranch(item) && !event.target.closest(".cin-tree-check")) toggle(item);
    });

    root.addEventListener("change", (event) => {
      const box = event.target.closest(".cin-tree-check");
      if (!box) return;
      const item = itemOf(box);
      if (item) setChecked(item, box.checked);
    });

    root.addEventListener("keydown", onKeydown);

    root.addEventListener("focusin", (event) => {
      const row = event.target.closest(".cin-tree-row");
      if (row && row.closest(SELECTOR) === root) focusRow(row);
    });
  };

  /* 首屏按已有勾选回算父节点三态：HTML 里只写叶子 checked，父节点不该手写 */
  const settleChecks = (root) => {
    if (modeOf(root) === "single") return;
    const walk = (item) => {
      const kids = childItemsOf(item);
      kids.forEach(walk);
      const box = checkOf(item);
      if (!box || !kids.length) return;
      const boxes = kids.map(checkOf).filter(Boolean);
      if (!boxes.length) return;
      const all = boxes.every((k) => k.checked && !k.indeterminate);
      const none = boxes.every((k) => !k.checked && !k.indeterminate);
      box.checked = all;
      box.indeterminate = !all && !none;
    };
    itemsOf(root)
      .filter((item) => !parentItemOf(item))
      .forEach(walk);
  };

  const init = (root) => {
    if (!root || root.__cinTreeInited) return;
    root.__cinTreeInited = true;
    const collapseAll = root.getAttribute("data-collapse") === "all";
    itemsOf(root).forEach((item) => {
      const group = groupOf(item);
      if (!group) return;
      const idleLazy = item.hasAttribute("data-lazy") && !item.hasAttribute("data-loaded");
      const startHidden = idleLazy || item.hasAttribute("data-collapsed") || (collapseAll && isBranch(item));
      group.hidden = startHidden;
    });
    settleChecks(root);
    decorate(root);
    bind(root);
    // 懒加载项若默认收起，展开时才取数；若标了 data-loaded 直接沿用
    itemsOf(root).forEach((item) => {
      if (item.hasAttribute("data-lazy") && item.hasAttribute("data-open")) expand(item, { silent: true });
    });
  };

  C.initTrees = (scope = document) => {
    const nodes = scope.matches && scope.matches(SELECTOR) ? [scope] : Array.from(scope.querySelectorAll(SELECTOR));
    nodes.forEach(init);
    return nodes.length;
  };

  C.tree = {
    expand: (target) => expand(itemOf(target)),
    collapse: (target) => collapse(itemOf(target)),
    toggle: (target) => toggle(itemOf(target)),
    select: (target) => select(itemOf(target)),
    checked: (target) => {
      const box = checkOf(itemOf(target));
      return box ? box.checked : false;
    },
    setChecked: (target, value) => setChecked(itemOf(target), value),
    decorate,
    init: C.initTrees,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => C.initTrees());
  } else {
    C.initTrees();
  }
})();


/* ---- virtualgrid.js ---- */
/*!
 * cinder-base · virtualgrid 行为层
 * 定高行窗口渲染：只把视口内的行放进 DOM，上下用占位行撑出真实滚动高度。
 * 不依赖框架，也不改业务已有的 thead / 列定义；数据通过 setRows 传进来。
 */
(function () {
  const C = (window.Cinder = window.Cinder || {});
  /* 文案走 i18n 字典；未加载 core 时回落到调用处的中文兜底。 */
  const tr = (k, f, v) =>
    C.Primitives && C.Primitives.i18n
      ? C.Primitives.i18n.t(k, f, v)
      : /* 未加载 core 时按同一套 {name} 语法就地插值，保证降级文案不出现占位符 */ v
        ? f.replace(/\{(\w+)\}/g, (m, key) => (v[key] != null ? v[key] : m))
        : f;
  const SEL = "[data-virtual]";
  const DEFAULT_ROW_H = 44;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const px = (n) => (n > 0 ? n + "px" : "0px");

  /* ---------- 列模板：从 thead 读一次，决定每格怎么渲染 ---------- */
  const colsOf = (root) => {
    const ths = Array.from(root.querySelectorAll("thead th"));
    if (!ths.length) return [];
    return ths.map((th, i) => {
      const box = th.querySelector("input[type=checkbox]");
      return {
        key: th.dataset.key || String(i),
        label: th.dataset.label || th.textContent.trim(),
        align: th.dataset.align || "",
        sticky: th.dataset.sticky || "",
        cls: th.className || "",
        check: th.classList.contains("cin-dg-check") || !!box,
        checkAll: !!(box && box.hasAttribute("data-check-all")),
        sort: th.dataset.sort || "",
        sortKey: th.dataset.sort || th.dataset.key || String(i)
      };
    });
  };

  /* ---------- 行数据规整：支持「紧凑数组」与「按列索引」两种写法 ---------- */
  const normalize = (ctl, row) => {
    if (!row || typeof row !== "object") row = { cells: [row] };
    if (Array.isArray(row)) row = { cells: row };
    let cells = Array.isArray(row.cells) ? row.cells : [];
    const total = ctl.cols.length;
    const plain = ctl.cols.filter((c) => !c.check).length;
    /* 业务自然写法会跳过选择列，这里补回占位，避免整体错位一格 */
    if (total && plain !== total && cells.length === plain) {
      const spread = [];
      let k = 0;
      ctl.cols.forEach((c, i) => {
        if (!c.check) spread[i] = cells[k++];
      });
      cells = spread;
    }
    return {
      cells,
      selected: !!row.selected,
      tone: row.tone || "",
      disabled: !!row.disabled,
      id: row.id == null ? "" : String(row.id)
    };
  };

  const putValue = (td, v) => {
    if (v == null) return;
    if (typeof v === "object") {
      if (v.node instanceof Node) {
        td.appendChild(v.node);
        return;
      }
      if (v.html != null) {
        td.innerHTML = String(v.html);
        return;
      }
      if (v.text != null) {
        td.textContent = String(v.text);
        return;
      }
      td.textContent = "";
      return;
    }
    td.textContent = String(v);
  };

  /* ---------- 建行 / 复行 ---------- */
  const fillCells = (ctl, rowEl, row, index) => {
    ctl.cols.forEach((col, ci) => {
      let td = rowEl.children[ci];
      if (!td) {
        td = document.createElement("td");
        rowEl.appendChild(td);
      }
      if (col.cls && td.className !== col.cls) td.className = col.cls;
      if (col.label) td.dataset.label = col.label;
      else delete td.dataset.label;
      if (col.align) td.dataset.align = col.align;
      else delete td.dataset.align;
      if (col.sticky) td.dataset.sticky = col.sticky;
      else delete td.dataset.sticky;

      if (col.check) {
        let box = td.querySelector("input[type=checkbox]");
        if (!box) {
          box = document.createElement("input");
          box.type = "checkbox";
          box.className = "cin-check";
          box.setAttribute("data-check", "");
          td.replaceChildren(box);
        }
        box.checked = !!row.selected;
        box.disabled = !!row.disabled;
        box.setAttribute("aria-label", tr("virtualgrid.selectRow", "选择第 {n} 行", { n: index + 1 }));
      } else {
        putValue(td, row.cells[ci]);
      }
    });
    /* 列变少时清掉多余单元格 */
    while (rowEl.children.length > ctl.cols.length) rowEl.lastElementChild.remove();
  };

  const buildRow = (ctl, row, index) => {
    const tr = document.createElement("tr");
    tr.dataset.vrow = "1";
    tr.dataset.index = String(index);
    if (row.selected) tr.setAttribute("aria-selected", "true");
    if (row.disabled) tr.setAttribute("aria-disabled", "true");
    if (row.tone) tr.dataset.tone = row.tone;
    if (row.id) tr.dataset.id = row.id;
    fillCells(ctl, tr, row, index);
    return tr;
  };

  /* ---------- 占位行：撑高度用，无内容无边框 ---------- */
  const buildPad = (cols) => {
    const tr = document.createElement("tr");
    tr.className = "cin-dg-vpad";
    tr.setAttribute("aria-hidden", "true");
    const td = document.createElement("td");
    td.colSpan = Math.max(1, cols.length);
    td.style.height = "0px";
    tr.appendChild(td);
    return tr;
  };

  const setPad = (pad, h) => {
    pad.style.height = px(h);
    if (pad.firstElementChild) pad.firstElementChild.style.height = px(h);
  };

  /* ---------- 窗口计算与绘制 ---------- */
  const compute = (ctl) => {
    const total = ctl.rows.length;
    const viewH = ctl.scroller.clientHeight || ctl.height || 480;
    const need = Math.max(1, Math.ceil(viewH / ctl.rowH)) + ctl.overscan * 2;
    const maxStart = Math.max(0, total - need);
    const start = clamp(
      Math.floor(Math.max(0, ctl.scroller.scrollTop - ctl.headH) / ctl.rowH) - ctl.overscan,
      0,
      maxStart
    );
    const end = clamp(start + need, 0, total);
    return { start, end, total };
  };

  const paint = (ctl, start, end) => {
    const reuse = new Map();
    Array.from(ctl.tbody.children).forEach((tr) => {
      if (!tr.dataset.vrow) return;
      const i = Number(tr.dataset.index);
      if (i >= start && i < end) reuse.set(i, tr);
    });

    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i += 1) {
      const row = ctl.rows[i];
      let tr = reuse.get(i);
      if (tr) {
        if (row.selected) tr.setAttribute("aria-selected", "true");
        else tr.removeAttribute("aria-selected");
        if (row.disabled) tr.setAttribute("aria-disabled", "true");
        else tr.removeAttribute("aria-disabled");
        if (row.tone) tr.dataset.tone = row.tone;
        else delete tr.dataset.tone;
        if (row.id) tr.dataset.id = row.id;
        else delete tr.dataset.id;
        fillCells(ctl, tr, row, i);
      } else {
        tr = buildRow(ctl, row, i);
      }
      frag.appendChild(tr);
    }

    setPad(ctl.padTop, start * ctl.rowH);
    setPad(ctl.padBottom, (ctl.rows.length - end) * ctl.rowH);
    ctl.tbody.replaceChildren(ctl.padTop, frag, ctl.padBottom);
  };

  const render = (ctl) => {
    if (ctl.dead) return;
    const next = compute(ctl);
    if (!ctl.dirty && next.start === ctl.range.start && next.end === ctl.range.end) return;
    ctl.dirty = false;
    ctl.range = next;
    paint(ctl, next.start, next.end);
    ctl.root.dispatchEvent(
      new CustomEvent("cin:virtualrange", {
        detail: { start: next.start, end: next.end, total: next.total }
      })
    );
  };

  const schedule = (ctl) => {
    if (ctl.raf || ctl.dead) return;
    ctl.raf = requestAnimationFrame(() => {
      ctl.raf = 0;
      render(ctl);
    });
  };

  /* ---------- 选择态 ---------- */
  const selectedIndexes = (ctl) => {
    const out = [];
    ctl.rows.forEach((r, i) => {
      if (r.selected) out.push(i);
    });
    return out;
  };

  const syncHead = (ctl) => {
    const all = ctl.root.querySelector("thead [data-check-all]");
    if (!all) return;
    const sel = selectedIndexes(ctl).length;
    all.checked = sel > 0 && sel === ctl.rows.length;
    all.indeterminate = sel > 0 && sel < ctl.rows.length;
    const bulk = ctl.root.querySelector("[data-bulk-count]");
    if (bulk) bulk.textContent = String(sel);
    if (sel > 0) ctl.root.setAttribute("data-bulk", "1");
    else ctl.root.removeAttribute("data-bulk");
  };

  const emitSelection = (ctl) => {
    const indexes = selectedIndexes(ctl);
    ctl.root.dispatchEvent(
      new CustomEvent("cin:selection", {
        detail: { count: indexes.length, indexes, values: indexes.map((i) => ctl.rows[i]) }
      })
    );
  };

  /* ---------- 事件 ---------- */
  const onClick = (ctl, e) => {
    const th = e.target.closest("th[data-sort]");
    if (th && ctl.root.contains(th)) {
      const dir = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
      ctl.root.querySelectorAll("thead th[aria-sort]").forEach((h) => {
        if (h !== th) h.removeAttribute("aria-sort");
      });
      th.setAttribute("aria-sort", dir);
      ctl.root.dispatchEvent(
        new CustomEvent("cin:sort", { detail: { key: th.dataset.sort, dir, column: th } })
      );
      return;
    }

    const all = e.target.closest("[data-check-all]");
    if (all && ctl.root.contains(all)) {
      const on = all.checked;
      ctl.rows.forEach((r) => {
        r.selected = on;
      });
      ctl.dirty = true;
      render(ctl);
      syncHead(ctl);
      emitSelection(ctl);
      return;
    }

    const tr = e.target.closest("tbody tr[data-vrow]");
    if (tr && ctl.root.contains(tr) && !e.target.closest("input, button, a, select, textarea, label")) {
      const i = Number(tr.dataset.index);
      ctl.root.dispatchEvent(
        new CustomEvent("cin:rowclick", { detail: { index: i, row: ctl.rows[i], originalEvent: e } })
      );
    }
  };

  const onChange = (ctl, e) => {
    const box = e.target.closest("tbody input[type=checkbox][data-check]");
    if (!box || !ctl.root.contains(box)) return;
    const tr = box.closest("tr[data-vrow]");
    if (!tr) return;
    const i = Number(tr.dataset.index);
    ctl.rows[i].selected = box.checked;
    if (box.checked) tr.setAttribute("aria-selected", "true");
    else tr.removeAttribute("aria-selected");
    syncHead(ctl);
    emitSelection(ctl);
  };

  const onKey = (ctl, e) => {
    if (e.key === "Home" && (e.metaKey || e.ctrlKey)) {
      ctl.scroller.scrollTop = 0;
      render(ctl);
    } else if (e.key === "End" && (e.metaKey || e.ctrlKey)) {
      ctl.scroller.scrollTop = ctl.rows.length * ctl.rowH;
      render(ctl);
    }
  };

  /* ---------- 量行高：用探针量一次，避免 rem / token 单位被 parseFloat 丢掉 ---------- */
  const measure = (ctl) => {
    const raw = parseFloat(ctl.root.dataset.rowHeight);
    if (Number.isFinite(raw) && raw > 0) {
      ctl.rowH = raw;
    } else {
      const probe = document.createElement("tr");
      const td = document.createElement("td");
      td.style.cssText = "padding:0;border:0;height:var(--cin-dg-row-h,44px)";
      probe.appendChild(td);
      probe.style.height = "var(--cin-dg-row-h, 44px)";
      ctl.tbody.appendChild(probe);
      const h = probe.getBoundingClientRect().height;
      probe.remove();
      ctl.rowH = h > 0 ? h : DEFAULT_ROW_H;
    }
    ctl.root.style.setProperty("--cin-dg-row-h", ctl.rowH + "px");

    /* 表头参与滚动区高度：sticky 的 thead 仍在文档流里占位，
       窗口计算必须从 scrollTop 里扣掉它，否则首行会被判成上一行。 */
    const thead = ctl.root.querySelector("thead");
    ctl.headH = thead ? thead.getBoundingClientRect().height : 0;

    const dh = parseFloat(ctl.root.dataset.height);
    if (Number.isFinite(dh) && dh > 0) ctl.root.style.setProperty("--cin-dg-vheight", dh + "px");
    const over = parseFloat(ctl.root.dataset.overscan);
    ctl.overscan = Number.isFinite(over) && over >= 0 ? over : 8;
  };

  /* ---------- 从已有 DOM 取初始数据 ---------- */
  const readRows = (ctl) => {
    const out = [];
    Array.from(ctl.tbody.querySelectorAll("tr")).forEach((tr) => {
      if (tr.classList.contains("cin-dg-vpad") || tr.classList.contains("cin-dg-detail")) return;
      const row = {
        cells: [],
        selected: tr.getAttribute("aria-selected") === "true",
        tone: tr.dataset.tone || "",
        disabled: tr.getAttribute("aria-disabled") === "true"
      };
      Array.from(tr.children).forEach((td, ci) => {
        if (td.querySelector('input[type="checkbox"]')) return;
        const own = Array.from(td.childNodes)
          .filter((n) => !(n.nodeType === 1 && n.matches("input,button")))
          .map((n) => n.textContent)
          .join("")
          .trim();
        row.cells[ci] = { text: own };
      });
      out.push(row);
    });
    return out;
  };

  /* ---------- 控制器 ---------- */
  const controller = (ctl) => ({
    get total() {
      return ctl.rows.length;
    },
    get rowHeight() {
      return ctl.rowH;
    },
    get range() {
      return { start: ctl.range.start, end: ctl.range.end };
    },
    get scroller() {
      return ctl.scroller;
    },
    getRows() {
      return ctl.rows.slice();
    },
    getRow(i) {
      return ctl.rows[i];
    },
    setRows(list) {
      ctl.rows = Array.from(list || []).map((r) => normalize(ctl, r));
      ctl.dirty = true;
      ctl.scroller.scrollTop = 0;
      render(ctl);
      syncHead(ctl);
      return ctl.rows.length;
    },
    appendRows(list) {
      Array.from(list || []).forEach((r) => ctl.rows.push(normalize(ctl, r)));
      ctl.dirty = true;
      render(ctl);
      syncHead(ctl);
      return ctl.rows.length;
    },
    updateRow(i, row) {
      if (!ctl.rows[i]) return null;
      ctl.rows[i] = normalize(ctl, row);
      ctl.dirty = true;
      render(ctl);
      return ctl.rows[i];
    },
    scrollToIndex(i, opts) {
      const idx = clamp(Number(i) || 0, 0, Math.max(0, ctl.rows.length - 1));
      const align = (opts && opts.align) || "start";
      const viewH = ctl.scroller.clientHeight || ctl.height;
      let top;
      if (align === "center") top = idx * ctl.rowH - (viewH - ctl.rowH) / 2;
      else if (align === "end") top = idx * ctl.rowH - viewH + ctl.rowH;
      else top = idx * ctl.rowH;
      ctl.scroller.scrollTop = Math.max(0, top + ctl.headH);
      render(ctl);
      return ctl.scroller.scrollTop;
    },
    select(indexes) {
      const want = new Set((indexes || []).map(Number));
      ctl.rows.forEach((r, i) => {
        r.selected = want.has(i);
      });
      ctl.dirty = true;
      render(ctl);
      syncHead(ctl);
      emitSelection(ctl);
      return selectedIndexes(ctl);
    },
    selected() {
      return selectedIndexes(ctl);
    },
    clearSelection() {
      ctl.rows.forEach((r) => {
        r.selected = false;
      });
      ctl.dirty = true;
      render(ctl);
      syncHead(ctl);
      emitSelection(ctl);
    },
    refresh() {
      measure(ctl);
      ctl.dirty = true;
      render(ctl);
    },
    destroy() {
      ctl.dead = true;
      ctl.scroller.removeEventListener("scroll", ctl.onScroll);
      ctl.root.removeEventListener("click", ctl.onClick);
      ctl.root.removeEventListener("change", ctl.onChange);
      ctl.root.removeEventListener("keydown", ctl.onKey);
      if (ctl.ro) ctl.ro.disconnect();
      if (ctl.raf) cancelAnimationFrame(ctl.raf);
      ctl.raf = 0;
      delete ctl.root.__cinVirtual;
      ctl.root.removeAttribute("data-virtual-ready");
    }
  });

  const init = (node) => {
    const root = node && node.closest ? node.closest(SEL) : null;
    if (!root) return null;
    if (root.__cinVirtual) return root.__cinVirtual;
    const table = root.querySelector("table");
    const tbody = root.querySelector("tbody");
    if (!table || !tbody) return null;

    const scroller = root.querySelector(".cin-dg-scroll") || root;
    const ctl = {
      root,
      table,
      tbody,
      scroller,
      cols: colsOf(root),
      rows: [],
      rowH: DEFAULT_ROW_H,
      headH: 0,
      overscan: 8,
      height: 480,
      range: { start: -1, end: -1 },
      dirty: true,
      raf: 0,
      dead: false,
      ro: null,
      padTop: null,
      padBottom: null
    };

    measure(ctl);
    ctl.rows = readRows(ctl).map((r) => normalize(ctl, r));
    ctl.padTop = buildPad(ctl.cols);
    ctl.padBottom = buildPad(ctl.cols);

    ctl.onScroll = () => schedule(ctl);
    ctl.onClick = (e) => onClick(ctl, e);
    ctl.onChange = (e) => onChange(ctl, e);
    ctl.onKey = (e) => onKey(ctl, e);
    scroller.addEventListener("scroll", ctl.onScroll, { passive: true });
    root.addEventListener("click", ctl.onClick);
    root.addEventListener("change", ctl.onChange);
    root.addEventListener("keydown", ctl.onKey);

    if (typeof ResizeObserver === "function") {
      ctl.ro = new ResizeObserver(() => {
        ctl.dirty = true;
        schedule(ctl);
      });
      ctl.ro.observe(scroller);
      ctl.ro.observe(root);
    }

    const api = controller(ctl);
    root.__cinVirtual = api;
    root.setAttribute("data-virtual-ready", "1");
    render(ctl);
    syncHead(ctl);
    return api;
  };

  /* ---------- 对外接口 ---------- */
  C.initVirtualGrids = (scope = document) => {
    let bound = 0;
    Array.from(scope.querySelectorAll(SEL)).forEach((el) => {
      if (el.__cinVirtual) return;
      const api = init(el);
      if (api) bound += 1;
    });
    return bound;
  };

  C.virtualGrid = (node) => init(node);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => C.initVirtualGrids());
  } else {
    C.initVirtualGrids();
  }
})();
