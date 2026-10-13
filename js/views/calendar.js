/* ==========================================================================
   Plotline · views/calendar.js
   Month calendar.

   - Tasks appear on their due date (or start date when there is no due date).
   - Drag a task to another day to reschedule it. A task that has both dates
     keeps its length: both dates move together.
   - Undated tasks wait in an "Unscheduled" tray; drag them onto a day.
   - Hover a day and press + (or double-click it) to add a task for that date.
   - "+N more" opens the rest of the day's tasks.

   Also used by the sidebar's "All calendar" page: app.js passes project = null
   and a throw-away view, and the calendar then shows every project.
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

  let cursor = u.today().slice(0, 8) + "01";   // first day of the month on screen
  let swallowClick = false;

  const dateOf = (t) => t.due || t.start || null;

  /* ---------------------------------------------------------------- Render */

  function render(root, { project, view }) {
    const st = store();
    const weekStart = Plot.prefs.get("weekStart", 0);
    const limit = window.innerWidth <= 860 ? 2 : 3;
    const rerender = () => render(root, { project: project ? st.project(project.id) : null, view });

    const all = project ? st.tasks(project.id) : st.tasks();
    const tasks = F().applyAll(all, view, project);

    const byDate = new Map();
    const unscheduled = [];
    tasks.forEach((t) => {
      const d = dateOf(t);
      if (!d) { if (!st.isDone(t)) unscheduled.push(t); return; }
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(t);
    });

    const today = u.today();
    const days = u.monthGrid(cursor, weekStart);
    const month = u.parseDate(cursor).getMonth();
    const dow = Array.from({ length: 7 }, (_, i) => u.DOW[(i + weekStart) % 7]);

    const bar = h("div.cal-bar",
      h("button.icon-btn", { type: "button", "aria-label": "Previous month", dataset: { act: "prev" } }, icon("chevron-left")),
      h("button.icon-btn", { type: "button", "aria-label": "Next month", dataset: { act: "next" } }, icon("chevron-right")),
      h("h2", { "aria-live": "polite" }, u.monthLabel(cursor)),
      h("span", { style: { flex: 1 } }),
      h("button.btn.sm", { type: "button", dataset: { act: "today" } }, "Today"));

    const grid = h("div.cal", { role: "grid", "aria-label": u.monthLabel(cursor) },
      dow.map((d) => h("div.cal-dow", { role: "columnheader" }, d)),
      days.map((iso) => dayCell(iso, byDate.get(iso) || [], { today, month, limit, canAdd: !!project })));

    const tray = unscheduled.length ? trayEl(unscheduled, project) : null;
    const wrapper = h("div.view-inner", bar, grid, tray);

    bind(wrapper, { project, view }, rerender);
    const prev = root.scrollTop;
    u.mount(root, wrapper);
    root.scrollTop = prev;
  }

  /* ------------------------------------------------------------------ Day */

  function dayCell(iso, tasks, o) {
    const d = u.parseDate(iso);
    const other = d.getMonth() !== o.month;
    const label = d.getDate() === 1 ? `${u.MONTHS[d.getMonth()].slice(0, 3)} 1` : String(d.getDate());
    const shown = tasks.slice(0, o.limit);
    const extra = tasks.length - shown.length;

    return h("div.cal-day" + (other ? ".other" : "") + (iso === o.today ? ".today" : ""),
      { role: "gridcell", dataset: { date: iso }, "aria-label": u.fmtDateLong(iso) + (tasks.length ? `, ${u.plural(tasks.length, "task")}` : "") },
      h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
        h("span.cal-date", label),
        o.canAdd ? h("button.icon-btn.sm.cal-add", { type: "button", "aria-label": "Add task on " + u.fmtDate(iso), dataset: { act: "add", date: iso } }, icon("plus")) : null),
      shown.map((t) => eventEl(t, { showProject: !o.canAdd })),
      extra > 0 ? h("button.cal-more", { type: "button", dataset: { act: "more", date: iso } }, `+${extra} more`) : null);
  }

  function eventEl(t, opts = {}) {
    const st = store();
    const status = st.statusOf(t);
    const project = st.project(t.projectId);
    const showProject = !!opts.showProject;
    return h("button.cal-event.c-" + (status ? status.color : "gray") + (st.isDone(t) ? ".done" : ""),
      { type: "button", dataset: { taskId: t.id }, title: t.title },
      showProject && project ? project.emoji + " " : null, t.title);
  }

  function trayEl(list, project) {
    return h("section", { style: { marginTop: "20px" } },
      h("div.section-title", h("span", "Unscheduled"), h("span.muted", `${list.length} · drag onto a day`)),
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" }, dataset: { tray: "1" } },
        list.slice(0, 40).map((t) => {
          const el = eventEl(t, { showProject: !project });
          el.style.width = "auto";
          el.style.maxWidth = "260px";
          return el;
        })));
  }

  /* ----------------------------------------------------------- Interaction */

  function bind(wrapper, ctx, rerender) {
    const st = store();

    wrapper.addEventListener("click", (e) => {
      const actEl = e.target.closest("[data-act]");
      const evEl = e.target.closest(".cal-event");

      if (!actEl) { if (evEl) Plot.drawer.open(evEl.dataset.taskId); return; }

      switch (actEl.dataset.act) {
        case "prev": cursor = u.addMonths(cursor, -1); rerender(); break;
        case "next": cursor = u.addMonths(cursor, 1); rerender(); break;
        case "today": cursor = u.today().slice(0, 8) + "01"; rerender(); break;
        case "add": addOn(actEl.dataset.date, ctx); break;
        case "more": {
          const date = actEl.dataset.date;
          const list = F().applyAll(ctx.project ? st.tasks(ctx.project.id) : st.tasks(), ctx.view, ctx.project).filter((t) => dateOf(t) === date);
          ui().menu(actEl, [
            { heading: u.fmtDateLong(date) },
            ...list.map((t) => ({ label: t.title, color: st.statusOf(t)?.color, onClick: () => Plot.drawer.open(t.id) })),
          ], { width: 280 });
          break;
        }
        default: break;
      }
    });

    wrapper.addEventListener("dblclick", (e) => {
      if (!ctx.project || e.target.closest(".cal-event, button")) return;
      const day = e.target.closest(".cal-day");
      if (day) addOn(day.dataset.date, ctx);
    });

    wrapper.addEventListener("contextmenu", (e) => {
      const ev = e.target.closest(".cal-event");
      if (!ev) return;
      const id = ev.dataset.taskId;
      const t = st.task(id);
      ui().contextMenu(e, [
        { label: "Open", icon: "arrow-up-right", onClick: () => Plot.drawer.open(id) },
        { label: st.isDone(t) ? "Mark as not done" : "Mark as done", icon: "check-circle", onClick: () => st.toggleDone(id) },
        { label: "Clear date", icon: "x", disabled: !t.due && !t.start, onClick: () => st.updateTask(id, { due: null, start: null }) },
        { sep: true },
        { label: "Delete", icon: "trash", danger: true, onClick: () => {
            st.deleteTask(id);
            ui().toast("Task deleted", { action: { label: "Undo", onClick: () => st.undo() } });
        } },
      ]);
    });

    wrapper.addEventListener("click", (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);

    bindDrag(wrapper);
  }

  async function addOn(date, ctx) {
    if (!ctx.project) return;
    const title = await ui().prompt({
      title: "New task", label: "Due " + u.fmtDateLong(date), placeholder: "What needs doing?", confirmLabel: "Add task",
    });
    if (title) store().addTask(ctx.project.id, { title, due: date });
  }

  /* --------------------------------------------------------- Drag to move */

  function bindDrag(wrapper) {
    const st = store();
    let pending = null;
    let drag = null;

    wrapper.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const ev = e.target.closest(".cal-event");
      if (!ev) return;
      pending = { el: ev, id: ev.dataset.taskId, x: e.clientX, y: e.clientY, type: e.pointerType, timer: 0 };
      if (e.pointerType !== "mouse") {
        pending.timer = setTimeout(() => { if (pending) { if (navigator.vibrate) navigator.vibrate(8); begin(pending.x, pending.y); } }, 260);
      }
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
    });

    function begin(x, y) {
      if (!pending || drag) return;
      const rect = pending.el.getBoundingClientRect();
      const ghost = pending.el.cloneNode(true);
      Object.assign(ghost.style, {
        position: "fixed", left: rect.left + "px", top: rect.top + "px", width: Math.min(rect.width, 220) + "px",
        zIndex: "200", pointerEvents: "none", boxShadow: "var(--shadow-3)", transform: "rotate(1.5deg)",
      });
      document.body.append(ghost);
      pending.el.classList.add("dragging");
      document.body.classList.add("is-dragging");
      drag = { id: pending.id, src: pending.el, ghost, offX: x - rect.left, offY: y - rect.top, day: null };
      document.addEventListener("touchmove", blockScroll, { passive: false });
      document.addEventListener("keydown", onKey, true);
    }

    const blockScroll = (e) => { if (drag) e.preventDefault(); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); finish(false); } };

    function onMove(e) {
      if (!pending && !drag) return;
      if (!drag) {
        const dist = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
        if (pending.type === "mouse") { if (dist > 5) begin(e.clientX, e.clientY); }
        else if (dist > 10) cleanup();
        return;
      }
      drag.ghost.style.left = e.clientX - drag.offX + "px";
      drag.ghost.style.top = e.clientY - drag.offY + "px";
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const day = under && under.closest(".cal-day[data-date]");
      wrapper.querySelectorAll(".cal-day.drop-over").forEach((d) => { if (d !== day) d.classList.remove("drop-over"); });
      if (day && wrapper.contains(day)) day.classList.add("drop-over");
      drag.day = day && wrapper.contains(day) ? day.dataset.date : null;
    }

    const onUp = () => (drag ? finish(true) : cleanup());
    const onCancel = () => (drag ? finish(false) : cleanup());

    function finish(commit) {
      const d = drag;
      cleanup();
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 0);
      if (!commit || !d.day) return;

      const t = st.task(d.id);
      const from = dateOf(t);
      if (from === d.day) return;
      const patch = {};
      if (t.due) {
        patch.due = d.day;
        if (t.start) patch.start = u.addDays(t.start, u.diffDays(t.due, d.day));   // keep the task's length
      } else {
        patch.due = d.day;                                                         // undated or start-only: set the due date
        if (t.start && t.start > d.day) patch.start = d.day;
      }
      st.updateTask(d.id, patch);
      ui().toast(`Moved to ${u.fmtDate(d.day)}`, { action: { label: "Undo", onClick: () => st.undo() } });
    }

    function cleanup() {
      if (pending && pending.timer) clearTimeout(pending.timer);
      pending = null;
      if (drag) { drag.ghost.remove(); drag.src.classList.remove("dragging"); drag = null; }
      wrapper.querySelectorAll(".cal-day.drop-over").forEach((d) => d.classList.remove("drop-over"));
      document.body.classList.remove("is-dragging");
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("touchmove", blockScroll);
      document.removeEventListener("keydown", onKey, true);
    }
  }

  /* --------------------------------------------------------------- Styles */

  document.head.append(h("style", { id: "calendar-styles" }, `
    .cal-event { border: 0; text-align: left; }
    .cal-event.dragging { opacity: 0.35; }
    .cal-event:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .cal-add { opacity: 0; transition: opacity var(--t-fast); }
    .cal-day:hover .cal-add, .cal-add:focus-visible { opacity: 1; }
    .cal-more { border: 0; background: none; text-align: left; cursor: pointer; }
    @media (hover: none) { .cal-add { display: none; } }
  `));

  Plot.views.calendar = { wide: false, render };
})();
