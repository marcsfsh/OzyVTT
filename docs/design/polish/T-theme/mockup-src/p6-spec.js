(function () {
  "use strict";
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* ---------- Icons ---------- */
  function svg(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>"; }
  var IC = {
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    screen: svg('<path d="M4 17h16"/><path d="M6 17a6 6 0 0 1 12 0"/><path d="M12 8V6"/>'),
    gear: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>'),
    dots: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
    filter: svg('<path d="M4 5h16l-6 7v6l-4 2v-8z"/>'),
    down: svg('<path d="M7 10l5 5 5-5"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    eyeoff: svg('<path d="M3 3l18 18"/><path d="M10.6 6.2A9.6 9.6 0 0 1 12 6c5 0 9 6 9 6a16 16 0 0 1-3 3.4M6.3 7.6A16 16 0 0 0 3 12s4 6 9 6a9 9 0 0 0 3.4-.7"/>'),
    person: svg('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>'),
    // Section icons, used by the Boxed option only
    swords: svg('<path d="M4 4l9 9M20 4l-9 9M7 17l-3 3M17 17l3 3M6 14l4 4M18 14l-4 4"/>'),
    party: svg('<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.4"/><path d="M3 19c1-3 3.5-4.5 6-4.5s5 1.5 6 4.5M15 15c2 0 4.5 1 5.5 4"/>'),
    map: svg('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>'),
    token: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="10" r="3"/><path d="M7 17c1.5-2 3-2.6 5-2.6s3.5.6 5 2.6"/>'),
    sound: svg('<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16 9a4 4 0 0 1 0 6"/>'),
    replay: svg('<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>'),
    home: svg('<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>'),
    page: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>'),
    atlas: svg('<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>'),
    story: svg('<path d="M4 5h7v14H4zM13 5h7v14h-7z"/>'),
    quest: svg('<path d="M6 21V4h11l-2 4 2 4H6"/>'),
    web: svg('<circle cx="6" cy="6" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 6.5l8 .5M7 8l4 8M17 9l-4 7"/>'),
    dice: svg('<rect x="4" y="4" width="16" height="16"/><circle cx="9" cy="9" r=".8"/><circle cx="15" cy="15" r=".8"/>'),
    up: svg('<path d="M12 20V5M6 11l6-6 6 6"/>'),
    device: svg('<rect x="7" y="3" width="10" height="18"/><path d="M11 18h2"/>'),
    key: svg('<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21M17 12v3M20 12v2"/>'),
    code: svg('<path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/>'),
    play: svg('<rect x="4" y="4" width="16" height="16"/><circle cx="9" cy="9" r=".8"/><circle cx="15" cy="15" r=".8"/><circle cx="15" cy="9" r=".8"/><circle cx="9" cy="15" r=".8"/>'),
    prep: svg('<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    codex: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h7"/>'),
    book: svg('<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z"/><path d="M5 16a4 4 0 0 1 4-4h10"/>')
  };

  /* ---------- The three pages ---------- */
  var PAGES = {
    list: {
      section: "Prep", lit: "Prep",
      tabs: [["Encounters", "swords", 1], ["Party", "party"], ["Maps", "map"], ["Tokens", "token"], ["Sound", "sound"], ["Replays", "replay"]],
      find: "Find an encounter or a map",
      primary: "New encounter",
      title: "Encounters", desc: "Each encounter is a map and who is on it, made live when the table is ready.",
      phoneTabs: [["Encounters", "swords", 1], ["Party", "party"], ["Maps", "map"], ["Tokens", "token"], ["Sound", "sound"]]
    },
    doc: {
      section: "Codex", lit: "Codex",
      tabs: [["Home", "home"], ["Search", "search"], ["Pages", "page", 1], ["Atlas", "atlas"], ["Story", "story"], ["Quests", "quest"], ["Relationships", "web"]],
      find: "Search the Codex",
      primary: "New page",
      title: "Grukk Twotooth", desc: "Person · Goblin chieftain",
      phoneTabs: [["Home", "home"], ["Pages", "page", 1], ["Atlas", "atlas"], ["Campaign", "story"], ["Search", "search"]]
    },
    settings: {
      section: "Settings", lit: "",
      tabs: [["Players", "party"], ["Encounters", "dice", 1], ["Characters", "up"], ["Device", "device"], ["Access", "key"], ["API", "code"]],
      find: "Search settings",
      primary: "",
      title: "Encounters", desc: "How the rules assistant and the turn order treat an encounter.", gm: true,
      phoneTabs: [["Players", "party"], ["Encounters", "dice", 1], ["Characters", "up"], ["Device", "device"], ["Access", "key"]]
    }
  };

  var state = { nav: "titled", head: "records", grp: "mixed", box: "cradle", sub: "base", page: "settings", show: "all" };
  function gcls() { return "g-" + state.grp + " box-" + state.box; }

  function wm() { return '<span class="wm"><span class="wm-ozy">OZY</span><span class="wm-vtt">vtt</span></span>'; }
  function topBar(pg) {
    return '<header class="ap-bar">' + wm() + '<nav class="ap-nav" aria-hidden="true">' + ["Play", "Prep", "Codex", "Compendium"].map(function (n) {
      return "<span" + (n === pg.lit ? ' class="on" data-seat' : "") + ">" + n + "</span>";
    }).join("") + '</nav><div class="ap-end"><span class="lamp-off">' + IC.screen.replace("<svg", '<svg style="width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8"') + 'Table screen <i></i><b>OFF</b></span><span class="ico">' + IC.search + '</span><span class="ico">' + IC.screen + '</span><span class="ico">' + IC.gear + "</span></div></header>";
  }
  function tab(t) { return '<span class="sb-tab' + (t[2] ? " on" : "") + '">' + IC[t[1]] + t[0] + "</span>"; }
  function sectionBar(pg) {
    var title = state.nav === "titled" ? '<span class="sb-title">' + pg.section + "</span>" : "";
    var end = '<div class="sb-end"><span class="find">' + IC.search + pg.find + "<kbd>Ctrl K</kbd></span>" + (pg.primary ? '<button type="button" class="cup">' + pg.primary + "</button>" : "") + "</div>";
    return '<div class="sb ' + state.nav + '">' + title + '<div class="sb-tabs">' + pg.tabs.map(tab).join("") + "</div>" + end + "</div>";
  }

  /* Groups: a group is interactive (act) or for reading */
  // With the Fieldset box a group you act in is a real fieldset, so its heading cuts into the top edge.
  var litOnce = false;
  function grp(head, body, act, extra) {
    if (act && state.box === "field")
      return '<fieldset class="grp act"><legend class="grp-h"><span class="eb">' + head + "</span></legend>" + (extra ? '<div style="display:flex;justify-content:flex-end">' + extra + "</div>" : "") + '<div class="grp-b">' + body + "</div></fieldset>";
    // The first group you act in is drawn lit, so a still picture shows the light; the rest light on hover or focus.
    var lit = act && ["lit", "lf", "rails", "brackets", "cradle", "rails2", "shelf", "side"].indexOf(state.box) >= 0 && !litOnce;
    if (lit) litOnce = true;
    if (act && ["lf", "rails", "brackets", "cradle", "rails2", "field2", "shelf", "side"].indexOf(state.box) >= 0)
      return '<section class="grp act' + (lit ? " is-lit" : "") + '"><div class="edge"><i class="l"></i><span class="eb">' + head + '</span>' + (extra || "") + '<i class="r"></i></div><div class="grp-b">' + body + '</div><b class="base"></b></section>';
    return '<section class="grp' + (act ? " act" : "") + (lit ? " is-lit" : "") + '"><div class="grp-h"><span class="eb">' + head + "</span>" + (extra || "") + '</div><div class="grp-b">' + body + "</div></section>";
  }

  /* ---------- Page header ---------- */
  function header(pg, phone) {
    var isRecord = state.page === "doc";
    if (isRecord && state.head === "band" && !phone) {
      return '<div class="rband"><div class="id"><span class="pic">' + IC.person + '</span><div><h1>' + pg.title + "</h1><p>" + pg.desc + '</p><span class="tag hidden">Hidden</span></div></div>' +
        '<div class="facts"><div><span class="l">Who sees it</span><span class="v s">Hidden</span></div><div><span class="l">Links</span><span class="v">4</span></div><div><span class="l">Mentioned</span><span class="v">2</span></div><div><span class="l">Version</span><span class="v">3</span></div></div>' +
        '<div class="end"><span class="btn">See it as' + IC.down + '</span><span class="btn">Reveal</span><span class="btn">Edit</span><span class="btn ico-only" aria-label="More">' + IC.dots + "</span></div></div>";
    }
    if (isRecord) {
      return '<div class="ph"><div><div class="t"><h1>' + pg.title + '</h1><span class="tag hidden">Hidden</span></div><p>' + pg.desc + '</p></div><div class="ph-end"><span class="btn">See it as' + IC.down + '</span><span class="btn">Reveal</span><span class="btn">Edit</span><span class="btn ico-only" aria-label="More">' + IC.dots + "</span></div></div>";
    }
    if (state.head === "records") return "";
    var gm = pg.gm ? '<span class="tag gm">GM only</span>' : "";
    return '<div class="ph' + (state.page === "settings" ? " measure" : "") + '"><div><div class="t"><h1>' + pg.title + "</h1>" + gm + "</div><p>" + pg.desc + "</p></div></div>";
  }
  function descLine(pg) {
    if (state.head !== "records" || state.page === "doc") return "";
    return '<p class="desc-line">' + (pg.gm ? '<span class="tag gm">GM only</span>' : "") + pg.desc + "</p>";
  }

  /* ---------- Bodies ---------- */
  var ENC = [
    ["a", "Owlbear den", "Thornwood clearing", '<span class="live"><i></i>LIVE</span>', "3", "Owlbear", 78, "Hard", "2 days ago"],
    ["b", "Goblin ambush", "Old road", '<span class="tag ready">Ready</span>', "3", "Goblin × 4, Goblin Boss", 52, "Medium", "3 days ago"],
    ["c", "The drowned crypt", "No map yet", '<span class="tag need">Needs a map</span>', "3", "Ghoul × 3", 96, "Deadly", "Last week"],
    ["d", "Bandit toll bridge", "River crossing", '<span class="tag draft">Draft</span>', "None", "Bandit × 5, Bandit Captain", 50, "Medium", "Last week"]
  ];
  function toolbar(phone) {
    return '<div class="tbar"><span class="btn">' + IC.filter + 'Filters</span>' + (phone ? "" : '<span class="btn">State: all 4' + IC.down + '</span><span class="btn">Modified: any time' + IC.down + "</span>") + '<span class="count">4 encounters</span><span class="btn">Sort: Your order</span></div>';
  }
  function listBody(pg) {
    var table = '<table class="ttable"><thead><tr><th>Encounter</th><th>State</th><th>Party</th><th>Monsters</th><th>Difficulty</th><th>Changed</th></tr></thead><tbody>' + ENC.map(function (e) {
      return '<tr><td><div class="nm"><span class="thumb ' + e[0] + '"></span><div><b>' + e[1] + "</b><span>" + e[2] + "</span></div></div></td><td>" + e[3] + "</td><td>" + e[4] + "</td><td>" + e[5] + '</td><td><span class="meter"><i><b style="width:' + e[6] + '%"></b></i>' + e[7] + "</span></td><td>" + e[8] + "</td></tr>";
    }).join("") + "</tbody></table>";
    return '<div class="pg-body ' + gcls() + '">' + descLine(pg) + toolbar() + '<div class="tgrp">' + table + "</div></div>";
  }
  function docBody() {
    var doc = '<article class="doc"><p class="lead">The chieftain of the warren under the Old road. Grukk took the second tooth from a dwarf who tried to collect a toll from him, and wears it on a cord.</p>' +
      '<h3>What Grukk wants</h3><p>Safe passage for the warren\'s raiders, and a cut of whatever the <a>Bent Nail Inn</a> moves north. Grukk trades fairly with anyone who pays first.</p>' +
      '<div class="hblock"><div class="hb-h">' + IC.eyeoff + 'Hidden<button type="button" class="lnk">Reveal</button></div><p>Grukk answers to the hag in <a>Thornwood</a>. The tooth is hers: if it is taken, the warren scatters within a day.</p></div>' +
      '<h3>Where to find Grukk</h3><p>The throne room at the bottom of the <a>Goblin warren</a>, behind two guards and a pit the goblins step around without looking.</p></article>';
    var side = '<aside class="side">' +
      grp("Who sees it", '<div class="chips"><span class="chip">Everyone</span><span class="chip on hid">Hidden</span><span class="chip">Lyra</span><span class="chip">Mirena</span><span class="chip">Borin</span></div>', true) +
      grp("Links", "<ul><li><a>Old road</a><span>Place</span></li><li><a>Goblin warren</a><span>Place</span></li><li><a>Bent Nail Inn</a><span>Place</span></li><li><a>Thornwood</a><span>Place</span></li></ul>") +
      grp("Mentioned in", "<ul><li><a>Session 4 recap</a><span>Session</span></li><li><a>Goblin ambush</a><span>Encounter</span></li></ul>") +
      grp("History", '<ul><li>Version 3<span>Today</span></li><li>Version 2<span>Last week</span></li></ul>', false, '<button type="button" class="lnk" style="margin-left:auto">Compare</button>') + "</aside>";
    return '<div class="docwrap ' + gcls() + '">' + doc + side + "</div>";
  }
  function setRow(label, hint, ctl, sw) { return '<div class="srow' + (sw ? " has-sw" : "") + '"><div><b>' + label + "</b>" + (hint ? "<span>" + hint + "</span>" : "") + "</div>" + ctl + "</div>"; }
  function seg(opts, on) { return '<span class="segc">' + opts.map(function (o, i) { return "<span" + (i === on ? ' class="on"' : "") + ">" + o + "</span>"; }).join("") + "</span>"; }
  function settingsBody(pg) {
    var checks = [["Check movement", 1], ["Check the action economy", 1], ["Check limited uses", 1], ["Check targeting, range and cover", 1], ["Check spell slots and prepared spells", 0]].map(function (c) {
      return setRow(c[0], "", '<span class="sw' + (c[1] ? " on" : "") + '"></span>', true);
    }).join("");
    var body = grp("Rules assistant", setRow("When a move breaks the rules", "Each encounter starts with this, and you can change it mid-encounter on the Table.", seg(["Enforce", "Advise", "Off"], 0)) + '<p class="eb sub-h">What it checks</p>' + checks, true) +
      grp("Players' hits", setRow("Damage from a player's attack", "Whether it waits for you to apply it.", seg(["Applied by the GM", "Applied immediately"], 0)), true) +
      grp("Initiative", setRow("Players roll their own initiative", "Otherwise the app rolls for everyone.", '<span class="sw on"></span>', true) + setRow("Group identical monsters", "Five goblins share one turn.", '<span class="sw"></span>', true), true);
    return '<div class="pg-body measure ' + gcls() + '">' + descLine(pg) + body + "</div>";
  }

  /* The gallery: the box wherever a group takes input, and one reading group beside them */
  function galleryBody() {
    function cell(cap, html) { return "<div><p class=\"cap\">" + cap + "</p>" + html + "</div>"; }
    var life = ""; for (var i = 0; i < 22; i++) life += i < 19 ? "<i></i>" : '<i class="lost"></i>';
    var abil = [["Strength", 8, "−1", "−1", 0], ["Dexterity", 14, "+2", "+2", 0], ["Intelligence", 18, "+4", "+7", 1], ["Wisdom", 12, "+1", "+4", 1]].map(function (a) {
      return '<div class="lrow"><div class="n"><b>' + a[0] + "</b><span>" + a[1] + '</span></div><span class="m">' + a[2] + '</span><span class="s"><span class="pfm' + (a[4] ? " p" : "") + '"></span>' + a[3] + "</span></div>";
    }).join("");
    var hp = '<div class="hpc"><div class="top"><span class="cur">38</span><span class="max">/ 44</span><span class="tmp">Temp 0</span></div><div class="life">' + life + '</div><div class="hpctl"><span class="amt">7</span><span class="btn dmg">Damage</span><span class="btn">Heal</span><span class="btn">Temp</span></div></div>';
    var table = '<div class="tgrp"><table class="ttable"><thead><tr><th>Encounter</th><th>State</th><th>Difficulty</th></tr></thead><tbody>' + ENC.slice(0, 3).map(function (e) {
      return '<tr><td><div class="nm"><span class="thumb ' + e[0] + '"></span><div><b>' + e[1] + "</b><span>" + e[2] + "</span></div></div></td><td>" + e[3] + '</td><td><span class="meter"><i><b style="width:' + e[6] + '%"></b></i>' + e[7] + "</span></td></tr>";
    }).join("") + "</tbody></table></div>";
    return '<div class="gal ' + gcls() + '">' +
      cell("Settings, Encounters", grp("Players' hits", setRow("Damage from a player's attack", "Whether it waits for you to apply it.", seg(["By the GM", "At once"], 0)) + setRow("Group identical monsters", "", '<span class="sw on"></span>', true), true)) +
      cell("Character sheet, the Ledger", grp("Abilities", abil, true)) +
      cell("Character sheet, Hit Points", grp("Hit points", hp, true)) +
      cell("Codex page, side panel", grp("Who sees it", '<div class="chips"><span class="chip">Everyone</span><span class="chip on hid">Hidden</span><span class="chip">Lyra</span><span class="chip">Mirena</span><span class="chip">Borin</span></div>', true)) +
      '<div class="wide2">' + cell("Prep, a table", table).slice(5) +
      cell("A group you only read stays open", '<div class="side">' + grp("Links", "<ul><li><a>Old road</a><span>Place</span></li><li><a>Goblin warren</a><span>Place</span></li><li><a>Bent Nail Inn</a><span>Place</span></li></ul>") + "</div>") +
      "</div>";
  }

  /* ---------- Frames ---------- */
  function laptop() {
    var pg = PAGES[state.page];
    litOnce = false;
    if (state.page === "gallery") return '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-' + state.sub + '">' + topBar(PAGES.settings) + '<div class="ap-pane">' + galleryBody() + "</div></div></div>";
    var body = state.page === "list" ? listBody(pg) : state.page === "doc" ? docBody() : settingsBody(pg);
    return '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-' + state.sub + '">' + topBar(pg) +
      '<div class="ap-pane"><div class="pg">' + sectionBar(pg) + header(pg, false) + body + "</div></div></div></div>";
  }
  function phone() {
    litOnce = false;
    if (state.page === "gallery") return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-' + state.sub + '"><header class="pbar"><h1>Groups</h1></header><div class="ap-pane">' + galleryBody() + '</div><nav class="ap-bottom" aria-hidden="true"><span>' + IC.play + "Play</span><span>" + IC.prep + "Prep</span><span>" + IC.codex + "Codex</span><span>" + IC.book + "Compendium</span></nav></div></div>";
    var pg = PAGES[state.page];
    var titleBar = state.head === "records" && state.page !== "doc" ? pg.section : state.page === "doc" ? pg.section : pg.title;
    var icons = '<div class="end"><span class="ico">' + IC.search + "</span>" + (pg.primary ? '<span class="ico">' + IC.plus + "</span>" : "") + '<span class="ico">' + IC.gear + "</span></div>";
    var strip = state.nav === "boxed"
      ? '<div class="pstrip boxed"><div class="inner">' + pg.phoneTabs.map(tab).join("") + "</div></div>"
      : '<div class="pstrip">' + pg.phoneTabs.map(tab).join("") + "</div>";
    var body;
    if (state.page === "list") {
      body = '<div class="pbody ' + gcls() + '">' + descLine(pg) + toolbar(true) + '<div class="tgrp">' + ENC.map(function (e) {
        return '<div class="prow" style="padding:0 ' + (state.grp === "open" ? "0" : "12px") + '"><span class="thumb ' + e[0] + '"></span><div><b>' + e[1] + "</b><span>" + e[3].replace(/<[^>]+>/g, "").replace("LIVE", "Live") + " · " + e[7] + '</span></div><span class="chev">›</span></div>';
      }).join("") + "</div></div>";
    } else if (state.page === "doc") {
      var facts = state.head === "band" ? '<div class="pfacts"><div><span class="facts l" style="display:block"></span><span class="eb" style="font-size:10px">Who sees it</span><span style="font:600 13px var(--f-label);color:var(--violet)">Hidden</span></div><div><span class="eb" style="font-size:10px">Links</span><span class="num" style="font-size:24px">4</span></div><div><span class="eb" style="font-size:10px">Version</span><span class="num" style="font-size:24px">3</span></div></div>' : "";
      body = '<div class="pbody"><div class="ptitle"><div class="ttl-rec"><h2>' + pg.title + '</h2><span class="tag hidden">Hidden</span></div><p>' + pg.desc + "</p></div>" + facts +
        '<article class="doc"><p class="lead">The chieftain of the warren under the Old road. Grukk took the second tooth from a dwarf who tried to collect a toll, and wears it on a cord.</p><div class="hblock"><div class="hb-h">' + IC.eyeoff + 'Hidden<button type="button" class="lnk">Reveal</button></div><p>Grukk answers to the hag in <a>Thornwood</a>.</p></div><p>Safe passage for the warren\'s raiders, and a cut of whatever the <a>Bent Nail Inn</a> moves north.</p></article>' +
        '<div class="pfold"><div class="prow"><div><b>Who sees it</b><span>Hidden</span></div><span class="chev">›</span></div><div class="prow"><div><b>Links and mentions</b><span>4 links · 2 mentions</span></div><span class="chev">›</span></div><div class="prow"><div><b>History</b><span>Version 3 · today</span></div><span class="chev">›</span></div></div></div>';
    } else {
      body = '<div class="pbody ' + gcls() + '">' + settingsBody(pg).replace('<div class="pg-body measure ' + gcls() + '">', "<div>") + "</div>";
    }
    var head = state.page === "list" && state.head !== "records" ? "" : "";
    return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-' + state.sub + '"><header class="pbar"><h1>' + titleBar + "</h1>" + (pg.gm && titleBar === pg.title ? '<span class="tag gm" style="margin-left:6px">GM only</span>' : "") + icons + "</header>" +
      '<div class="ap-pane">' + strip + head + body + "</div>" +
      '<nav class="ap-bottom" aria-hidden="true"><span' + (pg.lit === "Play" ? ' class="on"' : "") + ">" + IC.play + "Play</span><span" + (pg.lit === "Prep" ? ' class="on"' : "") + ">" + IC.prep + "Prep</span><span" + (pg.lit === "Codex" ? ' class="on"' : "") + ">" + IC.codex + "Codex</span><span>" + IC.book + "Compendium</span></nav></div></div>";
  }

  /* ---------- What each option means ---------- */
  var DEC = {
    nav: { name: "Section bar", chosen: "Titled", text: "The section's name in Chakra Petch at the left, then its pages as words on the bar's line with the horizon ink under the one you're on. Search and the primary at the right end." },
    head: { name: "Page header", chosen: "Records only", text: "Lists and settings start with their content, because the bar names the page; a one-line description stays where it helps. A record (a Codex page, an encounter, a creature) shows its own title." },
    grp: { name: "Groups", chosen: "Mixed", text: "A group you act in is a box. A group you only read is open: a heading and a 1 px rule. Whether a group has a box tells you whether it takes input." },
    box: {
      name: "The box",
      what: "How a group you act in is drawn: settings, Who sees it, a table, and the character sheet's cards.",
      opts: {
        rails2: ["Rails, refined", "The heading sits flush on the top rule, which runs out to the right and fades before the end, so the group has a start and no hard edges. A faint rule that fades at both ends closes it. While you work in it, light runs from the heading along the top rule and fades with it."],
        field2: ["Fieldset, refined", "Round 2's frame in a softer line, with the heading set into the top edge 14 px in, a faint glass fill so it holds together on the sky, and row dividers that run to the frame. No light: it stays still."],
        cradle: ["Cradle · chosen", "A base and sides that rise from it and fade before the top, open where the heading sits. The base lights from the middle outward while you work in it."],
        lit: ["Lit edge", "Kept from round 2: a quiet plate whose top edge lights cyan while you work in it."],
        shelf: ["Shelf", "New. The heading above, and the group standing on a 2 px base with a faint wash rising from it, no sides and no top. The base lights from the middle outward while you work in it, like the Cup's press in grey."],
        side: ["Side rail", "New. A 2 px rail down the group's left edge with the heading at its top, the content set in beside it. While you work in it, light runs down the rail."]
      },
      today: "One plate for everything: a 1 px edge and a heading inside it, the same for a block of settings and a list of links."
    },
    sub: {
      name: "Secondary controls",
      what: "Every control that isn't the primary: secondary buttons (See it as, Reveal, Edit, Filters, Damage), chips you choose from, and segmented controls.",
      opts: {
        today: ["Today", "The current boxes: a 1 px raised edge and a filled plate, for comparison."],
        base: ["Base line · chosen", "No box. The label sits on a 1 px base line, and the line lights cyan on hover; a chosen chip or option keeps a 2 px cyan base. The same idea as a tab's ink, in grey until it means something."],
        cradle: ["Cradle", "A small grey cup: a base and sides that fade before the top, no fill. The Cup primary's shape without its horizon, so primary and secondary read as one family. A chosen chip fills with a faint cyan wash."],
        ghost: ["Ghost", "The box kept but emptied: a softer 1 px edge and no fill, the label in grey until you point at it. A chosen chip takes a cyan edge."],
        tint: ["Tint", "No edge. A soft fill marks the control, and a 1 px cyan base appears on hover. A chosen chip is tinted cyan with a 2 px base."]
      },
      today: "Every secondary button, chip and segmented option is a filled box with a raised edge, so a row of them reads as a row of plates."
    }
  };

  function renderIdea() {
    var r1 = '<div><p class="eyebrow">Rounds 1 to 4 · approved</p><h2>Titled · Records only · Mixed</h2><p>' + DEC.nav.text + "</p><p style=\"margin-top:8px\">" + DEC.head.text + "</p><p style=\"margin-top:8px\">" + DEC.grp.text + "</p></div>";
    function card(n, k) {
      var d = DEC[k], o = d.opts[state[k]];
      return '<div><p class="eyebrow">' + n + " · " + d.name + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }
    $("#idea").innerHTML = r1 + card(4, "box") + card(5, "sub");
  }

  /* ---------- Today, settled rules, patterns ---------- */
  function renderStatic() {
    var A = window.AUDIT || {};
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    $("#today").innerHTML =
      '<div class="today-strip"><p class="eyebrow">1 · Section bars</p>' + fig("bar-prep", "Prep: plain words") + fig("bar-codex", "Codex: boxed, with icons") + fig("bar-compendium", "Compendium: a title, then a boxed group") + fig("bar-settings", "Settings: boxed, with icons") + "</div>" +
      '<div class="today-strip"><p class="eyebrow">2 · Page headers</p>' + fig("head-codex", "Codex home") + fig("head-roster", "Roster") + fig("head-replays", "Replays") + fig("head-access", "Settings, Access") + fig("head-builder", "Character builder") + "</div>" +
      '<div class="today-strip"><p class="eyebrow">3 · Groups</p>' + fig("grp-codexhome", "Codex home") + fig("grp-sound", "Sound") + fig("grp-settings", "Settings, Encounters") + "</div>";

    var R = [
      ["Section bar: Titled", '<div style="display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--line-strong);padding-bottom:6px"><span style="font:600 14px var(--f-display);letter-spacing:.06em;padding-right:10px;border-right:1px solid var(--line-strong)">PREP</span><div class="mini-tabs" style="border:0"><span class="on">Encounters</span><span>Party</span><span>Maps</span></div></div>', "Every section's bar: its name in Chakra Petch, then its pages as words with the horizon ink. Search and the primary at the right end. On a phone the header shows the name and the strip holds the pages.", "Prep plain, Codex and Settings boxed with icons, the Compendium titled and boxed."],
      ["Page header: Records only", '<div style="display:grid;gap:6px"><span style="font-size:13px;color:var(--text-dim)">Each encounter is a map and who is on it.</span><span style="font:600 18px var(--f-display);letter-spacing:.04em">GRUKK TWOTOOTH</span></div>', "Lists and settings start with their content and at most one line of description. A record shows its own title, in Chakra Petch, with its tags and actions.", "CODEX and ROSTER titles, REPLAYS with a rule, an eyebrow over the builder's title."],
      ["Groups: Mixed", '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:var(--text-dim)"><div style="border:1px solid var(--line-strong);padding:8px">Settings · a box</div><div style="border-top:1px solid var(--line-strong);padding:8px 0">Links · open</div></div>', "A group that takes input is a box; a group you only read is a heading and a rule.", "Every group is a plate, reading or not."],
      ["The box: Cradle", '<div style="position:relative;padding:6px 12px 12px"><span class="eb">Players\' hits</span><div style="margin-top:8px;font-size:13px;color:var(--text-dim)">Damage from a player\'s attack</div><div style="position:absolute;inset:6px 0 0;border:1px solid transparent;border-top:0;border-bottom-width:2px;border-image:linear-gradient(to bottom,transparent,var(--line-raised) 55%) 1"></div><div style="position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--cyan);box-shadow:var(--glow-on)"></div></div>', "A base and sides that rise from it and fade before the top; the heading sits in the open top. No fill. The base lights cyan from the middle outward while you work inside (hover or focus within), the way Light rail lights a line that is already there.", "Plates with a 1 px edge and a heading inside, for every kind of group."],
      ["Secondary controls: Base line", '<div style="display:flex;gap:10px;flex-wrap:wrap"><span class="btn" style="border-color:transparent;background:none;box-shadow:inset 0 -1px 0 var(--line-raised)">Reveal</span><span class="chip" style="border-color:transparent;background:none;color:var(--text);box-shadow:inset 0 -2px 0 var(--cyan)">Lyra</span><span class="chip" style="border-color:transparent;background:none;color:var(--text-dim);box-shadow:inset 0 -1px 0 var(--line-raised)">Mirena</span></div>', "A secondary button, a chip or a segmented option is its label on a 1 px base line. Hover lights the line cyan; a chosen chip or option keeps a 2 px cyan line. A hidden choice keeps its violet, dashed. Fields stay boxed: they take typing.", "Every secondary control is a filled box with a raised edge."],
      ["One row of tabs", '<div class="mini-tabs"><span>Encounters</span><span class="on">Maps</span><span>Tokens</span></div>', "A surface has its section bar and at most one view switch, a segmented control under its header. Never a strip inside a strip, and a page never repeats its section bar's choices.", "Prep repeats Maps and Encounters under its own bar; Story adds a strip under the Codex bar; a phone Codex stacks three."],
      ["One primary, in a fixed place", '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span style="font-size:12px;color:var(--text-muted)">Section bar, right end</span><span class="cup" style="min-height:34px;font-size:12px;padding:0 12px">New encounter</span></div>', "Lists and sections: the right end of the section bar. Steps and forms: the bottom right of the step. The table: the panel's footer. A dialog: its footer. An empty list shows a secondary button that does the same thing.", "Prep and the Roster put their primary in the page as a large button; Prep's empty state adds a second Cup."],
      ["Empty states", '<div style="display:grid;gap:8px;justify-items:start"><span style="font-size:14px;color:var(--text-dim)">No encounters yet.</span><span class="btn">New encounter</span></div>', "One line saying what is missing and one button that fixes it, in the space the content would fill. No heading, icon or plate.", "The Atlas puts NO MAP YET in a plate with a Cup; Access adds an icon and a heading; Relationships has a centred sentence and no button."],
      ["Steps", '<div class="mini-steps"><div class="done"><i><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:3"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></i>Map</div><div class="cur"><i>2</i>Tokens and monsters</div><div class="need"><i>!</i>Walls and light</div></div>', "One Steps rail everywhere: done is a cyan check, current a cyan outline, a step that needs a choice an amber mark. Numbers in VT323.", "The map and encounter editors use magenta circles; the builder uses numbered squares."],
      ["A number you roll is the button", '<div><div class="mini-sk"><span class="pf p"></span><span>Arcana</span><span class="b">+10</span></div><div class="mini-sk"><span class="pf"></span><span>Athletics</span><span class="b">−1</span></div></div>', "The whole row or cell is the control, with no box drawn around the number. Hover tints the row and lights the number. From the character sheet.", "Bonuses sit in boxes on the sheet and in the dice panel."],
      ["Plates", '<div style="border:1px solid var(--line-strong);background:var(--glass-s1)"><div style="padding:8px 12px;border-bottom:1px solid var(--line)" class="eb">Hit points</div><div style="padding:8px 12px;font:400 26px var(--f-num);color:var(--hp-text)">38 <span style="font-size:16px;color:var(--text-muted)">/ 44</span></div></div>', "When a group is a plate it has a 1 px edge, square corners and 1 px dividers inside. A plate never holds another plate.", "Cards inside cards on Codex home and the sound board."],
      ["GM-only is a tag", '<div style="display:flex;align-items:center;gap:10px"><span class="eb">Encounters</span><span class="tag gm">GM only</span></div>', "A violet GM ONLY tag on the group's heading or the page's title. No violet bar on the plate. Hidden content keeps its dashed violet box.", "Settings groups also carry a violet bar down their left edge."],
      ["Density", '<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:13px;color:var(--text-dim)"><span class="num" style="font-size:20px">44</span><span>rows on a phone and with touch</span><span class="num" style="font-size:20px">48</span><span>table rows</span><span class="num" style="font-size:20px">36</span><span>GM data with a mouse</span><span class="num" style="font-size:20px">30</span><span>sheet skills with a mouse</span></div>', "Every control keeps a 44 px hit area. Compact rows paint smaller only with a mouse and no touch screen: GM data regions, and the character sheet's skills.", "Settled by the character sheet and DESIGN.md."],
      ["Colour keeps one meaning", '<div class="sw-row"><span class="swatch"><i style="background:var(--hp)"></i>Hit points</span><span class="swatch"><i style="background:var(--hostile)"></i>Damage, danger</span><span class="swatch"><i style="background:var(--cyan)"></i>Chosen, proficient, target</span><span class="swatch"><i style="background:var(--party)"></i>Party, slots</span><span class="swatch"><i style="background:var(--violet)"></i>GM only, hidden</span><span class="swatch"><i style="background:var(--caution)"></i>Wait, needs you</span><span class="swatch"><i style="background:var(--hz-paint)"></i>Top edge, chosen tab, primary</span></div>', "Gold, red, cyan, blue, violet and amber each carry one meaning. The horizon is the top of the app, the chosen tab and the primary's lines, and nothing else.", "The map and encounter editors light their current step in magenta."],
      ["Type", '<div style="display:grid;gap:6px"><div class="type-row"><span style="font:600 20px var(--f-display);letter-spacing:.04em;text-transform:uppercase">Grukk Twotooth</span><span style="font-size:12px;color:var(--text-muted)">Chakra Petch · titles</span></div><div class="type-row"><span style="font:600 14px var(--f-label)">Players roll their own initiative</span><span style="font-size:12px;color:var(--text-muted)">Bai Jamjuree · words</span></div><div class="type-row"><span style="font:400 26px var(--f-num)">+10 · DC 15</span><span style="font-size:12px;color:var(--text-muted)">VT323 · numbers</span></div></div>', "One or two display titles per view. Bungee only as chrome: the wordmark, YOUR TURN and the acting name.", "Settled by ADR-0046."],
      ["Widths", '<div style="display:grid;gap:5px"><div style="height:10px;background:color-mix(in srgb,var(--cyan) 30%,var(--s2))"></div><div style="height:10px;width:62%;margin:0 auto;background:color-mix(in srgb,var(--cyan) 30%,var(--s2))"></div><div style="height:10px;width:48%;background:color-mix(in srgb,var(--cyan) 30%,var(--s2))"></div></div>', "Workbenches, lists and tables use the full width. Settings and forms centre at 880 px. Reading text keeps a 680 px measure.", "Settings, Pages and Replays each centre at their own width."],
      ["Phones", '<div style="display:grid;gap:4px;font-size:12.5px;color:var(--text-dim)"><span>Header row: title and up to two icons</span><span>One strip of pages, if the section has pages</span><span>The content, scrolling</span><span>Bottom tabs</span></div>', "Every phone page stacks the same four things. A primary moves to the header as an icon or to the foot of the content.", "Page headers differ by section; Prep has none; the Codex adds a second and third strip."]
    ];
    $("#rules").innerHTML = R.map(function (r) {
      return '<div class="rule"><h3>' + r[0] + '</h3><div class="vis">' + r[1] + "</div><div><p>" + r[2] + '</p><p class="today" style="margin-top:8px"><b>Today</b> · ' + r[3] + "</p></div></div>";
    }).join("");

    function sch(cols, rows, cells) { return '<div class="sch" style="grid-template-columns:' + cols + ";grid-template-rows:" + rows + '">' + cells + "</div>"; }
    function c(t, area, k) { return '<div class="' + (k || "") + '" style="grid-area:' + area + '">' + t + "</div>"; }
    var P = [
      ["Workbench", "The map in the middle, tools on the left, one tabbed panel on the right, turn order across the top.", "C, the table · E1.3 encounter page", sch("14px 1fr 70px", "12px 1fr", c("strip", "1/1/2/4", "hz") + c("", "2/1/3/2") + c("map", "2/2/3/3") + c("panel", "2/3/3/4", "k"))],
      ["Sheet", "A vitals band, columns of what you read, one tabbed box for what you do.", "D1 character sheet · creatures", sch("1fr 1fr 2fr", "18px 1fr", c("band", "1/1/2/4", "hz") + c("", "2/1/3/2") + c("", "2/2/3/3") + c("tabs", "2/3/3/4", "k"))],
      ["Record document", "The record as its readers see it in the middle, a panel on the right answering what the GM asks about it.", "F2 Codex page · G6 Compendium record · E2.2 map page", sch("2fr 1fr", "16px 1fr", c("title", "1/1/2/3") + c("document", "2/1/3/2") + c("panel", "2/2/3/3", "k"))],
      ["List as a table", "A toolbar of filters, sort and count, then a sortable table; rows with two facts on a phone.", "E1.2, E2.1, E3.1, E3.3 · G2 · I6 · I7", sch("1fr", "14px 1fr", c("toolbar", "1/1/2/2") + c("table", "2/1/3/2", "k"))],
      ["Making as steps", "Steps down the left, questions in the middle, a live preview on the right; a strip of steps and a preview bar on a phone.", "D3 builder · E1.4, E2.3 editors · G7 studio", sch("40px 1fr 1fr", "1fr 16px", c("steps", "1/1/3/2") + c("questions", "1/2/2/3") + c("preview", "1/3/3/4", "k") + c("next", "2/2/3/3"))],
      ["Settings rows", "Groups of rows: a label and hint on the left, the control on the right, centred at 880 px.", "I, settings · F6 Codex tools", sch("1fr 2fr 1fr", "1fr 1fr 1fr", c("", "1/1/4/2", "") + c("row", "1/2/2/3", "k") + c("row", "2/2/3/3", "k") + c("row", "3/2/4/3", "k") + c("", "1/3/4/4", ""))],
      ["Arrival", "The sunset scene with one card or one pair of buttons; nothing else on screen.", "B, arrival · H1 pair this screen", sch("1fr 1fr 1fr", "1fr 1fr", c("sunset", "1/1/3/4") + c("card", "2/2/3/3", "k"))],
      ["Dialog", "A title on the horizon edge, the content, and a footer with the primary on the right. Bottom sheet on a phone.", "Every Modal and Drawer", sch("1fr 2fr 1fr", "1fr 3fr 1fr", c("", "1/1/4/2") + c("dialog", "1/2/4/3", "hz k") + c("", "1/3/4/4"))]
    ];
    $("#pats").innerHTML = P.map(function (p) { return '<div class="pat"><h3>' + p[0] + "</h3>" + p[3] + "<p>" + p[1] + '</p><p class="use">' + p[2] + "</p></div>"; }).join("");
  }

  /* ---------- Page ---------- */
  function renderStage() {
    var pgName = { list: "Prep, Encounters", doc: "Codex, a page", settings: "Settings, Encounters", gallery: "the box in six places" }[state.page];
    $("#cap-laptop").textContent = "Laptop · " + pgName;
    $("#cap-phone").textContent = "Phone · " + pgName;
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
  function press(groupId, attr, val) { $$("#" + groupId + " button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute(attr) === val)); }); }
  function sync() {
    press("box-seg", "data-box", state.box);
    press("sub-seg", "data-sub", state.sub);
    press("page-seg", "data-page", state.page);
    press("view-seg", "data-show", state.show);
    $("#stage").dataset.show = state.show;
  }
  function writeHash() { try { history.replaceState(null, "", "#" + [state.box, state.sub, state.page].join(".")); } catch (e) { /* the frame may refuse it */ } }
  function readHash() {
    var h = location.hash.slice(1).split(".");
    if (["rails2", "field2", "cradle", "lit", "shelf", "side", "lf", "rails", "brackets", "field", "strip", "well"].indexOf(h[0]) >= 0) state.box = h[0];
    if (["today", "base", "cradle", "ghost", "tint"].indexOf(h[1]) >= 0) state.sub = h[1];
    if (["settings", "doc", "list", "gallery"].indexOf(h[2]) >= 0) state.page = h[2];
  }
  function bind(groupId, attr, key) {
    $$("#" + groupId + " button").forEach(function (b) {
      b.addEventListener("click", function () {
        state[key] = b.getAttribute(attr);
        sync();
        if (key !== "show") { renderIdea(); renderStage(); writeHash(); } else fit();
      });
    });
  }
  bind("box-seg", "data-box", "box");
  bind("sub-seg", "data-sub", "sub");
  bind("page-seg", "data-page", "page");
  bind("view-seg", "data-show", "show");

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
  if (window.matchMedia && window.matchMedia("(max-width: 650px)").matches) state.show = "phone";
  sync();
  renderIdea();
  renderStatic();
  renderStage();
  paintTheme();
})();
