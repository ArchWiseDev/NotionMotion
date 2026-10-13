/* ==========================================================================
   Plotline · drawer.js
   The task detail panel that slides in from the right.

     Plot.drawer.open(taskId)    show a task
     Plot.drawer.close()
     Plot.drawer.isOpen()
     Plot.drawer.currentId

   Contents: title, properties (status, priority, assignee, dates, tags,
   estimate), subtasks with progress, notes, comments and an activity log.

   Re-rendering rule: the drawer rebuilds itself on every store change, except
   while you are typing in the title or notes, and for edits that the drawer
   itself has just made to text (`silent`). That keeps your caret and your
   in-progress clicks from being interrupted.
   ========================================================================== */
(function () {
  "use strict";

  const Plot = (window.Plot = window.Plot || {});
  const u = Plot.u;
  const { h } = u;
  const icon = (n, c) => Plot.icons.el(n, c);
  const store = () => Plot.store;
  const ui = () => Plot.ui;

  const el = document.getElementById("drawer");
  el.tabIndex = -1;

  let currentId = null;
  let lastFocus = null;
  let quiet = 0;

  /** Run a store write without triggering a drawer re-render. */
  const silent = (fn) => { quiet++; try { return fn(); } finally { quiet--; } };

  /* ---------------------------------------------------------- Open / close */

  function open(id) {
    if (!store().task(id)) return;
    const wasOpen = currentId != null;
    if (!wasOpen) lastFocus = document.activeElement;
    currentId = id;
    el.classList.toggle("expanded", !!Plot.prefs.get("drawerExpanded", false));
    render();
    el.classList.add("open");
    el.setAttribute("aria-hidden", "false");
    if (!wasOpen) requestAnimationFrame(() => el.focus({ preventScroll: true }));
    Plot.bus.emit("drawer", { id });
  }

  function close() {
    if (currentId == null) return;
    if (el.contains(document.activeElement)) document.activeElement.blur(); // flush pending text saves
    currentId = null;
    el.classList.remove("open");
    el.setAttribute("aria-hidden", "true");
    if (lastFocus && document.contains(lastFocus) && lastFocus !== document.body) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
    Plot.bus.emit("drawer", { id: null });
  }

  /* --------------------------------------------------------------- Helpers */

  /** Plain-text contenteditable: pasted text is stripped, Enter commits. */
  function plainEditable(node, { multiline = false, onInput, onCommit }) {
    node.contentEditable = "true";
    node.spellcheck = true;
    node.setAttribute("role", "textbox");
    node.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, multiline ? text : text.replace(/\s*\n\s*/g, " "));
    });
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !multiline) { e.preventDefault(); node.blur(); }
    });
    if (onInput) node.addEventListener("input", () => onInput(multiline ? node.innerText : node.textContent));
    if (onCommit) node.addEventListener("blur", () => onCommit(multiline ? node.innerText : node.textContent));
    return node;
  }

  const row = (label, ico, ...kids) => h("div.prop-row", h("div.prop-label", icon(ico), label), ...kids);
  const placeholder = (text) => h("span.placeholder", text);
  const isEditing = () => !!(document.activeElement && el.contains(document.activeElement) && document.activeElement.dataset.edit);

  /* --------------------------------------------------------------- Render */

  function render(opts = {}) {
    const t = store().task(currentId);
    if (!t) { close(); return; }
    const p = store().project(t.projectId);
    const prevBody = el.querySelector(".dr-body");
    const scroll = prevBody ? prevBody.scrollTop : 0;

    u.mount(el, header(t, p), body(t, p));

    const nextBody = el.querySelector(".dr-body");
    if (nextBody) nextBody.scrollTop = scroll;
    if (opts.focus) el.querySelector(`[data-focus="${opts.focus}"]`)?.focus();
  }

  /* --------------------------------------------------------------- Header */

  function header(t, p) {
    const done = store().isDone(t);
    const expanded = el.classList.contains("expanded");

    return h("div.dr-head",
      h("button.icon-btn", {
        type: "button", "aria-label": "Close panel", title: "Close  Esc", onclick: close,
      }, icon("chevron-right")),
      h("button.icon-btn", {
        type: "button", "aria-label": expanded ? "Narrow panel" : "Widen panel", title: expanded ? "Narrow panel" : "Widen panel",
        onclick: () => {
          const next = !el.classList.contains("expanded");
          el.classList.toggle("expanded", next);
          Plot.prefs.set("drawerExpanded", next);
          render();
        },
      }, icon(expanded ? "collapse" : "expand")),
      h("button.btn.ghost.sm", {
        type: "button", title: "Go to project",
        onclick: () => { location.hash = `#/p/${p.id}`; },
      }, h("span", p.emoji), h("span.truncate", { style: { maxWidth: "160px" } }, p.name)),
      h("span.spacer"),
      h("button.btn.sm" + (done ? ".primary" : ""), {
        type: "button", "aria-pressed": String(done),
        onclick: () => {
          store().toggleDone(t.id);
          if (!done) ui().toast("Marked complete");
        },
      }, icon("check"), done ? "Completed" : "Mark complete"),
      h("button.icon-btn", {
        type: "button", "aria-label": "More actions",
        onclick: (e) => moreMenu(e.currentTarget, t),
      }, icon("more")));
  }

  function moreMenu(anchor, t) {
    ui().menu(anchor, [
      { label: "Duplicate", icon: "copy", onClick: () => {
          const c = store().duplicateTask(t.id);
          if (c) { open(c.id); ui().toast("Task duplicated"); }
      } },
      { label: "Copy link", icon: "link", onClick: async () => {
          const url = location.href.split("#")[0] + "#/task/" + t.id;
          try { await navigator.clipboard.writeText(url); ui().toast("Link copied"); }
          catch (_) { ui().toast("Could not copy the link"); }
      } },
      { sep: true },
      { label: "Delete task", icon: "trash", danger: true, onClick: () => {
          close();
          store().deleteTask(t.id);
          ui().toast("Task deleted", { action: { label: "Undo", onClick: () => store().undo() } });
      } },
    ], { align: "right" });
  }

  /* ----------------------------------------------------------------- Body */

  function body(t, p) {
    return h("div.dr-body",
      titleEl(t),
      properties(t, p),
      subtasksSection(t),
      notesSection(t),
      commentsSection(t),
      activitySection(t));
  }

  function titleEl(t) {
    const save = u.debounce((id, v) => silent(() => store().updateTask(id, { title: v.trim() || "Untitled task" }, { coalesce: "title-" + id })), 250);
    const node = h("div.dr-title", { "data-edit": "title", "data-placeholder": "Untitled task", "aria-label": "Task title" }, t.title);
    plainEditable(node, {
      onInput: (v) => save(t.id, v),
      onCommit: (v) => {
        save.cancel();
        const clean = v.trim() || "Untitled task";
        if (clean !== t.title) silent(() => store().updateTask(t.id, { title: clean }, { coalesce: "title-" + t.id }));
        if (!v.trim()) node.textContent = clean;
      },
    });
    return node;
  }

  /* ----------------------------------------------------------- Properties */

  function properties(t, p) {
    const st = store();
    const status = st.statusOf(t);
    const member = st.member(t.assigneeId);
    const info = t.due ? u.dueInfo(t.due, st.isDone(t)) : null;
    const tags = t.tagIds.map((id) => st.tag(p.id, id)).filter(Boolean);

    const setStart = (iso) => {
      const patch = { start: iso };
      if (iso && t.due && iso > t.due) patch.due = iso;
      st.updateTask(t.id, patch);
    };
    const setDue = (iso) => {
      const patch = { due: iso };
      if (iso && t.start && iso < t.start) patch.start = iso;
      st.updateTask(t.id, patch);
    };

    const estimate = h("input.prop-input", {
      type: "number", min: "0", step: "1", placeholder: "Points", value: t.estimate ?? "", "aria-label": "Estimate in points",
      "data-edit": "estimate",
    });
    estimate.addEventListener("change", () => {
      const n = estimate.value === "" ? null : Math.max(0, Number(estimate.value));
      silent(() => st.updateTask(t.id, { estimate: n }));
    });

    const list = h("div.prop-list",
      row("Status", "circle-half", h("button.prop-value", {
        type: "button", onclick: (e) => ui().pickStatus(e.currentTarget, p, t.statusId, (sid) => st.updateTask(t.id, { statusId: sid })),
      }, ui().statusTag(status))),

      row("Priority", "flag", h("button.prop-value", {
        type: "button", onclick: (e) => ui().pickPriority(e.currentTarget, t.priority, (pr) => st.updateTask(t.id, { priority: pr })),
      }, t.priority === "none" ? placeholder("Set priority") : ui().priorityEl(t.priority))),

      row("Assignee", "user", h("button.prop-value", {
        type: "button", onclick: (e) => ui().pickAssignee(e.currentTarget, t.assigneeId, (id) => st.updateTask(t.id, { assigneeId: id })),
      }, member ? [ui().avatar(member, "sm"), member.name] : placeholder("Unassigned"))),

      row("Start", "clock", h("button.prop-value", {
        type: "button", onclick: (e) => ui().pickDate(e.currentTarget, t.start, setStart),
      }, t.start ? u.fmtDate(t.start) : placeholder("Set start date"))),

      row("Due", "calendar", h("button.prop-value" + (info && info.cls === "overdue" ? ".overdue" : ""), {
        type: "button", onclick: (e) => ui().pickDate(e.currentTarget, t.due, setDue),
      }, t.due ? [u.fmtDate(t.due), info.text && info.text !== u.fmtDate(t.due) ? h("span.muted", "· " + info.text) : null] : placeholder("Set due date"))),

      row("Tags", "tag", h("button.prop-value", {
        type: "button",
        onclick: (e) => ui().pickTags(e.currentTarget, p.id, t.tagIds, (ids) => st.updateTask(t.id, { tagIds: ids })),
      }, tags.length ? h("span.tag-list", tags.map(ui().tagEl)) : placeholder("Add tags"))),

      row("Estimate", "target", h("div.prop-value.editable", estimate)));

    return list;
  }

  /* ------------------------------------------------------------- Subtasks */

  function subtasksSection(t) {
    const st = store();
    const prog = st.progress(t);
    const input = h("input", { type: "text", placeholder: "Add a subtask", "aria-label": "Add a subtask", "data-focus": "add-subtask" });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !input.value.trim()) return;
      e.preventDefault();
      st.addSubtask(t.id, input.value);
      el.querySelector('[data-focus="add-subtask"]')?.focus();
    });

    const rows = t.subtasks.map((s) => {
      const chk = ui().checkEl(s.done, () => st.updateSubtask(t.id, s.id, { done: !s.done }));
      chk.classList.add("square");
      const text = plainEditable(h("span.subtask-text", { "data-edit": "subtask" }, s.title), {
        onCommit: (v) => {
          const clean = v.trim();
          if (!clean) { text.textContent = s.title; return; }
          if (clean !== s.title) silent(() => st.updateSubtask(t.id, s.id, { title: clean }));
        },
      });
      return h("div.subtask" + (s.done ? ".done" : ""), { dataset: { id: s.id } },
        chk, text,
        h("button.icon-btn.sm", { type: "button", "aria-label": "Delete subtask", onclick: () => st.deleteSubtask(t.id, s.id) }, icon("x")));
    });

    return h("section",
      h("div.section-title", h("span", "Subtasks"), prog.total ? h("span.muted", `${prog.done} of ${prog.total}`) : null),
      prog.total ? h("div.progress.green", { style: { marginBottom: "8px" }, role: "progressbar", "aria-valuenow": prog.pct, "aria-valuemin": 0, "aria-valuemax": 100 },
        h("i", { style: { width: prog.pct + "%" } })) : null,
      h("div.subtasks", rows),
      h("div.add-line", icon("plus"), input));
  }

  /* ---------------------------------------------------------------- Notes */

  function notesSection(t) {
    const save = u.debounce((id, v) => silent(() => store().updateTask(id, { notes: v }, { coalesce: "notes-" + id })), 400);
    const editor = h("div.notes-editor", { "data-edit": "notes", "data-placeholder": "Add context, links or acceptance criteria…", "aria-label": "Notes" }, t.notes);
    plainEditable(editor, {
      multiline: true,
      onInput: (v) => save(t.id, v),
      onCommit: (v) => { save.cancel(); if (v !== t.notes) silent(() => store().updateTask(t.id, { notes: v }, { coalesce: "notes-" + t.id })); },
    });
    return h("section", h("div.section-title", h("span", "Notes")), editor);
  }

  /* ------------------------------------------------------------- Comments */

  function commentsSection(t) {
    const st = store();
    const me = st.me();
    const area = h("textarea.textarea", { placeholder: "Write a comment…  (Ctrl Enter to send)", rows: 2, "aria-label": "Write a comment", "data-focus": "comment" });
    const send = () => {
      if (!area.value.trim()) return;
      st.addComment(t.id, area.value);
      el.querySelector('[data-focus="comment"]')?.focus();
    };
    area.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });

    const items = t.comments.map((c) => {
      const author = st.member(c.authorId);
      return h("div.comment",
        ui().avatar(author || { name: "?" }, "lg"),
        h("div.comment-body",
          h("div.comment-meta", h("strong", author ? author.name : "Someone"), u.timeAgo(c.ts),
            c.authorId === st.data.me
              ? h("button.icon-btn.sm", { type: "button", "aria-label": "Delete comment", onclick: () => st.deleteComment(t.id, c.id) }, icon("trash"))
              : null),
          h("div.comment-text", c.text)));
    });

    return h("section",
      h("div.section-title", h("span", "Comments"), t.comments.length ? h("span.muted", String(t.comments.length)) : null),
      items.length ? h("div.comments", items) : null,
      h("div.comment-form", ui().avatar(me, "lg"), h("div", { style: { flex: 1, display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-end" } },
        area, h("button.btn.primary.sm", { type: "button", onclick: send }, icon("send"), "Comment"))));
  }

  /* ------------------------------------------------------------- Activity */

  function activitySection(t) {
    const rows = t.activity.slice(0, 8).map((a) => h("li", `${a.text} · ${u.timeAgo(a.ts)}`));
    return h("section",
      h("div.section-title", h("span", "Activity")),
      rows.length ? h("ul.activity", rows) : h("p.muted", { style: { fontSize: "var(--fs-xs)" } }, "No activity yet."),
      h("p.muted", { style: { marginTop: "16px", fontSize: "var(--fs-xs)" } },
        `Created ${u.timeAgo(t.createdAt)} · Edited ${u.timeAgo(t.updatedAt)}`));
  }

  /* ---------------------------------------------------------------- Events */

  Plot.bus.on("change", () => {
    if (currentId == null || quiet) return;
    if (!store().task(currentId)) { close(); return; }
    if (isEditing()) return;
    render();
  });

  // Clicking away from the panel closes it (but not on menus, modals or task rows).
  document.addEventListener("pointerdown", (e) => {
    if (currentId == null) return;
    if (e.target.closest("#drawer, .menu, .modal-wrap, .overlay, .toast, [data-task-id]")) return;
    close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && currentId != null && !ui().hasOverlay()) close();
  });

  document.head.append(h("style", { id: "drawer-styles" }, `
    .dr-head .btn.ghost { max-width: 220px; }
    .prop-input { width: 90px; min-height: 24px; padding: 0 4px; border-radius: var(--r-xs); font-size: var(--fs-sm); }
    .prop-input:focus { background: var(--surface-2); box-shadow: 0 0 0 2px var(--accent-ring); }
    .dr-body section { display: block; }
    .comment-meta .icon-btn { margin-left: auto; }
    .dr-title:empty::before { content: attr(data-placeholder); color: var(--ink-4); }
  `));

  Plot.drawer = {
    open, close,
    isOpen: () => currentId != null,
    get currentId() { return currentId; },
  };
})();
