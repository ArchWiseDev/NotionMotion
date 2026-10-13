/* ==========================================================================
   Plotline · store.js
   The single source of truth. Holds all data, saves to localStorage, keeps an
   undo/redo history and announces every change on Plot.bus ("change").

   Data shape (store.data):
     meta      { version, name, updatedAt }
     me        member id of the current user
     members   [{ id, name }]
     projects  [{ id, name, emoji, description, favorite, createdAt,
                  statuses:[{id,name,color,done}], tags:[{id,name,color}],
                  views:[{id,type,name,filters,sort,group,collapsed}] }]
     tasks     [{ id, projectId, title, statusId, priority, assigneeId,
                  start, due, tagIds, estimate, notes, subtasks, comments,
                  activity, order, createdAt, updatedAt, completedAt }]
     docs      [{ id, title, emoji, blocks:[{id,type,text,checked}], updatedAt }]

   Rules for the rest of the app:
     - Read through the query helpers (store.tasks(), store.project(id) ...).
     - Change data only through store methods; each one goes through commit().
     - Re-render when you hear bus "change".
   ========================================================================== */
(function () {
  "use strict";

  const Plot = (window.Plot = window.Plot || {});
  const { uid, today, clone } = Plot.u;
  const bus = Plot.bus;

  const KEY = "plotline.v1";
  const PREF_KEY = "plotline.prefs";
  const MAX_HISTORY = 60;
  const VERSION = 1;

  /* ------------------------------------------------------------ Constants */

  const PRIORITIES = [
    { id: "urgent", name: "Urgent", color: "red", rank: 4 },
    { id: "high", name: "High", color: "orange", rank: 3 },
    { id: "medium", name: "Medium", color: "yellow", rank: 2 },
    { id: "low", name: "Low", color: "blue", rank: 1 },
    { id: "none", name: "No priority", color: "gray", rank: 0 },
  ];

  const VIEW_TYPES = [
    { type: "table", name: "Table", icon: "table" },
    { type: "board", name: "Board", icon: "board" },
    { type: "list", name: "List", icon: "list" },
    { type: "calendar", name: "Calendar", icon: "calendar" },
    { type: "timeline", name: "Timeline", icon: "timeline" },
  ];

  const DEFAULT_STATUSES = [
    { name: "Backlog", color: "gray" },
    { name: "To do", color: "blue" },
    { name: "In progress", color: "orange" },
    { name: "In review", color: "purple" },
    { name: "Done", color: "green", done: true },
  ];

  Plot.consts = { PRIORITIES, VIEW_TYPES, DEFAULT_STATUSES };

  /* ---------------------------------------------------------------- State */

  let data = null;
  let undoStack = [];
  let redoStack = [];
  let coalesce = { key: null, at: 0 };
  let batchDepth = 0;
  let storageOK = true;

  /* ------------------------------------------------------------- Factory */

  const makeStatuses = () => DEFAULT_STATUSES.map((s) => ({ id: uid("st"), ...s }));

  const makeViews = () =>
    VIEW_TYPES.map((v) => ({
      id: uid("vw"),
      type: v.type,
      name: v.name,
      filters: [],
      sort: v.type === "table" || v.type === "list" ? { field: "order", dir: "asc" } : null,
      group: v.type === "list" ? "status" : "",
      collapsed: {},
    }));

  /* ---------------------------------------------------------- Persistence */

  function normalize(d) {
    d.meta = Object.assign({ version: VERSION, name: "Plotline", updatedAt: Date.now() }, d.meta);
    d.members = Array.isArray(d.members) && d.members.length ? d.members : [{ id: uid("m"), name: "You" }];
    d.me = d.members.some((m) => m.id === d.me) ? d.me : d.members[0].id;
    d.projects = Array.isArray(d.projects) ? d.projects : [];
    d.tasks = Array.isArray(d.tasks) ? d.tasks : [];
    d.docs = Array.isArray(d.docs) ? d.docs : [];
    d.projects.forEach((p) => {
      p.statuses = p.statuses && p.statuses.length ? p.statuses : makeStatuses();
      p.tags = p.tags || [];
      p.views = p.views && p.views.length ? p.views : makeViews();
      p.emoji = p.emoji || "📁";
      p.description = p.description || "";
    });
    d.tasks.forEach((t) => {
      t.tagIds = t.tagIds || [];
      t.subtasks = t.subtasks || [];
      t.comments = t.comments || [];
      t.activity = t.activity || [];
      t.priority = t.priority || "none";
      t.notes = t.notes || "";
      t.order = typeof t.order === "number" ? t.order : 0;
    });
    return d;
  }

  function readStorage() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch (err) {
      console.warn("[store] could not read saved data", err);
      return null;
    }
  }

  function writeStorage() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      storageOK = true;
      bus.emit("saved");
    } catch (err) {
      storageOK = false;
      console.warn("[store] could not save", err);
      bus.emit("storage-error", err);
    }
  }

  const scheduleSave = Plot.u.debounce(writeStorage, 350);

  function init() {
    data = readStorage();
    if (!data) {
      data = normalize(Plot.seed.demo());
      writeStorage();
    }
    window.addEventListener("storage", (e) => {
      if (e.key !== KEY || !e.newValue) return;
      try {
        data = normalize(JSON.parse(e.newValue));
        bus.emit("change", { label: "sync", external: true });
      } catch (_) { /* ignore corrupt cross-tab payloads */ }
    });
    window.addEventListener("beforeunload", () => scheduleSave.flush());
    return data;
  }

  /* ---------------------------------------------------------- Commit core */

  /**
   * Run a mutation, snapshot for undo, schedule a save, announce the change.
   * opts.coalesce  merge rapid edits with the same key into one undo step
   * opts.undo      false = do not record in undo history (view settings)
   */
  function commit(label, fn, opts = {}) {
    if (batchDepth > 0) return fn(data);

    const before = JSON.stringify(data);
    const result = fn(data);

    if (opts.undo !== false) {
      const now = Date.now();
      const key = opts.coalesce;
      const merge = key && coalesce.key === key && now - coalesce.at < 1500;
      if (!merge) {
        undoStack.push(before);
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
      }
      coalesce = key ? { key, at: now } : { key: null, at: 0 };
      redoStack.length = 0;
    }

    data.meta.updatedAt = Date.now();
    bus.emit("saving");
    scheduleSave();
    bus.emit("change", { label, silent: !!opts.silent });
    return result;
  }

  /** Group many mutations into one undo step (used by templates and import). */
  function batch(label, fn) {
    const before = JSON.stringify(data);
    batchDepth++;
    let result;
    try { result = fn(); } finally { batchDepth--; }
    undoStack.push(before);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    data.meta.updatedAt = Date.now();
    bus.emit("saving");
    scheduleSave();
    bus.emit("change", { label });
    return result;
  }

  function undo() {
    if (!undoStack.length) return false;
    redoStack.push(JSON.stringify(data));
    data = normalize(JSON.parse(undoStack.pop()));
    coalesce = { key: null, at: 0 };
    bus.emit("saving");
    scheduleSave();
    bus.emit("change", { label: "undo" });
    return true;
  }

  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(JSON.stringify(data));
    data = normalize(JSON.parse(redoStack.pop()));
    coalesce = { key: null, at: 0 };
    bus.emit("saving");
    scheduleSave();
    bus.emit("change", { label: "redo" });
    return true;
  }

  /* -------------------------------------------------------------- Queries */

  const api = {};

  const byId = (arr, id) => arr.find((x) => x.id === id) || null;

  api.projects = () => data.projects;
  api.project = (id) => byId(data.projects, id);
  api.tasks = (projectId) => (projectId ? data.tasks.filter((t) => t.projectId === projectId) : data.tasks);
  api.task = (id) => byId(data.tasks, id);
  api.docs = () => data.docs;
  api.doc = (id) => byId(data.docs, id);
  api.members = () => data.members;
  api.member = (id) => byId(data.members, id);
  api.me = () => byId(data.members, data.me);
  api.view = (pid, vid) => byId(api.project(pid)?.views || [], vid);
  api.priority = (id) => PRIORITIES.find((p) => p.id === id) || PRIORITIES[4];
  api.status = (pid, sid) => byId(api.project(pid)?.statuses || [], sid);
  api.statusOf = (task) => api.status(task.projectId, task.statusId);
  api.tag = (pid, tid) => byId(api.project(pid)?.tags || [], tid);
  api.isDone = (task) => !!api.statusOf(task)?.done;
  api.canUndo = () => undoStack.length > 0;
  api.canRedo = () => redoStack.length > 0;
  api.storageOK = () => storageOK;

  Object.defineProperty(api, "data", { get: () => data });

  api.progress = (task) => {
    const total = task.subtasks.length;
    const done = task.subtasks.filter((s) => s.done).length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : api.isDone(task) ? 100 : 0 };
  };

  /** Summary numbers for one project (or all projects when pid is falsy). */
  api.stats = (pid) => {
    const list = api.tasks(pid);
    const t0 = today();
    const weekAgo = Date.now() - 7 * 86400000;
    let done = 0, overdue = 0, dueToday = 0, doneWeek = 0;
    for (const t of list) {
      if (api.isDone(t)) {
        done++;
        if (t.completedAt && t.completedAt > weekAgo) doneWeek++;
      } else if (t.due) {
        if (t.due < t0) overdue++;
        else if (t.due === t0) dueToday++;
      }
    }
    const total = list.length;
    return { total, done, open: total - done, overdue, dueToday, doneWeek, pct: total ? Math.round((done / total) * 100) : 0 };
  };

  /* ------------------------------------------------------------- Projects */

  api.createProject = (opts = {}) =>
    commit("New project", (d) => {
      const p = {
        id: uid("p"),
        name: opts.name || "Untitled project",
        emoji: opts.emoji || "📁",
        description: opts.description || "",
        favorite: false,
        createdAt: Date.now(),
        statuses: makeStatuses(),
        tags: (opts.tags || []).map((t) => ({ id: uid("tg"), name: t.name, color: t.color })),
        views: makeViews(),
      };
      d.projects.push(p);
      return p;
    });

  api.updateProject = (id, patch, opts) =>
    commit("Update project", (d) => {
      const p = byId(d.projects, id);
      if (p) Object.assign(p, patch);
    }, opts);

  api.toggleFavorite = (id) =>
    commit("Favorite", (d) => {
      const p = byId(d.projects, id);
      if (p) p.favorite = !p.favorite;
    }, { undo: false });

  api.deleteProject = (id) =>
    commit("Delete project", (d) => {
      d.projects = d.projects.filter((p) => p.id !== id);
      d.tasks = d.tasks.filter((t) => t.projectId !== id);
    });

  api.duplicateProject = (id) =>
    commit("Duplicate project", (d) => {
      const src = byId(d.projects, id);
      if (!src) return null;
      const copy = clone(src);
      const map = new Map();
      copy.id = uid("p");
      copy.name = src.name + " (copy)";
      copy.favorite = false;
      copy.createdAt = Date.now();
      copy.statuses.forEach((s) => { const n = uid("st"); map.set(s.id, n); s.id = n; });
      copy.tags.forEach((t) => { const n = uid("tg"); map.set(t.id, n); t.id = n; });
      copy.views.forEach((v) => { v.id = uid("vw"); v.collapsed = {}; v.filters = []; });
      d.projects.push(copy);
      d.tasks.filter((t) => t.projectId === id).forEach((t) => {
        const c = clone(t);
        c.id = uid("t");
        c.projectId = copy.id;
        c.statusId = map.get(t.statusId);
        c.tagIds = t.tagIds.map((x) => map.get(x)).filter(Boolean);
        c.comments = [];
        c.activity = [];
        c.createdAt = Date.now();
        d.tasks.push(c);
      });
      return copy;
    });

  /* Statuses and tags (per project) */

  api.addStatus = (pid, name, color = "gray") =>
    commit("Add status", (d) => {
      const p = byId(d.projects, pid);
      const s = { id: uid("st"), name: name || "New status", color };
      const firstDone = p.statuses.findIndex((x) => x.done);
      p.statuses.splice(firstDone === -1 ? p.statuses.length : firstDone, 0, s);
      return s;
    });

  api.updateStatus = (pid, sid, patch) =>
    commit("Edit status", (d) => {
      const s = byId(byId(d.projects, pid)?.statuses || [], sid);
      if (s) Object.assign(s, patch);
    });

  api.deleteStatus = (pid, sid) =>
    commit("Delete status", (d) => {
      const p = byId(d.projects, pid);
      if (!p || p.statuses.length <= 1) return false;
      p.statuses = p.statuses.filter((s) => s.id !== sid);
      const fallback = p.statuses[0].id;
      d.tasks.forEach((t) => { if (t.projectId === pid && t.statusId === sid) t.statusId = fallback; });
      return true;
    });

  api.reorderStatuses = (pid, ids) =>
    commit("Reorder statuses", (d) => {
      const p = byId(d.projects, pid);
      p.statuses = ids.map((id) => byId(p.statuses, id)).filter(Boolean);
    });

  api.addTag = (pid, name, color) =>
    commit("Add tag", (d) => {
      const p = byId(d.projects, pid);
      const existing = p.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (existing) return existing;
      const tag = { id: uid("tg"), name, color: color || Plot.u.colorFor(name, Plot.u.COLORS.slice(1)) };
      p.tags.push(tag);
      return tag;
    });

  api.deleteTag = (pid, tid) =>
    commit("Delete tag", (d) => {
      const p = byId(d.projects, pid);
      p.tags = p.tags.filter((t) => t.id !== tid);
      d.tasks.forEach((t) => { t.tagIds = t.tagIds.filter((x) => x !== tid); });
    });

  /* View settings (filters, sort, grouping): never added to undo history */

  api.updateView = (pid, vid, patch) =>
    commit("View settings", (d) => {
      const v = byId(byId(d.projects, pid)?.views || [], vid);
      if (v) Object.assign(v, patch);
    }, { undo: false });

  /* ---------------------------------------------------------------- Tasks */

  const log = (t, text) => {
    t.activity.unshift({ ts: Date.now(), text });
    if (t.activity.length > 40) t.activity.length = 40;
  };

  api.addTask = (projectId, fields = {}) =>
    commit("New task", (d) => {
      const p = byId(d.projects, projectId);
      if (!p) return null;
      const maxOrder = d.tasks
        .filter((t) => t.projectId === projectId)
        .reduce((m, t) => Math.max(m, t.order), 0);
      const t = {
        id: uid("t"),
        projectId,
        title: "Untitled task",
        statusId: p.statuses[0].id,
        priority: "none",
        assigneeId: null,
        start: null,
        due: null,
        tagIds: [],
        estimate: null,
        notes: "",
        subtasks: [],
        comments: [],
        activity: [],
        order: maxOrder + 1000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        completedAt: null,
        ...fields,
      };
      if (!String(t.title || "").trim()) t.title = "Untitled task";
      if (byId(p.statuses, t.statusId)?.done) t.completedAt = Date.now();
      log(t, "Task created");
      d.tasks.push(t);
      return t;
    });

  api.updateTask = (id, patch, opts) =>
    commit("Update task", (d) => {
      const t = byId(d.tasks, id);
      if (!t) return null;
      const p = byId(d.projects, t.projectId);

      if ("statusId" in patch && patch.statusId !== t.statusId) {
        const s = byId(p.statuses, patch.statusId);
        if (s) {
          log(t, `Status changed to ${s.name}`);
          t.completedAt = s.done ? Date.now() : null;
        }
      }
      if ("priority" in patch && patch.priority !== t.priority) {
        log(t, `Priority set to ${api.priority(patch.priority).name}`);
      }
      if ("assigneeId" in patch && patch.assigneeId !== t.assigneeId) {
        const m = byId(d.members, patch.assigneeId);
        log(t, m ? `Assigned to ${m.name}` : "Unassigned");
      }
      if ("due" in patch && patch.due !== t.due) {
        log(t, patch.due ? `Due date set to ${Plot.u.fmtDate(patch.due)}` : "Due date cleared");
      }
      Object.assign(t, patch);
      t.updatedAt = Date.now();
      return t;
    }, opts);

  api.deleteTask = (id) =>
    commit("Delete task", (d) => {
      d.tasks = d.tasks.filter((t) => t.id !== id);
    });

  api.deleteTasks = (ids) =>
    commit("Delete tasks", (d) => {
      const set = new Set(ids);
      d.tasks = d.tasks.filter((t) => !set.has(t.id));
    });

  api.duplicateTask = (id) =>
    commit("Duplicate task", (d) => {
      const src = byId(d.tasks, id);
      if (!src) return null;
      const c = clone(src);
      c.id = uid("t");
      c.title = src.title + " (copy)";
      c.comments = [];
      c.activity = [];
      c.order = src.order + 1;
      c.createdAt = c.updatedAt = Date.now();
      c.subtasks.forEach((s) => { s.id = uid("s"); });
      log(c, "Task duplicated");
      d.tasks.push(c);
      return c;
    });

  /** Mark done / not done using the project's own statuses. */
  api.toggleDone = (id) => {
    const t = api.task(id);
    if (!t) return null;
    const p = api.project(t.projectId);
    const target = api.isDone(t)
      ? p.statuses.find((s) => !s.done && s.name.toLowerCase() === "to do") || p.statuses.find((s) => !s.done)
      : p.statuses.find((s) => s.done);
    return target ? api.updateTask(id, { statusId: target.id }) : t;
  };

  /**
   * Move a task to a status column, placing it before `beforeId`
   * (or at the end of the column when beforeId is null).
   */
  api.moveTask = (id, statusId, beforeId = null) =>
    commit("Move task", (d) => {
      const t = byId(d.tasks, id);
      if (!t) return;
      const p = byId(d.projects, t.projectId);
      const s = byId(p.statuses, statusId);
      if (!s) return;
      if (t.statusId !== statusId) {
        log(t, `Status changed to ${s.name}`);
        t.completedAt = s.done ? Date.now() : null;
        t.statusId = statusId;
      }
      const group = d.tasks
        .filter((x) => x.projectId === t.projectId && x.statusId === statusId && x.id !== id)
        .sort((a, b) => a.order - b.order);
      const at = beforeId ? group.findIndex((x) => x.id === beforeId) : -1;
      group.splice(at === -1 ? group.length : at, 0, t);
      group.forEach((x, i) => { x.order = (i + 1) * 1000; });
      t.updatedAt = Date.now();
    });

  /** Set start and due together (timeline drag, calendar drop). */
  api.reschedule = (id, start, due) => api.updateTask(id, { start, due });

  /* Subtasks */

  api.addSubtask = (taskId, title) =>
    commit("Add subtask", (d) => {
      const t = byId(d.tasks, taskId);
      if (!t || !title.trim()) return null;
      const s = { id: uid("s"), title: title.trim(), done: false };
      t.subtasks.push(s);
      t.updatedAt = Date.now();
      return s;
    });

  api.updateSubtask = (taskId, sid, patch, opts) =>
    commit("Edit subtask", (d) => {
      const s = byId(byId(d.tasks, taskId)?.subtasks || [], sid);
      if (s) Object.assign(s, patch);
    }, opts);

  api.deleteSubtask = (taskId, sid) =>
    commit("Delete subtask", (d) => {
      const t = byId(d.tasks, taskId);
      if (t) t.subtasks = t.subtasks.filter((s) => s.id !== sid);
    });

  /* Comments */

  api.addComment = (taskId, text) =>
    commit("Comment", (d) => {
      const t = byId(d.tasks, taskId);
      if (!t || !text.trim()) return null;
      const c = { id: uid("c"), authorId: d.me, text: text.trim(), ts: Date.now() };
      t.comments.push(c);
      return c;
    });

  api.deleteComment = (taskId, cid) =>
    commit("Delete comment", (d) => {
      const t = byId(d.tasks, taskId);
      if (t) t.comments = t.comments.filter((c) => c.id !== cid);
    });

  /* ---------------------------------------------------------------- Docs */

  api.addDoc = (fields = {}) =>
    commit("New doc", (d) => {
      const doc = {
        id: uid("d"),
        title: "",
        emoji: "📄",
        blocks: [{ id: uid("b"), type: "p", text: "" }],
        updatedAt: Date.now(),
        ...fields,
      };
      d.docs.push(doc);
      return doc;
    });

  api.updateDoc = (id, patch, opts) =>
    commit("Edit doc", (d) => {
      const doc = byId(d.docs, id);
      if (doc) Object.assign(doc, patch, { updatedAt: Date.now() });
    }, opts);

  api.deleteDoc = (id) =>
    commit("Delete doc", (d) => { d.docs = d.docs.filter((x) => x.id !== id); });

  /* -------------------------------------------------------------- Members */

  api.addMember = (name) =>
    commit("Add member", (d) => {
      const m = { id: uid("m"), name: name.trim() };
      d.members.push(m);
      return m;
    });

  api.renameMember = (id, name) =>
    commit("Rename member", (d) => {
      const m = byId(d.members, id);
      if (m && name.trim()) m.name = name.trim();
    });

  api.removeMember = (id) =>
    commit("Remove member", (d) => {
      if (id === d.me || d.members.length <= 1) return false;
      d.members = d.members.filter((m) => m.id !== id);
      d.tasks.forEach((t) => { if (t.assigneeId === id) t.assigneeId = null; });
      return true;
    });

  api.renameWorkspace = (name) =>
    commit("Rename workspace", (d) => { d.meta.name = name.trim() || "Plotline"; });

  /* ----------------------------------------------- Import / export / reset */

  api.exportJSON = () => JSON.stringify(data, null, 2);

  api.exportCSV = (pid) => {
    const q = Plot.u.csvCell;
    const rows = [["Title", "Project", "Status", "Priority", "Assignee", "Start", "Due", "Tags", "Estimate", "Subtasks done", "Subtasks total"]];
    api.tasks(pid).forEach((t) => {
      const p = api.project(t.projectId);
      rows.push([
        t.title, p?.name, api.statusOf(t)?.name, api.priority(t.priority).name,
        api.member(t.assigneeId)?.name || "", t.start || "", t.due || "",
        t.tagIds.map((id) => api.tag(t.projectId, id)?.name).filter(Boolean).join("; "),
        t.estimate ?? "", t.subtasks.filter((s) => s.done).length, t.subtasks.length,
      ]);
    });
    return rows.map((r) => r.map(q).join(",")).join("\n");
  };

  api.importJSON = (text) => {
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { return { ok: false, error: "That file is not valid JSON." }; }
    if (!parsed || !Array.isArray(parsed.projects) || !Array.isArray(parsed.tasks)) {
      return { ok: false, error: "That file does not look like a Plotline export." };
    }
    batch("Import", () => { data = normalize(parsed); });
    return { ok: true };
  };

  api.reset = (withDemo = true) => {
    batch("Reset", () => {
      data = normalize(withDemo ? Plot.seed.demo() : { meta: { name: "Plotline" }, projects: [], tasks: [], docs: [] });
    });
  };

  /* ----------------------------------------------------------- Templates */

  api.createFromTemplate = (templateId) => {
    const tpl = (Plot.seed.templates || []).find((t) => t.id === templateId);
    if (!tpl) return null;
    return batch("Template", () => tpl.build(api));
  };

  api.init = init;
  api.commit = commit;
  api.batch = batch;
  api.undo = undo;
  api.redo = redo;
  api.flush = () => scheduleSave.flush();

  Plot.store = api;

  /* ------------------------------------------------------------ Preferences
     Small UI settings kept apart from the data so they never touch undo. */
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(PREF_KEY) || "{}"); } catch (_) { prefs = {}; }

  Plot.prefs = {
    get: (k, fallback) => (k in prefs ? prefs[k] : fallback),
    set(k, v) {
      prefs[k] = v;
      try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (_) { /* private mode */ }
      bus.emit("prefs", { key: k, value: v });
    },
  };
})();
