  /* ---------- The approved time and tools: side lists drawn as the settled ones ---------- */
  IC.user = IC.user || svg('<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>');
  IC.gear = IC.gear || svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>');
  IC.key = svg('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>');
  IC.code = svg('<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>');
  IC.grid = svg('<rect x="4" y="4" width="16" height="16"/><path d="M4 10h16M4 16h16M10 4v16M16 4v16"/>');
  IC.lvl = svg('<path d="M5 19V9M12 19V5M19 19v-7"/>');
  IC.history = svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4M12 8v4l3 2"/>');
  IC.save = svg('<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>');
  IC.notes = svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>');

  // The settled side list (E2 2.1, G2 2.1): an eyebrow, one line a row (icon, name, count in VT323), the chosen lit,
  // and a quiet action at its foot. Several groups share one list, each under its eyebrow.
  function sideList(groups, foot) { return '<div class="u-rail" style="padding:14px 0 14px 14px">' + groups.map(function (g) { return '<span class="e-eb">' + g[0] + "</span>" + g[1].map(function (r) { return '<div class="u-ri' + (r[3] ? " on" : "") + '">' + (r[2] ? IC[r[2]] : "") + r[0] + '<span class="n">' + (r[1] === undefined ? "" : r[1]) + "</span></div>"; }).join("") + (g[2] ? '<div style="padding:10px 12px;display:grid;gap:8px">' + g[2] + "</div>" : ""); }).join("") + (foot || "") + "</div>"; }
  function chipRow(list, on) { return '<div class="y-scrollx" style="display:flex;gap:6px;overflow:hidden;padding:10px 12px">' + list.map(function (c, i) { return '<span class="e-btn' + (i === on ? " on" : " dim") + '" style="min-height:44px;flex:none">' + c + "</span>"; }).join("") + "</div>"; }
  var KCOUNT = { text: 2, checklist: 1, pages: 0, scenes: 1, clocks: 1, quests: 0, encounters: 1 };

  /* ---------- Templates: one page, the templates and the kinds at the side, today's panel at the right ---------- */
  function tplRail(dragKind) {
    return sideList([
      ["Templates", TPLS.map(function (t, i) { return [t.n, t.kinds.length, "scroll", i === 1]; }), btn("New template", "plus", "dim")],
      ["Add a section", Object.keys(KIND6).map(function (k) { return [KIND6[k][0], KCOUNT[k], KIND6[k][1], k === dragKind]; })]
    ], '<p class="e-muted" style="margin:6px 12px 0;font-size:12.5px;line-height:1.45">' + (dragKind ? '<b style="color:var(--text-dim)">' + KIND6[dragKind][0] + "</b> · " + HOLDS[dragKind] : "Drag a kind among the sections, or press it to add one at the end.") + "</p>");
  }
  function tplMain(dragKind) {
    var rows = dragKind ? secRows(DELVE.slice(0, 3)) + '<div style="height:46px;margin:4px 0;border:1px dashed var(--cyan);display:grid;place-items:center;color:var(--cyan-hi);font:600 12.5px var(--f-label)">Drop ' + KIND6[dragKind][0] + " here</div>" + secRows(DELVE.slice(3)) : secRows(DELVE);
    return '<div style="padding:16px 24px;display:grid;gap:12px;align-content:start;overflow:hidden"><div style="display:flex;align-items:center;gap:10px"><span class="e-h2" style="font-size:22px;flex:1">Dungeon delve</span><span class="e-btn"><span class="e-sw"><i></i></span>Default for new sessions</span>' + btn("Duplicate", "", "dim") + ico("dots") + '</div><span class="e-dim" style="font-size:13px">6 sections · made session 2 · saved</span><div>' + rows + "</div></div>";
  }
  function tplPanel() {
    return '<div style="border-left:1px solid var(--line-strong);padding:14px 16px;display:grid;gap:10px;align-content:start;background:var(--bg);overflow:hidden"><span class="e-eb">New session from this template</span><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' + fld("Session", "4") + fld("Played on", "Nov 8") + '</div><span class="e-eb">Copies these sections</span><div class="t-chips">' + DELVE.map(function (s) { return '<span class="t-kind">' + s[0] + "</span>"; }).join("") + "</div>" + cup("Create session 4") + '<div style="height:1px;background:var(--line);margin:6px 0"></div><span class="e-eb">Made from this template · 1</span><div class="t-sec" style="grid-template-columns:minmax(0,1fr) auto"><span><b>Session 2</b><small>Oct 25 · played</small></span>' + btn("Re-apply", "", "dim") + '</div><span class="e-muted" style="font-size:12.5px;line-height:1.45">Editing the template never changes these sessions. Re-apply adds any new sections and keeps what was written.</span></div>';
  }
  function tplPageA(phone, dragKind) {
    if (!phone) return lap("", '<div class="t-page"><div class="t-head"><h1 style="display:flex;align-items:center;gap:12px;flex:1;min-width:0"><span class="e-crumb">' + IC.back + 'More</span>Prep templates</h1></div><div style="display:grid;grid-template-columns:250px minmax(0,1fr) 340px;min-height:0;overflow:hidden">' + tplRail(dragKind) + tplMain(dragKind) + tplPanel() + "</div></div>");
    var P = chipRow(TPLS.map(function (t) { return t.n + " " + t.kinds.length; }), 1) + '<div class="e-pad" style="display:grid;gap:8px;padding-top:0"><div style="display:flex;align-items:center;gap:8px"><span class="e-h2" style="font-size:19px;flex:1">Dungeon delve</span>' + ico("dots") + '</div><span class="e-dim" style="font-size:13px">6 sections · made session 2</span>' + secRows(DELVE.slice(0, 5)) + '<div style="display:flex;gap:8px;flex-wrap:wrap">' + btn("Add a section", "plus", "dim") + btn("New session from it", "plus") + "</div></div>";
    if (dragKind) P += sheet("Add a section", Object.keys(KIND6).map(function (k) { return '<div class="u-ri' + (k === dragKind ? " on" : "") + '" style="min-height:48px">' + IC[KIND6[k][1]] + KIND6[k][0] + '<span class="n">' + KCOUNT[k] + "</span></div>"; }).join("") + '<p class="e-muted" style="margin:4px 12px 0;font-size:12.5px">' + KIND6[dragKind][0] + ": " + HOLDS[dragKind] + "</p>", cup("Add " + KIND6[dragKind][0]));
    return toolPhone("Prep templates", P, { icons: ["plus"] });
  }
  // A session from the Sessions tab: Plan session 4 with the template as chips.
  function sessTabA(phone) {
    var copies = '<div class="t-chips">' + DELVE.map(function (s) { return '<span class="t-kind">' + s[0] + "</span>"; }).join("") + "</div>";
    if (!phone) return lap("Story", storyTabs("Sessions") + '<div style="display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:24px;padding:16px 24px;align-items:start"><div style="display:grid;gap:10px">' + [[3, "Nov 1", "Planned", "Starting template"], [2, "Oct 25", "Played", "Dungeon delve"], [1, "Oct 18", "Played", "Starting template"]].map(function (s, i) { return '<div class="t-sec" style="grid-template-columns:auto minmax(0,1fr) auto;min-height:58px"><span class="t-n" style="font-size:22px">' + s[0] + "</span><span><b>Session " + s[0] + " · " + s[1] + "</b><small>" + s[2] + " · made from " + s[3] + "</small></span>" + (i === 0 ? btn("Open the prep") : ico("dots")) + "</div>"; }).join("") + '</div><div style="display:grid;gap:10px;align-content:start;padding:14px 16px;border:1px solid var(--line-strong);background:var(--bg)"><span class="e-eb">Plan session 4</span><span class="e-dim" style="font-size:13px">Made from</span><div class="t-chips">' + TPLS.map(function (t, i) { return '<span class="e-btn' + (i === 1 ? " on" : " dim") + '">' + t.n + "</span>"; }).join("") + '</div><span class="e-eb">Copies these sections</span>' + copies + fld("Played on", "Nov 8") + cup("Create session 4") + "</div></div>");
    return ph("Story", '<div class="e-pad" style="display:grid;gap:10px"><div class="e-tabs" style="overflow:hidden;margin:0 -14px"><span class="e-tab">Chronicle</span><span class="e-tab">Timeline</span><span class="e-tab on">Sessions</span><span class="e-tab">Downtime</span></div><span class="e-eb">Plan session 4</span><span class="e-dim" style="font-size:13px">Made from</span><div class="t-chips">' + TPLS.map(function (t, i) { return '<span class="e-btn' + (i === 1 ? " on" : " dim") + '" style="min-height:44px">' + t.n + "</span>"; }).join("") + "</div>" + copies + cup("Create session 4") + '<span class="e-eb" style="margin-top:8px">Sessions · 3</span><div class="t-sec" style="grid-template-columns:auto minmax(0,1fr);min-height:52px"><span class="t-n">3</span><span><b>Session 3 · Nov 1</b><small>Planned · made from Starting template</small></span></div></div>');
  }

  /* ---------- The calendar page: its parts at the side ---------- */
  function calPageA(phone) {
    var warn = '<div style="padding:10px 12px;border:1px solid color-mix(in srgb,var(--caution) 45%,transparent);background:color-mix(in srgb,var(--caution) 7%,transparent);font-size:13px"><b style="color:var(--caution-text)">This moves dates players can see</b><br>Rats in the cellar moves from Harvest 9 to Harvest 10. The raw dates are kept, so a later calendar can put them back.</div>';
    if (!phone) return toolLap("Calendar", '<span class="e-ready"><i class="e-lamp ok"></i>Saved</span>', '<div style="position:absolute;inset:0;display:grid;grid-template-columns:250px minmax(0,1fr)">' + sideList([
      ["Calendar", [["Months", 12, "list", 1], ["Eras", 1, "history"], ["Weekdays", 7, "cal"], ["Year suffix", "DR", "edit"]]],
      ["Dates", [["Your date", "17", "eyeoff"], ["Players' date", "14", "eye"]]]
    ]) + '<div style="padding:16px 24px;display:grid;gap:10px;align-content:start;overflow:hidden"><div style="display:flex;align-items:center;gap:10px"><span class="e-h2" style="font-size:22px;flex:1">Months</span>' + btn("Add month", "plus", "dim") + '</div><span class="e-dim" style="font-size:13px">12 months · a year of <span class="t-n">360</span> days</span><div>' + monthRows(8) + "</div>" + warn + "</div></div>");
    return toolPhone("Calendar", chipRow(["Months 12", "Eras 1", "Weekdays 7", "Suffix DR", "Dates"], 0) + '<div class="e-pad" style="display:grid;gap:8px;padding-top:0"><div style="display:flex;align-items:center;gap:8px"><span class="e-h2" style="font-size:19px;flex:1">Months</span>' + btn("Add month", "plus", "dim") + '</div><span class="e-dim" style="font-size:13px">A year of 360 days</span>' + monthRows(7, 1) + "</div>");
  }

  /* ---------- The tools: in Settings, each tool its own row in Settings' side list ---------- */
  var ISECS = [["Players", "user", "Join address · name and class · 3 at the table"], ["Encounters", "grid", "Enforce · six checks · hits applied by the GM"], ["Characters", "lvl", "Players build · level 20 · four methods"], ["Device", "gear", "Dusk · auto-roll · pinch zoom off"], ["Access", "key", "2 credentials active"], ["API", "code", "405 operations"]];
  var CTOOLS = [["Backup", "download", "Never downloaded"], ["Restore", "upload", "Replaces everything"], ["Bring in notes", "notes", "Adds pages, hidden at first"], ["Autosave", "save", "On · after 1 second"], ["Version history", "history", "12 versions · about 3 KB", 1]];
  // Settings' own side list as every side list is drawn (ADR-0071): SECTIONS with counts, then CODEX.
  var ICOUNT = { Players: 3, Encounters: 6, Characters: "", Device: "", Access: 2, API: 405 }, CCOUNT = { Autosave: "On", "Version history": 12 };
  function setList(cur) { return '<span class="e-eb">Sections</span>' + ISECS.map(function (s) { return '<div class="u-ri' + (s[0] === cur ? " on" : "") + '">' + IC[s[1]] + s[0] + '<span class="n">' + ICOUNT[s[0]] + "</span></div>"; }).join("") + '<span class="e-eb">Codex</span>' + CTOOLS.map(function (s) { return '<div class="u-ri' + (s[0] === cur ? " on" : "") + '">' + IC[s[1]] + s[0] + '<span class="n">' + (CCOUNT[s[0]] || "") + "</span></div>"; }).join(""); }
  function iRow(t, line, ctl) { return '<div class="i-row"><div class="i-txt"><b>' + t + "</b><span>" + line + '</span></div><div class="i-ctl">' + ctl + "</div></div>"; }
  // The list is drawn scrolled to the Codex group, so the chosen tool shows; Settings' list scrolls as today's does.
  function toolsPageA(phone) {
    var rows = '<div class="i-grp">' + iRow("Keep version history", "Every time a page is saved, the Codex can keep the previous version.", sw6(1)) + iRow("Save a version at most once every", "Minutes. 0 keeps every save. At most this much work can be lost if you go back a version.", '<span class="e-field" style="min-height:36px;width:76px;font:400 17px var(--f-num)">90</span>') + iRow("Delete old versions", "Removes earlier versions only. Your pages are not changed.", '<span class="e-field" style="min-height:36px;width:60px;font:400 17px var(--f-num)">30</span><span class="e-muted">days</span><span class="e-btn dim" style="color:var(--danger-text)">Delete</span>') + "</div>";
    if (!phone) {
      var rail = '<aside class="i-rail m"><div style="padding:12px 12px 8px">' + '<span class="find">' + IC.search + "Search settings<kbd>Ctrl K</kbd></span></div>" + '<div class="u-list">' + setList("Version history") + "</div></aside>";
      var main = '<div class="i-main"><div class="i-col"><div class="i-head"><h1>Version history</h1><p>Every time a page is saved, the Codex can keep the previous version. 12 saved versions, about 3 KB of text.</p></div>' + rows + "</div></div>";
      return '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-base">' + topBar() + '<div class="ap-pane e-pane"><div class="sb titled"><span class="sb-title">Settings</span><div class="sb-end"></div></div><div class="e-body"><div class="i-body"><div class="i-split">' + rail + main + "</div></div></div></div></div></div>";
    }
    var head = '<header class="pbar"><span class="ico" style="margin-left:-8px">' + IC.back + "</span><h1>Version history</h1><div class=\"end\"></div></header>";
    return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-base">' + head + '<div class="ap-pane e-pane" style="grid-template-rows:minmax(0,1fr)"><div class="e-body"><div class="i-body on-ph"><div class="i-col"><div class="i-head"><p>Every time a page is saved, the Codex can keep the previous version.</p></div>' + rows.replace(/class="i-row"/g, 'class="i-row stack"') + "</div></div></div></div>" + bottom() + "</div></div>";
  }
  // Settings' own list on a phone, with the Codex group.
  function toolsListPhoneA() {
    return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-base"><header class="pbar"><h1>Settings</h1><div class="end"><span class="ico">' + IC.search + '</span></div></header><div class="ap-pane e-pane" style="grid-template-rows:minmax(0,1fr)"><div class="e-body"><div class="i-body on-ph" style="overflow:hidden"><div class="i-plist m">' + setList("") + "</div></div></div></div>" + bottom() + "</div></div>";
  }

  /* ---------- What each page draws once approved ---------- */
  function libPageA(phone) { return S.t1 === "side" && S.t2 === "kinds" ? tplPageA(phone) : libPage(phone); }
  function editPageA(phone) { return S.t1 === "side" && S.t2 === "kinds" ? tplPageA(phone, "encounters") : editPage(phone); }
  function sessPageA(phone) { return S.t3 === "mix" ? sessTabA(phone) : sessPage(phone); }
  function calPageM(phone) { return S.t4 === "page" ? calPageA(phone) : calPage(phone); }
  function toolsPageM(phone) { return S.t6 === "mix" ? (phone ? toolsListPhoneA() : toolsPageA(false)) : toolsPage(phone); }
