(function () {
  "use strict";
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* ---------- Icons ---------- */
  function svg(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>"; }
  var IC = {
    back: svg('<path d="M14 6l-6 6 6 6"/>'),
    fwd: svg('<path d="M10 6l6 6-6 6"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    down: svg('<path d="M7 10l5 5 5-5"/>'),
    up: svg('<path d="M7 14l5-5 5 5"/>'),
    dots: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    play: svg('<rect x="4" y="4" width="16" height="16"/><circle cx="9" cy="9" r=".8"/><circle cx="15" cy="15" r=".8"/><circle cx="15" cy="9" r=".8"/><circle cx="9" cy="15" r=".8"/>'),
    prep: svg('<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    codex: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h7"/>'),
    book: svg('<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z"/><path d="M5 16a4 4 0 0 1 4-4h10"/>'),
    screen: svg('<rect x="3" y="5" width="18" height="12"/><path d="M9 20h6M12 17v3"/>'),
    gear: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>'),
    party: svg('<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.4"/><path d="M3 19c1-3 3.5-4.5 6-4.5s5 1.5 6 4.5M15 15c2 0 4.5 1 5.5 4"/>'),
    moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
    out: svg('<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>'),
    pause: svg('<path d="M8 5v14M16 5v14"/>'),
    playtri: svg('<path d="M7 5l12 7-12 7z"/>'),
    eye: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
    ping: svg('<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="10"/>'),
    ruler: svg('<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>'),
    vol: svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>'),
    voloff: svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>'),
    popout: svg('<path d="M14 4h6v6M20 4l-8 8M18 14v6H4V6h6"/>'),
    map: svg('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    shield: svg('<path d="M12 3l7 3v5.5c0 4.6-3 8-7 9.5-4-1.5-7-4.9-7-9.5V6z"/><path d="M12 7.5v9M8.5 11h7"/>'),
    bolt: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
    prism: svg('<path d="M12 3l9 17H3z"/><path d="M12 3v17"/>'),
    hand: svg('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 14.5a1.5 1.5 0 0 1 2.4-1.8L8 15"/>'),
    paw: svg('<circle cx="7" cy="9" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="17" cy="9" r="2"/><path d="M12 11c-3 0-6 4-6 6.5 0 1.5 1.5 2.5 3 2 1-.3 2-.8 3-.8s2 .5 3 .8c1.5.5 3-.5 3-2C18 15 15 11 12 11z"/>'),
    eyeoff: svg('<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.3 3.9M6.5 7.6A17 17 0 0 0 2 12s4 7 10 7a10 10 0 0 0 4.4-1"/>')
  };

  /* ---------- State ---------- */
  var S = { d1: "refined", s1: "rail", s2: "onscreen", s3: "chips", s4: "page", s5: "today", pg: "board", show: "all", lz: "close" };
  var KEYS = ["s1", "s2", "s3", "s4", "s5", "pg"];
  var VALID = { s1: ["today", "desk", "rail", "panes", "decks"], s2: ["today", "onscreen", "vcr", "card", "foot"], s3: ["today", "chips", "menu", "drag", "dialog"], s4: ["today", "cards", "side", "strip", "page"], s5: ["today", "inplace", "pip", "side", "full"], pg: ["board", "now", "add", "enc", "seeas"] };
  var A = window.AUDIT || {};
  var MAP = window.MAPIMG || "";

  /* ---------- Data: round 2 of a fight on the old road ---------- */
  // What the screen already receives: names, portraits, initiative, who acts and who is next, a GM turn for a hidden
  // creature, the round, the latest public roll, and tokens the party can see.
  var TURNS = [
    { n: "Goblin Boss", i: 17, foe: 1, e: "hand", c: "var(--hostile)" },
    { n: "Borin Stoneguard", f: "Borin", i: 16, e: "shield", c: "var(--party)", act: 1 },
    { n: "Wolf", i: 12, foe: 1, e: "paw", c: "var(--hostile)", next: 1 },
    { n: "Lyra Emberwise", f: "Lyra", i: 9, e: "bolt", c: "#ffd23f" },
    { gm: 1, n: "GM turn", i: 7 },
    { n: "Mirena Dawnbright", f: "Mirena", i: 6, e: "prism", c: "var(--cyan)" }
  ];
  var ROUND = "02";
  var ROLL = { who: "Borin", what: "Longsword attack", total: 25, dice: "d20 18 + 7" };
  var TOKS = [["BS", 44, 56, 0, 1, "Borin"], ["LE", 35, 64, 0, 0, "Lyra"], ["MD", 29, 51, 0, 0, "Mirena"], ["GB", 62, 41, 1, 0, "Goblin Boss"], ["W", 54, 60, 1, 0, "Wolf"]];
  var CODE = ["826", "427"];

  /* ---------- Parts ---------- */
  function btn(t, i, cls) { return '<span class="e-btn' + (cls ? " " + cls : "") + '">' + (i ? IC[i] : "") + t + "</span>"; }
  function menu(t, cls) { return '<span class="e-btn' + (cls ? " " + cls : "") + '">' + t + IC.down + "</span>"; }
  function ico(n) { return '<span class="e-ico">' + IC[n] + "</span>"; }
  function cup(t, cls) { return '<span class="cup' + (cls ? " " + cls : "") + '">' + t + "</span>"; }

  // Prep's bar keeps its search and New encounter on every Prep page (T 2.1); the render steps New down when the page
  // shows its own Cup.
  function prepEnd() { return '<div class="sb-end"><span class="find">' + IC.search + "Find an encounter or a map<kbd>Ctrl K</kbd></span>" + cup("New encounter") + "</div>"; }
  function grp(title, inner, open) { return '<div class="' + (open ? "e-open" : "e-grp") + '"><span class="e-eb">' + title + "</span>" + inner + "</div>"; }
  function port(t, size) { return t.gm ? '<span class="h-port gm" style="--ps:' + (size || 64) + 'px">' + IC.eyeoff + "</span>" : '<span class="h-port" style="--pc:' + t.c + ";--ps:" + (size || 64) + 'px">' + IC[t.e] + "</span>"; }
  function wm() { return '<span class="wm h-wm"><span class="wm-ozy">OZY</span><span class="wm-vtt">vtt</span></span>'; }
  function vcr(stop) { return '<span class="h-vcr"><small>' + (stop ? "STOP ■" : "PLAY ▶") + "</small><b>RND " + (stop ? "--" : ROUND) + "</b></span>"; }
  function lamp(on, short) { return '<span class="h-lamp">' + (short ? "" : IC.screen.replace("<svg", '<svg style="width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8"') + "Table screen ") + '<i class="' + (on ? "" : "off") + '"></i><b>' + (on ? "ON" : "OFF") + "</b></span>"; }
  function mapLayer(style, o) {
    o = o || {};
    var t = o.toks === false ? "" : TOKS.map(function (k) { return '<span class="h-tok' + (k[3] ? " foe" : "") + (k[4] ? " act" : "") + (o.small ? " small" : "") + '" style="left:' + k[1] + "%;top:" + k[2] + '%">' + k[0] + (o.names === false ? "" : '<span class="nm">' + k[5] + "</span>") + "</span>"; }).join("");
    return '<div class="h-map" style="' + style + ";background-image:url(" + MAP + ')">' + t + (o.ping ? '<span class="h-ping" style="left:58%;top:48%"></span>' : "") + "</div>";
  }

  /* ---------- Frames ---------- */
  function tvFrame(inner, phone) { return phone ? '<div class="frame" style="width:390px;height:844px"><div class="ap h-tv is-portrait">' + inner + "</div></div>" : '<div class="frame" style="width:1280px;height:720px"><div class="ap h-tv">' + inner + "</div></div>"; }
  function topBar() {
    var nav = '<nav class="ap-nav" aria-hidden="true">' + ["Play", "Prep", "Codex", "Compendium"].map(function (n) { return "<span>" + n + "</span>"; }).join("") + "</nav>";
    var me = '<span class="me-btn"><span class="face lg gm">GM</span><span class="online">2</span>' + IC.down + "</span>";
    return '<header class="ap-bar"><span class="wm"><span class="wm-ozy">OZY</span><span class="wm-vtt">vtt</span></span>' + nav + '<div class="ap-end"><span class="ico">' + IC.search + "</span>" + me + "</div></header>";
  }
  function gmLap(inner, o) { o = o || {}; return '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-base">' + topBar() + '<div class="ap-pane" style="position:relative;overflow:hidden">' + inner + "</div></div></div>"; }
  function bottom() { var tabs = [["Play", "play"], ["Prep", "prep"], ["Codex", "codex"], ["Compendium", "book"], ["More", "dots", 1]]; return '<nav class="ap-bottom five" aria-hidden="true">' + tabs.map(function (t) { return '<span class="btab' + (t[2] ? " on" : "") + '">' + IC[t[1]] + t[0] + "</span>"; }).join("") + "</nav>"; }
  function gmPhone(inner, o) {
    o = o || {};
    var head = '<header class="pbar">' + (o.back ? '<span class="ico" style="margin-left:-8px"' + (o.backTo ? ' data-go="' + o.backTo + '"' : "") + ">" + IC.back + "</span>" : "") + "<h1>" + (o.title || "Table screen") + '</h1><div class="end">' + (o.icons || []).map(function (n) { return '<span class="ico">' + IC[n] + "</span>"; }).join("") + "</div></header>";
    return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-base">' + head + '<div class="ap-pane" style="position:relative;overflow:hidden">' + inner + "</div>" + bottom() + "</div></div>";
  }
