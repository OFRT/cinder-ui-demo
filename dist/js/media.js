/* cinder-js:media | 6 file(s) | 装配自 packages/base/src */
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
