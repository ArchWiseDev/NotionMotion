/* ==========================================================================
   Plotline · app.js
   The last file: boots the app and connects everything.

     - Router            #/home  #/my-tasks  #/dashboard  #/calendar
                         #/p/<projectId>[/<viewId>]  #/doc/<id>  #/task/<id>
     - Shell             sidebar, breadcrumb, project header, view tabs, toolbar
     - Plot.actions      newTask, newProject, newDoc, openTemplates, openSettings,
                         toggleTheme, toggleSidebar, exportData, importData,
                         showShortcuts, openPalette
     - Plot.app          currentProjectId(), navigate(hash)
     - Modals            new task, new project, templates, settings, shortcuts
     - Keyboard          Ctrl+Z, C, [, 1-5, /, ?
     - Theme             light, dark or follow the system
   ========================================================================== */
(function () {
  "use strict";

  const Plot = (window.Plot = window.Plot || {});
  const u = Plot.u;
  const { h, $, $$ } = u;
  const icon = (n, c) => Plot.icons.el(n, c);
  const st = () => Plot.store;
  const ui = () => Plot.ui;
  const F = () => Plot.filters;

  const el = {
    view: $("#view"), head: $("#page-head"), toolbar: $("#toolbar"),
    crumb: $("#breadcrumb"), saveState: $("#save-state"), btnNew: $("#btn-new"), btnUndo: $("#btn-undo"),
    scrim: $("#scrim"),
  };

  const ALL_CAL = { id: "all-calendar", type: "calendar", name: "Calendar", filters: [], sort: null, group: "", collapsed: {} };
  const state = { route: { name: "home" }, project: null, view: null, doc: null, key: "", pendingDrawer: null };
  const go = (hash) => { location.hash = hash; };

  /* ----------------------------------------------------------------- Theme */

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const themePref = () => Plot.prefs.get("theme", "system");
  const resolvedTheme = () => (themePref() === "system" ? (media.matches ? "dark" : "light") : themePref());

  function applyTheme() {
    const t = resolvedTheme();
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === "dark" ? "#0f1218" : "#f6f7f9";
    const btn = $("#theme-toggle");
    const svg = btn.querySelector("svg");
    if (svg) svg.replaceWith(icon(t === "dark" ? "sun" : "moon"));
    btn.querySelector("span").textContent = t === "dark" ? "Light mode" : "Dark mode";
  }
  media.addEventListener("change", () => { if (themePref() === "system") applyTheme(); });

  /* --------------------------------------------------------------- Sidebar */

  const isDesktop = () => window.matchMedia("(min-width: 861px)").matches;

  function applySidebar() {
    const collapsed = !!Plot.prefs.get("sidebarCollapsed", false) && isDesktop();
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    $("#sidebar-open").hidden = !collapsed;
    el.scrim.hidden = !document.body.classList.contains("sidebar-open");
  }

  function toggleSidebar() {
    if (isDesktop()) Plot.prefs.set("sidebarCollapsed", !Plot.prefs.get("sidebarCollapsed", false));
    else document.body.classList.toggle("sidebar-open");
    applySidebar();
  }

  const closeMobileSidebar = () => { document.body.classList.remove("sidebar-open"); applySidebar(); };

  /* ------------------------------------------------------------------ Router */

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, "").split("?")[0];
    const parts = raw.split("/").filter(Boolean).map(decodeURIComponent);
    switch (parts[0]) {
      case undefined: case "home": return { name: "home" };
      case "my-tasks": return { name: "my-tasks" };
      case "dashboard": return { name: "dashboard" };
      case "calendar": return { name: "calendar" };
      case "p": return { name: "project", pid: parts[1], vid: parts[2] };
      case "doc": return { name: "doc", id: parts[1] };
      case "task": return { name: "task", id: parts[1] };
      default: return { name: "home" };
    }
  }

  /** Turn the URL into concrete objects. May redirect (unknown ids, #/task/<id>). */
  function resolve() {
    let r = parseHash();

    if (r.name === "task") {
      const t = st().task(r.id);
      if (!t) { ui().toast("That task no longer exists"); history.replaceState(null, "", "#/home"); r = { name: "home" }; }
      else { state.pendingDrawer = t.id; history.replaceState(null, "", "#/p/" + t.projectId); r = { name: "project", pid: t.projectId }; }
    }

    state.project = state.view = state.doc = null;

    if (r.name === "project") {
      const p = st().project(r.pid);
      if (!p) { ui().toast("That project no longer exists"); history.replaceState(null, "", "#/home"); r = { name: "home" }; }
      else {
        const v = p.views.find((x) => x.id === r.vid) || p.views.find((x) => x.id === Plot.prefs.get("view:" + p.id)) || p.views[0];
        if (Plot.prefs.get("view:" + p.id) !== v.id) Plot.prefs.set("view:" + p.id, v.id);
        if (v.id !== r.vid) history.replaceState(null, "", `#/p/${p.id}/${v.id}`);
        state.project = p;
        state.view = v;
        r = { name: "project", pid: p.id, vid: v.id };
      }
    }
    if (r.name === "doc") {
      state.doc = st().doc(r.id);
      if (!state.doc) { ui().toast("That doc no longer exists"); history.replaceState(null, "", "#/home"); r = { name: "home" }; }
    }
    state.route = r;
    return r;
  }

  const currentProjectId = () => (state.route.name === "project" ? state.route.pid : null);

  /* ----------------------------------------------------------------- Render */

  let queued = false;
  function scheduleRender() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; renderAll(); });
  }

  function renderAll() {
    const route = resolve();
    const key = [route.name, route.pid || route.id || "", route.vid || ""].join("|");
    const changed = key !== state.key;

    if (changed) {
      if (Plot.drawer.isOpen() && !state.pendingDrawer) Plot.drawer.close();
      F().setQuery("");
      el.view.scrollTop = 0;
      closeMobileSidebar();
    }
    state.key = key;

    renderSidebar();
    renderTopbar();
    renderHead(changed);
    renderToolbar();
    renderView();

    if (state.pendingDrawer) {
      const id = state.pendingDrawer;
      state.pendingDrawer = null;
      Plot.drawer.open(id);
    }
  }

  function renderView() {
    const r = state.route;
    let mod, args = {};
    switch (r.name) {
      case "home": mod = Plot.views.home; break;
      case "my-tasks": mod = Plot.views.myTasks; break;
      case "dashboard": mod = Plot.views.dashboard; args = { project: null }; break;
      case "calendar": mod = Plot.views.calendar; args = { project: null, view: ALL_CAL }; break;
      case "doc": mod = Plot.views.doc; args = { doc: state.doc }; break;
      default: mod = Plot.views[state.view.type]; args = { project: state.project, view: state.view };
    }
    el.view.classList.toggle("wide", !!mod.wide);
    try {
      mod.render(el.view, args);
    } catch (err) {
      console.error("[render]", err);
      u.mount(el.view, h("div.view-inner", ui().emptyState({
        emoji: "🛠️", title: "This page hit a snag",
        text: "Something went wrong while drawing it. Your data is safe. Try another view, or reload the page.",
        action: { label: "Go home", onClick: () => go("#/home") },
      })));
    }
  }

  /* --- Sidebar content --- */

  function renderSidebar() {
    const s = st();
    const r = state.route;
    $("#workspace-name").textContent = s.data.meta.name;

    $$("#nav-main .nav-item").forEach((a) => {
      const on = a.dataset.route === r.name;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    const n = Plot.views.myTasks.countOpen();
    $("#count-my-tasks").textContent = n ? String(n) : "";

    const favs = s.projects().filter((p) => p.favorite);
    $("#section-favorites").hidden = !favs.length;
    u.mount($("#nav-favorites"), favs.map(navProject));

    const projects = s.projects();
    u.mount($("#nav-projects"), projects.length ? projects.map(navProject) : h("li", h("div.nav-empty", "No projects yet")));

    const docs = s.docs();
    u.mount($("#nav-docs"), docs.length ? docs.map(navDoc) : h("li", h("div.nav-empty", "No docs yet")));
  }

  function moreBtn(label, onOpen) {
    return h("span.nav-more", {
      role: "button", tabindex: "0", "aria-label": label,
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); onOpen(e.currentTarget); },
      onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onOpen(e.currentTarget); } },
    }, icon("more"));
  }

  function navProject(p) {
    const active = state.route.name === "project" && state.route.pid === p.id;
    const open = st().stats(p.id).open;
    return h("li", h("a.nav-item" + (active ? ".active" : ""), {
      href: "#/p/" + p.id, title: p.name, "aria-current": active ? "page" : null,
      oncontextmenu: (e) => ui().contextMenu(e, projectItems(p)),
    }, h("span.nav-emoji", p.emoji), h("span", p.name), h("span.nav-count", open ? String(open) : ""),
      moreBtn("Project options", (a) => ui().menu(a, projectItems(p), { align: "right" }))));
  }

  function navDoc(d) {
    const active = state.route.name === "doc" && state.route.id === d.id;
    const items = () => [
      { label: "Duplicate", icon: "copy", onClick: () => {
          if (Plot.views.doc.flush) Plot.views.doc.flush();
          const fresh = st().doc(d.id) || d;
          const c = st().addDoc({ title: (fresh.title || "Untitled") + " (copy)", emoji: fresh.emoji, blocks: u.clone(fresh.blocks).map((b) => ({ ...b, id: u.uid("b") })) });
          go("#/doc/" + c.id);
      } },
      { label: "Delete", icon: "trash", danger: true, onClick: () => {
          st().deleteDoc(d.id);
          if (active) go("#/home");
          ui().toast("Doc deleted", { action: { label: "Undo", onClick: () => st().undo() } });
      } },
    ];
    return h("li", h("a.nav-item" + (active ? ".active" : ""), {
      href: "#/doc/" + d.id, title: d.title || "Untitled", "aria-current": active ? "page" : null,
      oncontextmenu: (e) => ui().contextMenu(e, items()),
    }, h("span.nav-emoji", d.emoji), h("span", d.title || "Untitled"), moreBtn("Doc options", (a) => ui().menu(a, items(), { align: "right" }))));
  }

  /* --- Project actions (shared by sidebar and project header) --- */

  function projectItems(p) {
    const s = st();
    return [
      { label: p.favorite ? "Remove from favorites" : "Add to favorites", icon: p.favorite ? "star-fill" : "star", onClick: () => s.toggleFavorite(p.id) },
      { label: "Rename", icon: "edit", onClick: async () => {
          const name = await ui().prompt({ title: "Rename project", value: p.name, confirmLabel: "Rename" });
          if (name) s.updateProject(p.id, { name });
      } },
      { label: "Duplicate", icon: "copy", onClick: () => { const c = s.duplicateProject(p.id); if (c) { go("#/p/" + c.id); ui().toast("Project duplicated"); } } },
      { label: "Export tasks as CSV", icon: "download", onClick: () => exportCSV(p.id) },
      { sep: true },
      { label: "Delete project", icon: "trash", danger: true, onClick: async () => {
          const n = s.tasks(p.id).length;
          const ok = await ui().confirm({
            title: `Delete “${p.name}”?`,
            message: n ? `Its ${u.plural(n, "task")} will be deleted too. You can undo this right after.` : "This project is empty.",
            confirmLabel: "Delete project", danger: true,
          });
          if (!ok) return;
          const wasHere = currentProjectId() === p.id;
          s.deleteProject(p.id);
          if (wasHere) go("#/home");
          ui().toast("Project deleted", { action: { label: "Undo", onClick: () => s.undo() } });
      } },
    ];
  }

  /* --- Topbar --- */

  function renderTopbar() {
    const r = state.route;
    const crumbs = [];
    const link = (text, href, emoji) => h("a.crumb", { href }, emoji ? h("span", emoji) : null, text);
    const cur = (text, emoji) => h("span.crumb.current", { "aria-current": "page" }, emoji ? h("span", emoji) : null, text);
    const sep = () => icon("chevron-right", "crumb-sep");
    let title = "Plotline";

    switch (r.name) {
      case "home": crumbs.push(cur("Home")); title = "Home"; break;
      case "my-tasks": crumbs.push(link("Home", "#/home"), sep(), cur("My tasks")); title = "My tasks"; break;
      case "dashboard": crumbs.push(link("Home", "#/home"), sep(), cur("Dashboard")); title = "Dashboard"; break;
      case "calendar": crumbs.push(link("Home", "#/home"), sep(), cur("All calendar")); title = "Calendar"; break;
      case "doc": {
        const d = state.doc;
        crumbs.push(link("Home", "#/home"), sep(), cur(d.title || "Untitled", d.emoji));
        title = d.title || "Untitled";
        break;
      }
      case "project": {
        const p = state.project;
        crumbs.push(link("Home", "#/home"), sep(), link(p.name, `#/p/${p.id}`, p.emoji), sep(), cur(state.view.name));
        title = p.name;
        break;
      }
      default: break;
    }
    u.mount(el.crumb, crumbs);
    document.title = `${title} · ${st().data.meta.name}`;

    el.btnNew.querySelector("span").textContent = r.name === "doc" ? "New doc" : "New task";
    el.btnUndo.disabled = !st().canUndo();
  }

  /* --- Project header + view tabs --- */

  /** Plain-text contenteditable: Enter commits, Escape cancels, pasted text is stripped. */
  function plainEdit(node, { multiline = false, onCommit }) {
    node.contentEditable = "true";
    node.spellcheck = true;
    node.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, multiline ? text : text.replace(/\s*\n\s*/g, " "));
    });
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !(multiline && e.shiftKey)) { e.preventDefault(); node.blur(); }
      if (e.key === "Escape") { e.stopPropagation(); node.dataset.cancel = "1"; node.blur(); }
    });
    node.addEventListener("blur", () => {
      const cancelled = node.dataset.cancel === "1";
      delete node.dataset.cancel;
      onCommit(node.innerText.replace(/\n$/, "").trim(), cancelled);
    });
  }

  function renderHead(routeChanged) {
    const r = state.route;
    const head = el.head;

    if (r.name === "calendar") {
      u.mount(head,
        h("div.ph-row", h("span.ph-icon", "📅"), h("h1.ph-title", { style: { cursor: "default" } }, "All calendar")),
        h("p.ph-desc", { style: { cursor: "default" } }, "Every dated task from every project."));
      head.dataset.key = "calendar";
      return;
    }
    if (r.name !== "project") { u.mount(head); head.dataset.key = ""; return; }

    const p = state.project;
    const key = p.id + "|" + state.view.id;
    if (!routeChanged && head.dataset.key === key && head.contains(document.activeElement)) return;
    head.dataset.key = key;

    const title = h("h1.ph-title", { role: "textbox", "aria-label": "Project name" }, p.name);
    plainEdit(title, { onCommit: (v, cancelled) => {
      if (cancelled || !v) { title.textContent = p.name; return; }
      if (v !== p.name) st().updateProject(p.id, { name: v });
    } });

    const desc = h("p.ph-desc", { role: "textbox", "aria-label": "Project description", "data-placeholder": "Add a description", style: { whiteSpace: "pre-wrap" } }, p.description);
    plainEdit(desc, { multiline: true, onCommit: (v, cancelled) => {
      if (cancelled) { desc.textContent = p.description; return; }
      if (v !== p.description) st().updateProject(p.id, { description: v });
    } });

    const tabs = h("div.view-tabs", { role: "tablist", "aria-label": "Views" },
      p.views.map((v, i) => {
        const meta = Plot.consts.VIEW_TYPES.find((t) => t.type === v.type);
        const on = v.id === state.view.id;
        return h("a.view-tab" + (on ? ".active" : ""), {
          href: `#/p/${p.id}/${v.id}`, role: "tab", "aria-selected": String(on), title: `${v.name} view  (${i + 1})`,
        }, icon(meta ? meta.icon : "table"), v.name);
      }));

    u.mount(head,
      h("div.ph-row",
        h("button.ph-icon", { type: "button", "aria-label": "Change icon", onclick: (e) => ui().pickEmoji(e.currentTarget, (em) => st().updateProject(p.id, { emoji: em })) }, p.emoji),
        title,
        h("button.icon-btn", {
          type: "button", "aria-label": p.favorite ? "Remove from favorites" : "Add to favorites", "aria-pressed": String(p.favorite), title: "Favorite",
          onclick: () => st().toggleFavorite(p.id),
        }, icon(p.favorite ? "star-fill" : "star")),
        h("button.icon-btn", { type: "button", "aria-label": "Project options", onclick: (e) => ui().menu(e.currentTarget, projectItems(p), { align: "right" }) }, icon("more"))),
      desc, tabs);
  }

  function renderToolbar() {
    const bar = el.toolbar;
    if (state.route.name !== "project") { bar.hidden = true; u.mount(bar); return; }
    const active = document.activeElement;
    if (bar.contains(active) && active.tagName === "INPUT") return;      // do not steal focus from the search box
    F().renderToolbar(bar, { project: state.project, view: state.view });
  }

  /* ------------------------------------------------------------- Save state */

  let savedTimer = 0;
  let warned = false;
  Plot.bus.on("saving", () => { el.saveState.textContent = "Saving…"; el.saveState.classList.add("saving"); });
  Plot.bus.on("saved", () => {
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { el.saveState.textContent = "Saved"; el.saveState.classList.remove("saving"); }, 200);
  });
  Plot.bus.on("storage-error", () => {
    el.saveState.textContent = "Not saved";
    if (!warned) { warned = true; ui().toast("Browser storage is full or blocked. Export a backup so you do not lose work.", { duration: 8000 }); }
  });

  /* ---------------------------------------------------------------- Actions */

  function newTask(projectId, presetTitle) {
    const s = st();
    if (!s.projects().length) { ui().toast("Create a project first"); newProject(); return; }
    const pid = projectId || currentProjectId() || s.projects()[0].id;

    const title = h("input.input", { type: "text", placeholder: "What needs doing?", value: presetTitle || "", "aria-label": "Task title" });
    const select = h("select.select", { "aria-label": "Project" },
      s.projects().map((p) => h("option", { value: p.id, selected: p.id === pid ? true : null }, `${p.emoji}  ${p.name}`)));
    const due = h("input.input", { type: "date", "aria-label": "Due date" });

    const layer = ui().modal({
      title: "New task",
      body: h("div",
        h("div.field", h("label.field-label", "Title"), title),
        h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" } },
          h("div.field", h("label.field-label", "Project"), select),
          h("div.field", h("label.field-label", "Due date"), due))),
      actions: [
        { label: "Cancel" },
        { label: "Create task", variant: "primary", onClick: () => {
            const t = s.addTask(select.value, { title: title.value.trim() || "Untitled task", due: due.value || null });
            if (t) ui().toast("Task created", { action: { label: "Open", onClick: () => Plot.drawer.open(t.id) } });
        } },
      ],
    });
    title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); layer.el.querySelector(".btn.primary").click(); } });
  }

  function newProject() {
    let emoji = "📁";
    const name = h("input.input", { type: "text", placeholder: "e.g. Website relaunch", "aria-label": "Project name" });
    const emojiBtn = h("button.btn", {
      type: "button", "aria-label": "Choose icon", style: { width: "46px", fontSize: "20px", padding: 0 },
      onclick: (e) => ui().pickEmoji(e.currentTarget, (em) => { emoji = em; emojiBtn.textContent = em; }),
    }, emoji);
    const layer = ui().modal({
      title: "New project",
      body: h("div",
        h("div.field", h("label.field-label", "Name"), h("div", { style: { display: "flex", gap: "8px" } }, emojiBtn, name)),
        h("p", "You get five statuses and all five views. Prefer a head start? ",
          h("a", { href: "#", style: { color: "var(--accent)", fontWeight: 600 }, onclick: (e) => { e.preventDefault(); layer.close(false); openTemplates(); } }, "Browse templates"))),
      actions: [
        { label: "Cancel" },
        { label: "Create project", variant: "primary", onClick: () => {
            const p = st().createProject({ name: name.value.trim() || "Untitled project", emoji });
            go("#/p/" + p.id);
        } },
      ],
    });
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); layer.el.querySelector(".btn.primary").click(); } });
  }

  function newDoc() {
    const d = st().addDoc();
    go("#/doc/" + d.id);
  }

  function openTemplates() {
    const layer = ui().modal({
      title: "Start from a template", wide: true,
      body: h("div.tpl-grid", Plot.seed.templates.map((t) =>
        h("button.tpl-card", {
          type: "button",
          onclick: () => {
            layer.close(false);
            const pid = st().createFromTemplate(t.id);
            if (pid) {
              go("#/p/" + pid);
              ui().toast(`Created “${st().project(pid).name}”`, { action: { label: "Undo", onClick: () => st().undo() } });
            }
          },
        }, h("span.tpl-emoji", t.emoji), h("strong", t.name), h("span", t.description)))),
    });
  }

  /* ------------------------------------------------------------ Export/import */

  function exportData() {
    if (Plot.views.doc.flush) Plot.views.doc.flush();
    st().flush();
    u.download(`plotline-${u.today()}.json`, st().exportJSON());
    ui().toast("Backup downloaded");
  }

  function exportCSV(pid) {
    const base = pid ? st().project(pid).name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") : "all-tasks";
    u.download(`${base || "tasks"}-${u.today()}.csv`, st().exportCSV(pid), "text/csv");
    ui().toast("CSV downloaded");
  }

  async function importData() {
    const file = await u.pickFile(".json,application/json");
    if (!file) return;
    const ok = await ui().confirm({
      title: "Replace your workspace?",
      message: `This swaps everything in this browser for the contents of “${file.name}”. You can undo it right after.`,
      confirmLabel: "Import", danger: true,
    });
    if (!ok) return;
    const res = st().importJSON(file.text);
    if (res.ok) { go("#/home"); ui().toast("Workspace imported", { action: { label: "Undo", onClick: () => st().undo() } }); }
    else ui().toast(res.error, { duration: 6000 });
  }

  function exportMenu(anchor) {
    const pid = currentProjectId();
    ui().menu(anchor, [
      { label: "Export workspace (JSON)", icon: "download", onClick: exportData },
      { label: pid ? "Export this project (CSV)" : "Export all tasks (CSV)", icon: "table", onClick: () => exportCSV(pid) },
      { sep: true },
      { label: "Import workspace…", icon: "upload", onClick: importData },
    ], { align: "right" });
  }

  /* ---------------------------------------------------------------- Settings */

  function openSettings() {
    const s = st();

    const wsInput = h("input.input", { type: "text", value: s.data.meta.name, "aria-label": "Workspace name" });
    wsInput.addEventListener("change", () => s.renameWorkspace(wsInput.value));
    const meInput = h("input.input", { type: "text", value: s.me().name, "aria-label": "Your name" });
    meInput.addEventListener("change", () => s.renameMember(s.data.me, meInput.value));

    const seg = (current, options, onPick) => {
      const box = h("div.seg", { role: "group" });
      options.forEach(([val, label]) => {
        const b = h("button.seg-btn" + (val === current ? ".active" : ""), { type: "button" }, label);
        b.addEventListener("click", () => {
          onPick(val);
          box.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
        });
        box.append(b);
      });
      return box;
    };

    const membersBox = h("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } });
    const addInput = h("input.input", { type: "text", placeholder: "Add a teammate by name", "aria-label": "New teammate name" });
    function addMember() {
      if (!addInput.value.trim()) return;
      s.addMember(addInput.value);
      drawMembers();
      addInput.focus();
    }
    function drawMembers() {
      u.mount(membersBox,
        s.members().filter((m) => m.id !== s.data.me).map((m) => {
          const inp = h("input.input", { type: "text", value: m.name, "aria-label": "Teammate name" });
          inp.addEventListener("change", () => s.renameMember(m.id, inp.value));
          return h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
            ui().avatar(m, "lg"), inp,
            h("button.icon-btn", { type: "button", "aria-label": "Remove " + m.name, onclick: () => { s.removeMember(m.id); drawMembers(); } }, icon("trash")));
        }),
        h("div", { style: { display: "flex", gap: "8px" } }, addInput, h("button.btn", { type: "button", onclick: addMember }, icon("plus"), "Add")));
    }
    addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addMember(); } });
    drawMembers();

    const group = (title, ...body) => h("section", { style: { marginBottom: "24px" } },
      h("h3", { style: { fontSize: "var(--fs-md)", marginBottom: "12px" } }, title), ...body);
    const row = (label, control) => h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "6px 0" } },
      h("span", { style: { fontSize: "var(--fs-sm)", fontWeight: 600 } }, label), control);

    const body = h("div",
      group("Workspace",
        h("div.field", h("label.field-label", "Workspace name"), wsInput),
        h("div.field", h("label.field-label", "Your name"), meInput)),
      group("Team",
        h("p.muted", { style: { fontSize: "var(--fs-xs)", marginBottom: "10px" } }, "Teammates can be assigned to tasks. Everything stays on this device."),
        membersBox),
      group("Appearance",
        row("Theme", seg(themePref(), [["light", "Light"], ["dark", "Dark"], ["system", "System"]], (v) => { Plot.prefs.set("theme", v); applyTheme(); })),
        row("Week starts on", seg(String(Plot.prefs.get("weekStart", 0)), [["0", "Sunday"], ["1", "Monday"]], (v) => { Plot.prefs.set("weekStart", Number(v)); scheduleRender(); }))),
      group("Data",
        h("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px" } },
          h("button.btn", { type: "button", onclick: exportData }, icon("download"), "Export JSON"),
          h("button.btn", { type: "button", onclick: () => exportCSV(null) }, icon("table"), "Export CSV"),
          h("button.btn", { type: "button", onclick: importData }, icon("upload"), "Import")),
        h("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" } },
          h("button.btn.danger", { type: "button", onclick: async () => {
              const ok = await ui().confirm({ title: "Reset to the demo?", message: "This replaces your workspace with the sample projects. You can undo it right after.", confirmLabel: "Reset", danger: true });
              if (ok) { st().reset(true); go("#/home"); ui().toast("Demo restored", { action: { label: "Undo", onClick: () => st().undo() } }); }
          } }, "Reset to demo"),
          h("button.btn.danger", { type: "button", onclick: async () => {
              const ok = await ui().confirm({ title: "Clear everything?", message: "All projects, tasks and docs will be removed. Export a backup first if you might need them. You can undo this right after.", confirmLabel: "Clear workspace", danger: true });
              if (ok) { st().reset(false); go("#/home"); ui().toast("Workspace cleared", { action: { label: "Undo", onClick: () => st().undo() } }); }
          } }, "Clear workspace"))));

    ui().modal({ title: "Settings", wide: true, body, actions: [{ label: "Done", variant: "primary" }] });
  }

  function showShortcuts() {
    const rows = [
      ["Search and commands", ["Ctrl", "K"]], ["New task", ["C"]], ["Switch view (in a project)", ["1", "–", "5"]],
      ["Focus the search box", ["/"]], ["Hide or show the sidebar", ["["]], ["Undo", ["Ctrl", "Z"]], ["Redo", ["Ctrl", "Shift", "Z"]],
      ["Close panel or dialog", ["Esc"]], ["Move a board card between columns", ["Alt", "← →"]], ["Move a timeline bar by a day", ["Alt", "← →"]],
      ["Doc: open the block menu", ["/"]], ["Doc: move a block", ["Alt", "↑ ↓"]], ["Show this list", ["?"]],
    ];
    ui().modal({
      title: "Keyboard shortcuts",
      body: h("div", rows.map(([label, keys]) =>
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid var(--line-soft)", fontSize: "var(--fs-sm)" } },
          h("span", label), h("span", { style: { display: "flex", gap: "4px" } }, keys.map((k) => h("kbd", k)))))),
      actions: [{ label: "Close", variant: "primary" }],
    });
  }

  /* --------------------------------------------------------------- Wire up */

  Plot.actions = {
    newTask, newProject, newDoc, openTemplates, openSettings, showShortcuts, exportData, importData,
    toggleTheme: () => { Plot.prefs.set("theme", resolvedTheme() === "dark" ? "light" : "dark"); applyTheme(); },
    toggleSidebar,
    openPalette: () => Plot.palette.open(),
  };
  Plot.app = { currentProjectId, navigate: go, route: () => state.route };

  function doUndo() {
    if (Plot.views.doc.flush) Plot.views.doc.flush();
    ui().toast(st().undo() ? "Undone" : "Nothing to undo");
  }

  function bindStatic() {
    $("#sidebar-toggle").addEventListener("click", toggleSidebar);
    $("#sidebar-open").addEventListener("click", toggleSidebar);
    $("#mobile-menu").addEventListener("click", () => { document.body.classList.add("sidebar-open"); applySidebar(); });
    el.scrim.addEventListener("click", closeMobileSidebar);

    $("#add-project").addEventListener("click", newProject);
    $("#add-doc").addEventListener("click", newDoc);
    $("#open-templates").addEventListener("click", openTemplates);
    $("#open-settings").addEventListener("click", openSettings);
    $("#theme-toggle").addEventListener("click", Plot.actions.toggleTheme);

    $("#workspace-btn").addEventListener("click", (e) => ui().menu(e.currentTarget, [
      { label: "Rename workspace", icon: "edit", onClick: async () => {
          const name = await ui().prompt({ title: "Rename workspace", value: st().data.meta.name, confirmLabel: "Rename" });
          if (name) st().renameWorkspace(name);
      } },
      { label: "Settings", icon: "settings", onClick: openSettings },
      { label: "Browse templates", icon: "template", onClick: openTemplates },
      { sep: true },
      { label: "Export backup", icon: "download", onClick: exportData },
      { label: "Keyboard shortcuts", icon: "zap", hint: "?", onClick: showShortcuts },
    ]));

    el.btnNew.addEventListener("click", () => (state.route.name === "doc" ? newDoc() : newTask()));
    el.btnUndo.addEventListener("click", doUndo);
    $("#btn-export").addEventListener("click", (e) => exportMenu(e.currentTarget));

    window.addEventListener("hashchange", renderAll);
    window.addEventListener("resize", u.debounce(() => {
      if (isDesktop()) document.body.classList.remove("sidebar-open");
      applySidebar();
    }, 100));
  }

  /* --- Keyboard --- */

  const isTyping = (t) => !!(t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'));

  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    const mod = e.ctrlKey || e.metaKey;
    const typing = isTyping(e.target);
    const key = e.key.toLowerCase();

    if (mod && !e.altKey && (key === "z" || key === "y")) {
      if (typing) return;                                   // let the browser undo text edits
      e.preventDefault();
      if (key === "y" || e.shiftKey) ui().toast(st().redo() ? "Redone" : "Nothing to redo");
      else doUndo();
      return;
    }
    if (e.key === "Escape" && document.body.classList.contains("sidebar-open")) { closeMobileSidebar(); return; }
    if (mod || e.altKey || typing) return;
    if ((Plot.palette && Plot.palette.isOpen()) || ui().hasOverlay()) return;

    if (key === "c" && !e.shiftKey) { e.preventDefault(); newTask(); }
    else if (e.key === "[") { e.preventDefault(); toggleSidebar(); }
    else if (e.key === "?") { e.preventDefault(); showShortcuts(); }
    else if (e.key === "/") {
      const box = document.querySelector(".tb-search input");
      e.preventDefault();
      if (box) box.focus(); else Plot.palette.open();
    } else if (/^[1-5]$/.test(e.key) && state.route.name === "project") {
      const v = state.project.views[Number(e.key) - 1];
      if (v) { e.preventDefault(); go(`#/p/${state.project.id}/${v.id}`); }
    }
  });

  /* ------------------------------------------------------------------ Boot */

  document.head.append(h("style", { id: "app-styles" }, `
    .nav-item > .nav-more { flex: none !important; overflow: visible; }
    .nav-item .nav-more:focus-visible { display: grid; }
    button.ph-icon { cursor: pointer; }
    .view-tab { text-decoration: none; }
    .ph-title[contenteditable="true"], .ph-desc[contenteditable="true"] { outline: none; }
    .btn:disabled, .icon-btn:disabled { pointer-events: none; }
  `));

  st().init();
  Plot.bus.on("change", scheduleRender);
  Plot.bus.on("query", () => renderView());
  Plot.bus.on("prefs", (d) => { if (d.key === "theme") applyTheme(); });

  applyTheme();
  applySidebar();
  bindStatic();
  if (!location.hash) history.replaceState(null, "", "#/home");
  renderAll();
})();
