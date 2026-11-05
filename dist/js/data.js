/* cinder-js:data | 9 file(s) | 装配自 packages/base/src */
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
