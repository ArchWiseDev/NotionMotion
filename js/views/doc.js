/* ==========================================================================
   Plotline · views/doc.js
   A small block editor for notes, briefs and meeting minutes.

   Blocks: text, heading 1-3, bulleted, numbered, to-do, quote, callout, code,
   divider.

   Ways to work
     /              on an empty line opens the block menu (type to filter)
     # ## ### - 1.  markdown shortcuts: type the prefix and a space
     [] > ```       to-do, quote, code
     ---  + Enter   divider
     Enter          new block (list and to-do items continue the list)
     Backspace      at the start of a block: turn it into text, then merge up
     Alt + Up/Down  move the current block
     grip handle    drag to reorder, click for Turn into / Duplicate / Delete
     paste          multi-line text becomes one block per line, markdown aware

   Rendering rule: this view keeps its own copy of the doc while you type and
   only rebuilds when the stored doc differs from that copy and you have no
   unsaved edits, so the caret never jumps.
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

  // "plaintext-only" gives clean text and real newlines where the browser supports it.
  const EDIT = (() => {
    const d = document.createElement("div");
    try { d.contentEditable = "plaintext-only"; } catch (_) { /* older browsers */ }
    return d.contentEditable === "plaintext-only" ? "plaintext-only" : "true";
  })();

  const TYPES = [
    { type: "p", label: "Text", icon: "text", keys: "paragraph plain text" },
    { type: "h1", label: "Heading 1", icon: "h1", hint: "#", keys: "title large h1" },
    { type: "h2", label: "Heading 2", icon: "h2", hint: "##", keys: "subtitle h2" },
    { type: "h3", label: "Heading 3", icon: "h3", hint: "###", keys: "small heading h3" },
    { type: "bullet", label: "Bulleted list", icon: "bullets", hint: "-", keys: "list ul unordered" },
    { type: "numbered", label: "Numbered list", icon: "numbered", hint: "1.", keys: "list ol ordered" },
    { type: "todo", label: "To-do list", icon: "todo", hint: "[]", keys: "checkbox task checklist" },
    { type: "quote", label: "Quote", icon: "quote", hint: ">", keys: "blockquote citation" },
    { type: "callout", label: "Callout", icon: "info", keys: "note tip highlight info" },
    { type: "code", label: "Code", icon: "code", hint: "```", keys: "snippet pre" },
    { type: "divider", label: "Divider", icon: "divider", hint: "---", keys: "line rule separator hr" },
  ];

  const PLACEHOLDER = {
    p: "Type “/” for blocks", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", bullet: "List item",
    numbered: "List item", todo: "To-do", quote: "Quote", callout: "Callout", code: "Code",
  };

  const MD_PREFIX = { "#": "h1", "##": "h2", "###": "h3", "-": "bullet", "*": "bullet", "[]": "todo", ">": "quote", "```": "code" };

  let inst = null;           // the editor currently on screen
  let swallowGrip = false;

  /* -------------------------------------------------------------- Helpers */

  const sigOf = (d) => JSON.stringify([d.title || "", d.emoji || "", d.blocks || []]);

  /** Visible text of a block, normalised. */
  function readText(el) {
    const t = el.innerText.replace(/\u00a0/g, " ");
    return t === "\n" ? "" : t.replace(/\n$/, "");
  }

  function caretOffset(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return 0;
    const r = sel.getRangeAt(0);
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(r.endContainer, r.endOffset);
    return pre.toString().length;
  }

  function applyRange(range) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function setCaret(el, offset) {
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let remaining = offset, node, last = null;
    while ((node = walker.nextNode())) {
      last = node;
      if (remaining <= node.length) { range.setStart(node, remaining); range.collapse(true); return applyRange(range); }
      remaining -= node.length;
    }
    if (last) { range.setStart(last, last.length); range.collapse(true); }
    else { range.selectNodeContents(el); range.collapse(false); }
    applyRange(range);
  }

  function splitAtCaret(el) {
    const sel = window.getSelection();
    if (sel.rangeCount && !sel.isCollapsed) document.execCommand("delete");
    const text = readText(el);
    const off = Math.min(caretOffset(el), text.length);
    return [text.slice(0, off), text.slice(off)];
  }

  function parseLine(line) {
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) return { type: "h" + m[1].length, text: m[2] };
    if ((m = /^[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line))) return { type: "todo", text: m[2], checked: m[1].toLowerCase() === "x" };
    if ((m = /^[-*•]\s+(.*)$/.exec(line))) return { type: "bullet", text: m[1] };
    if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) return { type: "numbered", text: m[1] };
    if ((m = /^>\s?(.*)$/.exec(line))) return { type: "quote", text: m[1] };
    return { type: "p", text: line };
  }

  const newBlock = (type = "p", text = "", extra = {}) =>
    ({ id: u.uid("b"), type, text, ...(type === "todo" ? { checked: false } : {}), ...extra });

  /* ---------------------------------------------------------------- Render */

  function render(root, { doc }) {
    if (!doc) {
      inst = null;
      u.mount(root, h("div.view-inner", ui().emptyState({
        emoji: "🫥", title: "Doc not found", text: "It may have been deleted.",
        action: { label: "Go home", onClick: () => { location.hash = "#/home"; } },
      })));
      return;
    }
    if (inst && inst.docId === doc.id && root.contains(inst.el) && (inst.dirty || inst.sig === sigOf(doc))) return;

    const sameDoc = inst && inst.docId === doc.id;
    const prevScroll = root.scrollTop;
    closeSlash();

    const s = {
      docId: doc.id, title: doc.title || "", emoji: doc.emoji || "📄",
      blocks: u.clone(doc.blocks && doc.blocks.length ? doc.blocks : [newBlock()]),
      dirty: false, sig: sigOf(doc), el: null, list: null, save: null,
    };
    s.save = u.debounce(() => flush(s), 350);
    inst = s;

    const titleEl = h("div.doc-title", { contenteditable: EDIT, role: "textbox", "aria-label": "Doc title", "data-placeholder": "Untitled" });
    titleEl.textContent = s.title;
    titleEl.addEventListener("input", () => { s.title = readText(titleEl); markDirty(s); });
    titleEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); focusBlock(s, 0, "start"); }
    });

    const iconBtn = h("button.doc-icon", {
      type: "button", "aria-label": "Change icon",
      onclick: (e) => ui().pickEmoji(e.currentTarget, (em) => { s.emoji = em; iconBtn.textContent = em; markDirty(s); s.save.flush(); }),
    }, s.emoji);

    s.list = h("div.blocks", { role: "list" }, s.blocks.map((b) => blockEl(s, b)));
    renumber(s);

    const tail = h("div.doc-tail", { style: { height: "160px", cursor: "text" }, dataset: { act: "tail" } });
    const top = h("div.doc-top",
      h("span", "Edited " + u.timeAgo(doc.updatedAt || Date.now())),
      h("button.icon-btn", { type: "button", "aria-label": "Doc options", onclick: (e) => docMenu(e.currentTarget, s) }, icon("more")));

    s.el = h("div.doc", { dataset: { docId: doc.id } }, top, iconBtn, titleEl, s.list, tail,
      h("p.slash-hint", "Type / for blocks · Alt + ↑ ↓ moves a block · drag the grip to reorder"));

    bindEditor(s);
    u.mount(root, h("div.view-inner", s.el));
    root.scrollTop = sameDoc ? prevScroll : 0;

    if (!sameDoc && !s.title && s.blocks.length === 1 && !s.blocks[0].text) titleEl.focus();
  }

  /* ----------------------------------------------------------------- Saving */

  function markDirty(s) { s.dirty = true; s.save(); }

  function flush(s) {
    if (!s.dirty) return;
    s.dirty = false;
    const patch = { title: s.title, emoji: s.emoji, blocks: u.clone(s.blocks) };
    s.sig = sigOf(patch);
    store().updateDoc(s.docId, patch, { coalesce: "doc-" + s.docId });
  }

  window.addEventListener("beforeunload", () => { if (inst) flush(inst); });

  /* ------------------------------------------------------------ Block DOM */

  function blockEl(s, b) {
    const divider = b.type === "divider";
    const content = divider
      ? h("div.block-content", { role: "separator" }, h("hr"))
      : h("div.block-content" + (b.type === "todo" && b.checked ? ".todo-done" : ""), {
          contenteditable: EDIT, spellcheck: b.type === "code" ? "false" : "true", role: "textbox",
          "aria-multiline": String(b.type === "code"), "aria-label": (TYPES.find((t) => t.type === b.type) || TYPES[0]).label,
          "data-placeholder": PLACEHOLDER[b.type] || "",
        });
    if (!divider) content.textContent = b.text || "";

    let marker = null;
    if (b.type === "bullet") marker = h("span.marker.bullet", { "aria-hidden": "true" });
    else if (b.type === "numbered") marker = h("span.marker", { "aria-hidden": "true" }, "1.");
    else if (b.type === "todo") {
      marker = h("span.marker", h("button.check.square" + (b.checked ? ".done" : ""), {
        type: "button", role: "checkbox", "aria-checked": String(!!b.checked), "aria-label": "Mark to-do as done", dataset: { act: "todo" },
      }, icon("check")));
    }

    const handle = h("div.block-handle",
      h("button", { type: "button", "aria-label": "Add block below", title: "Add block below", dataset: { act: "add" } }, icon("plus")),
      h("button", { type: "button", "aria-label": "Drag to move, click for options", title: "Drag to move\nClick for options", dataset: { act: "grip" } }, icon("grip")));

    return h("div.block", { role: "listitem", dataset: { id: b.id, type: b.type } }, handle, marker, content);
  }

  function renumber(s) {
    let n = 0;
    Array.from(s.list.children).forEach((el, i) => {
      if (s.blocks[i] && s.blocks[i].type === "numbered") {
        n++;
        const m = el.querySelector(".marker");
        if (m) m.textContent = n + ".";
      } else n = 0;
    });
  }

  const indexOf = (s, el) => s.blocks.findIndex((b) => b.id === el.closest(".block").dataset.id);
  const contentOf = (s, i) => (s.list.children[i] ? s.list.children[i].querySelector(".block-content") : null);

  function focusBlock(s, i, where = "end") {
    const c = contentOf(s, i);
    if (!c || !c.isContentEditable) return;
    c.focus();
    setCaret(c, where === "start" ? 0 : where === "end" ? Infinity : where);
    c.scrollIntoView({ block: "nearest" });
  }

  function neighbor(s, i, dir) {
    for (let k = i + dir; k >= 0 && k < s.blocks.length; k += dir) if (s.blocks[k].type !== "divider") return k;
    return -1;
  }

  /* ------------------------------------------------------------ Mutations */

  function insertBlock(s, index, data, focusAt = "start") {
    s.blocks.splice(index, 0, data);
    s.list.insertBefore(blockEl(s, data), s.list.children[index] || null);
    renumber(s);
    markDirty(s);
    if (focusAt !== null) focusBlock(s, index, focusAt);
  }

  function removeBlock(s, i) {
    s.blocks.splice(i, 1);
    s.list.children[i].remove();
    if (!s.blocks.length) insertBlock(s, 0, newBlock(), null);
    renumber(s);
    markDirty(s);
  }

  function setType(s, i, type, text) {
    const b = s.blocks[i];
    b.type = type;
    if (text !== undefined) b.text = text;
    if (type === "divider") b.text = "";
    if (type === "todo") b.checked = !!b.checked; else delete b.checked;
    s.list.children[i].replaceWith(blockEl(s, b));
    renumber(s);
    markDirty(s);
    if (type === "divider") {
      const nextIsText = s.blocks[i + 1] && s.blocks[i + 1].type !== "divider";
      if (!nextIsText) insertBlock(s, i + 1, newBlock(), "start");
      else focusBlock(s, i + 1, "start");
    } else focusBlock(s, i, "end");
  }

  function moveBlock(s, from, to) {
    if (to < 0 || to >= s.blocks.length || from === to) return;
    s.blocks = u.arrMove(s.blocks, from, to);
    const el = s.list.children[from];
    el.remove();
    s.list.insertBefore(el, s.list.children[to] || null);
    renumber(s);
    markDirty(s);
  }

  function mergeInto(s, i, joinAt) {          // merge block i+1 into block i
    const a = s.blocks[i], b = s.blocks[i + 1];
    a.text = (a.text || "") + (b.text || "");
    contentOf(s, i).textContent = a.text;
    removeBlock(s, i + 1);
    focusBlock(s, i, joinAt);
  }

  /* ------------------------------------------------------------ Keyboard */

  function onKeydown(s, e) {
    const el = e.target.closest(".block-content");
    if (!el || !el.isContentEditable) return;
    const i = indexOf(s, el);
    const b = s.blocks[i];
    const collapsed = window.getSelection().isCollapsed;

    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const off = caretOffset(el);
      const to = i + (e.key === "ArrowUp" ? -1 : 1);
      moveBlock(s, i, to);
      focusBlock(s, Math.max(0, Math.min(to, s.blocks.length - 1)), off);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (b.type === "code") {
        if (e.ctrlKey || e.metaKey) insertBlock(s, i + 1, newBlock(), "start");
        else document.execCommand("insertText", false, "\n");
        return;
      }
      const text = readText(el);
      if (b.type === "p" && /^(---|\*\*\*|___)$/.test(text.trim())) { setType(s, i, "divider"); return; }
      if (!text && b.type !== "p") { setType(s, i, "p", ""); return; }
      const [before, after] = splitAtCaret(el);
      b.text = before;
      el.textContent = before;
      const next = ["bullet", "numbered", "todo"].includes(b.type) ? b.type : "p";
      insertBlock(s, i + 1, newBlock(next, after), 0);
      return;
    }

    if (e.key === "Backspace" && collapsed && caretOffset(el) === 0) {
      e.preventDefault();
      if (b.type !== "p") { setType(s, i, "p"); focusBlock(s, i, 0); return; }
      if (i === 0) return;
      const prev = s.blocks[i - 1];
      if (prev.type === "divider") { removeBlock(s, i - 1); focusBlock(s, i - 1, 0); return; }
      mergeInto(s, i - 1, (prev.text || "").length);
      return;
    }

    if (e.key === "Delete" && collapsed && caretOffset(el) >= readText(el).length) {
      const nxt = s.blocks[i + 1];
      if (nxt && nxt.type !== "divider") { e.preventDefault(); mergeInto(s, i, readText(el).length); }
      return;
    }

    if (e.key === "ArrowUp" && collapsed && caretOffset(el) === 0) {
      const k = neighbor(s, i, -1);
      if (k >= 0) { e.preventDefault(); focusBlock(s, k, "end"); }
    } else if (e.key === "ArrowDown" && collapsed && caretOffset(el) >= readText(el).length) {
      const k = neighbor(s, i, 1);
      if (k >= 0) { e.preventDefault(); focusBlock(s, k, "start"); }
    }
  }

  /* ---------------------------------------------------------------- Input */

  function onInput(s, e) {
    const el = e.target.closest(".block-content");
    if (!el || !el.isContentEditable) return;
    const i = indexOf(s, el);
    const b = s.blocks[i];
    b.text = readText(el);
    markDirty(s);

    // Markdown shortcuts: "# ", "- ", "1. ", "[] ", "> ", "``` "
    if (b.type === "p") {
      const m = /^(#{1,3}|[-*]|\d+\.|\[\]|>|```)\s$/.exec(b.text);
      if (m) {
        closeSlash();
        setType(s, i, /^\d+\.$/.test(m[1]) ? "numbered" : MD_PREFIX[m[1]], "");
        return;
      }
    }

    // Slash menu
    const sm = b.type !== "code" ? /^\/([\w ]{0,20})$/.exec(b.text) : null;
    if (sm) openSlash(s, b.id, el, sm[1]); else closeSlash();
  }

  function onPaste(s, e) {
    const el = e.target.closest(".block-content");
    if (!el || !el.isContentEditable) return;
    e.preventDefault();
    const i = indexOf(s, el);
    const text = (e.clipboardData || window.clipboardData).getData("text/plain").replace(/\r\n?/g, "\n");
    const lines = text.split("\n");
    if (lines.length === 1 || s.blocks[i].type === "code") { document.execCommand("insertText", false, text); return; }

    document.execCommand("insertText", false, lines[0]);
    s.blocks[i].text = readText(el);
    const rest = lines.slice(1).filter((l) => l.trim()).map(parseLine);
    rest.forEach((p, k) => insertBlock(s, i + 1 + k, newBlock(p.type, p.text, p.type === "todo" ? { checked: !!p.checked } : {}), null));
    if (rest.length) focusBlock(s, i + rest.length, "end");
  }

  /* ----------------------------------------------------------- Slash menu */

  let slash = null;

  function closeSlash() {
    if (slash && slash.layer && slash.layer.el.isConnected) slash.layer.close(false);
    slash = null;
  }

  function openSlash(s, blockId, anchor, query) {
    const q = query.trim().toLowerCase();
    const list = TYPES.filter((t) => !q || (t.label + " " + t.keys).toLowerCase().includes(q));
    if (!list.length) { closeSlash(); return; }

    const keepActive = slash && slash.query === q ? slash.active : 0;
    closeSlash();

    const els = list.map((t, k) => h("button.menu-item" + (k === keepActive ? ".focus" : ""), {
      type: "button", role: "option",
      onmousedown: (e) => e.preventDefault(),            // keep the caret in the block
      onclick: () => pick(t.type),
      onmouseenter: () => setActive(k),
    }, icon(t.icon), h("span.menu-text", t.label), t.hint ? h("span.menu-hint", t.hint) : null));

    const layer = ui().popover(anchor, [h("div.menu-label", "Blocks"), ...els], { width: 260, role: "listbox" });
    if (!layer) return;
    slash = { layer, els, active: keepActive, query: q, list, blockId };

    function setActive(k) {
      if (!slash) return;
      slash.active = (k + els.length) % els.length;
      els.forEach((el, n) => el.classList.toggle("focus", n === slash.active));
      els[slash.active].scrollIntoView({ block: "nearest" });
    }

    function pick(type) {
      const i = s.blocks.findIndex((b) => b.id === blockId);
      closeSlash();
      if (i < 0) return;
      const c = contentOf(s, i);
      if (c) c.textContent = "";
      s.blocks[i].text = "";
      if (type === "p" && s.blocks[i].type === "p") { markDirty(s); focusBlock(s, i, 0); }
      else setType(s, i, type, "");
    }

    layer.onKey = (e) => {
      if (!slash) return;
      if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setActive(slash.active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); setActive(slash.active - 1); }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); pick(list[slash.active].type); }
    };
  }

  /* -------------------------------------------------------- Menus + export */

  function blockMenu(anchor, s, id) {
    const at = () => s.blocks.findIndex((b) => b.id === id);
    if (at() < 0) return;
    const cur = s.blocks[at()].type;
    ui().menu(anchor, [
      { heading: "Turn into" },
      ...TYPES.filter((t) => t.type !== "divider").map((t) => ({
        label: t.label, icon: t.icon, selected: cur === t.type,
        onClick: () => setType(s, at(), t.type),
      })),
      { sep: true },
      { label: "Duplicate", icon: "copy", onClick: () => insertBlock(s, at() + 1, { ...u.clone(s.blocks[at()]), id: u.uid("b") }, null) },
      { label: "Delete", icon: "trash", danger: true, onClick: () => removeBlock(s, at()) },
    ]);
  }

  function toMarkdown(s) {
    let n = 0;
    const parts = s.blocks.map((b) => {
      n = b.type === "numbered" ? n + 1 : 0;
      const t = b.text || "";
      switch (b.type) {
        case "h1": return "# " + t;
        case "h2": return "## " + t;
        case "h3": return "### " + t;
        case "bullet": return "- " + t;
        case "numbered": return `${n}. ${t}`;
        case "todo": return `- [${b.checked ? "x" : " "}] ${t}`;
        case "quote": return "> " + t;
        case "callout": return "> 💡 " + t;
        case "code": return "```\n" + t + "\n```";
        case "divider": return "---";
        default: return t;
      }
    });
    const isList = (b) => ["bullet", "numbered", "todo"].includes(b.type);
    let out = `# ${s.title || "Untitled"}\n\n`;
    parts.forEach((p, i) => {
      out += p;
      if (i < parts.length - 1) out += isList(s.blocks[i]) && s.blocks[i + 1].type === s.blocks[i].type ? "\n" : "\n\n";
    });
    return out + "\n";
  }

  function docMenu(anchor, s) {
    const st = store();
    ui().menu(anchor, [
      { label: "Export as Markdown", icon: "download", onClick: () => {
          flush(s);
          const name = (s.title || "Untitled").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "doc";
          u.download(name + ".md", toMarkdown(s), "text/markdown");
      } },
      { label: "Duplicate doc", icon: "copy", onClick: () => {
          flush(s);
          const copy = st.addDoc({ title: (s.title || "Untitled") + " (copy)", emoji: s.emoji, blocks: u.clone(s.blocks).map((b) => ({ ...b, id: u.uid("b") })) });
          location.hash = "#/doc/" + copy.id;
      } },
      { sep: true },
      { label: "Delete doc", icon: "trash", danger: true, onClick: async () => {
          const ok = await ui().confirm({ title: "Delete this doc?", message: "You can undo this right after.", confirmLabel: "Delete", danger: true });
          if (!ok) return;
          s.dirty = false;
          const id = s.docId;
          st.deleteDoc(id);
          location.hash = "#/home";
          ui().toast("Doc deleted", { action: { label: "Undo", onClick: () => { st.undo(); location.hash = "#/doc/" + id; } } });
      } },
    ], { align: "right" });
  }

  /* ------------------------------------------------------------- Bindings */

  function bindEditor(s) {
    const list = s.list;
    list.addEventListener("keydown", (e) => onKeydown(s, e));
    list.addEventListener("input", (e) => onInput(s, e));
    list.addEventListener("paste", (e) => onPaste(s, e));
    list.addEventListener("focusout", () => { s.save.flush(); });

    s.el.addEventListener("click", (e) => {
      const a = e.target.closest("[data-act]");
      if (!a) return;
      const blockNode = a.closest(".block");
      const id = blockNode && blockNode.dataset.id;
      const i = id ? s.blocks.findIndex((b) => b.id === id) : -1;

      switch (a.dataset.act) {
        case "todo": {
          const b = s.blocks[i];
          b.checked = !b.checked;
          a.classList.toggle("done", b.checked);
          a.setAttribute("aria-checked", String(b.checked));
          contentOf(s, i).classList.toggle("todo-done", b.checked);
          markDirty(s);
          s.save.flush();
          break;
        }
        case "add": {
          insertBlock(s, i + 1, newBlock("p", "/"), null);
          const c = contentOf(s, i + 1);
          c.focus();
          setCaret(c, Infinity);
          openSlash(s, s.blocks[i + 1].id, c, "");
          break;
        }
        case "grip":
          if (swallowGrip) { swallowGrip = false; break; }
          blockMenu(a, s, id);
          break;
        case "tail": {
          const last = s.blocks[s.blocks.length - 1];
          if (last.type !== "p" || last.text) insertBlock(s, s.blocks.length, newBlock(), "start");
          else focusBlock(s, s.blocks.length - 1, "start");
          break;
        }
        default: break;
      }
    });

    bindDrag(s);
  }

  /* ------------------------------------------------------------ Drag to move */

  function bindDrag(s) {
    let pending = null, drag = null;

    s.el.addEventListener("pointerdown", (e) => {
      const grip = e.target.closest('[data-act="grip"]');
      if (!grip || (e.pointerType === "mouse" && e.button !== 0)) return;
      const blockNode = grip.closest(".block");
      pending = { x: e.clientX, y: e.clientY, blockNode, id: blockNode.dataset.id };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
    });

    function begin() {
      const r = pending.blockNode.getBoundingClientRect();
      const ghost = pending.blockNode.cloneNode(true);
      Object.assign(ghost.style, {
        position: "fixed", left: r.left + "px", top: r.top + "px", width: r.width + "px", margin: 0, opacity: 0.85,
        pointerEvents: "none", zIndex: 200, background: "var(--surface)", boxShadow: "var(--shadow-3)", borderRadius: "var(--r-md)",
      });
      document.body.append(ghost);
      pending.blockNode.classList.add("dragging");
      document.body.classList.add("is-dragging");
      drag = { ...pending, ghost, offY: pending.y - r.top, afterId: null };
    }

    function onMove(e) {
      if (!drag) {
        if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 4) begin(); else return;
      }
      drag.ghost.style.top = e.clientY - drag.offY + "px";
      const kids = Array.from(s.list.children).filter((k) => k !== drag.blockNode);
      s.list.querySelectorAll(".drag-over, .drag-top").forEach((k) => k.classList.remove("drag-over", "drag-top"));
      let after = null;
      kids.forEach((k) => { const r = k.getBoundingClientRect(); if (e.clientY > r.top + r.height / 2) after = k; });
      if (after) after.classList.add("drag-over"); else if (kids[0]) kids[0].classList.add("drag-top");
      drag.afterId = after ? after.dataset.id : null;
    }

    const onUp = () => finish(true);
    const onCancel = () => finish(false);

    function finish(commit) {
      const d = drag;
      cleanup();
      if (!d) return;
      swallowGrip = true;
      setTimeout(() => { swallowGrip = false; }, 0);
      if (!commit) return;
      const from = s.blocks.findIndex((b) => b.id === d.id);
      const afterIdx = d.afterId ? s.blocks.findIndex((b) => b.id === d.afterId) : -1;
      const to = afterIdx < from ? afterIdx + 1 : afterIdx;
      moveBlock(s, from, to);
    }

    function cleanup() {
      if (drag) { drag.ghost.remove(); drag.blockNode.classList.remove("dragging"); }
      s.list.querySelectorAll(".drag-over, .drag-top").forEach((k) => k.classList.remove("drag-over", "drag-top"));
      document.body.classList.remove("is-dragging");
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      drag = null;
      pending = null;
    }
  }

  /* --------------------------------------------------------------- Styles */

  document.head.append(h("style", { id: "doc-styles" }, `
    button.doc-icon { height: 68px; padding: 0 6px; border-radius: var(--r-md); background: none; cursor: pointer; font-size: 52px; line-height: 1; margin-bottom: var(--s-2); }
    button.doc-icon:hover { background: var(--hover); }
    .doc-top { display: flex; align-items: center; justify-content: flex-end; gap: var(--s-2); margin-bottom: var(--s-2); color: var(--ink-3); font-size: var(--fs-xs); }
    .doc-title, .block-content[contenteditable] { outline: none; }
    .block.dragging { opacity: 0.35; }
    .block.drag-top { box-shadow: 0 -2px 0 var(--accent); }
    .block .marker .check { margin-top: 2px; }
    .block-handle button svg { width: 15px; height: 15px; }
  `));

  Plot.views.doc = {
    wide: false,
    render,
    flush: () => { if (inst) flush(inst); },
  };
})();
