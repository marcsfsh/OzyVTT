
  /* =========================================================================
     C4 and C6 round 1: a player's moments in a fight. Lyra's player is on both sizes for the prompts; Mirena's player
     for choosing and the spell card. The table (C), C3, C5 and the theme are drawn as approved.
     ========================================================================= */
  function plTop() {
    var nav = '<nav class="ap-nav" aria-hidden="true"><span class="on" data-seat>Table</span><span>Sheet</span><span>Codex</span></nav>';
    var chip = '<span class="live-chip"><i class="lamp"></i>Old road<span class="vcr">R02</span></span>';
    var me = '<span class="me-btn"><span class="face lg">' + (S.pg === "choose" || S.pg === "spell" ? "M" : "L") + "</span>" + IC.down + "</span>";
    return '<header class="ap-bar">' + wm() + nav + chip + '<div class="ap-end">' + ico("search") + me + "</div></header>";
  }
  function plDock() { return '<div class="dock" style="grid-template-rows:minmax(0,1fr) auto">' + ord("v") + tools("grid") + "</div>"; }
  function plTabs(on) { return '<div class="sh-tabs k-tabs">' + [["turn", "Turn"], ["sheet", "Sheet"], ["log", "Log", "2"], ["party", "Party"]].map(function (x) { return '<span class="sh-tab' + (x[0] === on ? " on" : "") + '">' + x[1] + (x[2] && x[0] !== on ? '<span class="k-c">' + x[2] + "</span>" : "") + "</span>"; }).join("") + "</div>"; }
  function waitFoot() { return '<div class="pfoot"><p>Your turn comes after Borin.</p></div>'; }
  function myFoot(t) { return '<div class="pfoot"><div class="row1"><button type="button" class="cup">' + (t || "End turn") + '</button></div><p>Next: Goblin Warrior 1</p></div>'; }
  function zone(inner, o) { o = o || {}; return '<div class="k-zone"' + (o.st ? ' style="' + o.st + '"' : "") + ">" + inner + "</div>"; }

  /* ---------- The prompts ---------- */
  function rollRow(b, sm, n) { return '<div class="q-rollrow"><span><b>' + b + "</b><small>" + sm + '</small></span><span class="n">' + n + "</span></div>"; }
  function saveCard() { return '<div class="y-card"><span class="e">Saving throw</span><span class="t">DC 13 Dexterity saving throw</span><span class="l">The tripwire\'s darts: 7 piercing damage on a failure, half on a success.</span>' + rollRow("Dexterity save +1 · DC 13", "press to roll", "d20") + '<div class="a">' + bl("Choose to fail") + '</div><span class="y-more">1 more after this: The GM calls for a roll</span></div>'; }
  function saveBand() { return '<div class="y-band"><span class="tag need">SAVE</span><span class="w"><b>DC 13 Dexterity saving throw</b> · the tripwire\'s darts, 7 piercing on a failure</span><span class="k-btn main">Roll · d20 + 1</span>' + bl("More") + "</div>"; }
  var SHIELD_T = "Goblin Boss's attack would hit you";
  var SHIELD_L = "Its Scimitar rolled 15 against your AC 11. Shield gives +5 AC until your next turn, so the attack misses. It costs a level 1 spell slot, and you have 3 left.";
  function nums(big) { return '<div class="y-nums' + (big ? " big" : "") + '"><div><b class="red">15</b><small>Their roll</small></div><div><b>11</b><small>Your AC</small></div><div><b class="cy">16</b><small>With Shield</small></div></div>'; }
  function shieldCard() {
    var v = S.p2, head = '<span class="e">Reaction</span><span class="t">' + SHIELD_T + "</span>";
    if (v === "buttons") return '<div class="y-card">' + head + '<span class="l">' + SHIELD_L + "</span>" + nums() + '<div class="a">' + bl("Take the hit") + '<span class="k-btn main">Cast Shield</span></div></div>';
    if (v === "rollrow") return '<div class="y-card">' + head + '<span class="l">Its Scimitar rolled 15 against your AC 11.</span>' + rollRow("Cast Shield · AC 16 against 15", "The attack misses · a level 1 spell slot, 3 left", "16") + '<div class="a">' + bl("Take the hit · it hits you") + "</div></div>";
    if (v === "compare") return '<div class="y-card">' + head + '<span class="l">Its Scimitar rolled 15 against your AC 11.</span><div class="y-choice"><div class="y-opt"><b>Take the hit</b><span>The attack hits · keep your reaction</span></div><div class="y-opt"><b>Cast Shield</b><span>It misses · level 1 slot, 3 left</span></div></div></div>';
    if (v === "numbers") return '<div class="y-card">' + head + nums(true) + '<span class="l">Shield gives +5 AC until your next turn. It costs a level 1 spell slot, and you have 3 left.</span><div class="a">' + bl("Take the hit") + '<span class="k-btn main">Cast Shield</span></div></div>';
    return "";
  }
  function shieldBand() { return '<div class="y-band"><span class="tag need">REACTION</span><span class="w"><b>' + SHIELD_T + "</b> · 15 against your AC 11</span>" + bl("Take the hit") + '<span class="k-btn main">Cast Shield</span></div>'; }
  var DY_L = "You're Unconscious, so you can't act or move. An ally can heal you, or stabilize you with the Help action.";
  function pips() { return '<div class="q-dying">Dying<span>Saves <span class="q-pips"><i></i><i></i><i></i></span></span><span>Fails <span class="q-pips"><i class="f"></i><i></i><i></i></span></span></div>'; }
  function lamps() { return '<div class="y-lamps"><div class="g"><small>Saves</small><div class="row"><i></i><i></i><i></i></div></div><div class="g"><small>Fails</small><div class="row"><i class="f"></i><i></i><i></i></div></div></div>'; }
  function dyingCard() {
    var v = S.p3, head = '<span class="e">Death save</span><span class="t">You are dying · 0 successes · 1 failure</span><span class="l">' + DY_L + "</span>";
    if (v === "today") return '<div class="y-card danger">' + head + pips() + '<div class="a"><span class="k-btn main">Roll death save</span></div></div>';
    if (v === "rollrow") return '<div class="y-card danger">' + head + pips() + rollRow("Death save · d20", "10 or higher is a success · press to roll", "d20") + "</div>";
    if (v === "lamps") return '<div class="y-card danger">' + head + lamps() + rollRow("Death save · d20", "10 or higher is a success · press to roll", "d20") + "</div>";
    return "";
  }
  function dyingTurn() {
    var tabs = '<div class="ctabs">' + ["Action", "Bonus Action", "Reaction"].map(function (n, i) { return '<span class="ctab"><span class="lmp' + (i === 1 ? " b" : i === 2 ? " r" : "") + ' used"><i></i></span>' + n + '<span class="st">NOT NOW</span></span>'; }).join("") + '<span class="ctab mv"><span class="v">--</span>Move<span class="st">FEET</span></span></div>';
    return '<div class="turn"><div class="turn-h"><div><p class="y-dyinghead">You are dying</p><p style="margin:6px 0 0;font-size:12.5px;color:var(--text-muted)">Round 2 · 0 successes · 1 failure</p></div><div class="hp"><b>0<small style="font-size:.6em;color:var(--text-muted)">/44</small></b><span>AC 11</span></div></div>' + lamps() + rollRow("Death save · d20", "10 or higher is a success · press to roll", "d20") + '<p class="q-line" style="margin:0">' + DY_L + "</p>" + tabs + "</div>";
  }
  function dyingBand() { return '<div class="y-band danger"><span class="tag one">DYING</span><span class="w"><b>Your death save</b> · 0 successes · 1 failure</span><span class="k-btn main">Roll · d20</span></div>'; }

  /* ---------- Frames: where a prompt sits ---------- */
  function placeLap(o) {
    var p = o.place || S.p1;
    F.pl = 1;
    var tabs = plTabs("turn");
    var turn = o.turn || turnBody(false);
    var foot = o.foot || waitFoot();
    var top = "", body, over = "";
    var card = o.card;
    if (p === "top" && card) { top = zone(card, { st: "padding:10px 12px 12px" }); body = '<div class="pbody" style="overflow:hidden">' + turn + "</div>"; }
    else if (p === "turn" && card) body = '<div class="pbody" style="overflow:hidden;padding:0">' + zone(card, { st: "padding:10px 16px 12px" }) + '<div style="padding:12px 16px">' + turn + "</div></div>";
    else if (p === "foot" && card) { body = '<div class="pbody" style="overflow:hidden">' + turn + "</div>"; foot = foot.replace('<div class="pfoot">', '<div class="pfoot"><div style="margin:-12px -16px 8px;padding:10px 12px;border-bottom:1px solid var(--line-strong)">' + card + "</div>"); }
    else body = '<div class="pbody" style="overflow:hidden">' + turn + "</div>";
    var panelH = '<div class="tpan docked" style="grid-template-rows:' + (top ? "auto " : "") + 'auto minmax(0,1fr) auto;position:relative">' + top + tabs + body + foot + (o.over || "") + "</div>";
    var map = mapEl(false);
    if (p === "map" && card) map = map.replace('<div class="tmap">', '<div class="tmap"><div class="y-glass" style="padding:10px 12px">' + card.replace('class="y-card', 'class="y-card" style="border:0;background:none" data-x="') + "</div>");
    var band = p === "band" && o.band ? o.band : "";
    var out = '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-base">' + plTop() + '<div class="ap-pane is-cols" style="position:relative;display:grid;grid-template-rows:' + (band ? "auto " : "") + 'minmax(0,1fr)">' + band + '<div class="L docks">' + plDock() + map + panelH + "</div>" + (o.dlg || "") + "</div></div></div>";
    F.pl = 0;
    return out;
  }
  function placePhone(o) {
    var p = o.place || S.p1;
    F.pl = 1;
    var pbar = '<header class="pbar"><h1>Old road</h1><span class="vcr">R02</span><div class="end"><span class="ico">' + IC.me + "</span></div></header>";
    var tabs = [["Table", "play", 1], ["Sheet", "sheet"], ["Codex", "codex"], ["Log", "log"], ["More", "dots"]];
    var bottom = '<nav class="ap-bottom five" aria-hidden="true">' + tabs.map(function (t) { return '<span class="btab' + (t[2] ? " on" : "") + '">' + IC[t[1]] + t[0] + "</span>"; }).join("") + "</nav>";
    var card = o.card, segOn = p === "map" && card ? "map" : "turn";
    var view = o.view || '<div class="pbody" style="overflow:hidden">' + (o.turn || turnBody(true)) + "</div>";
    if (p === "turn" && card) view = '<div class="pbody" style="overflow:hidden;padding:0">' + zone(card, { st: "padding:8px 12px 10px" }) + '<div style="padding:12px">' + (o.turn || turnBody(true)) + "</div></div>";
    if (p === "map" && card) view = '<div class="pv-map" style="position:relative">' + tools("row") + mapEl(true).replace('<div class="tmap">', '<div class="tmap"><div class="y-glass" style="width:auto;left:10px;right:10px;transform:none;bottom:10px;padding:10px 12px">' + card.replace('class="y-card', 'class="y-card" style="border:0;background:none" data-x="') + "</div>") + "</div>";
    var foot = o.foot || waitFoot();
    if (p === "foot" && card) foot = foot.replace('<div class="pfoot">', '<div class="pfoot"><div style="margin:-12px -16px 8px;padding:8px 12px;border-bottom:1px solid var(--line-strong)">' + card + "</div>");
    var top = p === "top" && card ? zone(card, { st: "padding:8px 12px 10px" }) : "";
    var band = p === "band" && o.band ? o.band.replace('class="y-band', 'class="y-band ph') : "";
    var segs = '<div class="k-segs">' + [["map", "Map"], ["turn", "Turn"], ["log", "Log"], ["party", "Party"]].map(function (x) { return '<span class="' + (x[0] === segOn ? "on" : "") + '">' + x[1] + "</span>"; }).join("") + "</div>";
    var body = '<div class="P switch" style="grid-template-rows:auto ' + (band ? "auto " : "") + "auto " + (top ? "auto " : "") + 'minmax(0,1fr)">' + band + '<div class="segw">' + segs + "</div>" + ord("h") + top + '<div class="tpan" style="grid-template-rows:minmax(0,1fr) auto">' + view + foot + "</div>" + (o.over || "") + "</div>";
    var out = '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-base">' + pbar + '<div class="ap-pane" style="overflow:hidden;position:relative">' + body + "</div>" + bottom + "</div></div>";
    F.pl = 0;
    return out;
  }

  /* ---------- Choosing for a spell: Mirena casts Cure Wounds ---------- */
  var MIRR = [["a", "Sacred Flame", "Cantrip · Evocation", "60 ft", "DC 14", "2d8", "radiant"], ["a", "Guiding Bolt", "Level 1 · Evocation", "120 ft", "+6", "4d6", "radiant"], ["a", "Cure Wounds", "Level 1 · Abjuration", "Touch", "", "2d8+3", "healing"], ["a", "Bless", "Level 1 · up to three", "30 ft", "", "", ""], ["a", "Mace", "Weapon · Simple", "5 ft", "+4", "1d6+1", "bludg."]];
  function mirHead() { return '<div class="turn-h"><p class="yourturn">YOUR TURN</p><div class="hp"><b>44<small style="font-size:.6em;color:var(--text-muted)">/52</small></b><span>AC 16</span></div></div>'; }
  function mirTabs() { return '<div class="ctabs"><span class="ctab on"><span class="lmp"><i></i></span>Action<span class="st">READY</span></span><span class="ctab"><span class="lmp b"><i></i></span>Bonus Action<span class="st">READY</span></span><span class="ctab"><span class="lmp r"><i></i></span>Reaction<span class="st">READY</span></span><span class="ctab mv"><span class="v">30</span>Move<span class="st">FEET</span></span></div>'; }
  function mirRow(r, sel, extra) { return '<div class="arow' + (sel ? " sel" : "") + '"><div><b>' + r[1] + "</b><small>" + r[2] + '</small></div><span class="c">' + r[3] + '</span><span class="n">' + r[4] + '</span><span class="d">' + r[5] + (r[6] ? "<small>" + r[6] + "</small>" : "") + "</span></div>" + (extra || ""); }
  function mirTurn(o) { o = o || {}; return '<div class="turn">' + (o.from ? "" : mirHead() + mirTabs()) + '<div class="arows">' + (o.from ? "" : ahead()) + MIRR.slice(o.from || 0).map(function (r) { return mirRow(r, r[1] === "Cure Wounds" && o.sel, r[1] === "Cure Wounds" ? o.under : ""); }).join("") + "</div></div>"; }
  var WHO = [[C[1], "Borin Stoneguard", "58/67", "5 ft"], [C[2], "Lyra Emberwise", "12/44", "5 ft", 1], [C[5], "Mirena Dawnbright", "44/52", "You"]];
  function whoRows() { return WHO.map(function (w) { return '<div class="y-who' + (w[4] ? " on" : "") + '">' + fcq(w[0]) + "<span><b>" + w[1] + "</b><small>" + w[3] + '</small></span><span class="hp">' + w[2] + "</span></div>"; }).join(""); }
  function whoChips() { return '<div class="y-chips">' + WHO.map(function (w) { return bl(w[1], w[4] ? "on" : ""); }).join("") + "</div>"; }
  function slots() { return '<div class="q-h" style="padding-top:10px">Spell slot</div><div class="q-seg">' + bl("Level 1 · 4 left · 2d8", "on") + bl("Level 2 · 3 left · 4d8") + bl("Level 3 · 3 left · 6d8") + "</div>"; }
  function chooseInner(compact) { return '<span class="q-line">Choose who regains hit points.</span>' + (compact ? whoChips() : '<div style="padding-top:6px">' + whoRows() + "</div>") + slots(); }

  /* ---------- The spell card ---------- */
  var CW_T = "A creature you touch regains a number of Hit Points equal to 2d8 plus your spellcasting ability modifier.";
  var CW_H = "<b>At Higher Levels.</b> The healing increases by 2d8 for each spell slot level above 1.";
  function spellCells() { return '<div class="y-spell"><span class="ty">Level 1 Abjuration (Bard, Cleric, Druid, Paladin, Ranger)</span><div class="cells"><div><small>Casting time</small><b>Action</b></div><div><small>Range</small><b>Touch</b></div><div><small>Components</small><b>V, S</b></div><div><small>Duration</small><b>Instantaneous</b></div></div><p>' + CW_T + "</p><p>" + CW_H + '</p><span class="src">SRD 5.2.1, CC BY 4.0.</span></div>'; }
  function spellRecord() { return '<div class="y-spell"><div style="display:flex;align-items:center;gap:10px"><h3>Cure Wounds</h3><span class="tag draft">SRD 5.2.1</span></div><span class="ty">Level 1 Abjuration · Bard, Cleric, Druid, Paladin, Ranger</span><div class="facts"><span><b>Action</b></span><span>range <b>Touch</b></span><span><b>V, S</b></span><span><b>Instantaneous</b></span></div><p>' + CW_T + "</p><p>" + CW_H + '</p><span class="src">SRD 5.2.1, CC BY 4.0.</span></div>'; }

  /* ---------- Pages ---------- */
  function promptPage(phone) { F.mo = "boss"; var o = { card: saveCard(), band: saveBand() }; var r = phone ? placePhone(o) : placeLap(o); F.mo = "lyra"; return r; }
  function reactionPage(phone) {
    F.mo = "boss";
    var o;
    if (S.p2 === "costtab") {
      F.pl = 1;
      var t = turnBody(phone).replace('<div class="arow"><div><b>Shield', '<div class="arow sel"><div><b>Shield').replace('<div class="cstate">', '<div class="y-card" style="margin-bottom:2px"><span class="e">Reaction</span><span class="t">' + SHIELD_T + '</span><span class="l">Its Scimitar rolled 15 against your AC 11. Shield, at the top of your reactions, makes it miss; Take the hit lets it land.</span><div class="a">' + bl("Take the hit") + '<span class="k-btn main">Cast Shield</span></div></div><div class="cstate">');
      F.pl = 0;
      o = { place: "none", turn: t };
    } else o = { card: shieldCard(), band: shieldBand() };
    var r = phone ? placePhone(o) : placeLap(o);
    F.mo = "lyra";
    return r;
  }
  function dyingPage(phone) { C[2].hp = [0, 44]; var r = dyingPage1(phone); C[2].hp = [44, 44]; return r; }
  function dyingPage1(phone) {
    F.mo = "lyra";
    var foot = '<div class="pfoot"><div class="row1"><button type="button" class="cup" disabled style="opacity:.55">End turn</button></div><p>Roll your death save first.</p></div>';
    var o;
    if (S.p3 === "turn") o = { place: "none", turn: dyingTurn(), foot: foot };
    else if (S.p3 === "band") o = { place: "band", band: dyingBand(), turn: dyingTurn().replace(/<div class="q-rollrow">[^]*?<\/div>/, ""), foot: foot };
    else o = { card: dyingCard(), band: dyingBand(), turn: '<div class="turn">' + '<p class="q-line" style="margin:0">While Unconscious, Lyra Emberwise can\'t take any action or Reaction. The other tabs stay open for reading.</p></div>', foot: foot };
    return phone ? placePhone(o) : placeLap(o);
  }
  function choosePage(phone) { F.mo = "mirena"; C[2].hp = [12, 44]; var r = choosePage1(phone); F.mo = "lyra"; C[2].hp = [44, 44]; return r; }
  function choosePage1(phone) {
    var v = S.p4, foot = myFoot();
    var o = { place: "none", turn: mirTurn({ sel: 1 }), foot: foot };
    if (v === "dialog" || v === "steps") {
      var steps = v === "steps" ? '<div class="y-steps"><div class="y-step done"><i>' + IC.check + '</i><span><b>Who</b><small>Lyra Emberwise · 12/44</small></span><span class="ch">Change</span></div><div class="y-step cur"><i>2</i><span><b>Which spell slot</b><small>Step 2 of 2</small></span></div></div>' : "";
      var dl = '<div class="q-scrim"></div><div class="q-dlg" style="left:' + (phone ? "0;right:0;top:auto;bottom:0" : "380px;top:120px;width:520px") + '"><div class="dh"><b>Cure Wounds</b><span class="e-ico" style="box-shadow:none">' + IC.x + '</span></div><div style="padding:14px 18px">' + (v === "steps" ? steps + slots().replace('<div class="q-h" style="padding-top:10px">Spell slot</div>', "") : chooseInner(true)) + '</div><div class="df"><span style="flex:1"></span>' + bl(v === "steps" ? "Back" : "Cancel") + '<button type="button" class="cup" style="min-height:42px">Cast</button></div></div>';
      if (phone) o.over = dl.replace('class="q-dlg"', 'class="q-dlg" data-p="1"'); else o.dlg = dl;
    } else if (v === "targets") {
      o.turn = '<div class="turn"><div class="q-h" style="color:var(--cyan-hi)">Cure Wounds · choose one creature on the map or in the list</div>' + whoRows() + slots() + "</div>";
      o.foot = '<div class="pfoot"><div class="row1"><span class="back" style="width:auto;padding:0 12px">Cancel</span><button type="button" class="cup">Cast Cure Wounds</button></div><p>Touch · 5 ft</p></div>';
    } else if (v === "sheet") {
      var sh = '<div class="q-sheet" style="top:44px"><div class="qs-h"><b>Cure Wounds</b>' + bl("Cancel") + '</div><div class="qs-b">' + chooseInner(false) + '</div><div class="qs-f"><span class="q-mut">Touch · Action</span><span class="k-btn main">Cast</span></div></div>';
      if (phone) o.over = '<div class="k-sheet" style="max-height:calc(100% - 52px)"><div class="grab2"></div><div class="k-lhead"><b style="font:600 15px var(--f-display);letter-spacing:.05em;text-transform:uppercase">Cure Wounds</b></div>' + chooseInner(false) + '<div style="padding-top:10px"><span class="k-btn main">Cast</span></div></div>'; else o.over = sh;
    } else {
      // On a phone the turn is drawn scrolled down to the open row.
      o.turn = mirTurn({ sel: 1, from: phone ? 1 : 0, under: '<div class="q-dockopen" style="border-bottom:1px solid var(--line)">' + chooseInner(true) + '<div style="padding-top:10px"><span class="k-btn main">Cast at level 1</span></div></div>' });
    }
    return phone ? placePhone(o) : placeLap(o);
  }
  function spellPage(phone) { F.mo = "mirena"; C[2].hp = [12, 44]; var r = spellPage1(phone); F.mo = "lyra"; C[2].hp = [44, 44]; return r; }
  function spellPage1(phone) {
    var v = S.p5;
    var o = { place: "none", turn: mirTurn({ sel: 1 }), foot: myFoot() };
    var body = v === "record" ? spellRecord() : spellCells();
    if (v === "dialog" || v === "record") {
      var dl = '<div class="q-scrim"></div><div class="q-dlg" style="' + (phone ? "left:0;right:0;bottom:0" : "left:360px;top:110px;width:560px") + '"><div class="dh"><b>' + (v === "record" ? "" : "Cure Wounds") + '</b><span class="e-ico" style="box-shadow:none">' + IC.x + '</span></div><div style="padding:14px 18px 18px">' + body + "</div></div>";
      if (phone) o.over = dl; else o.dlg = dl;
    } else if (v === "sheet") {
      var sh = '<div class="q-sheet" style="top:44px"><div class="qs-h"><b>Cure Wounds</b>' + bl("Done") + '</div><div class="qs-b">' + spellCells().replace('<div class="y-spell">', '<div class="y-spell">') + "</div></div>";
      if (phone) o.over = '<div class="k-sheet" style="max-height:calc(100% - 52px)"><div class="grab2"></div><div class="k-lhead"><b style="font:600 15px var(--f-display);letter-spacing:.05em;text-transform:uppercase">Cure Wounds</b></div>' + spellCells() + "</div>"; else o.over = sh;
    } else if (v === "inplace") {
      o.turn = mirTurn({ sel: 1, from: phone ? 1 : 0, under: '<div class="q-dockopen" style="border-bottom:1px solid var(--line)">' + spellCells().replace('<span class="src">SRD 5.2.1, CC BY 4.0.</span>', "") + "</div>" });
    } else {
      o.turn = '<div class="turn"><div class="q-h">Rules <span class="sp"></span>' + bl("Back to the turn", "", "left") + "</div>" + spellRecord() + '<div><span class="k-btn main">Cast Cure Wounds</span></div></div>';
    }
    return phone ? placePhone(o) : placeLap(o);
  }
