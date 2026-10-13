/* ==========================================================================
   Plotline · views/dashboard.js
   A read-only overview built from the same task data, no libraries:
     headline numbers, a status donut, a 14-day completion chart, priority and
     workload bars, project progress (or tags, for one project), an
     "needs attention" list and recent wins.

   Called with project = null for the workspace dashboard (#/dashboard), or
   with a project to scope every number to it.
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

  /* ---------------------------------------------------------------- Render */

  function render(root, { project }) {
    const st = store();
    const tasks = project ? st.tasks(project.id) : st.tasks();
    const prevScroll = root.scrollTop;
    const wrapper = h("div.view-inner");

    if (!tasks.length) {
      wrapper.append(ui().emptyState({
        emoji: "📊", title: "Nothing to chart yet",
        text: "Create a few tasks and this page fills in with progress, workload and deadlines.",
        action: { label: "Go home", onClick: () => { location.hash = "#/home"; } },
      }));
      u.mount(root, wrapper);
      return;
    }

    const s = st.stats(project ? project.id : null);
    const open = tasks.filter((t) => !st.isDone(t));
    const t0 = u.today();
    const weekEnd = u.addDays(t0, 7);
    const dueWeek = open.filter((t) => t.due && t.due >= t0 && t.due <= weekEnd).length;

    wrapper.append(
      h("h1.dash-title", project ? `${project.emoji} ${project.name}` : "Dashboard"),
      h("p.dash-sub", project
        ? `${u.plural(s.total, "task")} in this project`
        : `${u.plural(st.projects().length, "project")} · ${u.plural(s.total, "task")} across the workspace`),

      h("div.stat-row",
        stat("Open tasks", s.open, `${s.done} completed`),
        stat("Overdue", s.overdue, s.overdue ? "Needs a new date or a finish" : "Nothing late", s.overdue > 0),
        stat("Due in 7 days", dueWeek, s.dueToday ? `${s.dueToday} due today` : "None due today"),
        stat("Done this week", s.doneWeek, `${s.pct}% of all tasks complete`)),

      h("div.dash-grid",
        panel("Status", "span-4", donutPanel(tasks, project)),
        panel("Completed in the last 14 days", "span-8", completionChart(tasks)),
        panel("Open by priority", "span-4", priorityBars(open)),
        panel("Workload", "span-4", workloadBars(open)),
        project ? panel("Open by tag", "span-4", tagBars(open, project)) : panel("Projects", "span-4", projectBars()),
        panel("Needs attention", "span-6", attentionList(open, !project)),
        panel("Recently completed", "span-6", recentList(tasks, !project))));

    wrapper.addEventListener("click", (e) => {
      const go = e.target.closest("[data-go]");
      if (go) { location.hash = go.dataset.go; return; }
      const row = e.target.closest("[data-task-id]");
      if (row) Plot.drawer.open(row.dataset.taskId);
    });

    u.mount(root, wrapper);
    root.scrollTop = prevScroll;
  }

  /* -------------------------------------------------------------- Pieces */

  const stat = (label, value, sub, alert) =>
    h("div.stat" + (alert ? ".alert" : ""), h("div.stat-label", label), h("div.stat-value", String(value)), h("div.stat-sub", sub));

  const panel = (title, cls, ...body) => h("section.panel." + cls, h("h3", title), ...body);

  const none = (text) => h("p.muted", { style: { fontSize: "var(--fs-sm)", padding: "8px 0" } }, text);

  function hbars(rows) {
    const max = Math.max(1, ...rows.map((r) => r.n));
    return h("div.hbars", rows.map((r) =>
      h("div.hbar" + (r.color ? ".c-" + r.color : ""),
        h("div.name", r.lead || null, h("span", { title: r.label }, r.label)),
        h("div.track", h("i", { style: { width: (r.n / max) * 100 + "%" } })),
        h("span.val", String(r.n)))));
  }

  /* ---------------------------------------------------------------- Status */

  function donutPanel(tasks, project) {
    const st = store();
    // Group by status name so workspace-wide numbers combine "Done" across projects
    const map = new Map();
    tasks.forEach((t) => {
      const s = st.statusOf(t);
      if (!s) return;
      const key = s.name.trim().toLowerCase();
      if (!map.has(key)) map.set(key, { label: s.name, color: s.color, n: 0, done: !!s.done });
      map.get(key).n++;
    });
    let items = Array.from(map.values());
    if (project) { // keep the project's own column order
      const order = project.statuses.map((s) => s.name.trim().toLowerCase());
      items.sort((a, b) => order.indexOf(a.label.trim().toLowerCase()) - order.indexOf(b.label.trim().toLowerCase()));
    } else items.sort((a, b) => b.n - a.n);

    const total = tasks.length;
    let acc = 0;
    const stops = items.map((it) => {
      const a = (acc / total) * 100;
      acc += it.n;
      return `var(--c-${it.color}) ${a}% ${(acc / total) * 100}%`;
    });
    const doneN = tasks.filter((t) => st.isDone(t)).length;

    return h("div.donut-wrap",
      h("div.donut", { style: { background: `conic-gradient(${stops.join(", ")})` }, role: "img", "aria-label": `${Math.round((doneN / total) * 100)}% complete` },
        h("div.donut-center", h("strong", Math.round((doneN / total) * 100) + "%"), h("span", "complete"))),
      h("ul.legend", items.map((it) => h("li", h("span.dot.c-" + it.color), it.label, h("span.n", String(it.n))))));
  }

  /* ----------------------------------------------------- Completion chart */

  function completionChart(tasks) {
    const st = store();
    const days = Array.from({ length: 14 }, (_, i) => u.addDays(u.today(), i - 13));
    const counts = new Map(days.map((d) => [d, 0]));
    tasks.forEach((t) => {
      if (!st.isDone(t) || !t.completedAt) return;
      const d = u.toISO(new Date(t.completedAt));
      if (counts.has(d)) counts.set(d, counts.get(d) + 1);
    });
    const max = Math.max(1, ...counts.values());
    const sum = Array.from(counts.values()).reduce((a, b) => a + b, 0);

    return h("div",
      h("div.cols-chart", { role: "img", "aria-label": `${sum} tasks completed in the last 14 days` },
        days.map((d) => {
          const n = counts.get(d);
          return h("div.c", { title: `${u.fmtDateLong(d)}: ${u.plural(n, "task")}` },
            h("span.num", n ? String(n) : ""),
            h("div.bar" + (n ? "" : ".zero"), { style: { height: n ? Math.max(8, (n / max) * 100) + "px" : "3px" } }),
            h("span.lbl", String(u.parseDate(d).getDate())));
        })),
      h("p.muted", { style: { marginTop: "12px", fontSize: "var(--fs-xs)" } },
        sum ? `${u.plural(sum, "task")} finished, about ${(sum / 14).toFixed(1)} a day.` : "No completions yet. Finish a task and it shows up here."));
  }

  /* ------------------------------------------------------------- Bar lists */

  function priorityBars(open) {
    if (!open.length) return none("No open tasks. Nice.");
    return hbars(Plot.consts.PRIORITIES.map((p) => ({
      label: p.name, color: p.color, n: open.filter((t) => t.priority === p.id).length,
    })));
  }

  function workloadBars(open) {
    const st = store();
    if (!open.length) return none("No open tasks to assign.");
    const rows = st.members().map((m) => ({
      label: m.name, color: u.colorFor(m.name), lead: ui().avatar(m, "sm"), n: open.filter((t) => t.assigneeId === m.id).length,
    }));
    rows.push({ label: "Unassigned", color: "gray", n: open.filter((t) => !t.assigneeId).length });
    return hbars(rows.filter((r) => r.n > 0 || r.label !== "Unassigned").sort((a, b) => b.n - a.n));
  }

  function tagBars(open, project) {
    const rows = project.tags.map((tg) => ({ label: tg.name, color: tg.color, n: open.filter((t) => t.tagIds.includes(tg.id)).length }))
      .filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
    return rows.length ? hbars(rows) : none("No tagged open tasks.");
  }

  function projectBars() {
    const st = store();
    const projects = st.projects();
    if (!projects.length) return none("No projects yet.");
    return h("div.hbars", projects.map((p) => {
      const s = st.stats(p.id);
      return h("div", { dataset: { go: "#/p/" + p.id }, style: { cursor: "pointer" }, role: "link", tabindex: "0",
        onkeydown: (e) => { if (e.key === "Enter") location.hash = "#/p/" + p.id; } },
        h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "var(--fs-sm)", marginBottom: "6px" } },
          h("span.truncate", { style: { fontWeight: 600 } }, `${p.emoji} ${p.name}`),
          h("span.muted", `${s.done}/${s.total}`)),
        h("div.progress" + (s.pct === 100 ? ".green" : ""), h("i", { style: { width: s.pct + "%" } })));
    }));
  }

  /* ----------------------------------------------------------------- Lists */

  function attentionList(open, showProject) {
    const st = store();
    const t0 = u.today();
    const weekEnd = u.addDays(t0, 7);
    const items = open.filter((t) => t.due && t.due <= weekEnd).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 8);
    if (!items.length) return none("Nothing is overdue or due this week.");
    return h("div.mini-list", items.map((t) => {
      const p = st.project(t.projectId);
      return h("div.mini-row", { dataset: { taskId: t.id }, role: "button", tabindex: "0",
        onkeydown: (e) => { if (e.key === "Enter") Plot.drawer.open(t.id); } },
        showProject && p ? h("span", { title: p.name }, p.emoji) : null,
        h("span.t", t.title),
        ui().priorityEl(t.priority, { label: false }),
        ui().dueEl(t));
    }));
  }

  function recentList(tasks, showProject) {
    const st = store();
    const items = tasks.filter((t) => st.isDone(t) && t.completedAt).sort((a, b) => b.completedAt - a.completedAt).slice(0, 6);
    if (!items.length) return none("Completed tasks will show up here.");
    return h("div.mini-list", items.map((t) => {
      const p = st.project(t.projectId);
      const who = st.member(t.assigneeId);
      return h("div.mini-row", { dataset: { taskId: t.id }, role: "button", tabindex: "0",
        onkeydown: (e) => { if (e.key === "Enter") Plot.drawer.open(t.id); } },
        showProject && p ? h("span", { title: p.name }, p.emoji) : null,
        h("span.t", t.title),
        who ? ui().avatar(who, "sm") : null,
        h("span.due", u.timeAgo(t.completedAt)));
    }));
  }

  /* --------------------------------------------------------------- Styles */

  document.head.append(h("style", { id: "dashboard-styles" }, `
    .mini-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: var(--r-sm); }
    .cols-chart .c { cursor: default; }
    .hbar .name .avatar { box-shadow: none; }
    .panel [data-go]:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: var(--r-sm); }
    .panel [data-go]:hover .progress { filter: brightness(0.95); }
  `));

  Plot.views.dashboard = { wide: false, render };
})();
