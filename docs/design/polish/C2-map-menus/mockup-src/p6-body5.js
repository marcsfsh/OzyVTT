
  /* =========================================================================
     C2 round 1: the map's menus and each tool's options. The GM is on the laptop for a token, a door, a tool and a
     drawing; Borin's player is on the phone, and on the laptop for moving. The table (C), C3, C4, C5 and the theme
     are drawn as approved.
     ========================================================================= */
  var BFOOT = '<div class="pfoot"><div class="row1"><button type="button" class="cup">End turn</button></div><p>Next: Lyra Emberwise</p></div>';
  function zMap(m, extra) { return m.replace('<div class="tmap">', '<div class="tmap">' + extra); }
  function zTools(kind, on) {
    var list = gm() ? TOOLS_GM : TOOLS_PL;
    return '<div class="tools ' + kind + '">' + list.map(function (t) {
      return t ? '<span class="tool' + (t[0] === on ? " on" : "") + '">' + IC[t[0]] + "<i>" + t[1] + "</i></span>" : '<span class="sep"></span>';
    }).join("") + "</div>";
  }
  function zX() { return '<span class="e-ico" style="box-shadow:none">' + IC.x + "</span>"; }
  function zField(label, inner) { return '<div class="z-field"><small>' + label + "</small>" + inner + "</div>"; }
  function zStep(v) { return '<span class="z-step">' + bl("", "", "minus") + "<b>" + v + "</b>" + bl("", "", "plus") + "</span>"; }
  function zSw(on) { var c = ["#41e4ff", "#5b6cff", "#9b5bff", "#ff4fd8", "#ff4f6d", "#ff8ad8", "#7ff3ff", "#ffffff"]; return '<div class="z-sw">' + c.map(function (x, i) { return '<i style="background:' + x + '"' + (i === on ? ' class="on"' : "") + "></i>"; }).join("") + "</div>"; }

  /* ---------- Frames ---------- */
  function zGmLap(o) { return lapFrame2({ cols: o.cols, dock: o.dock, map: o.map, panel: o.panel || panel2("enc", turnBody(false)), over: o.over }); }
  function zPlPanel(on, body, foot, over) { return '<div class="tpan docked" style="grid-template-rows:auto minmax(0,1fr) auto;position:relative">' + plTabs(on) + '<div class="pbody" style="overflow:hidden">' + body + "</div>" + (foot == null ? waitFoot() : foot) + (over || "") + "</div>"; }
  function zPlLap(o) {
    return '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-base">' + plTop() + '<div class="ap-pane is-cols" style="position:relative"><div class="L docks"' + (o.cols ? ' style="grid-template-columns:' + o.cols + '"' : "") + ">" + (o.dock || plDock()) + (o.map || mapEl(false)) + o.panel + "</div>" + (o.over || "") + "</div></div></div>";
  }
  function zPlPhone(o) {
    var pbar = '<header class="pbar"><h1>Old road</h1><span class="vcr">R02</span><div class="end"><span class="ico">' + IC.me + "</span></div></header>";
    var tabs = [["Table", "play", 1], ["Sheet", "sheet"], ["Codex", "codex"], ["Log", "log"], ["More", "dots"]];
    var bottom = '<nav class="ap-bottom five" aria-hidden="true">' + tabs.map(function (t) { return '<span class="btab' + (t[2] ? " on" : "") + '">' + IC[t[1]] + t[0] + "</span>"; }).join("") + "</nav>";
    var segs = '<div class="k-segs">' + [["map", "Map"], ["turn", "Turn"], ["log", "Log"], ["party", "Party"]].map(function (x) { return '<span class="' + (x[0] === (o.seg || "map") ? "on" : "") + '">' + x[1] + "</span>"; }).join("") + "</div>";
    var body = '<div class="P switch" style="grid-template-rows:auto auto minmax(0,1fr)"><div class="segw">' + segs + "</div>" + (o.strip || ord("h")) + '<div class="tpan" style="grid-template-rows:minmax(0,1fr) auto">' + o.view + (o.foot == null ? waitFoot() : o.foot) + "</div>" + (o.over || "") + "</div>";
    return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-base">' + pbar + '<div class="ap-pane" style="overflow:hidden;position:relative">' + body + "</div>" + bottom + "</div></div>";
  }
  function zMapView(map, toolsHtml, under) { return '<div class="pv-map" style="position:relative' + (under ? ";grid-template-rows:auto auto minmax(0,1fr)" : "") + '">' + (toolsHtml || tools("row")) + (under || "") + map + "</div>"; }
  // Build a player's frame with the player's view switched on while its parts are drawn.
  function asPlayer(f) { F.pl = 1; window.PLFACE = "B"; try { return f(); } finally { F.pl = 0; window.PLFACE = null; } }
  function asTurn(who, f) { var was = F.mo; F.mo = who; try { return f(); } finally { F.mo = was; } }

  /* ---------- 1. A token's menu ---------- */
  var MODES_GM = ["Walk 30", "Climb", "Jump", "Teleport", "Forced"], MODES_PL = ["Walk 30", "Swim", "Climb", "Jump", "Teleport"];
  function zTokMenuGM(st) {
    return '<div class="q-menu z-menu" style="' + st + '"><div class="z-mtitle"><b>Goblin Boss</b><span class="q-mut">Monster · 15/21</span></div>' +
      '<div class="q-mh">How it moves</div><div class="z-msec">' + seg2(MODES_GM, "Walk 30") + "</div>" +
      '<div class="q-mh">Height</div><div class="z-msec">' + zStep("Ground") + swl(false, "In the air") + "</div>" +
      '<div class="q-mh">The token</div><div class="q-mi">Size<span class="end">Small</span></div><div class="q-mi">Health<span class="end">Default (table)</span></div><div class="q-mi">Set token image</div><div class="q-mi">Hide from players</div><div class="q-mi">Return to tray</div>' +
      '<div class="q-mh">The creature</div><div class="q-mi">Open stat block</div><div class="q-mi">Use reaction</div><div class="q-mi">Hit points and conditions<span class="end">In its row</span></div></div>';
  }
  function zTokMenuPL(st) {
    return '<div class="q-menu z-menu" style="' + st + '"><div class="z-mtitle"><b>Borin Stoneguard</b></div>' +
      '<div class="q-mh">How Borin moves</div><div class="z-msec">' + seg2(MODES_PL, "Walk 30") + "</div>" +
      '<div class="q-mi">Conditions<span class="end">None</span></div><div class="q-mi">Open character sheet</div><div class="q-mi">Use reaction</div></div>';
  }
  function zTokCradlesGM() {
    return cr("How it moves", '<div class="q-seg">' + seg2(MODES_GM, "Walk 30") + "</div>") +
      cr("Height", '<div class="q-seg" style="align-items:center">' + zStep("Ground") + swl(false, "In the air") + "</div>") +
      cr("The token", '<div class="q-seg">' + bl("Size · Small", "", "down") + bl("Health · Default (table)", "", "down") + bl("Set token image") + bl("Hide from players") + bl("Return to tray") + "</div>") +
      '<div style="margin-top:12px">' + og("The creature", '<div class="q-seg">' + bl("Open stat block") + bl("Use reaction") + "</div>") + "</div>";
  }
  function zTokCradlesPL() {
    return cr("How Borin moves", '<div class="q-seg">' + seg2(MODES_PL, "Walk 30") + "</div>") +
      '<div style="margin-top:12px">' + og("Borin", '<div class="q-seg">' + bl("Conditions · None", "", "down") + bl("Open character sheet") + bl("Use reaction") + "</div>") + "</div>";
  }
  function zChosen(m, id) { return m.replace(new RegExp('class="ttok([^"]*)" style="([^"]*)">' + id + "<"), 'class="ttok$1 q-chosen" style="$2">' + id + "<"); }
  function zRowDock(inner, who) {
    var o = ord("v");
    o = o.replace(new RegExp('<div class="c-ent( act)?">(<span class="fc( foe)?">' + who + "</span>)"), '<div class="c-ent$1 q-chosenrow">$2');
    o = o.replace(/(<div class="c-ent( act)? q-chosenrow">[^]*?<\/div>)(<div class="c-ent)/, "$1" + '<div class="q-dockopen">' + inner + "</div>$3");
    return '<div class="dock" style="grid-template-rows:minmax(0,1fr) auto">' + o + tools("grid") + "</div>";
  }
  function tokenPage(phone) {
    var v = S.z1;
    if (!phone) return asTurn("boss", function () {
      var map = zChosen(mapEl(false), "GB");
      if (v === "menu") return zGmLap({ map: map, over: zTokMenuGM("left:350px;top:30px") });
      if (v === "row") return zGmLap({ cols: "330px minmax(0,1fr) 380px", dock: zRowDock('<div class="z-folded">Hit points 15/21 · Conditions · Position' + IC.up + "</div>" + zTokCradlesGM(), "GB"), map: map });
      if (v === "glass") return zGmLap({ map: map, over: '<div class="z-glass" style="left:250px;top:20px;width:330px"><div class="z-ghead"><b>Goblin Boss</b><span class="q-mut">15/21 · Small</span>' + zX() + "</div>" + '<div class="q-h">How it moves</div><div class="q-seg">' + seg2(MODES_GM, "Walk 30") + '</div><div class="q-h">Height</div><div class="q-seg" style="align-items:center">' + zStep("Ground") + swl(false, "In the air") + '</div><div class="q-seg" style="padding-top:4px">' + bl("Open stat block") + bl("Use reaction") + bl("Hide from players") + bl("More", "", "down") + "</div></div>" });
      if (v === "sheet") return zGmLap({ map: map, panel: panel2("enc", turnBody(false), null, '<div class="q-sheet" style="top:44px"><div class="qs-h"><b>Goblin Boss</b>' + bl("Done") + '</div><div class="qs-b">' + zTokCradlesGM() + "</div></div>") });
      return zGmLap({ map: map, panel: panel2("tok", '<div class="turn"><div class="q-head">' + fcq(C[0]) + '<div><h3>Goblin Boss</h3><p>Chosen on the map · you run it</p></div><div class="hp"><b>15<small style="font-size:.6em;color:var(--text-muted)">/21</small></b><span>AC 17</span></div></div><div style="margin-top:12px"></div>' + zTokCradlesGM() + "</div>") });
    });
    return asTurn("boss", function () { return asPlayer(function () {
      var map = zChosen(mapEl(true), "B");
      if (v === "menu") return zPlPhone({ view: zMapView(map), over: zTokMenuPL("left:10px;right:10px;width:auto;bottom:8px") });
      if (v === "row" || v === "sheet") {
        var head = v === "row" ? '<div class="q-dockrow" style="box-shadow:inset 2px 0 0 var(--cyan);background:color-mix(in srgb,var(--cyan) 7%,transparent);padding:0 8px">' + fcq(C[1]) + "<b>Borin</b><span class=\"q-mut\" style=\"margin-left:auto\">58/67 · AC 17</span></div>" : '<div class="k-lhead"><b style="font:600 15px var(--f-display);letter-spacing:.05em;text-transform:uppercase">Borin Stoneguard</b>' + bl("Done") + "</div>";
        return zPlPhone({ view: zMapView(map), over: '<div class="k-sheet" style="max-height:60%"><div class="grab2"></div>' + head + zTokCradlesPL() + "</div>" });
      }
      if (v === "glass") return zPlPhone({ view: zMapView(zMap(map, '<div class="z-glass" style="left:10px;right:10px;bottom:10px"><div class="z-ghead"><b>Borin Stoneguard</b><span class="q-mut">58/67</span>' + zX() + '</div><div class="q-h">How Borin moves</div><div class="q-seg">' + seg2(MODES_PL, "Walk 30") + '</div><div class="q-seg">' + bl("Conditions · None", "", "down") + bl("Open character sheet") + bl("Use reaction") + "</div></div>")) });
      return zPlPhone({ seg: "turn", view: '<div class="pbody" style="overflow:hidden"><div class="turn">' + '<div class="q-head">' + fcq(C[1]) + '<div><h3>Borin Stoneguard</h3><p>Your token · chosen on the map</p></div><div class="hp"><b>58<small style="font-size:.6em;color:var(--text-muted)">/67</small></b><span>AC 17</span></div></div><div style="margin-top:12px"></div>' + zTokCradlesPL() + "</div></div>" });
    }); });
  }

  /* ---------- 2. How it moves: Borin's turn, climbing the bank ---------- */
  var BMODES = [["Walk", "30 ft left", "30", 0], ["Climb", "Each foot costs 2 · 15 ft left", "15", 1], ["Swim", "Each foot costs 2 · 15 ft left", "15", 0], ["Jump", "Long 10 ft · high 3 ft", "10", 0], ["Teleport", "With a spell or feature", "--", 0, 1]];
  function zModeRows() { return BMODES.map(function (m) { return '<div class="z-mv' + (m[3] ? " on" : "") + (m[4] ? " off" : "") + '"><span><b>' + m[0] + "</b><small>" + m[1] + '</small></span><span class="n">' + m[2] + "</span></div>"; }).join(""); }
  function zPathMap(map) { return zMap(map, '<svg class="z-path" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="48" y1="50" x2="43" y2="40"/></svg><span class="z-ghost" style="left:43%;top:40%"></span><span class="z-tag" style="left:30%;top:36%">Climb · <b>10</b> of <b>15</b> ft</span>'); }
  function zBorinTurn(moveOn, extra) {
    var tab = function (g, label, on) { return '<span class="ctab' + (on ? " on" : "") + '"><span class="lmp' + (g === "b" ? " b" : g === "r" ? " r" : "") + '"><i></i></span>' + label + '<span class="st">READY</span></span>'; };
    var tabs = '<div class="ctabs">' + tab("a", "Action", !moveOn) + tab("b", "Bonus Action") + tab("r", "Reaction") + '<span class="ctab mv' + (moveOn ? " on" : "") + '"><span class="v">15</span>Move<span class="st">FEET</span></span></div>';
    var rows = moveOn ? '<div class="q-h" style="padding:10px 0 2px">How Borin moves</div>' + zModeRows() + '<div class="q-h" style="padding:12px 0 6px">Height</div><div class="q-seg" style="align-items:center">' + zStep("Ground") + "</div>" : '<div class="arows">' + ahead() + '<div class="arow"><div><b>Greatsword</b><small>Melee · two-handed</small></div><span class="c">5 ft</span><span class="n">+7</span><span class="d">2d6+4<small>slash.</small></span></div><div class="arow"><div><b>Javelin</b><small>Thrown</small></div><span class="c">30 ft</span><span class="n">+7</span><span class="d">1d6+4<small>pierc.</small></span></div></div>';
    return '<div class="turn"><div class="turn-h"><p class="yourturn">YOUR TURN</p><div class="hp"><b>58<small style="font-size:.6em;color:var(--text-muted)">/67</small></b><span>AC 17</span></div></div>' + tabs + (extra || "") + rows + "</div>";
  }
  function zSpeedsDock() {
    var o = ord("v");
    o = o.replace(/(<div class="c-ent act">[^]*?)(<\/div>)(<div class="c-ent)/, function (all, a, b, c) { return a + '<div class="z-speeds">' + bl("Walk <b>30</b>") + bl("Climb <b>15</b>", "on") + bl("Swim <b>15</b>") + bl("Jump") + "</div>" + b + c; });
    return '<div class="dock" style="grid-template-rows:minmax(0,1fr) auto">' + o + tools("grid") + "</div>";
  }
  function movingPage(phone) {
    var v = S.z2;
    return asTurn("borin", function () { return asPlayer(function () {
      var foot = BFOOT;
      var map = zPathMap(mapEl(phone));
      var menu = '<div class="q-menu z-menu" style="' + (phone ? "left:12px;right:12px;width:auto;top:52%" : "left:590px;top:400px") + '"><div class="z-mtitle"><b>Borin Stoneguard</b></div><div class="q-mh">How Borin moves</div><div class="z-msec">' + seg2(["Walk 30", "Climb 15", "Swim 15", "Jump", "Teleport"], "Climb 15") + '</div><div class="q-mi">Conditions<span class="end">None</span></div><div class="q-mi">Open character sheet</div></div>';
      var drag = '<div class="z-glass" style="' + (phone ? "left:10px;right:10px;bottom:10px" : "left:50%;bottom:18px;transform:translateX(-50%);width:440px") + '"><div class="z-ghead"><b>Moving Borin</b><span class="z-tag" style="position:static"><b>10</b> of <b>15</b> ft</span></div><div class="q-seg">' + bl("Walk") + bl("Climb", "on") + bl("Swim") + bl("Jump") + bl("Teleport") + '</div><span class="q-mut">Let go to move. Escape puts Borin back.</span></div>';
      var chip = '<span class="z-tokchip" style="left:48%;top:calc(50% + 34px)">Climb' + IC.down + "</span>";
      var chipMenu = '<div class="q-menu" style="width:200px;' + (phone ? "left:30%;top:calc(50% + 58px)" : "left:30%;top:calc(50% + 58px)") + '"><div class="q-mi">Walk<span class="end">30</span></div><div class="q-mi" style="color:var(--cyan-hi)">Climb<span class="end">15</span></div><div class="q-mi">Swim<span class="end">15</span></div><div class="q-mi">Jump<span class="end">10</span></div></div>';
      if (!phone) {
        if (v === "menu") return zPlLap({ map: map, panel: zPlPanel("turn", zBorinTurn(false), foot), over: menu });
        if (v === "movetab") return zPlLap({ map: map, panel: zPlPanel("turn", zBorinTurn(true), foot) });
        if (v === "drag") return zPlLap({ map: zMap(map, drag), panel: zPlPanel("turn", zBorinTurn(false), foot) });
        if (v === "chip") return zPlLap({ map: zMap(map, chip + chipMenu), panel: zPlPanel("turn", zBorinTurn(false), foot) });
        return zPlLap({ dock: zSpeedsDock(), map: map, panel: zPlPanel("turn", zBorinTurn(false), foot) });
      }
      if (v === "menu") return zPlPhone({ view: zMapView(map), foot: foot, over: menu.replace("top:52%", "bottom:8px") });
      if (v === "movetab") return zPlPhone({ seg: "turn", view: '<div class="pbody" style="overflow:hidden">' + zBorinTurn(true) + "</div>", foot: foot });
      if (v === "drag") return zPlPhone({ view: zMapView(zMap(map, drag)), foot: foot });
      if (v === "chip") return zPlPhone({ view: zMapView(zMap(map, chip + chipMenu)), foot: foot });
      var strip = ord("h").replace(/(<div class="c-ent act">[^]*?)(<\/div>)/, '$1<div class="z-speeds">' + bl("Climb <b>15</b>", "on", "down") + "</div>$2");
      return zPlPhone({ view: zMapView(map), foot: foot, strip: strip });
    }); });
  }

  /* ---------- 3. A door ---------- */
  var DWAYS = [["Pick the lock", "Dexterity check with Thieves' Tools · DC 15"], ["Force it open", "Strength (Athletics) check · DC 15"], ["Pry it open with tools", "Strength check with a crowbar · DC 15"]];
  var DBLOCK = ["Jam it with an Iron Spike", "Seal it with Carpenter's Tools", "Push an Immovable Rod's button"];
  function zDoorEl(x, y1, y2, on) { return '<span class="z-door' + (on ? " on" : "") + '" style="left:' + x + "%;top:" + y1 + "%;height:" + (y2 - y1) + '%"><i></i></span>'; }
  function zDoorFacts() { return '<div class="z-nums"><div><b>15</b><small>Lock DC</small></div><div><b>15</b><small>AC</small></div><div><b>18<span style="font-size:.6em;color:var(--text-muted)">/18</span></b><small>Hit points</small></div></div>'; }
  function zDoorBody(v, who, gmv, compact) {
    var line = '<span class="q-mut">' + who + " does it. Each takes an action in an encounter.</span>";
    var edit = gmv ? '<div class="q-mi" style="border-top:1px solid var(--line)">Edit lock and strength</div>' : "";
    if (v === "rollrows") return '<div style="display:grid;gap:4px;padding:4px 12px 8px"><div class="q-seg">' + bl("Open the door") + '<span class="q-mut" style="align-self:center">It is locked</span></div>' + DWAYS.map(function (d) { return rollRow(d[0], d[1], "d20"); }).join("") + '<div class="q-seg" style="padding-top:4px">' + DBLOCK.map(function (d) { return bl(d); }).join("") + "</div>" + line + "</div>" + edit;
    if (v === "groups") return '<div style="padding:0 16px 8px">' + [["Open", ["Open the door"]], ["Unlock", ["Pick the lock · DC 15"]], ["Break", ["Force it open · DC 15", "Pry it open with tools · DC 15"]], ["Block", DBLOCK]].map(function (g) { return '<div class="z-grp"><div class="q-h">' + g[0] + '</div><div class="q-seg">' + g[1].map(function (d) { return bl(d); }).join("") + "</div></div>"; }).join("") + '<div style="padding-top:8px">' + line + "</div></div>" + edit;
    if (v === "glass") return zDoorFacts() + '<div class="q-seg">' + bl("Open the door") + DWAYS.map(function (d) { return bl(d[0]); }).join("") + '</div><div class="q-seg">' + DBLOCK.map(function (d) { return bl(d); }).join("") + "</div>" + line + (gmv ? '<div class="q-seg">' + bl("Edit lock and strength") + "</div>" : "");
    return '<div class="q-mi">Open the door</div>' + DWAYS.map(function (d) { return '<div class="q-mi">' + d[0] + "</div>"; }).join("") + DBLOCK.map(function (d) { return '<div class="q-mi">' + d + "</div>"; }).join("") + '<div style="padding:6px 16px 8px;display:grid;gap:6px">' + line + '<span class="q-mut">To attack the door or cast a spell on it, choose the attack or the spell, then tap the door.</span></div>' + edit;
  }
  function zDoorMenu(v, who, gmv, st) { return '<div class="q-menu z-menu" style="' + st + (v === "rollrows" ? ";width:380px" : "") + '"><div class="z-mtitle"><b>Door</b><span class="q-mut">Closed · locked · AC 15 · 18 HP</span></div>' + zDoorBody(v, who, gmv) + "</div>"; }
  function zDoorTurnRows(who) { return '<div class="q-h" style="padding:10px 6px 2px;color:var(--cyan-hi)">At the door · chosen on the map</div>' + '<div class="arow"><div><b>Open the door</b><small>It is locked</small></div><span class="c">5 ft</span><span class="n">--</span><span class="d"></span></div>' + DWAYS.map(function (d) { return '<div class="arow"><div><b>' + d[0] + "</b><small>" + d[1].replace(" · DC 15", "") + '</small></div><span class="c">5 ft</span><span class="n">DC 15</span><span class="d">d20</span></div>'; }).join("") + '<div class="arow"><div><b>Block it</b><small>Iron Spike, Carpenter\'s Tools, Immovable Rod</small></div><span class="c">5 ft</span><span class="n"></span><span class="d">' + IC.down + "</span></div>"; }
  function doorPage(phone) {
    var v = S.z3;
    if (!phone) return asTurn("boss", function () {
      var map = zMap(mapEl(false), zDoorEl(60, 20, 32, 1));
      if (v === "turn") return zGmLap({ map: map, panel: panel2("enc", turnBody(false).replace(ahead(), ahead() + zDoorTurnRows("Goblin Boss"))) });
      if (v === "glass") return zGmLap({ map: map, over: '<div class="z-glass" style="left:250px;top:30px;width:350px"><div class="z-ghead"><b>Door</b><span class="q-mut">Closed · locked</span>' + zX() + "</div>" + zDoorBody("glass", "Goblin Boss", 1) + "</div>" });
      return zGmLap({ map: map, over: zDoorMenu(v, "Goblin Boss", 1, "left:" + (v === "rollrows" ? 240 : 300) + "px;top:30px") });
    });
    return asTurn("borin", function () { return asPlayer(function () {
      var map = zMap(mapEl(true), zDoorEl(22, 6, 20, 1));
      var foot = BFOOT;
      if (v === "turn") return zPlPhone({ seg: "turn", view: '<div class="pbody" style="overflow:hidden">' + zBorinTurn(false).replace(ahead(), ahead() + zDoorTurnRows("Borin")) + "</div>", foot: foot });
      if (v === "glass") return zPlPhone({ view: zMapView(zMap(map, '<div class="z-glass" style="left:10px;right:10px;bottom:10px"><div class="z-ghead"><b>Door</b><span class="q-mut">Closed · locked</span>' + zX() + "</div>" + zDoorBody("glass", "Borin", 0) + "</div>")), foot: foot });
      return zPlPhone({ view: zMapView(map), foot: foot, over: zDoorMenu(v, "Borin", 0, "left:10px;right:10px;width:auto;top:262px;bottom:8px;max-height:none").replace('class="q-menu z-menu"', 'class="q-menu z-menu z-ph"') });
    }); });
  }

  /* ---------- 4. A tool's options: the GM's Light, a player's Draw ---------- */
  function zLightOpts() {
    return '<div class="q-seg">' + seg2(["Place", "Remove"], "Place") + "</div>" + zField("Light to place", sel2("Torch · 20 ft + 20 ft")) + '<span class="q-mut">Choose Place, then tap the map.</span>' +
      '<div class="q-seg">' + bl("Paint area") + "</div>" + zField("Area to paint", sel2("Heavily obscured (fog, foliage)")) +
      zField("Ambient light", '<div class="q-seg">' + seg2(["Bright", "Dim", "Dark"], "Bright") + "</div>") + '<div class="q-seg" style="gap:14px">' + swl(false, "Sunlight") + swl(true, "Vision") + "</div>" + zField("See as a token", sel2("None"));
  }
  function zDrawOpts() { return '<div class="q-seg">' + seg2(["Circle", "Cone", "Line", "Square"], "Line") + "</div>" + zField("Who sees new drawings", sel2("Shown to players")) + zField("Your colour", zSw(0)) + '<div class="q-seg">' + bl("Remove all my shapes") + "</div>"; }
  function zLightStrip() { return '<div class="z-strip">' + seg2(["Place", "Remove"], "Place") + sel2("Torch · 20 ft + 20 ft") + '<span class="sep"></span>' + bl("Paint area") + sel2("Heavily obscured") + '<span class="sep"></span><span class="q-h">Ambient</span>' + seg2(["Bright", "Dim", "Dark"], "Bright") + '<span class="sep"></span>' + bl("More", "", "down") + "</div>"; }
  function zDrawStrip() { return '<div class="z-strip">' + seg2(["Circle", "Cone", "Line", "Square"], "Line") + sel2("Shown to players") + zSw(0).replace('class="z-sw"', 'class="z-sw" style="gap:4px"') + bl("More", "", "down") + "</div>"; }
  function toolsPage2(phone) {
    var v = S.z4;
    if (!phone) return asTurn("boss", function () {
      var dock = dockOf().replace(tools("grid"), zTools("grid", "light"));
      var head = '<div class="z-colhead"><b>Light</b>' + zX() + "</div>";
      if (v === "beside") return zGmLap({ dock: dock, over: '<div class="z-col" style="left:232px;width:250px">' + head + '<div class="z-opts">' + zLightOpts() + "</div></div>" });
      if (v === "dock") return zGmLap({ cols: "330px minmax(0,1fr) 380px", dock: '<div class="dock" style="grid-template-rows:minmax(0,1fr) auto"><div class="z-dockopts">' + head.replace(zX(), bl("Done")) + '<div class="z-opts">' + zLightOpts() + "</div></div>" + zTools("grid", "light") + "</div>" });
      if (v === "strip") return zGmLap({ dock: dock, map: zMap(mapEl(false), zLightStrip()) });
      if (v === "sheet") return zGmLap({ dock: dock, panel: panel2("enc", turnBody(false), null, '<div class="q-sheet" style="top:44px"><div class="qs-h"><b>Light</b>' + bl("Done") + '</div><div class="qs-b"><div class="z-opts">' + zLightOpts() + "</div></div></div>") });
      return zGmLap({ dock: dock, over: '<div class="q-menu z-menu" style="left:236px;bottom:40px;width:300px;padding-bottom:10px"><div class="z-mtitle"><b>Light</b></div><div class="z-opts" style="padding:4px 16px">' + zLightOpts() + "</div></div>" });
    });
    return asTurn("boss", function () { return asPlayer(function () {
      var tr = zTools("row", "draw");
      var block = '<div class="z-under">' + zDrawOpts() + "</div>";
      if (v === "beside") return zPlPhone({ view: zMapView(mapEl(true), tr, block) });
      if (v === "dock") return zPlPhone({ strip: '<div class="z-under" style="border-top:1px solid var(--line-strong)"><div class="z-colhead"><b>Draw</b>' + bl("Done") + "</div>" + zDrawOpts() + "</div>", view: zMapView(mapEl(true), tr) });
      if (v === "strip") return zPlPhone({ view: zMapView(zMap(mapEl(true), zDrawStrip()), tr) });
      if (v === "sheet") return zPlPhone({ view: zMapView(mapEl(true), tr), over: '<div class="k-sheet" style="max-height:60%"><div class="grab2"></div><div class="k-lhead"><b style="font:600 15px var(--f-display);letter-spacing:.05em;text-transform:uppercase">Draw</b>' + bl("Done") + "</div>" + zDrawOpts() + "</div>" });
      return zPlPhone({ view: zMapView(mapEl(true), tr).replace('<div class="tmap">', '<div class="tmap"><div class="q-menu z-menu" style="right:10px;top:6px;width:290px;padding-bottom:10px"><div class="z-opts" style="padding:6px 16px">' + zDrawOpts() + "</div></div>") });
    }); });
  }

  /* ---------- 5. A drawing: the GM's 20 ft circle, Borin's 30 ft line ---------- */
  function zShapeEd(gmv, compact) {
    var head = '<div class="z-ghead"><b>' + (gmv ? "20 ft circle" : "30 ft line") + "</b>" + (compact ? "" : '<span class="q-mut">' + (gmv ? "GM ink" : "Yours") + "</span>") + "</div>";
    return (compact ? "" : head) + zField("Colour", zSw(gmv ? 3 : 0)) + zField("Who sees this", sel2(gmv ? "Only the GM" : "Shown to players")) + '<div class="q-seg">' + swl(false, "Others can move this") + '</div><div class="q-seg">' + bl("Remove", "danger") + "</div>";
  }
  function zShapeStrip(gmv) { return '<div class="z-strip"><span class="q-h" style="color:var(--text)">' + (gmv ? "20 ft circle" : "30 ft line") + "</span>" + zSw(gmv ? 3 : 0).replace('class="z-sw"', 'class="z-sw" style="gap:4px"') + sel2(gmv ? "Only the GM" : "Shown to players") + swl(false, "Others can move it") + bl("Remove", "danger") + "</div>"; }
  function drawingPage(phone) {
    var v = S.z5;
    if (!phone) return asTurn("boss", function () {
      var map = zMap(mapEl(false), '<span class="z-circle on" style="left:57%;top:47%;width:140px;height:140px;margin:-70px 0 0 -70px"></span>');
      if (v === "options") return zGmLap({ map: map, over: '<div class="z-col" style="left:232px;width:250px"><div class="z-colhead"><b>Selected drawing</b>' + zX() + '</div><div class="z-opts">' + zShapeEd(1) + "</div></div>" });
      if (v === "glass") return zGmLap({ map: map, over: '<div class="z-glass" style="left:250px;top:30px;width:250px">' + zShapeEd(1) + "</div>" });
      if (v === "tab") return zGmLap({ map: map, panel: panel2("tok", '<div class="turn"><div class="z-opts">' + zShapeEd(1) + "</div></div>").replace(/>Token</, ">Drawing<") });
      if (v === "strip") return zGmLap({ map: zMap(map, zShapeStrip(1)) });
      return zGmLap({ map: map, over: '<div class="q-menu z-menu" style="left:690px;top:330px;width:260px;padding-bottom:10px"><div class="z-opts" style="padding:8px 16px">' + zShapeEd(1) + "</div></div>" });
    });
    return asTurn("boss", function () { return asPlayer(function () {
      var map = zMap(mapEl(true), '<span class="z-line on" style="left:48%;top:50%;width:46%;transform:rotate(-38deg)"></span>');
      if (v === "options") return zPlPhone({ view: zMapView(map, zTools("row", "select"), '<div class="z-under">' + zShapeEd(0) + "</div>") });
      if (v === "glass") return zPlPhone({ view: zMapView(zMap(map, '<div class="z-glass" style="left:10px;right:10px;bottom:10px">' + zShapeEd(0) + "</div>")) });
      if (v === "tab") return zPlPhone({ seg: "turn", view: '<div class="pbody" style="overflow:hidden"><div class="turn"><div class="q-h" style="color:var(--cyan-hi)">Drawing · chosen on the map</div><div class="z-opts" style="padding-top:8px">' + zShapeEd(0) + "</div></div></div>" });
      if (v === "strip") return zPlPhone({ view: zMapView(zMap(map, zShapeStrip(0))) });
      return zPlPhone({ view: zMapView(zMap(map, '<div class="q-menu z-menu" style="left:12px;right:12px;width:auto;top:44%;padding-bottom:10px"><div class="z-opts" style="padding:8px 16px">' + zShapeEd(0) + "</div></div>")) });
    }); });
  }
