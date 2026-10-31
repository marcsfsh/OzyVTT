
  /* ---------- 4. The attention signal: one mark wherever something waits on the GM ---------- */
  function sig(n, o) {
    o = o || {};
    var v = S.d4;
    if (v === "lamp") return '<span class="k-sig lamp"><i></i>' + n + "</span>";
    if (v === "words") return o.head ? '<span class="k-sig words">Needs attention <b>' + n + "</b></span>" : '<span class="k-sig words"><b>' + n + "</b></span>";
    if (v === "bell") return '<span class="k-sig bell">' + IC.bell + "<b>" + n + "</b></span>";
    if (v === "count") return '<span class="k-sig count"><b>' + n + "</b></span>";
    if (v === "flag") return '<span class="k-sig flag">' + IC.flag + n + "</span>";
    return '<span class="k-sig ink' + (o.head ? " big" : "") + '"><b>' + n + "</b></span>";
  }
  function inkCls() { return S.d4 === "ink" ? " k-amber" : ""; }

  /* ---------- What waits on the GM ---------- */
  function fc(c, sz) { return '<span class="fc' + (c.foe ? " foe" : "") + '"' + (sz ? ' style="width:' + sz + "px;height:" + sz + 'px"' : "") + ">" + c.s + "</span>"; }
  var GB = C[0], BOR = C[1], LYR = C[2], GW1 = C[3], MIR = C[5];
  // Today's words, from the branch: each kind's title, its line and its buttons.
  var IT = {
    aim: { k: "aim", ic: "target", who: LYR, verb: "Aim", short: "<b>Lyra</b> · Fire Bolt · choose a target", title: "Lyra Emberwise uses Fire Bolt · choose a target", line: "Pick the target on the map, then roll it as you would your own.", main: "Choose the target", rest: ["Turn down"], big: ["120", "feet"], tw: "Fire Bolt · choose a target" },
    apply: { k: "apply", ic: "check", who: BOR, whom: GW1, verb: "Apply", short: "<b>Borin</b>'s Longsword hit Goblin Warrior 1 · 9 slashing", title: "Borin Stoneguard's Longsword hit Goblin Warrior 1", line: "9 slashing.", main: "Apply", num: "9", rest: ["Change", "Dismiss"], big: ["9", "slashing"], tw: "Longsword hit" },
    ask: { k: "ask", ic: "rule", who: LYR, verb: "Rule", gmtone: 1, short: "<b>Lyra</b> asks for your ruling · 10 feet past Lyra's speed", title: "Lyra Emberwise asks for your ruling", line: "Move 40 feet to the ridge: that is 10 feet past Lyra's speed.", main: "Allow", rest: ["Deny"], big: ["+10", "feet"], tw: "Move 40 feet: 10 feet past Lyra's speed" },
    wait: { k: "wait", ic: "hourglass", who: MIR, verb: "Waiting on players", wait: 1, short: "Waiting on <b>Mirena</b> · Concentration check", title: "Waiting on Mirena Dawnbright · Concentration check", line: "The Goblin Boss's Scimitar hit Mirena for 7. Mirena keeps Bless on a DC 10 Constitution save.", main: null, rest: ["Answer for Mirena"], big: ["DC 10", "Con"], tw: "Waiting · Concentration check for Bless" }
  };
  function itemsFor() { return S.pg === "items" ? [IT.aim, IT.apply, IT.ask, IT.wait] : [IT.aim, IT.apply]; }
  function owed(list) { return list.filter(function (i) { return !i.wait; }).length; }
  function mainBtn(i) { return i.main ? '<span class="k-btn main">' + i.main + (i.num ? " <b>" + i.num + "</b>" : "") + "</span>" : '<span class="k-btn">' + i.rest[0] + "</span>"; }
  function btns(i) { return mainBtn(i) + (i.main ? i.rest : i.rest.slice(1)).map(function (r) { return '<span class="k-btn">' + r + "</span>"; }).join(""); }
  function oneLine(i) { return '<div class="k-rowi' + (i.wait ? " wait" : "") + '"><span class="k-kind"' + (i.wait ? ' style="color:var(--text-muted)"' : "") + ">" + IC[i.ic] + '</span><span class="w">' + i.short + "</span>" + mainBtn(i) + '<span class="more">' + IC.dots + "</span></div>"; }
  function card(i) { return '<div class="k-card' + (i.wait ? " wait" : "") + '"><div class="t">' + fc(i.who) + i.title + '</div><div class="l">' + i.line + '</div><div class="a">' + btns(i) + "</div></div>"; }
  function ticket(i) {
    var pair = fc(i.who) + "<span>" + i.who.sh + "</span>" + (i.whom ? IC.arrow + fc(i.whom) + "<span>" + i.whom.sh + "</span>" : "");
    return '<div class="k-tk' + (i.wait ? " wait" : "") + '"' + '><div class="pair">' + pair + '</div><div class="what">' + i.tw + '</div><div class="big">' + i.big[0] + "<small>" + i.big[1] + '</small></div><div class="a">' + btns(i) + "</div></div>";
  }
  function listBody(list, o) {
    o = o || {};
    var v = o.style || S.d2;
    if (v === "card") return '<div class="k-list" style="gap:8px">' + list.map(card).join("") + "</div>";
    if (v === "row") return '<div class="k-rows">' + list.map(oneLine).join("") + "</div>";
    if (v === "ticket") return '<div class="k-list" style="gap:8px">' + list.map(ticket).join("") + "</div>";
    if (v === "expand") return '<div class="k-fold">' + list.map(function (i, k) {
      var head = '<div class="k-rowi' + (i.wait ? " wait" : "") + '"><span class="k-kind">' + IC[i.ic] + '</span><span class="w">' + i.short + '</span><span></span><span class="more chev">' + (k === 0 ? IC.up : IC.down) + "</span></div>";
      return k === 0 ? head + '<div class="open"><span class="l">' + i.line + '</span><div class="a" style="display:flex;flex-wrap:wrap;gap:6px">' + btns(i) + "</div></div>" : head;
    }).join("") + "</div>";
    if (v === "kind") {
      var order = ["aim", "apply", "ask", "wait"], names = { aim: "Aim", apply: "Apply", ask: "Rule", wait: "Waiting on players" };
      return order.filter(function (k) { return list.some(function (i) { return i.k === k; }); }).map(function (k) {
        var its = list.filter(function (i) { return i.k === k; });
        return '<div class="k-gh">' + names[k] + " <b>" + its.length + '</b></div><div class="k-rows">' + its.map(oneLine).join("") + "</div>";
      }).join("");
    }
    // Grouped by the creature it came from
    var whos = [];
    list.forEach(function (i) { if (whos.indexOf(i.who) < 0) whos.push(i.who); });
    return whos.map(function (w) {
      var its = list.filter(function (i) { return i.who === w; });
      return '<div class="k-gh">' + fc(w) + w.n + " <b>" + its.length + '</b></div><div class="k-rows">' + its.map(function (i) { return oneLine(i).replace(/<b>[A-Z][a-z]+<\/b>('s)? ?/, ""); }).join("") + "</div>";
    }).join("");
  }
  function listHead(list, o) {
    o = o || {};
    var place = S.d1 === "tab" ? '<span class="k-btn k-place" data-place="top" title="Show the list over the turn">' + IC.up + "Over the turn</span>" : S.d1 === "top" ? '<span class="k-btn k-place" data-place="tab" title="Show the list in its own tab">' + IC.fwd + "Own tab</span>" : "";
    return '<div class="k-lhead">' + sig(owed(list), { head: 1 }) + (list.length > owed(list) ? '<span class="e">' + (list.length - owed(list)) + " waiting on players</span>" : "") + '<span class="sp"></span>' + (o.right != null ? o.right : place) + "</div>";
  }

  /* ---------- 3. The panel's tabs ---------- */
  function tabDefs(on) {
    var n = owed(itemsFor());
    var t = [["enc", "Encounter", "enc"], ["log", "Log", "log", "3"], ["party", "Party", "party"], ["notes", "Notes", "notes", "2"], ["tok", "Token", "token"]];
    if (S.d1 === "tab") t.unshift(["att", S.d4 === "words" ? "Attention" : "", "bell"]);
    return t.map(function (x) { return { id: x[0], name: x[1], ic: x[2], cnt: x[0] === on || S.read[x[0]] ? 0 : x[3], on: x[0] === on, sig: (S.d1 === "tab" ? x[0] === "att" : x[0] === "enc") ? n : 0 }; });
  }
  function tabsRow(on) {
    var v = S.d3, T = tabDefs(on);
    function sigOf(x) { return x.sig ? sig(x.sig) : ""; }
    if (v === "words" || v === "counts") return '<div class="sh-tabs k-tabs">' + T.map(function (x) { return '<span class="sh-tab' + (x.on ? " on" : "") + (x.sig ? inkCls() : "") + '" data-tab="' + x.id + '">' + x.name + sigOf(x) + (v === "counts" && x.cnt ? '<span class="k-c">' + x.cnt + "</span>" : "") + "</span>"; }).join("") + "</div>";
    if (v === "icons") return '<div class="sh-tabs k-tabs icons">' + T.map(function (x) { return '<span class="sh-tab' + (x.on ? " on" : "") + (x.sig ? inkCls() : "") + '">' + (x.id === "att" ? sigOf(x) + "<span>Waiting</span>" : (x.id === "tok" ? fc(GB, 22) : IC[x.ic]) + x.name + sigOf(x)) + "</span>"; }).join("") + "</div>";
    if (v === "iconsonly") return '<div class="sh-tabs k-tabs iconsonly">' + T.map(function (x) { return '<span class="sh-tab' + (x.on ? " on" : "") + (x.sig ? inkCls() : "") + '" title="' + (x.name || "Waiting") + '">' + (x.id === "att" ? sigOf(x) : (x.id === "tok" ? fc(GB) : IC[x.ic]) + sigOf(x)) + "</span>"; }).join("") + "</div>";
    if (v === "menu") {
      var main = T.filter(function (x) { return x.id === "enc" || x.id === "att" || x.id === "tok"; });
      var inMenu = T.filter(function (x) { return x.id === "log" || x.id === "party" || x.id === "notes"; });
      var lit = inMenu.filter(function (x) { return x.on; })[0];
      return '<div class="sh-tabs k-tabs">' + main.map(function (x) { return '<span class="sh-tab' + (x.on ? " on" : "") + (x.sig ? inkCls() : "") + '">' + x.name + sigOf(x) + "</span>"; }).join("") + '<span class="sh-tab menu' + (lit ? " on" : "") + '">' + (lit ? lit.name : "Log, Party, Notes") + IC.down + "</span></div>";
    }
    return "";
  }
  function sigIcon() { return S.d4 === "flag" ? "flag" : "bell"; }
  function railOf(on) { return '<nav class="k-rail">' + tabDefs(on).map(function (x) { return '<span class="' + (x.on ? "on" : "") + '" title="' + (x.name || "Waiting") + '">' + (x.id === "att" ? sig(x.sig) : (x.id === "tok" ? fc(GB) : IC[x.ic]) + (x.sig ? sig(x.sig) : "")) + "</span>"; }).join("") + "</nav>"; }

  /* ---------- 1. Where the waiting list sits: the laptop ---------- */
  function encFoot(extra) { return '<div class="pfoot">' + (extra || "") + '<div class="row1"><span class="back">' + IC.left + '</span><button type="button" class="cup">End turn</button></div><p>Next: Goblin Warrior 1</p></div>'; }
  function gmPanel(on) {
    var list = itemsFor(), v = S.d1;
    var listEl = listBody(list);
    var body, top = "", foot = encFoot(), over = "";
    var bodyOf = function () { return on === "log" ? logCol() : on === "party" ? partyBody() : on === "notes" ? notesBody() : on === "tok" ? tokenBody() : on === "att" ? listHead(list) + listEl : turnBody(false); };
    if (on === "enc" && v === "top") body = '<div style="display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;overflow:hidden"><div class="k-zone">' + listHead(list) + listEl + "</div>" + '<div class="pbody">' + turnBody(false) + "</div></div>";
    else if (on === "att") body = '<div class="pbody" style="display:grid;align-content:start;gap:8px">' + listHead(list) + listEl + "</div>";
    else body = '<div class="pbody">' + bodyOf() + "</div>";
    if (v === "above") top = '<div class="k-zone slim">' + listHead(list, { right: '<span class="lnk">Hide</span>' }) + listBody(list, { style: S.d2 === "card" || S.d2 === "ticket" ? "row" : S.d2 }) + "</div>";
    if (v === "foot") foot = encFoot('<div class="k-foot" style="margin:-12px -16px 8px">' + listHead(list) + listBody(list, { style: S.d2 === "card" || S.d2 === "ticket" ? "row" : S.d2 }) + "</div>");
    if (v === "drawer") {
      top = '<div class="k-ticker">' + sig(owed(list)) + '<span class="sp">' + list[0].short + "</span>" + mainBtn(list[0]) + "</div>";
      if (S.pg !== "tabs") over = '<div class="k-drawer" style="top:' + (S.d3 === "icons" ? 100 : 86) + 'px">' + listHead(list, { right: '<span class="lnk">Close</span>' }) + listEl + "</div>";
    }
    var rows = (top ? "auto " : "") + "auto minmax(0,1fr) auto";
    if (S.d3 === "rail") return '<div class="tpan docked k-railed" style="grid-template-rows:' + (top ? "auto " : "") + 'minmax(0,1fr) auto">' + railOf(on) + (top ? '<div style="grid-column:2">' + top + "</div>" : "") + '<div style="grid-column:2;display:grid;grid-template-rows:minmax(0,1fr);min-height:0;overflow:hidden">' + body.replace('class="pbody"', 'class="pbody" style="overflow:hidden"') + '</div><div style="grid-column:2">' + foot + "</div>" + over + "</div>";
    return '<div class="tpan docked" style="grid-template-rows:' + rows + '">' + top + tabsRow(on) + body + foot + over + "</div>";
  }
  function dockOf() {
    var list = itemsFor();
    var extra = S.d1 === "dock" ? '<div class="k-dock">' + listHead(list, { right: "" }) + listBody(list, { style: "row" }).replace(/<span class="k-btn main">[^<]*(<b>[^<]*<\/b>)?<\/span>/g, "") + "</div>" : "";
    var o = ord("v");
    // The acting row in the order carries the signal when its creature has something waiting.
    o = o.replace(/(<div class="c-ent act">)/, "$1" + sig(1));
    return '<div class="dock" style="grid-template-rows:minmax(0,1fr) ' + (extra ? "auto " : "") + 'auto">' + o + extra + tools("grid") + "</div>";
  }
  function laptopTable(on) { return '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-base">' + topBar() + '<div class="ap-pane is-cols"><div class="L docks">' + dockOf() + mapEl(false) + gmPanel(on) + "</div></div></div></div>"; }

  /* ---------- The phone: the Switch ---------- */
  function phoneSegs(on) {
    var n = owed(itemsFor()), v = S.d3;
    var t = [["map", "Map", "play"], ["enc", "Encounter", "enc"], ["log", "Log", "log", "3"], ["party", "Party", "party"], ["notes", "Notes", "notes", "2"]].map(function (x) { return x[0] === on || S.read[x[0]] ? x.slice(0, 3) : x; });
    if (S.d1 === "tab") t.splice(0, 0, ["att", "", "bell"]);
    if (v === "menu") t = t.slice(0, S.d1 === "tab" ? 3 : 2).concat([["more", on === "log" ? "Log" : "More", "dots"]]);
    return '<div class="k-segs">' + t.map(function (x) {
      var hasSig = (S.d1 === "tab" ? x[0] === "att" : x[0] === "enc") ? sig(n) : "";
      var lit = x[0] === on || (x[0] === "more" && on === "log");
      var label = x[0] === "att" ? "" : v === "iconsonly" || v === "rail" ? IC[x[2]] : v === "icons" ? IC[x[2]] : "";
      var word = v === "iconsonly" || v === "rail" ? "" : x[1] || (x[0] === "att" ? "" : "");
      return '<span data-tab="' + x[0] + '" class="' + (lit ? "on" : "") + '"' + (v === "icons" ? ' style="flex-direction:column;gap:2px;min-height:44px;font-size:10.5px"' : "") + ">" + label + word + (x[0] === "more" ? IC.down.replace("<svg", '<svg style="width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2"') : "") + hasSig + (v === "counts" && x[3] ? '<span class="k-c" style="font:400 14px/1 var(--f-num);color:var(--text-muted)">' + x[3] + "</span>" : "") + "</span>";
    }).join("") + "</div>";
  }
  function phoneTable(on) {
    var list = itemsFor(), v = S.d1;
    var pbar = '<header class="pbar"><h1>Old road</h1><span class="vcr">R02</span><span class="ico" style="width:28px">' + IC.down + '</span><div class="end">' + (v === "drawer" ? '<span class="ico" style="width:auto;padding:0 8px">' + sig(owed(list)) + "</span>" : "") + "</div></header>";
    var tabs = [["Play", "play"], ["Prep", "prep"], ["Codex", "codex"], ["Compendium", "book"], ["More", "dots"]];
    var bottom = '<nav class="ap-bottom five" aria-hidden="true">' + tabs.map(function (t, i) { return '<span class="btab' + (i === 0 ? " on" : "") + '">' + IC[t[1]] + t[0] + "</span>"; }).join("") + "</nav>";
    var compact = S.d2 === "card" || S.d2 === "ticket" ? "row" : S.d2;
    var view;
    if (on === "log") view = '<div class="pbody pv-log">' + logCol() + "</div>";
    else if (on === "party") view = '<div class="pbody">' + partyBody() + "</div>";
    else if (on === "notes") view = '<div class="pbody">' + notesBody() + "</div>";
    else if (on === "map") view = '<div class="pv-map">' + tools("row") + mapEl(true) + "</div>";
    else if (on === "att") view = '<div class="pbody" style="display:grid;align-content:start;gap:8px;overflow:hidden">' + listHead(list) + listBody(list) + "</div>";
    else if (v === "top") view = '<div class="pbody" style="overflow:hidden;padding:0"><div class="k-zone">' + listHead(list) + listBody(list) + '</div><div style="padding:12px">' + turnBody(true) + "</div></div>";
    else view = '<div class="pbody" style="overflow:hidden">' + turnBody(true) + "</div>";
    var segOn = on;
    var above = v === "above" ? '<div class="k-strip">' + sig(owed(list)) + '<span class="sp">' + list[0].short + '</span><span class="k-btn" style="min-height:30px">Show</span></div>' : "";
    var ordEl = ord("h");
    if (v === "dock") ordEl = ordEl.replace('<div class="list">', '<div class="list"><span class="k-ordcard">' + sig(owed(list)) + "<b>" + list.length + ' waiting</b><small>Fire Bolt · Longsword</small></span>');
    var foot = v === "foot" ? '<div class="pfoot"><div class="k-foot" style="margin:-12px -16px 8px;padding:8px 12px 0">' + listBody(list, { style: compact }) + '</div><div class="row1"><span class="back">' + IC.left + '</span><button type="button" class="cup">End turn</button></div><p>Next: Goblin Warrior 1</p></div>' : '<div class="pfoot"><div class="row1"><span class="back">' + IC.left + '</span><button type="button" class="cup">End turn</button></div><p>Next: Goblin Warrior 1</p></div>';
    var sheet = v === "drawer" && S.pg !== "tabs" ? '<div class="k-sheet"><div class="grab2"></div>' + listHead(list, { right: '<span class="lnk">Close</span>' }) + listBody(list) + "</div>" : "";
    var body = '<div class="P switch" style="grid-template-rows:auto ' + (above ? "auto " : "") + 'auto minmax(0,1fr)"><div class="segw">' + phoneSegs(segOn) + "</div>" + above + ordEl + '<div class="tpan" style="grid-template-rows:minmax(0,1fr) auto">' + view + foot + "</div>" + sheet + "</div>";
    return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-base">' + pbar + '<div class="ap-pane" style="overflow:hidden;position:relative">' + body + "</div>" + bottom + "</div></div>";
  }

  /* ---------- Pages ---------- */
  function shown(def) { var t = S.tab || def; if (t === "att" && S.d1 !== "tab") t = "enc"; if (t === "map" || t === "tok") return t; return t; }
  function listTab() { return S.d1 === "tab" ? "att" : "enc"; }
  function fight(phone) { var t = shown(listTab()); if (!phone && t === "map") t = "enc"; if (phone && t === "tok") t = "enc"; return phone ? phoneTable(t) : laptopTable(t); }
  function items(phone) { return fight(phone); }
  function tabsPage(phone) { var t = shown("log"); if (!phone && t === "map") t = "enc"; if (phone && t === "tok") t = "enc"; return phone ? phoneTable(t) : laptopTable(t); }
  function notesBody() { return '<p class="desc-line" style="margin:0 0 10px">Tonight</p><div class="prepl"><div class="r"><span class="fc foe">GB</span><div><b>Grukk wants the toll</b><span>The boss offers to let one of them pass for the Crowbar</span></div><span></span></div><div class="r"><span class="fc">M</span><div><b>Mirena\'s vow</b><span>Ask about the shrine if she drops to 0</span></div><span></span></div></div>'; }
  function tokenBody() { return '<div class="turn"><div class="turn-h"><span class="fc foe">GB</span><div><h3>Goblin Boss</h3><p>Chosen on the map · you run it</p></div><div class="hp"><b>15<small style="font-size:.6em;color:var(--text-muted)">/21</small></b><span>AC 17</span></div></div><p class="desc-line" style="margin:0">C3.10 designs the token\'s tab; it stays as it is meanwhile.</p></div>'; }
  // Every place the signal shows, at once, so it can be judged on its own.
  function signalPage(phone) {
    var n = 2;
    var tabRow = '<div class="sh-tabs k-tabs" style="border:1px solid var(--line-strong);padding:0 4px"><span class="sh-tab' + inkCls() + '">Encounter' + sig(n) + '</span><span class="sh-tab on">Log</span><span class="sh-tab">Party</span><span class="sh-tab">Notes</span></div>';
    var specs = [
      ["The panel's tab", "On whichever tab the GM is reading, the Encounter tab carries it.", tabRow],
      ["The list's head", "Above what waits, in place of the words Needs you.", listHead([IT.aim, IT.apply], { right: "" })],
      ["A row in the turn order", "The creature whose turn has something waiting.", '<div class="k-ord" style="position:relative">' + fc(LYR) + "<b>Lyra Emberwise</b>" + '<span class="cini" style="color:var(--caution-text)">13</span><span style="position:absolute;right:34px;top:8px">' + sig(1) + "</span></div>"],
      ["The top bar, away from Play", "On Prep or the Codex mid-fight, the live chip carries it.", '<span class="k-chip"><i></i>Old road<span class="vcr">R02</span>' + sig(n) + "</span>"],
      ["A phone's tabs", "The Play tab at the foot, and Encounter in the Switch.", '<div class="k-specrow"><span class="k-btab">' + IC.play + "Play" + sig(n) + '</span><div class="k-segs" style="flex:1;min-width:220px"><span>Map</span><span class="on">Encounter' + sig(n) + "</span><span>Log</span></div></div>"],
      ["Between fights", "A long rest to approve, or a record in the Compendium with a problem.", '<div class="k-lhead" style="border:1px solid var(--line-strong);border-left:3px solid var(--caution);padding:0 12px">' + sig(2, { head: 1 }) + '<span class="sp"></span><span class="lnk">Compendium · 2 records</span></div>'],
      ["Nothing waiting", "No mark at all; the tab reads as any other.", '<div class="sh-tabs k-tabs" style="border:1px solid var(--line-strong);padding:0 4px"><span class="sh-tab on">Encounter</span><span class="sh-tab">Log</span><span class="sh-tab">Party</span></div>'],
      ["Something new arrives", "The mark lights once, as a lamp does (ADR-0045), and screen readers hear the newest title.", '<div class="k-specrow">' + sig(3) + '<span class="e-muted" style="font-size:12.5px;color:var(--text-muted)">from ' + sig(2).replace("k-sig", "k-sig quiet") + " to 3, with one burst</span></div>"]
    ];
    var board = '<div class="k-board' + (phone ? " ph" : "") + '">' + specs.map(function (s) { return '<div class="k-spec"><span class="e">' + s[0] + "</span>" + s[2] + "<p>" + s[1] + "</p></div>"; }).join("") + "</div>";
    return phone ? '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-base" style="position:relative">' + board + "</div></div>" : '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-base" style="position:relative">' + board + "</div></div>";
  }
