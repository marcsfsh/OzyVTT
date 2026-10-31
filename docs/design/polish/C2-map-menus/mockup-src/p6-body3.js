
  /* =========================================================================
     C5 round 1: the log and dice. The table (C), C3's two rounds and the theme are drawn as approved; each decision
     changes only its own part. The GM is on the laptop; Borin's player is on the phone.
     ========================================================================= */
  function itemsFor() { return [IT.aim, IT.apply]; }
  // Round 2 on the old road, as the log has it. gm: a line only the GM sees; mine: Borin's own.
  var LOG = [
    { k: "turn", c: C[0], t: "Round 2 · Goblin Boss's turn." },
    { k: "roll", who: "Goblin Boss", what: "Scimitar attack", tot: 19, d: [[15, 1]], f: "1d20 + 4", mod: "+ 4" },
    { k: "line", h: "<b>Goblin Boss</b>'s Scimitar hits <b>Borin Stoneguard</b> for <span class=\"num dmg\">7</span> slashing." },
    { k: "turn", c: C[1], t: "Round 2 · Borin Stoneguard's turn." },
    { k: "roll", who: "Borin", what: "Longsword attack", tot: 25, d: [[18, 1], [9, 0]], f: "2d20kh1 + 7", mod: "+ 7", mine: 1, open: 1 },
    { k: "line", h: "<b>Goblin Warrior 1</b> takes <span class=\"num dmg\">9</span> slashing damage.", mine: 1 },
    { k: "chat", who: "Borin", t: "That's for the toll.", mine: 1 },
    { k: "turn", c: C[2], t: "Round 2 · Lyra Emberwise's turn.", now: 1 },
    { k: "roll", who: "Lyra", what: "Fire Bolt attack", tot: 26, d: [[20, 1]], f: "1d20 + 6", mod: "+ 6", nat: 1 },
    { k: "whisper", who: "GM", to: "Lyra", t: "A glint in the trees to the north.", gm: 1 },
    { k: "roll", who: "GM", what: "Stealth for the goblins", tot: 14, d: [[12, 1]], f: "1d20 + 2", mod: "+ 2", gm: 1 }
  ];
  function seen(pl) { return LOG.filter(function (e) { return !(pl && e.gm); }); }
  function words(r) { var k = r.d.filter(function (d) { return d[1]; })[0][0], x = r.d.filter(function (d) { return !d[1]; }); return "d20 " + k + (x.length ? " (" + x[0][0] + ")" : "") + " " + r.mod; }
  function tags(r) { return (r.nat ? '<span class="tag nat">NAT 20</span>' : "") + (r.gm ? '<span class="tag gm">GM ONLY</span>' : ""); }
  function rollEl(r, style) {
    var v = style || S.l2;
    var dice = r.d.map(function (d) { return '<span class="w-die ' + (d[1] ? "k" : "x") + '">' + d[0] + "</span>"; }).join("");
    if (v === "card") return '<div class="w-card"><div><b>' + r.who + "</b> " + r.what + " " + tags(r) + '</div><div class="n"><span class="w-tot">' + r.tot + "</span>" + dice + '<span class="w-f">' + r.f + "</span></div></div>";
    if (v === "row") return '<div class="w-row"><span>' + tags(r) + "<b>" + r.who + "</b> · " + r.what + "<small>" + words(r) + " · " + r.f + '</small></span><span class="w-tot">' + r.tot + "</span></div>";
    if (v === "tv") return '<div class="w-tv"><span class="eb2">' + r.who + " · " + r.what + '</span><div class="n"><span class="w-tot">' + r.tot + '</span><span class="words">' + words(r) + "</span>" + tags(r) + "</div></div>";
    if (v === "dice") return '<div class="w-dice"><span>' + tags(r) + "<b>" + r.who + "</b> · " + r.what + '</span><div class="n">' + dice + '<span class="op">' + r.mod + ' =</span><span class="w-tot">' + r.tot + "</span></div></div>";
    return '<div class="w-first"><span class="w-tot">' + r.tot + "</span><span>" + tags(r) + "<b>" + r.who + "</b> · " + r.what + "<small>" + words(r) + "</small></span></div>";
  }
  function entry(e) {
    if (e.k === "turn") return '<div class="w-e turn' + (e.now ? " now" : "") + '">' + e.t + "</div>";
    if (e.k === "roll") return '<div class="w-e">' + rollEl(e) + "</div>";
    if (e.k === "chat") return '<div class="w-e chat"><b>' + e.who + "</b>" + e.t + "</div>";
    if (e.k === "whisper") return '<div class="w-e whisper"><span class="tag wh">WHISPER TO ' + e.to.toUpperCase() + "</span><b>" + e.who + "</b> " + e.t + "</div>";
    return '<div class="w-e">' + e.h + "</div>";
  }
  function lineOf(e) {
    if (e.k === "turn") return '<div class="w-line turn"><span class="t">' + e.t + "</span></div>";
    if (e.k === "roll") return '<div class="w-line' + (e.open ? " open" : "") + '"><span class="t">' + tags(e) + "<b>" + e.who + "</b> · " + e.what + '</span><span class="v">' + e.tot + "</span></div>" + (e.open ? '<div class="w-opencard">' + rollEl(e, "card") + "</div>" : "");
    if (e.k === "chat") return '<div class="w-line"><span class="t"><b>' + e.who + "</b> " + e.t + "</span></div>";
    if (e.k === "whisper") return '<div class="w-line"><span class="t"><span class="tag wh">TO ' + e.to.toUpperCase() + "</span><b>" + e.who + "</b> " + e.t + "</span></div>";
    return '<div class="w-line"><span class="t">' + e.h + "</span></div>";
  }

  /* ---------- 1. The log, arranged ---------- */
  function logBody(pl) {
    var L = seen(pl), v = S.l1;
    if (v === "turns") {
      var out = "", grp = "";
      L.forEach(function (e) {
        if (e.k === "turn") { if (grp) out += '<div class="w-grp">' + grp + "</div>"; grp = ""; out += '<div class="w-turnh' + (e.now ? " now" : "") + '">' + fcq(e.c) + "<b>" + e.c.n + "</b><span>RND 02</span></div>"; }
        else grp += entry(e);
      });
      out += '<div class="w-grp">' + grp + "</div>";
      return '<div class="w-log">' + out + "</div>";
    }
    if (v === "lines") return '<div class="w-log">' + L.map(lineOf).join("") + "</div>";
    if (v === "latest") {
      var rolls = L.filter(function (e) { return e.k === "roll"; }), last = rolls[rolls.length - 1];
      return '<div style="display:grid;grid-template-rows:auto minmax(0,1fr);height:100%;min-height:0"><div class="w-latest"><span class="q-h">Latest roll</span>' + rollEl(last, "tv").replace('class="w-tv"', 'class="w-tv" style="--x:1"') + '</div><div class="w-log">' + L.filter(function (e) { return e !== last; }).map(entry).join("") + "</div></div>";
    }
    if (v === "filter") {
      var ch = pl ? [["All", L.length, 1], ["Rolls", 3], ["Talk", 1], ["Mine", 3]] : [["All", L.length, 1], ["Rolls", 4], ["Talk", 2], ["Turns", 3]];
      return '<div style="display:grid;grid-template-rows:auto minmax(0,1fr);height:100%;min-height:0"><div class="w-chips">' + ch.map(function (c) { return '<span class="q-bl' + (c[2] ? " on" : "") + '">' + c[0] + "<b>" + c[1] + "</b></span>"; }).join("") + '</div><div class="w-log">' + L.map(entry).join("") + "</div></div>";
    }
    return '<div class="w-log">' + L.map(entry).join("") + "</div>";
  }

  /* ---------- 3. The composer ---------- */
  var DZ = ["d4", "d6", "d8", "d10", "d12", "d20"];
  function dz(boxed) { return '<div class="w-dz' + (boxed ? " boxed" : "") + '">' + DZ.map(function (d) { return bl(d); }).join("") + "</div>"; }
  function sendB() { return '<span class="w-send">' + IC.arrow + "</span>"; }
  function composer(o) {
    o = o || {};
    var v = S.l3;
    var who = o.pl ? (o.typing ? "To the table" : "To the table") : o.typing ? "Whisper to Lyra" : "To the table";
    var text = o.typing ? (o.pl ? "That's for the toll." : "A glint in the trees to the north.") : "Say, or /roll 1d20";
    var field = '<span class="q-fld' + (o.typing ? "" : " hint") + '">' + text + "</span>";
    var vis = o.pl ? "Shown to players" : "Shown to players";
    var callB = S.pg === "call" && S.l5 === "composer" && !o.pl ? bl("Call for a roll", "on") : "";
    if (v === "line") return '<div class="w-comp"><div class="r">' + bl(o.narrow ? (o.typing && !o.pl ? "Lyra" : "Table") : who, o.typing && !o.pl ? "hid" : "", "") + field + sendB() + '</div><div class="w-dz">' + DZ.map(function (d) { return bl(d); }).join("") + bl("More", "", "") + "</div>" + (callB ? '<div class="foot">' + callB + "</div>" : "") + "</div>";
    if (v === "switch") return '<div class="w-comp">' + seg2(["Say", "Roll"], "Say") + '<div class="r">' + '<span class="q-fld sel">' + (o.narrow ? "Table" : who) + IC.down + "</span>" + field + sendB() + '</div><div class="foot"><span>Roll shows the dice, Advantage and the modifier.</span>' + (callB || bl("Dice options")) + "</div></div>";
    if (v === "tray") return '<div class="w-comp"><div class="r"><span class="q-fld sel">' + (o.narrow ? "Table" : who) + IC.down + "</span>" + field + sendB() + "</div>" + dz() + '<div class="r" style="flex-wrap:wrap">' + bl("Advantage") + bl("Disadvantage") + '<span class="q-step"><span>−</span><b style="color:var(--text)">±0</b><span>+</span></span>' + (o.narrow ? "" : '<span style="flex:1"></span>' + bl(vis, "on")) + "</div>" + (callB ? '<div class="foot"><span></span>' + callB + "</div>" : "") + "</div>";
    if (v === "ondemand") return '<div class="w-comp" style="position:relative"><div class="r">' + bl(o.narrow ? "Table" : who, o.typing && !o.pl ? "hid" : "") + field + '<span class="w-ico' + (o.pop ? " on" : "") + '">d20</span>' + sendB() + "</div>" + (callB ? '<div class="foot"><span></span>' + callB + "</div>" : "") + (o.pop ? '<div class="w-pop" style="left:16px;right:16px;bottom:62px">' + dz() + '<div class="r" style="display:flex;gap:8px;flex-wrap:wrap">' + bl("Advantage") + bl("Disadvantage") + '<span class="q-step"><span>−</span><b style="color:var(--text)">±0</b><span>+</span></span></div><div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px;color:var(--text-muted)"><span>' + vis + "</span>" + bl("Dice options") + "</div></div>" : "") + "</div>";
    return '<div class="w-comp">' + dz(true) + '<div class="r"><span class="q-fld sel">' + (o.narrow ? "Table" : who) + IC.down + "</span>" + field + sendB() + '</div><div class="foot"><span>' + vis + "</span>" + (callB ? callB : "") + bl("Dice options") + "</div></div>";
  }

  /* ---------- 4. The dice options ---------- */
  function visOpts(pl) { return pl ? "Shown to players" : "Shown to players"; }
  function rollerCr(pl) {
    return cr('Roll dice <span class="sp"></span>' + '<span class="q-fld" style="height:32px;font-size:12.5px;text-transform:none;letter-spacing:0">' + visOpts(pl) + IC.down + "</span>", '<div class="q-srow side"><span class="q-line">How you roll</span>' + seg2(["Digital", "Manual"], "Digital") + "</div>" + '<div style="padding-top:8px">' + dz() + '</div><div class="q-hp" style="padding-top:10px">' + bl("Advantage", "on") + bl("Disadvantage") + '<span class="q-mut">Modifier</span><span class="q-step"><span>−</span><b style="color:var(--text)">+2</b><span>+</span></span></div><span class="w-armed" style="padding-top:6px">Advantage is armed for the next d20 roll.</span>');
  }
  function folds() { return '<div style="margin-top:14px">' + og("More dice", '<div class="q-ready"><i style="background:var(--line-raised);box-shadow:none"></i><span><b>Custom formula</b><small>Advantage keeps, drop lowest, and more</small></span>' + bl("Open", "", "down") + '</div><div class="q-ready"><i style="background:var(--line-raised);box-shadow:none"></i><span><b>Falling damage</b><small>1d6 per 10 ft, max 20d6</small></span>' + bl("Open", "", "down") + "</div>") + "</div>"; }
  function recent(n, pl) { var R = seen(pl).filter(function (e) { return e.k === "roll"; }).reverse().slice(0, n || 4); return og("Recent rolls", R.map(function (r) { return '<div class="w-e">' + rollEl(r) + "</div>"; }).join("")); }
  function modeSeg(on) { return S.l5 === "mode" ? '<div style="padding-bottom:12px">' + seg2(["Roll dice", "Call for a roll · 1 open"], on) + "</div>" : ""; }

  /* ---------- 5. Calling for a roll ---------- */
  function callForm(o) {
    o = o || {};
    var f = [["Ability", "Wisdom"], ["Skill", "Perception"], ["Needs", "Nothing more"], ["About", "None"], ["DC", "15"]];
    return cr("Call for a roll" + (o.head || ""), '<span class="q-mut" style="padding-top:2px">Ask the players for a check or a saving throw. Each one rolls on their own device.</span><div style="padding-top:8px">' + seg2(["Check", "Saving throw"], "Check") + '</div><div class="w-fields' + (o.narrow ? " two" : "") + '">' + f.map(function (x) { return "<label>" + x[0] + (x[0] === "DC" ? fld(x[1]) : sel2(x[1])) + "</label>"; }).join("") + '</div><div class="q-h" style="padding-top:10px">Who rolls</div><div class="q-seg">' + [C[1], C[2], C[5]].map(function (c) { return bl(c.n, "on"); }).join("") + '</div><div style="padding-top:8px">' + swl(true, "Results shown to players") + "</div>" + (o.btn ? '<div style="padding-top:10px"><span class="k-btn main">Call for the check</span></div>' : ""));
  }
  function openCall(o) {
    o = o || {};
    var rows = [[C[5], '<span class="w-res">17 <span style="color:var(--text-muted);font-size:14px">(d20 14)</span><span class="ok">success</span></span>'], [C[1], '<span class="w-wait">Waiting</span>' + bl("Roll for them")], [C[2], '<span class="w-wait">Waiting</span>' + bl("Roll for them")]];
    return '<div class="k-card wait"><div class="t">' + IC.dice.replace("<svg", '<svg style="width:16px;height:16px;fill:none;stroke:var(--text-muted);stroke-width:1.8"') + 'Wisdom (Perception) check · DC 15</div><div class="l">Waiting on players · 1 of 3 answered · results shown to players</div><div class="w-call">' + rows.map(function (r) { return '<div class="q-row compact">' + fcq(r[0]) + "<b>" + r[0].sh + '</b><span class="end">' + r[1] + "</span></div>"; }).join("") + '</div><div class="a">' + bl("Close") + "</div></div>";
  }
  function partyCall() {
    var P = [[C[1], "Fighter 7", '<span class="w-wait">Waiting</span>'], [C[2], "Wizard 7", '<span class="w-wait">Waiting</span>'], [C[5], "Cleric 7", '<span class="w-res">17<span class="ok">success</span></span>']];
    return cr("The party · Wisdom (Perception) check, DC 15", P.map(function (p) { return '<div class="q-row">' + fcq(p[0]) + "<span><b>" + p[0].n + "</b><small>" + p[1] + '</small></span><span class="end">' + p[2] + chk(true) + "</span></div>"; }).join(""));
  }

  /* ---------- Frames ---------- */
  function logPanel(o) {
    o = o || {};
    var on = o.on || "log";
    var body = o.body || '<div style="display:grid;grid-template-rows:minmax(0,1fr) auto;min-height:0;overflow:hidden"><div style="padding:0 16px;min-height:0;overflow:hidden">' + (o.log || logBody(false)) + "</div>" + (o.comp || composer(o.compO)) + "</div>";
    return '<div class="tpan docked" style="grid-template-rows:auto minmax(0,1fr) auto;position:relative">' + tabsRow(on) + body + encFoot() + (o.over || "") + "</div>";
  }
  function lap(o) { return lapFrame2({ panel: logPanel(o), over: o.dlg || "" }); }
  function plSegs(on) { return '<div class="k-segs">' + [["map", "Map"], ["turn", "Turn"], ["log", "Log"], ["party", "Party"]].map(function (x) { return '<span class="' + (x[0] === on ? "on" : "") + '">' + x[1] + "</span>"; }).join("") + "</div>"; }
  function plPhone(view, o) {
    o = o || {};
    F.pl = 1;
    var pbar = '<header class="pbar"><h1>Old road</h1><span class="vcr">R02</span><div class="end"><span class="ico">' + IC.me + "</span></div></header>";
    var tabs = [["Table", "play", 1], ["Sheet", "sheet"], ["Codex", "codex"], ["Log", "log"], ["More", "dots"]];
    var bottom = '<nav class="ap-bottom five" aria-hidden="true">' + tabs.map(function (t) { return '<span class="btab' + (t[2] ? " on" : "") + '">' + IC[t[1]] + t[0] + "</span>"; }).join("") + "</nav>";
    var body = '<div class="P switch" style="grid-template-rows:auto auto minmax(0,1fr)"><div class="segw">' + plSegs("log") + "</div>" + ord("h") + '<div class="tpan" style="grid-template-rows:minmax(0,1fr) auto">' + view + '<div class="pfoot"><p>Your turn comes after the Goblin Boss.</p></div></div>' + (o.over || "") + "</div>";
    var out = '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-base">' + pbar + '<div class="ap-pane" style="overflow:hidden;position:relative">' + body + "</div>" + bottom + "</div></div>";
    F.pl = 0;
    return out;
  }
  function plLogView(o) { o = o || {}; return '<div style="display:grid;grid-template-rows:minmax(0,1fr) auto;min-height:0;overflow:hidden"><div style="padding:0 12px;min-height:0;overflow:hidden">' + logBody(true) + "</div>" + composer({ pl: 1, narrow: 1, typing: o.typing, pop: o.pop }).replace('class="w-comp"', 'class="w-comp" style="padding:8px 12px"') + "</div>"; }

  /* ---------- Pages ---------- */
  function logPage(phone) { return phone ? plPhone(plLogView()) : lap({}); }
  function rollPage(phone) { return logPage(phone); }
  function composePage(phone) { return phone ? plPhone(plLogView({ typing: 1, pop: S.l3 === "ondemand" })) : lap({ compO: { typing: 1, pop: S.l3 === "ondemand" } }); }
  function dicePage(phone) {
    var v = S.l4;
    if (phone) {
      var inner = '<div style="display:flex;align-items:center;gap:8px;min-height:48px;margin:-10px -12px 8px;padding:0 8px 0 14px;border-bottom:1px solid var(--line)"><b style="flex:1;font:600 16px var(--f-display);letter-spacing:.05em;text-transform:uppercase">Dice options</b><span class="ico">' + IC.x + "</span></div>" + rollerCr(true).replace("Shown to players", "Hidden from players") + folds() + '<div style="margin-top:14px">' + recent(2, true) + "</div>";
      if (v === "inplace") return plPhone('<div style="display:grid;grid-template-rows:minmax(0,1fr) auto;min-height:0;overflow:hidden"><div style="padding:0 12px;min-height:0;overflow:hidden">' + logBody(true) + '</div><div class="w-comp" style="padding:8px 12px">' + rollerCr(true) + '<div class="r">' + bl("Table") + '<span class="q-fld hint">Say, or /roll 1d20</span>' + sendB() + "</div></div></div>");
      if (v === "recent") inner = '<div style="display:flex;align-items:center;gap:8px;min-height:48px;margin:-10px -12px 8px;padding:0 8px 0 14px;border-bottom:1px solid var(--line)"><b style="flex:1;font:600 16px var(--f-display);letter-spacing:.05em;text-transform:uppercase">Dice options</b><span class="ico">' + IC.x + "</span></div>" + recent(3, true) + '<div style="margin-top:14px">' + rollerCr(true).replace("Shown to players", "Hidden from players") + "</div>";
      return plPhone(plLogView(), { over: '<div class="k-sheet" style="max-height:calc(100% - 52px);padding:10px 12px 14px">' + inner + "</div>" });
    }
    var dlgHead = '<div class="dh"><b>Dice options</b><span class="e-ico" style="box-shadow:none">' + IC.x + "</span></div>";
    if (v === "dialog") return lap({ dlg: '<div class="q-scrim"></div><div class="q-dlg" style="left:330px;top:40px;width:620px;height:680px;grid-template-rows:auto minmax(0,1fr)">' + dlgHead + '<div style="overflow:hidden;padding:16px 18px">' + modeSeg("Roll dice") + rollerCr() + folds() + '<div style="margin-top:14px">' + recent(3) + "</div></div></div>" });
    if (v === "sheet") return lap({ over: '<div class="q-sheet"><div class="qs-h"><b>Dice options</b><span class="e-ico" aria-label="Close">' + IC.x + '</span></div><div class="qs-b">' + modeSeg("Roll dice") + rollerCr() + folds() + '<div style="margin-top:14px">' + recent(2) + '</div></div><div class="qs-f"><span class="q-mut">Shown to players</span></div></div>' });
    if (v === "panes") return lap({ dlg: '<div class="q-scrim"></div><div class="q-dlg" style="left:200px;top:60px;width:880px;height:600px;grid-template-rows:auto minmax(0,1fr)">' + dlgHead + '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:0"><div style="overflow:hidden;padding:16px 18px;border-right:1px solid var(--line-strong)">' + modeSeg("Roll dice") + rollerCr() + folds() + '</div><div style="overflow:hidden;padding:16px 18px">' + recent(5) + "</div></div></div>" });
    if (v === "inplace") return lap({ comp: '<div class="w-comp">' + modeSeg("Roll dice") + rollerCr() + '<div class="r">' + '<span class="q-fld sel">To the table' + IC.down + '</span><span class="q-fld hint">Say, or /roll 1d20</span>' + sendB() + '</div><div class="foot"><span>Custom formula and falling damage under More</span>' + bl("Fewer dice", "on") + "</div></div>" });
    return lap({ dlg: '<div class="q-scrim"></div><div class="q-dlg" style="left:340px;top:50px;width:600px;height:660px">' + dlgHead + '<div style="overflow:hidden;padding:16px 18px">' + modeSeg("Roll dice") + recent(6) + '</div><div style="padding:12px 18px 14px;border-top:1px solid var(--line-strong)">' + rollerCr() + "</div></div>" });
  }
  function callPage(phone) {
    var v = S.l5;
    if (phone) {
      var sheetIn = '<div class="grab2"></div>' + callForm({ narrow: 1, btn: 1 }) + '<div style="margin-top:12px">' + openCall() + "</div>";
      if (v === "list") return phone2("enc", '<div class="pbody" style="overflow:hidden;padding:0"><div class="k-zone"><div class="k-lhead">' + sig(2, { head: 1 }) + '<span class="sp"></span>' + bl("Call for a roll", "on") + "</div>" + callForm({ narrow: 1, btn: 1 }) + "</div></div>");
      if (v === "party") return phone2("party", '<div class="pbody" style="overflow:hidden">' + partyCall() + '<div style="margin-top:14px">' + callForm({ narrow: 1, btn: 1 }) + "</div></div>");
      if (v === "composer") return phone2("log", '<div class="pbody" style="overflow:hidden">' + callForm({ narrow: 1, btn: 1 }) + "</div>");
      return phone2("log", '<div class="pbody pv-log">' + logCol() + "</div>", null, '<div class="k-sheet" style="max-height:calc(100% - 52px)">' + sheetIn + "</div>");
    }
    var dlgHead = function (t) { return '<div class="dh"><b>' + t + '</b><span class="e-ico" style="box-shadow:none">' + IC.x + "</span></div>"; };
    if (v === "mode") return lap({ dlg: '<div class="q-scrim"></div><div class="q-dlg" style="left:300px;top:30px;width:680px;height:720px;grid-template-rows:auto minmax(0,1fr)">' + dlgHead("Dice options") + '<div style="overflow:hidden;padding:16px 18px">' + seg2(["Roll dice", "Call for a roll · 1 open"], "Call for a roll · 1 open") + '<div style="height:12px"></div>' + callForm({ btn: 1 }) + '<div style="margin-top:16px">' + og("Open calls", openCall()) + "</div></div></div>" });
    if (v === "menu") return lapFrame2({ panel: panel2("enc", '<div style="margin:-12px -16px 0"><div class="k-zone"><div class="k-lhead">' + sig(2, { head: 1 }) + '<span class="e">1 waiting on players</span><span class="sp"></span></div><div class="k-list" style="gap:8px">' + openCall() + "</div></div></div>").replace(/(<div class="sh-tabs k-tabs">[^]*?)<\/div>/, function (m, a) { return a + '<span class="sh-tab" style="margin-left:auto;box-shadow:inset 0 -2px 0 var(--cyan)">' + IC.dots.replace("<svg", '<svg style="width:18px;height:18px;fill:currentColor"') + "</span></div>"; }), over: '<div class="q-scrim"></div><div class="q-dlg" style="left:300px;top:70px;width:680px;height:540px">' + dlgHead("Call for a roll") + '<div style="overflow:hidden;padding:16px 18px">' + callForm() + '</div><div class="df"><span style="flex:1"></span>' + bl("Cancel") + '<button type="button" class="cup" style="min-height:42px">Call for the check</button></div></div>' });
    if (v === "list") return lapFrame2({ panel: panel2("enc", '<div style="margin:-12px -16px 0"><div class="k-zone"><div class="k-lhead">' + sig(2, { head: 1 }) + '<span class="sp"></span>' + bl("Call for a roll", "on") + "</div>" + callForm({ btn: 1, narrow: 1 }) + '<div style="height:10px"></div>' + openCall() + "</div></div>") });
    if (v === "party") return lapFrame2({ panel: panel2("party", partyCall() + '<div style="margin-top:16px">' + callForm({ btn: 1, narrow: 1 }) + "</div>") });
    return lap({ log: '<div style="display:grid;grid-template-rows:minmax(0,1fr) auto;height:100%;min-height:0"><div style="min-height:0;overflow:hidden">' + logBody(false) + '</div><div style="padding:10px 0 4px">' + callForm({ btn: 1, narrow: 1 }) + "</div></div>" });
  }
