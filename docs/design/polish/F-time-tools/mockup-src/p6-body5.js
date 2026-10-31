
  /* =========================================================================
     The Atlas as approved: the maps at the side (a tree, with the layers under it), the map in the middle, and the
     pins at the right. A pin chosen from the list or on the map opens in that right column with All pins at its head;
     a pin's own menu opens on a right-click (a long press on a phone).
     ========================================================================= */
  function mixLeft(cur) {
    var tree = [["The Sunhold Reaches", "world", 0], ["The Thornwood", "5 pins", 1], ["Riverford crossing", "battle", 2], ["The ruined keep", "3 pins", 1]];
    return '<div class="u-rail"><span class="e-eb">Maps · 4</span><div class="z-tree">' + tree.map(function (t) { return '<div class="u-ri' + (t[0] === cur ? " on" : "") + '" style="padding-left:' + (12 + t[2] * 16) + 'px">' + (t[2] === 0 ? IC.down : "") + t[0] + '<span class="n">' + t[1] + "</span></div>"; }).join("") + '</div><span class="e-eb">On the map</span><div class="u-ri">' + IC.person + 'People<span class="n">on</span></div><div class="u-ri">' + IC.eyeoff + 'Hidden pins<span class="n">on</span></div><div class="u-ri">' + IC.faction + 'Factions<span class="n">off</span></div><div style="padding:10px 12px">' + btn("Add a map", "plus", "dim") + "</div></div>";
  }
  function mixFrame(right, opts) {
    opts = opts || {};
    return '<div style="position:absolute;inset:0;display:grid;grid-template-columns:250px minmax(0,1fr) 360px">' + mixLeft(opts.cur || "The Thornwood") + '<div style="position:relative;overflow:hidden">' + atlasMap("inset:0", { on: opts.on, m: opts.m }) + '<div class="e-glass" style="left:14px;top:14px;padding:8px 12px">' + crumbs(opts.cur || "The Thornwood") + '</div><div class="e-glass" style="right:14px;bottom:14px;padding:6px;display:flex;gap:6px">' + btn("+", "", "dim") + btn("−", "", "dim") + "</div>" + (opts.over || "") + '</div><div style="display:grid;gap:10px;align-content:start;padding:14px 16px;border-left:1px solid var(--line-strong);background:var(--bg);overflow:hidden">' + right + "</div></div>";
  }
  function mixPins(on) { return '<div style="display:flex;align-items:center;gap:8px"><span class="e-eb" style="flex:1">Pins · 5</span>' + btn("Add a pin", "plus") + ico("dots") + '</div><span class="e-field hint" style="min-height:38px">' + IC.search + "Filter pins</span>" + PINS.map(function (p) { return pinRow(p, p[0] === on); }).join("") + '<span class="e-muted">Right-click a pin for its menu, or the map to add a pin there.</span>'; }
  function mixPinOpen() { return '<div style="display:flex;align-items:center;gap:8px">' + btn("All pins", "back", "dim") + '<span class="e-grow" style="flex:1"></span>' + btn("Edit pin", "edit", "dim") + ico("dots") + '</div><div style="display:flex;align-items:center;gap:12px">' + face("place", "var(--cyan)", 44) + '<div><span class="e-h2" style="font-size:22px">Thornwick</span><div class="e-dim">Place · village · the party is here</div></div></div><div style="display:grid;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">' + [["flag", "The party's position", 1], ["eye", "Players see it", 1]].map(function (r) { return '<div style="display:flex;align-items:center;gap:10px;min-height:44px"><span class="f-ic">' + IC[r[0]] + '</span><span style="flex:1">' + r[1] + '</span><span class="e-sw' + (r[2] ? " on" : "") + '"><i></i></span></div>'; }).join("") + '</div><div class="f-prose" style="font-size:14px"><p>A walled village on the old road, last stop before the keep. The Wyvern is its inn; Captain Dorran Hale keeps its watch.</p></div>' + grp("Facts", '<div class="f-row" style="grid-template-columns:100px minmax(0,1fr)"><span class="e-muted">Ruler</span><span>The Thornwick council</span></div><div class="f-row" style="grid-template-columns:100px minmax(0,1fr)"><span class="e-muted">People</span><span>Mother Tollow, Captain Hale</span></div>', true) + grp("Journal · 1", '<div class="f-row" style="grid-template-columns:auto minmax(0,1fr)"><span class="f-ic">' + IC.log + "</span><span>The party reached Thornwick at dusk.</span></div>", true) + btn("Open the whole page", "right"); }
  function mixMenu(st, phone) { return '<div class="u-menu" style="' + st + '"><div class="u-mh">The ruined keep · ruin</div>' + [["right", "Open The ruined keep's page"], ["edit", "Edit pin"], ["flag", "Set party position here"], ["eyeoff", "Hide from players"], ["grip", "Move pin"]].map(function (m) { return '<div class="u-mi"' + (phone ? ' style="min-height:48px"' : "") + ">" + IC[m[0]] + m[1] + "</div>"; }).join("") + '<div class="w-sep" style="height:1px;margin:6px 0;background:var(--line)"></div><div class="u-mi" style="color:var(--danger-text)' + (phone ? ";min-height:48px" : "") + '">' + IC.trash + "Delete pin</div></div>"; }
  function mixEdit(phone) { return '<div style="display:flex;align-items:center;gap:8px">' + btn("Back", "back", "dim") + '<span class="e-eb" style="flex:1">Edit pin · Thornwick</span><span class="e-ready"><i class="e-lamp ok"></i>Saved</span></div><div class="e-tabs" style="padding:0' + (phone ? ";overflow:hidden" : "") + '">' + ["Look", "Links", "Encounters", "Who sees it"].map(function (t, i) { return '<span class="e-tab' + (i === 0 ? " on" : "") + '">' + t + "</span>"; }).join("") + "</div>" + look() + '<div style="display:flex;justify-content:flex-end">' + cup("Done") + "</div>"; }

  function atlasPageM(phone) {
    if (S.a1 !== "mix") return atlasPage(phone);
    if (!phone) return lap("Atlas", mixFrame(mixPins()));
    return mixPhone('<div class="e-glass" style="left:0;right:0;bottom:0;padding:8px 12px 12px;display:grid;gap:6px"><div style="width:40px;height:4px;margin:0 auto;background:var(--line-raised)"></div><div style="display:flex;align-items:center"><span class="e-eb" style="flex:1">Pins · 5</span>' + btn("Add a pin", "plus", "dim") + "</div>" + pinRow(PINS[0]) + pinRow(PINS[1]) + "</div>");
  }
  function pinPageM(phone) {
    if (S.a1 !== "mix" || S.a2 !== "side") return pinPage(phone);
    // Thornwick is open at the right; the ruined keep's own menu is open on a right-click.
    if (!phone) return lap("Atlas", mixFrame(mixPinOpen(), { on: "Thornwick", over: mixMenu("right:12px;top:calc(26% + 6px);width:270px") }));
    return mixPhone('<div class="e-glass" style="left:0;right:0;bottom:0;top:250px;padding:8px 14px 14px;display:grid;gap:10px;align-content:start;background:var(--bg)"><div style="width:40px;height:4px;margin:0 auto;background:var(--line-raised)"></div>' + mixPinOpen().replace(btn("Edit pin", "edit", "dim"), btn("Edit", "edit", "dim")) + "</div>", "Thornwick");
  }
  function pinEditPageM(phone) {
    if (S.a1 !== "mix" || S.a3 !== "tabs") return pinEditPage(phone);
    if (!phone) return lap("Atlas", mixFrame(mixEdit(), { on: "Thornwick" }));
    return ph("Atlas", '<div style="position:relative;height:100%;overflow:hidden;padding:10px 14px;display:grid;gap:10px;align-content:start">' + mixEdit(true) + "</div>", { title: "Atlas", back: 1, icons: [] });
  }
  function mapsPageM(phone) {
    if (S.a1 !== "mix" || S.a4 !== "tree") return mapsPage(phone);
    var empty = '<div style="display:flex;align-items:center;gap:8px"><span class="e-eb" style="flex:1">Pins · 0</span>' + btn("Add a pin", "plus") + '</div><span class="e-field hint" style="min-height:38px">' + IC.search + 'Filter pins</span><span class="e-muted">No pins on this map yet.</span><div>' + btn("Add a pin", "plus") + '</div>';
    if (!phone) return lap("Atlas", mixFrame(empty, { cur: "Riverford crossing", m: "riverford" }));
    return mixPhone('<div class="e-glass" style="left:0;right:0;bottom:0;padding:8px 12px 12px;display:grid;gap:6px"><div style="width:40px;height:4px;margin:0 auto;background:var(--line-raised)"></div><span class="e-eb">Pins · 0</span><span class="e-muted">No pins on this map yet.</span><div>' + btn("Add a pin", "plus") + '</div></div>', null, "Riverford crossing", "riverford");
  }
  function mixPhone(over, on, cur, m) {
    cur = cur || "The Thornwood";
    var chips = '<div class="y-scrollx" style="display:flex;gap:6px;overflow:hidden;padding:10px 12px">' + ["The Sunhold Reaches", "The Thornwood", "Riverford crossing"].map(function (c) { return '<span class="e-btn' + (c === cur ? " on" : " dim") + '" style="min-height:44px">' + c + "</span>"; }).join("") + "</div>";
    return ph("Atlas", '<div style="position:relative;height:100%;overflow:hidden">' + chips + '<div style="position:absolute;left:0;right:0;top:64px;bottom:0">' + atlasMap("inset:0", { small: 1, on: on, m: m }) + over + "</div></div>", { title: "Codex" });
  }
