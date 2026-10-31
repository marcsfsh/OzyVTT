(function () {
  "use strict";
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* ---------- Icons ---------- */
  function svg(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>"; }
  var IC = {
    back: svg('<path d="M14 6l-6 6 6 6"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    down: svg('<path d="M7 10l5 5 5-5"/>'),
    right: svg('<path d="M10 6l6 6-6 6"/>'),
    dots: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
    filter: svg('<path d="M4 6h16M7 12h10M10 18h4"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
    eye: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeoff: svg('<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.3 3.9M6.5 7.6A17 17 0 0 0 2 12s4 7 10 7a10 10 0 0 0 4.4-1"/>'),
    grip: svg('<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>'),
    play: svg('<rect x="4" y="4" width="16" height="16"/><circle cx="9" cy="9" r=".8"/><circle cx="15" cy="15" r=".8"/><circle cx="15" cy="9" r=".8"/><circle cx="9" cy="15" r=".8"/>'),
    prep: svg('<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    codex: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h7"/>'),
    book: svg('<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z"/><path d="M5 16a4 4 0 0 1 4-4h10"/>'),
    log: svg('<path d="M5 5h14M5 10h14M5 15h9M5 20h6"/>'),
    sheet: svg('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>'),
    person: svg('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>'),
    place: svg('<path d="M3 20h18M5 20V10l7-5 7 5v10M10 20v-5h4v5"/>'),
    faction: svg('<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>'),
    thing: svg('<path d="M12 3l3 6-3 12-3-12z"/><path d="M9 9h6"/>'),
    lore: svg('<circle cx="12" cy="12" r="3.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M5.6 18.4l2-2M16.4 7.6l2-2"/>'),
    quest: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v6M12 16.5v.5"/>'),
    session: svg('<path d="M4 5h16v14H4z"/><path d="M8 3v4M16 3v4M4 10h16"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    list: svg('<path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1"/>'),
    pin: svg('<path d="M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>')
  };
  var EMB = {
    sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    shield: '<path d="M12 3l7 3v5.5c0 4.6-3 8-7 9.5-4-1.5-7-4.9-7-9.5V6z"/><path d="M12 7.5v9M8.5 11h7"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 14.5a1.5 1.5 0 0 1 2.4-1.8L8 15"/>',
    mug: '<path d="M5 8h10v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z"/><path d="M15 10h2a2 2 0 0 1 0 4h-2"/><path d="M7 4v2M10 3v3M13 4v2"/>',
    tower: '<path d="M7 21V9l-2-2V3h3v2h2V3h4v2h2V3h3v4l-2 2v12z"/><path d="M10 21v-4h4v4"/>',
    gem: '<path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18M9 3l3 18M15 3l-3 18"/>',
    place: '<path d="M3 20h18M5 20V10l7-5 7 5v10M10 20v-5h4v5"/>',
    lore: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>'
  };

  /* ---------- State ---------- */
  var S = { d1: "dash", d2: "wiki", d3: "inplace", d4: "chron", f1: "panes", f2: "rail", f3: "panes", f4: "side", f5: "side", pg: "search", show: "all", lz: "close", prev: false };
  var KEYS = ["f1", "f2", "f3", "f4", "f5", "pg"];
  var VALID = { f1: ["today", "rows", "grouped", "panes", "dialog"], f2: ["today", "shelf", "rail", "table", "alpha"], f3: ["today", "filter", "record", "menu", "panes"], f4: ["today", "menu", "inplace", "preview", "side"], f5: ["today", "side", "compare", "timeline", "menu"], d1: ["dash", "front", "index", "next", "shelf", "find"], d2: ["wiki", "band", "book", "tabs", "dossier", "layers"], d3: ["inplace", "preview", "fields", "blocks", "quick", "focus"], d4: ["chron", "sessions", "cal", "line", "diary", "board"], pg: ["search", "index", "tag", "reveal", "history"] };
  var A = window.AUDIT || {};

  /* ---------- Data: one campaign's Codex ---------- */
  var KINDS = [["People", "person", 4, 1], ["Places", "place", 3, 0], ["Factions", "faction", 2, 0], ["Things", "thing", 1, 1], ["Lore", "lore", 2, 0]];
  var PAGES = {
    People: [["Sister Ilsa Varn", "Priest of the Dawnfather", 0, "sun", "var(--hp)"], ["Captain Dorran Hale", "Captain of the Thornwick watch", 0, "shield", "var(--cyan)"], ["Mother Tollow", "Innkeeper of the Wyvern", 0, "mug", "var(--party)"], ["Vesk the Grey", "Warlord of the Ashen Hand", 1, "hand", "var(--hostile)"]],
    Places: [["Thornwick", "Village · the Ashfall Marches", 0, "place"], ["The ruined keep", "Ruin · on the ridge", 0, "tower"], ["The Wyvern", "Inn · Thornwick", 0, "mug"]],
    Factions: [["The Ashen Hand", "Warband · about forty", 0, "hand"], ["The Dawnfather's Choir", "Church · Sunhold", 0, "sun"]],
    Things: [["The Dawn Shard", "Relic · artifact", 1, "gem"]],
    Lore: [["The Eclipse of Ash", "Event · Deepwinter 30", 0, "lore"], ["The Fall of Sunhold Chapel", "Event · 312 years ago", 0, "tower"]]
  };
  var DATE = "Deepwinter 14";
  var ILSA = { n: "Sister Ilsa Varn", kind: "Character", fields: [["Race", "Human"], ["Role", "Priest of the Dawnfather"], ["Status", "Alive"], ["Location", "Thornwick"]], hidField: ["Goals", "Hide the Dawn Shard from the Ashen Hand"], tags: ["thornwick", "clergy"] };
  var BODY1 = 'Keeper of the shrine at <span class="f-link">Thornwick</span>. She found the party on the old road and asked them to escort a sealed box to <span class="f-link">the ruined keep</span>.';
  var BODY2 = "She is kind, tired, and lies badly.";
  var HIDDEN = ["What she hides", 'The box holds <span class="f-link">the Dawn Shard</span>. The Ashen Hand will kill for it.'];
  var RELS = [["Hunted by", "The Ashen Hand", "faction", "Faction · warband"], ["Trusts", "Captain Dorran Hale", "person", "Captain of the watch"], ["Serves", "The Dawnfather's Choir", "faction", "Church"]];
  var JOURNAL = [["Session 1", "The party met Sister Ilsa on the old road."], ["Session 2", "She asked them to keep the box at the Wyvern overnight."]];
  var SESSIONS = [[3, "Nov 1", "planned", "Prep: the road to the keep, the gate, Vesk's offer."], [2, "Oct 25", "played", "Thornwick. The Wyvern's cellar. A grey palm on the gate."], [1, "Oct 18", "played", "The party met Sister Ilsa on the old road and fought wolves on the ridge."]];
  var QUESTS = [["The sealed box", "active", 1, 3, 0], ["Rats in the cellar", "completed", 1, 1, 0], ["Who marked the gate?", "not-started", 0, 0, 1]];

  /* ---------- Parts ---------- */
  function btn(t, ic, cls) { return '<span class="e-btn' + (cls ? " " + cls : "") + '">' + (ic ? IC[ic] : "") + t + "</span>"; }
  function ico(n) { return '<span class="e-ico">' + IC[n] + "</span>"; }
  function cup(t, cls) { return '<span class="cup' + (cls ? " " + cls : "") + '">' + t + "</span>"; }
  function face(e, c, size) { return '<span class="f-face" style="--fc:' + (c || "var(--cyan)") + ";--fs:" + (size || 64) + 'px">' + svg(EMB[e] || EMB.sun) + "</span>"; }
  function kind(k) { var m = { Character: "person", Place: "place", Faction: "faction" }; return '<span class="f-kind">' + IC[m[k] || "person"] + k + "</span>"; }
  function hid(t) { return '<span class="f-hid">' + IC.eyeoff.replace("<svg", '<svg style="width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2"') + (t || "Hidden") + "</span>"; }
  function all(t) { return '<span class="f-all">' + IC.eye.replace("<svg", '<svg style="width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2"') + (t || "Everyone") + "</span>"; }
  function reveal() { return '<span class="f-reveal">' + IC.eye + "Reveal</span>"; }
  function block(margin) { return '<div class="f-block' + (margin ? " margin" : "") + '"><div class="h"><b>' + HIDDEN[0] + "</b>" + hid() + (margin ? "" : reveal()) + "</div><p>" + HIDDEN[1] + "</p></div>"; }
  function facts(gm, cols) {
    var rows = ILSA.fields.map(function (f) { return "<dt>" + f[0] + "</dt><dd>" + f[1] + "</dd>"; }).join("");
    if (gm) rows += "<dt>" + ILSA.hidField[0] + '</dt><dd class="f-hidval">' + ILSA.hidField[1] + " " + hid() + "</dd>";
    return '<dl class="f-facts"' + (cols ? ' style="grid-template-columns:auto minmax(0,1fr) auto minmax(0,1fr)"' : "") + ">" + rows + "</dl>";
  }
  function plate(gm) { return '<div class="f-plate">' + ILSA.fields.map(function (f) { return "<div><small>" + f[0] + "</small><span>" + f[1] + "</span></div>"; }).join("") + (gm ? '<div><small style="color:var(--violet-text)">' + ILSA.hidField[0] + ' · hidden</small><span class="f-hidval">' + ILSA.hidField[1] + "</span></div>" : "") + "</div>"; }
  function rels(n) { return RELS.slice(0, n || 3).map(function (r) { return '<div class="f-rel"><span class="f-ic">' + IC[r[2]] + "</span><div><small>" + r[0] + "</small><b>" + r[1] + "</b></div></div>"; }).join(""); }
  function tags() { return '<div class="f-tags">' + ILSA.tags.map(function (t) { return '<span class="f-tag">#' + t + "</span>"; }).join("") + "</div>"; }
  function journal(gm) { return JOURNAL.map(function (j) { return '<div class="f-jn"><span class="w">' + j[0] + "</span><span>" + j[1] + "</span></div>"; }).join("") + (gm ? '<div style="margin-top:8px">' + btn("Add a journal note", "plus") + "</div>" : ""); }
  function prose(gm) { return '<div class="f-prose"><p>' + BODY1 + "</p>" + (gm ? block() : "") + "<p>" + BODY2 + "</p></div>"; }
  function grp(title, inner, open) { return '<div class="' + (open ? "e-open" : "e-grp") + '"><span class="e-eb">' + title + "</span>" + inner + "</div>"; }

  /* ---------- The frame ---------- */
  function gm() { return S.pg !== "player"; }
  function topBar() {
    var g = gm();
    var secs = g ? ["Play", "Prep", "Codex", "Compendium"] : ["Table", "Sheet", "Codex"];
    var nav = '<nav class="ap-nav" aria-hidden="true">' + secs.map(function (n) { return "<span" + (n === "Codex" ? ' class="on" data-seat' : "") + ">" + n + "</span>"; }).join("") + "</nav>";
    var me = '<span class="me-btn">' + (g ? '<span class="face lg gm">GM</span><span class="online">2</span>' : '<span class="face lg">M</span>') + IC.down + "</span>";
    return '<header class="ap-bar"><span class="wm"><span class="wm-ozy">OZY</span><span class="wm-vtt">vtt</span></span>' + nav + '<div class="ap-end"><span class="ico">' + IC.search + "</span>" + me + "</div></header>";
  }
  var CPAGES = ["Home", "Pages", "Atlas", "Story", "Quests", "Relationships"];
  IC.sort = IC.sort || svg('<path d="M7 5v14M4 16l3 3 3-3M17 19V5M14 8l3-3 3 3"/>');
  function codexBar(on) {
    var tabs = CPAGES.map(function (t) { return '<span class="sb-tab' + (t === on ? " on" : "") + '">' + t + "</span>"; }).join("");
    return '<div class="sb titled"><span class="sb-title">Codex</span><div class="sb-tabs">' + tabs + '</div><div class="sb-end"><span class="find">' + IC.search + "Search the Codex<kbd>Ctrl K</kbd></span>" + (gm() ? cup("New " + IC.down.replace("<svg", '<svg style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2"')) : "") + (gm() ? '<span class="e-ico" title="More">' + IC.dots + "</span>" : "") + "</div></div>";
  }
  function lap(on, inner) { return '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-base">' + topBar() + '<div class="ap-pane e-pane">' + codexBar(on) + '<div class="e-body"><div class="f-body">' + inner + "</div></div></div></div></div>"; }
  function bottom() {
    var g = gm();
    var tabs = g ? [["Play", "play"], ["Prep", "prep"], ["Codex", "codex", 1], ["Compendium", "book"], ["More", "dots"]] : [["Table", "play"], ["Sheet", "sheet"], ["Codex", "codex", 1], ["Log", "log"], ["More", "dots"]];
    return '<nav class="ap-bottom five" aria-hidden="true">' + tabs.map(function (t) { return '<span class="btab' + (t[2] ? " on" : "") + '">' + IC[t[1]] + t[0] + "</span>"; }).join("") + "</nav>";
  }
  function pstrip(on) { return '<div class="pstrip">' + CPAGES.map(function (t) { return '<span class="sb-tab' + (t === on ? " on" : "") + '">' + t + "</span>"; }).join("") + "</div>"; }
  function ph(on, inner, opts) {
    opts = opts || {};
    var icons = opts.icons || (gm() ? ["search", "plus"] : ["search"]);
    // A record's header is Back and where it goes (opts.rec), with no strip; its title opens the content (T rule 12).
    var noStrip = opts.noStrip || opts.rec;
    var head = '<header class="pbar">' + (opts.back || opts.rec ? '<span class="ico" style="margin-left:-8px">' + IC.back + "</span>" : "") + "<h1>" + (opts.rec || opts.title || "Codex") + '</h1><div class="end">' + icons.map(function (n) { return '<span class="ico">' + IC[n] + "</span>"; }).join("") + "</div></header>";
    return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-base">' + head + '<div class="ap-pane e-pane" style="' + (noStrip ? "grid-template-rows:minmax(0,1fr)" : "") + '">' + (noStrip ? "" : pstrip(on)) + '<div class="e-body"><div class="e-ph">' + inner + "</div></div></div>" + bottom() + "</div></div>";
  }
