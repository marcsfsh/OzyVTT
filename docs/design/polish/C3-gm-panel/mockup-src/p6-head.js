(function () {
  "use strict";
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  if (window.MAPIMG) document.documentElement.style.setProperty("--mapimg", "url(" + window.MAPIMG + ")");

  /* ---------- Icons ---------- */
  function svg(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>"; }
  var IC = {
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    down: svg('<path d="M7 10l5 5 5-5"/>'),
    left: svg('<path d="M14 7l-5 5 5 5"/>'),
    dots: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
    select: svg('<path d="M6 4l12 8-6 1.5L9 19z"/>'),
    measure: svg('<path d="M3 15l12-12 6 6-12 12z"/><path d="M8 10l2 2M11 7l2 2M5 13l2 2"/>'),
    ping: svg('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/>'),
    draw: svg('<path d="M4 20l4-1 11-11-3-3L5 16z"/>'),
    fog: svg('<path d="M4 9h16M4 13h12M4 17h16"/>'),
    terrain: svg('<path d="M3 19l6-10 4 6 3-4 5 8z"/>'),
    trap: svg('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>'),
    weather: svg('<path d="M13 3L6 13h5l-1 8 7-10h-5z"/>'),
    walls: svg('<path d="M4 6h16v12H4zM4 12h16M10 6v6M14 12v6"/>'),
    light: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>'),
    view: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M11 8v6M8 11h6"/>'),
    me: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    minus: svg('<path d="M5 12h14"/>'),
    tray: svg('<path d="M4 13l3-8h10l3 8v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/>'),
    play: svg('<rect x="4" y="4" width="16" height="16"/><circle cx="9" cy="9" r=".8"/><circle cx="15" cy="15" r=".8"/><circle cx="15" cy="9" r=".8"/><circle cx="9" cy="15" r=".8"/>'),
    prep: svg('<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    codex: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h7"/>'),
    book: svg('<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z"/><path d="M5 16a4 4 0 0 1 4-4h10"/>'),
    log: svg('<path d="M5 5h14M5 10h14M5 15h9M5 20h6"/>'),
    sheet: svg('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>'),
    star: svg('<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>')
  };
  function ico(k) { return '<span class="ico">' + IC[k] + "</span>"; }

  IC.bell = svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>');
  IC.flag = svg('<path d="M12 3l9 9-9 9-9-9z"/><path d="M12 8v5M12 16v.5"/>');
  IC.party = svg('<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.4"/><path d="M3 19c1-3 3.5-4.5 6-4.5s5 1.5 6 4.5M15 15c2 0 4.5 1 5.5 4"/>');
  IC.notes = svg('<path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7"/>');
  IC.enc = svg('<path d="M5 19L19 5M15 5h4v4"/><path d="M5 5l6 6M14 14l5 5M17 19h2v-2"/>');
  IC.token = svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="10" r="3"/><path d="M7 18c1.5-2.5 3-3.5 5-3.5s3.5 1 5 3.5"/>');
  IC.check = svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>');
  IC.x = svg('<path d="M6 6l12 12M18 6L6 18"/>');
  IC.target = svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>');
  IC.dice = svg('<rect x="4" y="4" width="16" height="16"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="15" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/>');
  IC.rule = svg('<path d="M12 3l7 3v5.5c0 4.6-3 8-7 9.5-4-1.5-7-4.9-7-9.5V6z"/>');
  IC.hourglass = svg('<path d="M7 3h10M7 21h10M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9s8 4 8 9"/>');
  IC.up = svg('<path d="M7 14l5-5 5 5"/>');
  IC.fwd = svg('<path d="M10 6l6 6-6 6"/>');
  IC.arrow = svg('<path d="M4 12h15M14 7l5 5-5 5"/>');

  /* ---------- State ---------- */
  var S = { d1: "top", d2: "card", d3: "counts", d4: "bell", pg: "fight", show: "all", lz: "close", pv: "turn", tab: null, read: {} };
  var KEYS = ["d1", "d2", "d3", "d4", "pg"];
  var VALID = { d1: ["top", "tab", "above", "foot", "dock", "drawer"], d2: ["card", "row", "ticket", "expand", "kind", "who"], d3: ["words", "counts", "icons", "iconsonly", "rail", "menu"], d4: ["lamp", "words", "bell", "count", "flag", "ink"], pg: ["fight", "items", "tabs", "signal"] };
  var A = window.AUDIT || {};
  // The table frame is C's approved one: Two docks, the Ladder, Cost tabs and the phone's Switch, on Lyra's turn.
  var F = { d1: "docks", d2: "ladder", d3: "costs", d4: "switch", who: "gm", mo: "lyra" };
  function gm() { return true; }
  function prep() { return false; }
  function myTurn() { return false; }

  /* ---------- The fight on the Old road ---------- */
  var C = [
    { n: "Goblin Boss", sh: "Goblin Boss", s: "GB", i: 21, foe: 1, hp: [15, 21], w: "Healthy", x: 68, y: 33 },
    { n: "Borin Stoneguard", sh: "Borin", s: "B", i: 18, hp: [58, 67], x: 48, y: 50 },
    { n: "Lyra Emberwise", sh: "Lyra", s: "L", i: 13, hp: [44, 44], x: 37, y: 60 },
    { n: "Goblin Warrior 1", sh: "Goblin 1", s: "G1", i: 8, foe: 1, hp: [3, 10], w: "Bloodied", c: "Prone", x: 58, y: 45 },
    { n: "Goblin Warrior 2", sh: "Goblin 2", s: "G2", i: 8, foe: 1, hp: [10, 10], w: "Healthy", x: 63, y: 58 },
    { n: "Mirena Dawnbright", sh: "Mirena", s: "M", i: 7, hp: [44, 52], x: 30, y: 67 }
  ];
  function actIdx() { return prep() ? -1 : F.mo === "boss" ? 0 : 2; }
  function nextOf(i) { return (i + 1) % C.length; }
  var LYRA = [
    ["a", "Fire Bolt", "Cantrip · Evocation", "120 ft", "+6", "2d10", "fire", 1],
    ["a", "Magic Missile", "Level 1 · three darts", "120 ft", "Auto", "3d4+3", "force", 1],
    ["a", "Burning Hands", "Level 1 · 15-foot cone", "Self", "DC 14", "3d6", "fire", 1],
    ["a", "Fireball", "Level 3 · 20-foot sphere", "150 ft", "DC 14", "8d6", "fire", 0],
    ["a", "Dagger", "Weapon · Finesse, Light, Thrown", "20/60", "+5", "1d4+3", "pierc.", 0],
    ["b", "Misty Step", "Level 2 · teleport 30 feet", "Self", "", "", "", 1],
    ["r", "Shield", "Level 1 · +5 AC until your next turn", "Self", "", "+5 AC", "", 1],
    ["r", "Opportunity Attack", "Dagger, when a foe leaves your reach", "5 ft", "+5", "1d4+3", "pierc.", 0]
  ];
  var BOSS = [
    ["a", "Multiattack", "Two Scimitar attacks", "5 ft", "+4", "2× 1d6+2", "slash.", 1],
    ["a", "Scimitar", "Melee attack", "5 ft", "+4", "1d6+2", "slash.", 1],
    ["a", "Shortbow", "Ranged attack", "80/320", "+4", "1d6+2", "pierc.", 1],
    ["b", "Nimble Escape", "Disengage or Hide", "Self", "", "", "", 1],
    ["r", "Redirect Attack", "A goblin within 5 feet takes the hit", "5 ft", "", "", "", 1]
  ];
  var COMMON = ["Dash", "Disengage", "Dodge", "Help", "Hide", "Ready"];
  var COSTNAME = { a: "Action", b: "Bonus Action", r: "Reaction" };

  /* ---------- The frame (area A, approved) ---------- */
  function wm() { return '<span class="wm"><span class="wm-ozy">OZY</span><span class="wm-vtt">vtt</span></span>'; }
  function lamp(x) { return '<i class="lamp' + (x || "") + '"></i>'; }
  function topBar() {
    var secs = gm() ? ["Play", "Prep", "Codex", "Compendium"] : ["Table", "Sheet", "Codex"];
    var nav = '<nav class="ap-nav" aria-hidden="true">' + secs.map(function (n, i) { return "<span" + (i === 0 ? ' class="on" data-seat' : "") + ">" + n + "</span>"; }).join("") + "</nav>";
    var chip = '<span class="live-chip">' + lamp(prep() ? " off" : myTurn() ? " mine" : "") + "Old road" + (prep() ? "" : '<span class="vcr">R02</span>') + (myTurn() ? '<span class="mine">Your turn</span>' : "") + (gm() ? IC.down : "") + "</span>";
    var me = '<span class="me-btn">' + (gm() ? '<span class="face lg gm">GM</span><span class="online">3</span>' : '<span class="face lg">L</span>') + IC.down + "</span>";
    return '<header class="ap-bar">' + wm() + nav + chip + '<div class="ap-end">' + ico("search") + me + "</div></header>";
  }

  /* ---------- The map ---------- */
  function tokens() {
    if (prep()) return '<span class="ttok" style="left:40%;top:58%">B<span>Borin</span></span><span class="ttok" style="left:34%;top:62%">L<span>Lyra</span></span><span class="ttok" style="left:30%;top:68%">M<span>Mirena</span></span>';
    var a = actIdx();
    return C.map(function (c, k) {
      return '<span class="ttok' + (c.foe ? " foe" : "") + (c.s === "GB" ? " boss" : "") + (k === a ? " act" : "") + '" style="left:' + c.x + "%;top:" + c.y + '%">' + c.s + "<span>" + c.sh + "</span></span>";
    }).join("");
  }
  function mapEl(phone, extra) {
    var tray = prep() && gm() ? '<span class="tray">' + IC.tray + "Tray <b>3</b></span>" : "";
    var ctl = '<div class="mctl"><span>' + IC.me + "</span><span>" + IC.minus + "</span><span>" + IC.plus + "</span></div>";
    var hot = F.d3 === "hotbar" && !prep() && !phone ? hotbar(false) : "";
    return '<div class="tmap"' + (extra || "") + ">" + tokens() + tray + ctl + hot + "</div>";
  }
  var TOOLS_GM = [["select", "Select", 1], ["measure", "Measure"], ["ping", "Ping"], ["draw", "Draw"], 0, ["fog", "Fog"], ["terrain", "Terrain"], ["trap", "Traps"], ["weather", "Weather"], ["walls", "Walls"], ["light", "Light"], 0, ["view", "View"]];
  var TOOLS_PL = [["select", "Select", 1], ["measure", "Measure"], ["ping", "Ping"], ["draw", "Draw"], 0, ["view", "View"]];
  function tools(kind) {
    var list = gm() ? TOOLS_GM : TOOLS_PL;
    if (kind === "fab") list = [["select", "Select", 1], ["measure", "Measure"], ["ping", "Ping"], ["draw", "Draw"]];
    return '<div class="tools ' + kind + '">' + list.map(function (t) {
      return t ? '<span class="tool' + (t[2] ? " on" : "") + '">' + IC[t[0]] + "<i>" + t[1] + "</i></span>" : '<span class="sep"></span>';
    }).join("") + "</div>";
  }

  /* ---------- The turn order ---------- */
  function hpOf(c) {
    if (c.foe && !gm()) return '<span class="wword">' + c.w + "</span>";
    return '<span class="hpb' + (c.foe ? " foe" : "") + '"><i style="width:' + Math.round((100 * c.hp[0]) / c.hp[1]) + '%"></i></span>';
  }
  function ord(o) {
    var a = actIdx(), nx = a < 0 ? -1 : nextOf(a);
    var rnd = prep() ? '<div class="rnd"><span>STOP ■</span><b>RND --</b></div>' : '<div class="rnd"><span>PLAY ▸</span><b>RND 02</b></div>';
    var look = F.d2;
    if (look === "ticker" && o === "h") {
      if (prep()) return '<div class="ord h o-ticker">' + rnd + '<div class="list"><span class="then">Initiative is rolled when the encounter starts: Borin, Lyra, Mirena, Goblin Boss and two Goblin Warriors.</span></div></div>';
      var c = C[a];
      var then = [];
      for (var k = 1; k < C.length; k++) { var e = C[(a + k) % C.length]; then.push(e.sh + "<i>" + e.i + "</i>"); }
      return '<div class="ord h o-ticker">' + rnd + '<div class="list"><span class="now"><span class="fc' + (c.foe ? " foe" : "") + '">' + c.s + "</span><b>" + c.n + "</b><span>" + (myTurn() ? "Your turn" : "Acting") + '</span></span><span class="then">Then ' + then.join("<em>·</em>") + "</span></div></div>";
    }
    var list = (prep() ? C.slice(1, 3).concat([C[5], C[0], C[3], C[4]]) : C).map(function (c, k) {
      var isA = !prep() && k === a, isN = !prep() && k === nx;
      var ini = '<span class="cini">' + (prep() ? "--" : c.i) + "</span>";
      var fc = '<span class="fc' + (c.foe ? " foe" : "") + '">' + c.s + "</span>";
      var nxt = isN ? '<span class="nx">NEXT</span>' : "";
      var cond = c.c ? '<span class="cond bad">' + c.c + "</span>" : "";
      var inner;
      if (o === "h" && look === "tiles") inner = fc + '<span class="nm"><span class="t">' + c.sh + "</span>" + ini + "</span>" + nxt;
      else if (o === "h" && look === "faces") inner = fc + hpOf(c);
      else if (o === "h" && look === "ladder") inner = fc + '<span class="nm">' + c.sh + "</span>" + ini + hpOf(c);
      else inner = fc + '<span class="nm">' + (o === "v" ? c.n : c.sh) + "</span>" + ini + '<span class="sub">' + hpOf(c) + cond + "</span>" + nxt;
      return '<div class="c-ent' + (isA ? " act" : "") + '">' + inner + "</div>";
    }).join("");
    var who = "";
    if (o === "h" && look === "faces") {
      who = prep() ? '<div class="who"><b>Not started</b><span>Initiative rolls at the start</span></div>' : '<div class="who"><b>' + C[a].n + "</b><span>" + (myTurn() ? "Your turn" : "Acting") + " · next " + C[nx].sh + "</span></div>";
    }
    return '<div class="ord ' + o + " o-" + look + '">' + rnd + '<div class="list">' + list + "</div>" + who + "</div>";
  }

  /* ---------- The turn ---------- */
  function actor() { return F.mo === "boss" ? "boss" : "lyra"; }
  function rows() { return actor() === "boss" && gm() ? BOSS : LYRA; }
  function waiting() { return !gm() && F.mo === "boss"; }
  function head() {
    if (waiting()) return '<div class="waitline"><span class="fc foe">GB</span><span><b>Goblin Boss</b> is acting. Your turn comes after Borin.</span></div>';
    if (myTurn()) return '<div class="turn-h"><p class="yourturn">YOUR TURN</p><div class="hp"><b>44<small style="font-size:.6em;color:var(--text-muted)">/44</small></b><span>AC 11</span></div></div>';
    var b = actor() === "boss";
    return '<div class="turn-h"><span class="fc' + (b ? " foe" : "") + '">' + (b ? "GB" : "L") + "</span><div><h3>" + (b ? "Goblin Boss" : "Lyra Emberwise") + "</h3><p>" + (b ? "Acting · you run it" : "Acting · from the player's device") + '</p></div><div class="hp"><b>' + (b ? "15" : "44") + '<small style="font-size:.6em;color:var(--text-muted)">/' + (b ? "21" : "44") + "</small></b><span>AC " + (b ? "17" : "11") + "</span></div></div>";
  }
  function econ() {
    var w = waiting();
    return '<div class="econ"><span class="lmp' + (w ? " used" : "") + '"><i></i>Action</span><span class="lmp b' + (w ? " used" : "") + '"><i></i>Bonus Action</span><span class="lmp r"><i></i>Reaction</span><span class="mv"><small>MOVE</small>' + (w ? "--" : "30 FT") + "</span></div>";
  }
  function arow(r, sel) {
    var off = waiting() && r[0] !== "r";
    return '<div class="arow' + (off ? " off" : "") + (sel ? " sel" : "") + '"><div><b>' + r[1] + "</b><small>" + r[2] + '</small></div><span class="c">' + r[3] + '</span><span class="n">' + r[4] + '</span><span class="d">' + r[5] + (r[6] ? "<small>" + r[6] + "</small>" : "") + "</span></div>";
  }
  function ahead() { return '<div class="ahead"><span>Option</span><span>Range</span><span>Hit/DC</span><span>Damage</span></div>'; }
  function groups(only) {
    var out = "";
    ["a", "b", "r"].forEach(function (g) {
      if (only && g !== only) return;
      var rs = rows().filter(function (r) { return r[0] === g; });
      if (!rs.length) return;
      if (!only) out += '<div class="agrp"><span class="lmp' + (g === "b" ? " b" : g === "r" ? " r" : "") + (waiting() && g !== "r" ? " used" : "") + '"><i></i>' + COSTNAME[g] + "</span></div>";
      out += rs.map(function (r, k) { return arow(r, false); }).join("");
    });
    return out;
  }
  function commons() { return '<div class="chips2"><span class="eb">Anyone can</span>' + COMMON.map(function (c) { return "<span>" + c + "</span>"; }).join("") + "</div>"; }
  function turnBody(phone) {
    if (prep()) return prepBody();
    var h = head();
    if (F.d3 === "card") {
      var only = waiting() ? "r" : null;
      return '<div class="turn">' + h + econ() + '<div class="arows">' + ahead() + groups(only) + "</div>" + (waiting() ? "" : commons()) + "</div>";
    }
    if (F.d3 === "costs") {
      var on = waiting() ? "r" : "a";
      var tab = function (g, label) {
        var used = waiting() && g !== "r";
        return '<span class="ctab' + (g === on ? " on" : "") + '"><span class="lmp' + (g === "b" ? " b" : g === "r" ? " r" : "") + (used ? " used" : "") + '"><i></i></span>' + label + '<span class="st">' + (used ? "NOT NOW" : "READY") + "</span></span>";
      };
      var tabs = '<div class="ctabs">' + tab("a", "Action") + tab("b", "Bonus Action") + tab("r", "Reaction") + '<span class="ctab mv"><span class="v">' + (waiting() ? "--" : "30") + "</span>Move<span class=\"st\">FEET</span></span></div>";
      var state = waiting() ? '<div class="cstate"><span>Reaction · ready</span><span class="lnk2">Mark used</span></div>' : '<div class="cstate"><span>Action · ready</span><span class="lnk2">Mark used</span></div>';
      return '<div class="turn">' + h + tabs + state + '<div class="arows">' + ahead() + groups(on) + "</div>" + (on === "a" ? commons() : "") + "</div>";
    }
    if (F.d3 === "favs") {
      var favs = rows().filter(function (r) { return r[7]; }).slice(0, 6);
      var tiles = '<div class="ftiles">' + favs.map(function (r) {
        var off = waiting() && r[0] !== "r";
        return '<div class="ftile ' + r[0] + (off ? " off" : "") + '"><small>' + COSTNAME[r[0]] + (r[3] ? " · " + r[3] : "") + "</small><b>" + r[1] + '</b><span class="k">' + [r[4], r[5]].filter(Boolean).join("  ") + (r[6] ? ' <small>' + r[6] + "</small>" : "") + "</span></div>";
      }).join("") + "</div>";
      var n = rows().length + COMMON.length;
      return '<div class="turn">' + h + econ() + tiles + '<div class="allopts"><span>All ' + n + " options</span><span>Edit favourites</span></div>" + (waiting() ? "" : commons()) + "</div>";
    }
    // Hotbar: the panel holds the chosen slot's detail
    var sel = waiting() ? rows().filter(function (r) { return r[0] === "r"; })[0] : rows()[actor() === "boss" ? 1 : 0];
    var tg = actor() === "boss" ? [["B", "Borin", 1], ["L", "Lyra"], ["M", "Mirena"]] : [["G1", "Goblin Warrior 1", 1, 1], ["G2", "Goblin Warrior 2", 0, 1], ["GB", "Goblin Boss", 0, 1]];
    var det = '<div class="detail"><span class="eb">' + COSTNAME[sel[0]] + " · slot " + (waiting() ? "7" : "1") + "</span><h4>" + sel[1] + "</h4>" +
      '<div class="dfacts"><div><span class="eb">Range</span><span class="num">' + sel[3] + '</span></div><div><span class="eb">Hit / DC</span><span class="num">' + (sel[4] || "--") + '</span></div><div><span class="eb">Effect</span><span class="num">' + (sel[5] || "--") + "</span></div></div>" +
      "<p>" + sel[2] + ".</p>" + (waiting() ? "<p>Use it when the Goblin Boss's attack hits you.</p>" : '<span class="eb">Target</span><div class="tgts">' + tg.map(function (t) { return '<span class="' + (t[2] ? "on" : "") + '"><span class="fc' + (t[3] ? " foe" : "") + '">' + t[0] + "</span>" + t[1] + "</span>"; }).join("") + "</div>") + "</div>";
    return '<div class="turn">' + h + econ() + det + (phone ? hotbar(true) : "") + "</div>";
  }
  function hotbar(inrow) {
    var rs = rows();
    var k = 0;
    var slot = function (r, cls) {
      k++;
      var off = waiting() && r[0] !== "r";
      var sel = waiting() ? r[0] === "r" && r[1] === rs.filter(function (x) { return x[0] === "r"; })[0][1] : k === (actor() === "boss" ? 2 : 1);
      return '<span class="hot ' + r[0] + (off ? " off" : "") + (sel ? " sel" : "") + '"><span class="key">' + (k % 10) + "</span>" + r[1].replace(" ", "<br>") + (r[4] || r[5] ? '<span class="k">' + (r[4] || r[5]) + "</span>" : "") + "</span>";
    };
    var main = rs.map(function (r) { return slot(r); }).join("");
    var com = ["Dash", "Dodge", "Hide"].map(function (c) { k++; return '<span class="hot c' + (waiting() ? " off" : "") + '"><span class="key">' + (k % 10) + "</span>" + c + "</span>"; }).join("");
    var style = F.d1 === "float" && !inrow ? ' style="left:calc(50% - 198px)"' : "";
    return '<div class="hotbar' + (inrow ? " inrow" : "") + '"' + style + ">" + main + '<span class="gap"></span>' + com + "</div>";
  }
  function prepBody() {
    if (!gm()) return '<div class="turn"><div class="waitline"><span class="fc">L</span><span>The GM is setting up a fight on the <b>Old road</b>. Your turn shows here when it starts.</span></div></div>';
    var r = [["B", "Borin Stoneguard", "Party · on the map"], ["L", "Lyra Emberwise", "Party · on the map"], ["M", "Mirena Dawnbright", "Party · on the map"], ["GB", "Goblin Boss", "Monster · in the tray", 1], ["G1", "Goblin Warrior 1", "Monster · in the tray", 1], ["G2", "Goblin Warrior 2", "Monster · in the tray", 1]];
    return '<div class="turn"><p class="desc-line" style="margin:0">Everyone on the map is in. Untick anyone who isn\'t.</p><div class="prepl">' + r.map(function (x) {
      return '<div class="r"><span class="fc' + (x[3] ? " foe" : "") + '">' + x[0] + "</span><div><b>" + x[1] + "</b><span>" + x[2] + '</span></div><span class="box"></span></div>';
    }).join("") + '</div><div class="chips2"><span>Add characters or monsters</span><span>Pick a map</span></div></div>';
  }
  function footer() {
    if (prep()) return gm() ? '<div class="pfoot"><div class="row1"><button type="button" class="cup">Start the encounter</button></div><p>Rolls initiative for all 6</p></div>' : "";
    if (waiting()) return '<div class="pfoot"><p>Your turn comes after Borin.</p></div>';
    var nx = C[nextOf(actIdx())].n;
    return '<div class="pfoot"><div class="row1">' + (gm() ? '<span class="back">' + IC.left + "</span>" : "") + '<button type="button" class="cup">End turn</button></div><p>Next: ' + nx + "</p></div>";
  }
  function tabNames(deck) {
    var t = gm() ? ["Encounter", "Log", "Party", "Notes"] : prep() ? ["Me", "Log", "Party"] : ["Turn", "Sheet", "Log", "Party"];
    return deck ? t.filter(function (x) { return x !== "Log"; }) : t;
  }
  function tabsStrip(names, on) { return '<div class="sh-tabs">' + names.map(function (n, i) { return '<span class="sh-tab' + (i === on ? " on" : "") + '">' + n + "</span>"; }).join("") + "</div>"; }
  function panel(kind) {
    return '<div class="tpan ' + kind + '">' + tabsStrip(tabNames(kind === "indeck"), 0) + '<div class="pbody">' + turnBody(false) + "</div>" + footer() + "</div>";
  }
  function partyBody() {
    var P = [["B", "Borin Stoneguard", "Fighter 7", 58, 67], ["L", "Lyra Emberwise", "Wizard 7", 44, 44], ["M", "Mirena Dawnbright", "Cleric 7", 44, 52]];
    return '<div class="prepl">' + P.map(function (x) {
      return '<div class="r"><span class="fc">' + x[0] + "</span><div><b>" + x[1] + "</b><span>" + x[2] + '</span><span class="hpb" style="margin-top:6px"><i style="width:' + Math.round((100 * x[3]) / x[4]) + '%"></i></span></div><span class="num" style="font-size:20px;color:var(--hp-text)">' + x[3] + '<small style="color:var(--text-muted);font-size:.65em">/' + x[4] + "</small></span></div>";
    }).join("") + "</div>" + (gm() ? '<div class="chips2" style="margin-top:12px"><span>Rest the party</span></div>' : "");
  }
  function logCol() {
    var L = [["Goblin Boss", "Scimitar hits Borin", "7"], ["Borin", "Longsword hits Goblin Warrior 1", "9"], ["Borin", "Action Surge", ""], ["Lyra", "Turn starts", ""]];
    return '<div class="logc"><span class="eb">Log · round 2</span><div class="logl">' + L.map(function (l) { return '<div><span class="who">' + l[0] + "</span><span>" + l[1] + '</span><span class="num">' + l[2] + "</span></div>"; }).join("") + '</div><div class="composer"><span class="f">Say, or /roll 1d20</span><span class="dz">d20</span></div></div>';
  }

