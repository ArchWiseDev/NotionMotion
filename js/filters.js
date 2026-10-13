/* ==========================================================================
   Plotline · filters.js
   Everything about narrowing and ordering a list of tasks, plus the toolbar
   that controls it. Exposed as Plot.filters.

   Logic (pure functions, used by every view):
     applyAll(tasks, view, project)   filters + search + sort
     groupTasks(tasks, field, project)
     query / setQuery(text)           search box text (not saved)

   UI:
     renderToolbar(el, { project, view })

   A saved filter looks like { field, op: "in" | "not_in", value: [ids] }.
   Filters, sort and group live on the view object, so each view of each
   project remembers its own settings.
   ========================================================================== */
(function () {
  "use strict";

  const Plot = (window.Plot = window.Plot || {});
  const u = Plot.u;
  const { h } = u;
  const icon = (n, c) => Plot.icons.el(n, c);
  const store = () => Plot.store;

  /* ------------------------------------------------------------ Definitions */

  const DUE_OPTIONS = [
    { id: "overdue", label: "Overdue" },
    { id: "today", label: "Due today" },
    { id: "week", label: "Next 7 days" },
    { id: "month", label: "Next 30 days" },
    { id: "set", label: "Has a due date" },
    { id: "none", label: "No due date" },
  ];

  const FIELDS = {
    status: {
      label: "Status", icon: "circle-half", multi: true,
      options: (p) => p.statuses.map((s) => ({ id: s.id, label: s.name, color: s.color })),
    },
    priority: {
      label: "Priority", icon: "flag", multi: true,
      options: () => Plot.consts.PRIORITIES.map((x) => ({ id: x.id, label: x.name, color: x.color })),
    },
    assignee: {
      label: "Assignee", icon: "user", multi: true,
      options: () => [
        ...store().members().map((m) => ({ id: m.id, label: m.name, lead: () => Plot.ui.avatar(m, "sm") })),
        { id: "none", label: "Unassigned" },
      ],
    },
    tag: {
      label: "Tag", icon: "tag", multi: true,
      options: (p) => [...p.tags.map((t) => ({ id: t.id, label: t.name, color: t.color })), { id: "none", label: "No tag" }],
    },
    due: { label: "Due date", icon: "calendar", multi: false, options: () => DUE_OPTIONS },
    completion: {
      label: "Completion", icon: "check-circle", multi: false,
      options: () => [{ id: "open", label: "Not done" }, { id: "done", label: "Done" }],
    },
  };

  const SORT_FIELDS = [
    { id: "order", label: "Manual order" },
    { id: "title", label: "Title" },
    { id: "status", label: "Status" },
    { id: "priority", label: "Priority" },
    { id: "assignee", label: "Assignee" },
    { id: "due", label: "Due date" },
    { id: "start", label: "Start date" },
    { id: "created", label: "Date created" },
    { id: "updated", label: "Last edited" },
  ];

  const GROUP_FIELDS = [
    { id: "", label: "No grouping", icon: "x" },
    { id: "status", label: "Status", icon: "circle-half" },
    { id: "priority", label: "Priority", icon: "flag" },
    { id: "assignee", label: "Assignee", icon: "user" },
    { id: "tag", label: "Tag", icon: "tag" },
    { id: "due", label: "Due date", icon: "calendar" },
  ];

  // What each view type supports in its toolbar
  const CAPS = {
    table: { sort: true, group: true },
    list: { sort: true, group: true },
    board: {},
    calendar: {},
    timeline: {},
  };

  const DIR_LABELS = (field) =>
    field === "title" || field === "assignee" || field === "status" ? ["A to Z", "Z to A"]
    : field === "priority" ? ["Highest first", "Lowest first"]
    : ["due", "start", "created", "updated"].includes(field) ? ["Earliest first", "Latest first"]
    : ["Ascending", "Descending"];

  /* -------------------------------------------------------------- Query text */

  let query = "";
  const setQuery = (q) => {
    const next = String(q || "").trim().toLowerCase();
    if (next === query) return;
    query = next;
    Plot.bus.emit("query", query);
  };

  /* ------------------------------------------------------------- Filtering */

  function matchesFilter(task, f) {
    let hit = false;
    switch (f.field) {
      case "status": hit = f.value.includes(task.statusId); break;
      case "priority": hit = f.value.includes(task.priority); break;
      case "assignee": hit = f.value.includes(task.assigneeId || "none"); break;
      case "tag":
        hit = f.value.some((id) => (id === "none" ? task.tagIds.length === 0 : task.tagIds.includes(id)));
        break;
      case "completion": hit = (f.value[0] === "done") === store().isDone(task); break;
      case "due": {
        const mode = f.value[0];
        if (mode === "none") { hit = !task.due; break; }
        if (mode === "set") { hit = !!task.due; break; }
        if (!task.due) { hit = false; break; }
        const diff = u.diffDays(u.today(), task.due);
        hit = mode === "overdue" ? diff < 0 && !store().isDone(task)
          : mode === "today" ? diff === 0
          : mode === "week" ? diff >= 0 && diff <= 7
          : mode === "month" ? diff >= 0 && diff <= 30 : false;
        break;
      }
      default: return true;
    }
    return f.op === "not_in" ? !hit : hit;
  }

  const applyFilters = (tasks, filters) =>
    filters && filters.length ? tasks.filter((t) => filters.every((f) => matchesFilter(t, f))) : tasks;

  function applySearch(tasks, q = query) {
    if (!q) return tasks;
    const words = q.split(/\s+/);
    return tasks.filter((t) => {
      const hay = [
        t.title, t.notes,
        store().member(t.assigneeId)?.name || "",
        ...t.tagIds.map((id) => store().tag(t.projectId, id)?.name || ""),
      ].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }

  /* --------------------------------------------------------------- Sorting */

  function sortValue(task, field, project) {
    switch (field) {
      case "title": return task.title.toLowerCase();
      case "status": return project ? project.statuses.findIndex((s) => s.id === task.statusId) : 0;
      case "priority": return -store().priority(task.priority).rank || (task.priority === "none" ? null : 0);
      case "assignee": return store().member(task.assigneeId)?.name.toLowerCase() || null;
      case "due": return task.due || null;
      case "start": return task.start || null;
      case "created": return task.createdAt;
      case "updated": return task.updatedAt;
      default: return task.order;
    }
  }

  function sortTasks(tasks, sort, project) {
    const s = sort || { field: "order", dir: "asc" };
    const dir = s.dir === "desc" ? -1 : 1;
    return tasks.slice().sort((a, b) => {
      const va = sortValue(a, s.field, project), vb = sortValue(b, s.field, project);
      const ea = va == null || va === "", eb = vb == null || vb === "";
      if (ea !== eb) return ea ? 1 : -1;               // empty values always last
      const c = u.compare(va, vb) * dir;
      return c || a.order - b.order;
    });
  }

  function applyAll(tasks, view, project) {
    return sortTasks(applySearch(applyFilters(tasks, view?.filters)), view?.sort, project);
  }

  /* -------------------------------------------------------------- Grouping */

  function groupTasks(tasks, field, project) {
    const st = store();
    const keep = (arr) => arr.filter((g) => g.tasks.length);

    switch (field) {
      case "status":
        return project.statuses.map((s) => ({ key: s.id, label: s.name, color: s.color, tasks: tasks.filter((t) => t.statusId === s.id) }));

      case "priority":
        return keep(Plot.consts.PRIORITIES.map((p) => ({ key: p.id, label: p.name, color: p.color, tasks: tasks.filter((t) => t.priority === p.id) })));

      case "assignee":
        return keep([
          ...st.members().map((m) => ({ key: m.id, label: m.name, member: m, tasks: tasks.filter((t) => t.assigneeId === m.id) })),
          { key: "none", label: "Unassigned", tasks: tasks.filter((t) => !t.assigneeId) },
        ]);

      case "tag":
        return keep([
          ...project.tags.map((tg) => ({ key: tg.id, label: tg.name, color: tg.color, tasks: tasks.filter((t) => t.tagIds.includes(tg.id)) })),
          { key: "none", label: "No tag", tasks: tasks.filter((t) => !t.tagIds.length) },
        ]);

      case "due": {
        const bucket = (t) => {
          if (!t.due) return "none";
          const d = u.diffDays(u.today(), t.due);
          return d < 0 && !st.isDone(t) ? "overdue" : d <= 0 ? "today" : d <= 7 ? "week" : "later";
        };
        const defs = [
          { key: "overdue", label: "Overdue", color: "red" }, { key: "today", label: "Today", color: "orange" },
          { key: "week", label: "Next 7 days", color: "blue" }, { key: "later", label: "Later", color: "gray" },
          { key: "none", label: "No date", color: "gray" },
        ];
        return keep(defs.map((g) => ({ ...g, tasks: tasks.filter((t) => bucket(t) === g.key) })));
      }

      default:
        return [{ key: "all", label: "", tasks }];
    }
  }

  /* ------------------------------------------------------------- Describing */

  function describe(f, project) {
    const def = FIELDS[f.field];
    if (!def) return "";
    const opts = def.options(project);
    const names = f.value.map((id) => opts.find((o) => o.id === id)?.label).filter(Boolean);
    if (!def.multi) return `${def.label}: ${names[0] || ""}`;
    const shown = names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
    return `${def.label} ${f.op === "not_in" ? "is not" : "is"} ${shown}`;
  }

  /* ---------------------------------------------------------- Toolbar: state */

  const fresh = (ctx) => ({ project: store().project(ctx.pid), view: store().view(ctx.pid, ctx.vid) });

  function saveFilter(ctx, fieldId, filter) {
    const { view } = fresh(ctx);
    if (!view) return;
    const rest = view.filters.filter((f) => f.field !== fieldId);
    store().updateView(ctx.pid, ctx.vid, { filters: filter ? [...rest, filter] : rest });
  }

  /* ------------------------------------------------------- Toolbar: pickers */

  function editFilter(anchor, ctx, fieldId) {
    const { project, view } = fresh(ctx);
    const def = FIELDS[fieldId];
    const existing = view.filters.find((f) => f.field === fieldId);
    const options = def.options(project);

    // Single-choice fields: a plain menu
    if (!def.multi) {
      const items = options.map((o) => ({
        label: o.label, selected: existing?.value[0] === o.id,
        onClick: () => saveFilter(ctx, fieldId, { field: fieldId, op: "in", value: [o.id] }),
      }));
      if (existing) items.push({ sep: true }, { label: "Remove filter", icon: "trash", danger: true, onClick: () => saveFilter(ctx, fieldId, null) });
      return Plot.ui.menu(anchor, items);
    }

    // Multi-choice fields: stay open while ticking boxes
    const sel = new Set(existing?.value || []);
    let op = existing?.op || "in";
    const list = h("div.tp-list");
    const segIs = h("button.seg-btn", { type: "button" }, "is");
    const segNot = h("button.seg-btn", { type: "button" }, "is not");

    const push = () => saveFilter(ctx, fieldId, sel.size ? { field: fieldId, op, value: Array.from(sel) } : null);
    const draw = () => {
      segIs.classList.toggle("active", op === "in");
      segNot.classList.toggle("active", op === "not_in");
      u.mount(list, options.map((o) =>
        h("button.menu-item" + (sel.has(o.id) ? ".selected" : ""), {
          type: "button",
          onclick: () => { sel.has(o.id) ? sel.delete(o.id) : sel.add(o.id); push(); draw(); },
        }, o.lead ? o.lead() : o.color ? h("span.dot.c-" + o.color) : icon("circle"),
          h("span.menu-text", o.label), sel.has(o.id) && h("span.menu-check", icon("check")))));
    };
    segIs.addEventListener("click", () => { op = "in"; if (sel.size) push(); draw(); });
    segNot.addEventListener("click", () => { op = "not_in"; if (sel.size) push(); draw(); });
    draw();

    return Plot.ui.popover(anchor, [
      h("div.menu-label", def.label),
      h("div", { style: { padding: "0 6px 6px" } }, h("div.seg", segIs, segNot)),
      list,
      existing && h("div.menu-sep"),
      existing && h("button.menu-item.danger", { type: "button", onclick: () => { Plot.ui.closeMenus(); saveFilter(ctx, fieldId, null); } }, icon("trash"), h("span.menu-text", "Remove filter")),
    ], { role: "dialog", width: 240 });
  }

  function openFilterMenu(anchor, ctx) {
    const { view } = fresh(ctx);
    const items = Object.entries(FIELDS).map(([id, def]) => ({
      label: def.label, icon: def.icon, hint: view.filters.some((f) => f.field === id) ? "On" : "",
      onClick: () => editFilter(anchor, ctx, id),
    }));
    if (view.filters.length) {
      items.push({ sep: true }, { label: "Clear all filters", icon: "x", danger: true, onClick: () => store().updateView(ctx.pid, ctx.vid, { filters: [] }) });
    }
    Plot.ui.menu(anchor, [{ heading: "Filter by" }, ...items]);
  }

  function openSortMenu(anchor, ctx) {
    const { view } = fresh(ctx);
    const cur = view.sort || { field: "order", dir: "asc" };
    const [asc, desc] = DIR_LABELS(cur.field);
    const set = (patch) => store().updateView(ctx.pid, ctx.vid, { sort: { ...cur, ...patch } });
    Plot.ui.menu(anchor, [
      { heading: "Sort by" },
      ...SORT_FIELDS.map((f) => ({ label: f.label, selected: cur.field === f.id, onClick: () => set({ field: f.id, dir: f.id === "updated" || f.id === "created" ? "desc" : "asc" }) })),
      ...(cur.field === "order" ? [] : [
        { sep: true },
        { label: asc, icon: "arrow-up-right", selected: cur.dir === "asc", onClick: () => set({ dir: "asc" }) },
        { label: desc, icon: "arrow-right", selected: cur.dir === "desc", onClick: () => set({ dir: "desc" }) },
      ]),
    ]);
  }

  function openGroupMenu(anchor, ctx) {
    const { view } = fresh(ctx);
    Plot.ui.menu(anchor, [
      { heading: "Group by" },
      ...GROUP_FIELDS.map((g) => ({ label: g.label, icon: g.icon, selected: (view.group || "") === g.id, onClick: () => store().updateView(ctx.pid, ctx.vid, { group: g.id }) })),
    ]);
  }

  /* -------------------------------------------------------- Toolbar: render */

  function toolButton(label, iconName, active, onClick, badge) {
    return h("button.btn.ghost.sm" + (active ? ".on" : ""), { type: "button", onclick: (e) => onClick(e.currentTarget) },
      icon(iconName), label, badge ? h("span.badge", badge) : null);
  }

  function renderToolbar(el, { project, view }) {
    const ctx = { pid: project.id, vid: view.id };
    const caps = CAPS[view.type] || {};
    const sort = view.sort && view.sort.field !== "order" ? view.sort : null;
    const group = GROUP_FIELDS.find((g) => g.id === (view.group || ""));

    const search = h("label.tb-search",
      icon("search"),
      h("input", { type: "search", placeholder: "Search tasks", "aria-label": "Search tasks", value: query }));
    search.querySelector("input").addEventListener("input", u.debounce((e) => setQuery(e.target.value), 120));

    const chips = view.filters.length
      ? h("div.filter-chips",
          view.filters.map((f) => {
            const chip = h("span.chip", { role: "button", tabindex: "0", title: "Edit filter" },
              h("span", describe(f, project)),
              h("button", { type: "button", "aria-label": "Remove filter", onclick: (e) => { e.stopPropagation(); saveFilter(ctx, f.field, null); } }, icon("x")));
            const open = () => editFilter(chip, ctx, f.field);
            chip.addEventListener("click", open);
            chip.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
            return chip;
          }),
          h("button.btn.ghost.sm", { type: "button", onclick: () => store().updateView(ctx.pid, ctx.vid, { filters: [] }) }, "Clear"))
      : null;

    u.mount(el,
      toolButton("Filter", "filter", view.filters.length > 0, (a) => openFilterMenu(a, ctx), view.filters.length || null),
      caps.sort ? toolButton(sort ? `Sorted: ${SORT_FIELDS.find((f) => f.id === sort.field)?.label}` : "Sort", "sort", !!sort, (a) => openSortMenu(a, ctx)) : null,
      caps.group ? toolButton(view.group ? `Grouped: ${group.label}` : "Group", "group", !!view.group, (a) => openGroupMenu(a, ctx)) : null,
      h("span.tb-spacer"),
      search,
      chips);
    el.hidden = false;
  }

  /* --------------------------------------------------------------- Styles */

  document.head.append(h("style", { id: "filters-styles" }, `
    .chip { cursor: pointer; }
    .chip:hover { filter: brightness(0.97); }
    .tb-search input[type="search"]::-webkit-search-cancel-button { display: none; }
  `));

  Plot.filters = {
    FIELDS, SORT_FIELDS, GROUP_FIELDS, DUE_OPTIONS,
    get query() { return query; },
    setQuery,
    applyFilters, applySearch, sortTasks, applyAll, groupTasks,
    matchesFilter, describe, renderToolbar,
    hasActive: (view) => !!(view && (view.filters.length || query)),
  };
})();
