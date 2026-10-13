/* ==========================================================================
   Plotline · views/table.js
   Table view: sortable columns, grouping with collapsible sections, inline
   pickers for every property, double-click to rename, multi-select with a
   bulk action bar, right-click menu and keyboard open (Enter).

   View contract (shared by every file in js/views/):
     Plot.views.<type> = { wide: boolean, render(root, { project, view }) }
   `root` is the scrolling #view element. The view builds its own wrapper,
   attaches listeners to that wrapper only, and mounts it. app.js calls
   render again after every store change.
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

  const COLS = [
    { id: "title", label: "Title", icon: "text", cls: "col-title", sort: "title" },
    { id: "status", label: "Status", icon: "circle-half", cls: "col-status", sort: "status" },
    { id: "priority", label: "Priority", icon: "flag", cls: "col-prio", sort: "priority" },
    { id: "assignee", label: "Assignee", icon: "user", cls: "col-assignee", sort: "assignee" },
    { id: "due", label: "Due", icon: "calendar", cls: "col-date", sort: "due" },
    { id: "tags", label: "Tags", icon: "tag", cls: "col-tags" },
    { id: "progress", label: "Subtasks", icon: "subtask", cls: "col-progress" },
  ];

  // Selection survives re-renders of the same view, and resets when you switch views.
  const selected = new Set();
  let selectedFor = "";
  let pendingRename = null;

  /* ---------------------------------------------------------------- Render */

  function render(root, { project, view }) {
    const st = store();
    if (selectedFor !== view.id) { selected.clear(); selectedFor = view.id; }

    const all = st.tasks(project.id);
    const known = new Set(all.map((t) => t.id));
    selected.forEach((id) => { if (!known.has(id)) selected.delete(id); });

    const tasks = F().applyAll(all, view, project);
    const ctx = { pid: project.id, vid: view.id, root };
    const rerender = () => render(root, { project: st.project(ctx.pid), view: st.view(ctx.pid, ctx.vid) });

    const prevScroll = root.scrollTop;
    const prevWrap = root.querySelector(".tbl-wrap");
    const prevLeft = prevWrap ? prevWrap.scrollLeft : 0;

    const wrapper = h("div.view-inner");

    if (!tasks.length) {
      wrapper.append(emptyState(project, all.length, ctx));
    } else {
      const groups = view.group ? F().groupTasks(tasks, view.group, project) : [{ key: "all", label: "", tasks }];
      const table = h("table.tbl", { role: "grid", "aria-label": project.name + " tasks" },
        h("thead", h("tr", headerCells(tasks, view))),
        h("tbody", groups.flatMap((g) => groupRows(g, view, project))));
      wrapper.append(h("div.tbl-wrap", table));
      wrapper.append(h("p.muted", { style: { margin: "12px 4px 0", fontSize: "var(--fs-xs)" } },
        u.plural(tasks.length, "task") + (tasks.length !== all.length ? ` shown of ${all.length}` : "")));
    }

    if (selected.size) wrapper.append(bulkBar(project, rerender));

    bind(wrapper, ctx, rerender);
    u.mount(root, wrapper);
    root.scrollTop = prevScroll;
    const newWrap = root.querySelector(".tbl-wrap");
    if (newWrap) newWrap.scrollLeft = prevLeft;

    if (pendingRename) {
      const span = root.querySelector(`tr[data-task-id="${pendingRename}"] .t`);
      pendingRename = null;
      if (span) { span.scrollIntoView({ block: "nearest" }); startRename(span); }
    }
  }

  /* --------------------------------------------------------------- Header */

  function headerCells(tasks, view) {
    const sort = view.sort || { field: "order", dir: "asc" };
    const allOn = tasks.length > 0 && tasks.every((t) => selected.has(t.id));

    const cells = [
      h("th.col-check", h("button.check.square" + (allOn ? ".sel" : ""), {
        type: "button", role: "checkbox", "aria-checked": String(allOn), "aria-label": "Select all tasks", dataset: { act: "select-all" },
      }, icon("check"))),
    ];
    COLS.forEach((c) => {
      const active = c.sort && sort.field === c.sort;
      cells.push(h("th" + "." + c.cls + (c.sort ? ".sortable" : ""),
        {
          scope: "col",
          "aria-sort": active ? (sort.dir === "asc" ? "ascending" : "descending") : "none",
          dataset: c.sort ? { act: "sort", field: c.sort } : null,
        },
        h("div.th-in", icon(c.icon), c.label, active ? h("span.sort-ind", icon(sort.dir === "asc" ? "chevron-up" : "chevron-down")) : null)));
    });
    return cells;
  }

  /* ----------------------------------------------------------------- Rows */

  function groupRows(g, view, project) {
    const rows = [];
    const grouped = !!view.group;
    const collapsed = grouped && view.collapsed && view.collapsed[g.key];

    if (grouped) {
      const label = g.member ? [ui().avatar(g.member, "sm"), g.label]
        : g.color ? h("span.tag.c-" + g.color, h("span.dot"), g.label)
        : g.label;
      rows.push(h("tr.tbl-group" + (collapsed ? ".collapsed" : ""), { dataset: { act: "group", key: g.key }, tabindex: "0", "aria-expanded": String(!collapsed) },
        h("td", { colSpan: COLS.length + 1 },
          h("div.grp-in", icon("chevron-down"), label, h("span.grp-count", String(g.tasks.length))))));
    }
    if (!collapsed) {
      g.tasks.forEach((t) => rows.push(taskRow(t, project)));
      rows.push(h("tr.tbl-add", { dataset: { act: "add", field: view.group || "", key: g.key } },
        h("td", { colSpan: COLS.length + 1 }, h("div.add-in", icon("plus"), "New task"))));
    }
    return rows;
  }

  function taskRow(t, project) {
    const st = store();
    const done = st.isDone(t);
    const isSel = selected.has(t.id);
    const member = st.member(t.assigneeId);
    const prog = st.progress(t);
    const tags = t.tagIds.map((id) => st.tag(project.id, id)).filter(Boolean);
    const ph = (text) => h("span.cell-ph", text);

    return h("tr" + (done ? ".done" : "") + (isSel ? ".selected" : ""), { tabindex: "0", dataset: { taskId: t.id } },
      h("td.col-check", h("button.check.square" + (isSel ? ".sel" : ""), {
        type: "button", role: "checkbox", "aria-checked": String(isSel), "aria-label": "Select task", dataset: { act: "select" },
      }, icon("check"))),

      h("td.title-cell",
        h("div.title-cell-in",
          ui().checkEl(done, () => st.toggleDone(t.id)),
          h("span.t", { dataset: { act: "title" }, title: "Double-click to rename" }, t.title),
          h("button.row-open", { type: "button", dataset: { act: "open" } }, icon("arrow-up-right"), "Open"))),

      h("td", h("button.cell-btn", { type: "button", dataset: { act: "status" } }, ui().statusTag(st.statusOf(t)))),
      h("td", h("button.cell-btn", { type: "button", dataset: { act: "priority" } }, ui().priorityEl(t.priority) || ph("Set"))),
      h("td", h("button.cell-btn", { type: "button", dataset: { act: "assignee" } },
        member ? [ui().avatar(member, "sm"), h("span.truncate", member.name)] : ph("Assign"))),
      h("td", h("button.cell-btn", { type: "button", dataset: { act: "due" } }, ui().dueEl(t) || ph("Set date"))),
      h("td", h("button.cell-btn", { type: "button", dataset: { act: "tags" } },
        tags.length ? h("span.tag-list", { style: { flexWrap: "nowrap" } }, tags.slice(0, 2).map(ui().tagEl), tags.length > 2 ? h("span.tag.c-gray", "+" + (tags.length - 2)) : null) : ph("Add tag"))),
      h("td", prog.total
        ? h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
            h("div.progress" + (prog.pct === 100 ? ".green" : ""), { style: { flex: 1 } }, h("i", { style: { width: prog.pct + "%" } })),
            h("span.muted", { style: { fontSize: "var(--fs-xs)", minWidth: "28px" } }, `${prog.done}/${prog.total}`))
        : null));
  }

  /* ---------------------------------------------------------- Empty state */

  function emptyState(project, total, ctx) {
    if (total === 0) {
      return ui().emptyState({
        emoji: project.emoji, title: "No tasks yet",
        text: "Add your first task to start planning. You can press C from anywhere.",
        action: { label: "New task", icon: "plus", onClick: () => createTask(ctx, {}) },
      });
    }
    return ui().emptyState({
      emoji: "🔍", title: "Nothing matches",
      text: "No tasks fit the current filters or search.",
      action: { label: "Clear filters", onClick: () => { F().setQuery(""); store().updateView(ctx.pid, ctx.vid, { filters: [] }); } },
    });
  }

  /* ------------------------------------------------------------- Bulk bar */

  function bulkBar(project, rerender) {
    const st = store();
    const ids = () => Array.from(selected);
    const apply = (patch) => {
      const list = ids();
      st.batch("Bulk edit", () => list.forEach((id) => st.updateTask(id, patch)));
      ui().toast(`${u.plural(list.length, "task")} updated`);
    };
    const btn = (label, ico, fn) => h("button.btn.sm", { type: "button", onclick: (e) => fn(e.currentTarget) }, icon(ico), label);

    return h("div.bulk-bar", { role: "toolbar", "aria-label": "Bulk actions" },
      h("span", `${selected.size} selected`),
      btn("Status", "circle-half", (a) => ui().pickStatus(a, project, null, (sid) => apply({ statusId: sid }))),
      btn("Priority", "flag", (a) => ui().pickPriority(a, null, (p) => apply({ priority: p }))),
      btn("Assign", "user", (a) => ui().pickAssignee(a, null, (m) => apply({ assigneeId: m }))),
      btn("Delete", "trash", () => {
        const list = ids();
        selected.clear();
        st.deleteTasks(list);
        ui().toast(`${u.plural(list.length, "task")} deleted`, { action: { label: "Undo", onClick: () => st.undo() } });
      }),
      h("button.icon-btn", { type: "button", "aria-label": "Clear selection", style: { color: "inherit" }, onclick: () => { selected.clear(); rerender(); } }, icon("x")));
  }

  /* ---------------------------------------------------------- Interaction */

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

  function createTask(ctx, fields) {
    const t = store().addTask(ctx.pid, fields);
    if (t) pendingRename = t.id;
  }

  function startRename(span) {
    const tr = span.closest("tr");
    const id = tr.dataset.taskId;
    const original = store().task(id).title;
    let cancelled = false;

    span.contentEditable = "true";
    span.focus();
    const range = document.createRange();
    range.selectNodeContents(span);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    span.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); span.blur(); }
      else if (e.key === "Escape") { e.stopPropagation(); cancelled = true; span.blur(); }
    });
    span.addEventListener("blur", () => {
      span.contentEditable = "false";
      const v = span.textContent.trim();
      if (!cancelled && v && v !== original) store().updateTask(id, { title: v });
      else span.textContent = original;
    }, { once: true });
  }

  function bind(wrapper, ctx, rerender) {
    const st = store();
    const fresh = () => ({ project: st.project(ctx.pid), view: st.view(ctx.pid, ctx.vid) });

    wrapper.addEventListener("click", (e) => {
      const actEl = e.target.closest("[data-act]");
      const tr = e.target.closest("tr[data-task-id]");
      const id = tr && tr.dataset.taskId;
      if (!actEl) { if (id) Plot.drawer.open(id); return; }

      const t = id ? st.task(id) : null;
      const { project, view } = fresh();

      switch (actEl.dataset.act) {
        case "select":
          selected.has(id) ? selected.delete(id) : selected.add(id);
          rerender();
          break;
        case "select-all": {
          const visible = F().applyAll(st.tasks(project.id), view, project);
          const allOn = visible.every((x) => selected.has(x.id));
          visible.forEach((x) => (allOn ? selected.delete(x.id) : selected.add(x.id)));
          rerender();
          break;
        }
        case "sort": {
          const field = actEl.dataset.field;
          const cur = view.sort || { field: "order", dir: "asc" };
          const next = cur.field !== field ? { field, dir: "asc" } : cur.dir === "asc" ? { field, dir: "desc" } : { field: "order", dir: "asc" };
          st.updateView(ctx.pid, ctx.vid, { sort: next });
          break;
        }
        case "group": {
          const c = { ...(view.collapsed || {}) };
          c[actEl.dataset.key] = !c[actEl.dataset.key];
          st.updateView(ctx.pid, ctx.vid, { collapsed: c });
          break;
        }
        case "add":
          createTask(ctx, defaultsFor(actEl.dataset.field, actEl.dataset.key));
          break;
        case "open": Plot.drawer.open(id); break;
        case "title": if (!actEl.isContentEditable) Plot.drawer.open(id); break;
        case "status": ui().pickStatus(actEl, project, t.statusId, (v) => st.updateTask(id, { statusId: v })); break;
        case "priority": ui().pickPriority(actEl, t.priority, (v) => st.updateTask(id, { priority: v })); break;
        case "assignee": ui().pickAssignee(actEl, t.assigneeId, (v) => st.updateTask(id, { assigneeId: v })); break;
        case "due": ui().pickDate(actEl, t.due, (v) => st.updateTask(id, { due: v })); break;
        case "tags": ui().pickTags(actEl, project.id, t.tagIds, (ids) => st.updateTask(id, { tagIds: ids })); break;
        default: break;
      }
    });

    wrapper.addEventListener("dblclick", (e) => {
      const span = e.target.closest(".t");
      if (span) { e.preventDefault(); startRename(span); }
    });

    wrapper.addEventListener("keydown", (e) => {
      if (e.target.isContentEditable) return;
      const tr = e.target.closest && e.target.closest("tr");
      if (!tr || e.target !== tr) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (tr.dataset.taskId) Plot.drawer.open(tr.dataset.taskId);
        else if (tr.dataset.act) tr.click();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const rows = Array.from(wrapper.querySelectorAll("tbody tr"));
        rows[rows.indexOf(tr) + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
      }
    });

    wrapper.addEventListener("contextmenu", (e) => {
      const tr = e.target.closest("tr[data-task-id]");
      if (!tr) return;
      const id = tr.dataset.taskId;
      ui().contextMenu(e, [
        { label: "Open", icon: "arrow-up-right", onClick: () => Plot.drawer.open(id) },
        { label: "Rename", icon: "edit", onClick: () => startRename(tr.querySelector(".t")) },
        { label: "Duplicate", icon: "copy", onClick: () => { st.duplicateTask(id); ui().toast("Task duplicated"); } },
        { sep: true },
        { label: "Delete", icon: "trash", danger: true, onClick: () => {
            st.deleteTask(id);
            ui().toast("Task deleted", { action: { label: "Undo", onClick: () => st.undo() } });
        } },
      ]);
    });
  }

  /* --------------------------------------------------------------- Styles */

  document.head.append(h("style", { id: "table-styles" }, `
    .tbl .cell-ph { color: var(--ink-4); font-size: var(--fs-xs); opacity: 0; transition: opacity var(--t-fast); }
    .tbl tr:hover .cell-ph, .tbl tr:focus-within .cell-ph { opacity: 1; }
    .tbl .check.sel { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
    .tbl td.col-check, .tbl th.col-check { text-align: center; }
    .tbl tbody tr:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .tbl .t[contenteditable="true"] { background: var(--surface); box-shadow: 0 0 0 2px var(--accent-ring); border-radius: 3px; padding: 0 3px; outline: none; text-overflow: clip; }
    .tbl { min-width: 1140px; }
    .tbl .col-title { width: auto; min-width: 280px; }
    .tbl-group { cursor: pointer; }
    .tbl .title-cell-in .check { flex: none; }
  `));

  Plot.views.table = { wide: false, render };
})();
