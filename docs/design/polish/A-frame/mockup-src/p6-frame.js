(function () {
  "use strict";
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* ---------- Icons ---------- */
  function svg(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>"; }
  var IC = {
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    screen: svg('<rect x="3" y="5" width="18" height="12"/><path d="M9 20h6M12 17v3"/>'),
    gear: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>'),
    dots: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
    filter: svg('<path d="M4 5h16l-6 7v6l-4 2v-8z"/>'),
    down: svg('<path d="M7 10l5 5 5-5"/>'),
    right: svg('<path d="M10 7l5 5-5 5"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    eyeoff: svg('<path d="M3 3l18 18"/><path d="M10.6 6.2A9.6 9.6 0 0 1 12 6c5 0 9 6 9 6a16 16 0 0 1-3 3.4M6.3 7.6A16 16 0 0 0 3 12s4 6 9 6a9 9 0 0 0 3.4-.7"/>'),
    person: svg('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>'),
    party: svg('<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.4"/><path d="M3 19c1-3 3.5-4.5 6-4.5s5 1.5 6 4.5M15 15c2 0 4.5 1 5.5 4"/>'),
    moon: svg('<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>'),
    out: svg('<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>'),
    swap: svg('<path d="M5 8h13l-3-3M19 16H6l3 3"/>'),
    page: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>'),
    monster: svg('<path d="M5 19c0-6 3-11 7-11s7 5 7 11"/><path d="M9 8L7 4M15 8l2-4"/><circle cx="10" cy="13" r=".9"/><circle cx="14" cy="13" r=".9"/>'),
    book: svg('<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z"/><path d="M5 16a4 4 0 0 1 4-4h10"/>'),
    go: svg('<path d="M5 12h13M13 7l5 5-5 5"/>'),
    play: svg('<rect x="4" y="4" width="16" height="16"/><circle cx="9" cy="9" r=".8"/><circle cx="15" cy="15" r=".8"/><circle cx="15" cy="9" r=".8"/><circle cx="9" cy="15" r=".8"/>'),
    prep: svg('<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    codex: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h7"/>'),
    log: svg('<path d="M5 5h14M5 10h14M5 15h9M5 20h6"/>'),
    sheet: svg('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>')
  };
  function ico(k) { return '<span class="ico">' + IC[k] + "</span>"; }

  /* ---------- State ---------- */
  var S = { d1: "menu", d2: "tab", d3: "scoped", d4: "corner", who: "gm", page: "table", mo: "rest", enc: "live", show: "all" };
  var KEYS = ["d1", "d2", "d3", "d4", "who", "page", "mo", "enc"];
  var VALID = {
    d1: ["tidy", "live", "menu"], d2: ["icons", "tab", "face"], d3: ["doors", "palette", "scoped"], d4: ["corner", "hz", "status"],
    who: ["gm", "pl"], page: ["table", "mid", "codex"], mo: ["rest", "search", "menu", "news", "offline"], enc: ["live", "none"]
  };
  function gm() { return S.who === "gm"; }
  function live() { return S.enc === "live"; }
  function mine() { return !gm(); } // Lyra is acting: the player plays Lyra, the GM sees Lyra's turn.

  /* ---------- Shared parts ---------- */
  function wm() { return '<span class="wm"><span class="wm-ozy">OZY</span><span class="wm-vtt">vtt</span></span>'; }
  function sections() { return gm() ? ["Play", "Prep", "Codex", "Compendium"] : ["Table", "Sheet", "Codex"]; }
  function litName() { return sections()[{ table: 0, mid: 1, codex: 2 }[S.page]]; }
  function nav() {
    return '<nav class="ap-nav" aria-hidden="true">' + sections().map(function (n) {
      return "<span" + (n === litName() ? ' class="on" data-seat' : "") + ">" + n + "</span>";
    }).join("") + "</nav>";
  }
  function faces() { return '<span class="faces"><span class="face">L</span><span class="face">M</span><span class="face">B</span></span>'; }
  function screenLamp(short) { return '<span class="lamp-on">' + IC.screen + (short ? "" : "Table screen ") + "<i></i><b>ON</b></span>"; }
  function playing() { return '<span class="ap-who"><span class="face">L</span>Playing Lyra</span>'; }
  function lamp(extra) { return '<i class="lamp' + (extra || "") + '"></i>'; }

  function liveLine() {
    if (!live()) {
      return gm() ? '<span class="live-line is-none">' + lamp(" off") + 'No encounter live<span class="go">Start one</span></span>'
        : '<span class="live-line is-none">' + lamp(" off") + "Waiting for the GM to start an encounter</span>";
    }
    return '<span class="live-line">' + lamp(mine() ? " mine" : "") + 'Goblin ambush<span class="vcr">R03</span><span class="who' + (mine() ? " mine" : "") + '">' +
      (mine() ? "Your turn" : "Lyra's turn") + "</span>" + (gm() && S.page === "table" ? IC.down : "") + "</span>";
  }
  function liveChip() {
    var picker = gm() && S.page === "table";
    if (!live()) return picker ? '<span class="live-chip">' + lamp(" off") + 'No encounter live' + IC.down + "</span>" : "";
    return '<span class="live-chip">' + lamp(mine() ? " mine" : "") + 'Goblin ambush<span class="vcr">R03</span>' + (mine() ? '<span class="mine">Your turn</span>' : "") + (picker ? IC.down : "") + "</span>";
  }
  function meBtn() {
    return '<span class="me-btn' + (S.mo === "menu" ? " is-open" : "") + '">' + (gm() ? '<span class="face lg gm">GM</span><span class="online" title="3 players online">3</span>' : '<span class="face lg">L</span>') + IC.down + "</span>";
  }

  function topBar() {
    var h = '<header class="ap-bar">' + wm() + nav();
    if (S.d1 === "tidy") {
      if (S.page === "table" && gm()) h += '<span class="bar-div"></span><span class="pick"><span class="l">Encounter</span>' + (live() ? "Goblin ambush" : "No encounter live") + IC.down + "</span>";
      h += '<div class="ap-end">' + (gm() ? screenLamp() + faces() : playing()) + ico("search") + ico("gear") + "</div>";
    } else if (S.d1 === "live") {
      h += liveLine();
      h += '<div class="ap-end" style="margin-left:0;gap:8px">' + (gm() ? faces() : playing()) + '<span class="find bar">' + IC.search + "Search<kbd>Ctrl K</kbd></span>" + (gm() ? screenLamp(true) : "") + ico("gear") + "</div>";
    } else {
      h += liveChip();
      h += '<div class="ap-end">' + ico("search") + meBtn() + "</div>";
    }
    return h + "</header>";
  }

  /* ---------- Section bars and groups (the theme spec, as approved) ---------- */
  var PREP = {
    section: "Prep", tabs: [["Encounters", 1], ["Party"], ["Maps"], ["Tokens"], ["Sound"], ["Replays"]],
    find: "Find an encounter or a map", primary: "New encounter",
    desc: "Each encounter is a map and who is on it, made live when the table is ready."
  };
  var CODEX = {
    section: "Codex", tabs: [["Home"], ["Pages", 1], ["Atlas"], ["Story"], ["Quests"], ["Relationships"]],
    find: "Search the Codex", primary: "New page"
  };
  function sectionBar(pg, primary) {
    var end = '<div class="sb-end"><span class="find">' + IC.search + pg.find + "<kbd>Ctrl K</kbd></span>" + (primary ? '<button type="button" class="cup">' + pg.primary + "</button>" : "") + "</div>";
    return '<div class="sb titled"><span class="sb-title">' + pg.section + '</span><div class="sb-tabs">' + pg.tabs.map(function (t) {
      return '<span class="sb-tab' + (t[1] ? " on" : "") + '">' + t[0] + "</span>";
    }).join("") + "</div>" + end + "</div>";
  }
  var litOnce = false;
  function grp(head, body, act, extra) {
    var lit = act && !litOnce;
    if (lit) litOnce = true;
    if (act) return '<section class="grp act' + (lit ? " is-lit" : "") + '"><div class="edge"><i class="l"></i><span class="eb">' + head + "</span>" + (extra || "") + '<i class="r"></i></div><div class="grp-b">' + body + '</div><b class="base"></b></section>';
    return '<section class="grp"><div class="grp-h"><span class="eb">' + head + "</span>" + (extra || "") + '</div><div class="grp-b">' + body + "</div></section>";
  }
  var GCLS = "g-mixed box-cradle";

  /* ---------- Page bodies ---------- */
  var ENC = [
    ["a", "Goblin ambush", "Old road", '<span class="live"><i></i>LIVE</span>', "3", "Goblin × 4, Goblin Boss", 52, "Medium", "Today"],
    ["b", "Owlbear den", "Thornwood clearing", '<span class="tag ready">Ready</span>', "3", "Owlbear", 78, "Hard", "2 days ago"],
    ["c", "The drowned crypt", "No map yet", '<span class="tag need">Needs a map</span>', "3", "Ghoul × 3", 96, "Deadly", "Last week"],
    ["d", "Bandit toll bridge", "River crossing", '<span class="tag draft">Draft</span>', "None", "Bandit × 5, Bandit Captain", 50, "Medium", "Last week"]
  ];
  function encRows() { return live() ? ENC : [ENC[0].slice(0, 3).concat(['<span class="tag ready">Ready</span>']).concat(ENC[0].slice(4))].concat(ENC.slice(1)); }
  function toolbar(phone) {
    return '<div class="tbar"><span class="btn">' + IC.filter + "Filters</span>" + (phone ? "" : '<span class="btn">State: all 4' + IC.down + '</span><span class="btn">Modified: any time' + IC.down + "</span>") + '<span class="count">4 encounters</span><span class="btn">Sort: Your order</span></div>';
  }
  function listBody() {
    var table = '<table class="ttable"><thead><tr><th>Encounter</th><th>State</th><th>Party</th><th>Monsters</th><th>Difficulty</th><th>Changed</th></tr></thead><tbody>' + encRows().map(function (e) {
      return '<tr><td><div class="nm"><span class="thumb ' + e[0] + '"></span><div><b>' + e[1] + "</b><span>" + e[2] + "</span></div></div></td><td>" + e[3] + "</td><td>" + e[4] + "</td><td>" + e[5] + '</td><td><span class="meter"><i><b style="width:' + e[6] + '%"></b></i>' + e[7] + "</span></td><td>" + e[8] + "</td></tr>";
    }).join("") + "</tbody></table>";
    return '<div class="pg-body ' + GCLS + '"><p class="desc-line">' + PREP.desc + "</p>" + toolbar() + '<div class="tgrp">' + table + "</div></div>";
  }
  function recordHead() {
    var g = gm();
    return '<div class="ph"><div><div class="t"><h1>Grukk Twotooth</h1>' + (g ? '<span class="tag hidden">Hidden</span>' : "") + "</div><p>Person · Goblin chieftain</p></div>" +
      '<div class="ph-end">' + (g ? '<span class="btn">See it as' + IC.down + '</span><span class="btn">Reveal</span><span class="btn">Edit</span>' : '<span class="btn">Add a note</span>') + '<span class="btn ico-only" aria-label="More">' + IC.dots + "</span></div></div>";
  }
  function docBody() {
    var g = gm();
    var doc = '<article class="doc"><p class="lead">The chieftain of the warren under the Old road. Grukk took the second tooth from a dwarf who tried to collect a toll, and wears it on a cord.</p>' +
      '<h3>What Grukk wants</h3><p>Safe passage for the warren\'s raiders, and a cut of whatever the <a>Bent Nail Inn</a> moves north. Grukk trades fairly with anyone who pays first.</p>' +
      (g ? '<div class="hblock"><div class="hb-h">' + IC.eyeoff + 'Hidden<button type="button" class="lnk">Reveal</button></div><p>Grukk answers to the hag in <a>Thornwood</a>. The tooth is hers: if it is taken, the warren scatters within a day.</p></div>' : "") +
      '<h3>Where to find Grukk</h3><p>The throne room at the bottom of the <a>Goblin warren</a>, behind two guards and a pit the goblins step around without looking.</p></article>';
    var side = '<aside class="side">' +
      (g ? grp("Who sees it", '<div class="chips"><span class="chip">Everyone</span><span class="chip on hid">Hidden</span><span class="chip">Lyra</span><span class="chip">Mirena</span><span class="chip">Borin</span></div>', true) : "") +
      grp("Links", "<ul><li><a>Old road</a><span>Place</span></li><li><a>Goblin warren</a><span>Place</span></li><li><a>Bent Nail Inn</a><span>Place</span></li></ul>") +
      grp("Mentioned in", "<ul><li><a>Session 4 recap</a><span>Session</span></li><li><a>Goblin ambush</a><span>Encounter</span></li></ul>") + "</aside>";
    return '<div class="docwrap ' + GCLS + '">' + doc + side + "</div>";
  }
  var INI = [["L", "Lyra Emberwise", "Wizard · 31 of 38", 18, 1], ["G2", "Goblin 2", "Wounded", 15, 0, 1], ["M", "Mirena Dawnbright", "Cleric · 44 of 52", 14], ["GB", "Goblin Boss", "Unhurt", 12, 0, 1], ["B", "Borin Stoneguard", "Fighter · 67 of 67", 9]];
  function iniRows() {
    return INI.map(function (r) {
      return '<div class="ini' + (r[4] ? " act" : "") + '"><span class="face' + (r[5] ? '" style="border-color:var(--hostile)' : "") + '">' + r[0] + "</span><div><b>" + r[1] + '</b><span class="sub">' + (r[4] ? (mine() ? "Your turn" : "Acting") : r[2]) + '</span></div><span class="num n">' + r[3] + "</span></div>";
    }).join("");
  }
  function tabsStrip(names, on) { return '<div class="sh-tabs">' + names.map(function (n, i) { return '<span class="sh-tab' + (i === on ? " on" : "") + '">' + n + "</span>"; }).join("") + "</div>"; }
  function mapArea(phone) {
    if (!live()) return '<div class="map"><div class="empty-map">' + (gm() ? 'No encounter is live.<span class="btn">Pick an encounter</span>' : "The GM hasn't started an encounter.") + "</div></div>";
    if (phone) return '<div class="map"><span class="tok act" style="left:22%;top:44%">L</span><span class="tok" style="left:10%;top:66%">M</span><span class="tok" style="left:30%;top:70%">B</span><span class="tok foe" style="left:54%;top:30%">G2</span><span class="tok foe" style="left:70%;top:16%">G3</span><span class="tok foe" style="left:74%;top:46%">GB</span></div>';
    return '<div class="map"><span class="tok act" style="left:30%;top:46%">L</span><span class="tok" style="left:24%;top:58%">M</span><span class="tok" style="left:34%;top:62%">B</span><span class="tok foe" style="left:46%;top:38%">G2</span><span class="tok foe" style="left:52%;top:30%">G3</span><span class="tok foe" style="left:58%;top:42%">GB</span></div>';
  }
  function tableBody() {
    var tabs = gm() ? tabsStrip(["Encounter", "Log", "Party", "Notes"], 0) : tabsStrip(["Turn", "Me", "Log", "Party"], 0);
    var body = live() ? '<p class="eb" style="margin:4px 0 8px">Turn order · Round 3</p>' + iniRows() : '<p style="color:var(--text-dim);margin:6px 0">Nothing is running.</p>';
    return '<div class="tblw">' + mapArea() + '<div class="tpanel">' + tabs + '<div class="body">' + body + "</div></div></div>";
  }
  function sheetBody(phone) {
    var ab = [["Strength", "−1"], ["Dexterity", "+3"], ["Constitution", "+1"], ["Intelligence", "+4"], ["Wisdom", "+1"], ["Charisma", "+0"]].map(function (a) { return '<div class="row"><span>' + a[0] + '</span><span class="num">' + a[1] + "</span></div>"; }).join("");
    var sk = [["Arcana", "+6"], ["History", "+6"], ["Insight", "+3"], ["Investigation", "+6"], ["Perception", "+1"], ["Stealth", "+3"]].map(function (a) { return '<div class="row"><span>' + a[0] + '</span><span class="num">' + a[1] + "</span></div>"; }).join("");
    var stats = '<div class="stats"><div><span class="eb">AC</span><span class="num">13</span></div><div><span class="eb">Hit points</span><span class="num hpv">31<small style="color:var(--text-muted);font-size:.6em">/38</small></span></div><div><span class="eb">Init</span><span class="num">+3</span></div><div><span class="eb">Speed</span><span class="num">30</span></div></div>';
    return '<div class="minisheet ' + GCLS + '">' + (phone ? "" : '<div class="top"><span class="face lg" style="width:52px;height:52px">L</span><div><h2>Lyra Emberwise</h2><p style="margin:4px 0 0;color:var(--text-dim);font-size:13px">Wizard 3 · Elf · Sage</p></div></div>') +
      grp("", stats, true) + '<div class="mini-cols">' + grp("Abilities", ab, true) + grp("Skills", sk, true) + (phone ? "" : '<div style="color:var(--text-muted);font-size:13px;padding-top:6px">The sheet itself is piece D1, the Ledger. A sketch here, so the frame has a page to sit on.</div>') + "</div></div>";
  }

  /* ---------- News ---------- */
  function toastText() {
    if (S.page === "table") return gm() ? "Damage applied. Goblin 2 takes 7." : "Your Fire Bolt hit Goblin 2 for 9.";
    if (S.page === "mid") return gm() ? "Saved Goblin ambush." : "Short Rest taken. 1 Hit Point Die spent.";
    return gm() ? "Saved Grukk Twotooth, version 4." : "Note saved.";
  }
  function toast(cls) { return '<div class="toast ' + cls + '"><span class="tag done">Done</span>' + toastText() + '<span class="x">×</span></div>'; }
  function callBand() { return '<div class="band call"><span class="tag call">Roll</span><span class="grow">The GM asks for a Wisdom saving throw.</span><span class="rollbtn">Wisdom save <span class="num">+4</span></span></div>'; }
  function waitBand() { return '<div class="band wait" style="position:relative"><span class="tag wait">Wait</span><span class="grow">Reconnecting. Wait before making changes.</span><span class="line"></span></div>'; }
  function wantsCall() { return S.mo === "news" && !gm() && S.page !== "table"; }
  /* Bands that sit in the pane under the top bar (Corner and Status line). */
  function underBar() {
    var h = "";
    if (S.d4 !== "hz" && wantsCall()) h += callBand();
    if (S.d4 === "corner" && S.mo === "offline") h += waitBand();
    return h;
  }
  /* What hangs from the horizon (From the horizon), at `top` px. */
  function hang(top) {
    if (S.d4 !== "hz" || (S.mo !== "news" && S.mo !== "offline")) return "";
    var inner = S.mo === "offline" ? waitBand() : (wantsCall() ? callBand() : "") + toast("");
    return (S.mo === "news" ? '<span class="hz-light" style="top:' + (top - 2) + 'px"></span>' : "") + '<div class="hang" style="top:' + top + 'px">' + inner + "</div>";
  }
  function statusLine() {
    if (S.d4 !== "status") return "";
    var off = S.mo === "offline";
    var msg = off ? "" : S.mo === "news" ? '<span class="msg"><span class="tag done">Done</span>' + toastText() + "</span>" : '<span class="msg" style="color:var(--text-muted)">' + (gm() ? "Saved Goblin ambush · 2 min ago" : "Note saved · 5 min ago") + "</span>";
    return '<div class="statusline"><span class="conn' + (off ? " wait" : "") + '"><i></i>' + (off ? '<span class="tag wait">Wait</span> Reconnecting. Wait before making changes.' : "Connected") + "</span>" + msg + '<span class="more">Messages · 3</span></div>';
  }

  /* ---------- Search ---------- */
  function hl(s, q) { var i = s.toLowerCase().indexOf(q); return i < 0 ? s : s.slice(0, i) + "<mark>" + s.slice(i, i + q.length) + "</mark>" + s.slice(i + q.length); }
  function srow(icon, title, sub, on, q) { return '<div class="srow2' + (on ? " on" : "") + '">' + IC[icon] + "<div><b>" + (q ? hl(title, q) : title) + "</b>" + (sub ? "<span>" + sub + "</span>" : "") + '</div><span class="k">' + (on ? "Enter" : "") + "</span></div>"; }
  function goRows() {
    var list = gm() ? ["Play", "Prep", "Codex", "Compendium", "Prep · Party", "Prep · Maps"] : ["Table", "Sheet", "Codex", "Settings"];
    return list.map(function (n) { return '<div class="srow2 go">' + IC.go + "<div><b>" + n + "</b></div><span></span></div>"; }).join("");
  }
  var RESULTS = {
    codex: function () {
      return srow("page", "Goblin warren", "Place · Codex", true, "gob") + (gm() ? srow("page", "Goblin ambush recap", "Session · Codex", false, "gob") : "");
    },
    compendium: function (first) {
      return srow("monster", "Goblin", "Monster · CR 1/4", first, "gob") + srow("monster", "Goblin Boss", "Monster · CR 1", false, "gob") + srow("monster", "Goblin Warrior", "Homebrew monster · CR 1/2", false, "gob");
    },
    rules: function () {
      return srow("book", "Grappled", "Condition", true, "grap") + srow("book", "Grapple", "Unarmed Strike option", false, "grap") + srow("book", "Escaping a grapple", "Action", false, "grap");
    }
  };
  function scopeNow() {
    if (S.page === "codex") return "codex";
    return gm() ? "compendium" : "rules";
  }
  function searchOv(phone) {
    var cls = "ov srch " + (phone ? "onph" : "lap");
    var close = '<span class="ico">' + IC.close + "</span>";
    if (S.d3 === "doors") {
      var doors = srow("search", "Search the Codex", "Pages, people, places and quests") + (gm() ? srow("search", "Search the Compendium", "Monsters, spells, items and your homebrew") : "") + srow("book", "Rules", "The rules reference");
      return '<div class="' + cls + ' doors"><div class="ov-h"><h2>Search</h2>' + close + '</div><div class="ov-b">' + doors + '<span class="eb sec">Go to</span>' + goRows() + "</div></div>";
    }
    if (S.d3 === "palette") {
      var res = '<span class="eb sec">Codex</span>' + RESULTS.codex() + (gm() ? '<span class="eb sec">Compendium</span>' + RESULTS.compendium(false) : "") + '<span class="eb sec">Rules</span><p style="margin:2px 0 0;padding:8px;color:var(--text-muted);font-size:13px;border-top:1px solid var(--line)">Nothing in the rules matches \u201cgob\u201d.</p>';
      return '<div class="' + cls + '">' + '<div class="sfield">' + IC.search + 'gob<span class="caret"></span>' + (phone ? '<span class="lnk" style="margin-left:auto">Cancel</span>' : "<kbd>Esc</kbd>") + "</div>" + '<div class="ov-b">' + res + "</div>" +
        '<div class="keys"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span><span style="margin-left:auto">Empty, it lists the doors and where you were</span></div></div>';
    }
    var sc = scopeNow();
    var names = gm() ? [["codex", "Codex"], ["compendium", "Compendium"], ["rules", "Rules"], ["go", "Go to"]] : [["codex", "Codex"], ["rules", "Rules"], ["go", "Go to"]];
    var segs = '<span class="segc">' + names.map(function (n) { return "<span" + (n[0] === sc ? ' class="on"' : "") + ">" + n[1] + "</span>"; }).join("") + "</span>";
    var q = sc === "rules" ? "grap" : "gob";
    return '<div class="' + cls + '"><div class="sfield">' + IC.search + q + '<span class="caret"></span>' + (phone ? '<span class="lnk" style="margin-left:auto">Cancel</span>' : "<kbd>Esc</kbd>") + "</div>" +
      '<div class="scopes">' + segs + '</div><div class="ov-b">' + RESULTS[sc](true) + "</div>" +
      '<div class="keys"><span><kbd>Tab</kbd> next place to look</span><span><kbd>Enter</kbd> open</span><span style="margin-left:auto">Starts on the section you are in</span></div></div>';
  }

  /* ---------- Menu and sheet ---------- */
  function menuRows(withSearch) {
    var themeSeg = '<span class="segc"><span class="on">Dusk</span><span>Dawn</span></span>';
    var head = gm() ? '<div class="who-row"><span class="face lg gm">GM</span><div><b>Game Master</b><span>Signed in on this device</span></div></div>'
      : '<div class="who-row"><span class="face lg">L</span><div><b>Lyra Emberwise</b><span>Wizard 3 · claimed on this device</span></div></div>';
    var rows = (withSearch ? '<div class="mrow">' + IC.search + "Search<span class=\"end\"><kbd style=\"font:400 13px var(--f-num);border:1px solid var(--line-raised);padding:2px 4px\">Ctrl K</kbd></span></div>" : "") +
      (gm() ? '<div class="mrow">' + IC.party + 'Who is here<span class="end">' + faces() + "3 of 3</span></div>" + '<div class="mrow">' + IC.screen + 'Table screen<span class="end"><span class="lamp-on" style="padding:0"><i></i><b>ON</b></span>' + IC.down + '</span></div><div class="msub"><span>Pause the table screen</span><span>Preview it here</span><span>Table screen settings</span></div>'
        : '<div class="mrow">' + IC.swap + 'Release Lyra<span class="end">' + IC.right + "</span></div>") +
      '<div class="mrow">' + IC.moon + 'Theme<span class="end">' + themeSeg + "</span></div>" +
      '<div class="mrow">' + IC.gear + 'Settings<span class="end">' + IC.right + "</span></div>" +
      '<div class="mrow">' + IC.out + (gm() ? "Sign out" : "Leave the table") + "</div>";
    return head + rows;
  }

  /* ---------- Frames ---------- */
  function laptop() {
    litOnce = false;
    var body;
    if (S.page === "table") body = tableBody();
    else if (S.page === "mid") body = gm() ? '<div class="pg">' + sectionBar(PREP, true) + listBody() + "</div>" : sheetBody(false);
    else body = '<div class="pg">' + sectionBar(CODEX, gm()) + recordHead() + docBody() + "</div>";
    var under = underBar();
    var pane = under ? '<div style="display:grid;grid-template-rows:auto minmax(0,1fr);height:100%">' + under + '<div style="min-height:0;overflow:hidden">' + body + "</div></div>" : body;
    var ov = "";
    if (S.mo === "search") ov = '<div class="scrim"></div>' + searchOv(false);
    if (S.mo === "menu" && S.d1 === "menu") ov = '<div class="ov menu lap">' + menuRows(false) + "</div>";
    if (S.mo === "news" && S.d4 === "corner") ov = toast("corner");
    ov += hang(56);
    var cls = "ap sub-base" + (S.d4 === "status" ? " has-status" : "") + (S.mo === "offline" && S.d4 === "hz" ? " is-offline" : "");
    return '<div class="frame" style="width:1280px;height:800px"><div class="' + cls + '">' + topBar() + '<div class="ap-pane' + (S.page === "table" ? " is-cols" : "") + '">' + pane + "</div>" + statusLine() + ov + "</div></div>";
  }

  function phone() {
    litOnce = false;
    var g = gm(), title, extra = "", pageIcons = [], strip = "", body, foot = "";
    if (S.page === "table") {
      title = live() ? "Goblin ambush" : g ? "Play" : "Table";
      if (live()) extra = '<span class="vcr">R03</span>';
      if (g) extra += '<span class="ico" style="width:28px">' + IC.down + "</span>";
      body = mapArea(true) + tabsStrip(g ? ["Encounter", "Log", "Party", "Notes"] : ["Turn", "Me", "Log", "Party"], 0) + '<div style="padding:4px 12px">' + (live() ? iniRows() : '<p style="color:var(--text-dim)">Nothing is running.</p>') + "</div>";
    } else if (S.page === "mid" && g) {
      title = "Prep";
      pageIcons = ["search", "plus"];
      strip = '<div class="pstrip">' + PREP.tabs.slice(0, 5).map(function (t) { return '<span class="sb-tab' + (t[1] ? " on" : "") + '">' + t[0] + "</span>"; }).join("") + "</div>";
      body = '<div class="pbody ' + GCLS + '"><p class="desc-line">' + PREP.desc + "</p>" + toolbar(true) + '<div class="tgrp">' + encRows().map(function (e) {
        return '<div class="prow" style="padding:0 12px"><span class="thumb ' + e[0] + '"></span><div><b>' + e[1] + "</b><span>" + e[3].replace(/<[^>]+>/g, "").replace("LIVE", "Live") + " · " + e[7] + '</span></div><span class="chev">›</span></div>';
      }).join("") + "</div></div>";
      if (S.d2 === "icons") foot = '<div class="pfoot"><button type="button" class="cup">New encounter</button></div>';
    } else if (S.page === "mid") {
      title = "Lyra Emberwise";
      extra = '<span class="hp">31/38</span>';
      pageIcons = ["dots"];
      strip = '<div class="pstrip">' + ["Main", "Actions", "Spells", "Gear", "Features"].map(function (n, i) { return '<span class="sb-tab' + (i === 0 ? " on" : "") + '">' + n + "</span>"; }).join("") + "</div>";
      body = sheetBody(true);
    } else {
      title = "Codex";
      pageIcons = g ? ["search", "plus"] : ["search"];
      strip = '<div class="pstrip">' + [["Home"], ["Pages", 1], ["Atlas"], ["Campaign"], ["Quests"]].map(function (t) { return '<span class="sb-tab' + (t[1] ? " on" : "") + '">' + t[0] + "</span>"; }).join("") + "</div>";
      body = '<div class="pbody"><div class="ptitle"><div class="ttl-rec"><h2>Grukk Twotooth</h2>' + (g ? '<span class="tag hidden">Hidden</span>' : "") + "</div><p>Person · Goblin chieftain</p></div>" +
        '<article class="doc"><p class="lead">The chieftain of the warren under the Old road. Grukk took the second tooth from a dwarf who tried to collect a toll, and wears it on a cord.</p>' +
        (g ? '<div class="hblock"><div class="hb-h">' + IC.eyeoff + 'Hidden<button type="button" class="lnk">Reveal</button></div><p>Grukk answers to the hag in <a>Thornwood</a>.</p></div>' : "") +
        "<p>Safe passage for the warren's raiders, and a cut of whatever the <a>Bent Nail Inn</a> moves north.</p></article></div>";
    }
    var icons = S.d2 === "icons" ? ["search", "dots"] : pageIcons.slice(0, 2);
    var face = S.d2 === "face" ? (g ? '<span class="face gm">GM</span>' : '<span class="face">L</span>') : "";
    var pbar = '<header class="pbar">' + face + "<h1>" + title + "</h1>" + extra + '<div class="end">' + icons.map(ico).join("") + "</div></header>";

    var tabs = g ? [["Play", "play", "table"], ["Prep", "prep", "mid"], ["Codex", "codex", "codex"], ["Compendium", "book", ""]] : [["Table", "play", "table"], ["Sheet", "sheet", "mid"], ["Codex", "codex", "codex"], ["Log", "log", ""]];
    if (S.d2 === "tab") tabs.push(["More", "dots", "more"]);
    var moreOpen = S.mo === "menu" && S.d2 === "tab";
    var bottom = '<nav class="ap-bottom' + (S.d2 === "tab" ? " five" : "") + '" aria-hidden="true">' + tabs.map(function (t) {
      var on = moreOpen ? t[2] === "more" : t[2] === S.page;
      var lampHtml = t[2] === "table" && live() ? lamp(mine() ? " mine" : "") : "";
      return '<span class="btab' + (on ? " on" : "") + '">' + IC[t[1]] + t[0] + lampHtml + "</span>";
    }).join("") + "</nav>";

    // A phone has no top bar, so the bands that sit under a laptop's bar are the first row, above the page's header.
    var under = underBar();
    var paneInner = strip + body + foot;
    if (under) pbar = "<div>" + under + pbar + "</div>";
    var ov = "";
    if (S.mo === "search") ov = searchOv(true);
    if (S.mo === "menu") {
      var above = S.d2 === "tab" ? " above-tabs" : "";
      ov = '<div class="scrim' + above + '"></div>' + (S.d2 === "face" ? '<div class="ov sheet onph from-top">' + menuRows(false) + "</div>" : '<div class="ov sheet onph' + above + '"><div class="grab"></div>' + menuRows(S.d2 === "tab") + "</div>");
    }
    if (S.mo === "news" && S.d4 === "corner") ov = toast("corner");
    ov += hang(48);
    var cls = "ap is-phone sub-base" + (S.d4 === "status" ? " has-status" : "") + (S.mo === "offline" && S.d4 === "hz" ? " is-offline" : "");
    return '<div class="frame" style="width:390px;height:844px"><div class="' + cls + '">' + pbar + '<div class="ap-pane">' + paneInner + "</div>" + statusLine() + bottom + ov + "</div></div>";
  }

  /* ---------- What each option means ---------- */
  var DEC = {
    d1: {
      n: 1, name: "Top bar, laptop",
      what: "The bar across the top of every page on a laptop, for the GM and for players (A1, A2, A7).",
      today: "The four sections, then a row of utility icons: the table screen lamp, search, the theme switch and settings. Play adds the encounter picker and a player sees Playing Mirena. Away from Play, nothing says an encounter is running.",
      opts: {
        tidy: ["Tidy", "Today's bar with less in it. The wordmark, the sections as words, and on Play the encounter picker. At the right the table screen lamp, who is online, search and settings, each its own icon. The theme switch leaves the bar for Settings, Device."],
        live: ["Live line", "The middle of the bar says what is happening at the table, on every page: a lamp, the encounter, the round on the VCR counter and whose turn it is, in amber when it is yours. It takes you to the table, and on Play it is the encounter picker. Search becomes a field with Ctrl K."],
        menu: ["One menu · chosen", "The fewest things in the bar: the sections, a live chip only while an encounter runs, search, and one button with your face (the GM mark for the GM). It opens a menu with who is online, the table screen, the theme, settings and signing out."]
      }
    },
    d2: {
      n: 2, name: "Phone frame",
      what: "Where the app's own controls go on a phone, now that each page's header row holds its title and at most two icons (rule 12 of the theme) (A3).",
      today: "Two rows above most pages: the wordmark bar with the table screen, search, theme and settings, then the page's header, which can carry a second search. Play and the player's table drop the wordmark bar for their own header.",
      opts: {
        icons: ["Header icons", "The bottom tabs stay at four. Every header row ends with search and More, and More opens a sheet with the table screen, settings, the theme and who is online. A section's primary moves to the foot of its content."],
        tab: ["Fifth tab · chosen", "More becomes a fifth bottom tab holding search, the table screen, settings, the theme and who is online. The header row's two icons belong to the page: its search and its primary."],
        face: ["Face menu", "Your face starts the header row (the GM mark for the GM) and opens the same sheet from the top. The header's icons belong to the page, and the bottom tabs stay at four."]
      }
    },
    d3: {
      n: 3, name: "Search",
      what: "What Ctrl K and the search icon open, on every page, and the way to the rules reference (A5, A6).",
      today: "A dialog of doors: Search the Codex, Search the Compendium, Rules, then a list of sections. You choose a door before you can type. On the Codex, the Compendium, Prep and Settings, Ctrl K opens that section's own search instead.",
      opts: {
        doors: ["Doors", "Today's launcher, drawn to the theme: choose where to search (the Codex, the Compendium, the rules), then type there. Go to lists the sections and pages."],
        palette: ["Palette", "One field. Type and the results arrive in groups: Codex pages, Compendium records for the GM, rules and places to go. Each group comes from that section's own search, so a player sees only what the Codex shows them. Arrows and Enter open a result."],
        scoped: ["Scoped field · chosen", "One field, with where to look under it, set to the section you are in: the Compendium from Prep and the table, the Codex from the Codex, the rules for a player at the table. One source at a time; Tab moves to the next."]
      }
    },
    d4: {
      n: 4, name: "News",
      what: "Feedback after an action, the reconnect notice, and a roll call on a page other than the table (A8, A9, A11). Pick Moment: News or Offline to see them; a roll call shows for a player away from the table.",
      today: "Toasts rise in the bottom right with a DONE tag. Reconnecting is a bar under the top bar with a WAIT tag. A roll call is a row under the top bar.",
      opts: {
        corner: ["Corner · chosen", "Where it is today, drawn to the theme. A toast rises in the bottom right on a laptop and above the tabs on a phone. Reconnecting and a roll call are bands under the top bar."],
        hz: ["From the horizon", "Everything new hangs from the top bar's horizon, centred: a toast, a roll call, the reconnect notice. Light runs along the horizon to it as it arrives, and while the app is offline the horizon goes grey."],
        status: ["Status line", "A thin line along the bottom of the screen holds the connection lamp, the latest message and a count of earlier ones, so nothing covers the page. On a phone it sits above the tabs. A roll call is still a band under the top bar, because it needs a button."]
      }
    }
  };
  function renderIdea() {
    $("#idea").innerHTML = ["d1", "d2", "d3", "d4"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div><p class="eyebrow">' + d.n + " · " + d.name + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }

  /* ---------- Today and the proposals ---------- */
  function renderStatic() {
    var A = window.AUDIT || {};
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    $("#today").innerHTML =
      '<div class="today-strip" style="grid-column:1/-1"><p class="eyebrow">1 · Top bars</p>' + fig("gm-bar", "GM, Prep: the top bar over the section bar") + fig("gm-play-bar", "GM, Play: the encounter picker joins the bar") + fig("pl-bar", "Player: Playing Mirena, search, theme and settings") + "</div>" +
      '<div class="today-strip"><p class="eyebrow">2 · Phones</p>' + fig("ph-codex", "GM, Codex: the wordmark bar, then the page header with its own search") + fig("ph-play", "GM, Play: no wordmark bar") + fig("ph-pl-table", "Player, Table: the character header instead") + fig("ph-tabs", "Bottom tabs, ink on top") + "</div>" +
      '<div class="today-strip"><p class="eyebrow">3 · Search</p>' + fig("search", "The search launcher: doors, then Go to") + "</div>" +
      '<div class="today-strip"><p class="eyebrow">4 · News and the rest</p>' + fig("toast", "A toast") + fig("confirm", "A confirm dialog") + fig("notfound", "Not found") + "</div>";

    var R = [
      ["The same frame on every page", '<div class="mini" style="min-height:96px"><div class="mbar"></div><div class="msb">PREP <span style="font:500 11px var(--f-label);color:var(--text-dim);letter-spacing:0">Encounters · Party · Maps</span></div></div>',
        "On a laptop the top bar is the same on every page for each role, and the section bar is the only bar under it. On a phone the bottom tabs never change, and the header row belongs to the page: on the table it shows the encounter, on a sheet the character.",
        "Today the phone's top bar comes and goes: Play and the player's table replace it."],
      ["The live lamp", '<div class="mini" style="min-height:96px;align-content:end"><div style="display:grid;grid-template-columns:repeat(4,1fr);height:52px;border-top:1px solid var(--line-strong);background:var(--glass-bg);font:600 11px var(--f-label);color:var(--text-dim)"><span style="display:grid;place-items:center;position:relative">Table<i style="position:absolute;top:8px;left:calc(50% + 14px);width:7px;height:7px;background:var(--caution)"></i></span><span style="display:grid;place-items:center">Sheet</span><span style="display:grid;place-items:center">Codex</span><span style="display:grid;place-items:center">Log</span></div></div>',
        "While an encounter runs, the Play or Table bottom tab carries a lit cyan lamp, amber when it is your turn. A phone always shows that the table is live, whatever the top bar option.",
        "Today nothing outside the table says an encounter is running."],
      ["The theme switch", "", "It leaves the top bar: it is set once per device. Settings, Device and the landing page keep it, and so does the menu or the phone's sheet where an option has one.", "Today it is an icon in every top bar."],
      ["One Ctrl K", "", "Ctrl K opens the same search on every page. A section's own search field in its bar stays the quick way to search that section and opens the same search, already looking there.", "Today Ctrl K opens a different search in four sections."],
      ["Rules reference (A6)", '<div class="mini" style="min-height:110px;grid-template-columns:1fr 46%"><div></div><div class="dlg" style="margin:0;width:auto;border-width:0 0 0 1px"><h4>Rules</h4><p>Grappled</p><p>While Grappled, your Speed is 0 and ...</p></div></div>',
        "A drawer on the right on a laptop and a sheet from the bottom on a phone, with its title on the horizon edge. It opens from search and from the Compendium, and keeps the page behind it usable on a laptop.", ""],
      ["Confirm and prompt (A10)", '<div class="mini"><div class="dlg"><h4>Delete the drowned crypt?</h4><p>Its map stays in the library.</p><div class="ft"><span class="ghost">Cancel</span><span class="dng">Delete</span></div></div></div>',
        "The Dialog pattern: the question as the title on the horizon edge, one sentence, Cancel as a ghost and the action at the right: the Cup, or a danger Base line for deleting. A sheet from the bottom on a phone.", "Today Cancel is a filled box beside the Cup."],
      ["Not found (A12)", '<div class="mini"><div class="mbar"></div><div class="nf">Nothing lives at this address.<span class="b">Go to the table</span></div></div>',
        "Rule 3's empty state: one line where the page would be and one secondary button, under the bar you came from. A record that has gone keeps today's notice over the list it fell back to.", "Today two buttons, one of them the Cup, under a heading."],
      ["Something broke (A13)", '<div class="mini sun"><div class="card"><span class="eb">Something broke</span><b>The table couldn\'t finish loading</b><code>TypeError: actor is undefined</code><span class="cup">Reload</span></div></div>',
        "The arrival's sunset with one card: what broke, the message in a box with Copy, and Reload as the primary. Nothing else on screen.", "Today a plain card on the page background."],
      ["Loading (A14)", '<div class="mini"><div class="mbar"></div><div class="msb">CODEX</div><div class="ld"><p>Loading the Codex</p></div></div>',
        "The frame and the section bar draw at once and the page fills in. After 400 ms with nothing, one line says what is loading. No spinner and nothing that loops.", "Today an empty pane."],
      ["Roll call (A11)", '<div class="mini" style="min-height:90px;align-content:start"><div class="mbar"></div><div class="band call" style="min-height:36px;font-size:12px"><span class="tag call" style="height:16px;font-size:13px">Roll</span><span class="grow">Wisdom saving throw</span><span class="rollbtn" style="min-height:28px;font-size:12px">Wisdom save <span class="num" style="font-size:18px">+4</span></span></div></div>',
        "On a page other than the table, an amber band under the top bar with the roll as its button, until it is rolled. On the table it belongs to the panel (area C).", ""],
      ["Reconnecting (A8)", "", "Its words and the amber WAIT tag stay. Nothing moves while it waits; when the table answers, light runs along its line once and it says Back at the table for two seconds.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) {
      return '<div class="rule"><h3>' + r[0] + "</h3>" + (r[1] ? r[1] : "") + "<p>" + r[2] + "</p>" + (r[3] ? '<p class="today">' + r[3] + "</p>" : "") + "</div>";
    }).join("");
  }

  /* ---------- Page ---------- */
  function capText() {
    var page = { table: gm() ? "Play" : "Table", mid: gm() ? "Prep, Encounters" : "Sheet", codex: "Codex, a page" }[S.page];
    var mo = { rest: "", search: " · search open", menu: " · menu open", news: " · news", offline: " · offline" }[S.mo];
    return (gm() ? "GM" : "Player") + " · " + page + mo;
  }
  function renderStage() {
    $("#mid-btn").textContent = gm() ? "Prep" : "Sheet";
    $("#cap-laptop").textContent = "Laptop · " + capText();
    $("#cap-phone").textContent = "Phone · " + capText();
    $("#note-laptop").textContent = S.mo === "menu" && S.d1 !== "menu" ? "This option has no menu: each utility is an icon in the bar" : "1280 by 800, shown to fit";
    $("#v-laptop .fit").innerHTML = laptop();
    $("#v-phone .fit").innerHTML = phone();
    fit();
  }
  function fit() {
    $$(".fit").forEach(function (box) {
      var fr = box.querySelector(".frame");
      if (!fr) return;
      var fw = parseFloat(fr.style.width), fh = parseFloat(fr.style.height);
      var k = Math.min(1, box.parentElement.clientWidth / fw);
      fr.style.transform = "scale(" + k + ")";
      box.style.width = fw * k + "px";
      box.style.height = fh * k + "px";
    });
    $$(".ap-nav [data-seat]").forEach(function (el) {
      el.style.setProperty("--win-w", el.closest(".ap-bar").offsetWidth + "px");
      el.style.setProperty("--win-x", -el.offsetLeft + "px");
    });
  }
  var SEGS = { d1: "d1-seg", d2: "d2-seg", d3: "d3-seg", d4: "d4-seg", who: "who-seg", page: "page-seg", mo: "mo-seg", enc: "enc-seg", show: "view-seg" };
  function sync() {
    Object.keys(SEGS).forEach(function (k) {
      $$("#" + SEGS[k] + " button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === S[k])); });
    });
    $("#stage").dataset.show = S.show;
  }
  function writeHash() { try { history.replaceState(null, "", "#" + KEYS.map(function (k) { return S[k]; }).join(".")); } catch (e) { /* the frame may refuse it */ } }
  function readHash() {
    var h = location.hash.slice(1).split(".");
    KEYS.forEach(function (k, i) { if (VALID[k].indexOf(h[i]) >= 0) S[k] = h[i]; });
  }
  Object.keys(SEGS).forEach(function (k) {
    $$("#" + SEGS[k] + " button").forEach(function (b) {
      b.addEventListener("click", function () {
        S[k] = b.getAttribute("data-v");
        sync();
        if (k === "show") { fit(); return; }
        renderIdea();
        renderStage();
        writeHash();
      });
    });
  });

  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  function paintTheme() {
    var t = document.documentElement.getAttribute("data-theme");
    var eff = t === "light" || t === "dark" ? t : mq && mq.matches ? "light" : "dark";
    $$("#theme-seg button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.th === eff)); });
  }
  $$("#theme-seg button").forEach(function (b) {
    b.addEventListener("click", function () { document.documentElement.setAttribute("data-theme", b.dataset.th); paintTheme(); });
  });
  if (mq && mq.addEventListener) mq.addEventListener("change", paintTheme);

  var lastW = 0;
  if (window.ResizeObserver) new ResizeObserver(function (entries) {
    var w = Math.round(entries[0].contentRect.width);
    if (w !== lastW) { lastW = w; fit(); }
  }).observe($("#stage"));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  window.addEventListener("hashchange", function () { readHash(); sync(); renderIdea(); renderStage(); });

  readHash();
  if (window.matchMedia && window.matchMedia("(max-width: 650px)").matches) S.show = "phone";
  sync();
  renderIdea();
  renderStatic();
  renderStage();
  paintTheme();
})();
