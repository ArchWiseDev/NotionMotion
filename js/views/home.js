/* ==========================================================================
   Plotline · views/home.js
   Two workspace-level pages that are not tied to one project:

     Plot.views.home      greeting, quick actions, project cards, your tasks,
                          recent docs and activity            (#/home)
     Plot.views.myTasks   everything assigned to you, grouped by when it is
                          due                                 (#/my-tasks)

   Buttons here call Plot.actions.* (newTask, newProject, newDoc,
   openTemplates, openPalette), which app.js provides.
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
  const act = (name, ...args) => {
    const fn = Plot.actions && Plot.actions[name];
    if (fn) fn(...args);
  };

  /* ---------------------------------------------------------------- Shared */

  const myOpenTasks = () => {
    const st = store();
    const me = st.data.me;
    return st.tasks().filter((t) => t.assigneeId === me && !st.isDone(t));
  };

  const byUrgency = (a, b) => {
    const da = a.due || "9999", db = b.due || "9999";
    return da.localeCompare(db) || store().priority(b.priority).rank - store().priority(a.priority).rank || a.order - b.order;
  };

  /** One compact task line, used by both pages. */
  function taskLine(t, showProject = true) {
    const st = store();
    const p = st.project(t.projectId);
    const prio = ui().priorityEl(t.priority, { label: false });
    return h("div.list-row" + (st.isDone(t) ? ".done" : ""), { role: "listitem", tabindex: "0", dataset: { taskId: t.id } },
      ui().checkEl(st.isDone(t), () => st.toggleDone(t.id)),
      h("span.list-title", t.title),
      h("div.list-meta",
        showProject && p ? h("span.tag.c-gray", { title: p.name }, `${p.emoji} ${p.name}`) : null,
        prio,
        ui().dueEl(t)));
  }

  function wire(wrapper) {
    wrapper.addEventListener("click", (e) => {
      const a = e.target.closest("[data-action]");
      if (a) { act(a.dataset.action, a.dataset.arg || undefined); return; }
      const go = e.target.closest("[data-go]");
      if (go) { location.hash = go.dataset.go; return; }
      const row = e.target.closest("[data-task-id]");
      if (row) Plot.drawer.open(row.dataset.taskId);
    });
    wrapper.addEventListener("keydown", (e) => {
      const el = e.target;
      if (e.key !== "Enter" || e.target !== document.activeElement) return;
      if (el.dataset && el.dataset.taskId) { e.preventDefault(); Plot.drawer.open(el.dataset.taskId); }
      else if (el.dataset && el.dataset.go) { e.preventDefault(); location.hash = el.dataset.go; }
    });
    wrapper.addEventListener("contextmenu", (e) => {
      const row = e.target.closest(".list-row[data-task-id]");
      if (!row) return;
      const id = row.dataset.taskId;
      const st = store();
      ui().contextMenu(e, [
        { label: "Open", icon: "arrow-up-right", onClick: () => Plot.drawer.open(id) },
        { label: st.isDone(st.task(id)) ? "Mark as not done" : "Mark as done", icon: "check-circle", onClick: () => st.toggleDone(id) },
        { sep: true },
        { label: "Delete", icon: "trash", danger: true, onClick: () => {
            st.deleteTask(id);
            ui().toast("Task deleted", { action: { label: "Undo", onClick: () => st.undo() } });
        } },
      ]);
    });
  }

  /* ------------------------------------------------------------------ Home */

  function renderHome(root) {
    const st = store();
    const me = st.me();
    const mine = myOpenTasks().sort(byUrgency);
    const t0 = u.today();
    const overdue = mine.filter((t) => t.due && t.due < t0).length;
    const today = mine.filter((t) => t.due === t0).length;
    const first = me.name.split(" ")[0];

    const summary = !mine.length ? "Nothing is assigned to you right now."
      : overdue ? `${u.plural(overdue, "task")} overdue${today ? ` and ${today} due today` : ""}. Start there.`
      : today ? `${u.plural(today, "task")} due today, ${mine.length - today} more open.`
      : `${u.plural(mine.length, "open task")} assigned to you. Nothing is due today.`;

    const hero = h("div.home-hero",
      h("h1", u.greeting() + (first === "You" ? "" : ", " + first)),
      h("p", summary),
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "16px" } },
        h("button.btn.primary", { type: "button", dataset: { action: "newTask" } }, icon("plus"), "New task"),
        h("button.btn", { type: "button", dataset: { action: "newProject" } }, icon("folder"), "New project"),
        h("button.btn", { type: "button", dataset: { action: "newDoc" } }, icon("doc"), "New doc"),
        h("button.btn", { type: "button", dataset: { action: "openTemplates" } }, icon("template"), "Templates"),
        h("button.btn.ghost", { type: "button", dataset: { action: "openPalette" } }, icon("search"), "Search", h("kbd", "Ctrl K"))));

    const projects = h("section.home-section",
      h("h3", "Projects"),
      h("div.proj-grid",
        st.projects().map((p) => {
          const s = st.stats(p.id);
          return h("a.proj-card", { href: "#/p/" + p.id },
            h("div.pc-top", h("span.pc-emoji", p.emoji), h("strong.truncate", p.name)),
            h("div.progress" + (s.pct === 100 && s.total ? ".green" : ""), h("i", { style: { width: s.pct + "%" } })),
            h("div.pc-meta", h("span", `${s.open} open`), h("span", s.overdue ? h("span", { style: { color: "var(--danger)", fontWeight: 600 } }, `${s.overdue} overdue`) : `${s.pct}% done`)));
        }),
        h("button.proj-card.new", { type: "button", dataset: { action: "newProject" } }, icon("plus"), h("span", "New project"))));

    const myList = h("section.home-section",
      h("h3", "Your tasks"),
      mine.length
        ? h("div.list-group", h("div.list-rows", { role: "list" }, mine.slice(0, 8).map((t) => taskLine(t))))
        : h("p.muted", { style: { fontSize: "var(--fs-sm)" } }, "You are all caught up. Assign tasks to yourself and they will show up here."),
      mine.length > 8 ? h("a.btn.ghost.sm", { href: "#/my-tasks", style: { marginTop: "8px" } }, `See all ${mine.length}`, icon("arrow-right")) : null);

    const docs = st.docs().slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
    const docsEl = h("section.home-section",
      h("h3", "Recent docs"),
      docs.length
        ? h("div.mini-list", docs.map((d) =>
            h("div.mini-row", { dataset: { go: "#/doc/" + d.id }, role: "link", tabindex: "0" },
              h("span", d.emoji), h("span.t", d.title || "Untitled"), h("span.due", u.timeAgo(d.updatedAt)))))
        : h("p.muted", { style: { fontSize: "var(--fs-sm)" } }, "No docs yet. Notes, briefs and meeting minutes live here."));

    const feed = [];
    st.tasks().forEach((t) => t.activity.slice(0, 2).forEach((a) => { if (a.text !== "Task created" || Date.now() - a.ts < 3 * 86400000) feed.push({ t, a }); }));
    feed.sort((x, y) => y.a.ts - x.a.ts);
    const activityEl = h("section.home-section",
      h("h3", "Recent activity"),
      feed.length
        ? h("div.mini-list", feed.slice(0, 7).map(({ t, a }) =>
            h("div.mini-row", { dataset: { taskId: t.id }, role: "button", tabindex: "0" },
              h("div", { style: { flex: 1, minWidth: 0 } },
                h("div.t", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t.title),
                h("div.muted", { style: { fontSize: "var(--fs-xs)" } }, `${a.text} · ${u.timeAgo(a.ts)}`)))))
        : h("p.muted", { style: { fontSize: "var(--fs-sm)" } }, "Changes to tasks will appear here."));

    const wrapper = h("div.view-inner", { style: { maxWidth: "1100px" } },
      hero, projects,
      h("div.home-grid", { style: { marginTop: "32px" } }, myList, h("div", docsEl, activityEl)));

    wire(wrapper);
    const prev = root.scrollTop;
    u.mount(root, wrapper);
    root.scrollTop = prev;
  }

  /* -------------------------------------------------------------- My tasks */

  function renderMyTasks(root) {
    const st = store();
    const t0 = u.today();
    const weekEnd = u.addDays(t0, 7);
    const open = myOpenTasks().sort(byUrgency);
    const done = st.tasks()
      .filter((t) => t.assigneeId === st.data.me && st.isDone(t))
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, 15);

    const buckets = [
      { key: "overdue", label: "Overdue", color: "red", test: (t) => t.due && t.due < t0 },
      { key: "today", label: "Today", color: "orange", test: (t) => t.due === t0 },
      { key: "week", label: "Next 7 days", color: "blue", test: (t) => t.due > t0 && t.due <= weekEnd },
      { key: "later", label: "Later", color: "gray", test: (t) => t.due > weekEnd },
      { key: "none", label: "No date", color: "gray", test: (t) => !t.due },
    ].map((b) => ({ ...b, items: open.filter(b.test) })).filter((b) => b.items.length);

    const wrapper = h("div.view-inner", { style: { maxWidth: "980px" } },
      h("h1.dash-title", "My tasks"),
      h("p.dash-sub", open.length ? `${u.plural(open.length, "open task")} assigned to ${st.me().name === "You" ? "you" : st.me().name}` : "Nothing assigned right now"),
      h("div", { style: { marginBottom: "20px" } },
        h("button.btn.primary", { type: "button", dataset: { action: "newTask" } }, icon("plus"), "New task")));

    if (!open.length) {
      wrapper.append(ui().emptyState({
        emoji: "🎉", title: "You are all caught up",
        text: "Tasks assigned to you will collect here, grouped by when they are due.",
      }));
    }

    buckets.forEach((b) => wrapper.append(
      h("section.list-group", { style: { marginBottom: "16px" } },
        h("div.list-group-head", h("span.tag.c-" + b.color, h("span.dot"), b.label),
          h("span.muted", { style: { fontWeight: 500, fontSize: "var(--fs-xs)" } }, String(b.items.length))),
        h("div.list-rows", { role: "list" }, b.items.map((t) => taskLine(t))))));

    if (done.length) {
      wrapper.append(h("section.list-group", { style: { marginBottom: "16px" } },
        h("div.list-group-head", h("span.tag.c-green", h("span.dot"), "Recently completed"),
          h("span.muted", { style: { fontWeight: 500, fontSize: "var(--fs-xs)" } }, String(done.length))),
        h("div.list-rows", { role: "list" }, done.map((t) => taskLine(t)))));
    }

    wire(wrapper);
    const prev = root.scrollTop;
    u.mount(root, wrapper);
    root.scrollTop = prev;
  }

  /* --------------------------------------------------------------- Styles */

  document.head.append(h("style", { id: "home-styles" }, `
    a.proj-card { color: inherit; }
    .proj-card.new { font: inherit; font-weight: 600; flex-direction: column; gap: 8px; cursor: pointer; background: transparent; }
    .proj-card.new:hover { color: var(--accent); border-color: var(--accent); }
    .mini-row[data-go], .mini-row[data-task-id] { cursor: pointer; }
    .home-section .list-group { padding: 4px 8px; }
  `));

  Plot.views.home = { wide: false, render: renderHome };
  Plot.views.myTasks = { wide: false, render: renderMyTasks, countOpen: () => myOpenTasks().length };
})();
