  /* ---------- Replays: the list, watching one, the GM's actions, and a player's replays ---------- */
  IC.download = svg('<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>');
  IC.prev = svg('<path d="M18 5l-9 7 9 7z"/><path d="M6 5v14"/>');
  IC.film = svg('<rect x="3" y="5" width="18" height="14"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/>');
  IC.launch = svg('<path d="M5 19l4-1 9-9a3 3 0 0 0-4-4l-9 9z"/><path d="M14 6l4 4"/>');
  IC.user = svg('<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>');

  // Five fights the GM kept; two named by the GM, three shared with the party.
  var RPS = [
    { enc: "Ambush at Riverford", date: "Oct 30", day: "Oct 30", turns: 15, rounds: 3, len: "22 min", shared: 1 },
    { enc: "The old road", name: "Goblin scouts on the road", date: "Oct 23", day: "Oct 23", turns: 9, rounds: 2, len: "14 min", shared: 1 },
    { enc: "The ruined keep's cellar", date: "Oct 16", day: "Oct 16", turns: 21, rounds: 4, len: "48 min", shared: 0 },
    { enc: "Wolves at the treeline", date: "Oct 9", day: "Oct 9", turns: 11, rounds: 3, len: "18 min", shared: 0 },
    { enc: "The toll bridge", name: "Bandits at the toll bridge", date: "Oct 2", day: "Oct 2", turns: 16, rounds: 4, len: "31 min", shared: 1 }
  ];
  function rTitle(r) { return r.name || r.enc + " · " + r.date; }
  function rLine(r, short) { return (r.name ? r.enc + " · " + (short ? r.day : r.date) + " · " : "") + r.turns + " turns · " + r.len; }
  // A player never gets the encounter's own name: the GM's name, or Encounter and the day.
  function rTitleP(r) { return r.name || "Encounter · " + r.date; }
  function rLineP(r) { return (r.name ? r.day + " · " : "") + r.turns + " turns · " + r.len; }

  // Turn 8 of 15: round 2, Borin's turn. The GM sees exact hit points and the hidden archer; players get bands.
  var ORD = [
    { n: "Goblin Boss", i: 17, hp: "12/21", band: "Bloodied", foe: 1, e: "hand", c: "var(--hostile)" },
    { n: "Borin Stoneguard", i: 16, hp: "58/67", act: 1, e: "shield", c: "var(--party)" },
    { n: "Wolf", i: 12, hp: "4/11", band: "Bloodied", foe: 1, e: "paw", c: "var(--hostile)" },
    { n: "Lyra Emberwise", i: 9, hp: "36/44", cond: "Prone", e: "bolt", c: "#ffd23f" },
    { n: "Goblin archer", i: 7, hp: "7/7", gm: 1 },
    { n: "Mirena Dawnbright", i: 6, hp: "48/52", e: "prism", c: "var(--cyan)" }
  ];
  var TLOG = [
    ["Round 2 · Borin Stoneguard's turn."],
    ["Borin Stoneguard attacks the Goblin Boss with a Longsword: 19 hits."],
    ["Goblin Boss took 9 slashing damage."],
    ["Goblin Boss is bloodied."],
    ["The Goblin archer moves to the ridge.", 1]
  ];
  var STEPS = [
    [1, "Goblin Boss", "Shouts for the wolf; Scimitar misses Borin."], [1, "Borin Stoneguard", "Longsword: the Goblin Boss took 8."], [1, "Wolf", "Bite: Lyra took 6 and is prone."], [1, "Lyra Emberwise", "Fire Bolt: the Wolf took 7."], [1, "Goblin archer", "Shortbow: Mirena took 4.", 1], [1, "Mirena Dawnbright", "Healing Word: Lyra healed 5."],
    [2, "Goblin Boss", "Scimitar: Borin took 9."], [2, "Borin Stoneguard", "Longsword: the Goblin Boss took 9. Bloodied."], [2, "Wolf", "Bite misses Lyra."], [2, "Lyra Emberwise", "Stands; Fire Bolt misses."], [2, "Goblin archer", "Moves to the ridge.", 1], [2, "Mirena Dawnbright", "Sacred Flame: the Wolf took 5."],
    [3, "Goblin Boss", "Disengages toward the trees."], [3, "Borin Stoneguard", "Dashes after the Goblin Boss."], [3, "Wolf", "Is down."]
  ];
  var CUR = 8;

  // Two goblins: the order calls them Boss and Archer so the chips stay apart.
  function shortN(n) { return { "Goblin Boss": "Boss", "Goblin archer": "Archer" }[n] || n.split(" ")[0]; }
  function rWho(r, phone) { return r.shared ? '<span class="r-who">' + IC.eye + (phone ? "Shared" : "Players see it") + "</span>" : '<span class="r-who off">' + IC.eyeoff + "Only you</span>"; }
  function rEye(r) { return '<span class="r-eye' + (r.shared ? "" : " off") + '">' + (r.shared ? IC.eye : IC.eyeoff) + "</span>"; }
  function rThumb(h) { return '<div class="r-thumb" style="height:' + (h || 136) + 'px">' + mapLayer("inset:0", { toks: false }) + "</div>"; }
  function rSw(on) { return '<span class="e-sw' + (on ? " on" : "") + '"><i></i></span>'; }

  /* ---------- Frames ---------- */
  function prepLap(I) {
    var tabs = ["Encounters", "Party", "Maps", "Tokens", "Sound", "Replays"].map(function (t) { return '<span class="sb-tab' + (t === "Replays" ? " on" : "") + '">' + t + "</span>"; }).join("");
    return gmLap('<div style="position:absolute;inset:0;display:grid;grid-template-rows:auto minmax(0,1fr)"><div class="sb titled"><span class="sb-title">Prep</span><div class="sb-tabs">' + tabs + '</div>' + prepEnd() + '</div><div style="position:relative;overflow:hidden">' + I + "</div></div>");
  }
  function botTabs(list, on) { return '<nav class="ap-bottom five" aria-hidden="true">' + list.map(function (t) { return '<span class="btab' + (t[0] === on ? " on" : "") + '">' + IC[t[1]] + t[0] + "</span>"; }).join("") + "</nav>"; }
  var GMTABS = [["Play", "play"], ["Prep", "prep"], ["Codex", "codex"], ["Compendium", "book"], ["More", "dots"]];
  var PLTABS = [["Table", "play"], ["Sheet", "user"], ["Codex", "codex"], ["Log", "prep"], ["More", "dots"]];
  function prepPhone(inner, o) {
    o = o || {};
    var head = '<header class="pbar">' + (o.back ? '<span class="ico" style="margin-left:-8px">' + IC.back + "</span>" : "") + "<h1>" + (o.title || "Prep") + '</h1><div class="end">' + (o.icons || ["search"]).map(function (n) { return '<span class="ico">' + IC[n] + "</span>"; }).join("") + "</div></header>";
    var strip = o.noStrip ? "" : '<div class="pstrip">' + ["Encounters", "Party", "Maps", "Tokens", "Sound", "Replays"].map(function (t) { return '<span class="sb-tab' + (t === "Replays" ? " on" : "") + '">' + t + "</span>"; }).join("") + "</div>";
    var pane = strip ? '<div class="ap-pane e-pane">' + strip + '<div class="e-body"><div class="e-ph">' + inner + "</div></div></div>" : '<div class="ap-pane" style="position:relative;overflow:hidden">' + inner + "</div>";
    return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-base">' + head + pane + botTabs(GMTABS, "Prep") + "</div></div>";
  }
  function plLap(I, menuOpen) {
    var top = '<header class="ap-bar"><span class="wm"><span class="wm-ozy">OZY</span><span class="wm-vtt">vtt</span></span><nav class="ap-nav" aria-hidden="true"><span class="on">Table</span><span>Sheet</span><span>Codex</span></nav><div class="ap-end"><span class="ico">' + IC.search + '</span><span class="e-btn' + (menuOpen ? " on" : " dim") + '" style="gap:8px" aria-label="Lyra Emberwise">' + port({ e: "bolt", c: "#ffd23f" }, 26) + IC.down + "</span></div></header>";
    return '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-base"><div style="position:absolute;inset:0;display:grid;grid-template-rows:auto minmax(0,1fr)">' + top + '<div style="position:relative;overflow:hidden">' + I + "</div></div></div></div>";
  }
  function plPhone(inner, on) {
    var head = '<header class="pbar">' + port({ e: "bolt", c: "#ffd23f" }, 30) + '<h1 style="margin-left:8px">Lyra Emberwise</h1><div class="end"><span class="e-btn dim" style="min-height:36px"><span class="r-n">17</span>&nbsp;AC</span><span class="e-btn dim" style="min-height:36px"><span class="r-n">36/44</span>&nbsp;HP</span></div></header>';
    return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-base">' + head + '<div class="ap-pane" style="position:relative;overflow:hidden">' + inner + "</div>" + botTabs(PLTABS, on || "Table") + "</div></div>";
  }

  /* ---------- 1. The list ---------- */
  function rRow(r, i, o) {
    o = o || {};
    var t = o.player ? rTitleP(r) : rTitle(r);
    return '<div class="r-row' + (o.on === i ? " on" : "") + '" style="grid-template-columns:' + (o.cols || "minmax(0,1fr) auto auto auto") + '"><span style="min-width:0"><b>' + t + "</b><small>" + rLine(r) + "</small></span>" + (o.player ? "<span></span>" : o.eye ? rEye(r) : rWho(r)) + btn("Watch", "playtri") + (o.player ? "<span></span>" : ico("dots")) + "</div>";
  }
  // A list has no title row (T 2.2): the bar's lit Replays names it, and the count opens the toolbar.
  function listHead() { return '<div class="e-tool" style="display:flex;align-items:center;gap:10px;padding:14px 24px 10px"><span class="e-muted" style="flex:1">5 replays</span></div>'; }
  function rPane(phone) {
    return '<div style="display:flex;align-items:center;gap:10px"><span class="e-h2" style="font-size:' + (phone ? 20 : 22) + 'px;flex:1">Ambush at Riverford</span>' + ico("dots") + '</div><span class="r-line">Oct 30, 7:40 PM · <span class="n">15</span> turns over <span class="n">3</span> rounds · <span class="n">22</span> min</span><div style="position:relative;height:' + (phone ? 200 : 290) + 'px;border:1px solid var(--line-strong);overflow:hidden">' + mapLayer("inset:0", { small: 1 }) + '</div><span class="e-eb">Who fought</span><div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px">' + ["Borin Stoneguard", "Lyra Emberwise", "Mirena Dawnbright", "Goblin Boss", "Wolf"].map(function (n) { return '<span class="e-btn dim">' + n + "</span>"; }).join("") + '<span class="e-btn dim" style="color:var(--violet-text);border:1px dashed color-mix(in srgb,var(--violet) 55%,transparent)">' + IC.eyeoff + 'Goblin archer</span></div><div style="display:flex;align-items:center;gap:10px;min-height:44px">' + rSw(1) + '<span style="flex:1">Players see it</span>' + cup("Watch") + "</div>";
  }
  // The approved mix: the table at the left, the chosen replay beside it. On a phone, the table; a row opens the replay.
  function mixList(phone) {
    if (phone) return '<div style="padding:4px 12px"><div class="g-th" style="grid-template-columns:minmax(0,1fr) 50px 64px 34px"><span>Replay</span><span>Turns</span><span>Length</span><span></span></div>' + RPS.map(function (r, i) { return '<div class="g-tr' + (i === 0 ? " on" : "") + '" style="grid-template-columns:minmax(0,1fr) 50px 64px 34px;min-height:56px"><span style="min-width:0"><b style="white-space:normal">' + (r.name || r.enc) + '</b><small class="e-muted" style="display:block">' + r.day + '</small></span><span class="g-n">' + r.turns + '</span><span class="g-n dim">' + r.len.replace(" min", "m") + "</span>" + (r.shared ? '<span class="r-eye" style="width:28px">' + IC.eye + "</span>" : '<span class="r-eye off" style="width:28px">' + IC.eyeoff + "</span>") + "</div>"; }).join("") + '<p class="e-muted" style="margin:12px 2px">Press a replay to open it.</p></div>';
    var cols = "minmax(0,1fr) 112px 58px 70px 44px";
    return '<div style="position:absolute;inset:0;display:grid;grid-template-columns:minmax(0,1fr) 500px"><div style="overflow:hidden;border-right:1px solid var(--line-strong)">' + listHead('<span class="e-muted">5 kept</span>') + '<div style="padding:0 24px"><div class="g-th" style="grid-template-columns:' + cols + '"><span>Replay</span><span>Fought</span><span>Turns</span><span>Length</span><span></span></div>' + RPS.map(function (r, i) { return '<div class="g-tr' + (i === 0 ? " on" : "") + '" style="grid-template-columns:' + cols + ';min-height:54px"><span style="min-width:0"><b>' + (r.name || r.enc) + "</b>" + (r.name ? '<small class="e-muted" style="display:block">' + r.enc + "</small>" : "") + '</span><span class="e-dim">' + r.date + '</span><span class="g-n">' + r.turns + '</span><span class="g-n dim">' + r.len + "</span>" + rEye(r) + "</div>"; }).join("") + '</div></div><div style="padding:18px 24px;display:grid;gap:14px;align-content:start;overflow:hidden;background:var(--bg)">' + rPane() + "</div></div>";
  }
  function listPage(phone) {
    var v = S.r1, I;
    if (v === "mix") return phone ? prepPhone(mixList(true)) : prepLap(mixList());
    if (!phone) {
      if (v === "today") I = '<div style="max-width:960px;margin:0 auto">' + listHead() + '<div style="padding:0 24px">' + RPS.map(function (r, i) { return rRow(r, i, { eye: 1 }); }).join("") + "</div></div>";
      else if (v === "shelf") I = listHead('<span class="e-muted">Every encounter that ends is kept here.</span>') + '<div style="padding:4px 24px 24px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px">' + RPS.map(function (r) { return '<div class="e-card">' + rThumb(130) + '<span class="e-st" style="padding:3px 6px">' + rWho(r) + '</span><div class="cb"><b>' + rTitle(r) + '</b><span class="r-line">' + (r.name ? r.day + " · " : "") + '<span class="n">' + r.turns + '</span> turns · <span class="n">' + r.len.replace(" min", "") + '</span> min</span><div style="display:flex;gap:8px;align-items:center;margin-top:4px">' + btn("Watch", "playtri") + '<span style="flex:1"></span>' + ico("dots") + "</div></div></div>"; }).join("") + "</div>";
      else if (v === "side") I = '<div style="position:absolute;inset:0;display:grid;grid-template-columns:250px minmax(0,1fr)"><div style="border-right:1px solid var(--line-strong);padding:14px 12px;display:grid;gap:4px;align-content:start;background:var(--bg)"><span class="e-eb" style="padding:0 8px 6px">Replays</span>' + [["All", 5, 1], ["Players see it", 3], ["Only you", 2]].map(function (f) { return '<div class="u-ri' + (f[2] ? " on" : "") + '">' + f[0] + '<span class="n">' + f[1] + "</span></div>"; }).join("") + '<span class="e-eb" style="padding:14px 8px 6px">By month</span><div class="u-ri">October 2026<span class="n">5</span></div></div><div style="overflow:hidden">' + listHead('<span class="e-muted">5 kept</span>') + '<div style="padding:0 24px">' + RPS.map(function (r, i) { return rRow(r, i); }).join("") + "</div></div></div>";
      else if (v === "table") I = listHead('<span class="e-muted">Every encounter that ends is kept here.</span>') + '<div style="padding:0 24px"><div class="g-th" style="grid-template-columns:minmax(0,1fr) 130px 70px 70px 90px 150px 96px 40px"><span>Replay</span><span>Fought</span><span>Turns</span><span>Rounds</span><span>Length</span><span>Players see it</span><span></span><span></span></div>' + RPS.map(function (r) { return '<div class="g-tr" style="grid-template-columns:minmax(0,1fr) 130px 70px 70px 90px 150px 96px 40px;min-height:52px"><span style="min-width:0"><b>' + (r.name || r.enc) + "</b>" + (r.name ? '<small class="e-muted" style="display:block">' + r.enc + "</small>" : "") + '</span><span class="e-dim">' + r.date + '</span><span class="g-n">' + r.turns + '</span><span class="g-n dim">' + r.rounds + '</span><span class="g-n dim">' + r.len + "</span>" + rWho(r) + btn("Watch", "playtri") + ico("dots") + "</div>"; }).join("") + "</div>";
      else I = '<div style="position:absolute;inset:0;display:grid;grid-template-columns:440px minmax(0,1fr)"><div style="border-right:1px solid var(--line-strong);overflow:hidden">' + listHead('<span class="e-muted">5</span>') + '<div style="padding:0 12px">' + RPS.map(function (r, i) { return '<div class="r-row' + (i === 0 ? " on" : "") + '" style="grid-template-columns:minmax(0,1fr) auto"><span style="min-width:0"><b>' + rTitle(r) + "</b><small>" + rLine(r, 1) + "</small></span>" + (r.shared ? '<span class="r-eye">' + IC.eye + "</span>" : '<span class="r-eye off">' + IC.eyeoff + "</span>") + "</div>"; }).join("") + '</div></div><div style="padding:18px 24px;display:grid;gap:14px;align-content:start;overflow:hidden"><div style="display:flex;align-items:center;gap:10px"><span class="e-h2" style="font-size:22px;flex:1">Ambush at Riverford</span>' + ico("dots") + '</div><span class="r-line">Oct 30, 2026 · <span class="n">15</span> turns over <span class="n">3</span> rounds · <span class="n">22</span> min</span><div style="position:relative;height:300px;border:1px solid var(--line-strong);overflow:hidden">' + mapLayer("inset:0", { small: 1 }) + '</div><span class="e-eb">Who fought</span><div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px">' + ["Borin Stoneguard", "Lyra Emberwise", "Mirena Dawnbright", "Goblin Boss", "Wolf"].map(function (n) { return '<span class="e-btn dim">' + n + "</span>"; }).join("") + '<span class="e-btn dim" style="color:var(--violet-text);border:1px dashed color-mix(in srgb,var(--violet) 55%,transparent)">' + IC.eyeoff + 'Goblin archer</span></div><div style="display:flex;align-items:center;gap:10px">' + rSw(1) + '<span style="flex:1">Players see it</span>' + cup("Watch") + "</div></div></div>";
      return prepLap(I);
    }
    var P;
    if (v === "today") P = '<div class="e-pad" style="display:grid">' + RPS.map(function (r) { return '<div style="display:grid;gap:8px;padding:10px 0;border-bottom:1px solid var(--line)"><b style="font:600 15px var(--f-label)">' + rTitle(r) + '</b><span class="r-n" style="font-size:14px">' + rLine(r, 1) + '</span><div style="display:flex;gap:8px;align-items:center">' + rEye(r) + btn("Watch") + menu("More") + "</div></div>"; }).join("") + "</div>";
    else if (v === "shelf") P = '<div class="e-pad" style="display:grid;gap:12px">' + RPS.slice(0, 3).map(function (r) { return '<div class="e-card">' + rThumb(110) + '<span class="e-st" style="padding:3px 6px">' + rWho(r, 1) + '</span><div class="cb"><b>' + rTitle(r) + '</b><span class="r-line"><span class="n">' + r.turns + '</span> turns · ' + r.len + '</span><div style="display:flex;gap:8px;align-items:center">' + btn("Watch", "playtri") + '<span style="flex:1"></span>' + ico("dots") + "</div></div></div>"; }).join("") + "</div>";
    else if (v === "side") P = '<div class="y-scrollx" style="display:flex;gap:6px;overflow:hidden;padding:10px 12px">' + ["All 5", "Players see it 3", "Only you 2"].map(function (c, i) { return '<span class="e-btn' + (i === 0 ? " on" : " dim") + '" style="min-height:44px">' + c + "</span>"; }).join("") + '</div><div style="padding:0 12px">' + RPS.map(function (r) { return '<div class="r-row" style="grid-template-columns:minmax(0,1fr) auto auto"><span style="min-width:0"><b>' + rTitle(r) + "</b><small>" + rLine(r, 1) + "</small></span>" + rEye(r) + ico("dots") + "</div>"; }).join("") + "</div>";
    else if (v === "table") P = '<div style="padding:4px 12px"><div class="g-th" style="grid-template-columns:minmax(0,1fr) 50px 64px 34px"><span>Replay</span><span>Turns</span><span>Length</span><span></span></div>' + RPS.map(function (r) { return '<div class="g-tr" style="grid-template-columns:minmax(0,1fr) 50px 64px 34px;min-height:56px"><span style="min-width:0"><b style="white-space:normal">' + (r.name || r.enc) + '</b><small class="e-muted" style="display:block">' + r.day + '</small></span><span class="g-n">' + r.turns + '</span><span class="g-n dim">' + r.len.replace(" min", "m") + "</span>" + (r.shared ? '<span class="r-eye" style="width:28px">' + IC.eye + "</span>" : '<span class="r-eye off" style="width:28px">' + IC.eyeoff + "</span>") + "</div>"; }).join("") + "</div>";
    else return prepPhone('<div style="padding:10px 14px;display:grid;gap:12px;align-content:start"><span class="e-dim" style="display:flex;align-items:center;gap:6px">' + IC.back.replace("<svg", '<svg style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8"') + 'Replays</span><span class="e-h2" style="font-size:20px">Ambush at Riverford</span><span class="r-line">Oct 30, 2026 · <span class="n">15</span> turns · <span class="n">22</span> min</span><div style="position:relative;height:200px;border:1px solid var(--line-strong);overflow:hidden">' + mapLayer("inset:0", { small: 1 }) + '</div><span class="e-eb">Who fought</span><span class="e-dim">Borin, Lyra and Mirena against the Goblin Boss, a Wolf and the Goblin archer (only you see it).</span><div style="display:flex;align-items:center;gap:10px;min-height:44px">' + rSw(1) + '<span style="flex:1">Players see it</span></div>' + cup("Watch") + "</div>", { noStrip: 1, title: "Replays", back: 0, icons: ["dots"] });
    return prepPhone(P);
  }

  /* ---------- 2 and 3. Watching: the layout and moving through the turns ---------- */
  function ordRow(o, player, rung) {
    if (player && o.gm) return "";
    var hp = player && o.foe ? '<span class="e-muted" style="font-size:12.5px">' + o.band.toLowerCase() + "</span>" : '<span class="hp">' + o.hp + "</span>";
    return '<div class="r-ord' + (o.act ? " act" : "") + (o.gm ? " gm" : "") + (rung ? " rung" : "") + '">' + port(o.gm ? { gm: 1 } : o, 30) + '<span style="min-width:0"><b>' + o.n + (o.gm ? ' <span class="gmt" style="font:600 10px var(--f-label);letter-spacing:.08em;padding:2px 4px;border:1px dashed currentColor">GM</span>' : "") + "</b>" + (o.cond ? "<small>" + o.cond + "</small>" : o.act ? "<small>Acting</small>" : "") + "</span>" + hp + '<span class="ini">' + o.i + "</span></div>";
  }
  function orderList(player, rung) { return '<div><span class="e-eb" style="display:block;padding:0 10px 6px">Turn order</span>' + ORD.map(function (o) { return ordRow(o, player, rung); }).join("") + "</div>"; }
  function turnLog(player) { return '<div><span class="e-eb" style="display:block;padding:12px 10px 6px">During this turn</span><div class="r-log">' + TLOG.filter(function (l) { return !(player && l[1]); }).map(function (l) { return '<p class="' + (l[1] ? "gm" : "") + '">' + l[0] + (l[1] ? '<span class="gmt">GM</span>' : "") + "</p>"; }).join("") + "</div></div>"; }
  function fightLog(player) {
    var out = "", rd = 0, k = 0;
    STEPS.forEach(function (s, i) {
      if (player && s[3]) return;
      k++;
      if (s[0] !== rd) { rd = s[0]; out += '<div class="r-rnd">Round ' + rd + "</div>"; }
      out += '<div class="r-step' + (i + 1 === CUR ? " on" : "") + (s[3] ? " gm" : "") + '"><span class="r-n">' + (i + 1) + "</span><span><b>" + s[1] + "</b> · " + s[2] + "</span></div>";
    });
    return '<div class="r-steps">' + out + "</div>";
  }
  function tl() {
    var n = STEPS.length, x = function (i) { return ((i - 0.5) / n) * 100; };
    var rounds = [[1, 0], [2, 6], [3, 12]].map(function (r) { return '<span class="rd" style="left:' + (r[1] / n) * 100 + '%">R' + r[0] + "</span>"; }).join("");
    var ticks = STEPS.map(function (s, i) { return '<span class="tk" style="left:' + x(i + 1) + '%"></span>'; }).join("");
    var marks = [[2, "hit"], [3, "hit"], [6, "heal"], [8, "hit"], [12, "hit"], [15, "down"]].map(function (m) { return '<span class="mk ' + m[1] + '" style="left:' + x(m[0]) + '%"></span>'; }).join("");
    return '<span class="r-tl">' + rounds + '<span class="rail"></span><span class="done" style="width:' + x(CUR) + '%"></span>' + ticks + marks + '<span class="knob" style="left:' + x(CUR) + '%"></span></span>';
  }
  function cnt() { return '<span class="r-cnt">Turn <b>' + ("0" + CUR).slice(-2) + "</b> of " + STEPS.length + "</span>"; }
  function scrub(w) { return '<span class="w-scrub" style="max-width:' + (w || 460) + 'px"><span class="n">' + ("0" + CUR).slice(-2) + '</span><span class="t"><i style="width:' + (CUR / STEPS.length) * 100 + '%"></i><b style="left:' + (CUR / STEPS.length) * 100 + '%"></b></span><span class="n">' + STEPS.length + "</span></span>"; }
  function transport(phone, extra, player) {
    var v = S.r3, lab = '<span class="lab">Round 2 · Borin Stoneguard</span>';
    var ctl = '<span class="w-ctl">' + sico("prev") + sico("playtri") + sico("skip") + "</span>";
    extra = extra || "";
    if (v === "today") return '<div class="r-tp' + (phone ? " ph" : "") + '">' + sico("back") + sico("playtri") + sico("fwd") + '<span class="w-scrub" style="max-width:none;flex:1 1 200px;grid-template-columns:minmax(0,1fr)"><span class="t"><i style="width:47%"></i><b style="left:47%"></b></span></span><span class="r-cnt"><b>' + CUR + "</b> / " + (STEPS.length + 1) + "</span>" + extra + "</div>";
    if (v === "bar") return phone ? '<div class="w-bar ph" style="border-bottom:1px solid var(--line)"><div style="display:flex;align-items:center;gap:8px"><span class="e-eb" style="flex:none">Watching</span>' + lab + "</div>" + scrub() + '<div style="display:flex;align-items:center;gap:6px">' + ctl + '<span class="e-seg" style="margin-left:auto"><span class="on">1×</span><span>2×</span></span>' + extra + "</div></div>" : '<div class="w-bar"><span class="e-eb">Watching</span>' + lab + scrub() + ctl + '<span class="e-seg"><span class="on">1×</span><span>2×</span><span>4×</span></span>' + extra + "</div>";
    if (v === "ladder") return '<div class="r-tp' + (phone ? " ph" : "") + '"><span class="e-eb">Round</span><span class="e-seg">' + [1, 2, 3].map(function (r) { return '<span class="' + (r === 2 ? "on" : "") + '">' + r + "</span>"; }).join("") + "</span>" + btn(phone ? "Previous" : "Previous turn", "back", "dim") + btn(phone ? "Next" : "Next turn", "fwd", "dim") + sico("playtri") + (phone ? "" : '<span class="e-muted">Press a creature in the order to go to its turn.</span>') + extra + "</div>";
    if (v === "line") return '<div class="r-tp' + (phone ? " ph" : "") + '" style="align-items:center">' + '<span class="w-ctl">' + sico("prev") + sico("playtri") + sico("skip") + "</span>" + tl() + cnt() + extra + "</div>";
    var SHORT = { "Goblin Boss": "Boss" };
    var chips = ORD.filter(function (o) { return !o.gm; }).map(function (o) { return '<span class="e-btn' + (o.act ? " on" : " dim") + '" style="min-height:' + (phone ? 44 : 34) + 'px">' + (SHORT[o.n] || o.n.split(" ")[0]) + "</span>"; });
    if (!player) chips.splice(4, 0, '<span class="e-btn dim" style="color:var(--violet-text);border:1px dashed color-mix(in srgb,var(--violet) 55%,transparent);min-height:' + (phone ? 44 : 34) + 'px">Archer</span>');
    return '<div class="r-tp' + (phone ? " ph" : "") + '">' + (phone ? '<span class="e-eb">Round</span>' : "") + '<span class="e-seg">' + [1, 2, 3].map(function (r) { return '<span class="' + (r === 2 ? "on" : "") + '" style="white-space:nowrap">' + (phone ? "" : "Round ") + r + "</span>"; }).join("") + '</span><span class="y-scrollx" style="display:flex;gap:6px;overflow:hidden;min-width:0;' + (phone ? "flex:1 1 100%" : "") + '">' + chips.join("") + "</span>" + sico("playtri") + extra + "</div>";
  }
  function viewHead(player, actions) {
    var r = RPS[0];
    // The name, then when it was fought to its right.
    return '<div class="r-head">' + btn(player ? "Back" : "Replays", "back", "dim") + '<div class="t" style="display:flex;align-items:baseline;gap:16px;min-width:0"><h2 style="flex:none;max-width:62%">' + (player ? r.name || "Encounter" : r.name || r.enc) + '</h2><span class="r-line" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (player ? "Oct 30, 7:40 PM · as the party saw it" : 'Oct 30, 7:40 PM · <span class="n">15</span> turns · <span class="n">22</span> min') + "</span></div>" + (player ? "" : actions || gmActions()) + "</div>";
  }
  function stepLabel() { return '<div style="padding:8px 22px;border-bottom:1px solid var(--line);font-size:13.5px"><b style="font:600 14px var(--f-label)">Round 2 · Borin Stoneguard</b> <span class="e-muted">· 7:51 PM</span></div>'; }
  function viewBody(player, o) {
    o = o || {};
    var v = S.r2, rung = S.r3 === "ladder";
    var tp = transport(false, o.tpExtra, player);
    if (v === "today") return tp + stepLabel() + '<div style="display:grid;grid-template-columns:minmax(0,1fr) 380px;min-height:0;gap:0"><div style="position:relative;margin:12px 0 12px 22px;border:1px solid var(--line-strong);overflow:hidden">' + mapLayer("inset:0") + '</div><div style="padding:12px 22px 12px 16px;overflow:hidden">' + orderList(player, rung) + turnLog(player) + "</div></div>";
    if (v === "docks") return '<div style="display:grid;grid-template-columns:300px minmax(0,1fr) 330px;min-height:0"><div style="border-right:1px solid var(--line-strong);padding:12px 0;overflow:hidden;background:var(--bg)"><div style="display:flex;align-items:center;gap:8px;padding:0 12px 8px">' + vcr() + "</div>" + orderList(player, rung) + '</div><div style="display:grid;grid-template-rows:minmax(0,1fr) auto;min-height:0"><div style="position:relative;overflow:hidden">' + mapLayer("inset:0") + "</div>" + tp.replace('class="r-tp', 'class="r-tp" style="border-top:1px solid var(--line);border-bottom:0" data-x="') .replace('class="w-bar"', 'class="w-bar" style="border-top:1px solid var(--line);border-bottom:0"') + '</div><div style="border-left:1px solid var(--line-strong);padding:12px 0;overflow:hidden;background:var(--bg)"><span class="e-eb" style="display:block;padding:0 12px 6px">Log</span>' + turnLog(player).replace('<span class="e-eb" style="display:block;padding:12px 10px 6px">During this turn</span>', '<span class="e-eb" style="display:block;padding:0 10px 6px;color:var(--text-muted)">Round 2 · Borin Stoneguard</span>') + "</div></div>";
    if (v === "glass") return '<div style="position:relative;min-height:0">' + mapLayer("inset:0") + '<div class="e-glass" style="left:16px;top:16px;width:300px;padding:10px 0">' + orderList(player, rung) + '</div><div class="e-glass" style="right:16px;top:16px;width:340px;padding:10px 0">' + turnLog(player).replace("padding:12px 10px 6px", "padding:0 10px 6px") + '</div><div class="e-glass" style="left:50%;bottom:16px;transform:translateX(-50%);width:760px">' + tp.replace('border-bottom:1px solid var(--line)', "") + "</div></div>";
    if (v === "log") return '<div style="display:grid;grid-template-columns:minmax(0,1fr) 400px;min-height:0"><div style="display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0">' + tp + '<div style="position:relative;overflow:hidden">' + mapLayer("inset:0") + '<div class="e-glass" style="left:14px;top:14px;display:flex;gap:6px;padding:8px;flex-wrap:wrap;max-width:560px">' + ORD.filter(function (x) { return !(player && x.gm); }).map(function (x) { return '<span class="e-btn' + (x.act ? " on" : " dim") + '"' + (x.gm ? ' style="color:var(--violet-text)"' : "") + ">" + shortN(x.n) + ' <span class="r-n" style="font-size:15px">' + (player && x.foe ? x.band.toLowerCase() : x.hp) + "</span></span>"; }).join("") + '</div></div></div><div style="border-left:1px solid var(--line-strong);overflow:hidden;background:var(--bg)"><span class="e-eb" style="display:block;padding:12px 12px 4px">The whole fight · press a turn</span>' + fightLog(player) + "</div></div>";
    return tp + '<div style="display:grid;grid-template-rows:380px minmax(0,1fr);min-height:0"><div style="position:relative;margin:12px 22px 0;border:1px solid var(--line-strong);overflow:hidden">' + mapLayer("inset:0") + '</div><div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;padding:10px 22px;overflow:hidden">' + orderList(player, rung) + turnLog(player).replace("padding:12px 10px 6px", "padding:0 10px 6px") + "</div></div>";
  }
  function viewLap(player, o) {
    o = o || {};
    if (!player && S.r4 === "foot" && o.tpExtra === undefined) o.tpExtra = '<span style="flex:none;margin-left:6px">' + cup("Launch from turn 8") + "</span>";
    var rows = S.r2 === "docks" || S.r2 === "glass" || S.r2 === "log" ? "auto minmax(0,1fr)" : S.r2 === "today" ? "auto auto auto minmax(0,1fr)" : "auto auto minmax(0,1fr)";
    var I = '<div class="r-page" style="grid-template-rows:' + rows + (o.side ? ";grid-template-columns:minmax(0,1fr) 300px" : "") + '">' + viewHead(player, o.actions) + viewBody(player, o) + (o.side || "") + (o.over || "") + "</div>";
    return player ? plLap(I) : gmLap(I);
  }
  function viewPhoneBody(player, o) {
    o = o || {};
    var v = S.r2, rung = S.r3 === "ladder";
    var head = '<div style="padding:10px 14px;display:grid;gap:4px;border-bottom:1px solid var(--line)"><span class="e-h2" style="font-size:18px">' + (player ? RPS[0].name || "Encounter" : RPS[0].name || RPS[0].enc) + '</span><span class="r-line">' + (player ? "Oct 30, 7:40 PM · as the party saw it" : 'Oct 30, 7:40 PM · <span class="n">15</span> turns · 22 min') + "</span>" + (o.headExtra || "") + "</div>";
    var tp = transport(true, o.tpExtra, player);
    var map = function (h) { return '<div style="position:relative;height:' + h + 'px;overflow:hidden;border-bottom:1px solid var(--line)">' + mapLayer("inset:0", { small: 1 }) + "</div>"; };
    var tabs = function (a) { return '<div style="padding:8px 12px 0"><div class="e-seg"><span class="' + (a ? "on" : "") + '">Turn order</span><span class="' + (a ? "" : "on") + '">This turn</span></div></div>'; };
    if (v === "today") return head + tp + map(210) + tabs(1) + '<div style="padding:6px 6px">' + orderList(player, rung) + "</div>";
    if (v === "docks") return head + map(300) + '<div style="padding:8px 12px 0"><div class="e-seg"><span class="on">Order</span><span>Log</span></div></div><div style="padding:6px 6px">' + orderList(player, rung) + "</div>" + '<div style="position:absolute;left:0;right:0;bottom:0;background:var(--bg);border-top:1px solid var(--line)">' + tp + "</div>";
    if (v === "glass") return '<div style="position:absolute;inset:0">' + mapLayer("inset:0", { small: 1 }) + '<div class="e-glass" style="left:10px;right:10px;top:10px;display:flex;gap:6px;padding:8px;overflow:hidden">' + ORD.filter(function (x) { return !(player && x.gm); }).map(function (x) { return '<span class="e-btn' + (x.act ? " on" : " dim") + '" style="min-height:40px;flex:none' + (x.gm ? ";color:var(--violet-text)" : "") + '">' + shortN(x.n) + "</span>"; }).join("") + '</div><div class="e-glass" style="left:10px;right:10px;bottom:10px">' + tp + "</div></div>";
    if (v === "log") return head + tp + map(150) + '<div style="overflow:hidden">' + fightLog(player) + "</div>";
    return head + tp + map(220) + '<div style="padding:6px 6px">' + orderList(player, rung) + turnLog(player) + "</div>";
  }
  function viewPhone(player, o) {
    o = o || {};
    if (!player && S.r4 === "foot" && o.tpExtra === undefined) o.tpExtra = cup("Launch from turn 8");
    var inner = '<div style="position:relative;height:100%;overflow:hidden">' + viewPhoneBody(player, o) + ((o && o.over) || "") + "</div>";
    return player ? plPhone(inner) : prepPhone(inner, { noStrip: 1, title: "Replays", back: 1, icons: (o && o.icons) || ["dots"] });
  }
  function viewerPage(phone) { return phone ? viewPhone(false) : viewLap(false); }
  function movingPage(phone) { return phone ? viewPhone(true) : viewLap(true); }

  /* ---------- 4. The GM's actions: launch, share, rename, download, delete ---------- */
  function gmActions() {
    var v = S.r4;
    if (v === "today") return cup("Launch from here") + btn("Download JSON", "download");
    if (v === "menu") return '<span class="e-btn on">' + IC.eye + "Players see it</span>" + cup("Launch from turn 8") + ico("dots");
    if (v === "title") return '<span class="r-who">' + IC.eye + "Players see it</span>" + rSw(1) + cup("Launch from turn 8") + ico("dots");
    if (v === "side") return btn("Details", "", "on");
    return ico("dots");
  }
  function actionsPage(phone) {
    var v = S.r4;
    var menuRows = function (items) { return items.map(function (m) { var st = (phone ? "min-height:48px;" : "") + (m[2] ? "color:var(--danger-text)" : ""); return '<div class="u-mi"' + (st ? ' style="' + st + '"' : "") + ">" + IC[m[0]] + m[1] + "</div>"; }).join(""); };
    if (!phone) {
      if (v === "today") return viewLap(false, { over: '<div class="e-scrim"></div><div class="e-dlg" style="left:50%;top:180px;width:440px;transform:translateX(-50%);grid-template-rows:auto auto auto"><div class="e-dh"><h2>Launch from this moment?</h2>' + ico("close") + '</div><div style="padding:14px 20px;font-size:14px;line-height:1.5">The table becomes this replay at turn 8. Your live encounter is parked in Encounters. Resume it anytime.</div><div class="u-dfoot" style="justify-content:flex-end">' + btn("Cancel", "", "ghost") + cup("Launch") + "</div></div>" });
      if (v === "menu") return viewLap(false, { over: '<div class="u-menu" style="right:22px;top:58px;width:250px"><div class="u-mh">Ambush at Riverford</div>' + menuRows([["pencil", "Rename"], ["download", "Download JSON"], ["trash", "Delete replay", 1]]) + "</div>" });
      if (v === "title") return viewLap(false, { actions: gmActions() }).replace('<h2>Ambush at Riverford · Oct 30, 2026</h2>', '<span class="e-field" style="min-height:40px;font:600 20px var(--f-display);letter-spacing:.04em;border-color:var(--cyan);max-width:520px">Ambush at Riverford<i style="display:inline-block;width:2px;height:22px;background:var(--cyan);margin-left:2px;vertical-align:middle"></i></span>').replace('Oct 30, 7:40 PM to 8:02 PM · <span class="n">15</span> turns', "Players see this name once you share it. Leave it empty to call it Ambush at Riverford again.");
      if (v === "side") return viewLap(false, { side: '<div class="r-side" style="grid-row:1/-1;grid-column:2"><div style="display:flex;align-items:center"><span class="e-eb" style="flex:1">Details</span>' + ico("close") + '</div><span class="e-eb">Name</span><span class="e-field" style="min-height:40px">Ambush at Riverford</span><span class="e-muted">Players see this name once you share it.</span><div style="display:flex;align-items:center;gap:10px;min-height:44px">' + rSw(1) + '<span style="flex:1">Players see it</span></div><div class="r-sheet" style="padding:0"><div class="ln">Fought<b style="font:500 13px var(--f-label)">Oct 30, 2026</b></div><div class="ln">Turns<b>15</b></div><div class="ln">Length<b>22 min</b></div></div>' + btn("Download JSON", "download", "dim") + '<span class="e-btn dim" style="color:var(--danger-text)">' + IC.trash + "Delete replay</span>" + cup("Launch from turn 8") + "</div>" });
      return viewLap(false, { tpExtra: '<span style="flex:none;margin-left:6px">' + cup("Launch from turn 8") + "</span>" });
    }
    var sheet = function (title, inner) { return '<div class="e-scrim"></div><div class="e-dlg" style="left:0;right:0;bottom:0;top:auto;grid-template-rows:auto auto auto"><div class="e-dh"><h2>' + title + "</h2>" + ico("close") + "</div>" + inner + "</div>"; };
    if (v === "today") return viewPhone(false, { headExtra: '<div style="display:grid;gap:8px;margin-top:6px">' + cup("Launch from here") + btn("Download JSON", "download") + "</div>", over: sheet("Launch from this moment?", '<div style="padding:12px 16px;font-size:14px;line-height:1.5">The table becomes this replay at turn 8. Your live encounter is parked in Encounters. Resume it anytime.</div><div style="display:flex;gap:8px;justify-content:flex-end;padding:10px 16px 14px">' + btn("Cancel", "", "ghost") + cup("Launch") + "</div>") });
    if (v === "menu" || v === "foot") return viewPhone(false, { tpExtra: v === "foot" ? cup("Launch from turn 8") : "", headExtra: v === "menu" ? '<div style="display:flex;gap:8px;margin-top:6px;align-items:center"><span class="e-btn on" style="min-height:44px">' + IC.eye + "Players see it</span>" + cup("Launch from turn 8") + "</div>" : "", over: sheet("Ambush at Riverford", '<div style="padding:4px 0 10px">' + menuRows((v === "foot" ? [["eye", "Players see it"]] : []).concat([["pencil", "Rename"], ["download", "Download JSON"], ["trash", "Delete replay", 1]])) + "</div>") });
    if (v === "title") return viewPhone(false, { headExtra: '<span class="e-field" style="min-height:44px;border-color:var(--cyan)">Ambush at Riverford</span><span class="e-muted">Players see this name once you share it.</span><div style="display:flex;gap:10px;align-items:center;min-height:44px">' + rSw(1) + '<span style="flex:1">Players see it</span>' + cup("Launch from turn 8") + "</div>" });
    return prepPhone('<div style="padding:12px 14px;display:grid;gap:10px;align-content:start"><span class="e-dim" style="display:flex;align-items:center;gap:6px">' + IC.back.replace("<svg", '<svg style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8"') + 'The replay</span><span class="e-eb">Name</span><span class="e-field" style="min-height:44px">Ambush at Riverford</span><span class="e-muted">Players see this name once you share it.</span><div style="display:flex;align-items:center;gap:10px;min-height:44px">' + rSw(1) + '<span style="flex:1">Players see it</span></div><div class="r-sheet" style="padding:0"><div class="ln">Fought<b style="font:500 13px var(--f-label)">Oct 30, 2026</b></div><div class="ln">Turns<b>15</b></div><div class="ln">Length<b>22 min</b></div></div>' + btn("Download JSON", "download", "dim") + '<span class="e-btn dim" style="color:var(--danger-text);min-height:44px">' + IC.trash + "Delete replay</span>" + cup("Launch from turn 8") + "</div>", { noStrip: 1, title: "Details", icons: [] });
  }

  /* ---------- 5. A player's replays ---------- */
  var SHARED = [RPS[0], RPS[1], RPS[4]];
  function plSheetStub(phone) {
    return '<div class="r-sheet">' + [["Hit points", "36/44"], ["Armor class", "17"], ["Spell slots", "3 · 3 · 2"], ["Prepared", "9"]].map(function (l) { return '<div class="ln">' + l[0] + "<b>" + l[1] + "</b></div>"; }).join("") + (phone ? "" : '<div class="ln">Fire Bolt<b>+7</b></div><div class="ln">Misty Step<b>2nd</b></div>') + "</div>";
  }
  function plReplays(phone) {
    var v = S.r5;
    if (v === "today") return '<div style="padding:4px 14px 12px;display:grid;gap:2px"><span class="e-eb" style="padding:8px 0 4px">Replays</span>' + SHARED.map(function (r) { return '<div class="r-row" style="grid-template-columns:minmax(0,1fr);min-height:52px"><span style="min-width:0"><b>' + rTitleP(r) + "</b><small>" + rLineP(r) + "</small></span></div>"; }).join("") + "</div>";
    if (v === "cards") return '<div style="padding:4px 14px 12px;display:grid;gap:10px"><span class="e-eb" style="padding:8px 0 0">Replays · 3</span><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' + SHARED.slice(0, 2).map(function (r) { return '<div class="e-card">' + rThumb(phone ? 84 : 96) + '<div class="cb"><b style="font-size:13.5px">' + rTitleP(r) + '</b><span class="r-line"><span class="n">' + r.turns + "</span> turns</span>" + btn("Watch", "playtri") + "</div></div>"; }).join("") + "</div></div>";
    if (v === "last") return '<div style="padding:10px 14px 12px;display:grid;gap:8px"><div class="r-row" style="grid-template-columns:auto minmax(0,1fr) auto;border:1px solid var(--line-strong);padding:8px 12px">' + IC.film.replace("<svg", '<svg style="width:20px;height:20px;fill:none;stroke:var(--cyan);stroke-width:1.8"') + '<span style="min-width:0"><span class="e-eb">The last fight</span><b>' + rTitleP(SHARED[0]) + "</b></span>" + btn("Watch", "playtri") + '</div><span class="e-btn dim" style="justify-self:start' + (phone ? ";min-height:44px" : "") + '">All replays · 3' + IC.fwd + "</span></div>";
    return "";
  }
  function playerPage(phone) {
    var v = S.r5;
    var logLines = '<div class="r-log">' + ["Lyra Emberwise took a short rest.", "Mirena Dawnbright: Medicine 14.", "The GM: The road bends toward the river."].map(function (l) { return "<p>" + l + "</p>"; }).join("") + "</div>";
    var rpLog = '<div style="padding:8px 12px;display:grid;gap:2px;border-bottom:1px solid var(--line-strong)"><span class="e-eb" style="padding:4px 0">Replays · 3</span>' + SHARED.map(function (r) { return '<div class="r-row" style="grid-template-columns:minmax(0,1fr) auto;min-height:50px;padding:6px 0"><span style="min-width:0"><b style="font-size:14px">' + rTitleP(r) + "</b><small>" + r.turns + " turns · " + r.len + "</small></span>" + btn("Watch", "playtri") + "</div>"; }).join("") + "</div>";
    var tabsRow = function (on) { return '<div class="e-tabs" style="padding:0 12px">' + ["Me", "Log", "Party"].map(function (t) { return '<span class="e-tab' + (t === on ? " on" : "") + '">' + t + "</span>"; }).join("") + "</div>"; };
    if (!phone) {
      var panelInner = v === "log" ? tabsRow("Log") + rpLog + logLines : tabsRow("Me") + plSheetStub() + plReplays();
      var I = '<div style="position:absolute;inset:0;display:grid;grid-template-columns:minmax(0,1fr) 380px"><div style="position:relative;overflow:hidden">' + mapLayer("inset:0") + '<div class="e-glass" style="left:14px;top:14px;padding:8px 12px;display:flex;gap:10px;align-items:center">' + vcr(true) + '<span class="e-dim">No encounter running.</span></div></div><div style="border-left:1px solid var(--line-strong);background:var(--bg);overflow:hidden">' + panelInner + "</div></div>";
      if (v === "more") I += '<div class="u-menu" style="right:70px;top:4px;width:270px"><div class="u-mh">Lyra Emberwise</div>' + [["user", "My character"], ["film", "Replays · 3"], ["gear", "Device"], ["out", "Leave the table"]].map(function (m, i) { return '<div class="u-mi"' + (i === 1 ? ' style="background:color-mix(in srgb,var(--cyan) 10%,transparent)"' : "") + ">" + IC[m[0]] + m[1] + "</div>"; }).join("") + "</div>";
      return plLap(I, v === "more");
    }
    if (v === "log") return plPhone('<div style="position:relative;height:100%;overflow:hidden">' + rpLog + logLines + "</div>", "Log");
    if (v === "more") return plPhone('<div style="padding:10px 14px;display:grid;gap:4px"><span class="e-eb" style="padding:4px 0 8px">More</span>' + [["film", "Replays", "3"], ["book", "Compendium"], ["gear", "Device"], ["out", "Leave the table"]].map(function (m, i) { return '<div class="u-ri' + (i === 0 ? " on" : "") + '" style="min-height:48px">' + IC[m[0]].replace("<svg", '<svg style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;margin-right:8px"') + m[1] + (m[2] ? '<span class="n">' + m[2] + "</span>" : "") + "</div>"; }).join("") + "</div>", "More");
    return plPhone('<div style="position:relative;height:100%;overflow:hidden">' + tabsRow("Me") + plSheetStub(true) + plReplays(true) + "</div>", "Table");
  }
