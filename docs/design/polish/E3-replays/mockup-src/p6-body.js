
  /* ---------- 1. The TV in a fight: three turn ladders ---------- */
  var ACT = TURNS[1], NEXT = TURNS[2];
  // The rolling ladder starts at whoever acts. Those who already acted this round come after the line for the next round.
  var ROLLED = TURNS.slice(1).concat([{ round: 1 }], TURNS.slice(0, 1));
  function tile(t, o) { o = o || {}; return '<span class="h-tile' + (t.act ? " act" : "") + '">' + port(t, o.ps || 56) + "<b>" + (t.gm ? "GM turn" : t.f || t.n) + "</b><i>" + t.i + "</i>" + (t.next ? '<span class="tag">NEXT</span>' : "") + "</span>"; }
  function corners(st) { var c = "position:absolute;z-index:2;width:26px;height:26px;border-color:var(--cyan);border-style:solid;opacity:.8;"; return '<i style="' + c + "left:10px;top:10px;border-width:2px 0 0 2px;" + (st || "") + '"></i><i style="' + c + 'right:10px;top:10px;border-width:2px 2px 0 0"></i><i style="' + c + 'left:10px;bottom:10px;border-width:0 0 2px 2px"></i><i style="' + c + 'right:10px;bottom:10px;border-width:0 2px 2px 0"></i>'; }
  function lrow(t, phone) {
    if (t.round) return '<div class="h-rdiv"><span>RND ' + ("0" + (+ROUND + 1)).slice(-2) + "</span><small>Round " + (+ROUND + 1) + " starts</small></div>";
    var ps = t.act ? (phone ? 56 : 76) : phone ? 30 : 46;
    var name = t.gm ? "GM turn" : t.n;
    var mid = t.act ? '<span class="who"><span class="h-eb">Acting now</span><span class="h-name">' + name + "</span></span>" : "<b>" + name + "</b>";
    return '<div class="h-lr' + (t.act ? " act" : "") + (t.next ? " next" : "") + (t.gm ? " gm" : "") + '"><i>' + t.i + "</i>" + port(t, ps) + mid + (t.next ? '<span class="tag">NEXT</span>' : "") + "</div>";
  }
  function rollFoot() { return '<div class="h-lfoot"><span class="h-eb">Latest roll</span><span class="what">' + ROLL.who + " · " + ROLL.what + '</span><div class="num"><span class="h-total">' + ROLL.total + '</span><span class="h-dice">' + ROLL.dice + "</span></div></div>"; }
  function ladder(v, st, phone) {
    var rows = (v === "rolling" ? ROLLED : TURNS).map(function (t) { return lrow(t, phone); }).join("");
    return '<div class="h-lad' + (v === "glass" ? " glass" : "") + '" style="' + (st || "") + '"><div class="hd">' + wm() + vcr() + '</div><div class="h-hz"></div><div class="h-rows">' + rows + "</div>" + (v === "glass" ? "" : rollFoot()) + "</div>";
  }
  function rollGlass(st, phone) {
    if (phone) return '<div class="h-glass" style="' + st + ';display:flex;align-items:center;gap:14px;padding:10px 16px"><span style="display:grid;gap:4px;min-width:0;flex:1"><span class="h-eb" style="font-size:11px">Latest roll</span><span style="font:600 15px var(--f-label)">' + ROLL.who + " · " + ROLL.what + '</span></span><span class="h-total" style="font-size:48px">' + ROLL.total + "</span></div>";
    return '<div class="h-glass" style="' + st + ';display:grid;gap:6px;padding:14px 18px"><span class="h-eb">Latest roll</span><span style="font:600 18px var(--f-label)">' + ROLL.who + " · " + ROLL.what + '</span><div style="display:flex;align-items:baseline;gap:12px"><span class="h-total" style="font-size:58px">' + ROLL.total + '</span><span class="h-dice">' + ROLL.dice + "</span></div></div>";
  }
  // What the TV shows, at 1280 by 720. The GM's pictures of the screen draw the same thing smaller.
  function fightInner(v, o) {
    o = o || {};
    if (v === "glass") return mapLayer("left:200px;right:-200px;top:0;bottom:0", { ping: o.ping }) + ladder(v, "position:absolute;left:20px;top:20px;bottom:20px;width:372px") + rollGlass("right:22px;bottom:22px;width:330px");
    return ladder(v, "position:absolute;left:0;top:0;bottom:0;width:400px;border-right:1px solid var(--line-strong)") + '<div style="position:absolute;left:400px;top:0;right:0;bottom:0">' + mapLayer("inset:0", { ping: o.ping }) + corners() + "</div>";
  }
  function fight(phone) {
    var v = S.d1;
    if (!phone) return tvFrame(fightInner(v));
    if (v === "glass") return tvFrame(mapLayer("left:0;right:0;top:110px;bottom:-110px", { small: 1 }) + ladder(v, "position:absolute;left:10px;right:10px;top:10px", true) + rollGlass("left:10px;right:10px;bottom:10px", true), true);
    return tvFrame('<div style="position:absolute;inset:0;display:flex;flex-direction:column">' + ladder(v, "flex:none", true) + mapLayer("position:relative;flex:1", { small: 1 }) + "</div>", true);
  }

  // A map on the screen with no encounter running: the ladder keeps its head and names the map where the turn would be.
  function calmLadder(st, phone) { return '<div class="h-lad" style="' + st + '"><div class="hd">' + wm() + vcr(true) + '</div><div class="h-hz"></div><div class="h-rows"><div class="h-lr calm"><span class="who"><span class="h-eb">No encounter running</span><span class="h-name">The old road</span></span></div></div><div class="h-lfoot"><span class="h-eb">Latest roll</span><span class="what none">No roll to show yet.</span></div></div>'; }
  function calm(phone) {
    if (!phone) return tvFrame(calmLadder("position:absolute;left:0;top:0;bottom:0;width:400px;border-right:1px solid var(--line-strong)") + '<div style="position:absolute;left:400px;top:0;right:0;bottom:0">' + mapLayer("inset:0", { toks: false }) + corners() + "</div>");
    return tvFrame('<div style="position:absolute;inset:0;display:flex;flex-direction:column">' + calmLadder("flex:none", true) + mapLayer("position:relative;flex:1", { toks: false }) + "</div>", true);
  }

  /* ---------- 2. Pairing, paused and waiting: the horizon line ---------- */
  function code() { return '<span class="h-code"><span>' + CODE[0] + "</span><span>" + CODE[1] + "</span></span>"; }
  var WAIT = {
    pair: ["Table screen", "Pair this screen", "On the GM's device, open Table screen settings and type this code.", "The code changes every 10 minutes. This screen shows only what the GM presents."],
    paused: ["Connected", "Paused", "The GM will begin when the table is ready."],
    waiting: ["Connected", "Waiting for a map", "The GM controls what appears here."]
  };
  function horizon(mode, phone) {
    var w = WAIT[mode];
    var I = '<div style="position:absolute;inset:0;background:var(--void)"></div><div class="h-hz" style="position:absolute;left:0;right:0;top:46%"></div><div style="position:absolute;left:0;right:0;top:0;height:46%;display:grid;align-content:end;justify-items:center;gap:14px;padding-bottom:30px;text-align:center"><span class="h-eb">' + w[0] + '</span><span style="font:600 ' + (phone ? 28 : 40) + 'px/1.1 var(--f-display);letter-spacing:.05em;text-transform:uppercase">' + w[1] + '</span></div><div style="position:absolute;left:0;right:0;top:46%;display:grid;justify-items:center;gap:16px;padding:34px 20px 0;text-align:center">' + (mode === "pair" ? code() + '<p style="margin:0;font-size:' + (phone ? 15 : 19) + 'px;color:var(--text-dim);max-width:40ch">' + w[2] + '</p><p style="margin:0;font-size:' + (phone ? 13 : 15) + 'px;color:var(--text-muted)">' + w[3] + "</p>" : '<p style="margin:0;font-size:' + (phone ? 16 : 22) + 'px;color:var(--text-dim)">' + w[2] + "</p>") + "</div>";
    // A screen that has not been tapped yet cannot play sound; one quiet button asks for the tap.
    if (mode === "waiting") I += '<span class="h-snd" style="left:' + (phone ? 12 : 24) + "px;bottom:" + (phone ? 14 : 24) + 'px">' + IC.vol + "Tap to turn on sound</span>";
    return tvFrame(I, phone);
  }
  function pair(phone) { return horizon("pair", phone); }
  function paused(phone) { return horizon("paused", phone); }
  function waiting(phone) { return horizon("waiting", phone); }

  /* ---------- A small live picture of the screen, for the GM ---------- */
  function tvInner(o) { return fightInner(S.d1, o); }
  function miniTV(w, inner, label) { var k = w / 1280; return '<div class="h-thumb" style="width:' + w + "px;height:" + Math.round(720 * k) + 'px">' + (label || "") + '<div class="h-mini h-tvbox" style="width:1280px;height:720px;transform:scale(' + k + ')">' + (inner || tvInner()) + "</div></div>"; }

  /* ---------- 3. The GM's screens, then one screen as a remote ---------- */
  function onScreen() { return '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' + lamp(true, true) + '<span style="font:600 15px var(--f-label)">The old road</span><span class="e-muted">Live encounter · round 2</span></div>'; }
  function toolSeg(full) { return '<span class="e-seg" style="width:' + (full ? "100%" : "380px") + '">' + [["Focus view", "target"], ["Ping a point", "ping"], ["Measure", "ruler"]].map(function (t, i) { return '<span class="' + (i === 1 ? "on" : "") + '">' + IC[t[1]] + t[0] + "</span>"; }).join("") + "</span>"; }
  function addr() { return '<div style="display:flex;gap:8px;align-items:center"><span class="e-field" style="flex:1;min-width:0;font-size:13px">http://192.168.1.20:3302/viewer' + IC.down + "</span>" + btn("Copy address") + "</div>"; }
  function head(title, ln, acts, back) { return '<div class="e-rec">' + (back ? '<span class="e-crumb h-back" data-go="screens">' + IC.back + "Table screen</span>" : "") + "<h1>" + title + '</h1><div class="ln">' + ln + '</div><div class="acts">' + acts + "</div></div>"; }
  function screensPage(phone) {
    if (!phone) {
      var I = head("Table screen", "Paired screens show the map you present, with only what players can see on it.", '<span class="e-seg" style="width:200px"><span class="on">Display</span><span>Sound</span></span><span class="e-muted">1 screen connected</span>') +
        '<div style="display:flex;align-items:center;gap:14px;padding:12px 24px;border-bottom:1px solid var(--line)"><span class="e-eb">On the screen</span>' + onScreen() + '<span class="e-grow" style="flex:1"></span>' + btn("Pause the table screen", "pause") + menu("Present a map") + "</div>" +
        '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;padding:18px 24px;align-items:start">' +
        '<div class="h-card h-scard" data-go="screen">' + miniTV(374) + '<div class="h-srow"><span class="h-dot"></span><span><b>Living room TV</b><small>Connected · sound on</small></span><span class="e-btn">Open' + IC.fwd + "</span></div></div>" +
        '<div class="h-card h-scard"><div class="h-thumb" style="width:374px;height:210px;display:grid;place-items:center;color:var(--text-muted);font-size:14px">Not connected</div><div class="h-srow"><span class="h-dot off"></span><span><b>Kitchen tablet</b><small>Last seen Oct 25</small></span><span class="e-btn">Open' + IC.fwd + "</span></div></div>" +
        '<div class="h-card" style="padding:16px;gap:12px;border-style:dashed;align-content:start"><span class="e-eb">Pair another screen</span><span class="e-muted">Open this address on the screen. It shows a six-digit code; type it here.</span>' + addr() + '<div style="display:grid;grid-template-columns:150px minmax(0,1fr);gap:8px"><span class="e-field" style="font:400 20px var(--f-num);letter-spacing:.2em">826 427</span><span class="e-field">Kitchen tablet</span></div>' + cup("Pair screen") + "</div>" +
        '</div><p class="e-muted" style="margin:0;padding:0 24px">Open a screen to point at the map it shows: focus, ping and measure.</p>';
      return gmLap(I);
    }
    var P = '<div class="e-pad" style="display:grid;gap:12px;padding:12px 14px"><div class="e-seg"><span class="on">Display</span><span>Sound</span></div>' +
      grp("On the screen", onScreen() + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px">' + btn("Pause", "pause") + menu("Present a map") + "</div>") +
      '<div class="h-card h-scard" data-go="screen" style="padding:10px;gap:8px">' + miniTV(340) + '<div class="h-srow"><span class="h-dot"></span><span><b>Living room TV</b><small>Connected · sound on</small></span><span class="h-open">' + IC.fwd + "</span></div></div>" +
      '<div class="h-card h-scard" style="padding:2px 10px"><div class="h-srow"><span class="h-dot off"></span><span><b>Kitchen tablet</b><small>Not connected · last seen Oct 25</small></span><span class="h-open">' + IC.fwd + "</span></div></div>" +
      '<div class="h-card" style="padding:2px 10px;border-style:dashed"><div class="h-srow" style="box-shadow:none"><span class="e-ico" style="box-shadow:none">' + IC.plus + '</span><span><b>Pair another screen</b><small>Type the code it shows</small></span><span class="h-open">' + IC.fwd + "</span></div></div></div>";
    return gmPhone('<div style="height:100%;overflow:hidden">' + P + "</div>", { title: "Table screen", icons: ["dots"] });
  }
  function screenPage(phone) {
    var pic = function (w) { return miniTV(w, tvInner({ ping: 1 })); };
    if (!phone) {
      var I = head("Living room TV", "Connected · sound on · paired Oct 12", '<span class="e-btn" style="color:var(--danger-text)">Revoke this screen</span>', true) +
        '<div style="display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:24px;padding:14px 24px;align-items:start"><div style="display:grid;gap:10px;justify-items:start">' + toolSeg() + '<div class="h-remote">' + pic(880) + '</div><span class="e-muted">Press the picture to ping that point. Every paired screen shows it.</span></div>' +
        '<div style="display:grid;gap:16px">' + grp("On the screen", onScreen() + '<div style="display:grid;gap:8px;margin-top:6px">' + btn("Pause the table screen", "pause") + btn("Present another map", "map") + btn("Show the live encounter", "playtri") + "</div>", true) +
        grp("Other screens", '<div class="h-srow"><span class="h-dot off"></span><span><b>Kitchen tablet</b><small>Last seen Oct 25</small></span><span class="e-btn">Open' + IC.fwd + "</span></div>", true) + "</div></div>";
      return gmLap(I);
    }
    var P = '<div style="display:grid;gap:10px;padding:12px 12px 0"><div style="display:flex;align-items:center;gap:8px"><span class="h-dot"></span><span class="e-muted" style="color:var(--text-dim)">Connected · sound on</span></div><div class="h-remote">' + pic(366) + "</div>" + toolSeg(true) + '<span class="e-muted">Press the picture to ping that point. Every paired screen shows it.</span>' + grp("On the screen", onScreen(), true) + grp("Other screens", '<div class="h-srow"><span class="h-dot off"></span><span><b>Kitchen tablet</b><small>Last seen Oct 25</small></span><span class="h-open">' + IC.fwd + "</span></div>", true) + '</div><div class="e-pfoot" style="grid-template-columns:1fr 1fr">' + btn("Pause", "pause") + menu("Present a map") + "</div>";
    return gmPhone(P, { back: true, backTo: "screens", title: "Living room TV", icons: ["dots"] });
  }

  /* ---------- 4. In the menu, and the preview as picture in picture ---------- */
  function pageBehind(phone) { return '<div style="position:absolute;inset:0"><div class="sb titled"><span class="sb-title">Prep</span><div class="sb-tabs"><span class="sb-tab on">Encounters</span><span class="sb-tab">Party</span><span class="sb-tab">Maps</span><span class="sb-tab">Tokens</span><span class="sb-tab">Sound</span><span class="sb-tab">Replays</span></div>' + prepEnd() + '</div><div style="padding:18px 24px;display:grid;grid-template-columns:repeat(' + (phone ? 1 : 3) + ',1fr);gap:14px">' + ["Ambush on the old road", "The ruined keep gate", "Rats in the cellar"].map(function (n) { return '<div class="h-card" style="padding:12px"><div class="h-thumb" style="background-image:url(' + MAP + ');background-size:cover"></div><b style="font:600 15px var(--f-label)">' + n + "</b></div>"; }).join("") + "</div></div>"; }
  function menuRows(inner) {
    return '<div class="who-row"><span class="face lg gm">GM</span><div><b>Game Master</b><span>Signed in on this device</span></div></div><div class="mrow">' + IC.party + 'Who is here<span class="end">3 of 3</span></div><div class="mrow">' + IC.screen + 'Table screen<span class="end">' + lamp(true, true) + IC.up + "</span></div>" + inner + '<div class="mrow">' + IC.moon + 'Theme<span class="end"><span class="segc"><span class="on">Dusk</span><span>Dawn</span></span></span></div><div class="mrow">' + IC.gear + 'Settings<span class="end">' + IC.fwd + '</span></div><div class="mrow">' + IC.out + "Sign out</div>";
  }
  var SUB = '<div class="msub"><span>Pause the table screen</span><span data-go="pip">Preview it here</span><span data-go="screens">Table screen settings</span></div>';
  function menuPage(phone) {
    if (!phone) return '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-base">' + topBar() + '<div class="ap-pane" style="position:relative;overflow:hidden">' + pageBehind() + '<div style="position:absolute;inset:0;background:rgba(0,0,0,.25)"></div><div class="ov menu lap">' + menuRows(SUB) + "</div></div></div></div>";
    return gmPhone(pageBehind(true) + '<div class="scrim"></div><div class="ov sheet onph"><div class="grab"></div>' + menuRows(SUB) + "</div>", { title: "Prep", icons: ["search", "plus"] });
  }
  function pipBar(phone) { return '<div class="bar">' + lamp(true, phone) + '<span class="e-grow" style="flex:1"></span><span class="e-ico" aria-label="Pause the table screen">' + IC.pause + "</span>" + (phone ? "" : '<span class="e-ico" aria-label="Pop out">' + IC.popout + "</span>") + '<span class="e-ico" aria-label="Close the preview">' + IC.close + "</span></div>"; }
  function pipPage(phone) {
    if (!phone) return '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-base">' + topBar() + '<div class="ap-pane" style="position:relative;overflow:hidden">' + pageBehind() + '<div class="h-pip" style="right:20px;bottom:20px;width:420px">' + pipBar() + miniTV(418) + '</div><div class="toast corner" style="right:460px;bottom:20px;width:380px">The preview stays here on every page. Drag it to another corner.<span class="x">×</span></div></div></div></div>';
    return gmPhone(pageBehind(true) + '<div class="h-pip" style="right:10px;bottom:12px;width:250px">' + pipBar(true) + miniTV(248) + "</div>", { title: "Prep", icons: ["search", "plus"] });
  }
