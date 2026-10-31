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

  /* ---------- State ---------- */
  var S = { d1: "docks", d2: "ladder", d3: "costs", d4: "switch", who: "gm", mo: "lyra", pv: "turn", show: "all" };
  var KEYS = ["d1", "d2", "d3", "d4", "who", "mo", "pv"];
  var VALID = { d1: ["bench", "float", "docks", "stage"], d2: ["tiles", "faces", "ladder", "ticker"], d3: ["card", "costs", "favs", "hotbar"], d4: ["stack", "sheet", "switch", "split"], who: ["gm", "pl"], mo: ["lyra", "boss", "prep"], pv: ["map", "turn", "log", "party", "notes"] };
  function gm() { return S.who === "gm"; }
  function prep() { return S.mo === "prep"; }
  function myTurn() { return !gm() && S.mo === "lyra"; }

  /* ---------- The fight on the Old road ---------- */
  var C = [
    { n: "Goblin Boss", sh: "Goblin Boss", s: "GB", i: 21, foe: 1, hp: [15, 21], w: "Healthy", x: 68, y: 33 },
    { n: "Borin Stoneguard", sh: "Borin", s: "B", i: 18, hp: [58, 67], x: 48, y: 50 },
    { n: "Lyra Emberwise", sh: "Lyra", s: "L", i: 13, hp: [44, 44], x: 37, y: 60 },
    { n: "Goblin Warrior 1", sh: "Goblin 1", s: "G1", i: 8, foe: 1, hp: [3, 10], w: "Bloodied", c: "Prone", x: 58, y: 45 },
    { n: "Goblin Warrior 2", sh: "Goblin 2", s: "G2", i: 8, foe: 1, hp: [10, 10], w: "Healthy", x: 63, y: 58 },
    { n: "Mirena Dawnbright", sh: "Mirena", s: "M", i: 7, hp: [44, 52], x: 30, y: 67 }
  ];
  function actIdx() { return prep() ? -1 : S.mo === "boss" ? 0 : 2; }
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
    var hot = S.d3 === "hotbar" && !prep() && !phone ? hotbar(false) : "";
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
    var look = S.d2;
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
  function actor() { return S.mo === "boss" ? "boss" : "lyra"; }
  function rows() { return actor() === "boss" && gm() ? BOSS : LYRA; }
  function waiting() { return !gm() && S.mo === "boss"; }
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
    if (S.d3 === "card") {
      var only = waiting() ? "r" : null;
      return '<div class="turn">' + h + econ() + '<div class="arows">' + ahead() + groups(only) + "</div>" + (waiting() ? "" : commons()) + "</div>";
    }
    if (S.d3 === "costs") {
      var on = waiting() ? "r" : "a";
      var tab = function (g, label) {
        var used = waiting() && g !== "r";
        return '<span class="ctab' + (g === on ? " on" : "") + '"><span class="lmp' + (g === "b" ? " b" : g === "r" ? " r" : "") + (used ? " used" : "") + '"><i></i></span>' + label + '<span class="st">' + (used ? "NOT NOW" : "READY") + "</span></span>";
      };
      var tabs = '<div class="ctabs">' + tab("a", "Action") + tab("b", "Bonus Action") + tab("r", "Reaction") + '<span class="ctab mv"><span class="v">' + (waiting() ? "--" : "30") + "</span>Move<span class=\"st\">FEET</span></span></div>";
      var state = waiting() ? '<div class="cstate"><span>Reaction · ready</span><span class="lnk2">Mark used</span></div>' : '<div class="cstate"><span>Action · ready</span><span class="lnk2">Mark used</span></div>';
      return '<div class="turn">' + h + tabs + state + '<div class="arows">' + ahead() + groups(on) + "</div>" + (on === "a" ? commons() : "") + "</div>";
    }
    if (S.d3 === "favs") {
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
    var style = S.d1 === "float" && !inrow ? ' style="left:calc(50% - 198px)"' : "";
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

  /* ---------- Frames ---------- */
  function laptop() {
    var body;
    if (S.d1 === "bench") body = '<div class="L bench"><div class="left">' + ord("h") + '<div class="stage2">' + tools("rail") + mapEl(false) + "</div></div>" + panel("docked") + "</div>";
    else if (S.d1 === "float") body = '<div class="L float">' + mapEl(false) + tools("float") + ord("h") + panel("floating") + "</div>";
    else if (S.d1 === "docks") body = '<div class="L docks"><div class="dock">' + ord("v") + tools("grid") + "</div>" + mapEl(false) + panel("docked") + "</div>";
    else body = '<div class="L lstage"><div style="position:relative;min-height:0;display:grid">' + mapEl(false) + tools("float") + '</div><div class="deck">' + ord("v") + panel("indeck") + logCol() + "</div></div>";
    return '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-base">' + topBar() + '<div class="ap-pane is-cols">' + body + "</div></div></div>";
  }
  function phone() {
    var g = gm();
    var pbar = '<header class="pbar"><h1>Old road</h1>' + (prep() ? "" : '<span class="vcr">R02</span>') + (g ? '<span class="ico" style="width:28px">' + IC.down + "</span>" : "") + '<div class="end">' + (g ? "" : '<span class="ico">' + IC.me + "</span>") + "</div></header>";
    var tabs = g ? [["Play", "play"], ["Prep", "prep"], ["Codex", "codex"], ["Compendium", "book"], ["More", "dots"]] : [["Table", "play"], ["Sheet", "sheet"], ["Codex", "codex"], ["Log", "log"], ["More", "dots"]];
    var bottom = '<nav class="ap-bottom five" aria-hidden="true">' + tabs.map(function (t, i) {
      return '<span class="btab' + (i === 0 ? " on" : "") + '">' + IC[t[1]] + t[0] + (i === 0 && !prep() ? lamp(myTurn() ? " mine" : "") : "") + "</span>";
    }).join("") + "</nav>";
    var pan = function (cls) { return '<div class="tpan ' + (cls || "") + '">' + tabsStrip(tabNames(false), 0) + '<div class="pbody">' + turnBody(true) + "</div>" + footer() + "</div>"; };
    var body;
    if (S.d4 === "stack") {
      body = '<div class="P stack" style="display:grid;grid-template-rows:auto auto 290px minmax(0,1fr)">' + ord("h") + tools("row") + mapEl(true) + pan() + "</div>";
    } else if (S.d4 === "sheet") {
      body = '<div class="P sheet">' + mapEl(true) + ord("h") + tools("fab") + '<div class="bsheet"><div class="grab2"></div>' + pan() + "</div></div>";
    } else if (S.d4 === "switch") {
      // One view at a time; its segments work in the mockup. End turn stays in reach from every view.
      var segs = [["map", "Map"], ["turn", g ? "Encounter" : prep() ? "Me" : "Turn"], ["log", "Log"], ["party", "Party"]].concat(g ? [["notes", "Notes"]] : []);
      if (!g && S.pv === "notes") S.pv = "turn";
      var view;
      if (S.pv === "map") view = '<div class="pv-map">' + tools("row") + mapEl(true) + "</div>";
      else if (S.pv === "log") view = '<div class="pbody pv-log">' + logCol() + "</div>";
      else if (S.pv === "party") view = '<div class="pbody">' + partyBody() + "</div>";
      else if (S.pv === "notes") view = '<div class="pbody"><p class="desc-line" style="margin:0 0 10px">Tonight</p><div class="prepl"><div class="r"><span class="fc foe">GB</span><div><b>Grukk wants the toll</b><span>The boss offers to let one of them pass for the Crowbar</span></div><span></span></div><div class="r"><span class="fc">M</span><div><b>Mirena\'s vow</b><span>Ask about the shrine if she drops to 0</span></div><span></span></div></div></div>';
      else view = '<div class="pbody">' + turnBody(true) + "</div>";
      body = '<div class="P switch"><div class="segw"><span class="segc pv-seg">' + segs.map(function (x) { return '<span data-pv="' + x[0] + '"' + (x[0] === S.pv ? ' class="on"' : "") + ">" + x[1] + "</span>"; }).join("") + "</span></div>" + ord("h") + '<div class="tpan" style="grid-template-rows:minmax(0,1fr) auto">' + view + footer() + "</div></div>";
    } else {
      body = '<div class="P split"><div class="top">' + ord("h") + mapEl(true) + "</div>" + pan() + "</div>";
    }
    return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-base">' + pbar + '<div class="ap-pane" style="overflow:hidden">' + body + "</div>" + bottom + "</div></div>";
  }

  /* ---------- What each option means ---------- */
  var DEC = {
    d1: {
      n: 1, name: "Workbench, laptop",
      what: "How the map, the tools, the turn order and the panel share a laptop screen (C1.1, C1.3, C2.2).",
      today: "The turn order runs across the top of the map, the tools down its left edge with a word under each icon, and a 392 px panel on the right with its own tabs and End turn at the foot. The staging tray pushes the map down.",
      opts: {
        bench: ["Bench", "Today's arrangement, drawn to the theme. The turn order across the top, a rail of tools at the left, the map, and a docked panel on the right with End turn at its foot."],
        float: ["Float", "The map takes the whole screen. The turn order, the tools and the panel float over it as glass, the way Foundry and Owlbear Rodeo work, and the panel can fold away to give the map everything."],
        docks: ["Two docks · chosen", "A narrow dock at the left holds the turn order as a column, with the tools under it, and the panel stays on the right. The map sits between them with nothing over it."],
        stage: ["Stage", "The map across the top, and a deck along the bottom with three columns: the turn order, the turn, and the log. The main loop needs no tab: who acts, what they do and what happened are all in view."]
      }
    },
    d2: {
      n: 2, name: "Turn order",
      what: "How each combatant reads in the turn order, wherever the workbench puts it (C1.2, C3.5). Players see a foe's wound word, the GM its hit points.",
      today: "A row of portrait tiles with the name and initiative under each, the acting one shaded, and a NEXT tag. Hit points and conditions are not in the order.",
      opts: {
        tiles: ["Tiles", "Today's tiles, tidied: a face, the name and initiative in VT323. The acting one carries the horizon ink on the order's line, like a chosen tab, and NEXT marks who follows."],
        faces: ["Faces", "Faces only, with a sliver of hit points under each; the acting face is larger and carries the ink. Its name and who is next sit at the end of the row. The most compact."],
        ladder: ["Ladder · chosen", "Each combatant as a short row: face, name, initiative, a hit point bar or wound word, and conditions. The most to read; best in a column."],
        ticker: ["Ticker", "One line of words: who is acting, large, then the rest in order with their initiative. No faces. Reads like a broadcast lower third."]
      }
    },
    d3: {
      n: 3, name: "The turn",
      what: "How the acting creature's turn is shown and taken: the player's Turn tab and the GM's Encounter tab, one design for both (C3.4, C4.2).",
      today: "YOUR TURN in Bungee, the four economy plates (Action, Bonus, Reaction, Move), then every option as a boxed row with a Cast button on a laptop, or favourite tiles on a phone, and Dodge, Dash and the rest as chips.",
      opts: {
        card: ["Card", "One list, as the Ledger sheet draws actions: the economy as four lamps in one line, then the options grouped by what they cost, each row one button with range, hit or DC and damage in columns."],
        costs: ["Cost tabs · chosen", "The economy lamps are the tabs: Action, Bonus, Reaction and Move. Pick one and its options list under it; a spent one goes dark. Shortest lists, one tap more."],
        favs: ["Favourites", "The options you use most as large tiles in two columns, each edged in its cost's colour, then All options and Edit favourites. Today's phone card, made the same on every screen."],
        hotbar: ["Hotbar", "The options as numbered slots in a bar over the map, keys 1 to 0. The panel shows the chosen slot: its numbers, what it does and the targets. On a phone the bar sits in the panel."]
      }
    },
    d4: {
      n: 4, name: "Phone table",
      what: "How the table fits 390 by 844 under the phone's header row and five tabs (A).",
      today: "One long column: the strip and turn order, a row of tools, the staging tray, the map, then the panel's tabs and content, with End turn at the very end. The map scrolls away to reach the panel.",
      opts: {
        stack: ["Stack", "Today's column, tightened: the turn order, one row of tools, a 290 px map, then the panel. End turn stays pinned above the tabs."],
        sheet: ["Map and sheet", "The map fills the screen with the turn order floating on it and the tools as a column at its edge. The panel is a sheet from the bottom with three heights: a peek, half and full."],
        switch: ["Switch · chosen", "A segmented control under the header shows one thing at a time, full height: the map, the turn, the log or the party. The turn order stays on top of each."],
        split: ["Split", "The map and turn order hold the top 300 px; the panel scrolls below them. Both always in view, neither large."]
      }
    }
  };
  function renderIdea() {
    $("#idea").innerHTML = ["d1", "d2", "d3", "d4"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div><p class="eyebrow">' + d.n + " · " + d.name + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    var A = window.AUDIT || {};
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    $("#today").innerHTML =
      '<div class="today-strip" style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(380px,100%),1fr))"><p class="eyebrow" style="grid-column:1/-1">Laptop</p>' + fig("gm-lyra", "GM, Lyra acting") + fig("pl-turn", "Lyra's player, her turn") + fig("gm-prep", "GM, before the fight") + "</div>" +
      '<div class="today-strip"><p class="eyebrow">Phone, GM</p>' + fig("gm-phone", "The top of the column") + fig("gm-phone-2", "Scrolled to the panel") + "</div>" +
      '<div class="today-strip"><p class="eyebrow">Phone, player</p>' + fig("pl-phone", "Your turn") + fig("pl-phone-2", "Scrolled") + fig("pl-wait-phone", "Waiting for another turn") + "</div>" +
      '<div class="today-strip"><p class="eyebrow">The log</p>' + fig("gm-log", "Log tab: boxed entries, dice, the composer") + "</div>";
    var R = [
      ["One primary, in the panel's foot", "End turn, or Start the encounter before the fight, is the Cup at the foot of the panel (theme rule 2), with Back beside it for the GM and who is next under it. Nothing else on the table is a Cup.", "Today End turn is a Cup, and Start the encounter is too."],
      ["YOUR TURN, once", "The Bungee chrome says YOUR TURN once, at the top of the turn, on the player's turn only. Every other acting name is Chakra Petch.", "Today the acting character's name is also in Bungee in the GM's card."],
      ["The economy is four lamps", "Action magenta, Bonus Action gold, Reaction cyan, and Movement as a VT323 count of feet. A spent lamp goes dark with an afterglow (ADR-0045). No box around a lamp.", "Today they are four boxed plates."],
      ["The tray is a chip", "Tokens not yet on the map wait behind a Tray chip in the map's corner, with how many. It opens the tray; it never pushes the map down.", "Today the tray is a band over the map."],
      ["Hit points by role", "The GM sees every number. A player sees the party's hit points and a foe's wound word (Healthy, Bloodied or Down), as the projection gives them today.", ""],
      ["The map's own controls", "Centre on me, zoom out and zoom in sit together in glass at the map's bottom right, on every layout and size.", "Today Me is a button in the strip."],
      ["One row of tabs", "The panel has one row of tabs (theme rule 1). The GM's Token tab shows only while a token is chosen; Notes holds Tonight and the Codex, which today is a strip inside the tab.", "Today Notes has its own Tonight and Codex strip."],
      ["Who acts, everywhere", "The acting token has an amber ring on the map, the acting entry carries the ink in the order, and the turn says who acts. Amber means waiting on someone (theme rule 9).", ""],
      ["Later rounds", "The map's menus and tools in detail (C2), setting up and running the encounter (C3), prompts and the rest (C4), the log and dice (C5) and the dialogs (C6) are designed after this frame, inside it.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }

  /* ---------- Page ---------- */
  function capText() { return (gm() ? "GM" : "Lyra's player") + " · " + { lyra: "Lyra's turn", boss: "Goblin Boss's turn", prep: "before the fight" }[S.mo]; }
  function renderStage() {
    $("#cap-laptop").textContent = "Laptop · " + capText();
    $("#cap-phone").textContent = "Phone · " + capText();
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
  var SEGS = { d1: "d1-seg", d2: "d2-seg", d3: "d3-seg", d4: "d4-seg", who: "who-seg", mo: "mo-seg", show: "view-seg" };
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

  $("#v-phone").addEventListener("click", function (e) {
    var seg = e.target.closest && e.target.closest("[data-pv]");
    if (!seg) return;
    S.pv = seg.getAttribute("data-pv");
    renderStage();
    writeHash();
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
