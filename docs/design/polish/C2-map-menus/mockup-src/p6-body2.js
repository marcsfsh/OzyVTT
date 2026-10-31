
  /* =========================================================================
     C3 round 2. The table's frame (C) and C3's first round (the waiting list over the turn, cards, tabs with counts,
     the bell) are drawn as approved; each decision below changes only its own part.
     ========================================================================= */
  function bl(t, cls, ic) { return '<span class="q-bl' + (cls ? " " + cls : "") + '">' + (ic ? IC[ic] : "") + t + "</span>"; }
  function seg2(opts, on) { return '<span class="q-seg">' + opts.map(function (o) { return bl(o, o === on ? "on" : ""); }).join("") + "</span>"; }
  function chk(on) { return '<span class="q-chk' + (on ? " on" : "") + '">' + (on ? IC.check : "") + "</span>"; }
  function cr(head, inner, o) { o = o || {}; return '<div class="q-cr' + (o.lit ? " lit" : "") + '"><div class="q-h">' + head + "</div>" + inner + "</div>"; }
  function og(head, inner) { return '<div class="q-og"><div class="q-h">' + head + "</div>" + inner + "</div>"; }
  function fld(t, cls) { return '<span class="q-fld' + (cls ? " " + cls : "") + '">' + t + "</span>"; }
  function sel2(t) { return '<span class="q-fld">' + t + IC.down + "</span>"; }

  // Who is in it: the encounter page's rows (E 2.2), the same facts the start of a fight needs.
  var WHO = [
    { c: C[1], line: "Party, on the map", plays: "At the table" },
    { c: C[2], line: "Party, on the map", plays: "On their device", claimed: 1 },
    { c: C[5], line: "Party, on the map", plays: "At the table" },
    { c: C[0], line: "Monster, in the tray", mon: 1 },
    { c: C[3], line: "Monster, in the tray", mon: 1 },
    { c: C[4], line: "Monster, in the tray", mon: 1 }
  ];
  function diff() { return '<div class="q-diff"><div class="q-line">This encounter is worth <b>300 XP</b>: Below Low for 3 characters</div><span class="q-mut">Low 2,250 · Moderate 3,900 · High 5,100</span></div>'; }
  function swl(on, label) { return '<span class="q-line" style="display:inline-flex;align-items:center;gap:10px"><span class="sw' + (on ? " on" : "") + '"></span>' + label + "</span>"; }
  function initRows() { return '<div class="q-srow">' + swl(false, "Players roll their own initiative") + '</div><div class="q-srow">' + swl(true, "One roll for each group of identical monsters") + '</div><span class="q-mut" style="padding-top:6px">Players\' d20 rolls: the app rolls. Their damage: the app rolls.</span>'; }
  function playsRow(w) { return '<div class="q-row compact">' + fcq(w.c) + "<b>" + w.c.sh + "</b>" + (w.claimed ? '<span class="q-mut">Claimed on a player\'s device</span>' : seg2(["At the table", "On their device"], w.plays)) + "</div>"; }
  function startFoot() { return '<div class="pfoot"><div class="row1"><button type="button" class="cup">Start the encounter</button></div><p>Rolls initiative for all 6</p></div>'; }

  /* ---------- 1. Starting an encounter ---------- */
  function startBody(phone) {
    var v = S.r1;
    var whoRows = WHO.map(function (w) { return '<div class="q-row">' + fcq(w.c) + "<span><b>" + w.c.n + "</b><small>" + w.line + '</small></span><span class="end">' + chk(true) + "</span></div>"; }).join("");
    if (v === "form") return cr("In this encounter <span class=\"sp\"></span>" + bl("Add monsters", "", "plus"), whoRows) +
      cr("Who plays", WHO.filter(function (w) { return !w.mon; }).map(playsRow).join("") + '<span class="q-mut" style="padding-top:6px">At the table, you answer every prompt for the character and roll its dice.</span>') +
      cr("Initiative", initRows()) +
      cr("Surprised", '<div class="q-seg" style="padding-top:6px">' + WHO.map(function (w) { return bl(w.c.sh); }).join("") + '</div><span class="q-mut" style="padding-top:6px">Pick who is Surprised. They roll initiative at Disadvantage.</span>') +
      '<div style="margin-top:18px">' + og("Difficulty", diff()) + "</div>";
    if (v === "ready") {
      var R = [["In this encounter", "3 of the party, 3 monsters", "", 0], ["Placed", "3 tokens wait in the tray", "Go to it", 1], ["Who plays", "Borin and Mirena at the table", "", 0], ["Initiative", "Rolled here for everyone. Groups share a roll.", "", 0], ["Surprised", "Nobody", "", 0], ["Difficulty", "300 XP: Below Low for 3 characters", "", 0]];
      var open = 2;
      return cr("To start", R.map(function (r, k) {
        var row = '<div class="q-ready' + (k === open ? " open" : "") + '"><i' + (r[3] ? ' class="amber"' : "") + "></i><span><b>" + r[0] + "</b><small>" + r[1] + "</small></span>" + bl(r[2] || (k === open ? "Done" : "Change"), k === open ? "on" : "") + "</div>";
        if (k === open) row += '<div class="q-open">' + WHO.filter(function (w) { return !w.mon; }).map(playsRow).join("") + "</div>";
        return row;
      }).join("")) + '<p class="q-mut" style="margin:10px 0 0">The same lines as the encounter\'s page in Prep, each opening in place.</p>';
    }
    if (v === "ladder") return '<p class="q-line" style="margin:0 0 14px">Who is in it, who plays and who is surprised are set on each row of the order, at the left.</p>' +
      cr("Initiative", initRows()) +
      '<div style="margin-top:18px">' + og("Difficulty", diff()) + "</div>" +
      '<div style="margin-top:18px">' + og("Ready", '<div class="q-ready"><i class="amber"></i><span><b>3 tokens wait in the tray</b></span>' + bl("Go to it") + "</div>") + "</div>";
    // Who is in it, as Prep's tab: rows with their choices as chips
    return cr("Who is in it · 6 <span class=\"sp\"></span>" + bl("Add monsters", "", "plus"), WHO.map(function (w) {
      return '<div class="q-row" style="grid-template-columns:auto minmax(0,1fr) auto;align-items:start;padding:8px 0">' + fcq(w.c) + "<span><b>" + w.c.n + "</b><small>" + w.line + '</small><span class="q-seg" style="margin-top:6px">' + (w.mon ? bl("Surprised") : w.claimed ? '<span class="q-mut" style="align-self:center">Claimed on a player\'s device</span>' + bl("Surprised") : seg2(["At the table", "On their device"], w.plays) + bl("Surprised")) + "</span></span>" + chk(true) + "</div>";
    }).join("")) + cr("Initiative", initRows()) + '<div style="margin-top:18px">' + og("Difficulty", diff()) + "</div>";
  }
  // What waits on the GM on each page: nothing before a fight; the prompts' page has three.
  function itemsFor() { if (S.pg === "start") return []; if (S.pg === "prompts") return [IT.aim, IT.apply, IT.ask]; return [IT.aim, IT.apply]; }
  function fcq(c) { return '<span class="fc' + (c.foe ? " foe" : "") + '">' + c.s + "</span>"; }
  function startDock() {
    if (S.r1 !== "ladder") return null;
    var rows = WHO.map(function (w) { return '<div class="q-dockrow">' + fcq(w.c) + "<b>" + w.c.sh + "</b>" + chk(true) + '<span class="opts">' + (w.mon ? bl("Surprised") : w.claimed ? bl("Device", "on") + bl("Surprised") : seg2(["Table", "Device"], w.plays === "At the table" ? "Table" : "Device") + bl("Surprised")) + "</span></div>"; }).join("");
    return '<div class="dock" style="grid-template-rows:auto minmax(0,1fr) auto"><div class="ord v o-ladder"><div class="rnd"><span>STOP ■</span><b>RND --</b></div></div><div style="overflow:hidden">' + rows + "</div>" + tools("grid") + "</div>";
  }

  /* ---------- 2. A creature's tools (Goblin Boss chosen) ---------- */
  var BOSS_C = C[0];
  function toolsInner(o) {
    o = o || {};
    var head = '<div class="q-head">' + fcq(BOSS_C) + '<div><h3>Goblin Boss</h3><p>Monster · CR 1 · chosen on the map</p></div><div class="hp"><b>15<small style="font-size:.6em;color:var(--text-muted)">/21</small></b><span>AC 17</span></div></div>';
    var hp = cr("Hit points", '<div class="q-hpbar"><i style="width:71%"></i></div><div class="q-hp">' + fld("9", "num") + bl("Damage", "on") + bl("KO") + bl("Heal") + bl("Temp") + bl("Set") + bl("Max") + '</div><div class="q-hp">' + sel2("Untyped") + '<span class="q-mut">Damage type</span></div>' + (o.noPending ? "" : '<div class="q-line" style="padding-top:8px;color:var(--caution-text)">A hit waits in the list over the turn: 8 force from Lyra\'s Magic Missile.</div>'));
    var cond = cr("Conditions and effects", '<div class="q-cond">' + bl("Add", "", "plus") + '<span class="q-mut" style="align-self:center">None on it</span></div>');
    var pos = cr("Position", '<div class="q-srow side"><span class="q-line">Cover</span>' + seg2(["None", "Half", "Three-quarters", "Total"], "None") + '</div><div class="q-srow side"><span class="q-line">Attitude toward the party</span>' + sel2("Hostile") + "</div>");
    var acts = '<div style="margin-top:18px">' + og("This creature", '<div class="q-seg">' + bl("Spend reaction") + bl("Hold breath") + bl("Open sheet") + bl("Take out of the encounter", "danger") + "</div>") + "</div>";
    if (o.hpOnly) return hp;
    if (o.rest) return head + '<div style="margin-top:14px"></div>' + cond + pos + acts;
    return head + '<div style="margin-top:14px"></div>' + hp + cond + pos + acts;
  }
  function chosenMap(h) { return h.replace('class="ttok foe boss', 'class="ttok foe boss q-chosen'); }
  function toolsDock(open) {
    // The order in the dock; the Goblin Boss's row is chosen, and opens in place where the option says so
    var o = ord("v");
    o = o.replace(/<div class="c-ent( act)?">(<span class="fc foe">GB<\/span>)/, '<div class="c-ent$1 q-chosenrow">$2');
    if (open) {
      var inner = S.r2 === "row" ? '<div class="q-dockopen">' + toolsInner({ dock: 1 }).replace('<div class="q-head">', '<div class="q-head" style="display:none">') + "</div>" : '<div class="q-dockopen">' + toolsInner({ hpOnly: 1, noPending: 1 }) + '<div style="padding:8px 0 0">' + bl("All its tools", "", "fwd") + "</div></div>";
      o = o.replace(/(<div class="c-ent( act)? q-chosenrow">[^]*?<\/div>)(<div class="c-ent)/, "$1" + inner + "$3");
    }
    return '<div class="dock" style="grid-template-rows:minmax(0,1fr) auto">' + o + tools("grid") + "</div>";
  }

  /* ---------- 3. The encounter's options ---------- */
  // The encounter's own rules are Settings' Encounters rows (I 2.3), grouped by moment, with the same words.
  function rulesRows(compact) {
    var G = [["When a token is staged", [["Health display", "Status badge · shown to everyone"]]], ["When dice are rolled", [["Players' initiative", "Start turns immediately"]]], ["On a player's turn", [["Rules assistant", "Enforce"], ["Underwater", "Off"]]], ["When a hit lands", [["Players' hits", "Applied by the GM"]]]];
    return G.map(function (g) { return '<div class="q-mh" style="padding-left:0">' + g[0] + "</div>" + g[1].map(function (r) { return '<div class="q-srow side' + (compact ? "" : "") + '"><span><b>' + r[0] + "</b><small>" + r[1] + "</small></span>" + (r[0] === "Underwater" ? '<span class="sw"></span>' : sel2(r[1].split(" · ")[0])) + "</div>"; }).join(""); }).join("");
  }
  function encMenu(st) {
    return '<div class="q-menu" style="' + st + '"><div class="q-mh">This encounter</div>' +
      '<div class="q-mi">Rules assistant<span class="end">Enforce</span></div><div class="q-mi">Players\' hits<span class="end">Applied by the GM</span></div><div class="q-mi">Players\' initiative<span class="end">Start turns immediately</span></div><div class="q-mi">Health display<span class="end">Status badge</span></div><div class="q-mi">Underwater<span class="end">Off</span></div>' +
      '<div class="q-mh">Add to the encounter</div><div class="q-mi">' + IC.plus + 'Add monsters</div><div class="q-mi">' + IC.plus + 'Add characters<span class="end">all are in</span></div><div class="q-mi danger">End the encounter</div></div>';
  }

  /* ---------- 4. Adding monsters ---------- */
  var MONS = [["Goblin Boss", "1", "CR 1 (200 XP) · Small humanoid · AC 17 · HP 21"], ["Goblin Minion", "1/8", "CR 1/8 (25 XP) · Small humanoid · AC 12 · HP 1"], ["Goblin Warrior", "1/4", "CR 1/4 (50 XP) · Small humanoid · AC 15 · HP 10", 1], ["Hobgoblin Captain", "3", "CR 3 (700 XP) · Medium humanoid · AC 17 · HP 58"], ["Hobgoblin Warrior", "1/2", "CR 1/2 (100 XP) · Medium humanoid · AC 18 · HP 11"], ["Wolf", "1/4", "CR 1/4 (50 XP) · Medium beast · AC 12 · HP 11"]];
  function monRows(addBtn) { return MONS.map(function (m) { return '<div class="q-mrow' + (m[3] ? " on" : "") + '"><span><b>' + m[0] + "</b><small>" + m[2] + '</small></span><span class="cr">' + m[1] + "</span>" + (addBtn ? bl("Add", m[3] ? "on" : "") : "") + "</div>"; }).join(""); }
  function statBlock() {
    return '<div class="q-sb"><h3>Goblin Warrior</h3><span class="ty">Small Fey (Goblinoid), Chaotic Neutral</span><div class="hr"></div><div class="ln"><b>AC</b>15 <b style="margin-left:12px">Initiative</b>+2 (12)</div><div class="ln"><b>HP</b>10 (3d6)</div><div class="ln"><b>Speed</b>30 ft.</div><div class="ab"><div><small>STR</small><b>8</b></div><div><small>DEX</small><b>15</b></div><div><small>CON</small><b>10</b></div><div><small>INT</small><b>10</b></div><div><small>WIS</small><b>8</b></div><div><small>CHA</small><b>8</b></div></div><div class="ln"><b>Skills</b>Stealth +6</div><div class="ln"><b>Senses</b>Darkvision 60 ft.; Passive Perception 9</div><div class="ln"><b>CR</b>1/4 (XP 50; PB +2)</div><h4>Traits</h4><p><b>Nimble Escape.</b> The goblin takes the Disengage or Hide action.</p><h4>Actions</h4><p><b>Scimitar.</b> Melee Attack Roll: +4, reach 5 ft. Hit: 5 (1d6 + 2) Slashing damage, plus 2 (1d4) Slashing damage if the attack roll has Advantage.</p><p><b>Shortbow.</b> Ranged Attack Roll: +4, range 80/320 ft. Hit: 5 (1d6 + 2) Piercing damage.</p></div>';
  }
  function filters() {
    function fo(t, n, on) { return '<div class="q-fo' + (on ? " on" : "") + '">' + chk(on) + "<span>" + t + "</span><span>" + n + "</span></div>"; }
    return '<div class="q-fpane"><div class="q-h">Filters · 2 <span class="sp"></span>' + bl("Clear") + '</div><div class="q-facet"><div class="q-h">Source</div>' + fo("SRD 5.2.1", 330, 1) + fo("This table", 2, 1) + '</div><div class="q-facet"><div class="q-h">CR</div>' + fo("0 to 1", 98, 1) + fo("2 to 4", 112) + fo("5 to 10", 70) + '</div><div class="q-facet"><div class="q-h">Type</div>' + fo("Humanoid", 21, 1) + fo("Beast", 33) + fo("Undead", 12) + fo("Fey", 9) + "</div></div>";
  }
  function addFoot() { return '<div class="df">' + swl(false, "Roll hit points (off uses the average)") + '<span class="sp" style="flex:1"></span><span class="q-mut">Adds land in the staging tray · <b style="color:var(--text)">Shown to players</b></span></div>'; }

  /* ---------- 5. The prompts' own controls ---------- */
  function promptCards(phone) {
    var v = S.r5;
    var save, dying, react;
    var saveT = '<div class="t">' + fcq(BOSS_C) + "Goblin Boss makes a DC 14 Dexterity saving throw</div><div class=\"l\">Mirena Dawnbright's Sacred Flame · 12 damage on a failure.</div>";
    var dyT = '<div class="t">' + fcq(C[2]) + "Lyra Emberwise is dying · 0 successes · 0 failures</div><div class=\"l\">Borin Stoneguard can help. Healing brings Lyra back, and Help with a DC 10 Medicine check stabilizes Lyra.</div>";
    var reT = '<div class="t">' + fcq(C[3]) + "Goblin Warrior 1 may use Opportunity Attack</div><div class=\"l\">Borin Stoneguard is leaving Goblin Warrior 1's reach.</div>";
    var pips = '<div class="q-dying">Dying<span>Saves <span class="q-pips"><i></i><i></i><i></i></span></span><span>Fails <span class="q-pips"><i></i><i></i><i></i></span></span></div>';
    if (v === "buttons") {
      save = saveT + '<div class="q-hp"><span class="q-mut">Damage on a failure</span>' + fld("12", "num") + '</div><div class="q-res"><span>Rolled</span><span class="n">19</span><span>(d20 17)</span><span class="ok">Success</span><span>no damage</span></div><div class="q-seg">' + bl("Adv") + bl("Disadv") + '<span class="k-btn main">Confirm</span>' + bl("Choose to fail") + bl("Reroll") + "</div>";
      dying = dyT + pips + '<div class="q-seg"><span class="k-btn main">Roll the save for Lyra</span></div><div class="q-hp">' + sel2("Borin Stoneguard") + bl("First aid") + bl("Healer's Kit") + bl("Spare the Dying") + bl("Mark stable") + "</div>";
      react = reT + '<div class="q-res"><span>Rolled</span><span class="n">15</span><span>against AC 17 · d20 11</span><span class="ok" style="color:var(--text-muted)">Miss</span></div><div class="q-seg">' + bl("Adv") + bl("Disadv") + '<span class="k-btn main">Confirm miss</span>' + bl("Reroll") + bl("Let them go") + "</div>";
    } else if (v === "rollrow") {
      // T rule 5: the roll is the button, the whole row; its number lights on hover
      save = saveT + '<div class="q-hp"><span class="q-mut">Damage on a failure</span>' + fld("12", "num") + '</div><div class="q-rollrow"><span><b>Dexterity save +2 · DC 14</b><small>Rolled d20 17 · Success, no damage · press to confirm</small></span><span class="n">19</span></div><div class="q-seg">' + bl("Adv") + bl("Disadv") + bl("Reroll") + bl("Choose to fail") + "</div>";
      dying = dyT + pips + '<div class="q-rollrow"><span><b>Death save · d20</b><small>10 or higher is a success · press to roll</small></span><span class="n">d20</span></div><div class="q-hp">' + sel2("Borin Stoneguard") + bl("First aid") + bl("Healer's Kit") + bl("Spare the Dying") + bl("Mark stable") + "</div>";
      react = reT + '<div class="q-rollrow"><span><b>Scimitar +4 · against AC 17</b><small>Rolled d20 11 · a miss · press to confirm</small></span><span class="n">15</span></div><div class="q-seg">' + bl("Adv") + bl("Disadv") + bl("Reroll") + bl("Let them go") + "</div>";
    } else {
      // One main button each; the rest folded under More
      save = saveT + '<div class="q-res"><span>Rolled</span><span class="n">19</span><span>(d20 17)</span><span class="ok">Success</span><span>no damage</span></div><div class="q-seg"><span class="k-btn main">Confirm</span><span class="q-fold">More ' + IC.down + '</span></div><div class="q-more">' + bl("Adv") + bl("Disadv") + bl("Choose to fail") + bl("Reroll") + '<span class="q-mut" style="align-self:center">Damage on a failure</span>' + fld("12", "num") + "</div>";
      dying = dyT + pips + '<div class="q-seg"><span class="k-btn main">Roll the save for Lyra</span><span class="q-fold">Stabilize ' + IC.down + "</span></div>";
      react = reT + '<div class="q-res"><span class="n">15</span><span>against AC 17</span><span class="ok" style="color:var(--text-muted)">Miss</span></div><div class="q-seg"><span class="k-btn main">Confirm miss</span><span class="q-fold">More ' + IC.down + "</span></div>";
    }
    return '<div class="k-zone"><div class="k-lhead">' + sig(3, { head: 1 }) + '<span class="sp"></span><span class="k-btn k-place">' + IC.fwd + 'Own tab</span></div><div class="k-list" style="gap:8px"><div class="q-card">' + save + '</div><div class="q-card danger">' + dying + '</div><div class="q-card">' + react + "</div></div></div>";
  }

  /* ---------- Frames ---------- */
  function lapFrame2(o) {
    return '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-base">' + (o.bar || topBar()) + '<div class="ap-pane is-cols" style="position:relative"><div class="L docks"' + (o.cols ? ' style="grid-template-columns:' + o.cols + '"' : "") + ">" + (o.dock || dockOf()) + (o.map || mapEl(false)) + o.panel + "</div>" + (o.over || "") + "</div></div></div>";
  }
  function panel2(on, body, foot, over) { return '<div class="tpan docked" style="grid-template-rows:auto minmax(0,1fr) auto;position:relative">' + tabsRow(on) + '<div class="pbody" style="overflow:hidden">' + body + "</div>" + (foot == null ? encFoot() : foot) + (over || "") + "</div>"; }
  function phone2(on, view, foot, over, o) {
    o = o || {};
    var pbar = '<header class="pbar"><h1>Old road</h1>' + (prep() ? "" : '<span class="vcr">R02</span>') + '<span class="ico" style="width:28px">' + IC.down + '</span><div class="end">' + (o.icon || "") + "</div></header>";
    var tabs = [["Play", "play"], ["Prep", "prep"], ["Codex", "codex"], ["Compendium", "book"], ["More", "dots"]];
    var bottom = '<nav class="ap-bottom five" aria-hidden="true">' + tabs.map(function (t, i) { return '<span class="btab' + (i === 0 ? " on" : "") + '">' + IC[t[1]] + t[0] + "</span>"; }).join("") + "</nav>";
    var body = '<div class="P switch" style="grid-template-rows:auto auto minmax(0,1fr)"><div class="segw">' + phoneSegs(on) + "</div>" + ord("h") + '<div class="tpan" style="grid-template-rows:minmax(0,1fr) auto">' + view + (foot == null ? '<div class="pfoot"><div class="row1"><span class="back">' + IC.left + '</span><button type="button" class="cup">End turn</button></div><p>Next: Goblin Warrior 1</p></div>' : foot) + "</div>" + (over || "") + "</div>";
    return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-base">' + pbar + '<div class="ap-pane" style="overflow:hidden;position:relative">' + body + "</div>" + bottom + "</div></div>";
  }
  function pv(inner) { return '<div class="pbody" style="overflow:hidden">' + inner + "</div>"; }

  /* ---------- Pages ---------- */
  function startPage(phone) {
    if (phone) return phone2("enc", pv(startBody(true)), startFoot().replace("all 6", "all 6"));
    return lapFrame2({ dock: startDock() || undefined, panel: panel2("enc", startBody(false), startFoot()) });
  }
  function toolsPage(phone) {
    var v = S.r2;
    if (phone) {
      var sheet = '<div class="k-sheet" style="max-height:60%"><div class="grab2"></div>' + (v === "split" ? toolsInner({ hpOnly: 1, noPending: 1 }) + '<div style="padding-top:8px">' + bl("All its tools", "", "fwd") + "</div>" : toolsInner()) + "</div>";
      return phone2("map", '<div class="pv-map">' + tools("row") + chosenMap(mapEl(true)) + "</div>", "", sheet);
    }
    if (v === "token") return lapFrame2({ dock: toolsDock(false), map: chosenMap(mapEl(false)), panel: panel2("tok", toolsInner()) });
    if (v === "row") return lapFrame2({ cols: "330px minmax(0,1fr) 380px", dock: toolsDock(true), map: chosenMap(mapEl(false)), panel: panel2("enc", turnBody(false)) });
    if (v === "pop") return lapFrame2({ dock: toolsDock(false), map: chosenMap(mapEl(false)), panel: panel2("enc", turnBody(false)), over: '<div class="q-pop" style="left:240px;top:56px">' + toolsInner() + "</div>" });
    return lapFrame2({ cols: "300px minmax(0,1fr) 380px", dock: toolsDock(true), map: chosenMap(mapEl(false)), panel: panel2("tok", toolsInner({ rest: 1 })) });
  }
  function optionsPage(phone) {
    var v = S.r3;
    if (phone) {
      var sh = '<div class="k-sheet" style="max-height:80%"><div class="grab2"></div><div class="k-lhead"><b style="font:600 15px var(--f-display);letter-spacing:.05em;text-transform:uppercase">This encounter</b></div>' + rulesRows() + '<div class="q-seg" style="padding-top:10px">' + bl("Add monsters", "", "plus") + bl("End the encounter", "danger") + "</div></div>";
      return phone2("enc", pv(turnBody(true)), null, sh, { icon: v === "chip" ? "" : '<span class="ico">' + IC.dots + "</span>" });
    }
    var more = function (tabs) { return tabs.replace('</div>', '<span class="sh-tab" style="margin-left:auto">' + IC.dots.replace("<svg", '<svg style="width:18px;height:18px;fill:currentColor"') + "</span></div>"); };
    if (v === "menu") return lapFrame2({ panel: panel2("enc", turnBody(false)).replace(/(<div class="sh-tabs k-tabs">[^]*?)<\/div>/, function (m, a) { return a + '<span class="sh-tab on-more" style="margin-left:auto;box-shadow:inset 0 -2px 0 var(--cyan)">' + IC.dots.replace("<svg", '<svg style="width:18px;height:18px;fill:currentColor"') + "</span></div>"; }), over: encMenu("right:12px;top:46px") });
    if (v === "chip") return lapFrame2({ panel: panel2("enc", turnBody(false)), over: encMenu("left:270px;top:2px").replace('<div class="q-mh">This encounter</div>', '<div class="q-mh">Live encounter</div><div class="q-mi">' + IC.check + 'Old road<span class="end">round 2</span></div><div class="q-mi" style="color:var(--text-dim)">The ruined keep gate<span class="end">parked</span></div><div class="q-mh">This encounter</div>') });
    if (v === "sheet") return lapFrame2({ panel: panel2("enc", turnBody(false), null, '<div class="q-sheet"><div class="qs-h"><b>This encounter</b>' + bl("Done") + '</div><div class="qs-b">' + rulesRows() + '</div><div class="qs-f">' + bl("Add monsters", "", "plus") + bl("End the encounter", "danger") + "</div></div>").replace(/(<div class="sh-tabs k-tabs">[^]*?)<\/div>/, function (m, a) { return a + '<span class="sh-tab" style="margin-left:auto">' + IC.dots.replace("<svg", '<svg style="width:18px;height:18px;fill:currentColor"') + "</span></div>"; }) });
    // At the end of the Encounter tab, under the turn
    return lapFrame2({ panel: panel2("enc", '<div style="margin-top:-230px">' + turnBody(false) + '</div><div style="margin-top:18px">' + og("This encounter", rulesRows() + '<div class="q-seg" style="padding-top:8px">' + bl("Add monsters", "", "plus") + bl("End the encounter", "danger") + "</div>") + "</div>") });
  }
  function monstersPage(phone) {
    var v = S.r4;
    if (phone) {
      var full = '<div style="position:absolute;inset:0;z-index:6;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;background:var(--bg)"><div class="sh" style="display:flex;align-items:center;gap:8px;min-height:48px;padding:0 8px 0 14px;border-bottom:1px solid var(--line)"><b style="flex:1;font:600 16px var(--f-display);letter-spacing:.05em;text-transform:uppercase">Add monsters</b><span class="ico">' + IC.x + '</span></div><div style="display:grid;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)">' + fld(IC.search + "goblin", "") + '<div class="q-seg">' + bl("Filters · 2", "on") + bl("CR", "") + bl("Sort", "") + "</div></div>" + '<div style="overflow:hidden">' + (v === "dialog" || v === "panel" ? monRows(true) : monRows(false).replace("q-mrow on\"", "q-mrow on\"") + statBlock().replace('class="q-sb"', 'class="q-sb" style="max-height:330px;border-top:1px solid var(--line-strong)"')) + '</div><div class="df" style="display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line-strong)">' + '<span class="q-mut">Shown to players</span><span style="flex:1"></span><button type="button" class="cup" style="min-height:44px">Add Goblin Warrior</button></div></div>';
      return phone2("enc", pv(turnBody(true)), null, full);
    }
    var base = { panel: panel2("enc", turnBody(false)) };
    if (v === "dialog") { base.over = '<div class="q-scrim"></div><div class="q-dlg" style="left:310px;top:60px;width:660px;height:560px"><div class="dh"><b>Add monsters</b><span class="e-ico" style="box-shadow:none">' + IC.x + '</span></div><div style="display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0"><div style="display:grid;gap:8px;padding:12px 18px;border-bottom:1px solid var(--line)">' + fld(IC.search + "Search by name or type", "hint") + '<div class="q-seg">' + bl("Any CR", "", "") + bl("Humanoid", "on") + bl("Any size") + bl("By name") + '</div></div><div style="overflow:hidden;padding:0 8px">' + monRows(true) + "</div></div>" + addFoot() + "</div>"; return lapFrame2(base); }
    if (v === "panes") { base.over = '<div class="q-scrim"></div><div class="q-dlg" style="left:40px;top:30px;right:40px;bottom:30px"><div class="dh"><b>Add monsters</b>' + fld(IC.search + "goblin", "") + '<span class="e-ico" style="box-shadow:none">' + IC.x + '</span></div><div class="q-panes">' + filters() + '<div><div class="q-h" style="padding:10px 12px">6 monsters <span class="sp"></span>' + bl("By CR") + "</div>" + monRows(false) + '</div><div style="display:grid;grid-template-rows:auto minmax(0,1fr)"><div style="display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid var(--line)"><span class="tag ready" style="margin-right:auto">SRD 5.2.1</span>' + '<button type="button" class="cup" style="min-height:40px">Add to Old road</button></div>' + statBlock() + "</div></div>" + addFoot() + "</div>"; return lapFrame2(base); }
    if (v === "panel") return lapFrame2({ panel: panel2("enc", '<div style="display:grid;gap:8px"><div class="q-h">Add monsters <span class="sp"></span>' + bl("Back to the turn", "", "left") + "</div>" + fld(IC.search + "goblin", "") + '<div class="q-seg">' + bl("CR 0 to 1", "on") + bl("Humanoid", "on") + "</div>" + '<div style="border:1px solid var(--line-strong)">' + monRows(true).replace(/<div class="q-mrow on">([^]*?)<\/div>/, function (m) { return m; }) + "</div>" + statBlock().replace('class="q-sb"', 'class="q-sb" style="max-height:240px;padding:10px 4px"') + "</div>") });
    // The Compendium itself (G), with the encounter waiting for it
    var cbar = '<div class="sb titled"><span class="sb-title">Compendium</span><div class="sb-tabs"><span class="sb-tab">Home</span><span class="sb-tab on">Browse</span><span class="sb-tab">Sources</span><span class="sb-tab">Sharing</span></div><div class="sb-end"><span class="find">' + IC.search + "goblin<kbd>Ctrl K</kbd></span></div></div>";
    var adding = '<div style="display:flex;align-items:center;gap:12px;min-height:44px;padding:0 16px;border-bottom:1px solid var(--line-strong);background:color-mix(in srgb,var(--cyan) 7%,transparent)"><span class="k-chip" style="box-shadow:none;padding:0"><i></i></span><span class="q-line"><b>Adding to Old road</b> · round 2 · new monsters land in the staging tray</span><span style="flex:1"></span>' + bl("Back to the table", "", "left") + "</div>";
    var bar = topBar().replace(/<span class="on" data-seat>Play<\/span><span>Prep<\/span><span>Codex<\/span><span>Compendium<\/span>/, '<span>Play</span><span>Prep</span><span>Codex</span><span class="on" data-seat>Compendium</span>');
    return '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-base">' + bar + '<div class="ap-pane" style="display:grid;grid-template-rows:auto auto minmax(0,1fr);overflow:hidden">' + cbar + adding + '<div class="q-panes" style="grid-template-columns:250px 300px minmax(0,1fr)">' + filters() + "<div>" + '<div class="q-h" style="padding:10px 12px">6 monsters <span class="sp"></span>' + bl("By CR") + "</div>" + monRows(false) + '</div><div style="display:grid;grid-template-rows:auto minmax(0,1fr)"><div style="display:flex;align-items:center;gap:10px;padding:12px 20px;border-bottom:1px solid var(--line)"><b style="font:600 22px var(--f-display);letter-spacing:.05em;text-transform:uppercase;margin-right:auto">Goblin Warrior</b>' + '<span class="q-mut">Lands in the staging tray · Shown to players</span><button type="button" class="cup" style="min-height:42px">Add to Old road</button></div>' + statBlock().replace("<h3>Goblin Warrior</h3>", "") + "</div></div></div></div></div>";
  }
  function promptsPage(phone) {
    if (phone) return phone2("enc", '<div class="pbody" style="overflow:hidden;padding:0">' + promptCards(true) + "</div>");
    return lapFrame2({ panel: panel2("enc", '<div style="margin:-12px -16px 0">' + promptCards(false) + '</div><div style="padding-top:12px">' + turnBody(false) + "</div>") });
  }
