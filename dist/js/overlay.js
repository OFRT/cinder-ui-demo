/* cinder-js:overlay | 7 file(s) | 装配自 packages/base/src */
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
