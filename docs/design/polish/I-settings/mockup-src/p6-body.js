
  /* ---------- 2. How one setting reads ---------- */
  function rowsOf(list, phone, o) {
    o = o || {};
    var v = o.style || S.d2;
    function name(r) { return "<b>" + r.n + (r.gm ? " " + gmTag() : "") + "</b>"; }
    function ctlOf(r) { return r.wide ? wideOf(r.wide, phone) : r.ctl || ""; }
    if (v === "sentence") return '<div class="i-grp i-sent">' + list.map(function (r) {
      if (r.wide === "table") return '<div class="i-srow"><span class="e-eb">' + r.n + "</span>" + tableCtl(phone) + "</div>";
      if (r.wide === "join") return '<div class="i-srow"><p>' + r.sent + "</p>" + '<div class="i-acts">' + btn("Copy", "copy") + btn("Show QR code", "qr") + "</div></div>";
      if (r.wide === "assist") return '<div class="i-srow"><p>' + r.sent + '</p><p class="i-note">Enforce blocks an illegal move until you allow it.</p></div>';
      return '<div class="i-srow"><p>' + r.sent + (r.gm ? " " + gmTag() : "") + "</p></div>";
    }).join("") + "</div>";
    if (v === "cards") return '<div class="i-cards' + (phone ? " on-ph" : "") + '">' + list.map(function (r) { return '<div class="i-card' + (r.wide ? " wide" : "") + '">' + name(r) + "<span>" + r.h + '</span><div class="i-cfoot">' + ctlOf(r) + (r.note ? '<p class="i-note">' + r.note + "</p>" : "") + "</div></div>"; }).join("") + "</div>";
    if (v === "cols" && !phone) return '<div class="i-grp i-cols">' + list.map(function (r) { return '<div class="i-crow"><div class="i-txt">' + name(r) + "<span>" + r.h + '</span></div><div class="i-cctl">' + ctlOf(r) + (r.note ? '<p class="i-note">' + r.note + "</p>" : "") + "</div></div>"; }).join("") + "</div>";
    return '<div class="i-grp">' + list.map(function (r) {
      var line = v === "effect" ? '<span class="i-eff"><i></i>' + r.eff + "</span>" : "<span>" + r.h + "</span>";
      var mark = v === "changed" && r.chg ? " chg" : "";
      var stack = r.wide || phone ? " stack" : "";
      return '<div class="i-row' + stack + mark + '"><div class="i-txt">' + name(r) + line + (mark ? '<small class="i-def">' + r.chg + ' · <u>Reset</u></small>' : "") + '</div><div class="i-ctl">' + ctlOf(r) + "</div>" + (r.note && v !== "effect" ? '<p class="i-note">' + r.note + "</p>" : "") + "</div>";
    }).join("") + "</div>";
  }
  function device(phone) { return phone ? phFrame("device", rowsOf(ROWS.device, true)) : lapFrame("device", rowsOf(ROWS.device)); }
  function characters(phone) { return phone ? phFrame("characters", rowsOf(ROWS.characters, true)) : lapFrame("characters", rowsOf(ROWS.characters)); }

  /* ---------- 1. Opening Settings, and finding a setting ---------- */
  function homePage(phone) {
    var d = S.d1;
    if (d === "home") {
      var cards = '<div class="i-home' + (phone ? " on-ph" : "") + '">' + SECS.map(function (s) { return '<div class="i-hc">' + '<span class="i-hi">' + IC[s[2]] + "</span><b>" + s[1] + "</b><span>" + (phone ? "" : s[3]) + '</span><small>' + SUM[s[0]] + "</small></div>"; }).join("") + "</div>";
      var lead = '<div class="i-head"><h1>Settings</h1><p>Set the table up once, and change it whenever you need to.</p></div>';
      return phone ? phFrame("players", lead + cards, { list: 1 }) : lapFrame("players", lead + cards, { noHead: 1, isHome: 1 });
    }
    if (phone && (d === "rail" || d === "who")) return phFrame("players", '<div class="i-plist m">' + railList(null).replace('<div class="u-list">', "<div>") + "</div>", { list: 1 });
    return phone ? phFrame("players", rowsOf(ROWS.players, true)) : lapFrame("players", rowsOf(ROWS.players));
  }
  var HITS = [["Players' d20 rolls", "fights", "Total · Each die · App rolls", seg(["Total", "Each die", "App rolls"], "Each die")], ["Players' damage", "fights", "Total · Each die · App rolls", seg(["Total", "Each die", "App rolls"], "App rolls")], ["Players' initiative", "fights", "When players roll their own initiative", seg(["Start turns immediately", "Wait until everyone has rolled"], "Start turns immediately")], ["How you roll", "device", "With I roll my dice, you type what your own dice show.", seg(["Auto-roll", "I roll my dice"], "Auto-roll")], ["Hit point rolls", "characters", "A character who rolls hit points on a new level never gets less than the average.", sw(false, "Raise a roll below the average")], ["Ability scores", "characters", "Standard array, point buy, roll, custom formula", ""], ["Random characters", "characters", "You can always roll one, and this lets players roll their own.", sw(false, "Players can roll their own")]];
  function hl(t) { return "<span>" + t.replace(/(roll)/i, "<mark>$1</mark>") + "</span>"; }
  function searchPage(phone) {
    var d = S.d1, q = "roll";
    var drop = '<div class="i-drop' + (phone ? " on-ph" : "") + '">' + HITS.map(function (h, i) { return '<div class="i-dr' + (i === 0 ? " on" : "") + '"><b>' + hl(h[0]) + "</b><small>" + secOf(h[1])[1] + "</small></div>"; }).join("") + "</div>";
    if (d === "search" || d === "onepage") {
      // Matching rows in place, grouped by section, with their controls live.
      var groups = ["fights", "characters", "device"].map(function (sec) { var hs = HITS.filter(function (h) { return h[1] === sec; }); return '<div class="i-rhead"><span class="e-eb">' + secOf(sec)[1] + '</span><small>' + hs.length + "</small></div>" + '<div class="i-grp">' + hs.map(function (h) { return '<div class="i-row' + (phone || !h[3] ? " stack" : "") + '"><div class="i-txt"><b>' + hl(h[0]) + "</b><span>" + h[2] + '</span></div><div class="i-ctl">' + (h[3] || '<div class="sw-row i-meth">' + tick(true, "Standard array") + tick(true, "Roll") + "</div>") + "</div></div>"; }).join("") + "</div>"; }).join("");
      var lead = '<p class="i-count">' + HITS.length + ' settings match <b>roll</b>, in three sections</p>';
      return phone ? phFrame("players", lead + groups, { q: q, noHead: 1 }) : lapFrame("players", lead + groups, { q: q, noHead: 1 });
    }
    if (d === "rail" || d === "who") {
      // The results keep the settled side list: each section's matches under its eyebrow, the first one lit.
      var rsecs = []; HITS.forEach(function (h) { if (rsecs.indexOf(h[1]) < 0) rsecs.push(h[1]); });
      var rl = '<div class="u-list i-rres m">' + rsecs.map(function (sec) { var s = secOf(sec); return '<span class="e-eb">' + s[1] + "</span>" + HITS.filter(function (h) { return h[1] === sec; }).map(function (h) { return '<div class="u-ri' + (h === HITS[0] ? " on" : "") + '">' + IC[s[2]] + "<span>" + hl(h[0]) + "</span></div>"; }).join(""); }).join("") + "</div>";
      if (phone) return phFrame("players", '<div class="i-band on-ph in">' + IC.search + "<b>roll</b></div>" + rl, { list: 1 });
      return lapFrame("fights", rowsOf(ROWS.fights.slice(3, 5)) + '<p class="e-muted" style="margin-top:10px">Players\' d20 rolls is lit; the rest of Encounters is under it.</p>', { q: q, rail: rl });
    }
    // The bar's field (and Home's) opens a list under it, as today.
    if (phone) return phFrame("players", '<div class="i-band on-ph in">' + IC.search + "<b>roll</b></div>" + drop, { list: 1 });
    var page = d === "home" ? homePage(false) : lapFrame("players", rowsOf(ROWS.players));
    return page.replace('<span class="find">' + IC.search + "Search settings<kbd>Ctrl K</kbd></span>", '<span class="find on">' + IC.search + '<span style="color:var(--text)">roll</span><kbd>Esc</kbd></span>').replace('<div class="i-body">', '<div class="i-body">' + drop);
  }

  /* ---------- 3. The encounter rules ---------- */
  var F = {}; ROWS.fights.forEach(function (r) { F[r.id] = r; });
  function fightsBody(phone) {
    var v = S.d3, R = ROWS.fights;
    if (v === "list") return rowsOf(R, phone);
    if (v === "presets") {
      var P = [["By the book", "Enforce, every check, hits applied by the GM, the app rolls", 0], ["Trust the table", "Advise, players apply their own hits and type each die", 0], ["Hands off", "Off, players apply their hits and type their totals", 0], ["Custom", "Like By the book, with players typing each d20", 1]];
      return '<div class="i-presets' + (phone ? " on-ph" : "") + '">' + P.map(function (p) { return '<div class="i-pc' + (p[2] ? " on" : "") + '"><b>' + p[0] + "</b><span>" + p[1] + "</span></div>"; }).join("") + '</div><p class="i-note" style="margin:0 0 14px">A preset sets the eight below at once; changing one makes it Custom.</p><div class="i-fold"><span class="e-eb">Fine tune</span></div>' + rowsOf(R, phone);
    }
    if (v === "moment") {
      var G = [["When a token is staged", ["tok", "hp"]], ["When dice are rolled", ["init", "d20", "dmg"]], ["On a player's turn", ["assist", "tgt"]], ["When a hit lands", ["hits"]]];
      return G.map(function (g) { return '<div class="i-rhead"><span class="e-eb">' + g[0] + "</span></div>" + rowsOf(g[1].map(function (k) { return F[k]; }), phone); }).join("");
    }
    if (v === "split") {
      var L = ["assist", "tgt", "hits", "init"].map(function (k) { return F[k]; }), Rr = ["d20", "dmg", "hp", "tok"].map(function (k) { return F[k]; });
      if (phone) return '<div class="i-rhead"><span class="e-eb">The rules</span></div>' + rowsOf(L, true) + '<div class="i-rhead"><span class="e-eb">Dice and tokens</span></div>' + rowsOf(Rr, true);
      return '<div class="i-two"><div><div class="i-rhead"><span class="e-eb">The rules</span></div>' + rowsOf(L, false, { style: S.d2 === "cards" || S.d2 === "cols" ? "row" : S.d2 }).replace(/i-row"/g, 'i-row stack"') + '</div><div><div class="i-rhead"><span class="e-eb">Dice and tokens</span></div>' + rowsOf(Rr, false, { style: S.d2 === "cards" || S.d2 === "cols" ? "row" : S.d2 }).replace(/i-row"/g, 'i-row stack"') + "</div></div>";
    }
    if (v === "assist") {
      var dial = '<div class="i-dial' + (phone ? " on-ph" : "") + '">' + [["Enforce", "Blocks an illegal move until you allow it.", 1], ["Advise", "Allows every move and leaves a note on an illegal one.", 0], ["Off", "Checks nothing and shows no prompts.", 0]].map(function (o) { return '<div class="i-dc' + (o[2] ? " on" : "") + '"><b>' + o[0] + "</b><span>" + o[1] + "</span></div>"; }).join("") + "</div>";
      var chips = '<div class="i-cchips"><span class="e-eb">What it checks · 6 of 6</span><div class="chips">' + CHECKS.map(function (c) { return '<span class="chip on">' + IC.check + c.replace("Check ", "") + "</span>"; }).join("") + "</div></div>";
      var rest = R.filter(function (r) { return r.id !== "assist"; });
      return '<div class="i-head2"><b>Rules assistant</b><span>' + F.assist.h + "</span></div>" + dial + chips + '<div class="i-rhead"><span class="e-eb">Players and dice</span></div>' + (phone ? rowsOf(rest, true) : '<div class="i-two">' + rowsOf(rest.slice(0, 4), false, { style: "row" }).replace(/i-row"/g, 'i-row stack"') + rowsOf(rest.slice(4), false, { style: "row" }).replace(/i-row"/g, 'i-row stack"') + "</div>");
    }
    // A turn, told: the settings at the left, and at the right a player's turn told from them.
    var T = [["The encounter starts.", "New tokens are <em>shown to players</em>; health shows as <em>a status badge</em>, to everyone."], ["Players roll initiative.", "Turns <em>start at once</em>; a late roll joins the order where it falls."], ["Lyra taps Fire Bolt.", "<em>She picks its target</em> on the map: Goblin Boss."], ["She rolls to hit.", "She <em>types what her d20 shows</em>; the app adds +7. <em>The app rolls</em> her damage."], ["The rules assistant checks.", "Range, her slots and components: it <em>blocks an illegal cast</em> until you allow it."], ["The hit lands.", "It <em>waits in Needs you</em> until you apply it."]];
    var story = '<aside class="i-story' + (phone ? " on-ph" : "") + '"><span class="e-eb">How a turn goes with these settings</span>' + T.map(function (t, i) { return '<div class="i-st"><i>' + (i + 1) + "</i><span><b>" + t[0] + "</b> " + t[1] + "</span></div>"; }).join("") + "</aside>";
    if (phone) return story + rowsOf(R, true);
    return '<div class="i-tell"><div>' + rowsOf(R, false, { style: S.d2 === "cards" ? "row" : S.d2 }) + "</div>" + story + "</div>";
  }
  function fights(phone) { return phone ? phFrame("fights", fightsBody(true)) : lapFrame("fights", fightsBody(false), { wide: S.d3 === "split" || S.d3 === "story" || S.d3 === "assist" }); }

  /* ---------- 4. Access and credentials ---------- */
  var CREDS = [["Stream overlay", ["game:read", "combat:read", "events:read"], "Active", "Today, 8:41 PM", "Never", "Watches the game"], ["Dice bot", ["roll:create", "actor:read"], "Active", "Oct 24", "Dec 31", "Rolls for characters"], ["Old webhook", ["webhooks:manage"], "Revoked", "Sep 2", "Never", "Pick scopes yourself"]];
  var SCOPES = ["system:read", "game:read", "actor:read", "actor:write", "encounter:read", "encounter:write", "combat:read", "combat:write", "roll:create", "codex:read", "codex:write", "events:read", "webhooks:manage", "admin"];
  function stateTag(s) { return '<span class="tag ' + (s === "Active" ? "ready" : "draft") + '">' + s + "</span>"; }
  function scopeChips(sc) { return '<span class="i-scopes">' + sc.map(function (x) { return "<code>" + x + "</code>"; }).join("") + "</span>"; }
  var BROWSER = [{ n: "GM password", h: "Changing it keeps you signed in here and signs out every other GM browser.", ctl: btn("Change GM password") }, { n: "Sign out", h: "This browser asks for the GM password again next time.", ctl: btn("Sign out") }];
  var LOST = { n: "Every GM browser", h: "Use this when a device you signed in on is lost, and sign in again here after.", ctl: '<span class="e-btn i-danger">Sign out every GM browser</span>' };
  function credTable(phone) {
    if (phone) return '<div class="i-grp">' + CREDS.map(function (c) { return '<div class="i-row stack"><div class="i-txt"><b>' + c[0] + " " + stateTag(c[2]) + "</b><span>Last used " + c[3].replace(/^Today/, "today").replace(/^Never$/, "never") + " · expires " + c[4].replace(/^Never$/, "never") + "</span></div>" + scopeChips(c[1]) + "</div>"; }).join("") + "</div>";
    return '<table class="i-table"><thead><tr><th>Name</th><th>Scopes</th><th>State</th><th>Last used</th><th>Expires</th><th></th></tr></thead><tbody>' + CREDS.map(function (c) { return "<tr" + (c[2] === "Revoked" ? ' class="dim"' : "") + "><td><b>" + c[0] + "</b></td><td>" + scopeChips(c[1]) + "</td><td>" + stateTag(c[2]) + '</td><td class="d">' + c[3] + '</td><td class="d">' + c[4] + '</td><td class="r">' + (c[2] === "Active" ? btn("Rotate") + '<span class="e-btn i-dtext">Revoke</span>' : "") + btn("History") + "</td></tr>"; }).join("") + "</tbody></table>";
  }
  function credRow(phone) { return '<div class="i-grp"><div class="i-row stack"><div class="i-txt"><b>Integration credentials</b><span>A credential lets a tool such as a stream overlay reach this table with the scopes you pick.</span></div><div class="i-ctl">' + credTable(phone) + "</div></div></div>"; }
  function accessBody(phone) {
    var v = S.d4;
    if (v === "cards") return rowsOf(BROWSER.concat([LOST]), phone, { style: "row" }) + '<div class="i-rhead"><span class="e-eb">Integration credentials</span><small>2 active</small></div><div class="i-ccards' + (phone ? " on-ph" : "") + '">' + CREDS.map(function (c) { return '<div class="i-cc' + (c[2] === "Revoked" ? " dim" : "") + '"><div class="i-cch"><i class="i-lamp' + (c[2] === "Active" ? "" : " off") + '"></i><b>' + c[0] + "</b>" + stateTag(c[2]) + "</div>" + scopeChips(c[1]) + '<div class="i-ccm"><span>Last used <b>' + c[3] + "</b></span><span>Expires <b>" + c[4] + '</b></span></div><div class="i-acts">' + (c[2] === "Active" ? btn("Rotate", "reset") + '<span class="e-btn i-dtext">Revoke</span>' : "") + btn("History", "hist") + "</div></div>"; }).join("") + '<div class="i-cc new">' + IC.plus + "<b>New credential</b><span>Name a tool and pick what it may reach. Its secret shows once.</span></div></div>";
    if (v === "danger") return '<div class="i-rhead"><span class="e-eb">This browser</span></div>' + rowsOf(BROWSER, phone, { style: "row" }) + '<div class="i-rhead"><span class="e-eb">Tools that reach this table</span><small>2 active</small></div>' + credRow(phone) + '<div class="i-rhead"><span class="e-eb" style="color:var(--danger-text)">If a device is lost</span></div><div class="i-dzone">' + rowsOf([LOST], phone, { style: "row" }) + "</div>";
    if (v === "twocol" && !phone) return '<div class="i-two wide"><div><div class="i-rhead"><span class="e-eb">This browser and GM sign in</span></div>' + rowsOf(BROWSER.concat([LOST]), false, { style: "row" }).replace(/i-row"/g, 'i-row stack"') + '</div><div><div class="i-rhead"><span class="e-eb">Integration credentials</span><small>2 active</small></div><div class="i-grp">' + CREDS.map(function (c) { return '<div class="i-row stack' + (c[2] === "Revoked" ? " dim" : "") + '"><div class="i-txt"><b>' + c[0] + " " + stateTag(c[2]) + "</b><span>Last used " + c[3].replace(/^Today/, "today").replace(/^Never$/, "never") + " · expires " + c[4].replace(/^Never$/, "never") + "</span></div>" + scopeChips(c[1]) + "</div>"; }).join("") + "</div></div></div>";
    if (v === "recipes") return rowsOf(BROWSER.concat([LOST]), phone, { style: "row" }) + '<div class="i-rhead"><span class="e-eb">Integration credentials</span><small>2 active</small></div><div class="i-grp">' + CREDS.map(function (c) { return '<div class="i-row' + (phone ? " stack" : "") + (c[2] === "Revoked" ? " dim" : "") + '"><div class="i-txt"><b>' + c[0] + " " + stateTag(c[2]) + "</b><span>" + c[5] + " · last used " + c[3].replace(/^Today/, "today").replace(/^Never$/, "never") + '</span></div><div class="i-ctl">' + scopeChips(c[1]) + "</div></div>"; }).join("") + "</div>";
    return rowsOf(BROWSER.concat([LOST]), phone, { style: "row" }) + credRow(phone);
  }
  function access(phone) { return phone ? phFrame("access", accessBody(true)) : lapFrame("access", accessBody(false), { wide: S.d4 === "twocol" || S.d4 === "cards" }); }

  // A new credential: today's dialog, the scopes as a grid, or starting from what the tool is for.
  function credForm(phone) {
    var v = S.d4;
    var name = '<label class="i-lab">Name<span class="e-field">Initiative tracker</span></label>';
    var exp = '<label class="i-lab">Expires (leave empty for never)<span class="e-field" style="color:var(--text-muted)">mm/dd/yyyy, --:-- --</span></label>';
    var foot = '<div class="i-dfoot">' + btn("Cancel", "", "ghost") + cup("Create credential") + "</div>";
    var scopes;
    if (v === "grid") {
      var AREAS = [["System", "system:read", ""], ["The game", "game:read", ""], ["Characters", "actor:read", "actor:write"], ["Encounters", "encounter:read", "encounter:write"], ["Combat", "combat:read", "combat:write"], ["Rolls", "", "roll:create"], ["The Codex", "codex:read", "codex:write"], ["Events", "events:read", ""], ["Webhooks", "", "webhooks:manage"]];
      var on = { "game:read": 1, "combat:read": 1, "events:read": 1 };
      scopes = '<fieldset class="i-fs"><legend>What it may reach</legend><p class="i-note">Pick the fewest the tool needs. Pick at least one.</p><div class="i-sgrid"><span></span><span class="e-eb">Read</span><span class="e-eb">Change</span>' + AREAS.map(function (a) { function cell(s) { return s ? '<span class="i-scell' + (on[s] ? " on" : "") + '">' + (on[s] ? IC.check : "") + "<code>" + s + "</code></span>" : '<span class="i-scell none">·</span>'; } return "<b>" + a[0] + "</b>" + cell(a[1]) + cell(a[2]); }).join("") + '</div><div class="i-admin">' + sw(false, "admin") + '<span class="i-note" style="margin:0">Everything, including other credentials. Give it only to a tool you run yourself.</span></div></fieldset>';
    } else if (v === "recipes") {
      var RC = [["Stream overlay", "Shows the turn order and rolls on a stream", "game:read · combat:read · events:read", 1], ["Dice bot", "Rolls for characters from a chat", "roll:create · actor:read", 0], ["Codex sync", "Reads and writes Codex pages", "codex:read · codex:write", 0], ["Pick scopes yourself", "Choose from all fourteen", "", 0]];
      scopes = '<fieldset class="i-fs"><legend>What is it for?</legend><div class="i-recipes' + (phone ? " on-ph" : "") + '">' + RC.map(function (r) { return '<div class="i-rc' + (r[3] ? " on" : "") + '"><b>' + r[0] + "</b><span>" + r[1] + "</span>" + (r[2] ? "<code>" + r[2] + "</code>" : "") + "</div>"; }).join("") + '</div><p class="i-note">A use picks its scopes; you can change them before you create it.</p></fieldset>';
    } else {
      scopes = '<fieldset class="i-fs"><legend>What it may reach</legend><p class="i-note">Pick the fewest scopes the tool needs. Pick at least one.</p><div class="i-swl' + (phone ? " on-ph" : "") + '">' + SCOPES.map(function (s) { return tick(s === "game:read" || s === "combat:read" || s === "events:read", "<code>" + s + "</code>"); }).join("") + "</div></fieldset>";
    }
    return name + scopes + exp + foot;
  }
  function cred(phone) {
    var v = S.d4;
    if (v === "twocol" && !phone) return lapFrame("access", '<div class="i-two wide"><div><div class="i-rhead"><span class="e-eb">This browser and GM sign in</span></div>' + rowsOf(BROWSER.concat([LOST]), false, { style: "row" }).replace(/i-row"/g, 'i-row stack"') + '</div><div><div class="i-rhead"><span class="e-eb">New credential</span>' + btn("Back to the list", "back", "ghost") + '</div><div class="i-grp" style="padding:14px 16px">' + credForm(false) + "</div></div></div>", { wide: 1 });
    if (phone) return phFrame("access", '<div class="i-sheet">' + '<div class="i-grab"></div><div class="i-sh"><b>New credential</b>' + ico("close") + "</div>" + credForm(true).replace(/<div class="i-dfoot">[^]*$/, "") + '</div><div class="e-pfoot" style="grid-template-columns:1fr 1fr">' + btn("Cancel", "", "ghost") + cup("Create credential") + "</div>", { noHead: 1 });
    var page = access(false);
    return page.replace('<div class="i-body">', '<div class="i-body"><div class="scrim"></div><div class="ov i-dlg' + (v === "grid" ? " wide" : "") + '"><div class="ov-h"><h2>New credential</h2>' + ico("close") + '</div><div class="ov-b">' + credForm(false) + "</div></div>");
  }
