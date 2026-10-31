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
    dots: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
    filter: svg('<path d="M4 6h16M7 12h10M10 18h4"/>'),
    sort: svg('<path d="M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
    eye: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeoff: svg('<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.3 3.9M6.5 7.6A17 17 0 0 0 2 12s4 7 10 7a10 10 0 0 0 4.4-1"/>'),
    people: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.8-3.6 3.2-5.5 6-5.5s5.2 1.9 6 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.6c2.4.2 4.2 2 5 5.4"/>'),
    play: svg('<rect x="4" y="4" width="16" height="16"/><circle cx="9" cy="9" r=".8"/><circle cx="15" cy="15" r=".8"/><circle cx="15" cy="9" r=".8"/><circle cx="9" cy="15" r=".8"/>'),
    prep: svg('<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    codex: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h7"/>'),
    book: svg('<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z"/><path d="M5 16a4 4 0 0 1 4-4h10"/>'),
    cls: svg('<path d="M12 3l7 3v5.5c0 4.6-3 8-7 9.5-4-1.5-7-4.9-7-9.5V6z"/>'),
    sub: svg('<path d="M12 3l7 3v5.5c0 4.6-3 8-7 9.5-4-1.5-7-4.9-7-9.5V6z"/><path d="M12 8v8M9 11h6"/>'),
    species: svg('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>'),
    bg: svg('<path d="M7 4h11v13a3 3 0 0 1-3 3H6a2 2 0 0 1-2-2v-1h11"/><path d="M7 4a2 2 0 0 0-2 2v2h2"/>'),
    feat: svg('<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>'),
    spell: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>'),
    item: svg('<path d="M10 3h4M10.5 3v5.5L5.4 17a2 2 0 0 0 1.7 3h9.8a2 2 0 0 0 1.7-3l-5.1-8.5V3"/><path d="M7.5 14h9"/>'),
    monster: svg('<path d="M5 11a7 7 0 0 1 14 0v4l-2 2v3h-3v-2h-4v2H7v-3l-2-2z"/><circle cx="9.2" cy="11.5" r="1.3"/><circle cx="14.8" cy="11.5" r="1.3"/>'),
    list: svg('<path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1"/>'),
    clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>'),
    copy: svg('<rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/>'),
    swords: svg('<path d="M4 4l9 9M4 4h4M4 4v4M20 4l-9 9M20 4h-4M20 4v4M7 17l-3 3M17 17l3 3M9.5 15.5l-2-2M14.5 15.5l2-2"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    warn: svg('<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.3"/>'),
    pin: svg('<path d="M9 3h6l-1 6 4 4H6l4-4z"/><path d="M12 13v8"/>'),
    rules: svg('<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z"/><path d="M9 9h6M9 13h6"/>'),
    sheet: svg('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>')
  };

  /* ---------- State ---------- */
  var S = { d1: "shelves", d2: "panes", d4: "studio", g1: "rail", g2: "rail", g3: "rows", g4: "dialog", g5: "side", pg: "sources", show: "all", lz: "close", tab: "share", stab: "card" };
  var KEYS = ["g1", "g2", "g3", "g4", "g5", "pg"];
  var VALID = { g1: ["today", "shelf", "rail", "kinds", "dash"], g2: ["today", "grid", "rail", "chars", "panes"], g3: ["today", "rows", "line", "diff", "compare"], g4: ["today", "rows", "inline", "dialog", "side"], g5: ["today", "chips", "side", "menu", "rows"], d1: ["shelves", "twoshelves", "hbshelf", "find", "pins", "findshelves"], d2: ["panes", "sidebar", "summary", "preview", "walk", "lanes"], d4: ["studio", "cardrail", "topsteps", "form", "folds", "paired"], pg: ["sources", "sharing", "history", "merge", "rshare"] };
  var A = window.AUDIT || {};

  /* ---------- Data: the SRD and one table's homebrew ---------- */
  // [name, icon, SRD, homebrew, drafts, shared]
  var KINDS = [["Classes", "cls", 12, 0, 0, 0], ["Subclasses", "sub", 12, 0, 0, 0], ["Species", "species", 9, 0, 0, 0], ["Backgrounds", "bg", 4, 0, 0, 0], ["Feats", "feat", 19, 0, 0, 0], ["Spells", "spell", 339, 1, 0, 1], ["Items", "item", 479, 1, 0, 1], ["Monsters", "monster", 330, 2, 1, 0], ["Spell lists", "list", 0, 0, 0, 0]];
  // [name, kind icon, kind, state, who, based on, changed, problem]
  var HOMEBREW = [
    ["Goblin Boss of the Ashen Hand", "monster", "Monster", "Draft", "Hidden", "Goblin Boss", "Today", ""],
    ["Grey Palm Raider", "monster", "Monster", "Published", "Hidden", "Goblin Warrior", "Yesterday", "Its Shortbow has no range"],
    ["Ash Brand", "spell", "Spell", "Published", "Everyone", "", "Oct 25", ""],
    ["Lantern of the Choir", "item", "Item", "Published", "Mirena", "", "Oct 25", ""]
  ];
  // [name, CR, size and type, AC, HP, homebrew state or "", who, problem]
  var MONS = [
    ["Gnoll Warrior", "1/2", "Medium Fiend", 15, 27], ["Goat", "0", "Medium Beast", 10, 4], ["Goblin Boss", "1", "Small Fey", 17, 21],
    ["Goblin Boss of the Ashen Hand", "1", "Small Fey", 17, 27, "Draft", "Hidden"], ["Goblin Minion", "1/8", "Small Fey", 12, 7], ["Goblin Warrior", "1/4", "Small Fey", 15, 10],
    ["Gold Dragon Wyrmling", "3", "Medium Dragon", 17, 60], ["Gorgon", "5", "Large Construct", 19, 114], ["Gray Ooze", "1/2", "Medium Ooze", 9, 22],
    ["Green Dragon Wyrmling", "2", "Medium Dragon", 17, 38], ["Green Hag", "3", "Medium Fey", 17, 82], ["Grey Palm Raider", "1/4", "Small Fey", 15, 13, "Published", "Hidden", "Its Shortbow has no range"],
    ["Grick", "2", "Medium Aberration", 14, 54], ["Griffon", "2", "Large Monstrosity", 12, 59], ["Guard", "1/8", "Medium Humanoid", 16, 11], ["Guard Captain", "4", "Medium Humanoid", 18, 75]
  ];
  var CHARS = ["Borin Stoneguard", "Mirena Dawnbright", "Lyra Emberwise"];

  /* The Goblin Boss as the SRD prints it, and the GM's copy. */
  var BOSS = {
    n: "Goblin Boss", ty: "Small Fey (Goblinoid), Chaotic Neutral",
    lines: [["AC", "17"], ["Initiative", "+2 (12)"], ["HP", "21 (6d6)"], ["Speed", "30 ft."]],
    ab: [["STR", 10, "+0", "+0"], ["DEX", 15, "+2", "+2"], ["CON", 10, "+0", "+0"], ["INT", 10, "+0", "+0"], ["WIS", 8, "-1", "-1"], ["CHA", 10, "+0", "+0"]],
    more: [["Skills", "Stealth +6"], ["Gear", "Chain Shirt, Scimitar, Shield, Shortbow"], ["Senses", "Darkvision 60 ft.; Passive Perception 9"], ["Languages", "Common, Goblin"], ["CR", "1 (XP 200; PB +2)"]],
    secs: [
      ["Actions", [["Multiattack.", "The goblin makes two attacks, using Scimitar or Shortbow in any combination."], ["Scimitar.", "Melee Attack Roll: +4, reach 5 ft. Hit: 5 (1d6 + 2) Slashing damage, plus 2 (1d4) Slashing damage if the attack roll had Advantage."], ["Shortbow.", "Ranged Attack Roll: +4, range 80/320 ft. Hit: 5 (1d6 + 2) Piercing damage, plus 2 (1d4) Piercing damage if the attack roll had Advantage."]]],
      ["Bonus Actions", [["Nimble Escape.", "The goblin takes the Disengage or Hide action."]]],
      ["Reactions", [["Redirect Attack.", "Trigger: A creature the goblin can see makes an attack roll against it. Response: The goblin chooses an ally within 5 feet of itself. The goblin and that ally swap places, and the ally becomes the target of the attack instead."]]]
    ]
  };
  var COPY = JSON.parse(JSON.stringify(BOSS));
  COPY.n = "Goblin Boss of the Ashen Hand";
  COPY.lines[2] = ["HP", "27 (6d6 + 6)"];
  COPY.ab[2] = ["CON", 12, "+1", "+1"];
  COPY.secs[1][1].push(["Grey Palm.", "The goblin marks a creature it can see within 30 feet. Its allies have Advantage on attack rolls against that creature until the start of the goblin's next turn."]);
  var CHANGED = { n: 1, HP: 1, CON: 1, "Grey Palm.": 1 };

  /* ---------- Parts ---------- */
  function ic(n, st) { return st ? IC[n].replace("<svg", '<svg style="' + st + '"') : IC[n]; }
  function btn(t, i, cls) { return '<span class="e-btn' + (cls ? " " + cls : "") + '">' + (i ? IC[i] : "") + t + "</span>"; }
  function menu(t, cls) { return '<span class="e-btn' + (cls ? " " + cls : "") + '">' + t + IC.down + "</span>"; }
  function ico(n) { return '<span class="e-ico">' + IC[n] + "</span>"; }
  function cup(t, cls) { return '<span class="cup' + (cls ? " " + cls : "") + '">' + t + "</span>"; }
  function hid(t) { return '<span class="f-hid">' + ic("eyeoff", "width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2") + (t || "Hidden") + "</span>"; }
  function all(t) { return '<span class="f-all">' + ic("eye", "width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2") + (t || "Everyone") + "</span>"; }
  function who(w) { return w === "Hidden" ? hid() : w === "Everyone" ? all() : all(w); }
  function src(hb) { return '<span class="g-src' + (hb ? " hb" : "") + '">' + (hb ? "HOMEBREW" : "SRD 5.2.1") + "</span>"; }
  function st(s) { return '<span class="e-st' + (s === "Draft" ? " draft" : "") + '">' + s + "</span>"; }
  function prob(t) { return '<span class="g-prob">' + t + "</span>"; }
  function grp(title, inner, open) { return '<div class="' + (open ? "e-open" : "e-grp") + '"><span class="e-eb">' + title + "</span>" + inner + "</div>"; }
  function gi(n) { return '<span class="g-ic">' + IC[n] + "</span>"; }
  function aud(on) { return '<span class="g-aud"><span class="' + (on === "Hidden" ? "on h" : "") + '">' + IC.eyeoff + "Hidden</span><span class=\"" + (on === "Everyone" ? "on" : "") + '">' + IC.eye + "Everyone</span><span class=\"" + (on === "Characters" ? "on" : "") + '">' + IC.people + "Characters</span></span>"; }
  function saved() { return '<span class="e-ready"><i class="e-lamp ok"></i>Saved</span>'; }

  /* The stat block. o.hb draws the copy; o.mark puts what differs from the SRD in amber; o.cut stops after that many
     sections; o.edit underlines each line as something to press. */
  function sb(o) {
    o = o || {};
    var M = o.hb ? COPY : BOSS;
    function mk(k) { return o.mark && CHANGED[k] ? " g-chg" : ""; }
    function ed(cur) { return o.edit ? ' g-edit' + (cur ? " cur" : "") : ""; }
    var h = '<div class="g-sb' + (o.small ? " small" : "") + '"><h3 class="nm' + mk("n") + '">' + M.n + '</h3><span class="ty' + (o.edit ? " g-edit" : "") + '">' + M.ty + '</span><div class="hr"></div>';
    h += M.lines.map(function (l) { return '<div class="ln' + mk(l[0]) + ed(o.edit && l[0] === "HP") + '"><b>' + l[0] + "</b>" + l[1] + "</div>"; }).join("");
    h += '<div class="g-ab">' + M.ab.map(function (a) { return '<div class="' + mk(a[0]).trim() + '"><small>' + a[0] + "</small><b>" + a[1] + "</b><i>" + a[2] + (o.small ? "" : " · save " + a[3]) + "</i></div>"; }).join("") + "</div>";
    h += M.more.slice(0, o.small ? 3 : 5).map(function (l) { return '<div class="ln' + ed() + '"><b>' + l[0] + "</b>" + l[1] + "</div>"; }).join("");
    var secs = M.secs.slice(0, o.cut == null ? 3 : o.cut);
    if (o.part === "secs") h = '<div class="g-sb' + (o.small ? " small" : "") + '">';
    h += secs.map(function (s) { return "<h4>" + s[0] + "</h4>" + s[1].map(function (a) { return '<p class="act' + mk(a[0]) + ed() + '"><b>' + a[0] + "</b>" + a[1] + "</p>"; }).join("") + (o.edit ? '<span class="g-add">' + IC.plus + "Add " + (s[0] === "Actions" ? "an action" : s[0] === "Reactions" ? "a reaction" : "a bonus action") + "</span>" : ""); }).join("");
    return h + "</div>";
  }

  /* ---------- The frame ---------- */
  function topBar() {
    var nav = '<nav class="ap-nav" aria-hidden="true">' + ["Play", "Prep", "Codex", "Compendium"].map(function (n) { return "<span" + (n === "Compendium" ? ' class="on" data-seat' : "") + ">" + n + "</span>"; }).join("") + "</nav>";
    var me = '<span class="me-btn"><span class="face lg gm">GM</span><span class="online">2</span>' + IC.down + "</span>";
    return '<header class="ap-bar"><span class="wm"><span class="wm-ozy">OZY</span><span class="wm-vtt">vtt</span></span>' + nav + '<div class="ap-end"><span class="ico">' + IC.search + "</span>" + me + "</div></header>";
  }
  var CPAGES = ["Home", "Browse", "Sources", "Sharing"];
  function compBar(on) {
    var tabs = CPAGES.map(function (t) { return '<span class="sb-tab' + (t === on ? " on" : "") + '">' + t + "</span>"; }).join("");
    return '<div class="sb titled"><span class="sb-title">Compendium</span><div class="sb-tabs">' + tabs + '</div><div class="sb-end"><span class="find">' + IC.search + "Search the SRD and homebrew<kbd>Ctrl K</kbd></span>" + btn("Rules", "rules") + cup("New homebrew") + "</div></div>";
  }
  function lap(on, inner) { return '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-base">' + topBar() + '<div class="ap-pane e-pane">' + compBar(on) + '<div class="e-body"><div class="g-body">' + inner + "</div></div></div></div></div>"; }
  function bottom() {
    var tabs = [["Play", "play"], ["Prep", "prep"], ["Codex", "codex"], ["Compendium", "book", 1], ["More", "dots"]];
    return '<nav class="ap-bottom five" aria-hidden="true">' + tabs.map(function (t) { return '<span class="btab' + (t[2] ? " on" : "") + '">' + IC[t[1]] + t[0] + "</span>"; }).join("") + "</nav>";
  }
  function pstrip(on) { return '<div class="pstrip">' + CPAGES.map(function (t) { return '<span class="sb-tab' + (t === on ? " on" : "") + '">' + t + "</span>"; }).join("") + "</div>"; }
  function ph(on, inner, opts) {
    opts = opts || {};
    var icons = opts.icons || ["search", "plus"];
    var head = '<header class="pbar">' + (opts.back ? '<span class="ico" style="margin-left:-8px">' + IC.back + "</span>" : "") + "<h1>" + (opts.title || "Compendium") + '</h1><div class="end">' + icons.map(function (n) { return '<span class="ico">' + IC[n] + "</span>"; }).join("") + "</div></header>";
    return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-base">' + head + '<div class="ap-pane e-pane" style="' + (opts.noStrip ? "grid-template-rows:minmax(0,1fr)" : "") + '">' + (opts.noStrip ? "" : pstrip(on)) + '<div class="e-body"><div class="e-ph">' + inner + "</div></div></div>" + bottom() + "</div></div>";
  }
