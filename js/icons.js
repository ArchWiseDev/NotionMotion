/* ==========================================================================
   Plotline · icons.js
   A small hand-drawn stroke icon set (24x24 grid) plus the code that swaps
   every <i data-icon="name"></i> placeholder for a real inline <svg>.

     Plot.icons.svg("plus", "extra-class")  -> SVG markup string
     Plot.icons.el("plus")                  -> SVG element
     Plot.icons.hydrate(root)               -> replace placeholders under root

   Placeholders added later (for example inside innerHTML strings) are picked
   up automatically by a MutationObserver. Classes on the <i> are kept on the
   <svg>, so `<i data-icon="x" class="ws-caret">` styles exactly as before.
   ========================================================================== */
(function () {
  "use strict";

  const Plot = (window.Plot = window.Plot || {});

  // Tiny builders so the table below stays readable.
  const P = (d, extra = "") => `<path d="${d}"${extra ? " " + extra : ""}/>`;
  const C = (cx, cy, r, extra = "") => `<circle cx="${cx}" cy="${cy}" r="${r}"${extra ? " " + extra : ""}/>`;
  const R = (x, y, w, h, rx = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
  const FILL = 'fill="currentColor"';

  // name -> inner SVG markup. A leading "!" entry in OPTS below adds stroke width tweaks.
  const ICONS = {
    /* Brand */
    logo: P("M4 17l5-6 4 3 7-9"),

    /* Navigation + chrome */
    home: P("M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"),
    "check-circle": C(12, 12, 9) + P("M8 12.5l3 3 5-6"),
    chart: P("M5 20v-9M12 20V4M19 20v-6M3 20h18"),
    calendar: R(3, 5, 18, 16, 3) + P("M3 10h18M8 3v4M16 3v4"),
    "panel-left": R(3, 4, 18, 16, 3) + P("M9 4v16"),
    menu: P("M4 7h16M4 12h16M4 17h16"),
    search: C(11, 11, 7) + P("M20 20l-3.5-3.5"),
    settings: P("M4 7h9M19 7h1M4 17h1M11 17h9") + C(16, 7, 2.2) + C(8, 17, 2.2),
    template: R(3, 3, 18, 18, 3) + P("M3 9h18M9 9v12"),
    moon: P("M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"),
    sun: C(12, 12, 4) + P("M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"),
    bell: P("M6 16v-5a6 6 0 0112 0v5l2 2H4zM10 21h4"),

    /* Arrows + chevrons */
    "chevron-down": P("M6 9l6 6 6-6"),
    "chevron-up": P("M6 15l6-6 6 6"),
    "chevron-right": P("M9 6l6 6-6 6"),
    "chevron-left": P("M15 6l-6 6 6 6"),
    "arrow-right": P("M5 12h14M13 6l6 6-6 6"),
    "arrow-left": P("M19 12H5M11 6l-6 6 6 6"),
    "arrow-up-right": P("M7 17L17 7M8 7h9v9"),
    undo: P("M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3"),
    redo: P("M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3"),
    repeat: P("M4 11V9a3 3 0 013-3h12M16 3l3 3-3 3M20 13v2a3 3 0 01-3 3H5M8 21l-3-3 3-3"),
    expand: P("M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"),
    collapse: P("M20 10h-6V4M4 14h6v6M14 10l7-7M3 21l7-7"),

    /* Actions */
    plus: P("M12 5v14M5 12h14"),
    x: P("M6 6l12 12M18 6L6 18"),
    check: P("M5 12.5l4.5 4.5L19 7.5"),
    more: P("M5 12h.01M12 12h.01M19 12h.01", 'style="stroke-width:3"'),
    "more-v": P("M12 5h.01M12 12h.01M12 19h.01", 'style="stroke-width:3"'),
    grip: P("M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01", 'style="stroke-width:3"'),
    trash: P("M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"),
    copy: R(8, 8, 12, 12, 2) + P("M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"),
    edit: P("M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"),
    download: P("M12 4v11M7 11l5 5 5-5M5 20h14"),
    upload: P("M12 16V5M7 9l5-5 5 5M5 20h14"),
    archive: R(3, 4, 18, 4, 1) + P("M5 8v11h14V8M10 12h4"),
    send: P("M4 12l16-8-6 16-3-7z"),
    link: P("M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"),
    paperclip: P("M20 11l-8.5 8.5a5 5 0 01-7-7L13 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L14 7"),
    eye: P("M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z") + C(12, 12, 3),
    star: P("M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"),
    "star-fill": P("M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z", FILL),

    /* Views */
    table: R(3, 4, 18, 16, 2) + P("M3 10h18M3 15h18M9 10v10"),
    board: R(3, 4, 5, 16, 1.5) + R(10, 4, 5, 10, 1.5) + R(17, 4, 4, 13, 1.5),
    list: P("M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01", 'style="stroke-width:2.4"'),
    timeline: R(3, 5, 9, 3.2, 1.5) + R(8, 10.4, 12, 3.2, 1.5) + R(5, 15.8, 8, 3.2, 1.5),
    grid: R(4, 4, 7, 7, 1.5) + R(13, 4, 7, 7, 1.5) + R(4, 13, 7, 7, 1.5) + R(13, 13, 7, 7, 1.5),
    layers: P("M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"),

    /* Toolbar */
    filter: P("M4 5h16l-6 8v6l-4-2v-4z"),
    sort: P("M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"),
    group: R(3, 4, 18, 6, 2) + R(3, 14, 18, 6, 2),

    /* Task properties */
    flag: P("M5 21V4M5 4h11l-2 4 2 4H5"),
    user: C(12, 8, 4) + P("M4 20c0-4 4-6 8-6s8 2 8 6"),
    users: C(9, 8, 3.5) + P("M2.5 19c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 4.7a3.5 3.5 0 010 6.6M18 14c2.2.6 3.5 2.4 3.5 5"),
    tag: P("M3 12V4h8l10 10-8 8z") + P("M7.5 8.5h.01", 'style="stroke-width:3"'),
    clock: C(12, 12, 9) + P("M12 7v5l3 2"),
    comment: P("M4 5h16v11H9l-5 4z"),
    subtask: P("M6 4v8a3 3 0 003 3h9M14 11l4 4-4 4"),
    circle: C(12, 12, 9),
    "circle-half": C(12, 12, 9) + P("M12 3a9 9 0 010 18z", FILL),
    target: C(12, 12, 9) + C(12, 12, 5) + C(12, 12, 1, FILL),
    alert: P("M12 3l10 17H2zM12 10v5M12 17.5h.01"),
    info: C(12, 12, 9) + P("M12 11v5M12 8h.01"),
    zap: P("M13 2L4 14h7l-1 8 9-12h-7z"),
    sparkles: P("M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"),

    /* Content */
    folder: P("M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"),
    doc: P("M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6"),

    /* Doc editor blocks */
    text: P("M5 6h14M12 6v13M9 19h6"),
    h1: P("M4 5v14M12 5v14M4 12h8M17 9l3-2v12"),
    h2: P("M4 5v14M12 5v14M4 12h8M16 10c0-2.4 4.5-2.4 4.5 0 0 2.2-4.5 4-4.5 8h4.5"),
    h3: P("M4 5v14M12 5v14M4 12h8M16 8h4l-2.5 3.5a2.5 2.5 0 11-2 4"),
    bullets: P("M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01", 'style="stroke-width:2.4"'),
    numbered: P("M10 6h10M10 12h10M10 18h10M4 4.5l1.5-1V9M3.5 14.5c0-1.5 3-1.5 3 0 0 1.2-3 2.2-3 3.5h3"),
    todo: R(4, 4, 16, 16, 4) + P("M8.5 12.5l2.5 2.5 4.5-5"),
    quote: P("M9 7a4 4 0 00-4 4v6h5v-5H7a2 2 0 012-2zM19 7a4 4 0 00-4 4v6h5v-5h-3a2 2 0 012-2z"),
    code: P("M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"),
    divider: P("M3 12h18M8 7h8M8 17h8"),
  };

  // Icons that read better with a heavier or lighter stroke.
  const WEIGHT = { logo: 2.6, check: 2.4, plus: 2, x: 2 };

  const cache = new Map();

  function svg(name, cls = "") {
    const inner = ICONS[name];
    if (!inner) {
      if (window.console) console.warn(`[icons] unknown icon "${name}"`);
      return "";
    }
    const w = WEIGHT[name] ? ` style="stroke-width:${WEIGHT[name]}"` : "";
    return (
      `<svg class="i${cls ? " " + cls : ""}" viewBox="0 0 24 24" width="16" height="16" ` +
      `fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ` +
      `stroke-linejoin="round" aria-hidden="true" focusable="false"${w}>${inner}</svg>`
    );
  }

  function el(name, cls = "") {
    const key = name + "|" + cls;
    if (!cache.has(key)) {
      const t = document.createElement("template");
      t.innerHTML = svg(name, cls);
      cache.set(key, t.content.firstElementChild);
    }
    const node = cache.get(key);
    return node ? node.cloneNode(true) : document.createTextNode("");
  }

  function hydrate(root = document) {
    const list = root.querySelectorAll ? root.querySelectorAll("i[data-icon]") : [];
    list.forEach((node) => {
      const extra = (node.getAttribute("class") || "").trim();
      const icon = el(node.dataset.icon, extra);
      const label = node.getAttribute("aria-label");
      if (label && icon.setAttribute) {
        icon.setAttribute("role", "img");
        icon.setAttribute("aria-label", label);
        icon.removeAttribute("aria-hidden");
      }
      node.replaceWith(icon);
    });
  }

  // Watch for placeholders inserted after load (views, menus, modals...).
  let queued = false;
  function watch() {
    new MutationObserver((records) => {
      if (queued) return;
      if (!records.some((r) => r.addedNodes.length)) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; hydrate(document.body); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  Plot.icons = { svg, el, hydrate, has: (n) => n in ICONS, names: Object.keys(ICONS) };

  hydrate(document);
  watch();
})();
