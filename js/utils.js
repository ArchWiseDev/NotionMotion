/* ==========================================================================
   Plotline · utils.js
   Shared helpers. Everything hangs off the global `Plot` namespace:
     Plot.u    helpers (DOM, dates, text, files)
     Plot.bus  tiny event emitter used to keep views in sync
   Dates are always local "YYYY-MM-DD" strings, never timestamps, so there are
   no time zone surprises when a task is due "on the 14th".
   ========================================================================== */
(function () {
  "use strict";

  const Plot = (window.Plot = window.Plot || {});

  /* ---------------------------------------------------------------- DOM */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /**
   * Hyperscript: h("div.card", { dataset: { id: 1 }, onclick: fn }, "text", child)
   * - "tag.class1.class2#id" shorthand is supported.
   * - attrs: class, style (string or object), dataset, html, on* handlers,
   *   booleans (true sets the attribute, false/null skips it).
   * - children: strings, numbers, Nodes, arrays; null/false are skipped.
   */
  function h(spec, attrs, ...children) {
    if (attrs instanceof Node || typeof attrs === "string" || Array.isArray(attrs) || typeof attrs === "number") {
      children.unshift(attrs);
      attrs = null;
    }
    const m = /^([a-z0-9]*)((?:[.#][\w-]+)*)$/i.exec(spec) || [];
    const el = document.createElement(m[1] || "div");
    (m[2] || "").replace(/([.#])([\w-]+)/g, (_, kind, name) => {
      if (kind === ".") el.classList.add(name);
      else el.id = name;
    });

    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") v && el.classList.add(...String(v).split(/\s+/).filter(Boolean));
        else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
        else if (k === "dataset") Object.assign(el.dataset, v);
        else if (k === "html") el.innerHTML = v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, v);
      }
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  /** Replace all children of `el` with the given nodes. */
  function mount(el, ...children) {
    el.textContent = "";
    return append(el, children);
  }

  /** Event delegation: on(root, "click", ".btn", (e, target) => {}) */
  function on(root, type, selector, handler, opts) {
    root.addEventListener(type, (e) => {
      const target = e.target.closest ? e.target.closest(selector) : null;
      if (target && root.contains(target)) handler(e, target);
    }, opts);
  }

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const stripHtml = (s) => {
    const d = document.createElement("div");
    d.innerHTML = s ?? "";
    return d.textContent || "";
  };

  /** Move the caret to the end of a contenteditable / input. */
  function caretToEnd(el) {
    el.focus();
    if (el.isContentEditable) {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    } else if (el.setSelectionRange) {
      const n = el.value.length;
      el.setSelectionRange(n, n);
    }
  }

  /* ----------------------------------------------------------- Functions */

  function debounce(fn, ms = 200) {
    let t;
    const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    d.flush = (...a) => { clearTimeout(t); fn(...a); };
    d.cancel = () => clearTimeout(t);
    return d;
  }

  function throttle(fn, ms = 100) {
    let last = 0, timer;
    return (...a) => {
      const now = Date.now();
      if (now - last >= ms) { last = now; fn(...a); }
      else { clearTimeout(timer); timer = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (now - last)); }
    };
  }

  /* ------------------------------------------------------------- Values */

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const clone = (o) => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

  const uid = (prefix = "id") =>
    prefix + "_" + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 8);

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;

  function initials(name = "") {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }

  const COLORS = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"];
  const AVATAR_COLORS = ["blue", "purple", "pink", "teal", "green", "orange"];

  /** Stable color name for any string (used for avatars and auto-colored tags). */
  function colorFor(str = "", palette = AVATAR_COLORS) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return palette[hash % palette.length];
  }

  function groupBy(arr, keyFn) {
    const map = new Map();
    for (const item of arr) {
      const k = keyFn(item);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    }
    return map;
  }

  const uniq = (arr) => Array.from(new Set(arr));

  /** Move an item inside an array (returns a new array). */
  function arrMove(arr, from, to) {
    const copy = arr.slice();
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    return copy;
  }

  /** Natural, case-insensitive compare with empty values last. */
  function compare(a, b) {
    const ea = a == null || a === "", eb = b == null || b === "";
    if (ea && eb) return 0;
    if (ea) return 1;
    if (eb) return -1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  }

  /**
   * Fuzzy match for the command palette. Returns a score (higher is better)
   * or -1 when the query does not match.
   */
  function fuzzy(query, text) {
    const q = query.toLowerCase().trim();
    const t = String(text).toLowerCase();
    if (!q) return 0;
    const idx = t.indexOf(q);
    if (idx !== -1) return 100 - idx + (idx === 0 ? 20 : 0) - Math.min(t.length - q.length, 40) * 0.2;
    let qi = 0, score = 0, last = -2;
    for (let i = 0; i < t.length && qi < q.length; i++) {
      if (t[i] === q[qi]) { score += i === last + 1 ? 3 : 1; last = i; qi++; }
    }
    return qi === q.length ? score : -1;
  }

  /* -------------------------------------------------------------- Dates */

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const pad = (n) => String(n).padStart(2, "0");
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  /** "2026-10-09" -> local Date at midnight. */
  function parseDate(iso) {
    if (!iso) return null;
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  const today = () => toISO(new Date());

  function addDays(iso, n) {
    const d = parseDate(iso);
    d.setDate(d.getDate() + n);
    return toISO(d);
  }

  /** Whole days from a to b (b - a). */
  function diffDays(a, b) {
    const ms = parseDate(b) - parseDate(a);
    return Math.round(ms / 86400000);
  }

  function addMonths(iso, n) {
    const d = parseDate(iso);
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    return toISO(d);
  }

  const isWeekend = (iso) => [0, 6].includes(parseDate(iso).getDay());

  /** "Oct 9", or "Oct 9, 2027" when not in the current year. */
  function fmtDate(iso) {
    if (!iso) return "";
    const d = parseDate(iso);
    const base = `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
    return d.getFullYear() === new Date().getFullYear() ? base : `${base}, ${d.getFullYear()}`;
  }

  function fmtDateLong(iso) {
    if (!iso) return "";
    const d = parseDate(iso);
    return `${DOW[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }

  /** Friendly due label plus a state class: overdue | today | soon | "". */
  function dueInfo(iso, done) {
    if (!iso) return { text: "", cls: "" };
    const diff = diffDays(today(), iso);
    if (done) return { text: fmtDate(iso), cls: "" };
    if (diff < 0) return { text: diff === -1 ? "Yesterday" : fmtDate(iso), cls: "overdue" };
    if (diff === 0) return { text: "Today", cls: "today" };
    if (diff === 1) return { text: "Tomorrow", cls: "soon" };
    if (diff < 7) return { text: DOW[parseDate(iso).getDay()], cls: "soon" };
    return { text: fmtDate(iso), cls: "" };
  }

  /**
   * 42 ISO dates (6 weeks) covering the month that contains `iso`,
   * starting on `weekStart` (0 = Sunday, 1 = Monday).
   */
  function monthGrid(iso, weekStart = 0) {
    const first = parseDate(iso);
    first.setDate(1);
    const offset = (first.getDay() - weekStart + 7) % 7;
    first.setDate(first.getDate() - offset);
    const start = toISO(first);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }

  const monthLabel = (iso) => {
    const d = parseDate(iso);
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  };

  function timeAgo(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const hr = Math.round(m / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.round(hr / 24);
    if (d < 7) return `${d}d ago`;
    return fmtDate(toISO(new Date(ts)));
  }

  function greeting() {
    const hr = new Date().getHours();
    return hr < 5 ? "Working late" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
  }

  /* -------------------------------------------------------------- Files */

  function download(filename, text, mime = "application/json") {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = h("a", { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const readFile = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });

  /** Open a file picker and resolve with the chosen file's text (or null). */
  function pickFile(accept = ".json") {
    return new Promise((resolve) => {
      const input = h("input", { type: "file", accept, hidden: true });
      input.addEventListener("change", async () => {
        const f = input.files && input.files[0];
        input.remove();
        resolve(f ? { name: f.name, text: await readFile(f) } : null);
      });
      document.body.append(input);
      input.click();
    });
  }

  const csvCell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  /* ---------------------------------------------------------- Event bus */

  const listeners = new Map();
  const bus = {
    on(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, new Set());
      listeners.get(evt).add(fn);
      return () => bus.off(evt, fn);
    },
    off(evt, fn) { listeners.get(evt)?.delete(fn); },
    emit(evt, data) {
      listeners.get(evt)?.forEach((fn) => {
        try { fn(data); } catch (err) { console.error(`[bus:${evt}]`, err); }
      });
    },
  };

  /* ------------------------------------------------------------- Export */

  Plot.u = {
    $, $$, h, append, mount, on, esc, stripHtml, caretToEnd,
    debounce, throttle,
    clamp, clone, uid, plural, initials, colorFor, groupBy, uniq, arrMove, compare, fuzzy,
    COLORS, MONTHS, DOW,
    toISO, parseDate, today, addDays, addMonths, diffDays, isWeekend,
    fmtDate, fmtDateLong, dueInfo, monthGrid, monthLabel, timeAgo, greeting,
    download, readFile, pickFile, csvCell,
  };
  Plot.bus = bus;
})();
