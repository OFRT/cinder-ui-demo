/* cinder-js:core | 13 file(s) | 装配自 packages/base/src */
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
