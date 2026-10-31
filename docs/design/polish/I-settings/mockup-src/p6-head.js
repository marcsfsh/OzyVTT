(function () {
  "use strict";
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* ---------- Icons ---------- */
  function svg(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>"; }
  var IC = {
    back: svg('<path d="M14 6l-6 6 6 6"/>'),
    fwd: svg('<path d="M10 6l6 6-6 6"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    down: svg('<path d="M7 10l5 5 5-5"/>'),
    up: svg('<path d="M7 14l5-5 5 5"/>'),
    dots: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    play: svg('<rect x="4" y="4" width="16" height="16"/><circle cx="9" cy="9" r=".8"/><circle cx="15" cy="15" r=".8"/><circle cx="15" cy="9" r=".8"/><circle cx="9" cy="15" r=".8"/>'),
    prep: svg('<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    codex: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h7"/>'),
    book: svg('<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z"/><path d="M5 16a4 4 0 0 1 4-4h10"/>'),
    screen: svg('<rect x="3" y="5" width="18" height="12"/><path d="M9 20h6M12 17v3"/>'),
    gear: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>'),
    party: svg('<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.4"/><path d="M3 19c1-3 3.5-4.5 6-4.5s5 1.5 6 4.5M15 15c2 0 4.5 1 5.5 4"/>'),
    moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
    out: svg('<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>'),
    pause: svg('<path d="M8 5v14M16 5v14"/>'),
    playtri: svg('<path d="M7 5l12 7-12 7z"/>'),
    eye: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
    ping: svg('<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="10"/>'),
    ruler: svg('<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>'),
    vol: svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>'),
    voloff: svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>'),
    popout: svg('<path d="M14 4h6v6M20 4l-8 8M18 14v6H4V6h6"/>'),
    map: svg('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    shield: svg('<path d="M12 3l7 3v5.5c0 4.6-3 8-7 9.5-4-1.5-7-4.9-7-9.5V6z"/><path d="M12 7.5v9M8.5 11h7"/>'),
    bolt: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
    prism: svg('<path d="M12 3l9 17H3z"/><path d="M12 3v17"/>'),
    hand: svg('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 14.5a1.5 1.5 0 0 1 2.4-1.8L8 15"/>'),
    paw: svg('<circle cx="7" cy="9" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="17" cy="9" r="2"/><path d="M12 11c-3 0-6 4-6 6.5 0 1.5 1.5 2.5 3 2 1-.3 2-.8 3-.8s2 .5 3 .8c1.5.5 3-.5 3-2C18 15 15 11 12 11z"/>'),
    eyeoff: svg('<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.3 3.9M6.5 7.6A17 17 0 0 0 2 12s4 7 10 7a10 10 0 0 0 4.4-1"/>')
  };

  IC.user = svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>');
  IC.grid = svg('<rect x="4" y="4" width="16" height="16"/><path d="M4 12h16M12 4v16"/>');
  IC.lvl = svg('<path d="M12 20V5M6 11l6-6 6 6"/>');
  IC.key = svg('<circle cx="8" cy="12" r="4"/><path d="M12 12h9M17 12v4M20 12v3"/>');
  IC.code = svg('<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>');
  IC.download = svg('<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>');
  IC.upload = svg('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>');
  IC.notes = svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>');
  IC.save = svg('<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>');
  IC.history = svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4M12 8v4l3 2"/>');
  IC.copy = svg('<rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/>');
  IC.qr = svg('<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>');
  IC.dl = svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>');
  IC.plug = svg('<path d="M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3"/>');
  IC.warn = svg('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>');
  IC.reset = svg('<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v5h5"/>');
  IC.dice = svg('<rect x="4" y="4" width="16" height="16"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="15" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/>');
  IC.sun = svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>');
  IC.hist = svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>');

  /* ---------- State ---------- */
  var S = { d1: "rail", d2: "row", d3: "moment", d4: "rows", pg: "home", show: "all", lz: "close" };
  var KEYS = ["d1", "d2", "d3", "d4", "pg"];
  var VALID = { d1: ["bar", "rail", "onepage", "home", "search", "who"], d2: ["row", "cols", "effect", "cards", "sentence", "changed"], d3: ["list", "presets", "moment", "split", "assist", "story"], d4: ["rows", "cards", "danger", "grid", "recipes", "twocol"], pg: ["home", "search", "device", "characters", "fights", "access", "cred"] };
  var A = window.AUDIT || {};

  /* ---------- Parts ---------- */
  function btn(t, i, cls) { return '<span class="e-btn' + (cls ? " " + cls : "") + '">' + (i ? IC[i] : "") + t + "</span>"; }
  function cup(t, cls) { return '<span class="cup' + (cls ? " " + cls : "") + '">' + t + "</span>"; }
  function ico(n) { return '<span class="e-ico">' + IC[n] + "</span>"; }
  function tick(on, label) { return '<span class="i-sw"><span class="e-cbx' + (on ? " on" : "") + '"></span>' + (label || "") + "</span>"; }
  function sw(on, label) { return '<span class="i-sw"><span class="sw' + (on ? " on" : "") + '"></span>' + (label || "") + "</span>"; }
  function seg(opts, on) { return '<span class="segc' + (opts.join("").length > 24 ? " long" : "") + '">' + opts.map(function (o) { return '<span class="' + (o === on ? "on" : "") + '">' + o + "</span>"; }).join("") + "</span>"; }
  function sel(t, w) { return '<span class="e-field i-sel"' + (w ? ' style="width:' + w + '"' : "") + ">" + t + IC.down + "</span>"; }
  function step(v) { return '<span class="i-step"><span>−</span><b>' + v + "</b><span>+</span></span>"; }
  function inl(t) { return '<span class="i-inl">' + t + IC.down + "</span>"; }
  function gmTag() { return '<span class="tag gm">GM only</span>'; }
  function face(t, c) { return '<span class="i-face" style="--fc:' + c + '">' + t + "</span>"; }

  /* ---------- The settings ---------- */
  var SECS = [["players", "Players", "user", "Who is at the table, and what they see of each other."], ["fights", "Encounters", "grid", "How the rules assistant and the turn order treat an encounter."], ["characters", "Characters", "lvl", "How players build and level their characters."], ["device", "Device", "gear", "Choices for this device alone."], ["access", "Access", "key", "Who can sign in as the GM, and which tools can reach this table."], ["api", "API", "code", "Every operation this server answers, with examples."]];
  var SUM = { players: "Join address · name and class · 3 at the table", fights: "Enforce · six checks · hits applied by the GM", characters: "Players build · level 20 · four methods", device: "Dusk · auto-roll · pinch zoom off", access: "2 credentials active", api: "405 operations" };
  function secOf(id) { for (var i = 0; i < SECS.length; i++) if (SECS[i][0] === id) return SECS[i]; return SECS[0]; }
  var JOIN = "http://192.168.1.20:3302";
  var AT_TABLE = [["Borin Stoneguard", "Dwarf Fighter 7", "Connected", "var(--party)"], ["Lyra Emberwise", "Elf Wizard 7", "Connected", "#ffd23f"], ["Mirena Dawnbright", "Human Cleric 7", "Away", "var(--cyan)"]];
  function joinCtl(phone) { return '<div class="i-join"><div class="i-url"><span class="e-eb">Players join at</span><b>' + JOIN + '</b><div class="i-acts">' + btn("Copy", "copy") + btn(phone ? "Show QR code" : "Show it larger", "qr") + '</div><span class="e-muted">Phones on the same Wi-Fi open it or scan the code.</span></div>' + (phone ? "" : qrSvg()) + "</div>"; }
  // A stand-in QR code: three finder squares and a fixed scatter of modules.
  function qrSvg() {
    var n = 25, r = "", seed = 7;
    function fin(x, y) { return '<rect x="' + x + '" y="' + y + '" width="7" height="7" fill="#000"/><rect x="' + (x + 1) + '" y="' + (y + 1) + '" width="5" height="5" fill="#fff"/><rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="3" height="3" fill="#000"/>'; }
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      if ((x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9)) continue;
      seed = (seed * 9301 + 49297) % 233280;
      if (seed / 233280 < 0.48) r += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="#000"/>';
    }
    return '<svg class="i-qr" viewBox="-2 -2 29 29" aria-hidden="true"><rect x="-2" y="-2" width="29" height="29" fill="#fff"/>' + fin(0, 0) + fin(n - 7, 0) + fin(0, n - 7) + r + "</svg>";
  }
  function tableCtl(phone) {
    return '<div class="i-tbl">' + AT_TABLE.map(function (a) { return '<div class="i-trow">' + face(a[0].split(" ").map(function (w) { return w[0]; }).join(""), a[3]) + "<span><b>" + a[0] + "</b><small>" + a[1] + '</small></span><span class="i-pres' + (a[2] === "Away" ? " off" : "") + '"><i></i>' + a[2] + "</span>" + ico("dots") + "</div>"; }).join("") + '</div><div style="margin-top:10px">' + btn("Preview the table screen", "eye") + "</div>";
  }
  // Each row: n name, h its line, ctl a control at the right, wide a control under, note a line under the control, eff
  // what the current choice does, sent the row as a sentence, def the default when it was changed.
  var ROWS = {
    players: [
      { n: "Join address", h: "Share it at the start of each session so players can join.", wide: "join", eff: "Players on the same Wi-Fi open it or scan the code.", sent: "Players join at <b class=\"i-mono\">" + JOIN + "</b> " },
      { n: "What players see of each other", h: "Each player always has their own character in full.", ctl: sel("Name and class", "220px"), eff: "Name and class: players see who is in the party and what they play.", sent: "Players see each other's " + inl("name and class") + "." },
      { n: "At the table", h: "The characters players have claimed, and whether each player is connected.", wide: "table", eff: "Three characters are claimed; two players are connected.", sent: "" }
    ],
    fights: [
      { id: "assist", n: "Rules assistant", h: "Each encounter starts with this, and you can change it mid-encounter on the Table.", wide: "assist", eff: "Enforce blocks an illegal move until you allow it.", sent: "The rules assistant " + inl("enforces the rules") + " and checks " + inl("all six things") + "." },
      { id: "hits", n: "Players' hits", h: "Whether a player's damage waits for you to apply it.", ctl: seg(["Applied by the GM", "Applied immediately"], "Applied by the GM"), eff: "A player's hit waits in Needs you until you apply it.", sent: "Players' hits are " + inl("applied by the GM") + "." },
      { id: "init", n: "Players' initiative", h: "When players roll their own initiative, whether turns wait for every roll.", ctl: seg(["Start turns immediately", "Wait until everyone has rolled"], "Start turns immediately"), eff: "Turns start at once; a late roll joins the order where it falls.", sent: "When players roll initiative, turns " + inl("start immediately") + "." },
      { id: "d20", n: "Players' d20 rolls", h: "Attacks, checks, saves, initiative and death saves, unless an encounter chooses its own.", ctl: seg(["Total", "Each die", "App rolls"], "Each die"), note: "Players type what each die shows. The app adds the bonus.", eff: "Players type what each die shows. The app adds the bonus.", sent: "For d20 rolls, players " + inl("type each die") + "." },
      { id: "dmg", n: "Players' damage", h: "Damage dice, unless an encounter chooses its own.", ctl: seg(["Total", "Each die", "App rolls"], "App rolls"), note: "The app rolls players' dice.", eff: "The app rolls players' damage.", sent: "For damage, " + inl("the app rolls") + "." },
      { id: "tgt", n: "Who picks targets", h: "In an encounter, the player aims their own actions, or asks you to choose.", ctl: seg(["The player", "The GM"], "The player"), note: "Players tap an action and pick its target on the map.", eff: "Players tap an action and pick its target on the map.", sent: inl("The player") + " picks the targets." },
      { id: "hp", n: "Health display", h: "Each token's own menu can change it for that token.", ctl: sel("Status badge", "190px"), note: "A status badge shows to everyone, so it has no GM-only setting.", eff: "A status badge on each token, shown to everyone.", sent: "Health shows as " + inl("a status badge") + ", to everyone." },
      { id: "tok", n: "New tokens", h: "Whether a newly staged character or monster starts shown to players.", ctl: sw(true, "Shown to players"), eff: "A new token starts shown to players.", sent: "New tokens start " + inl("shown to players") + "." }
    ],
    characters: [
      { n: "Who builds characters", h: "When this is off, only you can build and level characters.", ctl: sw(true, "Players build and level their own characters"), eff: "On: players build and level their own characters.", sent: "Players " + inl("build and level their own characters") + "," },
      { n: "Max party level", h: "Players can build and level their own characters up to this level.", ctl: step(20), eff: "Players can level up to 20.", sent: "up to level " + inl("20") + ".", chg: "Default: 20" },
      { n: "Ability scores", h: "Players choose from the methods that are on, and at least one stays on.", wide: "methods", eff: "Four methods are on; Roll uses 4d6kh3.", sent: "They choose ability scores by " + inl("standard array, point buy, roll or 4d6kh3") + "." },
      { n: "Hit point rolls", h: "A character who rolls hit points on a new level never gets less than the average.", ctl: sw(false, "Raise a roll below the average"), eff: "Off: a roll below the average stays as rolled.", sent: "A hit point roll below the average " + inl("stays as rolled") + "." },
      { n: "Random characters", h: "You can always roll one, and this lets players roll their own.", ctl: sw(false, "Players can roll their own"), eff: "Off: only you can roll a random character.", sent: "Players " + inl("can't roll") + " random characters of their own." }
    ],
    device: [
      { n: "Theme", h: "It applies to this device alone.", ctl: seg(["Dusk", "Dawn"], "Dusk"), eff: "Dusk: the night palette on this device.", sent: "This device shows " + inl("Dusk") + "." },
      { n: "Reduce transparency", h: "Panels turn solid, and the glows go.", ctl: sw(false, "Reduce transparency"), eff: "Off: panels show the sky through them, with their glows.", sent: "Panels stay " + inl("see-through, with their glows") + "." },
      { n: "How you roll", h: "With I roll my dice, you type what your own dice show.", ctl: seg(["Auto-roll", "I roll my dice"], "Auto-roll"), eff: "Auto-roll: the app rolls your dice.", sent: inl("The app rolls") + " my dice." },
      { n: "Pinch zoom", h: "Two fingers on a touch screen zoom the whole page while this is on, and maps zoom with two fingers either way.", ctl: sw(false, "Let pinch zoom the page"), eff: "Off: two fingers zoom maps only.", sent: "Two fingers zoom " + inl("maps only") + "." },
      { n: "Arrange new encounters", gm: 1, h: "A new encounter opens on your table first, so you can place tokens before players see it.", ctl: sw(true, "Open new encounters for arranging"), eff: "On: a new encounter opens on your table first.", sent: "A new encounter opens " + inl("on my table first") + ", so I can place tokens.", chg: "Default: Off" }
    ]
  };
  var CHECKS = ["Check movement", "Check the action economy", "Check limited uses", "Check targeting, range and cover", "Check spell slots and prepared spells", "Check spell components"];
  function wideOf(k, phone) {
    if (k === "join") return joinCtl(phone);
    if (k === "table") return tableCtl(phone);
    if (k === "methods") return '<div class="sw-row i-meth">' + ["Standard array", "Point buy", "Roll", "Custom formula"].map(function (m) { return tick(true, m); }).join("") + '</div><div style="display:flex;align-items:center;gap:8px;margin-top:10px"><span class="e-field" style="flex:1;max-width:320px;font-family:var(--f-num);font-size:18px">4d6kh3</span>' + btn("Save formula") + "</div>";
    if (k === "assist") return seg(["Enforce", "Advise", "Off"], "Enforce") + '<p class="i-note">Enforce blocks an illegal move until you allow it.</p><div class="i-checks"><span class="e-eb">What it checks</span>' + CHECKS.map(function (c) { return tick(true, c); }).join("") + "</div>";
    return "";
  }

  /* ---------- The frame: the app's bar from A, then Settings as the chosen frame (decision 1) ---------- */
  function topBar() {
    var nav = '<nav class="ap-nav" aria-hidden="true">' + ["Play", "Prep", "Codex", "Compendium"].map(function (n) { return "<span>" + n + "</span>"; }).join("") + "</nav>";
    var me = '<span class="me-btn"><span class="face lg gm">GM</span><span class="online">3</span>' + IC.down + "</span>";
    return '<header class="ap-bar"><span class="wm"><span class="wm-ozy">OZY</span><span class="wm-vtt">vtt</span></span>' + nav + '<div class="ap-end"><span class="ico">' + IC.search + "</span>" + me + "</div></header>";
  }
  var COUNT = 31;
  function find(t) { return '<span class="find">' + IC.search + (t || "Search settings") + "<kbd>Ctrl K</kbd></span>"; }
  function primaryOf(sec) { return sec === "access" ? cup("New credential") : sec === "api" ? cup("Download OpenAPI") : ""; }
  function tabs(sec, icons) { return SECS.map(function (s) { return '<span class="sb-tab' + (s[0] === sec ? " on" : "") + '">' + (icons ? IC[s[2]] : "") + s[1] + "</span>"; }).join(""); }
  function head(sec) { var s = secOf(sec); return '<div class="i-head"><h1>' + s[1] + "</h1><p>" + s[3] + "</p>" + (S.d2 === "changed" && (sec === "device" || sec === "characters") ? '<span class="i-chgd"><i></i>1 changed from the default<span class="e-btn ghost">Show only changed</span></span>' : "") + "</div>"; }
  function railList(sec, q) {
    if (S.d1 === "who") {
      var G = [["This table", "Everyone at it", ["players", "fights", "characters"]], ["This device", "Only this browser", ["device"]], ["Access and tools", "Other GM browsers and integrations", ["access", "api"]]];
      return G.map(function (g) { return '<div class="i-rg"><span class="e-eb">' + g[0] + "</span><small>" + g[1] + "</small></div>" + g[2].map(function (id) { var s = secOf(id); return '<div class="i-ri' + (id === sec ? " on" : "") + '">' + IC[s[2]] + "<span><b>" + s[1] + "</b></span></div>"; }).join(""); }).join("");
    }
    // The settled side list (E2 2.1): an eyebrow, a row a section with its icon, its name and a count, the chosen lit.
    var N = { players: 3, fights: 6, characters: "", device: "", access: 2, api: 405 };
    var codex = [["Backup", "download", ""], ["Restore", "upload", ""], ["Bring in notes", "notes", ""], ["Autosave", "save", "On"], ["Version history", "history", 12]];
    return '<div class="u-list"><span class="e-eb">Sections</span>' + SECS.map(function (s) { return '<div class="u-ri' + (s[0] === sec ? " on" : "") + '">' + IC[s[2]] + s[1] + '<span class="n">' + N[s[0]] + "</span></div>"; }).join("") + '<span class="e-eb">Codex</span>' + codex.map(function (c) { return '<div class="u-ri' + (c[0] === sec ? " on" : "") + '">' + IC[c[1]] + c[0] + '<span class="n">' + c[2] + "</span></div>"; }).join("") + "</div>";
  }
  function lapFrame(sec, inner, o) {
    o = o || {};
    var d = S.d1, bar, body, pr = primaryOf(sec);
    var col = '<div class="i-col' + (o.wide ? " wide" : "") + '">' + (o.noHead ? "" : head(sec)) + inner + "</div>";
    if (d === "bar") { bar = '<div class="sb titled"><span class="sb-title">Settings</span><div class="sb-tabs">' + tabs(sec) + '</div><div class="sb-end">' + find() + pr + "</div></div>"; body = col; }
    else if (d === "rail" || d === "who") { bar = '<div class="sb titled"><span class="sb-title">Settings</span><div class="sb-end">' + pr + "</div></div>"; body = '<div class="i-split"><aside class="i-rail m"><div style="padding:12px 12px 8px">' + find(o.q ? '<span style="color:var(--text)">' + o.q + "</span>" : "Search settings") + "</div>" + (o.rail || railList(sec)) + '</aside><div class="i-main">' + col + "</div></div>"; }
    else if (d === "onepage") { var nx = SECS[Math.min(SECS.indexOf(secOf(sec)) + 1, SECS.length - 1)]; bar = '<div class="sb titled"><span class="sb-title">Settings</span><div class="sb-end">' + find() + pr + "</div></div>"; body = '<div class="i-split"><aside class="i-rail i-index"><span class="e-eb" style="padding:14px 16px 6px;display:block">On this page</span>' + SECS.map(function (s) { return '<div class="i-ri' + (s[0] === sec ? " on" : "") + '">' + IC[s[2]] + "<span><b>" + s[1] + "</b></span></div>"; }).join("") + '</aside><div class="i-main">' + (o.noHead ? col : '<div class="i-col">' + (SECS.indexOf(secOf(sec)) > 0 ? '<div class="i-prev">… the end of ' + SECS[SECS.indexOf(secOf(sec)) - 1][1] + "</div>" : "") + head(sec) + inner + (nx[0] !== sec ? '<div class="i-next">' + head(nx[0]) + "</div>" : "") + "</div>") + "</div></div>"; }
    else if (d === "home") { bar = '<div class="sb titled"><span class="sb-title">Settings</span>' + (o.isHome ? "" : '<span class="i-crumb">' + IC.fwd + secOf(sec)[1] + "</span>") + '<div class="sb-end">' + find() + pr + "</div></div>"; body = col; }
    else { bar = '<div class="sb titled"><span class="sb-title">Settings</span><div class="sb-tabs">' + tabs(sec) + '</div><div class="sb-end">' + pr + '</div></div><div class="i-band">' + IC.search + (o.q ? '<b>' + o.q + "</b>" : "<span>Search " + COUNT + " settings: a name, or what it does</span>") + "<kbd>Ctrl K</kbd></div>"; body = col; }
    return '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-base">' + topBar() + '<div class="ap-pane e-pane"' + (d === "search" ? ' style="grid-template-rows:auto auto minmax(0,1fr)"' : "") + ">" + bar + '<div class="e-body"><div class="i-body">' + body + "</div></div></div></div></div>";
  }
  function bottom() { var t = [["Play", "play"], ["Prep", "prep"], ["Codex", "codex"], ["Compendium", "book"], ["More", "dots", 1]]; return '<nav class="ap-bottom five" aria-hidden="true">' + t.map(function (x) { return '<span class="btab' + (x[2] ? " on" : "") + '">' + IC[x[1]] + x[0] + "</span>"; }).join("") + "</nav>"; }
  function phFrame(sec, inner, o) {
    o = o || {};
    var d = S.d1, top = "", pr = sec === "access" ? '<span class="ico">' + IC.plus + "</span>" : "";
    var list = o.list;
    if (list || d === "bar" || d === "onepage" || d === "search") top = '<header class="pbar"><h1>Settings</h1><div class="end">' + pr + (d === "search" ? "" : '<span class="ico">' + IC.search + "</span>") + "</div></header>";
    else top = '<header class="pbar"><span class="ico" style="margin-left:-8px">' + IC.back + "</span><h1>" + secOf(sec)[1] + '</h1><div class="end">' + pr + "</div></header>";
    var strip = "";
    if (!list && (d === "bar" || d === "search")) strip = '<div class="pstrip">' + SECS.map(function (s) { return '<span class="sb-tab' + (s[0] === sec ? " on" : "") + '">' + s[1] + "</span>"; }).join("") + "</div>";
    if (!list && d === "onepage") strip = '<div class="pstrip i-chips">' + SECS.map(function (s) { return '<span class="chip' + (s[0] === sec ? " on" : "") + '">' + s[1] + "</span>"; }).join("") + "</div>";
    var band = d === "search" || (o.q && d === "onepage") ? '<div class="i-band on-ph">' + IC.search + (o.q ? "<b>" + o.q + "</b>" : "<span>Search " + COUNT + " settings</span>") + "</div>" : "";
    var rows = "auto " + (band ? "auto " : "") + (strip ? "auto " : "") + "minmax(0,1fr)";
    return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-base">' + top + '<div class="ap-pane e-pane" style="grid-template-rows:' + rows.replace(/^auto /, "") + '">' + band + strip + '<div class="e-body"><div class="i-body on-ph"><div class="i-col">' + (o.noHead || list ? "" : head(sec)) + inner + "</div></div></div></div>" + bottom() + "</div></div>";
  }
