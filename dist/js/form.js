/* cinder-js:form | 16 file(s) | 装配自 packages/base/src */
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
