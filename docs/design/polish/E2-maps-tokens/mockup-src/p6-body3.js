
  /* =========================================================================
     E2, approved: the owner's combinations. Maps run in the folder layout (Folders at the side); a map opens beside
     the list inside it; a map's menu files it and Choose files several; the tokens page groups creatures into Party,
     Monsters and the GM's own groups; the picker is folders and a preview. The other options draw as before.
     ========================================================================= */
  function railList(on, rows) { return '<div style="border-right:1px solid var(--line-strong);padding:14px 12px;overflow:hidden;display:grid;align-content:start"><div class="e-tool" style="margin-bottom:6px"><span class="e-muted">' + rows.length + " maps in " + on + '</span><span class="e-grow"></span>' + btn("Modified", "sort", "dim") + "</div>" + rows.map(function (m, i) { return '<div class="e-prowp"' + (i === 0 ? ' style="background:color-mix(in srgb,var(--cyan) 8%,transparent);box-shadow:inset 3px 0 0 var(--cyan),inset 0 -1px 0 var(--line)"' : "") + ">" + thumb(m.k) + '<div class="e-nm"><b>' + m.n + "</b>" + gridOf(m) + "</div>" + ico("dots") + "</div>"; }).join("") + "</div>"; }
  function folderChips(on) { return '<div class="x-chips" style="margin-bottom:10px">' + FOLDERS.map(function (f) { return btn(f[0] + " " + f[1], "", f[0] === on ? "on" : "dim"); }).join("") + btn("New folder", "plus", "dim") + "</div>"; }
  function chooseTool(n, on) { return '<div class="e-tool"><span class="e-muted">' + n + '</span><span class="e-grow"></span>' + btn("All", "", "on") + btn("Battle maps", "", "dim") + btn("Regional", "", "dim") + btn("World", "", "dim") + btn("Modified", "sort", "dim") + btn("Choose", "check", on ? "on" : "dim") + btn("New map", "upload") + "</div>"; }

  /* ---------- 2. A map's page, beside the list, inside the folder layout ---------- */
  function mapPageA(phone) {
    if (S.x2 !== "panes") return mapPage(phone);
    var act1 = MAPS2.slice(0, 3);
    if (!phone) {
      var rec = '<div style="display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0">' + mapHead(true, btn("Set the grid again", "grid") + btn("New encounter on this map", "plus") + ico("dots")) + '<div style="display:grid;grid-template-columns:minmax(0,1fr) 270px;min-height:0"><div style="padding:14px">' + bigMap("height:100%") + '</div><div style="border-left:1px solid var(--line-strong);overflow:hidden">' + secGrid() + secType() + secUsed() + "</div></div></div>";
      return lap("Maps", '<div class="x-pane2" style="grid-template-columns:200px 300px minmax(0,1fr)">' + rail("Act 1") + railList("Act 1", act1) + rec + "</div>", true);
    }
    var I = folderChips("Act 1") + act1.map(function (m, i) { return '<div class="e-prowp"' + (i === 0 ? ' style="background:color-mix(in srgb,var(--cyan) 8%,transparent);box-shadow:inset 3px 0 0 var(--cyan)"' : "") + ">" + thumb(m.k) + '<div class="e-nm"><b>' + m.n + "</b>" + gridOf(m) + "</div>" + ico(i === 0 ? "down" : "dots") + "</div>" + (i === 0 ? '<div class="x-under">' + bigMap("aspect-ratio:16/10") + '<dl class="x-facts"><dt>Type</dt><dd>Battle map</dd><dt>Folder</dt><dd>Act 1</dd><dt>Size</dt><dd><b>1400 × 1000</b> px</dd><dt>Used in</dt><dd>Ambush on the old road</dd></dl><div class="x-chips">' + btn("Open its page", "arrow") + btn("Set the grid again", "grid") + "</div></div>" : ""); }).join("");
    return ph("Maps", '<div class="e-pad">' + I + "</div>");
  }

  /* ---------- 3. Folders: a map's menu, and Choose for several ---------- */
  function foldersPageA(phone) {
    var v = S.x3;
    if (v !== "menu" && v !== "select") return foldersPage(phone);
    var sel = function (m) { return m === MOVE || m.k === "camp"; };
    if (!phone) {
      var cards, extra = "";
      if (v === "menu") { cards = MAPS2.map(function (m) { return mcard(m); }).join(""); extra = xmenu("left:720px;top:120px", moveMenuRows()); }
      else { cards = MAPS2.map(function (m) { return mcard(m, { check: sel(m), on: sel(m) }); }).join(""); extra = '<div class="x-selbar"><b>2</b><span class="e-dim">maps chosen</span><span class="e-grow" style="flex:1"></span>' + btn("Move to", "folder", "on") + "</div>" + xmenu("right:24px;bottom:66px;width:240px", '<div class="x-mh">Move 2 maps to</div>' + mi("Act 1", "", "1 is here") + mi("Act 2") + mi("No folder") + mi("New folder…", "", "", "plus")); }
      var tool = v === "menu" ? chooseTool("6 maps") : '<div class="e-tool"><span class="e-muted">2 of 6 chosen</span><span class="e-grow"></span>' + btn("Choose all", "", "dim") + btn("Done", "check", "on") + "</div>";
      return lap("Maps", '<div class="x-pane2" style="grid-template-columns:240px minmax(0,1fr)">' + rail("All maps") + '<div class="e-pad" style="position:relative;overflow:hidden">' + tool + '<div class="e-cards" style="grid-template-columns:repeat(3,minmax(0,1fr))">' + cards + "</div>" + extra + "</div></div>");
    }
    var two = function (o) { return '<div class="e-cards" style="grid-template-columns:1fr 1fr;gap:10px">' + MAPS2.slice(0, 4).map(function (m) { return mcard(m, Object.assign({ short: 1 }, o ? o(m) : {})); }).join("") + "</div>"; };
    var foot = function (inner) { return '<div class="e-pfoot" style="padding:0">' + inner + "</div>"; };
    if (v === "menu") return ph("Maps", '<div class="e-pad">' + folderChips("All maps") + '<div class="e-tool"><span class="e-muted">6 maps</span><span class="e-grow"></span>' + ico("filter") + ico("sort") + btn("Choose", "check", "dim") + "</div>" + two() + "</div>" + foot('<div class="x-menu" style="position:static;width:auto;border:0;box-shadow:none">' + moveMenuRows() + "</div>"));
    return ph("Maps", '<div class="e-pad"><div class="e-tool"><span class="e-muted">2 of 6 chosen</span><span class="e-grow"></span>' + btn("Done", "check", "on") + "</div>" + two(function (m) { return { check: sel(m), on: sel(m) }; }) + "</div>" + foot('<div class="x-menu" style="position:static;width:auto;border:0;box-shadow:none"><div class="x-mh">Move 2 maps to</div>' + mi("Act 1", "", "1 is here") + mi("Act 2") + mi("No folder") + mi("New folder…", "", "", "plus") + '</div><div style="display:flex;align-items:center;gap:8px;padding:8px 14px 10px;border-top:1px solid var(--line)"><b style="font:400 20px var(--f-num);color:var(--cyan-hi)">2</b><span class="e-dim" style="flex:1">chosen</span>' + btn("Move to", "folder", "on") + "</div>"));
  }

  /* ---------- 4. Tokens: Party, Monsters, and the GM's own groups ---------- */
  var MINE = [["Flameskull", "Monster", "5", "Fire elemental · Monsters"], ["Glasstaff", "Monster", "", "Default picture"]];
  function trow2(w, menu) { return '<div class="x-trow" style="grid-template-columns:48px minmax(0,1.4fr) minmax(0,0.7fr) minmax(0,1.4fr) auto 36px;position:relative;min-height:50px">' + art(w[2], w[1] === "Monster" ? "foe" : "") + "<b>" + w[0] + '</b><span class="e-dim">' + w[1] + '</span><span class="e-dim">' + w[3] + "</span>" + btn("Set token image", "", "dim") + ico("dots") + (menu || "") + "</div>"; }
  function grpHead(t, n, mine) { return '<div style="display:flex;align-items:center;gap:8px;min-height:30px"><span class="e-eb" style="flex:1">' + t + " · " + n + "</span>" + (mine ? '<span class="e-muted" style="font-size:12px">Your group</span>' + ico("dots") : "") + "</div>"; }
  function tokensPageA(phone) {
    if (S.x4 !== "groups") return tokensPage(phone);
    var groups = [["Party", WHO2.slice(0, 3)], ["Monsters", WHO2.slice(3)], ["Act 2 villains", MINE, 1]];
    if (!phone) {
      var menu = '<div class="x-menu" style="right:6px;bottom:44px;width:250px"><div class="x-mt"><b>Flameskull</b><span>Monster · Act 2 villains</span></div>' + mi("Set token image", "", "", "edit") + '<div class="x-mh">Group</div>' + mi("Party") + mi("Monsters") + mi("Act 2 villains", "on", "here") + mi("New group…", "", "", "plus") + "</div>";
      var I = '<div class="e-pad" style="position:relative;overflow:hidden"><div class="e-tool"><span class="e-muted">7 creatures in 3 groups</span><span class="e-grow"></span>' + btn("New group", "plus") + "</div>" + groups.map(function (g) { return '<div class="e-grp" style="margin-bottom:8px">' + grpHead(g[0], g[1].length, g[2]) + g[1].map(function (w) { return trow2(w, w[0] === "Flameskull" ? menu : ""); }).join("") + "</div>"; }).join("") + "</div>";
      return lap("Tokens", I);
    }
    var prow = function (w) { return '<div class="x-trow" style="grid-template-columns:44px minmax(0,1fr) auto">' + art(w[2], w[1] === "Monster" ? "foe" : "") + '<div><b>' + w[0] + '</b><div class="e-muted">' + w[3] + "</div></div>" + ico("dots") + "</div>"; };
    return ph("Tokens", '<div class="e-pad"><div class="e-tool"><span class="e-muted">7 creatures</span><span class="e-grow"></span>' + btn("New group", "plus") + "</div>" + groups.map(function (g) { return '<div class="e-grp" style="padding:0 10px 8px;margin-bottom:10px">' + grpHead(g[0], g[1].length, g[2]) + g[1].map(prow).join("") + "</div>"; }).join("") + "</div>");
  }

  /* ---------- 1. The map list, with Choose in its toolbar ---------- */
  function mapsPageA(phone) {
    if (S.x1 !== "rail") return mapsPage(phone);
    if (!phone) return lap("Maps", '<div class="x-pane2" style="grid-template-columns:240px minmax(0,1fr)">' + rail("All maps") + '<div class="e-pad" style="overflow:hidden">' + chooseTool("6 maps") + '<div class="e-cards" style="grid-template-columns:repeat(3,minmax(0,1fr))">' + MAPS2.map(function (m) { return mcard(m); }).join("") + "</div></div></div>");
    return ph("Maps", '<div class="e-pad">' + folderChips("All maps") + '<div class="e-tool"><span class="e-muted">6 maps</span><span class="e-grow"></span>' + ico("filter") + ico("sort") + btn("Choose", "check", "dim") + '</div><div class="e-cards" style="grid-template-columns:1fr 1fr;gap:10px">' + MAPS2.slice(0, 4).map(function (m) { return mcard(m, { short: 1 }); }).join("") + "</div></div>");
  }
