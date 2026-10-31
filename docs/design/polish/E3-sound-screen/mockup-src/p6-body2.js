
  /* =========================================================================
     Sound and the screen, round 1. The sound board is the Sound half of H's Table screen page; an encounter is E's
     workbench. Every part is a settled one; the options differ in where things sit.
     ========================================================================= */
  IC.music = svg('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>');
  IC.sparkle = svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>');
  IC.skip = svg('<path d="M6 5l9 7-9 7z"/><path d="M18 5v14"/>');
  IC.stop = svg('<rect x="6" y="6" width="12" height="12"/>');
  IC.shuffle = svg('<path d="M4 7h3l10 10h3M4 17h3l3-3M14 10l3-3h3M17 4l3 3-3 3M17 14l3 3-3 3"/>');
  IC.pencil = svg('<path d="M4 20l4-1 11-11-3-3L5 16z"/>');
  IC.trash = svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>');
  IC.scene = svg('<path d="M3 5h18v14H3z"/><path d="M3 15l5-5 4 4 3-3 6 6"/>');
  IC.upload = svg('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>');
  IC.select = svg('<path d="M6 4l12 8-6 1.5L9 19z"/>');
  IC.measure = svg('<path d="M3 15l12-12 6 6-12 12z"/><path d="M8 10l2 2M11 7l2 2M5 13l2 2"/>');
  IC.draw = svg('<path d="M4 20l4-1 11-11-3-3L5 16z"/>');
  IC.fog = svg('<path d="M4 9h16M4 13h12M4 17h16"/>');
  IC.walls = svg('<path d="M4 6h16v12H4zM4 12h16M10 6v6M14 12v6"/>');
  IC.light = svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>');
  IC.view = svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M11 8v6M8 11h6"/>');
  IC.copy = svg('<rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/>');

  /* ---------- The board as the GM left it: three tracks, three layers (one on), five effects ---------- */
  var MUS = [["Road at dusk", "3:42", 80, 1], ["Goblin drums", "2:58", 70, 0], ["Tavern reel", "4:10", 60, 0]];
  var AMB = [["Rain on leaves", "1:04", 50, 1], ["Campfire", "0:48", 60, 0], ["Wind in the pass", "1:12", 40, 0]];
  var FX = [["Door slam", 80], ["Thunder", 90], ["Wolf howl", 80], ["Sword clash", 70], ["Coins", 60]];
  // The library, by name: where each sound is on the board (m playlist, a ambience, e effects, or nowhere).
  var LIB = [["Bell toll", "0:06", ""], ["Campfire", "0:48", "a"], ["Coins", "0:02", "e"], ["Crowd murmur", "2:10", ""], ["Door slam", "0:02", "e"], ["Goblin drums", "2:58", "m"], ["Rain on leaves", "1:04", "a"], ["Road at dusk", "3:42", "m"], ["Sword clash", "0:02", "e"], ["Tavern reel", "4:10", "m"], ["Thunder", "0:05", "e"], ["Wind in the pass", "1:12", "a"], ["Wolf howl", "0:04", "e"]];
  var WHERE = { m: "In the playlist", a: "In the ambience", e: "In the effects" };
  var ENCS = [["Ambush on the old road", 1, "2 tracks · 1 ambient layer", 1], ["The ruined chapel", 0, "1 track · 2 ambient layers", 1], ["Rats in the goblin cave", 0, "", 0]];
  var LINE = "Music and sound play on the table screen only, never on players' devices.";

  /* ---------- Parts ---------- */
  function lvl(v, w) { return '<span class="w-lvl"' + (w ? ' style="width:' + w + 'px"' : "") + '><span class="t"><i style="width:' + v + '%"></i><b style="left:' + v + '%"></b></span><span>' + v + "</span></span>"; }
  function sw(on) { return '<span class="e-sw' + (on ? " on" : "") + '"><i></i></span>'; }
  function sico(n, st) { return '<span class="e-ico"' + (st ? ' style="' + st + '"' : "") + ">" + IC[n] + "</span>"; }
  function room(phone) { return '<span class="w-room"><i></i>' + (phone ? "Living room TV" : "Living room TV · sound on") + "</span>"; }
  function sec(title, ic, right, inner, hint, st, cls) { return '<div class="w-sec' + (cls || "") + '"' + (st ? ' style="' + st + '"' : "") + '><div class="w-h">' + (ic ? IC[ic] : "") + '<span class="e-eb">' + title + "</span>" + (right || "") + "</div>" + (hint ? '<p class="w-hint">' + hint + "</p>" : "") + inner + "</div>"; }
  function plus(t) { return S.s3 === "dialog" ? btn(t || "Add", "plus", "dim") : ""; }
  function musRow(m, compact) { return '<div class="w-row' + (m[3] ? " on" : "") + '"' + (compact ? ' style="grid-template-columns:36px minmax(0,1fr) 92px 34px"' : "") + '><span class="w-play">' + (m[3] ? IC.pause : IC.playtri) + "</span><span><b>" + m[0] + '</b><small><span class="n">' + m[1] + "</span>" + (m[3] ? " · Playing" : "") + "</small></span>" + lvl(m[2]) + '<span class="w-tools">' + (compact ? sico("dots") : sico("up") + sico("down") + sico("close")) + "</span></div>"; }
  function ambRow(a, compact) { return '<div class="w-row lay' + (a[3] ? " on" : "") + '"' + (compact ? ' style="grid-template-columns:40px minmax(0,1fr) 92px 34px"' : "") + ">" + sw(a[3]) + "<span><b>" + a[0] + "</b><small>" + (a[3] ? "On · loops" : "Off") + "</small></span>" + lvl(a[2]) + '<span class="w-tools">' + sico(compact ? "dots" : "close") + "</span></div>"; }
  function pads(sq, cols) { return '<div class="w-pads"' + (cols ? ' style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))"' : "") + ">" + FX.map(function (f, i) { return '<div class="w-pad' + (sq ? " sq" : "") + (i === 1 ? " fired" : "") + '"><b>' + IC.playtri + f[0] + "</b>" + lvl(f[1]) + "</div>"; }).join("") + "</div>"; }
  function musicSec(compact) { return sec("Music · 3", "music", '<span class="w-swl">' + sw(false) + "Shuffle</span>" + plus(), MUS.map(function (m) { return musRow(m, compact); }).join(""), compact ? "" : "One track at a time with a short crossfade. The playlist starts over at its end."); }
  function ambSec(compact, drop) { return sec("Ambience · 3", "vol", plus(), AMB.map(function (a) { return ambRow(a, compact); }).join(""), compact ? "" : "Layers loop together. Switch each one on or off.", drop ? "position:relative" : "", drop ? " w-drop" : ""); }
  function fxSec(sq, cols) { return sec("Effects · 5", "sparkle", plus(), pads(sq, cols), "Each plays once when pressed, over the music."); }

  /* ---------- 3. Putting a sound on the board: a library row ---------- */
  function libRow(l, i, opts) {
    opts = opts || {};
    var v = S.s3, nm = "<span><b>" + l[0] + '</b><small><span class="n">' + l[1] + "</span> · WAV" + (v !== "today" && v !== "chips" && l[2] ? " · " + WHERE[l[2]] : "") + "</small></span>", acts;
    if (v === "today") acts = [["m", "Music", "music", "In playlist"], ["a", "Ambience", "vol", "In ambience"], ["e", "Effect", "sparkle", "In effects"]].map(function (k) { var ic = opts.phone ? "" : k[2]; return l[2] === k[0] ? '<span class="e-btn ghost" style="color:var(--cyan-hi)' + (opts.phone ? ";padding:0 4px" : "") + '">' + (ic ? IC[ic] : "") + (opts.phone ? k[1] : k[3]) + "</span>" : btn(k[1], ic, opts.phone ? "dim" : ""); }).join("") + (opts.compact ? "" : sico("pencil") + sico("trash"));
    else if (v === "chips") acts = [["m", "Music"], ["a", "Ambience"], ["e", "Effect"]].map(function (k) { return '<span class="e-btn' + (l[2] === k[0] ? " on" : " dim") + '">' + (l[2] === k[0] ? IC.check : "") + k[1] + "</span>"; }).join("") + sico("dots");
    else if (v === "menu") acts = '<span class="e-btn' + (l[2] ? " dim" : "") + '">' + IC.plus + "Add</span>" + sico("dots");
    else if (v === "drag") acts = sico("dots");
    else acts = sico("dots");
    var grip = v === "drag" ? '<span class="w-grip"></span>' : "";
    return '<div class="w-row lib"' + (grip ? ' style="grid-template-columns:14px minmax(0,1fr) auto"' : "") + (opts.mark ? ' data-mark="1"' : "") + ">" + grip + nm + '<span class="w-tools" style="gap:6px">' + acts + "</span>" + (opts.menu ? libMenu(l) : "") + "</div>";
  }
  function libMenu(l) {
    return '<div class="w-menu" style="right:8px;top:46px"><div class="w-mh">Put ' + l[0] + " on the board</div>" + [["music", "Add to the playlist"], ["vol", "Add to the ambience"], ["sparkle", "Add as an effect"]].map(function (m) { return '<div class="w-mi">' + IC[m[0]] + m[1] + "</div>"; }).join("") + '<div class="w-sep"></div><div class="w-mi">' + IC.pencil + 'Rename</div><div class="w-mi danger">' + IC.trash + "Delete</div></div>";
  }
  function libList(n, opts) { opts = opts || {}; var list = LIB.slice(0, n || LIB.length); return list.map(function (l, i) { return libRow(l, i, { compact: opts.compact, phone: opts.phone, menu: opts.menuOn && l[0] === "Crowd murmur" }); }).join(""); }
  function libSec(n, opts) {
    opts = opts || {};
    var hint = S.s3 === "drag" ? "Drag a sound onto Music, Ambience or Effects. On a phone, hold it for the menu." : "Sounds you have the right to play: MP3, Ogg, WAV, M4A, AAC, WebM or FLAC, up to 50 MB each.";
    return sec("Library · 13", "", btn("Add sounds", "upload"), libList(n, opts), hint, "position:relative");
  }

  /* ---------- 4. An encounter's sound ---------- */
  function encRow(e, narrow) {
    return '<div class="w-enc"' + (narrow ? ' style="grid-template-columns:minmax(0,1fr)"' : "") + '><span><b>' + e[0] + (e[1] ? ' <span class="e-st live">Live</span>' : "") + "</b><small>" + (e[2] || "No sound saved") + '</small></span><span class="acts"' + (narrow ? ' style="flex-wrap:wrap"' : "") + ">" + (e[2] ? btn(narrow ? "Replace" : "Replace with current sound", "", "dim") + '<span class="w-swl">' + sw(e[3]) + "Starts when live</span>" + sico("playtri") + sico("close") : btn("Save current sound", "", "dim")) + "</span></div>";
  }
  function encCard(e) {
    return '<div class="e-card"><span class="e-thumb" style="background-image:url(' + MAP + ');aspect-ratio:16/7"></span>' + (e[1] ? '<span class="e-st live">Live</span>' : "") + '<div class="cb"><b>' + e[0] + '</b><span class="e-dim">' + (e[2] ? e[2] + (e[3] ? " · starts when live" : "") : "No sound saved") + '</span><div style="display:flex;gap:6px;align-items:center;justify-content:space-between">' + (e[2] ? btn("Play now", "playtri") : btn("Save current sound", "", "dim")) + sico("dots") + "</div></div></div>";
  }
  function encChosen(e, phone) {
    return '<div style="display:grid;gap:10px;align-content:start' + (phone ? ";padding:10px 12px;border-bottom:1px solid var(--line-strong);background:color-mix(in srgb,var(--cyan) 4%,transparent)" : "") + '">' + (phone ? "" : '<div class="w-h"><span class="e-eb">' + e[0] + "</span>" + (e[1] ? '<span class="e-st live">Live</span>' : "") + "</div>") + '<span class="e-dim">Saved Oct 25 · 2 tracks · 1 ambient layer</span>' + ["Road at dusk · 3:42", "Goblin drums · 2:58", "Rain on leaves · on"].map(function (t, i) { return '<div class="w-row" style="grid-template-columns:22px minmax(0,1fr);min-height:40px">' + (i < 2 ? IC.music : IC.vol).replace("<svg", '<svg style="width:15px;height:15px;fill:none;stroke:var(--text-dim);stroke-width:1.8"') + "<b>" + t + "</b></div>"; }).join("") + '<span class="w-swl">' + sw(1) + 'Starts when it goes live</span><div style="display:flex;gap:8px;flex-wrap:wrap">' + btn("Play now", "playtri", "on") + btn("Replace with what plays now", "", "dim") + btn("Clear", "", "dim") + "</div></div>";
  }
  function encArea(where) {
    var v = S.s4;
    if (v === "today") return sec("Encounter sound · 3", "scene", "", ENCS.map(function (e) { return encRow(e, where === "narrow"); }).join(""), "Saves the playlist and the ambient layers that are on. It starts when the encounter goes live.");
    if (v === "cards") return sec("Encounter sound · 3", "scene", "", '<div class="w-cards" style="grid-template-columns:repeat(' + (where === "wide" ? 3 : 2) + ',minmax(0,1fr))">' + ENCS.map(encCard).join("") + "</div>", "Saves the playlist and the ambient layers that are on. It starts when the encounter goes live.");
    if (v === "side") return sec("Encounter sound · 3", "scene", "", '<div style="display:grid;grid-template-columns:' + (where === "narrow" ? "minmax(0,1fr)" : "240px minmax(0,1fr)") + ';gap:16px"><div>' + ENCS.map(function (e, i) { return '<div class="w-ri' + (i === 0 ? " on" : "") + '" style="min-height:44px">' + (e[1] ? '<i class="e-lamp ok"></i>' : "") + '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + e[0] + "</span></div>"; }).join("") + "</div>" + encChosen(ENCS[0]) + "</div>");
    if (v === "strip") return "";
    return sec("Encounter sound", "scene", "", '<span class="e-dim">Each encounter keeps its own sound on its page, under Light and sound.</span>' + btn("Save what plays now as an encounter's sound", "", "dim"));
  }
  function encStrip(phone) {
    if (S.s4 !== "strip") return "";
    return '<div class="w-stripx" style="display:flex;align-items:center;gap:10px;padding:10px ' + (phone ? "12px" : "24px") + ';border-bottom:1px solid var(--line);overflow:hidden">' + (phone ? "" : '<span class="e-eb" style="flex:none">Encounter sound</span>') + ENCS.map(function (e) { return '<div class="w-chipe' + (e[1] ? " on" : "") + '"><b>' + (e[1] ? '<i class="e-lamp ok"></i>' : "") + e[0] + (e[2] ? IC.playtri.replace("<svg", '<svg style="width:13px;height:13px;margin-left:auto;fill:none;stroke:var(--cyan-hi);stroke-width:2"') : "") + "</b><small>" + (e[2] || "No sound saved") + (e[2] && e[3] ? " · starts when live" : "") + "</small></div>"; }).join("") + (phone ? "" : '<span class="e-grow" style="flex:1"></span>' + menu("Save what plays now", "dim")) + "</div>";
  }

  /* ---------- 2. What is playing ---------- */
  function nowBar(phone) {
    var v = S.s2;
    if (v === "today") return phone ? '<div style="display:grid;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)"><span class="w-badge">' + IC.vol + 'Living room TV · Sound on</span><span class="w-now">Road at dusk <small>with Rain on leaves</small></span><div style="display:grid;grid-template-columns:1fr auto auto;gap:6px">' + cup("Pause") + btn("Next track", "skip") + btn("Stop all", "stop") + "</div>" + lvl(80) + "</div>" :
      '<div style="display:grid;gap:10px;padding:12px 24px;border-bottom:1px solid var(--line)"><div style="display:flex;gap:16px;align-items:center"><span class="w-badge">' + IC.vol + 'Living room TV · Sound on</span><span class="e-eb">Music</span><span class="w-now">Road at dusk</span><span class="e-eb">Ambience</span><span class="w-now">Rain on leaves</span></div><div style="display:flex;gap:10px;align-items:center">' + cup("Pause") + btn("Next track", "skip") + btn("Stop all", "stop") + '<span class="e-dim" style="margin-left:8px">Master volume</span>' + lvl(80, 420) + "</div></div>";
    if (v === "onscreen") {
      // One kind of control (icon buttons of one size) and one kind of slider (the scrubber and Master share it).
      var scrub = '<span class="w-scrub"><span class="n">1:42</span><span class="t"><i style="width:46%"></i><b style="left:46%"></b></span><span class="n">3:42</span></span>';
      var ctl = '<span class="w-ctl">' + sico("pause") + sico("skip") + sico("stop") + "</span>";
      var vol = '<span class="w-vol">' + IC.vol + lvl(80) + "</span>";
      var lampEl = '<span class="w-room" title="Living room TV · sound on"><i></i></span>';
      if (phone) return '<div class="w-bar ph"><div class="w-h" style="min-height:0"><span class="e-eb" style="flex:none">Playing</span>' + lampEl + '</div><span class="w-now">Road at dusk <small>with Rain on leaves</small></span>' + scrub + '<div style="display:flex;align-items:center;gap:6px">' + ctl + vol + "</div></div>";
      return '<div class="w-bar"><span class="e-eb">Playing</span>' + lampEl + '<span class="w-now">Road at dusk <small>with Rain on leaves</small></span>' + scrub + ctl + vol + "</div>";
    }
    if (v === "vcr") { var vc = '<span class="w-vcr"><small>PLAY ▶ TRK 1/3</small><b>1:42</b></span>'; return phone ? '<div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 12px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--line)">' + vc + '<span style="display:grid;gap:6px;min-width:0"><span class="w-now" style="white-space:normal">Road at dusk</span>' + room(true) + '</span><div style="grid-column:1/-1;display:flex;gap:6px;align-items:center">' + sico("pause") + sico("skip") + sico("stop") + '<span style="flex:1">' + lvl(80) + "</span></div></div>" :
      '<div class="w-bar">' + vc + '<span style="display:grid;gap:4px"><span class="w-now">Road at dusk</span><small class="e-dim">of 3:42 · with Rain on leaves</small></span>' + sico("pause") + sico("skip") + sico("stop") + '<span class="e-grow" style="flex:1"></span>' + room() + '<span class="e-dim">Master</span>' + lvl(80, 150) + "</div>"; }
    return "";
  }
  function nowCard(phone) {
    if (S.s2 !== "card") return "";
    return '<div class="w-np"' + (phone ? ' style="padding:12px 14px;gap:10px"' : "") + '><div style="display:flex;align-items:center;gap:10px"><span class="e-eb" style="flex:1">Playing · track 1 of 3</span>' + room(phone) + '</div><h3' + (phone ? ' style="font-size:19px"' : "") + '>Road at dusk</h3><div class="w-prog"><i style="width:46%"></i></div><div class="t"><span>1:42</span><span>3:42</span></div><span class="e-dim">With Rain on leaves</span><div style="display:grid;grid-template-columns:1fr auto auto;gap:8px">' + cup("Pause") + btn("Next track", "skip") + btn("Stop all", "stop") + '</div><div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:center"><span class="e-dim">Master</span>' + lvl(80) + "</div></div>";
  }
  function nowFoot(phone) {
    if (S.s2 !== "foot") return "";
    return phone ? '<div class="w-foot" style="padding:8px 12px;gap:8px"><span class="w-play" style="color:var(--cyan-hi)">' + IC.pause + '</span><span style="display:grid;gap:4px;min-width:0;flex:1"><span class="w-now" style="font-size:14px">Road at dusk</span><span class="w-prog"><i style="width:46%"></i></span></span>' + sico("skip") + sico("dots") + "</div>" :
      '<div class="w-foot">' + sico("pause") + sico("skip") + sico("stop") + '<span style="display:grid;gap:6px;width:420px"><span class="w-now">Road at dusk <small>1:42 of 3:42 · with Rain on leaves</small></span><span class="w-prog"><i style="width:46%"></i></span></span><span class="e-grow" style="flex:1"></span>' + room() + '<span class="e-dim">Master</span>' + lvl(80, 150) + "</div>";
  }

  /* ---------- 1. The board's layouts on the laptop ---------- */
  function titleRow() { return head("Table screen", LINE, '<span class="e-seg" style="width:200px"><span>Display</span><span class="on">Sound</span></span><span class="e-muted">1 screen connected</span>'); }
  function board(focus) {
    var v = S.s1, B;
    var encFirst = focus === "enc", drag = focus === "add" && S.s3 === "drag";
    if (v === "today") {
      var right = encFirst ? encArea() + libSec(6) : libSec(focus === "add" ? 13 : 9, { menuOn: focus === "add" && S.s3 === "menu" }) + encArea();
      B = '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px;padding:16px 24px;align-items:start"><div style="display:grid;gap:18px">' + nowCard() + musicSec() + ambSec(false, drag) + fxSec() + '</div><div style="display:grid;gap:18px">' + right + "</div></div>";
    } else if (v === "desk") {
      var tab = focus === "enc" ? 2 : focus === "add" ? 1 : 0;
      var strips = '<div class="w-desk" style="height:300px">' + [["Master", "", 80, 1, 1], ["Music", "Road at dusk", 80, 1], ["Ambience", "Rain on leaves", 50, 1], ["Ambience", "Campfire", 60, 0], ["Ambience", "Wind in the pass", 40, 0]].map(function (c) { return '<div class="w-strip' + (c[3] ? " on" : "") + (c[4] ? " master" : "") + '"' + (c[1] === "Rain on leaves" && drag ? ' data-drop="1"' : "") + '><span class="e-eb">' + c[0] + "</span>" + '<span class="w-fader"><i style="height:' + c[2] + '%"></i><b style="bottom:' + c[2] + '%"></b></span><span class="v">' + c[2] + "</span>" + (c[4] ? '<b style="min-height:0">All</b>' : (c[0] === "Music" ? '<span style="display:flex;gap:2px">' + sico("pause", "width:30px;height:30px") + sico("skip", "width:30px;height:30px") + "</span>" : sw(c[3])) + "<b>" + c[1] + "</b>") + "</div>"; }).join("") + "</div>";
      var tabs = '<div class="e-tabs" style="padding:0">' + ["Playlist <b>3</b>", "Library <b>13</b>", "Encounters <b>3</b>"].map(function (t, i) { return '<span class="e-tab' + (i === tab ? " on" : "") + '">' + t + "</span>"; }).join("") + "</div>";
      var tbody = tab === 0 ? MUS.map(function (m) { return musRow(m, true); }).join("") : tab === 1 ? '<div style="position:relative">' + libList(9, { compact: true, menuOn: focus === "add" && S.s3 === "menu" }) + "</div>" : encArea("narrow");
      B = '<div style="display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:22px;padding:16px 24px;align-items:start"><div style="display:grid;gap:16px"' + "" + ">" + nowCard() + strips + fxSec(false, 4) + '</div><div style="display:grid;gap:8px;align-content:start;position:relative">' + tabs + tbody + "</div></div>";
    } else if (v === "rail") {
      var on = focus === "add" ? "lib" : focus === "enc" ? "enc" : "mus";
      var R = '<div class="w-rail"><span class="e-eb">On the board</span>' + [["mus", "music", "Playlist", 3], ["amb", "vol", "Ambience", "1 of 3"], ["fx", "sparkle", "Effects", 5]].map(function (r) { return '<div class="w-ri' + (r[0] === on ? " on" : "") + '"' + (r[0] === "amb" && drag ? ' data-drop="1"' : "") + ">" + IC[r[1]] + r[2] + '<span class="n">' + r[3] + "</span></div>"; }).join("") + '<span class="e-eb">Library</span><div class="w-ri' + (on === "lib" ? " on" : "") + '">All sounds<span class="n">13</span></div><div class="w-ri">Not on the board<span class="n">2</span></div>' + (S.s4 === "page" || S.s4 === "strip" ? "" : '<span class="e-eb">Encounters</span><div class="w-ri' + (on === "enc" ? " on" : "") + '">' + IC.scene + 'Encounter sound<span class="n">3</span></div>') + "</div>";
      var body = on === "mus" ? nowCard() + musicSec() : on === "lib" ? libSec(10, { menuOn: S.s3 === "menu" }) : encArea();
      B = '<div style="display:grid;grid-template-columns:240px minmax(0,1fr);height:100%;position:relative">' + R + '<div style="display:grid;gap:16px;align-content:start;padding:16px 24px;overflow:hidden;position:relative">' + body + "</div></div>";
    } else if (v === "panes") {
      var chips = '<div style="display:flex;gap:6px;flex-wrap:wrap">' + [["All", 13, 1], ["Music", 3], ["Ambience", 3], ["Effects", 5], ["Not on the board", 2]].map(function (c) { return '<span class="e-btn' + (c[2] ? " on" : " dim") + '">' + c[0] + ' <b style="font:400 16px/1 var(--f-num);color:var(--text-muted)">' + c[1] + "</b></span>"; }).join("") + "</div>";
      var lib = '<div style="display:grid;gap:10px;align-content:start;padding:16px 18px;border-left:1px solid var(--line-strong);background:var(--bg);overflow:hidden;position:relative"><div class="w-h"><span class="e-eb">Library · 13</span>' + btn("Add sounds", "upload") + '</div><span class="e-field" style="min-height:40px">' + IC.search + "Find a sound</span>" + chips + libList(10, { compact: true, menuOn: focus === "add" && S.s3 === "menu" }) + "</div>";
      var boardPane = '<div style="display:grid;gap:18px;align-content:start;padding:16px 24px;overflow:hidden">' + (encFirst ? encArea("narrow") : "") + nowCard() + '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;align-items:start">' + musicSec(true) + ambSec(true, drag) + "</div>" + fxSec(false, 5) + (encFirst ? "" : encArea("narrow")) + "</div>";
      B = '<div style="display:grid;grid-template-columns:minmax(0,1fr) 440px;height:100%">' + boardPane + lib + "</div>";
    } else {
      var deck = function (t, ic, inner, st) { return '<div style="display:grid;gap:10px;align-content:start;padding:14px 16px;border:1px solid var(--line-strong);background:linear-gradient(180deg,var(--s1),var(--bg));min-height:0;overflow:hidden' + (st || "") + '">' + inner + "</div>"; };
      var dk = '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;padding:0 24px 16px;align-items:stretch;height:100%;box-sizing:border-box">' + deck("Music", "music", musicSec(true)) + deck("Ambience", "vol", ambSec(true, drag)) + deck("Effects", "sparkle", fxSec(false, 2)) + "</div>";
      var heads = '<div style="display:flex;gap:10px;align-items:center;padding:12px 24px">' + nowCard().replace('class="w-np"', 'class="w-np" style="flex:1"') + (S.s2 === "card" ? "" : '<span class="e-grow" style="flex:1"></span>') + btn("Library · 13", "music", focus === "add" ? "on" : "") + (S.s4 === "page" || S.s4 === "strip" ? "" : btn("Encounter sound · 3", "scene", focus === "enc" ? "on" : "")) + "</div>";
      var sheet = focus === "add" ? '<div class="e-glass" style="top:0;right:0;bottom:0;width:440px;padding:14px 16px;display:grid;gap:8px;align-content:start;overflow:hidden;background:var(--bg)">' + libSec(10, { compact: true, menuOn: S.s3 === "menu" }) + "</div>" : focus === "enc" && S.s4 !== "page" && S.s4 !== "strip" ? '<div class="e-glass" style="top:0;right:0;bottom:0;width:560px;padding:14px 16px;display:grid;gap:8px;align-content:start;overflow:hidden;background:var(--bg)">' + encArea("narrow") + "</div>" : "";
      B = '<div style="display:grid;grid-template-rows:auto minmax(0,1fr);height:100%;position:relative">' + heads + dk + sheet + "</div>";
    }
    return B;
  }

  /* Overlays for putting a sound on: the dragged sound over its drop, or the section's dialog. */
  function addOverlay(phone) {
    var v = S.s3;
    if (v === "dialog") {
      var rows = LIB.filter(function (l) { return l[2] !== "e" && l[2] !== "m"; }).map(function (l) { var on = l[2] === "a", pick = l[0] === "Crowd murmur"; return '<div class="w-pick' + (pick ? " on" : "") + '"><span class="e-cbx' + (on || pick ? " on" : "") + '"' + (on ? ' style="opacity:.45"' : "") + "></span><span><b>" + l[0] + '</b><small><span style="font:400 15px/1 var(--f-num)">' + l[1] + "</span>" + (on ? " · Already in the ambience" : "") + "</small></span><span></span></div>"; }).join("");
      var d = '<div class="e-dh"><h2>Add to the ambience</h2>' + sico("close") + '</div><div style="padding:10px 16px;border-bottom:1px solid var(--line)"><span class="e-field" style="min-height:40px">' + IC.search + 'Find a sound</span></div><div style="overflow:hidden">' + rows + '</div><div class="w-dfoot"><span class="e-dim" style="flex:1">Layers loop on the table screen.</span>' + btn("Cancel", "", "ghost") + cup("Add 1 sound") + "</div>";
      if (phone) return '<div class="e-scrim"></div><div class="e-dlg" style="left:0;right:0;bottom:0;grid-template-rows:auto auto minmax(0,1fr) auto;max-height:620px">' + d + "</div>";
      return '<div class="e-scrim"></div><div class="e-dlg" style="left:50%;top:110px;width:520px;transform:translateX(-50%);grid-template-rows:auto auto minmax(0,1fr) auto">' + d + "</div>";
    }
    if (v === "drag" && !phone) {
      var pos = { today: "left:250px;top:470px", desk: "left:300px;top:340px", rail: "left:120px;top:250px", panes: "left:560px;top:330px", decks: "left:520px;top:330px" }[S.s1];
      return '<div class="w-ghost" style="' + pos + '"><span class="w-grip"></span><b>Crowd murmur</b></div>';
    }
    return "";
  }

  function soundLap(focus) {
    var foot = nowFoot();
    var bar = nowBar();
    var I = '<div class="w-page" style="grid-template-rows:auto ' + (bar ? "auto " : "") + (S.s4 === "strip" ? "auto " : "") + "minmax(0,1fr)" + (foot ? " auto" : "") + '">' + titleRow() + bar + encStrip() + '<div class="w-body" style="position:relative">' + board(focus) + "</div>" + foot + "</div>";
    if (focus === "add") I += addOverlay(false);
    // The drop target lights while a sound is dragged over it.
    return gmLap(I.replace(/<div class="([^"]*)"([^>]*) data-drop="1"/g, '<div class="$1 w-drop"$2'));
  }

  /* ---------- The phone ---------- */
  function soundPhone(focus) {
    var v = S.s1, P = "", segs;
    var top = '<div style="padding:10px 12px 0"><div class="e-seg"><span>Display</span><span class="on">Sound</span></div></div>';
    var card = nowCard(true) ? '<div style="padding:10px 12px 0">' + nowCard(true) + "</div>" : "";
    function chipsRow(list, on) { return '<div style="display:flex;gap:6px;overflow:hidden;padding:10px 12px">' + list.map(function (c, i) { return '<span class="e-btn' + (i === on ? " on" : " dim") + '" style="min-height:44px">' + c + "</span>"; }).join("") + "</div>"; }
    var pad = function (h) { return '<div style="padding:4px 12px;display:grid;gap:14px">' + h + "</div>"; };
    if (focus === "add") {
      P = (S.s1 === "rail" ? chipsRow(["Playlist 3", "Ambience 3", "Effects 5", "Library 13"], 3) : "") + pad(sec("Library · 13", "", btn("Add", "upload"), libList(9, { compact: true, phone: true }), S.s3 === "drag" ? "On a phone, hold a sound for the menu." : ""));
      if (S.s3 === "menu" || S.s3 === "drag") P += '<div class="e-scrim"></div><div class="w-menu" style="left:0;right:0;bottom:0;width:auto;padding-bottom:14px"><div class="w-mh">Put Crowd murmur on the board</div>' + [["music", "Add to the playlist"], ["vol", "Add to the ambience"], ["sparkle", "Add as an effect"]].map(function (m) { return '<div class="w-mi" style="min-height:48px">' + IC[m[0]] + m[1] + "</div>"; }).join("") + '<div class="w-sep"></div><div class="w-mi" style="min-height:48px">' + IC.pencil + 'Rename</div><div class="w-mi danger" style="min-height:48px">' + IC.trash + "Delete</div></div>";
      if (S.s3 === "dialog") P += addOverlay(true);
    } else if (focus === "enc") {
      var e = S.s4;
      if (e === "today") P = pad(sec("Encounter sound · 3", "scene", "", ENCS.map(function (x) { return '<div class="w-enc" style="grid-template-columns:minmax(0,1fr)"><span><b>' + x[0] + (x[1] ? ' <span class="e-st live">Live</span>' : "") + "</b><small>" + (x[2] || "No sound saved") + '</small></span><span class="acts" style="flex-wrap:wrap">' + (x[2] ? btn("Replace", "", "dim") + '<span class="w-swl">' + sw(x[3]) + "When live</span>" + sico("playtri") + sico("close") : btn("Save current sound", "", "dim")) + "</span></div>"; }).join(""), "Saves the playlist and the ambient layers that are on."));
      else if (e === "cards") P = pad(sec("Encounter sound · 3", "scene", "", '<div style="display:grid;gap:10px">' + ENCS.map(encCard).join("") + "</div>"));
      else if (e === "side") P = pad(sec("Encounter sound · 3", "scene", "", ENCS.map(function (x, i) { return '<div class="w-ri' + (i === 0 ? " on" : "") + '" style="min-height:48px">' + (x[1] ? '<i class="e-lamp ok"></i>' : "") + x[0] + '<span class="n">' + (x[2] ? IC.down : "") + "</span></div>" + (i === 0 ? encChosen(x, true) : ""); }).join("")));
      else if (e === "strip") P = pad(musicSec(true));
      else P = encPagePhone();
    } else if (v === "today") P = card + pad(musicSec(true) + ambSec(true) + fxSec(false, 2));
    else if (v === "desk") P = card + pad('<div class="w-desk" style="height:250px;overflow:hidden">' + [["Master", "All", 80, 1], ["Music", "Road at dusk", 80, 1], ["Ambience", "Rain on leaves", 50, 1], ["Ambience", "Campfire", 60, 0]].map(function (c, i) { return '<div class="w-strip' + (c[3] ? " on" : "") + '" style="width:84px;flex:none"><span class="e-eb">' + c[0] + '</span><span class="w-fader"><i style="height:' + c[2] + '%"></i><b style="bottom:' + c[2] + '%"></b></span><span class="v">' + c[2] + "</span>" + (i < 2 ? '<span style="height:22px"></span>' : sw(c[3])) + "<b>" + c[1] + "</b></div>"; }).join("") + "</div>" + fxSec(false, 2));
    else if (v === "rail") P = chipsRow(["Playlist 3", "Ambience 3", "Effects 5", "Library 13"], 0) + card + pad(MUS.map(function (m) { return musRow(m, true); }).join(""));
    else if (v === "panes") P = '<div style="padding:10px 12px 0"><div class="e-seg"><span class="on">Board</span><span>Library · 13</span></div></div>' + card + pad(musicSec(true) + ambSec(true));
    else P = '<div style="padding:10px 12px 0"><div class="e-seg"><span class="on">Music</span><span>Ambience</span><span>Effects</span></div></div>' + card + pad(MUS.map(function (m) { return musRow(m, true); }).join("") + '<div style="display:flex;gap:8px">' + btn("Library · 13", "music") + btn("Encounter sound", "scene") + "</div>");
    if (focus === "enc" && S.s4 === "page") return P;
    var bar = nowBar(true), foot = nowFoot(true);
    var inner = '<div style="position:absolute;inset:0;display:grid;grid-template-rows:auto ' + (bar ? "auto " : "") + (S.s4 === "strip" ? "auto " : "") + "minmax(0,1fr)" + (foot ? " auto" : "") + '">' + top + bar + encStrip(true) + '<div style="overflow:hidden;position:relative">' + P + "</div>" + foot + "</div>";
    return gmPhone(inner, { title: "Table screen", icons: ["dots"] });
  }

  /* ---------- An encounter: E's workbench ---------- */
  var WTOOLS = [["Select", "select", 1], ["Measure", "measure"], ["Ping", "ping"], ["Draw", "draw"], ["Fog", "fog"], ["Walls", "walls"], ["Light", "light"], ["View", "view"]];
  function wTools(row) { return '<div class="e-tools"' + (row ? ' style="grid-template-columns:repeat(4,1fr);padding:0"' : "") + ">" + WTOOLS.map(function (t) { return '<span class="e-tb' + (t[2] ? " on" : "") + '"' + (row ? ' style="flex-direction:column;height:44px;gap:2px;font-size:10px;justify-content:center;padding:0"' : "") + ">" + IC[t[1]] + t[0] + "</span>"; }).join("") + "</div>"; }
  function encHead(phone, acts) { return '<div class="e-rec"' + (phone ? ' style="padding:12px 14px 10px"' : "") + "><h1" + (phone ? ' style="white-space:normal;font-size:20px;flex-wrap:wrap;gap:8px"' : "") + ">" + (phone ? "" : '<span class="e-crumb">' + IC.back + "Encounters</span>") + 'Ambush on the old road <span class="e-st live">Live</span></h1><div class="ln">The old road · 3 characters, 2 monsters · edited today</div><div class="acts">' + acts + "</div></div>"; }
  function panel(tab, inner) { return '<div class="e-panel" style="width:380px"><div class="e-tabs">' + [["Who is in it", "<b>5</b>"], ["Rules", ""], ["Light and sound", ""]].map(function (t, i) { return '<span class="e-tab' + (i === tab ? " on" : "") + '">' + t[0] + " " + t[1] + "</span>"; }).join("") + '</div><div class="e-pbody" style="display:grid;gap:10px;align-content:start;padding:12px 16px;overflow:hidden">' + inner + '</div><div class="e-foot" style="display:grid;gap:8px;padding:12px 16px;border-top:1px solid var(--line-strong)"><span class="e-ready"><i class="e-lamp ok"></i>Live now</span>' + cup("Go to the table") + "</div></div>"; }
  function whoList() { return [["BS", "Borin Stoneguard", "Character · on the map"], ["LE", "Lyra Emberwise", "Character · on the map"], ["MD", "Mirena Dawnbright", "Character · on the map"], ["GB", "Goblin Boss", "CR 1 · on the map"], ["W", "Wolf", "CR 1/4 · on the map"]].map(function (r) { return '<div class="e-prow"><span class="face">' + r[0] + "</span><div><b>" + r[1] + '</b><span class="e-muted">' + r[2] + "</span></div>" + ico("dots") + "</div>"; }).join(""); }
  function soundTab() { return '<span class="e-eb">Sound</span><span class="e-dim">Saved Oct 25 · 2 tracks · 1 ambient layer</span>' + ["Road at dusk · 3:42", "Goblin drums · 2:58", "Rain on leaves · on"].map(function (t, i) { return '<div class="w-row" style="grid-template-columns:22px minmax(0,1fr);min-height:40px">' + (i < 2 ? IC.music : IC.vol).replace("<svg", '<svg style="width:15px;height:15px;fill:none;stroke:var(--text-dim);stroke-width:1.8"') + "<b>" + t + "</b></div>"; }).join("") + '<span class="w-swl">' + sw(1) + 'Starts when it goes live</span><div style="display:flex;gap:8px;flex-wrap:wrap">' + btn("Play now", "playtri", "on") + btn("Replace with what plays now", "", "dim") + "</div>" + btn("Open the sound board", "fwd"); }
  function screenPic(w, label) { return miniTV(w, null, label || ""); }
  function corners() { var c = "position:absolute;z-index:2;width:22px;height:22px;border-color:var(--cyan);border-style:solid;opacity:.8;"; return '<i style="' + c + 'left:8px;top:8px;border-width:2px 0 0 2px"></i><i style="' + c + 'right:8px;top:8px;border-width:2px 2px 0 0"></i><i style="' + c + 'left:8px;bottom:8px;border-width:0 0 2px 2px"></i><i style="' + c + 'right:8px;bottom:8px;border-width:0 2px 2px 0"></i>'; }
  function pvLine(t, right) { return '<div class="w-pvline">' + IC.screen.replace("<svg", '<svg style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8"') + t + '<span class="e-grow"></span>' + (right || "") + "</div>"; }
  function asChips() { return '<div style="display:flex;gap:6px">' + ["Table screen", "Borin", "Lyra", "Mirena"].map(function (c, i) { return '<span class="e-btn' + (i === 0 ? " on" : " dim") + '">' + c + "</span>"; }).join("") + "</div>"; }
  function encLap(tab, inner2) {
    var v = S.s5, acts = btn("Duplicate", "copy") + btn("Edit the map", "map") + ico("dots"), mapArea, extra = "";
    var W = 1280 - 232 - 380;
    if (S.pg !== "seeas") mapArea = mapLayer("position:absolute;inset:0", {});
    else if (v === "today") { acts = menu("See as: The table screen") + btn("Edit the map", "map") + ico("dots"); mapArea = '<div style="position:absolute;inset:0;display:grid;grid-template-rows:auto minmax(0,1fr)">' + pvLine("What the table screen shows.", btn("Back to your view", "", "dim")) + '<div style="position:relative;background:var(--void)">' + corners() + mapLayer("position:absolute;left:30px;right:30px;top:30px;bottom:30px", { names: false }) + "</div></div>"; }
    else if (v === "inplace") { var w1 = W - 40; mapArea = '<div style="position:absolute;inset:0;display:grid;grid-template-rows:auto minmax(0,1fr);background:var(--void)">' + pvLine("Seeing it as the table screen will show it", menu("As: Table screen", "dim") + btn("Back to your view", "", "dim")) + '<div style="display:grid;place-items:center">' + screenPic(w1) + "</div></div>"; }
    else if (v === "pip") { mapArea = mapLayer("position:absolute;inset:0", {}) + '<div class="h-pip" style="right:14px;bottom:14px;width:330px"><div class="bar">' + IC.screen.replace("<svg", '<svg style="width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8"') + '<span style="flex:1">As the table screen</span>' + menu("Table screen", "ghost") + '<span class="e-ico">' + IC.close + "</span></div>" + screenPic(328) + "</div>"; }
    else if (v === "side") { var half = Math.floor((1280 - 232) / 2); mapArea = '<div style="position:absolute;inset:0;display:grid;grid-template-columns:1fr 1fr">' + '<div style="position:relative;border-right:1px solid var(--line-strong)"><span class="e-eb" style="position:absolute;z-index:3;left:12px;top:10px">Your view</span>' + mapLayer("position:absolute;inset:0", {}) + '</div><div style="display:grid;grid-template-rows:auto minmax(0,1fr);background:var(--void)">' + pvLine("The table screen", menu("As: Table screen", "dim") + sico("close")) + '<div style="display:grid;place-items:center">' + screenPic(half - 30) + "</div></div></div>"; }
    else { mapArea = mapLayer("position:absolute;inset:0", {}); extra = '<div class="e-scrim"></div><div class="e-dlg" style="left:60px;right:60px;top:40px;bottom:30px;grid-template-rows:auto minmax(0,1fr) auto"><div class="e-dh"><h2>As the table screen</h2>' + asChips() + sico("close") + '</div><div style="display:grid;place-items:center;background:var(--void)">' + screenPic(960) + '</div><div class="w-dfoot"><span class="e-dim" style="flex:1">What the table screen would show if this encounter went live now.</span>' + btn("Close", "", "dim") + "</div></div>"; }
    var full = S.pg === "seeas" && v === "side";
    var I = '<div style="position:absolute;inset:0;display:grid;grid-template-rows:auto minmax(0,1fr)">' + encHead(false, acts) + '<div style="position:relative"><div style="position:absolute;left:0;top:0;bottom:0;width:232px;border-right:1px solid var(--line-strong);background:var(--bg)"><span class="e-eb" style="display:block;padding:12px 14px 0">Tools</span>' + wTools() + '</div><div style="position:absolute;left:232px;right:' + (full ? 0 : 380) + 'px;top:0;bottom:0;overflow:hidden">' + mapArea + "</div>" + (full ? "" : panel(tab, inner2)) + "</div></div>" + extra;
    return gmLapPrep(I);
  }
  function gmLapPrep(I) {
    var tabs = ["Encounters", "Party", "Maps", "Tokens", "Sound", "Replays"].map(function (t, i) { return '<span class="sb-tab' + (i === 0 ? " on" : "") + '">' + t + "</span>"; }).join("");
    return gmLap('<div style="position:absolute;inset:0;display:grid;grid-template-rows:auto minmax(0,1fr)"><div class="sb titled"><span class="sb-title">Prep</span><div class="sb-tabs">' + tabs + '</div>' + prepEnd() + '</div><div style="position:relative">' + I + "</div></div>");
  }
  function encPagePhone() {
    return '<div style="display:grid;gap:0">' + encHead(true, ico("dots")) + '<div style="padding:8px 14px"><div class="e-seg"><span>Map</span><span>Who · 5</span><span>Rules</span><span class="on">Light</span></div></div><div style="padding:6px 14px;display:grid;gap:10px">' + soundTab() + "</div></div>";
  }
  function encPhone() {
    var v = S.s5, body, menuEl = "";
    var seg = '<div style="padding:8px 14px"><div class="e-seg"><span class="on">Map</span><span>Who · 5</span><span>Rules</span><span>Light</span></div></div>';
    var mapBox = function (h) { return '<div style="position:relative;height:' + h + 'px">' + mapLayer("position:absolute;inset:0", { small: 1 }) + "</div>"; };
    if (v === "today") body = pvLine("What the table screen shows.", btn("Back", "", "dim")) + '<div style="position:relative;height:330px;background:var(--void)">' + corners() + mapLayer("position:absolute;left:20px;right:20px;top:20px;bottom:20px", { small: 1, names: false }) + "</div>";
    else if (v === "inplace") body = pvLine("As the table screen", menu("Table screen", "dim")) + '<div style="padding:10px 0;background:var(--void)">' + screenPic(386) + '</div><div style="padding:8px 14px">' + btn("Back to your view", "", "dim") + "</div>";
    else if (v === "pip") body = '<div style="position:relative;height:420px">' + mapLayer("position:absolute;inset:0", { small: 1 }) + '<div class="h-pip" style="right:8px;bottom:8px;width:250px"><div class="bar" style="min-height:34px">' + IC.screen.replace("<svg", '<svg style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8"') + '<span style="flex:1;font-size:12px">Table screen</span><span class="e-ico" style="width:32px;height:32px">' + IC.close + "</span></div>" + screenPic(248) + "</div></div>";
    else if (v === "side") body = '<span class="e-eb" style="display:block;padding:6px 14px">Your view</span>' + mapBox(200) + pvLine("The table screen", sico("close")) + '<div style="padding:8px 0;background:var(--void)">' + screenPic(386) + "</div>";
    else { body = mapBox(420); menuEl = '<div class="e-scrim"></div><div class="e-dlg" style="left:0;right:0;bottom:0;grid-template-rows:auto auto auto auto"><div class="e-dh"><h2>As the table screen</h2>' + sico("close") + '</div><div style="padding:10px 12px;overflow:hidden">' + asChips() + '</div><div style="background:var(--void);padding:8px 0">' + screenPic(386) + '</div><div class="w-dfoot"><span class="e-dim">If it went live now.</span></div></div>'; }
    var I = '<div style="position:absolute;inset:0;overflow:hidden">' + encHead(true, ico("dots")) + seg + body + '<div style="padding:6px 8px">' + wTools(true) + "</div>" + menuEl + "</div>";
    return gmPhone(I, { title: "Prep", icons: ["search", "plus"] });
  }

  /* ---------- Pages ---------- */
  function boardPage(phone) { return phone ? soundPhone("board") : soundLap("board"); }
  function nowPage(phone) { return boardPage(phone); }
  function addPage(phone) { return phone ? soundPhone("add") : soundLap("add"); }
  function encPage(phone) {
    if (S.s4 === "page") return phone ? gmPhone('<div style="position:absolute;inset:0;overflow:hidden">' + encPagePhone() + "</div>", { title: "Prep", icons: ["search", "plus"] }) : encLap(2, soundTab());
    return phone ? soundPhone("enc") : soundLap("enc");
  }
  function seeasPage(phone) { return phone ? encPhone() : encLap(0, whoList()); }
