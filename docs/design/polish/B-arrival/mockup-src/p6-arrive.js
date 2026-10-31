(function () {
  "use strict";
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* ---------- Icons ---------- */
  function svg(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>"; }
  var IC = {
    arrow: svg('<path d="M5 12h13M13 7l5 5-5 5"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    file: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>'),
    copy: svg('<rect x="8" y="8" width="12" height="12"/><path d="M4 16V4h12"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    down: svg('<path d="M7 10l5 5 5-5"/>'),
    dots: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
    play: svg('<rect x="4" y="4" width="16" height="16"/><circle cx="9" cy="9" r=".8"/><circle cx="15" cy="15" r=".8"/><circle cx="15" cy="9" r=".8"/><circle cx="9" cy="15" r=".8"/>'),
    prep: svg('<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    codex: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h7"/>'),
    book: svg('<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z"/><path d="M5 16a4 4 0 0 1 4-4h10"/>'),
    log: svg('<path d="M5 5h14M5 10h14M5 15h9M5 20h6"/>'),
    sheet: svg('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>'),
    party: svg('<circle cx="9" cy="9" r="3"/><circle cx="16.5" cy="10" r="2.4"/><path d="M3.5 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5M14.5 14.6c2.4-.4 4.6 1 5.4 4.4"/>'),
    screen: svg('<rect x="3" y="5" width="18" height="12"/><path d="M8 21h8M12 17v4"/>'),
    gear: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'),
    out: svg('<path d="M14 4h6v16h-6"/><path d="M10 8l-4 4 4 4M6 12h10"/>'),
    qr: svg('<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>')
  };
  var EMB = {
    shield: '<path d="M12 3l7 3v5.5c0 4.6-3 8-7 9.5-4-1.5-7-4.9-7-9.5V6z"/><path d="M12 7.5v9M8.5 11h7"/>',
    sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    bolt: '<path d="M13.5 2.5L5.5 13.5h6l-1 8 8-11h-6z"/>',
    dagger: '<path d="M19.5 4.5l-1.6 6.1-7.7 7.7-4.5-4.5 7.7-7.7z"/><path d="M4.5 19.5l3-3M6.2 12.2l5.6 5.6"/>'
  };

  /* ---------- State ---------- */
  var S = { d1: "sky", d2: "place", d3: "lineup", d4: "lobby", pg: "title", show: "all", lz: "close" };
  var KEYS = ["d1", "d2", "d3", "d4", "pg"];
  var VALID = { d1: ["sky", "marquee", "ground", "beside", "corner", "night"], d2: ["place", "console", "page", "side", "drop", "strip"], d3: ["panel", "lineup", "roll", "app", "preview", "seats"], d4: ["lobby", "who", "chip", "screen", "banner", "card"], pg: ["title", "signin", "setup", "pick", "invite"] };
  var ADDR = "http://192.168.1.42:3299";
  var CH = [
    { f: "Borin", n: "Borin Stoneguard", l: "Dwarf Fighter 7", hp: 67, ac: 17, spd: 30, c: "var(--cyan)", e: "shield", st: "dev", who: "On a player's device" },
    { f: "Mirena", n: "Mirena Dawnbright", l: "Human Cleric 7", hp: 52, ac: 16, spd: 30, c: "var(--hp)", e: "sun", on: 1, st: "open", who: "Open to claim" },
    { f: "Lyra", n: "Lyra Emberwise", l: "Elf Wizard 7", hp: 44, ac: 12, spd: 30, c: "var(--magenta)", e: "bolt", taken: 1, st: "dev", who: "On a player's device" },
    { f: "Tamsin", n: "Tamsin Reed", l: "Halfling Rogue 6", hp: 39, ac: 15, spd: 30, c: "var(--violet)", e: "dagger", st: "table", who: "At the table" }
  ];
  /* The player's pick: Borin and Lyra are claimed elsewhere in this moment. */
  var PICK = [
    Object.assign({}, CH[0], { taken: 1, on: 0 }),
    Object.assign({}, CH[1], { taken: 0, on: 1 }),
    Object.assign({}, CH[2], { taken: 0, on: 0 }),
    Object.assign({}, CH[3], { taken: 0, on: 0 })
  ];
  var STATUS = "1 of 4 characters are claimed.";

  /* ---------- Parts ---------- */
  function scene(o) {
    o = o || {};
    var v = "--hz:" + (o.hz || "64%") + ";--sd:" + (o.sd || "432px") + ";--sx:" + (o.sx || "50%") + ";--gp:" + (o.gp || "340px") + ";--mh:" + (o.mh || "104px") + ";--sv:" + (o.sv || "0.72");
    return '<div class="b-scene" style="' + v + '"><i class="b-stars far"></i><i class="b-stars"></i><div class="b-skyband">' + (o.noSun ? "" : '<i class="b-sun"></i>') + '</div><i class="b-mtn' + (o.mtn ? " " + o.mtn : "") + '"></i><i class="b-hzl"></i><i class="b-grid"></i>' + (o.pool ? '<i class="b-pool"></i>' : "") + '<i class="b-vig"></i>' + (o.dim ? '<i class="b-dimmer"></i>' : "") + "</div>";
  }
  function mark(px, top, style) { return '<div class="b-markwrap' + (style && style.indexOf("flex-start") >= 0 ? " l" : "") + '" style="top:' + top + "px;" + (style || "") + '"><span class="b-mark" role="img" aria-label="OzyVTT" style="--mk:' + px + 'px"><span class="o">OZY</span><span class="v">vtt</span></span></div>'; }
  function theme() { return '<div class="b-theme"><span class="on">Dusk</span><span>Dawn</span></div>'; }
  function frameL(inner) { return '<div class="frame" style="width:1280px;height:800px"><div class="ap" style="display:block;position:relative">' + inner + "</div></div>"; }
  function frameP(inner) { return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone" style="display:block;position:relative"><div class="b-ph">' + inner + "</div></div></div>"; }
  function face(c, size) { return '<span class="b-face" style="--fc:' + c.c + ";--fs:" + (size || 48) + 'px">' + svg(EMB[c.e]) + "</span>"; }
  function cup(t, cls) { return '<span class="b-cup' + (cls ? " " + cls : "") + '">' + t + "</span>"; }
  function gmBtn(cls) { return '<span class="b-gm' + (cls ? " " + cls : "") + '">Enter as GM</span>'; }
  function base(t, ic) { return '<span class="b-base">' + (ic ? IC[ic] : "") + t + "</span>"; }
  function lamp(st) { return '<i class="b-lamp' + (st === "dev" ? " on" : st === "table" ? " gold" : "") + '"></i>'; }
  function status(lit, text) { return '<div class="b-status">' + '<i class="b-lamp' + (lit ? " on" : "") + '"></i>' + (text || STATUS) + "</div>"; }
  function newChars() { return base("Make a new character", "plus") + base("Import from D&amp;D Beyond (PDF)", "file"); }

  function topPlayer() {
    var nav = '<nav class="ap-nav" aria-hidden="true"><span class="on" data-seat>Table</span><span>Sheet</span><span>Codex</span></nav>';
    return '<header class="ap-bar"><span class="wm"><span class="wm-ozy">OZY</span><span class="wm-vtt">vtt</span></span>' + nav + '<div class="ap-end"><span class="ico">' + IC.search + '</span><span class="me-btn"><span class="face lg" style="border-color:var(--line-raised);color:var(--text-muted)">?</span>' + IC.down + "</span></div></header>";
  }
  function topGM(extra, open) {
    var nav = '<nav class="ap-nav" aria-hidden="true"><span class="on" data-seat>Play</span><span>Prep</span><span>Codex</span><span>Compendium</span></nav>';
    return '<header class="ap-bar"><span class="wm"><span class="wm-ozy">OZY</span><span class="wm-vtt">vtt</span></span>' + nav + '<span class="live-chip"><i class="lamp off"></i>No encounter live' + IC.down + "</span>" + (extra || "") + '<div class="ap-end"><span class="ico">' + IC.search + '</span><span class="me-btn' + (open ? " is-open" : "") + '"><span class="face lg gm">GM</span><span class="online">2</span>' + IC.down + "</span></div></header>";
  }
  function tabs(list, on) { return '<nav class="ap-bottom five" aria-hidden="true">' + list.map(function (t) { return '<span class="btab' + (t[0] === on ? " on" : "") + '">' + IC[t[1]] + t[0] + "</span>"; }).join("") + "</nav>"; }
  function tabsPlayer() { return tabs([["Table", "play"], ["Sheet", "sheet"], ["Codex", "codex"], ["Log", "log"], ["More", "dots"]], "Table"); }
  function tabsGM(on) { return tabs([["Play", "play"], ["Prep", "prep"], ["Codex", "codex"], ["Compendium", "book"], ["More", "dots"]], on || "Play"); }
  function pbar(t, end) { return '<header class="pbar"><h1>' + t + '</h1><div class="end">' + (end || "") + "</div></header>"; }

  /* ---------- 1. Title screen ---------- */
  function pairRow(top) { return '<div class="b-row2" style="position:absolute;left:0;right:0;top:' + top + 'px;z-index:2">' + cup("Join as a player", "b-big") + gmBtn("b-big") + "</div>"; }
  function pairCol(top, side) { side = side || 40; return '<div class="b-col2" style="position:absolute;left:' + side + 'px;right:' + side + 'px;top:' + top + 'px;z-index:2">' + cup("Join as a player", "b-big") + gmBtn("b-big") + "</div>"; }
  function title(phone) {
    var v = S.d1, I;
    if (!phone) {
      if (v === "sky") I = scene({ sd: "300px" }) + mark(124, 64) + '<div class="b-row2" style="position:absolute;left:0;right:0;top:586px;z-index:2">' + cup("Join as a player", "b-big") + gmBtn("b-big") + "</div>";
      else if (v === "marquee") I = scene({ hz: "66%", sd: "400px" }) + '<div class="b-marquee"><span class="b-mark" role="img" aria-label="OzyVTT" style="--mk:100px"><span class="o">OZY</span><span class="v">vtt</span></span></div><div class="b-row2" style="position:absolute;left:0;right:0;top:604px;z-index:2">' + cup("Join as a player", "b-big") + gmBtn("b-big") + "</div>";
      else if (v === "ground") I = scene({ hz: "50%", sd: "380px", gp: "560px", pool: 1 }) + mark(104, 446) + '<div class="b-row2" style="position:absolute;left:0;right:0;top:632px;z-index:2">' + cup("Join as a player", "b-big") + gmBtn("b-big") + "</div>";
      else if (v === "beside") I = scene({ sx: "68%", sd: "440px", mtn: "right" }) + '<i class="b-shade"></i>' + mark(100, 118, "justify-content:flex-start;padding-left:92px") + '<div class="b-colL" style="left:96px;top:292px;width:300px">' + cup("Join as a player", "b-big") + gmBtn("b-big") + "</div>";
      else if (v === "corner") I = scene({ hz: "66%", sd: "540px" }) + mark(46, 26, "justify-content:flex-start;padding-left:34px") + pairRow(622);
      else I = scene({ hz: "62%", sd: "760px", sv: "0.13" }) + mark(132, 186) + pairRow(594);
      return frameL(I + theme());
    }
    if (v === "sky") I = scene({ sd: "240px", mh: "72px" }) + mark(62, 176) + '<div class="b-col2" style="position:absolute;left:40px;right:40px;top:588px;z-index:2">' + cup("Join as a player", "b-big") + gmBtn("b-big") + "</div>";
    else if (v === "marquee") I = scene({ hz: "64%", sd: "260px", mh: "72px" }) + '<div class="b-marquee" style="--mq:128px"><span class="b-mark" role="img" aria-label="OzyVTT" style="--mk:54px"><span class="o">OZY</span><span class="v">vtt</span></span></div><div class="b-col2" style="position:absolute;left:40px;right:40px;top:588px;z-index:2">' + cup("Join as a player", "b-big") + gmBtn("b-big") + "</div>";
    else if (v === "ground") I = scene({ hz: "44%", sd: "250px", gp: "560px", mh: "72px", pool: 1 }) + mark(58, 430) + '<div class="b-col2" style="position:absolute;left:40px;right:40px;top:560px;z-index:2">' + cup("Join as a player", "b-big") + gmBtn("b-big") + "</div>";
    else if (v === "beside") I = scene({ hz: "62%", sx: "76%", sd: "300px", mh: "72px", mtn: "right" }) + '<i class="b-shade bph"></i>' + mark(58, 92, "justify-content:flex-start;padding-left:22px") + '<div class="b-col2" style="position:absolute;left:24px;right:24px;top:600px;z-index:2">' + cup("Join as a player", "b-big") + gmBtn("b-big") + "</div>";
    else if (v === "corner") I = scene({ hz: "60%", sd: "330px", mh: "72px" }) + mark(34, 22, "justify-content:flex-start;padding-left:18px") + pairCol(596);
    else I = scene({ hz: "58%", sd: "480px", sv: "0.15", mh: "64px" }) + mark(66, 290) + pairCol(588);
    return frameP(I + theme());
  }

  /* ---------- 2. GM sign-in ---------- */
  function words(setup) {
    return setup
      ? { t: "Set up the GM password", p: "Use at least 12 characters. Set it on this computer, the one that runs OzyVTT, before players join.", dots: "••••••••••••••", cta: "Set GM password", keep: "", forgot: "" }
      : { t: "GM sign-in", p: "Enter the GM password to run the table.", dots: "••••••••••", cta: "Enter table", keep: '<span class="b-sw on"><i></i>Keep me signed in on this computer</span>', forgot: '<span class="b-link">Forgot the password</span>' };
  }
  function field(w) { return '<div class="b-field focus"><span class="dots">' + w.dots + '</span><span class="show">Show</span></div>'; }
  function signin(phone, setup) {
    var v = S.d2, w = words(setup), I;
    if (!phone) {
      if (v === "place") I = scene({ hz: "56%", sd: "260px" }) + mark(100, 52) + '<div class="b-plate gm" style="left:396px;width:488px;top:474px"><div class="in"><h2>' + w.t + "</h2><p>" + w.p + "</p>" + field(w) + w.keep + '<div class="b-acts">' + cup(w.cta) + '<span class="b-ghost">Back</span><span class="grow"></span>' + w.forgot + "</div></div></div>";
      else if (v === "console") I = scene({ hz: "56%", sd: "260px" }) + mark(100, 52) + '<div class="b-term" style="left:350px;width:580px;top:462px"><div class="in"><div class="top"><span>OZYVTT · GAME MASTER</span><span>' + (setup ? "FIRST RUN" : "SIGN IN") + "</span></div><h2 style=\"font-size:36px\">" + (setup ? "CHOOSE A GM PASSWORD" : "ENTER THE GM PASSWORD") + '</h2><div class="prompt"><span>&gt;</span><span>' + w.dots.replace(/•/g, "*") + '</span><i class="cur"></i><span class="show">[SHOW]</span></div>' + (setup ? '<div class="opt" style="color:var(--term-dim)">AT LEAST 12 CHARACTERS</div>' : '<div class="opt"><span class="box">×</span>KEEP ME SIGNED IN ON THIS COMPUTER</div>') + '<div class="go"><span class="b-tbtn">' + w.cta.toUpperCase() + ' ▸</span><div class="b-keys"><span><b>ESC</b> BACK</span>' + (setup ? "" : "<span><b>?</b> FORGOT THE PASSWORD</span>") + "</div></div></div></div>";
      else if (v === "page") I = '<i class="b-pagebg"></i><div class="b-band" style="height:236px">' + scene({ hz: "100%", sd: "250px", mh: "70px" }) + "</div>" + mark(70, 274) + '<div class="b-open" style="left:430px;width:420px;top:396px"><h1>' + w.t + "</h1><p>" + w.p + "</p>" + field(w) + w.keep + cup(w.cta) + '<div class="b-acts"><span class="b-ghost" style="padding-left:0">Back</span><span class="grow"></span>' + w.forgot + "</div></div>";
      else if (v === "side") I = scene({ sx: "32%", sd: "320px", mtn: "left" }) + mark(104, 76, "right:460px") + '<div class="b-side" style="width:460px"><div class="in"><span class="b-label">Game Master</span><h2>' + w.t + "</h2><p>" + w.p + "</p>" + field(w) + w.keep + cup(w.cta) + '<div class="b-acts"><span class="b-ghost" style="padding-left:0">Back</span><span class="grow"></span>' + w.forgot + "</div></div></div>";
      else if (v === "drop") I = scene({ hz: "52%", sd: "250px" }) + mark(100, 44) + '<div class="b-row2" style="position:absolute;left:0;right:0;top:440px;z-index:2;align-items:flex-start"><span class="b-cup b-big" style="opacity:.42">Join as a player</span><div style="position:relative"><span class="b-gm b-big open">Enter as GM ' + IC.down + '</span><div class="b-plate drop" style="left:0;top:100%;width:470px"><div class="in"><p>' + w.p + "</p>" + field(w) + w.keep + '<div class="b-acts">' + cup(w.cta) + '<span class="b-ghost">Cancel</span><span class="grow"></span>' + w.forgot + "</div></div></div></div></div>";
      else I = scene({ hz: "58%", sd: "300px" }) + mark(108, 50) + '<div class="b-strip" style="top:464px"><div class="row"><h2>' + w.t + "</h2>" + field(w) + cup(w.cta) + '<span class="b-ghost">Back</span></div><div class="row2">' + (setup ? '<span class="note">' + w.p + "</span>" : w.keep + '<span class="grow"></span>' + w.forgot) + "</div></div>";
      return frameL(I + (v === "side" ? "" : theme()));
    }
    if (v === "place") I = scene({ hz: "48%", sd: "200px", mh: "64px" }) + mark(54, 104) + '<div class="b-plate gm" style="left:14px;right:14px;top:436px"><div class="in" style="padding:18px 18px 16px 22px"><h2>' + w.t + "</h2><p>" + w.p + "</p>" + field(w) + w.keep + cup(w.cta) + '<div class="b-acts"><span class="b-ghost" style="padding-left:0">Back</span><span class="grow"></span>' + w.forgot + "</div></div></div>";
    else if (v === "console") I = scene({ hz: "46%", sd: "200px", mh: "64px" }) + mark(54, 100) + '<div class="b-term" style="left:12px;right:12px;top:420px"><div class="in" style="padding:14px 16px 16px"><div class="top"><span>GAME MASTER</span><span>' + (setup ? "FIRST RUN" : "SIGN IN") + "</span></div><h2 style=\"font-size:30px\">" + (setup ? "CHOOSE A GM PASSWORD" : "ENTER THE GM PASSWORD") + '</h2><div class="prompt" style="font-size:26px;height:50px"><span>&gt;</span><span>' + w.dots.replace(/•/g, "*") + '</span><i class="cur" style="height:24px;width:12px"></i><span class="show">[SHOW]</span></div>' + (setup ? '<div class="opt" style="color:var(--term-dim)">AT LEAST 12 CHARACTERS</div>' : '<div class="opt" style="font-size:20px"><span class="box">×</span>KEEP ME SIGNED IN</div>') + '<span class="b-tbtn">' + w.cta.toUpperCase() + ' ▸</span><div class="b-keys"><span><b>BACK</b></span>' + (setup ? "" : "<span><b>FORGOT THE PASSWORD</b></span>") + "</div></div></div>";
    else if (v === "page") I = '<i class="b-pagebg"></i><div class="b-band" style="height:190px">' + scene({ hz: "100%", sd: "200px", mh: "56px" }) + "</div>" + mark(50, 222) + '<div class="b-open" style="left:22px;right:22px;top:318px"><h1 style="font-size:24px">' + w.t + "</h1><p>" + w.p + "</p>" + field(w) + w.keep + cup(w.cta) + '<div class="b-acts"><span class="b-ghost" style="padding-left:0">Back</span><span class="grow"></span>' + w.forgot + "</div></div>";
    else if (v === "side") I = scene({ hz: "44%", sd: "200px", mh: "64px" }) + mark(54, 96) + '<div class="b-sheet"><div class="grab"></div><div class="in"><span class="b-label">Game Master</span><h2>' + w.t + "</h2><p>" + w.p + "</p>" + field(w) + w.keep + cup(w.cta) + '<div class="b-acts"><span class="b-ghost" style="padding-left:0">Back</span><span class="grow"></span>' + w.forgot + "</div></div></div>";
    else if (v === "drop") I = scene({ hz: "42%", sd: "170px", mh: "56px" }) + mark(52, 84) + '<div class="b-col2" style="position:absolute;left:28px;right:28px;top:372px;z-index:2"><span class="b-cup b-big" style="opacity:.42">Join as a player</span><div style="position:relative"><span class="b-gm b-big open" style="width:100%">Enter as GM ' + IC.down + '</span><div class="b-plate drop" style="left:0;right:0;top:100%"><div class="in" style="padding:16px 16px 14px 20px"><p>' + w.p + "</p>" + field(w) + w.keep + cup(w.cta, "b-wide") + '<div class="b-acts"><span class="b-ghost" style="padding-left:0">Cancel</span><span class="grow"></span>' + w.forgot + "</div></div></div></div></div>";
    else I = scene({ hz: "50%", sd: "200px", mh: "64px" }) + mark(54, 110) + '<div class="b-strip bph" style="top:422px"><div class="row"><h2>' + w.t + "</h2>" + field(w) + cup(w.cta, "b-wide") + '</div><div class="row2">' + (setup ? '<span class="note">' + w.p + "</span>" : w.keep) + '</div><div class="row2"><span class="b-ghost" style="padding-left:0">Back</span><span class="grow"></span>' + w.forgot + "</div></div>";
    return frameP(I + (v === "side" || v === "place" || v === "console" || v === "drop" ? "" : theme()));
  }

  /* ---------- 3. Picking a character ---------- */
  function mini(c) { return '<div class="b-mini"><span><small>AC</small><span class="b-num">' + c.ac + '</span></span><span><small>HP</small><span class="b-num hp">' + c.hp + "</span></span></div>"; }
  function prow(c) { return '<div class="b-prow' + (c.on ? " on" : "") + (c.taken ? " taken" : "") + '">' + face(c, 48) + "<div><b>" + c.n + '</b><span class="cl">' + c.l + "</span></div>" + mini(c) + (c.taken ? '<span class="b-tag">Claimed</span>' : '<span class="b-radio' + (c.on ? " on" : "") + '"></span>') + "</div>"; }
  function lcard(c) { return '<div class="b-lcard' + (c.on ? " on" : "") + (c.taken ? " taken" : "") + '" style="--fc:' + c.c + '"><div class="pt">' + svg(EMB[c.e]) + (c.taken ? '<span class="b-tag">Claimed</span>' : "") + '</div><div class="tx"><b>' + c.n + "</b><span>" + c.l + '</span></div><div class="pl"><div><small>AC</small><span class="b-num">' + c.ac + '</span></div><div><small>HP</small><span class="b-num hp">' + c.hp + '</span></div><div><small>Speed</small><span class="b-num">' + c.spd + "</span></div></div></div>"; }
  function rrow(c, phone) {
    var arrow = IC.arrow.replace("<svg", '<svg style="width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2"');
    var who = "<div><b>" + c.n + '</b><span class="cl">' + c.l + (phone ? " · AC " + c.ac + " · HP " + c.hp : "") + "</span></div>";
    var end = c.taken ? '<span class="b-tag">Claimed</span>' : '<span class="play">' + (phone ? "Play" : "Play as " + c.f) + " " + arrow + "</span>";
    return '<div class="b-rrow' + (c.taken ? " taken" : "") + '"' + (phone ? ' style="grid-template-columns:auto minmax(0,1fr) auto"' : "") + ">" + face(c, phone ? 44 : 48) + who + (phone ? "" : mini(c)) + end + "</div>";
  }
  function band(c, phone) {
    var radio = c.taken ? "<span></span>" : '<span class="b-radio' + (c.on ? " on" : "") + '"></span>';
    var plate = '<div class="plate"><div><small>AC</small><span class="b-num">' + c.ac + '</span></div><div><small>Hit points</small><span class="b-num hp">' + c.hp + '</span></div><div><small>Speed</small><span class="b-num">' + c.spd + "</span></div></div>";
    return '<div class="b-bd' + (c.on ? " on" : "") + (c.taken ? " taken" : "") + '">' + face(c, phone ? 52 : 64) + '<div class="id"><b>' + c.n + "</b><span>" + c.l + "</span>" + (c.taken ? '<span class="b-tag">Claimed</span>' : "") + "</div>" + (phone ? radio + plate : plate + radio) + "</div>";
  }
  function prowC(c) { return '<div class="b-prow' + (c.on ? " on" : "") + (c.taken ? " taken" : "") + '" style="grid-template-columns:auto minmax(0,1fr) auto">' + face(c, 44) + "<div><b>" + c.n + '</b><span class="cl">' + c.l + "</span></div>" + (c.taken ? '<span class="b-tag">Claimed</span>' : '<span class="b-radio' + (c.on ? " on" : "") + '"></span>') + "</div>"; }
  function hero(c, phone) {
    return '<div class="b-hero' + (phone ? " bph" : "") + '"><div class="b-port" style="--fc:' + c.c + '">' + svg(EMB[c.e]) + '</div><b class="nm">' + c.n + '</b><span class="cl">' + c.l + '</span><div class="b-hplate"><div><small>AC</small><span class="b-num">' + c.ac + '</span></div><div><small>Hit points</small><span class="b-num hp">' + c.hp + '</span></div><div><small>Speed</small><span class="b-num">' + c.spd + "</span></div></div>" + '<div class="b-status"><i class="b-lamp"></i>Open to claim</div>' + (phone ? "" : cup("Play as " + c.f)) + "</div>";
  }
  function seat2(c, pos, small) { return '<div class="b-seat2' + (c.on ? " on" : "") + (c.taken ? " taken" : "") + (small ? " sm" : "") + '" style="' + pos + '">' + face(c, small ? 36 : 48) + "<div><b>" + (small ? c.f : c.n) + "</b>" + (small ? "" : '<span class="cl">' + c.l + "</span>") + (c.taken ? '<span class="b-tag">Claimed</span>' : "") + "</div></div>"; }
  function pick(phone) {
    var v = S.d3, I;
    var playCup = cup("Play as Mirena");
    if (!phone) {
      var C = '<div style="position:absolute;top:56px;left:0;right:0;bottom:0;overflow:hidden">';
      if (v === "panel") I = C + scene({ sx: "32%", sd: "340px", mtn: "left" }) + '<div class="b-ppanel" style="width:460px"><div class="hd"><h2>Pick your character</h2>' + status(true) + '</div><div><div class="b-plist">' + PICK.map(prow).join("") + '</div><div class="b-pmore">' + newChars() + '</div></div><div class="b-pfoot">' + playCup + "</div></div></div>";
      else if (v === "lineup") I = C + scene({ hz: "50%", sd: "300px" }) + '<div class="b-skyhead" style="top:30px"><h2>Pick your character</h2>' + status(true) + '</div><div class="b-lineup" style="top:300px">' + PICK.map(lcard).join("") + '</div><div class="b-glassbar">' + newChars() + '<span style="flex:1"></span>' + playCup + "</div></div>";
      else if (v === "roll") I = C + scene({ hz: "38%", sd: "230px" }) + '<div class="b-skyhead" style="top:28px"><h2>Pick your character</h2>' + status(true) + '</div><div class="b-roll" style="top:318px;width:640px">' + PICK.map(function (c) { return rrow(c, false); }).join("") + '<div class="b-row2" style="justify-content:flex-start;gap:14px;margin-top:6px">' + newChars() + "</div></div></div>";
      else if (v === "app") I = C + '<i class="b-apage"></i><div class="b-open" style="left:180px;right:180px;top:32px"><h1>Pick your character</h1>' + status(true) + '</div><div class="b-bands" style="left:180px;right:180px;top:124px">' + PICK.map(function (c) { return band(c, false); }).join("") + '</div><div class="b-afoot" style="padding:14px 180px">' + newChars() + '<span class="grow"></span>' + playCup + "</div></div>";
      else if (v === "preview") I = C + '<div style="position:absolute;left:400px;top:0;right:0;bottom:0;overflow:hidden">' + scene({ hz: "80%", noSun: 1, mh: "64px", mtn: "right" }) + '<i class="b-tint" style="--fc:' + PICK[1].c + '"></i>' + hero(PICK[1], false) + '</div><div class="b-plistL" style="width:400px"><div class="hd"><h2>Pick your character</h2>' + status(true) + '</div><div class="b-plist">' + PICK.map(prowC).join("") + '<div class="b-pmore" style="padding:12px 0 0">' + newChars() + "</div></div></div></div>";
      else I = C + scene({ hz: "36%", sd: "210px" }) + '<div class="b-skyhead" style="top:22px"><h2>Pick your character</h2>' + status(true) + '</div><i class="b-table" style="left:390px;top:402px;width:500px;height:150px"><i class="b-tsun"></i></i>' + seat2(PICK[0], "left:520px;top:300px;width:240px") + seat2(PICK[1], "left:120px;top:440px;width:250px") + seat2(PICK[2], "left:910px;top:440px;width:250px") + seat2(PICK[3], "left:520px;top:576px;width:240px") + '<div class="b-glassbar">' + newChars() + '<span style="flex:1"></span>' + playCup + "</div></div>";
      return frameL(topPlayer() + I);
    }
    var G = '<div style="position:absolute;inset:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto auto">';
    if (v === "panel") I = G + pbar("Pick your character") + '<div style="position:relative;overflow:hidden;display:grid;grid-template-rows:118px auto">' + '<div style="position:relative;overflow:hidden">' + scene({ hz: "100%", sd: "150px", mh: "40px" }) + '</div><div style="display:grid;align-content:start;gap:2px;padding:12px 12px 0">' + '<div style="padding:0 4px 6px">' + status(true) + "</div>" + PICK.map(prow).join("") + '<div class="b-pmore" style="padding:8px 0 0">' + newChars() + '</div></div></div><div style="padding:12px 14px;border-top:1px solid var(--line);background:var(--bg)">' + cup("Play as Mirena", "b-wide") + "</div>" + tabsPlayer() + "</div>";
    else if (v === "lineup") I = G + pbar("Pick your character") + '<div style="position:relative;overflow:hidden">' + scene({ hz: "42%", sd: "200px", mh: "56px" }) + '<div class="b-skyhead" style="top:18px">' + status(true) + '</div><div class="b-lineup" style="top:176px">' + [PICK[1], PICK[2], PICK[3], PICK[0]].map(lcard).join("") + '</div></div><div style="display:grid;gap:8px;padding:10px 14px 12px;border-top:1px solid var(--line-strong);background:var(--glass-bg)"><div style="display:flex;flex-wrap:wrap;gap:0 12px">' + newChars() + "</div>" + cup("Play as Mirena", "b-wide") + "</div>" + tabsPlayer() + "</div>";
    else if (v === "roll") I = G + pbar("Pick your character") + '<div style="position:relative;overflow:hidden">' + scene({ hz: "26%", sd: "150px", mh: "40px" }) + '<div class="b-skyhead" style="top:16px">' + status(true) + '</div><div class="b-roll" style="top:196px;left:12px;right:12px;transform:none">' + PICK.map(function (c) { return rrow(c, true); }).join("") + '</div></div><div style="display:flex;flex-wrap:wrap;gap:0 12px;padding:6px 14px;border-top:1px solid var(--line);background:var(--bg)">' + newChars() + "</div>" + tabsPlayer() + "</div>";
    else if (v === "app") I = G + pbar("Pick your character") + '<div style="position:relative;overflow:hidden;background:var(--bg)"><div class="b-bands" style="left:12px;right:12px;top:12px;gap:8px">' + '<div style="padding:0 4px">' + status(true) + "</div>" + PICK.map(function (c) { return band(c, true); }).join("") + '<div style="display:flex;flex-wrap:wrap;gap:0 12px">' + newChars() + '</div></div></div><div style="padding:12px 14px;border-top:1px solid var(--line);background:var(--bg)">' + cup("Play as Mirena", "b-wide") + "</div>" + tabsPlayer() + "</div>";
    else if (v === "preview") I = G + pbar("Pick your character") + '<div style="position:relative;overflow:hidden">' + scene({ hz: "84%", noSun: 1, mh: "48px" }) + '<i class="b-tint" style="--fc:' + PICK[1].c + '"></i><div class="b-faces">' + PICK.map(function (c) { return '<div class="' + (c.on ? "on" : "") + (c.taken ? " taken" : "") + '">' + face(c, 56) + "<span>" + c.f + "</span></div>"; }).join("") + "</div>" + hero(PICK[1], true) + '</div><div style="padding:12px 14px;border-top:1px solid var(--line);background:var(--bg)">' + cup("Play as Mirena", "b-wide") + "</div>" + tabsPlayer() + "</div>";
    else I = G + pbar("Pick your character") + '<div style="position:relative;overflow:hidden">' + scene({ hz: "22%", sd: "130px", mh: "36px" }) + '<div class="b-skyhead" style="top:14px">' + status(true) + '</div><i class="b-table" style="left:122px;top:318px;width:146px;height:76px"><i class="b-tsun" style="width:40px;height:20px"></i></i>' + seat2(PICK[0], "left:95px;top:214px;width:200px") + seat2(PICK[1], "left:8px;top:322px;width:108px", true) + seat2(PICK[2], "left:274px;top:322px;width:108px", true) + seat2(PICK[3], "left:95px;top:430px;width:200px") + '<div style="position:absolute;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;gap:0 12px;padding:6px 14px;background:var(--glass-bg);border-top:1px solid var(--line)">' + newChars() + '</div></div><div style="padding:12px 14px;border-top:1px solid var(--line);background:var(--bg)">' + cup("Play as Mirena", "b-wide") + "</div>" + tabsPlayer() + "</div>";
    return frameP(I);
  }

  /* ---------- 4. Inviting players ---------- */
  function qr(size) {
    var n = 25, seed = 7, cells = "";
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    function finder(x, y) { return function (i, j) { var dx = i - x, dy = j - y; if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return null; return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4); }; }
    var fs = [finder(0, 0), finder(18, 0), finder(0, 18)];
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
      var on = null;
      for (var k = 0; k < 3; k++) { var r = fs[k](i, j); if (r !== null) on = r; }
      if (on === null) { var nearF = (i < 8 && j < 8) || (i > 16 && j < 8) || (i < 8 && j > 16); on = nearF ? false : rnd() > 0.52; }
      cells += "<i" + (on ? ' class="k"' : "") + "></i>";
    }
    return '<div class="b-qr" style="--qr:' + size + 'px">' + cells + "</div>";
  }
  function copyBtn() { return base("Copy", "copy"); }
  function seat(c) { return '<div class="b-seat">' + face(c, 40) + "<div><b>" + c.n + '</b><span class="cl">' + c.l + '</span></div><span class="st' + (c.st === "open" ? "" : " here") + '">' + lamp(c.st) + c.who + "</span></div>"; }
  var HERE = "2 of 4 claimed";
  function emptyTable(phone) {
    if (phone) return '<div style="position:absolute;inset:0;background:radial-gradient(70% 50% at 50% 40%,var(--s1),var(--bg))"></div>';
    return '<i class="b-tableempty"></i><div style="position:absolute;left:0;right:0;top:330px;display:grid;justify-items:center;gap:14px;text-align:center"><span class="b-label">No map loaded yet</span><span class="b-cup">Prepare an encounter</span></div>';
  }
  function fcs(size) { return '<span class="b-fcs">' + CH.map(function (c) { return '<span class="' + (c.st === "open" ? "open" : "") + '">' + face(c, size) + "</span>"; }).join("") + "</span>"; }
  function paper(phone) {
    var steps = "<ol><li>Join the same Wi-Fi as the GM's computer.</li><li>Scan the code or open the address.</li><li>Pick your character.</li></ol>";
    return '<div class="b-paper' + (phone ? " bph" : "") + '">' + qr(phone ? 150 : 170) + '<div class="pt"><span class="b-mark" role="img" aria-label="OzyVTT" style="--mk:' + (phone ? 30 : 34) + 'px"><span class="o">OZY</span><span class="v">vtt</span></span><b>Join the table</b><span class="pa">' + ADDR + "</span>" + steps + "</div></div>";
  }
  function invite(phone) {
    var v = S.d4, I;
    if (!phone) {
      if (v === "lobby") I = topGM() + '<i class="b-tableempty"></i><div class="b-lobby" style="left:150px;right:150px;top:178px;grid-template-columns:auto minmax(0,1fr);gap:64px"><div style="display:grid;gap:14px;justify-items:start"><span class="b-label">Players join at</span>' + qr(220) + '<div class="b-addr" style="font-size:28px">' + ADDR + "</div>" + copyBtn() + '<p style="margin:0;max-width:240px;font-size:13.5px;color:var(--text-dim)">Phones on the same Wi-Fi as this computer open it, or scan the code.</p></div><div style="display:grid;gap:4px;align-content:start"><div style="display:flex;align-items:baseline;gap:14px;padding-bottom:10px;border-bottom:1px solid var(--line-strong)"><h2 class="b-h2">The party</h2><span class="b-num" style="color:var(--cyan-hi)">' + HERE + "</span></div>" + CH.map(seat).join("") + '<div style="display:flex;align-items:center;gap:14px;margin-top:22px"><span style="flex:1;font-size:13.5px;color:var(--text-dim)">The party fills in as players claim their characters.</span>' + cup("Prepare an encounter") + "</div></div></div>";
      else if (v === "who") I = topGM("", true) + emptyTable(false) + '<div class="ov menu lap" style="width:400px"><div class="who-row"><span class="face lg gm">GM</span><div><b>Game Master</b><span>Signed in on this computer</span></div></div><div class="mrow" style="border-top:0">' + IC.party + 'Who is here<span class="end"><span class="b-num" style="font-size:19px;color:var(--cyan-hi)">' + HERE + '</span></span></div><div style="display:grid;padding:0 16px 4px 46px">' + CH.map(function (c) { return '<div class="b-seat" style="min-height:44px;grid-template-columns:auto minmax(0,1fr) auto">' + face(c, 26) + "<b style=\"font-size:13.5px\">" + c.f + '</b><span class="st' + (c.st === "open" ? "" : " here") + '" style="font-size:12.5px">' + lamp(c.st) + c.who + "</span></div>"; }).join("") + '</div><div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px;align-items:center;margin:6px 16px 12px 46px;padding-top:12px;border-top:1px solid var(--line)">' + qr(92) + '<div style="display:grid;gap:6px;justify-items:start"><span class="b-label">Players join at</span><span class="b-addr" style="font-size:17px">' + ADDR + "</span>" + copyBtn() + '</div></div><div class="mrow">' + IC.screen + 'Table screen<span class="end"><span class="b-lamp on"></span>ON</span></div><div class="mrow">' + IC.gear + 'Settings</div><div class="mrow">' + IC.out + "Sign out</div></div>";
      else if (v === "chip") I = topGM('<span class="b-chip open" style="margin-left:8px">Join <span class="a">192.168.1.42:3299</span>' + IC.down + "</span>") + emptyTable(false) + '<div class="b-pop" style="left:574px;top:58px;width:330px"><div style="display:grid;gap:12px;justify-items:center;padding:20px 18px 14px">' + qr(210) + '<div class="b-addr" style="font-size:24px">' + ADDR + '</div><div style="display:flex;gap:10px">' + copyBtn() + '</div><p style="margin:0;font-size:13px;color:var(--text-dim);text-align:center">Phones on the same Wi-Fi open it, or scan the code. The chip goes when a fight starts.</p></div></div>';
      else if (v === "screen") I = '<div class="b-tv">' + scene({ hz: "46%", sd: "300px" }) + mark(70, 34) + '<div class="b-tvcard" style="left:150px;right:150px;top:410px">' + qr(220) + '<div style="display:grid;gap:14px;align-content:center"><span class="b-label">The Old road</span><h2>Join the table</h2><div class="b-addr big" style="font-size:40px">' + ADDR + '</div><p>Join the same Wi-Fi, scan the code or open the address, then pick your character.</p><div class="b-tvseats">' + CH.map(function (c) { return '<div class="' + (c.st === "open" ? "" : "here") + '">' + face(c, 44) + '<span style="display:inline-flex;align-items:center;gap:6px">' + lamp(c.st) + c.f + "</span></div>"; }).join("") + "</div></div></div></div>";
      else if (v === "banner") I = topGM() + emptyTable(false) + '<div class="b-banner" style="top:56px"><i class="b-lamp on"></i><span class="b-label">Players join at</span><span class="addr">' + ADDR + "</span>" + copyBtn() + base("Show the code", "qr") + '<span class="grow"></span>' + fcs(28) + '<span class="b-num" style="font-size:19px;color:var(--cyan-hi)">' + HERE + '</span><span class="b-x">' + IC.close + "</span></div>";
      else I = topGM() + emptyTable(false) + '<div class="b-dimmer" style="top:56px;z-index:3"></div><div class="b-plate" style="left:290px;width:700px;top:104px;z-index:4"><div class="in"><h2>Print a join card</h2><p>Leave it on the table. Phones on the same Wi-Fi scan it or open the address. If the address changes, print a new one.</p>' + paper(false) + '<div class="b-acts"><span class="b-ghost" style="padding-left:0">Cancel</span><span class="grow"></span>' + base("Copy the address", "copy") + cup("Print") + "</div></div></div>";
      return frameL(I);
    }
    if (v === "lobby") I = '<div style="position:absolute;inset:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto auto">' + pbar("Play") + '<div style="position:relative;overflow:hidden;display:grid;align-content:start;gap:12px;padding:16px 16px 0;background:radial-gradient(70% 50% at 50% 30%,var(--s1),var(--bg))"><div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px;align-items:center">' + qr(118) + '<div style="display:grid;gap:6px;justify-items:start"><span class="b-label">Players join at</span><span class="b-addr" style="font-size:18px">' + ADDR + "</span>" + copyBtn() + '</div></div><div style="display:flex;align-items:baseline;gap:12px;padding:10px 0 8px;border-bottom:1px solid var(--line-strong)"><h2 class="b-h2" style="font-size:19px">The party</h2><span class="b-num" style="font-size:19px;color:var(--cyan-hi)">' + HERE + "</span></div>" + CH.map(seat).join("") + '</div><div style="padding:12px 14px;border-top:1px solid var(--line);background:var(--bg)">' + cup("Prepare an encounter", "b-wide") + "</div>" + tabsGM() + "</div>";
    else if (v === "who") I = '<div style="position:absolute;inset:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto">' + pbar("Play") + '<div style="position:relative">' + emptyTable(true) + '</div>' + tabsGM("More") + '</div><div style="position:absolute;inset:0 0 64px 0;background:color-mix(in srgb,var(--void) 50%,transparent)"></div><div class="ov sheet onph above-tabs"><div class="grab"></div><div class="mrow" style="border-top:0">' + IC.party + 'Who is here<span class="end"><span class="b-num" style="font-size:19px;color:var(--cyan-hi)">' + HERE + '</span></span></div><div style="display:grid;padding:0 16px 4px 46px">' + CH.map(function (c) { return '<div class="b-seat" style="min-height:44px">' + face(c, 26) + '<b style="font-size:13.5px">' + c.f + '</b><span class="st' + (c.st === "open" ? "" : " here") + '" style="font-size:12.5px">' + lamp(c.st) + c.who + "</span></div>"; }).join("") + '</div><div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px;align-items:center;margin:4px 16px 10px 46px;padding-top:12px;border-top:1px solid var(--line)">' + qr(84) + '<div style="display:grid;gap:6px;justify-items:start"><span class="b-label">Players join at</span><span class="b-addr" style="font-size:18px">' + ADDR + "</span>" + copyBtn() + '</div></div><div class="mrow">' + IC.screen + 'Table screen<span class="end"><span class="b-lamp on"></span>ON</span></div><div class="mrow">' + IC.gear + "Settings</div></div>";
    else if (v === "chip") I = '<div style="position:absolute;inset:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto">' + pbar("Play", '<span class="b-chip open" style="height:44px">' + IC.qr + 'Join</span>') + '<div style="position:relative">' + emptyTable(true) + "</div>" + tabsGM() + '</div><div style="position:absolute;inset:48px 0 64px 0;background:color-mix(in srgb,var(--void) 50%,transparent)"></div><div class="b-pop" style="left:10px;right:10px;top:54px"><div style="display:grid;gap:12px;justify-items:center;padding:20px 16px 14px">' + qr(200) + '<div class="b-addr" style="font-size:24px">' + ADDR + "</div>" + copyBtn() + '<p style="margin:0;font-size:13px;color:var(--text-dim);text-align:center">Phones on the same Wi-Fi open it, or scan the code.</p></div></div>';
    else if (v === "screen") I = '<div style="position:absolute;inset:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto">' + pbar("Play") + '<div style="position:relative">' + emptyTable(true) + "</div>" + tabsGM("More") + '</div><div style="position:absolute;inset:0 0 64px 0;background:color-mix(in srgb,var(--void) 50%,transparent)"></div><div class="ov sheet onph above-tabs"><div class="grab"></div><div class="mrow" style="border-top:0">' + IC.screen + 'Table screen<span class="end"><span class="b-lamp on"></span>ON</span></div><div class="msub"><span style="color:var(--text);box-shadow:inset 3px 0 0 var(--cyan);padding-left:10px;border-top:0">Show the join code</span><span>Show the live encounter</span><span>Pause the table screen</span><span>Preview it here</span><span>Table screen settings</span></div><div class="mrow">' + IC.party + 'Who is here<span class="end"><span class="b-num" style="font-size:19px;color:var(--cyan-hi)">' + HERE + '</span></span></div><div class="mrow">' + IC.gear + "Settings</div></div>";
    else if (v === "banner") I = '<div style="position:absolute;inset:0;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto">' + pbar("Play") + '<div class="b-banner bph"><div class="r1"><i class="b-lamp on"></i><div style="display:grid;gap:4px;min-width:0"><span class="b-label">Players join at</span><span class="addr">' + ADDR + '</span></div><span class="b-x" style="margin-left:auto">' + IC.copy + '</span><span class="b-x">' + IC.qr + '</span></div><div class="r2">' + fcs(26) + '<span class="b-num" style="font-size:18px;color:var(--cyan-hi)">' + HERE + '</span><span class="grow"></span><span class="b-x">' + IC.close + '</span></div></div><div style="position:relative">' + emptyTable(true) + "</div>" + tabsGM() + "</div>";
    else I = '<div style="position:absolute;inset:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto">' + pbar("Play") + '<div style="position:relative">' + emptyTable(true) + "</div>" + tabsGM("More") + '</div><div style="position:absolute;inset:0 0 64px 0;background:color-mix(in srgb,var(--void) 50%,transparent)"></div><div class="ov sheet onph above-tabs"><div class="grab"></div><div style="display:grid;gap:12px;padding:12px 16px 14px"><h2 class="b-h2" style="font-size:19px">Join card</h2>' + paper(true) + '<p style="margin:0;font-size:13px;color:var(--text-dim)">Leave it on the table. If the address changes, print a new one.</p><div class="b-acts">' + base("Share", "copy") + '<span class="grow"></span>' + cup("Print") + "</div></div></div>";
    return frameP(I);
  }

  /* ---------- What each option means ---------- */
  var DEC = {
    d1: {
      n: 1, name: "Title screen", page: "title",
      what: "The first screen on a device that is not signed in (B1). In every option the logo has its own space and nothing sits behind it.",
      today: "The wordmark sits on the sun, so the script vtt is hard to read; Join as player and Enter as GM under it; the theme switch in the corner.",
      opts: {
        sky: ["Sky · chosen", "Today's title with the logo lifted into the night sky above a smaller setting sun, and the two buttons on the grid below the horizon. The closest to today."],
        marquee: ["Marquee", "The logo lit on a sign across the top, like an arcade cabinet's marquee, with the horizon line under it. The sunset below is whole, with nothing in front of it."],
        ground: ["Ground", "The sun alone in the sky. The logo and the buttons stand on the floor below the horizon, where the grid darkens behind them."],
        beside: ["Beside", "A poster: the logo and the buttons in a column at the left, the sun setting at the right. On a phone the logo sits at the top left and the buttons at the bottom."],
        corner: ["Corner", "The sunset is the whole picture: a large sun with nothing in front of it. The logo sits small at the top left, as it does in the app's bar, and the buttons stand on the grid."],
        night: ["After sunset", "The sun has nearly set: a bright sliver on the horizon between the mountains, a sky full of stars, and the logo large in the dark above the glow."]
      }
    },
    d2: {
      n: 2, name: "GM sign-in", page: "signin",
      what: "The GM's password at every sign-in (B2) and on first run (B3). Drawn on the Sky title; on any title the form takes the buttons' place.",
      today: "The buttons turn into a card over the scene: the title, a line, the field with Show, Keep me signed in, Enter table, Back and Forgot the password.",
      opts: {
        place: ["In place · chosen", "Today's card where the buttons were, below the horizon, in the Dialog pattern with the GM violet on its edge. The logo and the sun stay in view, a little smaller."],
        console: ["Console", "The form as a terminal: VT323 type, a lit prompt with a cursor, the option as a bracketed line and the keys listed beside the button. Enter table stays a real button for touch."],
        page: ["Own page", "The sunset folds into a band across the top and the form stands on a plain page under the logo. The calmest, and the clearest in Dawn."],
        side: ["Beside", "The scene moves left with the logo and the sun whole; the form stands in a panel at the right, the same panel a player picks from. On a phone it is a sheet from the bottom."],
        drop: ["Drop-down", "Enter as GM opens the form right under itself while Join as a player stays in view, so either way in is one tap away and nothing else moves."],
        strip: ["Horizon strip", "The form is one band of glass along the horizon: the field, Enter table and Back in a row, with Keep me signed in and Forgot the password under it."]
      }
    },
    d3: {
      n: 3, name: "Picking a character", page: "pick",
      what: "A player choosing who to play after joining, before a map is live (B6). With a map live the same choice sits in the table's panel (B7). Mirena is chosen; Borin is claimed on another device.",
      today: "The sunset at the left with the logo over the sun again, and a panel at the right: rows with a portrait, name, class and hit points and a checkbox, Make a new character, Import from D&D Beyond, and the Cup.",
      opts: {
        panel: ["Panel", "Today's layout drawn to the theme: the sun alone at the left; at the right a panel of rows you choose like radio buttons, each with AC and hit points, and Play as Mirena as the Cup."],
        lineup: ["Lineup · chosen", "The party stands before the sunset as tall cards with their emblem, name, class, AC, hit points and Speed. The chosen one steps forward on the horizon line. On a phone the cards scroll sideways."],
        roll: ["Roll call", "One row per character on the floor below the sun, each with its own Play as button, so picking is one tap and then the confirmation."],
        app: ["In the app", "No sunset: an ordinary page, each character as the roster's band (D), the chosen one on the cyan line, and Play as Mirena in the foot."],
        preview: ["Preview", "A short list at the left; the chosen character large at the right with their emblem, name, class, AC, hit points and Speed, over the grid floor. You see who you are picking."],
        seats: ["Seats", "The party sits around a table on the grid, one seat per character, a claimed seat dimmed. Choose an open seat, then Play as Mirena."]
      }
    },
    d4: {
      n: 4, name: "Inviting players", page: "invite",
      what: "How the GM tells players where to join (B8), before anything is live.",
      today: "PLAYERS JOIN AT, the address, Copy and Show QR code: on the empty table, in the roster, in Settings and in the phone's Join sheet, in three looks.",
      opts: {
        lobby: ["Lobby · chosen", "While no map is live the empty table is a lobby: the code and the address at the left, the party at the right filling in as characters are claimed, then Prepare an encounter."],
        who: ["Who is here", "The menu's Who is here (A) opens to the party with who plays each and, under them, the address with Copy and a small code. One place, on every page."],
        chip: ["Address chip", "A chip in the bar beside the live chip, Join and the address, until a fight starts. Choosing it opens the code under it. On a phone it is the Play header's icon."],
        screen: ["Table screen", "While no encounter runs, the table screen in the room shows Join the table with the code, the address and who is in. It needs the table screen to receive the join address, which it does not today."],
        banner: ["Banner", "A slim banner under the bar on Play: the address with Copy and Show the code, and the party's faces lighting up as characters are claimed. It closes itself when everyone is in or a fight starts."],
        card: ["Join card", "A card to print and leave on the table, with the code, the address and three steps. Who is here and Settings open it, and it shows the same card on a phone."]
      }
    }
  };
  function renderIdea() {
    $("#idea").innerHTML = ["d1", "d2", "d3", "d4"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    var A = window.AUDIT || {};
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML =
      '<div class="today-strip" ' + W + ">" + E + "Laptop</p>" + fig("landing", "Title screen") + fig("setup", "First run: set the GM password") + fig("signin", "GM sign-in") + fig("reset", "Forgot the password") + fig("pick", "Pick your character") + fig("confirm", "The claim confirmation") + fig("claimpanel", "Picking with a map live") + "</div>" +
      '<div class="today-strip" ' + W + ">" + E + "Phone</p>" + fig("landing-phone", "Title screen") + fig("signin-phone", "GM sign-in") + fig("pick-phone", "Pick your character") + fig("joinsheet-phone", "The GM's Join sheet") + "</div>";
    var R = [
      ["The logo has its own space", "The wordmark never sits on the sun or on a picture. It stands in clear sky, on the floor, on its marquee or on the page, so OZY and the script vtt both read.", "Today the script sits on the sun."],
      ["One logo", "The wordmark shows on the title screen and the sign-in. Once someone is in, the bar carries it and the scene shows the sun alone.", "Today the pick page repeats it over the sun."],
      ["The scene is the app's", "Every option uses today's sunset: the slatted sun setting on the horizon, the mountains either side with their cyan rim and the rolling grid. Dawn paints it as daybreak.", ""],
      ["The theme switch stays here", "Dusk and Dawn sit at the bottom right of the title, as now. Once signed in, the switch is in the menu (A).", ""],
      ["Forgot the password", "Opens today's reset steps as a Dialog: stop OzyVTT, delete the auth file, start it again. The words stay as they are.", ""],
      ["The entry", "Signing in keeps today's drive into the app (ADR-0045); reduced motion cuts straight to it.", ""],
      ["A claimed character is shown, not offered", "It carries a Claimed tag, is dimmed and cannot be chosen. A player sees only the characters the projection lists.", ""],
      ["Claiming confirms", "Play as Mirena asks once, in the Dialog pattern: Claim Mirena Dawnbright? with Cancel as a ghost and Claim as the Cup.", "Today the same question, with Cancel boxed."],
      ["New and imported characters", "Make a new character (only while the GM allows building) and Import from D&D Beyond (PDF) are Base line controls under the list.", ""],
      ["The builder's gate", "A player who opens the builder while it is off sees the theme's empty state: Making characters is off at this table. Ask the GM. and Back to the table.", ""],
      ["One way to invite", "The chosen invite is the only one: the roster drops its copy (D) and Settings links to it.", "Today it shows in four places in three looks."]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }

  /* ---------- Page ---------- */
  var DOFP = { title: "d1", signin: "d2", setup: "d2", pick: "d3", invite: "d4" };
  var PGNAME = { title: "anyone, signed out", signin: "the GM signing in", setup: "the GM, first run", pick: "a player who has just joined", invite: "the GM, before anything is live" };
  var RENDER = { title: title, signin: function (p) { return signin(p, false); }, setup: function (p) { return signin(p, true); }, pick: pick, invite: invite };
  function renderStage() {
    var tv = S.pg === "invite" && S.d4 === "screen";
    $("#cap-laptop").textContent = tv ? "Table screen · the TV in the room" : "Laptop · " + PGNAME[S.pg];
    $("#cap-phone").textContent = "Phone · " + PGNAME[S.pg];
    $("#v-laptop .fit").innerHTML = RENDER[S.pg](false) + '<i class="snap a"></i><i class="snap b"></i><i class="snap c"></i>';
    $("#v-phone .fit").innerHTML = RENDER[S.pg](true);
    fit();
  }
  /* On a phone the laptop frame has three sizes: Close up (readable, swiped sideways between three stops), Whole
     (all of it, small) and Turned (all of it on its side, for a phone held sideways with rotation locked). */
  var NARROW = window.matchMedia ? window.matchMedia("(max-width: 700px)") : null;
  var CLOSE = 0.72;
  function fit() {
    var narrow = !!(NARROW && NARROW.matches);
    $$(".fit").forEach(function (box) {
      var fr = box.querySelector(".frame");
      if (!fr) return;
      var fw = parseFloat(fr.style.width), fh = parseFloat(fr.style.height);
      var lap = box.parentElement.id === "lap-pan";
      var mode = lap && narrow ? S.lz : "whole";
      if (lap) box.parentElement.className = "pan" + (mode === "close" ? " close" : "");
      var W = box.parentElement.clientWidth;
      if (mode === "turned") {
        var kt = W / fh;
        fr.style.transform = "translateX(" + fh * kt + "px) rotate(90deg) scale(" + kt + ")";
        box.style.width = fh * kt + "px";
        box.style.height = fw * kt + "px";
        return;
      }
      var k = mode === "close" ? CLOSE : Math.min(1, W / fw);
      fr.style.transform = "scale(" + k + ")";
      box.style.width = fw * k + "px";
      box.style.height = fh * k + "px";
    });
    hint();
    $$(".ap-nav [data-seat]").forEach(function (el) {
      el.style.setProperty("--win-w", el.closest(".ap-bar").offsetWidth + "px");
      el.style.setProperty("--win-x", -el.offsetLeft + "px");
    });
  }
  var HINT = { close: "Swipe sideways for the rest of the laptop screen.", whole: "The whole laptop screen, shown small.", turned: "On its side: lock rotation and turn your phone to the left to read it." };
  function hint() {
    var h = $("#lz-hint");
    if (!h) return;
    $("#lz-text").textContent = HINT[S.lz];
    h.classList.toggle("no-dots", S.lz !== "close");
    var pan = $("#lap-pan"), max = pan.scrollWidth - pan.clientWidth;
    var i = max > 0 ? Math.round((pan.scrollLeft / max) * 2) : 0;
    $$("#lz-dots button").forEach(function (b, j) { b.classList.toggle("on", j === i); });
  }
  $("#lap-pan").addEventListener("scroll", function () { if (S.lz === "close") hint(); }, { passive: true });
  $$("#lz-dots button").forEach(function (b, j) {
    b.addEventListener("click", function () { var pan = $("#lap-pan"); pan.scrollTo({ left: ((pan.scrollWidth - pan.clientWidth) * j) / 2, behavior: "smooth" }); });
  });
  $$("#lz-seg button").forEach(function (b) {
    b.addEventListener("click", function () {
      S.lz = b.getAttribute("data-v");
      $$("#lz-seg button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      fit();
    });
  });

  var PAGES = [["title", "Title screen"], ["signin", "GM sign-in"], ["setup", "First run"], ["pick", "Pick a character"], ["invite", "Invite players"]];
  function centreChip(row) {
    var on = row.querySelector('[aria-pressed="true"]');
    if (on) row.scrollLeft = on.offsetLeft - row.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
  }
  function renderMbar() {
    var k = DOFP[S.pg], d = DEC[k];
    $("#mb-pages").innerHTML = PAGES.map(function (p) { return '<button type="button" data-pg="' + p[0] + '" aria-pressed="' + (S.pg === p[0]) + '">' + p[1] + "</button>"; }).join("");
    $("#mb-k").textContent = d.n;
    $("#mb-opts").setAttribute("aria-label", d.name);
    $("#mb-opts").innerHTML = VALID[k].map(function (v) { return '<button type="button" data-k="' + k + '" data-v="' + v + '" aria-pressed="' + (S[k] === v) + '">' + d.opts[v][0] + "</button>"; }).join("");
    centreChip($("#mb-pages"));
    centreChip($("#mb-opts"));
    var t = document.documentElement.getAttribute("data-theme");
    var eff = t === "light" || t === "dark" ? t : mq && mq.matches ? "light" : "dark";
    $("#mb-theme").textContent = eff === "light" ? "Dawn" : "Dusk";
  }
  $("#mbar").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    if (b.id === "mb-theme") {
      var t = document.documentElement.getAttribute("data-theme");
      var eff = t === "light" || t === "dark" ? t : mq && mq.matches ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", eff === "light" ? "dark" : "light");
      paintTheme();
      renderMbar();
      return;
    }
    if (b.dataset.pg) S.pg = b.dataset.pg;
    else if (b.dataset.k) S[b.dataset.k] = b.dataset.v;
    else return;
    sync();
    renderIdea();
    renderStage();
    renderMbar();
    writeHash();
  });

  var SEGS = { d1: "d1-seg", d2: "d2-seg", d3: "d3-seg", d4: "d4-seg", pg: "pg-seg", show: "view-seg" };
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
        if (DEC[k] && !(k === "d2" && S.pg === "setup")) S.pg = DEC[k].page;
        sync();
        if (k === "show") { fit(); return; }
        renderIdea();
        renderStage();
        renderMbar();
        writeHash();
      });
    });
  });

  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  function paintTheme() {
    var t = document.documentElement.getAttribute("data-theme");
    var eff = t === "light" || t === "dark" ? t : mq && mq.matches ? "light" : "dark";
    $$("#theme-seg button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.th === eff)); });
  }
  $$("#theme-seg button").forEach(function (b) {
    b.addEventListener("click", function () { document.documentElement.setAttribute("data-theme", b.dataset.th); paintTheme(); renderMbar(); });
  });
  if (mq && mq.addEventListener) mq.addEventListener("change", paintTheme);

  var lastW = 0;
  if (window.ResizeObserver) new ResizeObserver(function (entries) {
    var w = Math.round(entries[0].contentRect.width);
    if (w !== lastW) { lastW = w; fit(); }
  }).observe($("#stage"));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  window.addEventListener("hashchange", function () { readHash(); sync(); renderIdea(); renderStage(); renderMbar(); });
  if (NARROW && NARROW.addEventListener) NARROW.addEventListener("change", fit);

  readHash();
  sync();
  renderIdea();
  renderStatic();
  renderStage();
  renderMbar();
  paintTheme();
  // Close up opens on the middle of the laptop screen, where most of each page sits.
  if (NARROW && NARROW.matches) { var pan0 = $("#lap-pan"); pan0.scrollLeft = (pan0.scrollWidth - pan0.clientWidth) / 2; hint(); }
})();
