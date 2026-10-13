/* ==========================================================================
   Plotline · views/list.js
   A calm, compact list: one line per task, grouped (status by default) with
   collapsible sections and a quick-add line in every group.

   Click a row to open it, tick the circle to complete it, right-click for
   more, and use the arrow keys to move through rows.
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

  let addingKey = null;   // "<viewId>:<groupKey>" while a quick-add input is open
  let refocus = null;

  /* ---------------------------------------------------------------- Render */

  function render(root, { project, view }) {
    const st = store();
    const ctx = { pid: project.id, vid: view.id };
    const all = st.tasks(project.id);
    const tasks = F().applyAll(all, view, project);
    const rerender = () => render(root, { project: st.project(ctx.pid), view: st.view(ctx.pid, ctx.vid) });

    const prevScroll = root.scrollTop;
    const wrapper = h("div.view-inner", { style: { maxWidth: "980px" } });

    if (!tasks.length) {
      wrapper.append(all.length === 0
        ? ui().emptyState({
            emoji: project.emoji, title: "No tasks yet",
            text: "Add your first task to start planning. You can press C from anywhere.",
            action: { label: "New task", icon: "plus", onClick: () => st.addTask(ctx.pid, {}) },
          })
        : ui().emptyState({
            emoji: "🔍", title: "Nothing matches", text: "No tasks fit the current filters or search.",
            action: { label: "Clear filters", onClick: () => { F().setQuery(""); st.updateView(ctx.pid, ctx.vid, { filters: [] }); } },
          }));
    } else {
      const open = tasks.filter((t) => !st.isDone(t)).length;
      wrapper.append(h("p.muted", { style: { margin: "0 4px 12px", fontSize: "var(--fs-xs)" } },
        `${open} open · ${tasks.length - open} done`));

      const groups = view.group ? F().groupTasks(tasks, view.group, project) : [{ key: "all", label: "", tasks }];
      groups.forEach((g) => wrapper.append(groupEl(g, view, project, ctx)));
    }

    bind(wrapper, ctx, rerender);
    u.mount(root, wrapper);
    root.scrollTop = prevScroll;

    const input = wrapper.querySelector("[data-add-input]");
    if (input) input.focus();
    else if (refocus) wrapper.querySelector(`.list-row[data-task-id="${refocus}"]`)?.focus();
    refocus = null;
  }

  /* ---------------------------------------------------------------- Groups */

  function groupEl(g, view, project, ctx) {
    const grouped = !!view.group;
    const collapsed = grouped && view.collapsed && view.collapsed[g.key];
    const slot = `${view.id}:${g.key}`;

    const label = g.member ? [ui().avatar(g.member, "sm"), h("span", g.label)]
      : g.color ? h("span.tag.c-" + g.color, h("span.dot"), g.label)
      : h("span", g.label);

    const head = grouped
      ? h("div.list-group-head", { dataset: { act: "toggle", key: g.key }, role: "button", tabindex: "0", "aria-expanded": String(!collapsed), style: { cursor: "pointer" } },
          icon("chevron-down", "chev"), label,
          h("span.muted", { style: { fontWeight: 500, fontSize: "var(--fs-xs)" } }, String(g.tasks.length)),
          h("span", { style: { flex: 1 } }),
          h("button.icon-btn.sm", { type: "button", "aria-label": "Add task to " + g.label, dataset: { act: "add-open", key: g.key, field: view.group } }, icon("plus")))
      : null;

    const rows = h("div.list-rows", { role: "list" },
      g.tasks.map((t) => row(t, project, view)),
      addingKey === slot ? addLine(g, view) : h("button.add-line", { type: "button", dataset: { act: "add-open", key: g.key, field: view.group || "" }, style: { width: "100%" } }, icon("plus"), "Add task"));

    return h("section.list-group" + (collapsed ? ".collapsed" : ""), head, rows);
  }

  function addLine(g, view) {
    const input = h("input", { type: "text", placeholder: "Task title, then Enter", "aria-label": "New task title", dataset: { addInput: "1", key: g.key, field: view.group || "" } });
    return h("div.add-line", icon("plus"), input,
      h("button.icon-btn.sm", { type: "button", "aria-label": "Cancel", dataset: { act: "add-cancel" } }, icon("x")));
  }

  /* ------------------------------------------------------------------ Row */

  function row(t, project, view) {
    const st = store();
    const done = st.isDone(t);
    const member = st.member(t.assigneeId);
    const prog = st.progress(t);
    const tags = t.tagIds.map((id) => st.tag(project.id, id)).filter(Boolean);
    const prio = ui().priorityEl(t.priority, { label: false });

    return h("div.list-row" + (done ? ".done" : ""), { role: "listitem", tabindex: "0", dataset: { taskId: t.id } },
      ui().checkEl(done, () => st.toggleDone(t.id)),
      h("span.list-title", t.title),
      h("div.list-meta",
        view.group !== "status" ? ui().statusTag(st.statusOf(t)) : null,
        tags.length ? h("span.tag-list", { style: { flexWrap: "nowrap" } }, tags.slice(0, 2).map(ui().tagEl), tags.length > 2 ? h("span.tag.c-gray", "+" + (tags.length - 2)) : null) : null,
        prog.total ? h("span.due", { title: "Subtasks" }, `${prog.done}/${prog.total}`) : null,
        prio,
        ui().dueEl(t),
        member ? ui().avatar(member, "sm") : null));
  }

  /* ----------------------------------------------------------- Interaction */

  function defaultsFor(field, key) {
    switch (field) {
      case "status": return { statusId: key };
      case "priority": return { priority: key };
      case "assignee": return key === "none" ? {} : { assigneeId: key };
      case "tag": return key === "none" ? {} : { tagIds: [key] };
      case "due": {
        const days = { overdue: -1, today: 0, week: 3, later: 14 }[key];
        return days == null ? {} : { due: u.addDays(u.today(), days) };
      }
      default: return {};
    }
  }

  function bind(wrapper, ctx, rerender) {
    const st = store();

    wrapper.addEventListener("click", (e) => {
      const actEl = e.target.closest("[data-act]");
      const rowEl = e.target.closest(".list-row");
      if (!actEl) { if (rowEl) Plot.drawer.open(rowEl.dataset.taskId); return; }

      switch (actEl.dataset.act) {
        case "toggle": {
          const view = st.view(ctx.pid, ctx.vid);
          const c = { ...(view.collapsed || {}) };
          c[actEl.dataset.key] = !c[actEl.dataset.key];
          st.updateView(ctx.pid, ctx.vid, { collapsed: c });
          break;
        }
        case "add-open":
          e.stopPropagation();
          addingKey = `${ctx.vid}:${actEl.dataset.key}`;
          // opening from a collapsed group should reveal it
          if (st.view(ctx.pid, ctx.vid).collapsed?.[actEl.dataset.key]) {
            st.updateView(ctx.pid, ctx.vid, { collapsed: { ...st.view(ctx.pid, ctx.vid).collapsed, [actEl.dataset.key]: false } });
          } else rerender();
          break;
        case "add-cancel": addingKey = null; rerender(); break;
        default: break;
      }
    });

    wrapper.addEventListener("keydown", (e) => {
      const input = e.target.closest("[data-add-input]");
      if (input) {
        if (e.key === "Enter") {
          e.preventDefault();
          const title = input.value.trim();
          if (!title) return;
          st.addTask(ctx.pid, { title, ...defaultsFor(input.dataset.field, input.dataset.key) });
        } else if (e.key === "Escape") { e.stopPropagation(); addingKey = null; rerender(); }
        return;
      }
      const rowEl = e.target.closest(".list-row");
      if (rowEl && e.target === rowEl) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); Plot.drawer.open(rowEl.dataset.taskId); }
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const rows = Array.from(wrapper.querySelectorAll(".list-row"));
          rows[rows.indexOf(rowEl) + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
        }
        return;
      }
      const head = e.target.closest(".list-group-head");
      if (head && e.target === head && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); head.click(); }
    });

    wrapper.addEventListener("contextmenu", (e) => {
      const rowEl = e.target.closest(".list-row");
      if (!rowEl) return;
      const id = rowEl.dataset.taskId;
      const t = st.task(id);
      const project = st.project(ctx.pid);
      ui().contextMenu(e, [
        { label: "Open", icon: "arrow-up-right", onClick: () => Plot.drawer.open(id) },
        { label: st.isDone(t) ? "Mark as not done" : "Mark as done", icon: "check-circle", onClick: () => st.toggleDone(id) },
        { sep: true },
        { heading: "Set status" },
        ...project.statuses.map((s) => ({ label: s.name, color: s.color, selected: s.id === t.statusId, onClick: () => st.updateTask(id, { statusId: s.id }) })),
        { sep: true },
        { label: "Duplicate", icon: "copy", onClick: () => { st.duplicateTask(id); ui().toast("Task duplicated"); } },
        { label: "Delete", icon: "trash", danger: true, onClick: () => {
            st.deleteTask(id);
            ui().toast("Task deleted", { action: { label: "Undo", onClick: () => st.undo() } });
        } },
      ]);
    });
  }

  /* --------------------------------------------------------------- Styles */

  document.head.append(h("style", { id: "list-styles" }, `
    .list-group { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); padding: 4px 8px 4px; }
    .list-group-head { padding: 8px 6px; border-radius: var(--r-sm); }
    .list-group-head:hover { background: var(--hover); }
    .list-row:last-of-type { border-bottom: 0; }
    .list-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: var(--r-sm); }
    .list-row .list-meta .due { min-width: 0; }
    .list-rows > button.add-line:hover { color: var(--ink); background: var(--hover); border-radius: var(--r-sm); }
    .list-group .add-line input { padding: 4px 0; }
    @media (max-width: 640px) { .list-row .tag-list, .list-row .list-meta .tag.c-gray { display: none; } }
  `));

  Plot.views.list = { wide: false, render };
})();
