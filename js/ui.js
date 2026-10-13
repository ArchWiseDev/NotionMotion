/* ==========================================================================
   Plotline · ui.js
   Shared interface building blocks, exposed as Plot.ui:

     Overlays   menu, popover, contextMenu, modal, confirm, prompt, toast
     Elements   avatar, statusTag, priorityEl, tagEl, dueEl, checkEl, emptyState
     Pickers    pickStatus, pickPriority, pickAssignee, pickDate, pickTags,
                pickEmoji, pickColor

   All overlays share one layer stack, so Escape always closes the top-most
   thing and focus returns to where it was. A few small styles that only this
   file needs (date picker, tag picker) are injected at the bottom.
   ========================================================================== */
(function () {
  "use strict";

  const Plot = (window.Plot = window.Plot || {});
  const u = Plot.u;
  const { h } = u;
  const icon = (name, cls) => Plot.icons.el(name, cls);

  const menuRoot = () => document.getElementById("menu-root");
  const modalRoot = () => document.getElementById("modal-root");
  const toastRoot = () => document.getElementById("toast-root");

  /* ---------------------------------------------------------- Layer stack */

  const layers = [];
  let lastOutside = { anchor: null, at: 0 };

  const top = () => layers[layers.length - 1];

  function closeMenus() {
    layers.filter((l) => l.type === "menu").forEach((l) => l.close(false));
  }

  document.addEventListener("keydown", (e) => {
    const layer = top();
    if (!layer) return;

    if (e.key === "Escape" && layer.closable !== false) {
      e.preventDefault();
      e.stopPropagation();
      layer.close(true);
      return;
    }
    if (layer.type === "menu" && layer.onKey) layer.onKey(e);

    // Keep Tab focus inside the topmost modal
    if (layer.type === "modal" && e.key === "Tab") {
      const f = u.$$('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', layer.el)
        .filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, true);

  document.addEventListener("pointerdown", (e) => {
    const layer = top();
    if (!layer || layer.type !== "menu") return;
    if (layers.some((l) => l.type === "menu" && l.el.contains(e.target))) return;
    lastOutside = { anchor: layer.anchor, at: Date.now() };
    closeMenus();
  }, true);

  window.addEventListener("resize", closeMenus);
  document.addEventListener("scroll", (e) => {
    if (top()?.type === "menu" && !top().el.contains(e.target)) closeMenus();
  }, true);

  /* -------------------------------------------------------------- Popover */

  function place(el, anchor, opts) {
    const r = anchor && anchor.getBoundingClientRect
      ? anchor.getBoundingClientRect()
      : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
    const pad = 8;
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = el.offsetWidth, hh = el.offsetHeight;
    let left = opts.align === "right" ? r.right - w : r.left;
    let topPx = r.bottom + 4;
    left = u.clamp(left, pad, Math.max(pad, vw - pad - w));
    if (topPx + hh > vh - pad) {
      const above = r.top - 4 - hh;
      if (above >= pad) topPx = above;
      else { topPx = pad; el.style.maxHeight = vh - pad * 2 + "px"; }
    }
    el.style.left = left + "px";
    el.style.top = topPx + "px";
  }

  /** Low-level floating panel. `content` is a Node or array of Nodes. */
  function popover(anchor, content, opts = {}) {
    if (anchor && lastOutside.anchor === anchor && Date.now() - lastOutside.at < 250) return null; // toggle-off click
    if (!opts.stack) closeMenus();

    const el = h("div.menu", { role: opts.role || "menu", tabindex: "-1" }, content);
    if (opts.className) el.classList.add(...opts.className.split(" "));
    if (opts.width) { el.style.width = opts.width + "px"; el.style.maxWidth = "none"; }
    el.style.visibility = "hidden";
    menuRoot().append(el);
    place(el, anchor, opts);
    el.style.visibility = "";

    const prev = document.activeElement;
    const layer = {
      type: "menu", el, anchor,
      close(restore = true) {
        const i = layers.indexOf(layer);
        if (i === -1) return;
        layers.splice(i, 1);
        el.remove();
        if (opts.onClose) opts.onClose();
        if (restore && prev && prev.focus && document.contains(prev)) prev.focus({ preventScroll: true });
      },
    };
    layers.push(layer);
    return layer;
  }

  /**
   * Menu from an item list:
   *   { label, icon, color, lead, hint, selected, danger, disabled, keepOpen, onClick }
   *   { sep: true }   { heading: "Text" }
   * opts: { search: true|"placeholder", align: "right", width, empty: "text" }
   */
  function menu(anchor, items, opts = {}) {
    const buttons = [];
    const nodes = [];
    let layer;

    items.filter(Boolean).forEach((item) => {
      if (item.sep) { nodes.push(h("div.menu-sep")); return; }
      if (item.heading) { nodes.push(h("div.menu-label", { dataset: { heading: "1" } }, item.heading)); return; }

      const btn = h(
        "button.menu-item" + (item.danger ? ".danger" : "") + (item.selected ? ".selected" : ""),
        { type: "button", role: "menuitem", disabled: item.disabled || null, dataset: { label: String(item.label || "").toLowerCase() } },
        item.lead || (item.icon && icon(item.icon)) || (item.color && h("span.dot.c-" + item.color)),
        h("span.menu-text", item.label),
        item.hint && h("span.menu-hint", item.hint),
        item.selected && h("span.menu-check", icon("check"))
      );
      btn.addEventListener("click", (e) => {
        if (!item.keepOpen) layer.close(true);
        if (item.onClick) item.onClick(e);
      });
      btn.addEventListener("mouseenter", () => setFocus(buttons.indexOf(btn)));
      buttons.push(btn);
      nodes.push(btn);
    });

    const emptyMsg = h("div.menu-label", { hidden: true }, opts.empty || "No matches");
    nodes.push(emptyMsg);

    let search = null;
    if (opts.search) {
      search = h("input.input", {
        type: "text", autocomplete: "off", spellcheck: "false",
        placeholder: typeof opts.search === "string" ? opts.search : "Search…",
        "aria-label": "Filter options",
      });
    }

    let idx = -1;
    const visible = () => buttons.filter((b) => !b.hidden && !b.disabled);
    function setFocus(i) {
      const list = visible();
      buttons.forEach((b) => b.classList.remove("focus"));
      if (!list.length) { idx = -1; return; }
      idx = (i + list.length) % list.length;
      const b = list[idx];
      b.classList.add("focus");
      b.scrollIntoView({ block: "nearest" });
    }

    if (search) {
      search.addEventListener("input", () => {
        const q = search.value.trim().toLowerCase();
        buttons.forEach((b) => { b.hidden = !!q && !b.dataset.label.includes(q); });
        nodes.forEach((n) => { if (n.dataset && n.dataset.heading) n.hidden = !!q; });
        emptyMsg.hidden = !q || visible().length > 0;
        setFocus(0);
      });
    }

    const content = [search && h("div.menu-search", search), ...nodes];
    layer = popover(anchor, content, { ...opts, role: "menu" });
    if (!layer) return null;

    layer.onKey = (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setFocus(idx + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setFocus(idx < 0 ? -1 : idx - 1); }
      else if (e.key === "Home") { e.preventDefault(); setFocus(0); }
      else if (e.key === "End") { e.preventDefault(); setFocus(-1); }
      else if (e.key === "Enter") {
        const b = visible()[idx];
        if (b) { e.preventDefault(); b.click(); }
      }
    };

    const selectedIdx = visible().findIndex((b) => b.classList.contains("selected"));
    if (search) { setFocus(Math.max(0, selectedIdx)); requestAnimationFrame(() => search.focus()); }
    else { layer.el.focus({ preventScroll: true }); if (selectedIdx >= 0) setFocus(selectedIdx); }
    return layer;
  }

  const contextMenu = (e, items, opts) => {
    e.preventDefault();
    return menu({ x: e.clientX, y: e.clientY }, items, opts);
  };

  /* ---------------------------------------------------------------- Modal */

  /**
   * modal({ title, body, actions, wide, closable, onClose })
   * actions: [{ label, variant: "primary"|"danger solid"|"ghost", onClick(ctx) }]
   * Return false from onClick to keep the modal open.
   */
  function modal(opts) {
    const prev = document.activeElement;
    const titleId = u.uid("mt");
    const body = h("div.modal-body", opts.body);
    const closeBtn = opts.closable === false ? null
      : h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: () => layer.close(true) }, icon("x"));

    const foot = opts.actions && opts.actions.length
      ? h("div.modal-foot", opts.actions.map((a) => {
          const b = h("button.btn" + (a.variant ? "." + a.variant.split(" ").join(".") : ""), { type: "button", dataset: a.autofocus ? { autofocus: "1" } : null }, a.label);
          b.addEventListener("click", async () => {
            const r = a.onClick ? await a.onClick(layer) : undefined;
            if (r !== false) layer.close(true);
          });
          return b;
        }))
      : null;

    const dlg = h("div.modal" + (opts.wide ? ".wide" : ""), { role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabindex: "-1" },
      h("div.modal-head", h("h2", { id: titleId }, opts.title || ""), closeBtn),
      body, foot);
    const wrap = h("div.modal-wrap", dlg);
    wrap.addEventListener("pointerdown", (e) => { if (e.target === wrap && opts.closable !== false) layer.close(true); });

    const layer = {
      type: "modal", el: dlg, wrap, body, closable: opts.closable !== false,
      close(restore = true) {
        const i = layers.indexOf(layer);
        if (i === -1) return;
        layers.splice(i, 1);
        wrap.remove();
        if (opts.onClose) opts.onClose();
        if (restore && prev && prev.focus && document.contains(prev)) prev.focus({ preventScroll: true });
      },
    };

    closeMenus();
    layers.push(layer);
    modalRoot().append(wrap);

    const auto = dlg.querySelector('[data-autofocus]') || dlg.querySelector("input, textarea, select") || dlg;
    requestAnimationFrame(() => auto.focus({ preventScroll: true }));
    return layer;
  }

  function confirm({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false }) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      modal({
        title,
        body: h("p", message),
        onClose: () => done(false),
        actions: [
          { label: cancelLabel, onClick: () => done(false) },
          { label: confirmLabel, variant: danger ? "danger solid" : "primary", autofocus: true, onClick: () => done(true) },
        ],
      });
    });
  }

  function prompt({ title, label, value = "", placeholder = "", confirmLabel = "Save", multiline = false }) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      const input = multiline
        ? h("textarea.textarea", { placeholder, rows: 4 }, value)
        : h("input.input", { type: "text", value, placeholder });
      const submit = () => { const v = input.value.trim(); if (!v) { input.classList.add("error"); input.focus(); return false; } done(v); };
      if (!multiline) input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (submit() !== false) layer.close(true); } });
      const layer = modal({
        title,
        body: h("div.field", label && h("label.field-label", label), input),
        onClose: () => done(null),
        actions: [
          { label: "Cancel", onClick: () => done(null) },
          { label: confirmLabel, variant: "primary", onClick: submit },
        ],
      });
      requestAnimationFrame(() => { input.focus(); input.select && input.select(); });
    });
  }

  /* ---------------------------------------------------------------- Toast */

  function toast(message, opts = {}) {
    const root = toastRoot();
    while (root.children.length >= 3) root.firstChild.remove();
    let timer;
    const el = h("div.toast", { role: "status" }, h("span", message));
    const dismiss = () => {
      clearTimeout(timer);
      el.classList.add("out");
      setTimeout(() => el.remove(), 220);
    };
    if (opts.action) {
      el.append(h("button", { type: "button", onclick: () => { dismiss(); opts.action.onClick(); } }, opts.action.label));
    }
    root.append(el);
    timer = setTimeout(dismiss, opts.duration || (opts.action ? 6000 : 3200));
    return { dismiss };
  }

  /* ------------------------------------------------------------- Elements */

  function avatar(member, size = "") {
    if (!member) return null;
    return h("span.avatar" + (size ? "." + size : "") + ".c-" + u.colorFor(member.name),
      { title: member.name }, u.initials(member.name));
  }

  const statusTag = (status) =>
    status ? h("span.tag.c-" + status.color, h("span.dot"), status.name) : null;

  const tagEl = (tag) => (tag ? h("span.tag.c-" + tag.color, tag.name) : null);

  function priorityEl(id, opts = {}) {
    const p = Plot.store.priority(id);
    if (p.id === "none" && !opts.showNone) return null;
    return h("span.prio.c-" + p.color, icon("flag"), opts.label === false ? null : p.name);
  }

  function dueEl(task) {
    if (!task.due) return null;
    const info = u.dueInfo(task.due, Plot.store.isDone(task));
    return h("span.due" + (info.cls ? "." + info.cls : ""), { title: u.fmtDateLong(task.due) }, info.text);
  }

  function checkEl(done, onToggle) {
    const b = h("button.check" + (done ? ".done" : ""),
      { type: "button", role: "checkbox", "aria-checked": String(!!done), "aria-label": done ? "Mark as not done" : "Mark as done" },
      icon("check"));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      b.classList.add("pop");
      setTimeout(() => b.classList.remove("pop"), 180);
      if (onToggle) onToggle(e);
    });
    return b;
  }

  function emptyState({ emoji = "✨", title, text, action }) {
    return h("div.empty",
      h("div.empty-emoji", emoji), h("h3", title), text && h("p", text),
      action && h("button.btn.primary", { type: "button", onclick: action.onClick }, action.icon && icon(action.icon), action.label));
  }

  /* -------------------------------------------------------------- Pickers */

  function pickStatus(anchor, project, currentId, onPick) {
    return menu(anchor, project.statuses.map((s) => ({
      label: s.name, color: s.color, selected: s.id === currentId, onClick: () => onPick(s.id),
    })));
  }

  function pickPriority(anchor, current, onPick) {
    return menu(anchor, Plot.consts.PRIORITIES.map((p) => ({
      label: p.name, color: p.color, selected: p.id === current, onClick: () => onPick(p.id),
    })));
  }

  function pickAssignee(anchor, currentId, onPick) {
    const items = [{ label: "Unassigned", icon: "user", selected: !currentId, onClick: () => onPick(null) }, { sep: true }];
    Plot.store.members().forEach((m) => {
      items.push({ label: m.name, lead: avatar(m, "sm"), selected: m.id === currentId, onClick: () => onPick(m.id) });
    });
    return menu(anchor, items, { search: Plot.store.members().length > 6 ? "Find a person…" : false });
  }

  function pickEmoji(anchor, onPick) {
    const list = ["📁","📂","🚀","📱","🎯","🧭","🗺️","🏃","🐞","📝","🎉","💡","🔥","⭐","✅","📊","📈","🧪","🛠️","⚙️","🔧","💻","🖥️","🌐",
      "🔒","🎨","🖌️","📣","📢","📅","⏰","🧠","📚","🎓","💬","📧","🛒","💰","🏆","🌱","🌍","☀️","🌙","⚡","❤️","🧩","🔍","📌",
      "🔖","📦","🚚","✈️","🏠","🍕","☕","🎵","🎬","📷","🤝","👋","📄","🗒️","📋","🧾"];
    const grid = h("div.emoji-grid", list.map((e) =>
      h("button", { type: "button", "aria-label": e, onclick: () => { layer.close(true); onPick(e); } }, e)));
    const layer = popover(anchor, grid, { role: "dialog" });
    return layer;
  }

  function pickColor(anchor, current, onPick) {
    const box = h("div.swatches", u.COLORS.map((c) =>
      h("button.swatch.c-" + c + (c === current ? ".on" : ""), { type: "button", title: c, "aria-label": c, onclick: () => { layer.close(true); onPick(c); } })));
    const layer = popover(anchor, box, { role: "dialog" });
    return layer;
  }

  /** Month popover. onPick(isoDate) or onPick(null) when cleared. */
  function pickDate(anchor, current, onPick, opts = {}) {
    let view = (current || u.today()).slice(0, 8) + "01";
    const box = h("div.dp");
    const t0 = u.today();
    let layer;
    const choose = (iso) => { layer.close(true); onPick(iso); };

    function draw() {
      const vm = u.parseDate(view).getMonth();
      u.mount(box,
        h("div.dp-head",
          h("button.icon-btn.sm", { type: "button", "aria-label": "Previous month", onclick: () => { view = u.addMonths(view, -1); draw(); } }, icon("chevron-left")),
          h("strong", u.monthLabel(view)),
          h("button.icon-btn.sm", { type: "button", "aria-label": "Next month", onclick: () => { view = u.addMonths(view, 1); draw(); } }, icon("chevron-right"))),
        h("div.dp-grid",
          u.DOW.map((d) => h("span.dp-dow", d.slice(0, 2))),
          u.monthGrid(view, 0).map((iso) => {
            const d = u.parseDate(iso);
            return h("button.dp-day" + (d.getMonth() !== vm ? ".other" : "") + (iso === t0 ? ".today" : "") + (iso === current ? ".sel" : ""),
              { type: "button", "aria-label": u.fmtDateLong(iso), onclick: () => choose(iso) }, d.getDate());
          })),
        h("div.dp-foot",
          h("button.btn.sm.ghost", { type: "button", onclick: () => choose(t0) }, "Today"),
          h("button.btn.sm.ghost", { type: "button", onclick: () => choose(u.addDays(t0, 1)) }, "Tomorrow"),
          h("button.btn.sm.ghost", { type: "button", onclick: () => choose(u.addDays(t0, 7)) }, "Next week"),
          current && opts.allowClear !== false && h("button.btn.sm.ghost.danger", { type: "button", onclick: () => choose(null) }, "Clear")));
    }
    draw();
    layer = popover(anchor, box, { role: "dialog", className: "dp-pop" });
    return layer;
  }

  /** Multi-select with inline create. onChange(arrayOfTagIds) fires on every toggle. */
  function pickTags(anchor, projectId, selectedIds, onChange) {
    const sel = new Set(selectedIds);
    const store = Plot.store;
    const input = h("input.input", { type: "text", placeholder: "Find or create a tag…", autocomplete: "off", spellcheck: "false", "aria-label": "Find or create a tag" });
    const list = h("div.tp-list");
    const filtered = () => {
      const q = input.value.trim().toLowerCase();
      return store.project(projectId).tags.filter((t) => !q || t.name.toLowerCase().includes(q));
    };

    function toggle(id) {
      sel.has(id) ? sel.delete(id) : sel.add(id);
      onChange(Array.from(sel));
      draw();
    }
    function create() {
      const name = input.value.trim();
      if (!name) return;
      const tag = store.addTag(projectId, name);
      sel.add(tag.id);
      onChange(Array.from(sel));
      input.value = "";
      draw();
    }
    function draw() {
      const q = input.value.trim();
      const tags = filtered();
      const exact = store.project(projectId).tags.some((t) => t.name.toLowerCase() === q.toLowerCase());
      u.mount(list,
        tags.map((t) => h("button.menu-item" + (sel.has(t.id) ? ".selected" : ""), { type: "button", onclick: () => toggle(t.id) },
          h("span.dot.c-" + t.color), h("span.menu-text", t.name), sel.has(t.id) && h("span.menu-check", icon("check")))),
        q && !exact && h("button.menu-item", { type: "button", onclick: create }, icon("plus"), h("span.menu-text", `Create “${q}”`)),
        !tags.length && !q && h("div.menu-label", "No tags yet. Type a name to create one."));
    }
    input.addEventListener("input", draw);
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const first = filtered()[0];
      if (first && first.name.toLowerCase() === input.value.trim().toLowerCase()) toggle(first.id);
      else if (input.value.trim()) create();
      else if (first) toggle(first.id);
    });
    draw();
    const layer = popover(anchor, [h("div.menu-search", input), list], { role: "dialog", width: 240 });
    if (layer) requestAnimationFrame(() => input.focus());
    return layer;
  }

  /* ------------------------------------------------------- Injected styles */

  const css = `
    .menu-check { margin-left: auto; display: inline-flex; }
    .menu-check svg { width: 15px; height: 15px; }
    .menu-item .dot { margin: 0 3px; }
    .menu-item .avatar { box-shadow: none; }
    .tp-list { display: flex; flex-direction: column; max-height: 240px; overflow-y: auto; }
    .dp-pop { width: 272px; padding: 10px; max-width: none; }
    .dp-head { display: flex; align-items: center; justify-content: space-between; padding: 0 2px 8px; font-size: var(--fs-sm); }
    .dp-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
    .dp-dow { text-align: center; padding: 4px 0; font-size: var(--fs-2xs); font-weight: 700; color: var(--ink-3); }
    .dp-day { display: grid; place-items: center; height: 32px; border-radius: 50%; font-size: var(--fs-xs); font-weight: 600; color: var(--ink); text-align: center; }
    .dp-day:hover { background: var(--hover); }
    .dp-day.other { color: var(--ink-4); }
    .dp-day.today { box-shadow: inset 0 0 0 1.5px var(--accent); }
    .dp-day.sel { background: var(--accent); color: var(--accent-ink); box-shadow: none; }
    .dp-foot { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); }
    .dp-foot .btn.danger { margin-left: auto; }
  `;
  document.head.append(h("style", { id: "ui-styles" }, css));

  /* --------------------------------------------------------------- Export */

  Plot.ui = {
    popover, menu, contextMenu, closeMenus, modal, confirm, prompt, toast,
    avatar, statusTag, tagEl, priorityEl, dueEl, checkEl, emptyState,
    pickStatus, pickPriority, pickAssignee, pickDate, pickTags, pickEmoji, pickColor,
    hasOverlay: () => layers.length > 0,
    closeTop: () => { const l = top(); if (l && l.closable !== false) { l.close(true); return true; } return false; },
  };
})();
