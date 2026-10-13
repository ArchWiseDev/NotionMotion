/* ==========================================================================
   Plotline · palette.js
   The Ctrl/Cmd + K palette: jump to anything, run any command.

     Plot.palette.open(initialText)   Plot.palette.close()   Plot.palette.toggle()

   Typing searches tasks, projects, docs and commands together (fuzzy).
   Prefixes narrow it:   >  commands only      #  tasks only
   With an empty box it shows suggested commands, projects and recent docs.

   Commands call Plot.actions.* provided by app.js. The palette also expects
   Plot.app.currentProjectId() so it can offer "Switch to Board view" and
   "Create task" for the project you are looking at.
   ========================================================================== */
(function () {
  "use strict";

  const Plot = (window.Plot = window.Plot || {});
  const u = Plot.u;
  const { h } = u;
  const icon = (n, c) => Plot.icons.el(n, c);
  const store = () => Plot.store;

  const overlay = document.getElementById("palette");
  const field = document.getElementById("palette-field");
  const listEl = document.getElementById("palette-list");

  let items = [];          // flat, runnable results in display order
  let active = 0;
  let lastFocus = null;

  const act = (name, ...args) => {
    const fn = Plot.actions && Plot.actions[name];
    if (fn) fn(...args);
  };
  const go = (hash) => { location.hash = hash; };
  const currentPid = () => (Plot.app && Plot.app.currentProjectId ? Plot.app.currentProjectId() : null);

  /* -------------------------------------------------------------- Commands */

  function commands() {
    const st = store();
    const pid = currentPid();
    const project = pid ? st.project(pid) : null;
    const list = [
      { label: "New task", icon: "plus", hint: "C", keys: "add create todo", run: () => act("newTask") },
      { label: "New project", icon: "folder", keys: "add create", run: () => act("newProject") },
      { label: "New doc", icon: "doc", keys: "add create note page write", run: () => act("newDoc") },
      { label: "Browse templates", icon: "template", keys: "gallery sprint roadmap", run: () => act("openTemplates") },
      { label: "Go to Home", icon: "home", keys: "dashboard start", run: () => go("#/home") },
      { label: "Go to My tasks", icon: "check-circle", keys: "assigned mine", run: () => go("#/my-tasks") },
      { label: "Go to Dashboard", icon: "chart", keys: "stats charts overview", run: () => go("#/dashboard") },
      { label: "Go to All calendar", icon: "calendar", keys: "schedule month", run: () => go("#/calendar") },
    ];

    if (project) {
      Plot.consts.VIEW_TYPES.forEach((v, i) => {
        const view = project.views.find((x) => x.type === v.type);
        if (view) list.push({ label: `Switch to ${v.name} view`, icon: v.icon, hint: String(i + 1), keys: "view layout " + v.type, run: () => go(`#/p/${project.id}/${view.id}`) });
      });
    }

    list.push(
      { label: "Toggle dark mode", icon: "moon", keys: "theme light night", run: () => act("toggleTheme") },
      { label: "Toggle sidebar", icon: "panel-left", hint: "[", keys: "collapse hide show", run: () => act("toggleSidebar") },
      { label: "Undo", icon: "undo", hint: "Ctrl Z", keys: "revert back", disabled: !st.canUndo(), run: () => st.undo() },
      { label: "Redo", icon: "redo", hint: "Ctrl Shift Z", keys: "forward", disabled: !st.canRedo(), run: () => st.redo() },
      { label: "Settings", icon: "settings", keys: "preferences team members workspace", run: () => act("openSettings") },
      { label: "Export workspace as JSON", icon: "download", keys: "backup save download", run: () => act("exportData") },
      { label: "Import workspace from JSON", icon: "upload", keys: "restore load backup", run: () => act("importData") },
      { label: "Keyboard shortcuts", icon: "zap", hint: "?", keys: "help keys hotkeys", run: () => act("showShortcuts") });

    return list.filter((c) => !c.disabled).map((c) => ({ ...c, kind: "command" }));
  }

  /* ----------------------------------------------------------- Result search */

  function search(raw) {
    const st = store();
    let q = raw.trim();
    let only = null;
    if (q.startsWith(">")) { only = "command"; q = q.slice(1).trim(); }
    else if (q.startsWith("#")) { only = "task"; q = q.slice(1).trim(); }

    const groups = [];
    const rank = (arr, text, cap) =>
      arr.map((x) => ({ x, s: q ? u.fuzzy(q, text(x)) : 0 })).filter((r) => r.s >= 0)
        .sort((a, b) => b.s - a.s).slice(0, cap).map((r) => r.x);

    // Commands
    if (!only || only === "command") {
      const cmds = rank(commands(), (c) => c.label + " " + (c.keys || ""), q ? 6 : 8);
      if (cmds.length) groups.push({ title: q ? "Commands" : "Suggested", rows: cmds });
    }

    // Projects and docs
    if (!only) {
      const projects = rank(st.projects(), (p) => p.name, q ? 5 : 6).map((p) => ({
        kind: "project", label: p.name, emoji: p.emoji, sub: `${st.stats(p.id).open} open`, run: () => go("#/p/" + p.id), q,
      }));
      if (projects.length) groups.push({ title: "Projects", rows: projects });

      const docsSorted = st.docs().slice().sort((a, b) => b.updatedAt - a.updatedAt);
      const docs = (q ? rank(docsSorted, (d) => d.title || "Untitled", 5) : docsSorted.slice(0, 4)).map((d) => ({
        kind: "doc", label: d.title || "Untitled", emoji: d.emoji, sub: u.timeAgo(d.updatedAt), run: () => go("#/doc/" + d.id), q,
      }));
      if (docs.length) groups.push({ title: "Docs", rows: docs });
    }

    // Tasks (only when searching, otherwise the list would be endless)
    if ((q || only === "task") && (!only || only === "task")) {
      const scored = st.tasks().map((t) => {
        const p = st.project(t.projectId);
        const s = u.fuzzy(q, `${t.title} ${p ? p.name : ""}`);
        return { t, p, s: s < 0 ? s : s - (st.isDone(t) ? 15 : 0) };
      }).filter((r) => r.s >= 0 || !q).sort((a, b) => b.s - a.s).slice(0, only ? 14 : 8);

      const rows = scored.map(({ t, p }) => ({
        kind: "task", label: t.title, icon: st.isDone(t) ? "check-circle" : "circle",
        sub: `${p ? p.emoji + " " + p.name : ""} · ${st.statusOf(t)?.name || ""}`, run: () => go("#/task/" + t.id), q,
      }));
      if (rows.length) groups.push({ title: "Tasks", rows });
    }

    // Quick create from whatever was typed
    if (q && !only) {
      const pid = currentPid() || (st.projects()[0] && st.projects()[0].id);
      if (pid) {
        groups.push({ title: "Create", rows: [{
          kind: "create", label: `Create task “${q}”`, icon: "plus", sub: "in " + st.project(pid).name,
          run: () => {
            const t = st.addTask(pid, { title: q });
            if (t) { Plot.ui.toast("Task created", { action: { label: "Open", onClick: () => Plot.drawer.open(t.id) } }); }
          },
        }] });
      }
    }
    return groups;
  }

  /* ---------------------------------------------------------------- Render */

  const highlight = (text, q) => {
    if (!q) return text;
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    return i < 0 ? text : [text.slice(0, i), h("b", text.slice(i, i + q.length)), text.slice(i + q.length)];
  };

  function paint() {
    const groups = search(field.value);
    items = [];
    const nodes = [];

    groups.forEach((g) => {
      nodes.push(h("li", { role: "presentation" }, h("div.palette-group", g.title)));
      g.rows.forEach((row) => {
        const i = items.length;
        items.push(row);
        nodes.push(h("li", { role: "presentation" },
          h("button.palette-item" + (i === active ? ".active" : ""), {
            type: "button", role: "option", id: "pal-" + i, "aria-selected": String(i === active), dataset: { i: String(i) },
          },
            row.emoji ? h("span.pi-emoji", row.emoji) : icon(row.icon || "arrow-right"),
            h("span.pi-text", highlight(row.label, row.kind === "command" || row.kind === "create" ? "" : row.q)),
            row.sub ? h("span.pi-sub.muted", row.sub) : null,
            row.hint ? h("kbd", row.hint) : null)));
      });
    });

    if (!items.length) nodes.push(h("li", { role: "presentation" }, h("div.palette-empty", field.value ? `Nothing found for “${field.value.trim()}”` : "Start typing to search")));
    u.mount(listEl, nodes);
    listEl.setAttribute("role", "listbox");
    field.setAttribute("aria-activedescendant", items.length ? "pal-" + active : "");
  }

  function setActive(i, scroll = true) {
    if (!items.length) return;
    active = (i + items.length) % items.length;
    listEl.querySelectorAll(".palette-item").forEach((el) => {
      const on = Number(el.dataset.i) === active;
      el.classList.toggle("active", on);
      el.setAttribute("aria-selected", String(on));
      if (on && scroll) el.scrollIntoView({ block: "nearest" });
    });
    field.setAttribute("aria-activedescendant", "pal-" + active);
  }

  /* ----------------------------------------------------------- Open / close */

  const isOpen = () => !overlay.hidden;

  function open(initial = "") {
    if (isOpen()) { field.focus(); return; }
    Plot.ui.closeMenus();
    lastFocus = document.activeElement;
    overlay.hidden = false;
    field.value = initial;
    active = 0;
    field.setAttribute("role", "combobox");
    field.setAttribute("aria-expanded", "true");
    field.setAttribute("aria-controls", "palette-list");
    paint();
    field.focus();
    field.select();
  }

  function close(restore = true) {
    if (!isOpen()) return;
    overlay.hidden = true;
    field.value = "";
    field.setAttribute("aria-expanded", "false");
    if (restore && lastFocus && document.contains(lastFocus) && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }

  function run(i) {
    const row = items[i];
    if (!row) return;
    close(false);
    // Let the palette finish closing before the action opens something else
    setTimeout(() => row.run(), 0);
  }

  /* ---------------------------------------------------------------- Events */

  field.addEventListener("input", () => { active = 0; paint(); });

  field.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(items.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); run(active); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Tab") { e.preventDefault(); }          // keep focus in the field
  });

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".palette-item");
    if (btn) run(Number(btn.dataset.i));
  });
  listEl.addEventListener("mousemove", (e) => {
    const btn = e.target.closest(".palette-item");
    if (btn && Number(btn.dataset.i) !== active) setActive(Number(btn.dataset.i), false);
  });

  overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) close(); });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      isOpen() ? close() : open();
    }
  });

  const trigger = document.getElementById("open-search");
  if (trigger) trigger.addEventListener("click", () => open());

  document.head.append(h("style", { id: "palette-styles" }, `
    .palette-item b { color: var(--accent); font-weight: 700; }
    .palette-item .pi-sub { font-size: var(--fs-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 45%; }
    .palette-item kbd { margin-left: var(--s-2); }
    #palette .palette { max-width: 640px; }
  `));

  Plot.palette = { open, close, toggle: () => (isOpen() ? close() : open()), isOpen };
})();
