/* ==========================================================================
   Plotline · views/board.js
   Kanban board: one column per status.

   - Drag cards between and within columns (mouse, pen, or touch with a short
     press). Built on pointer events, so it works on phones too.
   - Keyboard: Enter opens a card, Alt + Left/Right moves it between columns.
   - Quick add at the bottom of every column.
   - Column menu: rename, change color, toggle "counts as done", delete.
   - Right-click a card for Open, Move to, Duplicate and Delete.
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

  let addingIn = null;     // status id whose quick-add form is open
  let refocus = null;      // task id to focus after the next render
  let swallowClick = false;

  /* ---------------------------------------------------------------- Render */

  function render(root, { project, view }) {
    const st = store();
    const ctx = { pid: project.id, vid: view.id };
    const tasks = F().applyAll(st.tasks(project.id), view, project);
    const rerender = () => render(root, { project: st.project(ctx.pid), view: st.view(ctx.pid, ctx.vid) });

    // Remember scroll positions so edits do not make the board jump
    const prevBoard = root.querySelector(".board");
    const prevLeft = prevBoard ? prevBoard.scrollLeft : 0;
    const prevTop = root.scrollTop;
    const colScroll = {};
    root.querySelectorAll(".col[data-status] .col-body").forEach((b) => { colScroll[b.parentElement.dataset.status] = b.scrollTop; });

    const byStatus = new Map(project.statuses.map((s) => [s.id, []]));
    tasks.forEach((t) => byStatus.get(t.statusId)?.push(t));

    const board = h("div.board", { role: "list", "aria-label": project.name + " board" },
      project.statuses.map((s) => column(s, byStatus.get(s.id) || [], project)),
      h("button.col.ghost-col", { type: "button", dataset: { act: "add-col" }, "aria-label": "Add status column" },
        h("span.col-add", icon("plus"), "Add status")));

    const wrapper = h("div.view-inner", board);
    bind(wrapper, board, ctx, rerender);
    u.mount(root, wrapper);

    board.scrollLeft = prevLeft;
    root.scrollTop = prevTop;
    root.querySelectorAll(".col[data-status] .col-body").forEach((b) => { b.scrollTop = colScroll[b.parentElement.dataset.status] || 0; });

    if (addingIn) {
      const input = wrapper.querySelector("[data-add-input]");
      if (input) { input.focus(); input.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    } else if (refocus) {
      wrapper.querySelector(`.card[data-task-id="${refocus}"]`)?.focus();
    }
    refocus = null;
  }

  /* --------------------------------------------------------------- Column */

  function column(status, tasks, project) {
    const body = h("div.col-body", { role: "presentation" },
      tasks.map((t) => card(t, project)),
      tasks.length === 0 && addingIn !== status.id ? h("p.muted", { style: { fontSize: "var(--fs-xs)", padding: "6px 8px" } }, "No tasks") : null);

    return h("section.col", { dataset: { status: status.id }, role: "group", "aria-label": `${status.name}, ${u.plural(tasks.length, "task")}` },
      h("div.col-head",
        h("span.dot.c-" + status.color),
        h("span.col-title", status.name),
        h("span.col-count", String(tasks.length)),
        status.done ? h("span.muted", { title: "Counts as done" }, icon("check-circle")) : null,
        h("span.spacer"),
        h("button.icon-btn.sm", { type: "button", "aria-label": "Add task to " + status.name, dataset: { act: "add-open", status: status.id } }, icon("plus")),
        h("button.icon-btn.sm", { type: "button", "aria-label": "Column options", dataset: { act: "col-menu", status: status.id } }, icon("more"))),
      body,
      addingIn === status.id ? addForm(status) : h("button.col-add", { type: "button", dataset: { act: "add-open", status: status.id } }, icon("plus"), "New task"));
  }

  function addForm(status) {
    const input = h("input.input", { type: "text", placeholder: "Task title", "aria-label": "New task title", dataset: { addInput: status.id } });
    return h("div.col-add-form", input,
      h("div", { style: { display: "flex", gap: "6px" } },
        h("button.btn.primary.sm", { type: "button", dataset: { act: "add-submit", status: status.id } }, "Add"),
        h("button.btn.ghost.sm", { type: "button", dataset: { act: "add-cancel" } }, "Cancel")));
  }

  /* ----------------------------------------------------------------- Card */

  function card(t, project) {
    const st = store();
    const done = st.isDone(t);
    const member = st.member(t.assigneeId);
    const prog = st.progress(t);
    const tags = t.tagIds.map((id) => st.tag(project.id, id)).filter(Boolean);
    const prio = ui().priorityEl(t.priority, { label: false });
    const due = ui().dueEl(t);

    const meta = [
      prio ? h("span.meta-item", { title: st.priority(t.priority).name + " priority" }, prio) : null,
      due,
      prog.total ? h("span.meta-item", { title: "Subtasks" }, icon("subtask"), `${prog.done}/${prog.total}`) : null,
      t.comments.length ? h("span.meta-item", { title: "Comments" }, icon("comment"), String(t.comments.length)) : null,
      h("span.spacer"),
      member ? ui().avatar(member, "sm") : null,
    ].filter(Boolean);

    return h("article.card" + (done ? ".done" : ""), { tabindex: "0", role: "listitem", dataset: { taskId: t.id } },
      h("div.card-top", ui().checkEl(done, () => st.toggleDone(t.id)), h("div.card-title", t.title)),
      tags.length ? h("div.tag-list", tags.slice(0, 3).map(ui().tagEl), tags.length > 3 ? h("span.tag.c-gray", "+" + (tags.length - 3)) : null) : null,
      meta.length > 1 || (meta.length === 1 && meta[0].className !== "spacer") ? h("div.card-meta", meta) : null,
      prog.total ? h("div.progress.card-bar" + (prog.pct === 100 ? ".green" : ""), h("i", { style: { width: prog.pct + "%" } })) : null);
  }

  /* ----------------------------------------------------------- Interaction */

  function bind(wrapper, board, ctx, rerender) {
    const st = store();
    const fresh = () => st.project(ctx.pid);

    wrapper.addEventListener("click", (e) => {
      const actEl = e.target.closest("[data-act]");
      const cardEl = e.target.closest(".card");
      if (!actEl) { if (cardEl) Plot.drawer.open(cardEl.dataset.taskId); return; }
      const project = fresh();
      const status = project.statuses.find((s) => s.id === actEl.dataset.status);

      switch (actEl.dataset.act) {
        case "add-open": addingIn = actEl.dataset.status; rerender(); break;
        case "add-cancel": addingIn = null; rerender(); break;
        case "add-submit": submitAdd(actEl.dataset.status, wrapper, ctx, rerender); break;
        case "col-menu": columnMenu(actEl, status, project); break;
        case "add-col": addStatus(project); break;
        default: break;
      }
    }, false);

    wrapper.addEventListener("keydown", (e) => {
      if (e.target.matches("[data-add-input]")) {
        if (e.key === "Enter") { e.preventDefault(); submitAdd(e.target.dataset.addInput, wrapper, ctx, rerender); }
        else if (e.key === "Escape") { e.stopPropagation(); addingIn = null; rerender(); }
        return;
      }
      const cardEl = e.target.closest(".card");
      if (!cardEl || e.target !== cardEl) return;
      const id = cardEl.dataset.taskId;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); Plot.drawer.open(id); }
      else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const project = fresh();
        const t = st.task(id);
        const i = project.statuses.findIndex((s) => s.id === t.statusId) + (e.key === "ArrowRight" ? 1 : -1);
        if (project.statuses[i]) { refocus = id; st.moveTask(id, project.statuses[i].id, null); }
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const cards = Array.from(cardEl.parentElement.querySelectorAll(".card"));
        cards[cards.indexOf(cardEl) + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
      }
    });

    wrapper.addEventListener("contextmenu", (e) => {
      const cardEl = e.target.closest(".card");
      if (!cardEl) return;
      const id = cardEl.dataset.taskId;
      const t = st.task(id);
      ui().contextMenu(e, [
        { label: "Open", icon: "arrow-up-right", onClick: () => Plot.drawer.open(id) },
        { sep: true },
        { heading: "Move to" },
        ...fresh().statuses.map((s) => ({ label: s.name, color: s.color, selected: s.id === t.statusId, onClick: () => st.moveTask(id, s.id, null) })),
        { sep: true },
        { label: "Duplicate", icon: "copy", onClick: () => { st.duplicateTask(id); ui().toast("Task duplicated"); } },
        { label: "Delete", icon: "trash", danger: true, onClick: () => {
            st.deleteTask(id);
            ui().toast("Task deleted", { action: { label: "Undo", onClick: () => st.undo() } });
        } },
      ]);
    });

    // After a drag the browser fires a click; swallow it so the drawer does not open.
    wrapper.addEventListener("click", (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);

    bindDrag(wrapper, board, ctx);
  }

  function submitAdd(statusId, wrapper, ctx, rerender) {
    const input = wrapper.querySelector("[data-add-input]");
    const title = input ? input.value.trim() : "";
    if (!title) { input && input.focus(); return; }
    addingIn = statusId;                       // keep the form open for rapid entry
    store().addTask(ctx.pid, { title, statusId });
  }

  /* -------------------------------------------------------- Column actions */

  function columnMenu(anchor, status, project) {
    const st = store();
    ui().menu(anchor, [
      { label: "Rename", icon: "edit", onClick: async () => {
          const name = await ui().prompt({ title: "Rename status", value: status.name, confirmLabel: "Rename" });
          if (name) st.updateStatus(project.id, status.id, { name });
      } },
      { label: "Change color", icon: "sparkles", onClick: () => ui().pickColor(anchor, status.color, (c) => st.updateStatus(project.id, status.id, { color: c })) },
      { label: "Counts as done", icon: "check-circle", selected: !!status.done, onClick: () => st.updateStatus(project.id, status.id, { done: !status.done }) },
      { sep: true },
      { label: "Delete status", icon: "trash", danger: true, disabled: project.statuses.length <= 1, onClick: async () => {
          const fallback = project.statuses.find((s) => s.id !== status.id);
          const n = st.tasks(project.id).filter((t) => t.statusId === status.id).length;
          const ok = await ui().confirm({
            title: `Delete “${status.name}”?`,
            message: n ? `${u.plural(n, "task")} will move to “${fallback.name}”.` : "This status has no tasks.",
            confirmLabel: "Delete", danger: true,
          });
          if (ok) st.deleteStatus(project.id, status.id);
      } },
    ], { align: "right" });
  }

  async function addStatus(project) {
    const name = await ui().prompt({ title: "New status", label: "Name", placeholder: "e.g. Blocked", confirmLabel: "Add status" });
    if (name) store().addStatus(project.id, name, u.COLORS[1 + (project.statuses.length % 8)]);
  }

  /* --------------------------------------------------------- Drag and drop */

  function bindDrag(wrapper, board, ctx) {
    const st = store();
    let pending = null;     // pointer is down, drag not started yet
    let drag = null;        // drag in progress
    let raf = 0;

    const line = h("div.drop-line");

    wrapper.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const cardEl = e.target.closest(".card");
      if (!cardEl || e.target.closest("button, input, a, [contenteditable]")) return;

      pending = { card: cardEl, id: cardEl.dataset.taskId, x: e.clientX, y: e.clientY, pointerId: e.pointerId, type: e.pointerType, timer: 0 };
      if (e.pointerType !== "mouse") {
        pending.timer = setTimeout(() => { if (pending) { if (navigator.vibrate) navigator.vibrate(8); begin(pending.x, pending.y); } }, 260);
      }
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
    });

    function begin(x, y) {
      if (!pending || drag) return;
      const { card: src, id } = pending;
      const rect = src.getBoundingClientRect();
      const ghost = src.cloneNode(true);
      ghost.classList.remove("dragging");
      Object.assign(ghost.style, {
        position: "fixed", width: rect.width + "px", left: rect.left + "px", top: rect.top + "px", margin: 0,
        zIndex: "200", pointerEvents: "none", transform: "rotate(2deg)", boxShadow: "var(--shadow-3)", cursor: "grabbing",
      });
      document.body.append(ghost);
      src.classList.add("dragging");
      document.body.classList.add("is-dragging");
      drag = { id, src, ghost, offX: x - rect.left, offY: y - rect.top, x, y, drop: null };
      document.addEventListener("touchmove", blockScroll, { passive: false });
      document.addEventListener("keydown", onKey, true);
      loop();
    }

    const blockScroll = (e) => { if (drag) e.preventDefault(); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); finish(false); } };

    function onMove(e) {
      if (!pending && !drag) return;
      if (!drag) {
        const dist = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
        if (pending.type === "mouse") { if (dist > 5) begin(e.clientX, e.clientY); }
        else if (dist > 10) cleanup();                     // finger moved before long-press: let the page scroll
        return;
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.ghost.style.left = e.clientX - drag.offX + "px";
      drag.ghost.style.top = e.clientY - drag.offY + "px";
      updateDrop();
    }

    function updateDrop() {
      const under = document.elementFromPoint(drag.x, drag.y);
      const col = under && under.closest(".col[data-status]");
      board.querySelectorAll(".col.drop-over").forEach((c) => { if (c !== col) c.classList.remove("drop-over"); });
      if (!col || !wrapper.contains(col)) { line.remove(); drag.drop = null; return; }

      col.classList.add("drop-over");
      const body = col.querySelector(".col-body");
      const cards = Array.from(body.querySelectorAll(".card:not(.dragging)"));
      const before = cards.find((c) => { const r = c.getBoundingClientRect(); return drag.y < r.top + r.height / 2; }) || null;
      if (before) { if (line.nextSibling !== before) body.insertBefore(line, before); }
      else if (line.parentElement !== body || line.nextSibling) body.append(line);
      drag.drop = { col, before };
    }

    // Edge auto-scroll while dragging
    function loop() {
      if (!drag) return;
      const br = board.getBoundingClientRect();
      const zone = 70, speed = 14;
      if (drag.x < br.left + zone) board.scrollLeft -= speed;
      else if (drag.x > br.right - zone) board.scrollLeft += speed;
      const body = drag.drop && drag.drop.col.querySelector(".col-body");
      if (body) {
        const r = body.getBoundingClientRect();
        if (drag.y < r.top + 50) body.scrollTop -= 10;
        else if (drag.y > r.bottom - 50) body.scrollTop += 10;
      }
      updateDrop();
      raf = requestAnimationFrame(loop);
    }

    function onUp() { drag ? finish(true) : cleanup(); }
    function onCancel() { drag ? finish(false) : cleanup(); }

    function finish(commit) {
      const d = drag;
      const drop = d.drop;
      cleanup();
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 0);
      if (!commit || !drop) return;

      const t = st.task(d.id);
      const beforeId = drop.before ? drop.before.dataset.taskId : null;
      const nextOfSrc = d.src.nextElementSibling;
      const sameSpot = t.statusId === drop.col.dataset.status &&
        ((nextOfSrc && nextOfSrc.dataset.taskId) || null) === beforeId;
      if (!sameSpot) st.moveTask(d.id, drop.col.dataset.status, beforeId);
    }

    function cleanup() {
      if (pending && pending.timer) clearTimeout(pending.timer);
      pending = null;
      cancelAnimationFrame(raf);
      if (drag) {
        drag.ghost.remove();
        drag.src.classList.remove("dragging");
        drag = null;
      }
      line.remove();
      board.querySelectorAll(".col.drop-over").forEach((c) => c.classList.remove("drop-over"));
      document.body.classList.remove("is-dragging");
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("touchmove", blockScroll);
      document.removeEventListener("keydown", onKey, true);
    }
  }

  /* --------------------------------------------------------------- Styles */

  document.head.append(h("style", { id: "board-styles" }, `
    .card:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .card .check { margin-top: 1px; }
    .card .tag-list { gap: 4px; }
    .card-meta .prio svg { width: 14px; height: 14px; }
    .col-add-form { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    button.col.ghost-col { cursor: pointer; align-items: center; justify-content: center; min-height: 80px; }
    button.col.ghost-col:hover { border-color: var(--accent); color: var(--accent); }
    .board { touch-action: pan-x pan-y; }
  `));

  Plot.views.board = { wide: true, render };
})();
