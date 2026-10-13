/* ==========================================================================
   Plotline · seed.js
   Two things live here:
     Plot.seed.demo()       a realistic starter workspace (3 projects, 3 docs)
                            used on first run and by Settings > Reset.
     Plot.seed.templates    the template gallery. Each template has
                            { id, name, emoji, description, build(store) }.
   All dates are offsets from today, so the demo always looks current:
   -3 = three days ago, 0 = today, 5 = in five days.
   ========================================================================== */
(function () {
  "use strict";

  const Plot = (window.Plot = window.Plot || {});
  const { uid, today, addDays } = Plot.u;
  const { DEFAULT_STATUSES, VIEW_TYPES } = Plot.consts;

  const DAY = 86400000;
  const D = (n) => (n == null ? null : addDays(today(), n));

  /* ------------------------------------------------------------- Builders */

  function makeViews() {
    return VIEW_TYPES.map((v) => ({
      id: uid("vw"),
      type: v.type,
      name: v.name,
      filters: [],
      sort: v.type === "table" || v.type === "list" ? { field: "order", dir: "asc" } : null,
      group: v.type === "list" ? "status" : "",
      collapsed: {},
    }));
  }

  function makeProject({ name, emoji, description, favorite, tags }) {
    return {
      id: uid("p"),
      name,
      emoji,
      description,
      favorite: !!favorite,
      createdAt: Date.now() - 30 * DAY,
      statuses: DEFAULT_STATUSES.map((s) => ({ id: uid("st"), ...s })),
      tags: (tags || []).map(([n, c]) => ({ id: uid("tg"), name: n, color: c })),
      views: makeViews(),
    };
  }

  /**
   * Task spec keys:
   *   t title · s status name · p priority · who member index · start/due day offsets
   *   tag [names] · est points · sub [titles or [title, done]] · notes
   *   ago days since completed (done tasks) · age days since created
   *   say [[memberIndex, text, minutesAgo]]
   */
  function addTasks(data, project, members, specs) {
    const counters = {};
    specs.forEach((s) => {
      const status = project.statuses.find((x) => x.name === (s.s || "To do"));
      counters[status.id] = (counters[status.id] || 0) + 1000;
      const age = s.age ?? 10;
      const task = {
        id: uid("t"),
        projectId: project.id,
        title: s.t,
        statusId: status.id,
        priority: s.p || "none",
        assigneeId: s.who == null ? null : members[s.who].id,
        start: D(s.start),
        due: D(s.due),
        tagIds: (s.tag || []).map((n) => project.tags.find((t) => t.name === n)?.id).filter(Boolean),
        estimate: s.est ?? null,
        notes: s.notes || "",
        subtasks: (s.sub || []).map((x) => {
          const [title, done] = Array.isArray(x) ? x : [x, false];
          return { id: uid("s"), title, done: !!done };
        }),
        comments: (s.say || []).map(([who, text, mins]) => ({
          id: uid("c"), authorId: members[who].id, text, ts: Date.now() - mins * 60000,
        })),
        activity: [{ ts: Date.now() - age * DAY, text: "Task created" }],
        order: counters[status.id],
        createdAt: Date.now() - age * DAY,
        updatedAt: Date.now() - Math.max(0, age - 3) * DAY,
        completedAt: status.done ? Date.now() - (s.ago ?? 2) * DAY - 3600000 : null,
      };
      if (status.done) task.activity.unshift({ ts: task.completedAt, text: "Status changed to Done" });
      data.tasks.push(task);
    });
  }

  const B = (type, text = "", checked = false) => ({ id: uid("b"), type, text, checked });

  /* ----------------------------------------------------------------- Demo */

  function demo() {
    const members = [
      { id: uid("m"), name: "You" },
      { id: uid("m"), name: "Ananya Roy" },
      { id: uid("m"), name: "Dev Patel" },
      { id: uid("m"), name: "Sofia Marin" },
    ];
    const data = {
      meta: { version: 1, name: "Plotline", updatedAt: Date.now() },
      me: members[0].id,
      members,
      projects: [],
      tasks: [],
      docs: [],
    };

    /* ---- Website relaunch ---- */
    const launch = makeProject({
      name: "Website relaunch",
      emoji: "🚀",
      favorite: true,
      description: "Ship the new marketing site, pricing page and blog before the end of the quarter.",
      tags: [["Design", "purple"], ["Engineering", "blue"], ["Content", "green"], ["Marketing", "pink"], ["Bug", "red"]],
    });
    data.projects.push(launch);
    addTasks(data, launch, members, [
      { t: "Define launch goals and success metrics", s: "Done", p: "high", who: 0, start: -21, due: -14, tag: ["Marketing"], ago: 12, age: 25, sub: [["Agree on signup target", true], ["Pick 3 north-star metrics", true]] },
      { t: "Audit existing site content", s: "Done", p: "medium", who: 2, start: -18, due: -10, tag: ["Content"], ago: 9, age: 22 },
      { t: "Image optimization and lazy loading", s: "Done", p: "medium", who: 3, start: -8, due: -3, tag: ["Engineering"], ago: 3, age: 12 },
      { t: "Customer interview synthesis", s: "Done", p: "high", who: 0, start: -7, due: -1, tag: ["Content"], ago: 1, age: 14, say: [[1, "Great summary. The onboarding theme came up in 7 of 10 calls.", 1500]] },
      { t: "Design system tokens and components", s: "In review", p: "high", who: 1, start: -12, due: 1, tag: ["Design"], est: 8, age: 16,
        sub: [["Color tokens", true], ["Type scale", true], ["Buttons and inputs", true], ["Form validation states", false]],
        say: [[0, "Looks sharp. Can we add a focus ring token for dark mode?", 300], [1, "Yes, adding it today.", 120]] },
      { t: "Cross-browser QA", s: "In review", p: "medium", who: 2, start: -2, due: 5, tag: ["Bug"], est: 5, age: 6 },
      { t: "Homepage hero redesign", s: "In progress", p: "urgent", who: 1, start: -5, due: 3, tag: ["Design"], est: 8, age: 9,
        notes: "Two directions to test: product screenshot vs. illustrated workflow. Decide by Thursday.",
        sub: [["Moodboard", true], ["Wireframes", true], ["High-fidelity mockups", false], ["Copy review", false]] },
      { t: "Build pricing page", s: "In progress", p: "high", who: 3, start: -3, due: 6, tag: ["Engineering"], est: 13, age: 8,
        sub: [["Plan comparison table", true], ["Annual toggle", false], ["FAQ accordion", false]] },
      { t: "Fix navigation overflow on tablet", s: "In progress", p: "urgent", who: 3, due: -1, tag: ["Bug", "Engineering"], est: 3, age: 4 },
      { t: "Launch day checklist", s: "To do", p: "urgent", who: 0, due: 0, tag: ["Marketing"], age: 5,
        sub: [["Smoke test checkout", false], ["Schedule social posts", false], ["Notify support team", false]] },
      { t: "Write launch announcement", s: "To do", p: "high", who: 0, start: 2, due: 8, tag: ["Content", "Marketing"], est: 5, age: 5 },
      { t: "Set up analytics events", s: "To do", p: "medium", who: 2, start: 3, due: 9, tag: ["Engineering"], est: 5, age: 7 },
      { t: "Migrate blog to new CMS", s: "To do", p: "medium", who: 3, start: 4, due: 14, tag: ["Engineering", "Content"], est: 13, age: 7 },
      { t: "Accessibility pass (WCAG AA)", s: "Backlog", p: "high", due: 18, tag: ["Design", "Engineering"], est: 8, age: 6 },
      { t: "Record product demo video", s: "Backlog", p: "medium", who: 1, start: 10, due: 19, tag: ["Marketing"], age: 4 },
      { t: "Prepare press kit", s: "Backlog", p: "low", due: 20, tag: ["Marketing"], age: 3 },
    ]);

    /* ---- Mobile app ---- */
    const mobile = makeProject({
      name: "Mobile app v2",
      emoji: "📱",
      description: "Second major release: offline mode, a new onboarding flow and a faster cold start.",
      tags: [["iOS", "blue"], ["Android", "green"], ["Backend", "orange"], ["Design", "purple"]],
    });
    data.projects.push(mobile);
    addTasks(data, mobile, members, [
      { t: "Dark mode support", s: "Done", p: "medium", who: 1, tag: ["Design"], ago: 4, age: 18 },
      { t: "Migrate analytics SDK", s: "Done", p: "low", who: 2, tag: ["Backend"], ago: 6, age: 20 },
      { t: "Crash on cold start (Android 12)", s: "In review", p: "urgent", who: 3, due: -2, tag: ["Android"], est: 5, age: 8 },
      { t: "Onboarding flow redesign", s: "In progress", p: "high", who: 1, start: -4, due: 5, tag: ["Design"], est: 8, age: 10,
        sub: [["Welcome screens", true], ["Permissions primer", false], ["Empty states", false]] },
      { t: "Offline mode sync engine", s: "In progress", p: "urgent", who: 3, start: -8, due: 7, tag: ["Backend"], est: 21, age: 12,
        sub: [["Conflict resolution rules", true], ["Local queue", true], ["Retry with backoff", false], ["Sync status indicator", false]] },
      { t: "Push notification preferences", s: "To do", p: "medium", who: 2, start: 5, due: 12, tag: ["iOS", "Android"], est: 5, age: 6 },
      { t: "Biometric login", s: "To do", p: "high", who: 3, start: 8, due: 15, tag: ["iOS"], est: 8, age: 6 },
      { t: "Beta release to TestFlight", s: "To do", p: "high", who: 0, start: 8, due: 13, tag: ["iOS"], age: 5 },
      { t: "Performance budget and profiling", s: "Backlog", p: "medium", due: 22, tag: ["iOS", "Android"], est: 8, age: 4 },
      { t: "App Store screenshots", s: "Backlog", p: "low", due: 25, tag: ["Design"], age: 3 },
    ]);

    /* ---- Marketing ---- */
    const mkt = makeProject({
      name: "Q4 marketing campaign",
      emoji: "🎯",
      description: "Pipeline campaign across email, paid social and one flagship webinar.",
      tags: [["Social", "pink"], ["Email", "blue"], ["Paid", "orange"], ["Events", "purple"]],
    });
    data.projects.push(mkt);
    addTasks(data, mkt, members, [
      { t: "Campaign brief and audience segments", s: "Done", p: "high", who: 0, tag: ["Email"], ago: 5, age: 16 },
      { t: "Budget reallocation review", s: "In review", p: "high", who: 0, due: -3, tag: ["Paid"], age: 9 },
      { t: "Email nurture sequence (5 emails)", s: "In progress", p: "high", who: 1, start: -3, due: 6, tag: ["Email"], est: 8, age: 8,
        sub: [["Welcome email", true], ["Case study email", false], ["Offer email", false]] },
      { t: "Influencer outreach list", s: "In progress", p: "low", who: 3, due: 10, tag: ["Social"], age: 6 },
      { t: "Black Friday landing page", s: "To do", p: "urgent", who: 2, start: 6, due: 16, tag: ["Paid", "Email"], est: 8, age: 4 },
      { t: "Paid social creative A/B test", s: "To do", p: "medium", who: 1, start: 4, due: 11, tag: ["Paid", "Social"], age: 4 },
      { t: "Weekly performance report", s: "To do", p: "medium", who: 0, due: 3, age: 7 },
      { t: "Webinar: Planning with Plotline", s: "Backlog", p: "medium", due: 21, tag: ["Events"], est: 13, age: 3 },
    ]);

    /* ---- Docs ---- */
    data.docs.push(
      {
        id: uid("d"), title: "Welcome to Plotline", emoji: "👋", updatedAt: Date.now() - DAY,
        blocks: [
          B("callout", "This is a demo workspace. Everything is stored in your browser, so nothing leaves this device. Edit anything, break anything, then reset from Settings."),
          B("h2", "Get around fast"),
          B("bullet", "Press Ctrl K (or Cmd K) to search tasks, jump to projects and run commands."),
          B("bullet", "Press C anywhere to create a task in the project you are viewing."),
          B("bullet", "Press 1 to 5 to switch between Table, Board, List, Calendar and Timeline."),
          B("bullet", "Press [ to hide the sidebar and Ctrl Z to undo almost anything."),
          B("h2", "Five ways to see the same work"),
          B("p", "Every project has the same tasks in five views. Filters and sorting are saved per view, so your board can show only your tasks while the table shows everything."),
          B("numbered", "Drag cards on the Board to change status."),
          B("numbered", "Drag bars on the Timeline to reschedule, or pull the edges to change length."),
          B("numbered", "Drop tasks onto another day in the Calendar."),
          B("h2", "Write docs next to the work"),
          B("p", "In any doc, type / on an empty line to insert headings, lists, to-dos, quotes, callouts, code and dividers."),
          B("todo", "Try the slash menu on the next line", false),
          B("todo", "Mark this to-do as done", false),
          B("quote", "Plan the work, then work the plan."),
          B("divider"),
          B("p", "When you are ready for a clean slate, open Settings and choose Clear workspace."),
        ],
      },
      {
        id: uid("d"), title: "Kickoff meeting notes", emoji: "🗒️", updatedAt: Date.now() - 3 * DAY,
        blocks: [
          B("p", "Attendees: You, Ananya, Dev, Sofia"),
          B("h2", "Decisions"),
          B("bullet", "Launch date is fixed. Scope flexes, the date does not."),
          B("bullet", "Pricing page ships before the blog migration."),
          B("bullet", "Design reviews happen on Tuesday and Thursday."),
          B("h2", "Action items"),
          B("todo", "Ananya: share hero concepts by Thursday", true),
          B("todo", "Dev: confirm CMS migration estimate", false),
          B("todo", "Sofia: fix tablet navigation bug", false),
          B("todo", "You: send launch checklist to the team", false),
          B("h2", "Risks"),
          B("quote", "If analytics is not ready at launch, we are flying blind for the first week."),
        ],
      },
      {
        id: uid("d"), title: "Launch brief", emoji: "📣", updatedAt: Date.now() - 6 * DAY,
        blocks: [
          B("h1", "Why we are launching"),
          B("p", "Our current site was built for a product we no longer sell. Visitors do not understand what we do in the first ten seconds, and the numbers show it."),
          B("h2", "Goals"),
          B("numbered", "Raise homepage to signup conversion from 2.1% to 3.5%."),
          B("numbered", "Cut average page weight below 1.5 MB."),
          B("numbered", "Publish 12 new articles in the first month."),
          B("divider"),
          B("h2", "Message"),
          B("callout", "One place for every project, from first idea to shipped."),
          B("h3", "Tone"),
          B("p", "Clear, calm and specific. No hype words, no exclamation marks."),
          B("code", "headline: \"Plan the work. Work the plan.\"\nsubhead: \"Tasks, timelines and docs in one workspace.\""),
        ],
      }
    );

    return data;
  }

  /* ------------------------------------------------------------ Templates */

  /**
   * Turn a compact spec into a real project through the store.
   * Task keys: t title · s status index (0-4) · p priority · tag [names]
   *            start/due offsets · est · sub [titles] · me (assign to me)
   */
  function fromSpec(store, spec) {
    const p = store.createProject({ name: spec.name, emoji: spec.emoji, description: spec.description });
    (spec.statuses || []).forEach((name, i) => {
      if (name && p.statuses[i]) store.updateStatus(p.id, p.statuses[i].id, { name });
    });
    const tagIds = {};
    (spec.tags || []).forEach(([name, color]) => { tagIds[name] = store.addTag(p.id, name, color).id; });

    spec.tasks.forEach((t) => {
      store.addTask(p.id, {
        title: t.t,
        statusId: p.statuses[t.s || 0].id,
        priority: t.p || "none",
        start: D(t.start),
        due: D(t.due),
        estimate: t.est ?? null,
        notes: t.notes || "",
        tagIds: (t.tag || []).map((n) => tagIds[n]).filter(Boolean),
        subtasks: (t.sub || []).map((title) => ({ id: uid("s"), title, done: false })),
        assigneeId: t.me ? store.data.me : null,
      });
    });
    return p.id;
  }

  const TEMPLATES = [
    {
      id: "blank",
      name: "Blank project",
      emoji: "📁",
      description: "Five statuses, five views and nothing else.",
      spec: { name: "New project", emoji: "📁", description: "", tasks: [] },
    },
    {
      id: "sprint",
      name: "Sprint planning",
      emoji: "🏃",
      description: "Two-week sprint with goals, stories, bugs and a retro.",
      spec: {
        name: "Sprint 1", emoji: "🏃", description: "Two-week sprint. Goal: ship the checkout improvements.",
        statuses: ["Backlog", "Planned", "In progress", "In review", "Done"],
        tags: [["Story", "blue"], ["Bug", "red"], ["Chore", "gray"], ["Spike", "purple"]],
        tasks: [
          { t: "Sprint planning meeting", s: 1, p: "high", start: 0, due: 0, tag: ["Chore"], me: true },
          { t: "One-page checkout", s: 2, p: "urgent", start: 0, due: 6, tag: ["Story"], est: 8, sub: ["Address autocomplete", "Saved cards", "Error states"] },
          { t: "Coupon codes stack incorrectly", s: 1, p: "high", due: 4, tag: ["Bug"], est: 3 },
          { t: "Investigate payment provider webhooks", s: 1, p: "medium", due: 3, tag: ["Spike"], est: 2 },
          { t: "Upgrade build tooling", s: 0, p: "low", due: 10, tag: ["Chore"], est: 5 },
          { t: "Update order confirmation email", s: 0, p: "medium", due: 9, tag: ["Story"], est: 3 },
          { t: "Sprint review and demo", s: 1, p: "medium", start: 13, due: 13, tag: ["Chore"] },
          { t: "Retrospective", s: 1, p: "low", start: 14, due: 14, tag: ["Chore"] },
        ],
      },
    },
    {
      id: "roadmap",
      name: "Product roadmap",
      emoji: "🗺️",
      description: "Now, next and later initiatives with owners and timelines.",
      spec: {
        name: "Product roadmap", emoji: "🗺️", description: "What we are building and why, by quarter.",
        statuses: ["Ideas", "Next", "In progress", "Beta", "Shipped"],
        tags: [["Growth", "green"], ["Platform", "blue"], ["Retention", "orange"], ["Quality", "purple"]],
        tasks: [
          { t: "Team workspaces", s: 2, p: "high", start: -10, due: 20, tag: ["Platform"], est: 21 },
          { t: "Guided onboarding", s: 2, p: "high", start: -5, due: 14, tag: ["Growth", "Retention"], est: 13 },
          { t: "Public API v1", s: 1, p: "medium", start: 21, due: 50, tag: ["Platform"], est: 34 },
          { t: "Usage-based billing", s: 1, p: "medium", start: 25, due: 55, tag: ["Growth"], est: 21 },
          { t: "Weekly digest emails", s: 0, p: "low", due: 70, tag: ["Retention"] },
          { t: "Performance budget", s: 3, p: "medium", start: -14, due: 7, tag: ["Quality"], est: 8 },
        ],
      },
    },
    {
      id: "bugs",
      name: "Bug tracker",
      emoji: "🐞",
      description: "Report, triage, fix and verify, with severity as priority.",
      spec: {
        name: "Bug tracker", emoji: "🐞", description: "Everything that is broken, in one list.",
        statuses: ["Reported", "Triaged", "Fixing", "Verifying", "Closed"],
        tags: [["UI", "purple"], ["API", "blue"], ["Data", "orange"], ["Security", "red"]],
        tasks: [
          { t: "Login fails after password reset", s: 1, p: "urgent", due: 1, tag: ["API"], est: 3 },
          { t: "Table headers misaligned on Safari", s: 0, p: "low", tag: ["UI"] },
          { t: "CSV export drops last row", s: 2, p: "high", due: 3, tag: ["Data"], est: 2 },
          { t: "Session cookie missing SameSite flag", s: 1, p: "high", due: 2, tag: ["Security"] },
          { t: "Tooltip flickers on hover", s: 0, p: "low", tag: ["UI"] },
        ],
      },
    },
    {
      id: "content",
      name: "Content calendar",
      emoji: "📝",
      description: "Plan posts, videos and newsletters from idea to published.",
      spec: {
        name: "Content calendar", emoji: "📝", description: "Editorial plan for the next six weeks.",
        statuses: ["Ideas", "Drafting", "Editing", "Scheduled", "Published"],
        tags: [["Blog", "blue"], ["Video", "pink"], ["Newsletter", "green"], ["Social", "orange"]],
        tasks: [
          { t: "How we plan a product launch", s: 1, p: "high", start: -2, due: 4, tag: ["Blog"], me: true, sub: ["Outline", "First draft", "Illustrations"] },
          { t: "Behind the scenes: our design process", s: 0, p: "medium", due: 12, tag: ["Video"] },
          { t: "October newsletter", s: 2, p: "high", due: 6, tag: ["Newsletter"] },
          { t: "Customer story: Northwind", s: 3, p: "medium", due: 2, tag: ["Blog"] },
          { t: "Five-day product tips thread", s: 0, p: "low", due: 9, tag: ["Social"] },
        ],
      },
    },
    {
      id: "event",
      name: "Event planning",
      emoji: "🎉",
      description: "Venue, speakers, budget and a day-of run sheet.",
      spec: {
        name: "Team offsite", emoji: "🎉", description: "Two days, twenty people, one great agenda.",
        statuses: ["To research", "To book", "In progress", "Needs review", "Confirmed"],
        tags: [["Venue", "teal"], ["Food", "orange"], ["Travel", "blue"], ["Budget", "green"]],
        tasks: [
          { t: "Shortlist three venues", s: 2, p: "high", due: 5, tag: ["Venue"], me: true },
          { t: "Collect dietary requirements", s: 1, p: "medium", due: 10, tag: ["Food"] },
          { t: "Book group travel", s: 0, p: "medium", due: 21, tag: ["Travel"] },
          { t: "Agree budget with finance", s: 3, p: "high", due: 3, tag: ["Budget"] },
          { t: "Draft agenda", s: 0, p: "medium", due: 18 },
        ],
      },
    },
    {
      id: "goals",
      name: "Goals and OKRs",
      emoji: "🧭",
      description: "Objectives with measurable key results for the quarter.",
      spec: {
        name: "Q4 goals", emoji: "🧭", description: "Three objectives. Keep key results measurable.",
        statuses: ["Not started", "On track", "At risk", "Behind", "Achieved"],
        tags: [["Objective 1", "blue"], ["Objective 2", "purple"], ["Objective 3", "green"]],
        tasks: [
          { t: "Reach 5,000 weekly active users", s: 1, p: "high", due: 60, tag: ["Objective 1"], me: true, sub: ["Referral program", "Onboarding fixes"] },
          { t: "Reduce support response time to under 2 hours", s: 2, p: "high", due: 45, tag: ["Objective 2"] },
          { t: "Publish public roadmap", s: 0, p: "medium", due: 30, tag: ["Objective 3"] },
          { t: "Net promoter score above 45", s: 1, p: "medium", due: 75, tag: ["Objective 1"] },
        ],
      },
    },
  ];

  Plot.seed = {
    demo,
    templates: TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      emoji: t.emoji,
      description: t.description,
      build: (store) => fromSpec(store, t.spec),
    })),
  };
})();
