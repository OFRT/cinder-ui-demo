/* cinder-js:ai | 6 file(s) | 装配自 packages/base/src */
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
