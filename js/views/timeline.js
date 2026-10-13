/* ==========================================================================
   Plotline · views/timeline.js
   Gantt-style timeline.

   - One row per task, sorted by start date. Bars are colored by status and
     filled to show subtask progress.
   - Drag a bar to move it, drag either end to change its length.
     Works with mouse and touch (press and hold on a phone).
   - Undated tasks sit at the bottom: click their row to schedule them.
   - Zoom: Day, Week or Month. "Today" jumps to the current date.
   ========================================================================== */
(function () {
  "use strict";

  const Plot = (window.Plot = window.Plot || {});
  Plot.views = Plot.views || {};

  const u = Plot.u;
  const { h } = u;
  const icon = (n, c) => Plot.icons.el(n, c);
  const store = () => Plot.store;
  const ui = () => Plot.ui;
  const F = () => Plot.filters;

  const ZOOM = { day: 40, week: 22, month: 10 };
  const centered = new Set();      // views already scrolled to today once
  let swallowClick = false;

  const startOf = (t) => t.start || t.due;
  const endOf = (t) => t.due || t.start;

  /* ---------------------------------------------------------------- Render */

  function render(root, { project, view }) {
    const st = store();
    const zoom = Plot.prefs.get("tlZoom", "week");
    const dayW = ZOOM[zoom] || ZOOM.week;
    const ctx = { pid: project.id, vid: view.id, dayW };
    const rerender = () => render(root, { project: st.project(ctx.pid), view: st.view(ctx.pid, ctx.vid) });

    const all = st.tasks(project.id);
    const tasks = F().applyAll(all, view, project);
    const dated = tasks.filter((t) => startOf(t)).sort((a, b) => startOf(a).localeCompare(startOf(b)) || a.order - b.order);
    const undated = tasks.filter((t) => !startOf(t));
    const ordered = [...dated, ...undated];

    const prevScroller = root.querySelector(".tl-scroll");
    const prevLeft = prevScroller ? prevScroller.scrollLeft : null;
    const prevTop = root.scrollTop;

    const wrapper = h("div.view-inner");

    if (!tasks.length) {
      wrapper.append(all.length === 0
        ? ui().emptyState({
            emoji: project.emoji, title: "No tasks yet", text: "Add tasks with start and due dates to see them on the timeline.",
            action: { label: "New task", icon: "plus", onClick: () => st.addTask(ctx.pid, { start: u.today(), due: u.addDays(u.today(), 3) }) },
          })
        : ui().emptyState({
            emoji: "🔍", title: "Nothing matches", text: "No tasks fit the current filters or search.",
            action: { label: "Clear filters", onClick: () => { F().setQuery(""); st.updateView(ctx.pid, ctx.vid, { filters: [] }); } },
          }));
      u.mount(root, wrapper);
      return;
    }

    // Visible date range
    const today = u.today();
    const stamps = [today];
    dated.forEach((t) => stamps.push(startOf(t), endOf(t)));
    stamps.sort();
    let first = u.addDays(stamps[0], -10);
    first = u.addDays(first, -((u.parseDate(first).getDay() + 6) % 7));            // back to a Monday
    let last = u.addDays(stamps[stamps.length - 1], 30);
    if (u.diffDays(first, last) < 56) last = u.addDays(first, 56);
    const total = u.diffDays(first, last) + 1;
    const width = total * dayW;
    const x = (iso) => u.diffDays(first, iso) * dayW;
    ctx.first = first;

    const seg = h("div.seg", { role: "group", "aria-label": "Zoom" },
      Object.keys(ZOOM).map((z) => h("button.seg-btn" + (z === zoom ? ".active" : ""), { type: "button", dataset: { act: "zoom", zoom: z } }, z[0].toUpperCase() + z.slice(1))));
    const bar = h("div.cal-bar", seg, h("span", { style: { flex: 1 } }),
      h("button.btn.sm", { type: "button", dataset: { act: "today" } }, icon("target"), "Today"));

    // Left column: task names
    const side = h("div.tl-side",
      h("div.tl-side-head", "Task"),
      ordered.map((t) => h("div.tl-name", { dataset: { taskId: t.id }, tabindex: "0", role: "button", style: startOf(t) ? null : { color: "var(--ink-3)" } },
        ui().checkEl(st.isDone(t), () => st.toggleDone(t.id)),
        h("span.t", t.title))));

    // Right column: header + rows
    const head = h("div.tl-head", { style: { width: width + "px" } }, monthLabels(first, last, x), dayLabels(first, total, dayW, zoom, today));

    const rows = h("div.tl-rows", { style: { width: width + "px" } },
      decorations(first, total, dayW, zoom, today, x),
      ordered.map((t) => trackRow(t, x, dayW, st)));

    const scroller = h("div.tl-scroll", h("div.tl-inner", { style: { width: width + "px" } }, head, rows));
    const wrap = h("div.tl", side, scroller);
    wrapper.append(bar, wrap);

    bind(wrapper, scroller, ctx, rerender);
    u.mount(root, wrapper);
    root.scrollTop = prevTop;

    if (prevLeft != null && centered.has(view.id)) scroller.scrollLeft = prevLeft;
    else { scroller.scrollLeft = Math.max(0, x(today) - scroller.clientWidth / 3); centered.add(view.id); }
  }

  /* ---------------------------------------------------------------- Header */

  function monthLabels(first, last, x) {
    const out = [];
    let cur = first;
    while (cur <= last) {
      const d = u.parseDate(cur);
      out.push(h("div.tl-month", { style: { left: x(cur) + "px" } }, `${u.MONTHS[d.getMonth()]} ${d.getFullYear()}`));
      cur = u.addMonths(cur.slice(0, 8) + "01", 1);
    }
    return out;
  }

  function dayLabels(first, total, dayW, zoom, today) {
    if (zoom === "month") return [];
    const out = [];
    for (let i = 0; i < total; i++) {
      const iso = u.addDays(first, i);
      const d = u.parseDate(iso);
      const monday = d.getDay() === 1;
      if (zoom === "week" && !monday) continue;
      out.push(h("div.tl-day" + (u.isWeekend(iso) ? ".weekend" : "") + (iso === today ? ".today" : ""),
        { style: { left: i * dayW + "px", width: (zoom === "week" ? dayW * 7 : dayW) + "px" } }, String(d.getDate())));
    }
    return out;
  }

  function decorations(first, total, dayW, zoom, today, x) {
    const out = [];
    for (let i = 0; i < total; i++) {
      const iso = u.addDays(first, i);
      const dow = u.parseDate(iso).getDay();
      if (dow === 1) out.push(h("div.tl-gridline", { style: { left: i * dayW + "px" } }));
      if (zoom !== "month" && dow === 6) out.push(h("div.tl-weekend", { style: { left: i * dayW + "px", width: Math.min(2, total - i) * dayW + "px" } }));
    }
    out.push(h("div.tl-today", { style: { left: x(today) + dayW / 2 - 1 + "px" }, title: "Today" }));
    return out;
  }

  /* ------------------------------------------------------------------ Rows */

  function trackRow(t, x, dayW, st) {
    const s = startOf(t);
    if (!s) {
      return h("div.tl-row", { dataset: { undated: "1", taskId: t.id } }, h("span.tl-hint", "Click to schedule"));
    }
    const e = endOf(t);
    const status = st.statusOf(t);
    const done = st.isDone(t);
    const pct = done ? 100 : st.progress(t).pct;
    const left = x(s);
    const w = (u.diffDays(s, e) + 1) * dayW - 2;

    return h("div.tl-row", { dataset: { taskId: t.id } },
      h("div.tl-bar.c-" + (status ? status.color : "gray") + (done ? ".done" : ""), {
        tabindex: "0", role: "button", dataset: { bar: t.id },
        style: { left: left + "px", width: Math.max(w, dayW - 2) + "px" },
        title: `${t.title}\n${u.fmtDate(s)}${e !== s ? " → " + u.fmtDate(e) : ""}`,
      },
        pct ? h("span.fill", { style: { width: pct + "%" } }) : null,
        h("span.label", t.title),
        h("span.handle.l", { dataset: { mode: "l" } }), h("span.handle.r", { dataset: { mode: "r" } })));
  }

  /* ----------------------------------------------------------- Interaction */

  function bind(wrapper, scroller, ctx, rerender) {
    const st = store();
    const centerToday = () => { scroller.scrollTo({ left: Math.max(0, u.diffDays(ctx.first, u.today()) * ctx.dayW - scroller.clientWidth / 2), behavior: "smooth" }); };

    wrapper.addEventListener("click", (e) => {
      const actEl = e.target.closest("[data-act]");
      if (actEl) {
        if (actEl.dataset.act === "zoom") { Plot.prefs.set("tlZoom", actEl.dataset.zoom); centered.delete(ctx.vid); rerender(); }
        else if (actEl.dataset.act === "today") centerToday();
        return;
      }

      // Undated row: schedule the task at the clicked day
      const undated = e.target.closest('.tl-row[data-undated]');
      if (undated) {
        const rect = undated.getBoundingClientRect();
        const day = u.addDays(ctx.first, Math.floor((e.clientX - rect.left) / ctx.dayW));
        st.updateTask(undated.dataset.taskId, { start: day, due: u.addDays(day, 2) });
        return;
      }

      const name = e.target.closest(".tl-name");
      const bar = e.target.closest(".tl-bar");
      const id = (name && name.dataset.taskId) || (bar && bar.dataset.bar);
      if (id) Plot.drawer.open(id);
    });

    wrapper.addEventListener("click", (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);

    wrapper.addEventListener("keydown", (e) => {
      const el = e.target.closest(".tl-bar, .tl-name");
      if (!el || e.target !== el) return;
      const id = el.dataset.bar || el.dataset.taskId;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); Plot.drawer.open(id); return; }
      // Keyboard rescheduling: Alt + arrows moves a bar a day, Alt + Shift stretches it
      if (el.classList.contains("tl-bar") && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const t = st.task(id);
        const dir = e.key === "ArrowRight" ? 1 : -1;
        const patch = {};
        if (e.shiftKey) patch.due = u.addDays(endOf(t), dir);
        else { if (t.start) patch.start = u.addDays(t.start, dir); if (t.due) patch.due = u.addDays(t.due, dir); }
        if (patch.due && startOf(t) && patch.due < (patch.start || startOf(t))) return;
        st.updateTask(id, patch);
      }
    });

    wrapper.addEventListener("contextmenu", (e) => {
      const el = e.target.closest(".tl-bar, .tl-name");
      if (!el) return;
      const id = el.dataset.bar || el.dataset.taskId;
      const t = st.task(id);
      ui().contextMenu(e, [
        { label: "Open", icon: "arrow-up-right", onClick: () => Plot.drawer.open(id) },
        { label: st.isDone(t) ? "Mark as not done" : "Mark as done", icon: "check-circle", onClick: () => st.toggleDone(id) },
        { label: "Clear dates", icon: "x", disabled: !t.start && !t.due, onClick: () => st.updateTask(id, { start: null, due: null }) },
        { sep: true },
        { label: "Delete", icon: "trash", danger: true, onClick: () => {
            st.deleteTask(id);
            ui().toast("Task deleted", { action: { label: "Undo", onClick: () => st.undo() } });
        } },
      ]);
    });

    bindDrag(wrapper, scroller, ctx);
  }

  /* -------------------------------------------------- Drag: move and resize */

  function bindDrag(wrapper, scroller, ctx) {
    const st = store();
    let pending = null;
    let drag = null;
    let raf = 0;
    let lastX = 0;

    wrapper.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const bar = e.target.closest(".tl-bar");
      if (!bar) return;
      const t = st.task(bar.dataset.bar);
      if (!t) return;
      const handle = e.target.closest(".handle");
      pending = {
        bar, id: t.id, mode: handle ? handle.dataset.mode : "move",
        x0: e.clientX, scroll0: scroller.scrollLeft, type: e.pointerType, timer: 0,
        s0: startOf(t), d0: endOf(t), left0: parseFloat(bar.style.left), width0: parseFloat(bar.style.width),
      };
      lastX = e.clientX;
      if (e.pointerType !== "mouse") {
        pending.timer = setTimeout(() => { if (pending) { if (navigator.vibrate) navigator.vibrate(8); begin(); } }, 260);
      }
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
    });

    function begin() {
      if (!pending || drag) return;
      drag = { ...pending, ds: 0, de: 0, moved: false };
      pending.bar.classList.add("dragging");
      document.body.classList.add("is-dragging");
      document.addEventListener("touchmove", blockScroll, { passive: false });
      document.addEventListener("keydown", onKey, true);
      loop();
    }

    const blockScroll = (e) => { if (drag) e.preventDefault(); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); finish(false); } };

    function onMove(e) {
      if (!pending && !drag) return;
      lastX = e.clientX;
      if (!drag) {
        const dist = Math.abs(e.clientX - pending.x0);
        if (pending.type === "mouse") { if (dist > 4) begin(); }
        else if (dist > 10) { cleanup(); return; }
        if (!drag) return;
      }
      apply();
    }

    // Convert pointer movement (plus any scrolling) into whole days, then restyle the bar live
    function apply() {
      const dx = lastX - drag.x0 + (scroller.scrollLeft - drag.scroll0);
      const days = Math.round(dx / ctx.dayW);
      let ds = 0, de = 0;
      if (drag.mode === "move") { ds = days; de = days; }
      else if (drag.mode === "l") ds = Math.min(days, u.diffDays(drag.s0, drag.d0));
      else de = Math.max(days, -u.diffDays(drag.s0, drag.d0));
      drag.ds = ds; drag.de = de;
      if (ds || de) drag.moved = true;

      const s = u.addDays(drag.s0, ds), d = u.addDays(drag.d0, de);
      drag.bar.style.left = drag.left0 + ds * ctx.dayW + "px";
      drag.bar.style.width = Math.max(drag.width0 + (de - ds) * ctx.dayW, ctx.dayW - 2) + "px";
      drag.bar.title = `${u.fmtDate(s)}${d !== s ? " → " + u.fmtDate(d) : ""}`;
      drag.s = s; drag.d = d;
    }

    function loop() {
      if (!drag) return;
      const r = scroller.getBoundingClientRect();
      if (lastX < r.left + 60) scroller.scrollLeft -= 12;
      else if (lastX > r.right - 60) scroller.scrollLeft += 12;
      apply();
      raf = requestAnimationFrame(loop);
    }

    const onUp = () => (drag ? finish(true) : cleanup());
    const onCancel = () => (drag ? finish(false) : cleanup());

    function finish(commit) {
      const d = drag;
      cleanup();
      if (d && d.moved) { swallowClick = true; setTimeout(() => { swallowClick = false; }, 0); }
      if (!commit || !d || !d.moved) { if (d && !commit) d.bar.style.left = d.left0 + "px"; return; }

      const t = st.task(d.id);
      const patch = {};
      if (d.mode === "move") {
        if (t.start) patch.start = d.s;
        if (t.due) patch.due = d.d;
      } else if (d.mode === "l") {
        patch.start = d.s;
      } else {
        patch.due = d.d;
      }
      st.updateTask(d.id, patch);
    }

    function cleanup() {
      if (pending && pending.timer) clearTimeout(pending.timer);
      pending = null;
      cancelAnimationFrame(raf);
      if (drag) { drag.bar.classList.remove("dragging"); drag = null; }
      document.body.classList.remove("is-dragging");
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("touchmove", blockScroll);
      document.removeEventListener("keydown", onKey, true);
    }
  }

  /* --------------------------------------------------------------- Styles */

  document.head.append(h("style", { id: "timeline-styles" }, `
    .tl-scroll { touch-action: pan-x pan-y; }
    .tl-bar.dragging { filter: brightness(1.08); box-shadow: var(--shadow-3); z-index: 5; }
    .tl-bar:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }
    .tl-bar .label { pointer-events: none; }
    .tl-name { outline-offset: -2px; }
    .tl-name:focus-visible { outline: 2px solid var(--accent); }
    .tl-name .check { flex: none; }
    .tl-row[data-undated] { cursor: copy; }
    .tl-hint { position: sticky; left: 16px; display: inline-block; margin: 9px 0 0 16px; font-size: var(--fs-xs); color: var(--ink-4); }
    .tl-row[data-undated]:hover .tl-hint { color: var(--accent); }
    .tl-row:not([data-undated]):hover { background: var(--hover); }
  `));

  Plot.views.timeline = { wide: true, render };
})();
