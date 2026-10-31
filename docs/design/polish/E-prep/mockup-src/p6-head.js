(function () {
  "use strict";
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* ---------- Icons ---------- */
  function svg(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>"; }
  var IC = {
    arrow: svg('<path d="M5 12h13M13 7l5 5-5 5"/>'),
    back: svg('<path d="M14 6l-6 6 6 6"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    down: svg('<path d="M7 10l5 5 5-5"/>'),
    dots: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
    filter: svg('<path d="M4 6h16M7 12h10M10 18h4"/>'),
    sort: svg('<path d="M7 5v14M4 16l3 3 3-3M17 19V5M14 8l3-3 3 3"/>'),
    map: svg('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>'),
    copy: svg('<rect x="8" y="8" width="12" height="12"/><path d="M4 16V4h12"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
    play: svg('<rect x="4" y="4" width="16" height="16"/><circle cx="9" cy="9" r=".8"/><circle cx="15" cy="15" r=".8"/><circle cx="15" cy="9" r=".8"/><circle cx="9" cy="15" r=".8"/>'),
    prep: svg('<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    codex: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h7"/>'),
    book: svg('<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z"/><path d="M5 16a4 4 0 0 1 4-4h10"/>'),
    select: svg('<path d="M6 4l12 7-5.5 1.5L10 18z"/>'),
    measure: svg('<path d="M3 15l12-12 6 6-12 12z"/><path d="M7 11l2 2M10 8l2 2M13 5l2 2"/>'),
    ping: svg('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/>'),
    draw: svg('<path d="M4 20l4-1 11-11-3-3L5 16z"/>'),
    fog: svg('<path d="M4 9h12M6 13h14M4 17h10"/>'),
    terrain: svg('<path d="M3 19l6-10 4 6 3-4 5 8z"/>'),
    walls: svg('<path d="M4 5h16v14H4z"/><path d="M4 12h16M12 5v7M8 12v7M16 12v7"/>'),
    light: svg('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10c1 1 1 2 1 3h6c0-1 0-2 1-3a6 6 0 0 0-4-10z"/>'),
    view: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    sound: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/>'),
    check: svg('<path d="M5 12l5 5 9-10"/>'),
    grid: svg('<path d="M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16"/>'),
    upload: svg('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>'),
    sliders: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>')
  };

  /* ---------- State ---------- */
  var S = { d1: "shelf", d2: "bench", d3: "draft", d4: "wizard", pg: "front", show: "all", lz: "close" };
  var KEYS = ["d1", "d2", "d3", "d4", "pg"];
  var VALID = { d1: ["list", "tonight", "shelf", "split", "order", "board"], d2: ["bench", "doc", "check", "mapfirst", "tabs", "side"], d3: ["steps", "quick", "onepage", "draft", "gallery", "sheet"], d4: ["wizard", "drag", "points", "count", "sliders", "inline"], pg: ["front", "enc", "new", "grid"] };
  var A = window.AUDIT || {};
  function M(k) { return A["map-" + k] || ""; }

  /* ---------- Data: one campaign's prep ---------- */
  var PARTY = [{ s: "B", n: "Borin Stoneguard", f: "Borin" }, { s: "M", n: "Mirena Dawnbright", f: "Mirena" }, { s: "L", n: "Lyra Emberwise", f: "Lyra" }];
  var ENC = [
    { n: "Ambush on the old road", m: "oldroad", mn: "Old road", st: "prepared", foes: ["Goblin Boss", "Goblin ×4"], ready: "", tok: "8 placed", mod: "Today 12:09" },
    { n: "The ruined keep gate", m: "keep", mn: "Ruined keep", st: "draft", foes: ["Hobgoblin ×2", "Bugbear"], ready: "No grid yet", tok: "3 in the tray", mod: "Yesterday" },
    { n: "Rats in the cellar", m: "cellar", mn: "Inn cellar", st: "prepared", foes: ["Giant Rat ×6"], ready: "", tok: "9 placed", mod: "Monday" },
    { n: "Bandit camp at night", m: "camp", mn: "Forest clearing", st: "draft", foes: ["Bandit ×5", "Bandit Captain"], ready: "6 tokens in the tray", tok: "6 in the tray", mod: "Sunday" },
    { n: "The negotiation at the Wyvern", m: "tavern", mn: "The Wyvern", st: "prepared", foes: ["Merchant", "Guard ×2"], ready: "", tok: "6 placed", mod: "Oct 21" },
    { n: "Wolves on the ridge", m: "ridge", mn: "High ridge", st: "ended", foes: ["Wolf ×4"], ready: "", tok: "Ended Oct 18 · 4 rounds", mod: "Oct 18" }
  ];
  var MAPS = [["oldroad", "Old road", "70 px squares"], ["keep", "Ruined keep", "No grid yet"], ["cellar", "Inn cellar", "50 px squares"], ["camp", "Forest clearing", "64 px squares"], ["tavern", "The Wyvern", "60 px squares"], ["ridge", "High ridge", "72 px squares"]];
  var ST = { draft: "Draft", prepared: "Prepared", live: "Live", ended: "Ended" };

  /* ---------- Parts ---------- */
  function st(e) { return '<span class="e-st ' + e.st + '">' + ST[e.st] + "</span>"; }
  function ready(e) { return e.st === "ended" ? '<span class="e-ready"><i class="e-lamp"></i>Ended</span>' : e.ready ? '<span class="e-ready need"><i class="e-lamp need"></i>' + e.ready + "</span>" : '<span class="e-ready"><i class="e-lamp ok"></i>Ready to go</span>'; }
  function faces() { return '<span class="e-faces">' + PARTY.map(function (p) { return '<span class="face">' + p.s + "</span>"; }).join("") + "</span>"; }
  function foes(e, n) { return e.foes.slice(0, n || 9).map(function (f) { return '<span class="e-chip">' + f + "</span>"; }).join(""); }
  function who(e, n) { return '<div class="e-who">' + faces() + foes(e, n) + "</div>"; }
  function thumb(k, w) { return '<span class="e-thumb" style="background-image:url(' + M(k) + ");" + (w ? "width:" + w + "px" : "") + '"></span>'; }
  function btn(t, ic, cls) { return '<span class="e-btn' + (cls ? " " + cls : "") + '">' + (ic ? IC[ic] : "") + t + "</span>"; }
  function ico(n) { return '<span class="e-ico">' + IC[n] + "</span>"; }
  function cup(t, cls) { return '<span class="cup' + (cls ? " " + cls : "") + '">' + t + "</span>"; }
  function field(t, hint, ic) { return '<div class="e-field' + (hint ? " hint" : "") + '">' + (ic ? IC[ic] : "") + t + "</div>"; }

  function topBar() {
    var nav = '<nav class="ap-nav" aria-hidden="true">' + ["Play", "Prep", "Codex", "Compendium"].map(function (n) { return "<span" + (n === "Prep" ? ' class="on" data-seat' : "") + ">" + n + "</span>"; }).join("") + "</nav>";
    return '<header class="ap-bar"><span class="wm"><span class="wm-ozy">OZY</span><span class="wm-vtt">vtt</span></span>' + nav + '<div class="ap-end"><span class="ico">' + IC.search + '</span><span class="me-btn"><span class="face lg gm">GM</span><span class="online">2</span>' + IC.down + "</span></div></header>";
  }
  var PAGESBAR = ["Encounters", "Party", "Maps", "Tokens", "Sound", "Replays"];
  function prepBar(on, record) {
    var tabs = PAGESBAR.map(function (t) { return '<span class="sb-tab' + (t === on ? " on" : "") + '">' + t + "</span>"; }).join("");
    return '<div class="sb titled"><span class="sb-title">Prep</span><div class="sb-tabs">' + tabs + '</div><div class="sb-end"><span class="find">' + IC.search + "Find an encounter or a map<kbd>Ctrl K</kbd></span>" + (record ? '<span class="e-btn">' + IC.plus + "New encounter</span>" : cup("New encounter")) + "</div></div>";
  }
  function lap(on, inner, record) { return '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-base">' + topBar() + '<div class="ap-pane e-pane">' + prepBar(on, record) + '<div class="e-body">' + inner + "</div></div></div></div>"; }
  function tabsGM() { return '<nav class="ap-bottom five" aria-hidden="true">' + [["Play", "play"], ["Prep", "prep", 1], ["Codex", "codex"], ["Compendium", "book"], ["More", "dots"]].map(function (t) { return '<span class="btab' + (t[2] ? " on" : "") + '">' + IC[t[1]] + t[0] + "</span>"; }).join("") + "</nav>"; }
  function pstrip(on) { return '<div class="pstrip">' + PAGESBAR.map(function (t) { return '<span class="sb-tab' + (t === on ? " on" : "") + '">' + t + "</span>"; }).join("") + "</div>"; }
  function ph(on, inner, noStrip, icons) {
    var head = '<header class="pbar"><h1>Prep</h1><div class="end">' + (icons || ["search", "plus"]).map(function (n) { return '<span class="ico">' + IC[n] + "</span>"; }).join("") + "</div></header>";
    return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-base">' + head + '<div class="ap-pane e-pane" style="' + (noStrip ? "grid-template-rows:minmax(0,1fr)" : "") + '">' + (noStrip ? "" : pstrip(on)) + '<div class="e-body"><div class="e-ph">' + inner + "</div></div></div>" + tabsGM() + "</div></div>";
  }
  /* The encounter's map with its tokens: the party on the road, the goblins in the trees. */
  var TOK = [["p", "B", 14, 56], ["p", "M", 19, 61], ["p", "L", 12, 64], ["f", "GB", 58, 30], ["f", "G", 47, 24], ["f", "G", 66, 44], ["f", "G", 72, 66], ["f", "G", 40, 78]];
  function mapView(pos, opts) {
    opts = opts || {};
    var toks = opts.noTok ? "" : TOK.map(function (t) { return '<span class="e-tok ' + t[0] + '" style="left:' + t[2] + "%;top:" + t[3] + "%" + (opts.ts ? ";--ts:" + opts.ts + "px" : "") + '">' + t[1] + "</span>"; }).join("");
    return '<div class="e-map' + (opts.grid ? " grid" : "") + (opts.cy ? " cy" : "") + '" style="' + pos + ";background-image:url(" + M(opts.m || "oldroad") + ")" + (opts.cell ? ";--cell:" + opts.cell + "px" : "") + '">' + toks + (opts.tray ? '<span class="e-trayc" style="left:12px;top:12px">Tray <b>0</b></span>' : "") + (opts.ctl ? '<div class="e-mctl"><span>+</span><span>−</span></div>' : "") + "</div>";
  }
  function tools(col) { return '<div class="e-tools' + (col ? " col" : "") + '">' + [["Select", "select", 1], ["Measure", "measure"], ["Ping", "ping"], ["Draw", "draw"], ["Fog", "fog"], ["Terrain", "terrain"], ["Walls", "walls"], ["Light", "light"], ["View", "view"]].map(function (t) { return '<span class="e-tb' + (t[2] ? " on" : "") + '">' + IC[t[1]] + t[0] + "</span>"; }).join("") + "</div>"; }
  function recHead(e, phone, acts) {
    return '<div class="e-rec"><h1>' + (phone ? "" : '<span class="e-crumb">' + IC.back + "Encounters</span>") + e.n + " " + st(e) + '</h1><div class="ln">' + e.mn + " · 3 characters, 5 monsters · edited " + e.mod.toLowerCase() + '</div><div class="acts">' + (acts || (phone ? ico("dots") : btn("Duplicate", "copy") + btn("Edit the map", "map") + ico("dots"))) + "</div></div>";
  }
  function readyList() {
    return [["ok", "Map", "Old road · 70 px squares"], ["ok", "Tokens", "8 placed, none in the tray"], ["ok", "Light", "Dim light, no walls"], ["ok", "Sound", "Forest at dusk"]].map(function (r) { return '<div class="e-check"><i class="e-lamp ' + r[0] + '"></i><span><b style="font-weight:600">' + r[1] + '</b> <span class="e-dim">' + r[2] + "</span></span><span></span></div>"; }).join("");
  }
  function whoRows(compact) {
    var rows = PARTY.map(function (p) { return '<div class="e-prow"><span class="face">' + p.s + "</span><div><b>" + p.n + '</b><span class="e-muted">Character · on the map</span></div>' + ico("dots") + "</div>"; });
    rows = rows.concat([["GB", "Goblin Boss", "CR 1 · on the map"], ["G", "Goblin ×4", "CR 1/4 · one roll for the group · on the map"]].map(function (m) { return '<div class="e-prow"><span class="e-badge">' + m[0] + "</span><div><b>" + m[1] + '</b><span class="e-muted">' + m[2] + "</span></div>" + ico("dots") + "</div>"; }));
    return (compact ? rows.slice(2) : rows).join("");
  }
  function rulesRows() {
    return '<div class="e-check"><span class="e-sw"><i></i></span><span>Players roll their own initiative</span><span></span></div><div class="e-check"><span class="e-sw on"><i></i></span><span>One roll for each group of identical monsters</span><span></span></div><div class="e-check" style="grid-template-columns:minmax(0,1fr) auto"><span>Players\' d20 rolls</span>' + btn("The table's: each die", "down", "dim") + '</div><div class="e-check" style="grid-template-columns:minmax(0,1fr) auto"><span>Players\' damage</span>' + btn("The table's: app rolls", "down", "dim") + "</div>";
  }
