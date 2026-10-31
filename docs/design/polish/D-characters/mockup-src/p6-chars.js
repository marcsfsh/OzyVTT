(function () {
  "use strict";
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* ---------- Icons ---------- */
  function svg(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>"; }
  var IC = {
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    down: svg('<path d="M7 10l5 5 5-5"/>'),
    right: svg('<path d="M10 7l5 5-5 5"/>'),
    left: svg('<path d="M14 7l-5 5 5 5"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    dots: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    die: svg('<rect x="4" y="4" width="16" height="16"/><circle cx="9" cy="9" r=".8"/><circle cx="15" cy="15" r=".8"/><circle cx="15" cy="9" r=".8"/><circle cx="9" cy="15" r=".8"/>'),
    file: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>'),
    play: svg('<rect x="4" y="4" width="16" height="16"/><circle cx="9" cy="9" r=".8"/><circle cx="15" cy="15" r=".8"/><circle cx="15" cy="9" r=".8"/><circle cx="9" cy="15" r=".8"/>'),
    prep: svg('<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    codex: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h7"/>'),
    book: svg('<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z"/><path d="M5 16a4 4 0 0 1 4-4h10"/>'),
    log: svg('<path d="M5 5h14M5 10h14M5 15h9M5 20h6"/>'),
    sheet: svg('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>'),
    up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>')
  };
  function ico(k) { return '<span class="ico">' + IC[k] + "</span>"; }

  /* ---------- State ---------- */
  var S = { d1: "bands", d2: "detail", d3: "dialog", d4: "band", pg: "roster", show: "all" };
  var KEYS = ["d1", "d2", "d3", "d4", "pg"];
  var VALID = { d1: ["cards", "table", "bands", "split"], d2: ["detail", "live", "one", "onsheet"], d3: ["steps", "page", "sheet", "dialog"], d4: ["band", "page", "cards", "strip"], pg: ["roster", "builder", "level", "member"] };
  function gm() { return S.pg !== "member"; }

  /* ---------- The party ---------- */
  var P = [
    { s: "B", n: "Borin Stoneguard", cls: "Fighter 7", sp: "Dwarf", bg: "Soldier", hp: [67, 67], ac: 17, spd: 30, pp: 13, ini: "+1", pb: "+3", plays: "table", sample: 1, ab: [18, 12, 16, 10, 13, 8], hd: "7/7 d10" },
    { s: "M", n: "Mirena Dawnbright", cls: "Cleric 7", sp: "Human", bg: "Acolyte", hp: [52, 52], ac: 16, spd: 30, pp: 17, ini: "+0", pb: "+3", plays: "open", sample: 1, ab: [14, 10, 14, 10, 18, 12], hd: "7/7 d8" },
    { s: "L", n: "Lyra Emberwise", cls: "Wizard 7", sp: "Elf", bg: "Sage", hp: [44, 44], ac: 11, spd: 30, pp: 13, ini: "+1", pb: "+3", plays: "device", sample: 1, ab: [8, 12, 14, 18, 12, 10], hd: "7/7 d6", slots: "L1 4 · L2 3 · L3 3 · L4 1" },
    { s: "T", n: "Tamsin Reed", cls: "Rogue 6", sp: "Halfling", bg: "Criminal", hp: [33, 39], ac: 15, spd: 30, pp: 15, ini: "+4", pb: "+3", plays: "device", cond: "Poisoned", ab: [8, 18, 14, 12, 12, 13], hd: "5/6 d8" }
  ];
  var ABN = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
  var ABFULL = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];
  function mod(v) { var m = Math.floor((v - 10) / 2); return (m >= 0 ? "+" : "−") + Math.abs(m); }
  var PLAYS = { device: ["On a player's device", ""], table: ["At the table", "table"], open: ["Open to claim", "open"] };
  function plays(c) { return '<span class="d-plays ' + PLAYS[c.plays][1] + '"><i></i>' + PLAYS[c.plays][0] + "</span>"; }
  function face(c, sz) { return '<span class="d-face' + (sz ? " " + sz : "") + '">' + c.s + "</span>"; }
  function hpbar(c) { return '<span class="d-hpb"><i style="width:' + Math.round((100 * c.hp[0]) / c.hp[1]) + '%"></i></span>'; }
  function hpn(c) { return '<span class="d-n hp">' + c.hp[0] + "<small>/" + c.hp[1] + "</small></span>"; }
  function line(c) { return c.cls + " · " + c.sp + " · " + c.bg; }
  function tags(c) { return (c.sample ? '<span class="d-tag sample">Sample</span>' : "") + (c.cond ? '<span class="tag bad" style="margin-left:6px">' + c.cond + "</span>" : ""); }
  function plate(c, extra) {
    return '<div class="d-plate"><div><span class="d-eb">AC</span><span class="v">' + c.ac + '</span></div><div><span class="d-eb">Hit points</span><span class="v hp">' + c.hp[0] + "<small>/" + c.hp[1] + '</small></span></div><div><span class="d-eb">Speed</span><span class="v">' + c.spd + "</span></div>" + (extra || "") + "</div>";
  }
  function abil(c) { return '<div class="d-abil">' + ABN.map(function (a, i) { return '<div><span class="a">' + a + '</span><span class="m">' + mod(c.ab[i]) + '</span><span class="s">' + c.ab[i] + "</span></div>"; }).join("") + "</div>"; }

  /* ---------- The frame (A, approved) ---------- */
  function wm() { return '<span class="wm"><span class="wm-ozy">OZY</span><span class="wm-vtt">vtt</span></span>'; }
  function topBar() {
    var g = gm();
    var secs = g ? ["Play", "Prep", "Codex", "Compendium"] : ["Table", "Sheet", "Codex"];
    var lit = g ? "Prep" : "Sheet";
    var nav = '<nav class="ap-nav" aria-hidden="true">' + secs.map(function (n) { return "<span" + (n === lit ? ' class="on" data-seat' : "") + ">" + n + "</span>"; }).join("") + "</nav>";
    var me = '<span class="me-btn">' + (g ? '<span class="face lg gm">GM</span><span class="online">2</span>' : '<span class="face lg">M</span>') + IC.down + "</span>";
    return '<header class="ap-bar">' + wm() + nav + '<div class="ap-end">' + ico("search") + me + "</div></header>";
  }
  function prepBar() {
    var tabs = ["Encounters", "Party", "Maps", "Tokens", "Sound", "Replays"].map(function (t) { return '<span class="sb-tab' + (t === "Party" ? " on" : "") + '">' + t + "</span>"; }).join("");
    return '<div class="sb titled"><span class="sb-title">Prep</span><div class="sb-tabs">' + tabs + '</div><div class="sb-end"><span class="find">' + IC.search + "Find a character<kbd>Ctrl K</kbd></span><button type=\"button\" class=\"cup\">New character</button></div></div>";
  }
  function bottom() {
    var g = gm();
    var tabs = g ? [["Play", "play"], ["Prep", "prep", 1], ["Codex", "codex"], ["Compendium", "book"], ["More", "dots"]] : [["Table", "play"], ["Sheet", "sheet", 1], ["Codex", "codex"], ["Log", "log"], ["More", "dots"]];
    return '<nav class="ap-bottom five" aria-hidden="true">' + tabs.map(function (t) { return '<span class="btab' + (t[2] ? " on" : "") + '">' + IC[t[1]] + t[0] + "</span>"; }).join("") + "</nav>";
  }
  function pbar(title, icons) { return '<header class="pbar"><h1>' + title + '</h1><div class="end">' + (icons || []).map(ico).join("") + "</div></header>"; }
  function lap(inner) { return '<div class="frame" style="width:1280px;height:800px"><div class="ap sub-base">' + topBar() + '<div class="ap-pane" style="overflow:hidden;position:relative">' + inner + "</div></div></div>"; }
  function ph(header, inner) { return '<div class="frame" style="width:390px;height:844px"><div class="ap is-phone sub-base">' + header + '<div class="ap-pane" style="overflow:hidden;position:relative"><div class="d-ph" style="height:100%;position:relative">' + inner + "</div></div>" + bottom() + "</div></div>"; }

  /* ---------- 1. Roster ---------- */
  function rosterTool(phone) {
    return '<p class="d-desc">Borin, Mirena and Lyra are sample characters to try the table with. <span class="d-btn" style="margin-left:6px">Remove sample characters</span></p>' +
      (phone ? "" : '<div class="d-tool"><span class="d-muted">4 characters</span><span class="grow"></span><span class="d-btn">' + IC.die + 'Roll a random character</span><span class="d-btn">' + IC.file + "Import" + IC.down + "</span></div>");
  }
  function archived() { return '<div class="d-open" style="margin-top:18px"><span class="d-eb">Archived · 1 ' + IC.down.replace("<svg", '<svg style="width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2;vertical-align:-1px"') + '</span><span class="d-muted">Old Bram · Fighter 3 · hidden from players</span></div>'; }
  function acts(c, phone) { return '<span class="d-btn">Open sheet</span>' + (phone ? "" : '<span class="d-btn">' + IC.up + "Level up</span>") + '<span class="d-ico">' + IC.dots + "</span>"; }
  function rosterBody(phone) {
    var v = S.d1;
    if (v === "cards") {
      return '<div class="d-cards">' + P.map(function (c) {
        return '<div class="d-card"><span class="corner">' + (c.sample ? '<span class="d-tag sample">Sample</span>' : "") + '</span><div class="art">' + face(c, phone ? "lg" : "xl") + '</div><div class="top"><b>' + c.n + "</b></div><span class=\"d-line\">" + c.cls + " · " + c.sp + "</span>" +
          '<div class="stats"><span>' + hpn(c) + '</span><span class="d-muted">AC</span><span class="d-n">' + c.ac + "</span>" + (c.cond ? '<span class="tag need">' + c.cond + "</span>" : "") + "</div>" + hpbar(c) + plays(c) + '<div class="acts">' + acts(c, phone) + "</div></div>";
      }).join("") + "</div>";
    }
    if (v === "table") {
      if (phone) return '<div class="d-tgrp">' + P.map(function (c) { return '<div class="d-row">' + face(c, "sm") + "<div><b>" + c.n + '</b><span class="d-muted">' + c.cls + " · " + PLAYS[c.plays][0] + '</span></div><span style="display:grid;justify-items:end;gap:4px">' + hpn(c) + '<span class="d-muted">AC ' + c.ac + "</span></span></div>"; }).join("") + "</div>";
      return '<div class="d-tgrp"><table class="d-table"><thead><tr><th>Character</th><th>Hit points</th><th>AC</th><th>Passive Perception</th><th>Who plays</th><th></th></tr></thead><tbody>' + P.map(function (c) {
        return '<tr><td><div class="nm">' + face(c, "sm") + "<div><b>" + c.n + " " + tags(c) + '</b><span class="d-muted">' + line(c) + '</span></div></div></td><td><div class="hpc">' + hpn(c) + hpbar(c) + '</div></td><td><span class="d-n">' + c.ac + '</span></td><td><span class="d-n">' + c.pp + "</span></td><td>" + plays(c) + '</td><td style="text-align:right;white-space:nowrap">' + acts(c) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    }
    if (v === "bands") {
      return P.map(function (c) {
        return '<div class="d-band"><div class="id">' + face(c, "lg") + '<div style="min-width:0"><b>' + c.n + '</b><span class="d-line">' + line(c) + "</span><div style=\"margin-top:6px\">" + tags(c) + "</div></div></div>" + plate(c, phone ? "" : '<div><span class="d-eb">Passive Perc.</span><span class="v">' + c.pp + "</span></div>") + '<div class="end">' + plays(c) + '<div style="display:flex;gap:6px">' + acts(c, phone) + "</div></div></div>";
      }).join("");
    }
    // split
    var on = 2;
    var list = P.map(function (c, i) { return '<div class="d-row' + (i === on ? " on" : "") + '">' + face(c, "sm") + "<div><b>" + c.n + '</b><span class="d-muted">' + c.cls + " · " + PLAYS[c.plays][0] + "</span></div>" + hpn(c) + "</div>"; }).join("");
    if (phone) return '<div class="d-tgrp">' + list + "</div>";
    var c = P[on];
    var pv = '<div class="d-preview"><div class="head">' + face(c, "xl") + '<div style="flex:1"><h2>' + c.n + '</h2><span class="d-line">' + line(c) + '</span><div style="margin-top:6px">' + tags(c) + '</div></div><div style="display:flex;gap:6px">' + acts(c) + "</div></div>" + plate(c, '<div><span class="d-eb">Init</span><span class="v">' + c.ini + '</span></div><div><span class="d-eb">Prof.</span><span class="v">' + c.pb + '</span></div><div><span class="d-eb">Passive Perc.</span><span class="v">' + c.pp + "</span></div>") +
      abil(c) + '<div class="d-grp"><span class="d-eb">Who plays</span><div class="d-segc"><span class="on">On a player\'s device</span><span>At the table</span><span>Open to claim</span></div><span class="d-muted">Claimed on Tuesday. Release it to let someone else play Lyra.</span></div><div class="d-open"><span class="d-eb">Resources</span><div class="d-res">Hit Point Dice<b>' + c.hd + "</b> Spell slots<b>" + c.slots + "</b></div></div></div>";
    return '<div class="d-split"><div class="lst">' + list + archived() + "</div>" + pv + "</div>";
  }
  function roster(phone) {
    if (phone) {
      var strip = '<div class="pstrip">' + ["Encounters", "Party", "Maps", "Tokens", "Sound"].map(function (t) { return '<span class="sb-tab' + (t === "Party" ? " on" : "") + '">' + t + "</span>"; }).join("") + "</div>";
      return ph(pbar("Prep", ["search", "plus"]), strip + '<div class="d-body" style="height:100%;overflow:hidden">' + rosterTool(true) + rosterBody(true) + "</div>");
    }
    var inner = S.d1 === "split" ? '<div class="d-pg">' + prepBar() + '<div style="display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0"><div style="padding:14px 24px 0">' + rosterTool(false) + "</div>" + rosterBody(false) + "</div></div>"
      : '<div class="d-pg">' + prepBar() + '<div class="d-body">' + rosterTool(false) + rosterBody(false) + archived() + "</div></div>";
    return lap(inner);
  }

  /* ---------- 2. Making a character ---------- */
  var STEPS = [["Species", "Elf"], ["Background", "Sage"], ["Class & level", "Wizard 1"], ["Class features", ""], ["Ability scores", ""], ["Equipment", ""], ["Name & review", ""]];
  var CLASSES = [["Barbarian", "Rage through the fight", "d12", "STR"], ["Bard", "Words and music with magic in them", "d8", "CHA"], ["Cleric", "A god's power, healing and holy", "d8", "WIS"], ["Druid", "Nature's magic and wild shapes", "d8", "WIS"], ["Fighter", "Master of arms and armor", "d10", "STR or DEX"], ["Monk", "Martial arts and focus", "d8", "DEX and WIS"], ["Paladin", "An oath made into might", "d10", "STR and CHA"], ["Ranger", "Hunter of the wild places", "d10", "DEX and WIS"], ["Rogue", "Skill, stealth and the sneak attack", "d8", "DEX"], ["Sorcerer", "Magic in the blood", "d6", "CHA"], ["Warlock", "Power from a pact", "d8", "CHA"], ["Wizard", "Learned magic from a spellbook", "d6", "INT"]];
  var CUR = 2;
  function steps() {
    return '<div class="d-steps">' + STEPS.map(function (s, i) {
      var st = i < CUR ? "done" : i === CUR ? "cur" : "";
      return '<div class="d-step ' + st + '"><span class="mk">' + (i < CUR ? "✓" : i + 1) + "</span><span>" + s[0] + (s[1] ? "<small>" + s[1] + "</small>" : "") + "</span></div>";
    }).join("") + "</div>";
  }
  function classGrid(from) {
    return '<div class="d-choices">' + CLASSES.slice(from || 0).map(function (c) {
      return '<div class="d-ch' + (c[0] === "Wizard" ? " on" : "") + '"><b>' + c[0] + "</b><span>" + c[1] + '</span><span class="k">' + c[2] + " · " + c[3] + "</span></div>";
    }).join("") + "</div>";
  }
  function wizardDetail() {
    return '<h4>Wizard</h4><p class="d-line" style="margin:0">Wizards learn magic from study and keep their spells in a spellbook. Intelligence is their spellcasting ability.</p>' +
      '<dl class="d-facts"><dt>Hit Point Die</dt><dd>d6 per Wizard level</dd><dt>Primary ability</dt><dd>Intelligence</dd><dt>Saving throws</dt><dd>Intelligence, Wisdom</dd><dt>Skills</dt><dd>Two from Arcana, History, Insight, Investigation, Medicine, Nature, Religion</dd></dl>' +
      '<span class="d-eb">At level 1</span><div class="d-feat"><div>Spellcasting<span>Three cantrips, six spells in the book</span></div><div>Ritual Adept<span>Cast rituals from the book</span></div><div>Arcane Recovery<span>Regain slots on a Short Rest</span></div></div>';
  }
  function qfoot(next, phone) { return '<div class="qfoot"><span class="d-btn ghost">' + IC.left + 'Back</span><span class="grow"></span>' + (phone ? "" : '<span class="d-muted">Level <b style="color:var(--text)">1</b> ' + IC.down.replace("<svg", '<svg style="width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2;vertical-align:-1px"') + "</span>") + '<button type="button" class="cup">' + next + "</button></div>"; }
  function recHead(title, sub, right) { return '<div class="ph" style="padding:14px 24px;border-bottom:1px solid var(--line-strong)"><div><div class="t"><h1>' + title + "</h1></div><p>" + sub + '</p></div><div class="ph-end">' + (right || "") + "</div></div>"; }
  function livePreview() {
    return '<div class="d-live"><span class="d-eb">Your character so far</span><div class="who"><span class="d-face lg off">?</span><div><b>New character</b><span class="d-line">Wizard 1 · Elf · Sage</span></div></div>' +
      '<div class="d-plate"><div><span class="d-eb">AC</span><span class="v">12</span></div><div class="new"><span class="d-eb">Hit points</span><span class="v hp">8</span></div><div><span class="d-eb">Speed</span><span class="v">30</span></div><div><span class="d-eb">Prof.</span><span class="v">+2</span></div></div>' +
      '<div class="d-abil">' + ABN.map(function (a) { return '<div class="blank"><span class="a">' + a + '</span><span class="m">--</span><span class="s">step 5</span></div>'; }).join("") + "</div>" +
      '<span class="d-eb">Skills</span><div class="d-skl"><div><span class="sh-pf p"></span>Arcana</div><div><span class="sh-pf p"></span>History</div><div><span class="sh-pf"></span><span class="d-amb">Two from Wizard</span></div><div><span class="sh-pf"></span><span class="d-muted">in step 4</span></div></div>' +
      '<span class="d-eb">Features</span><div class="d-feat"><div>Darkvision, Fey Ancestry, Keen Senses, Trance<span>Elf</span></div><div class="new">Spellcasting, Ritual Adept, Arcane Recovery<span>Wizard</span></div></div></div>';
  }
  function builder(phone) {
    var v = S.d2;
    if (!phone) {
      var head = recHead("Create a character", "Step 3 of 7 · Class and level", '<span class="btn">Done</span>');
      var body;
      if (v === "detail") body = '<div class="d-make three">' + steps() + '<div class="d-q"><div></div><div class="qbody"><h3>Class</h3>' + classGrid() + "</div>" + qfoot("Next: Class features") + '</div><div class="d-detail">' + wizardDetail() + "</div></div>";
      else if (v === "live") body = '<div class="d-make three">' + steps() + '<div class="d-q"><div></div><div class="qbody"><h3>Class</h3>' + classGrid() + '<p class="d-muted" style="margin:0">Choose one to read it here and see it join your sheet on the right.</p></div>' + qfoot("Next: Class features") + "</div>" + livePreview() + "</div>";
      else if (v === "one") {
        var rows = CLASSES.slice(6).map(function (c) { return '<div class="d-orow' + (c[0] === "Wizard" ? " on" : "") + '"><div><b>' + c[0] + "</b> <span>" + c[1] + '</span></div><span class="k">' + c[2] + "</span>" + (c[0] === "Wizard" ? '<div class="more">At level 1: Spellcasting, Ritual Adept, Arcane Recovery. Hit Point Die d6; saving throws Intelligence and Wisdom.</div>' : "") + "</div>"; }).join("");
        body = '<div class="d-one"><div class="ohead"><div class="d-prog">' + STEPS.map(function (s, i) { return '<i class="' + (i < CUR ? "done" : i === CUR ? "cur" : "") + '"></i>'; }).join("") + '</div><span class="d-eb">Step 3 of 7 · Class and level</span><h2>Which class?</h2></div><div class="obody"><span class="d-muted" style="padding:0 4px 6px">Barbarian to Monk above</span>' + rows + "</div>" + qfoot("Next: Class features") + "</div>";
      } else {
        body = '<div class="d-onsheet"><div class="d-sheet"><div style="display:flex;align-items:center;gap:14px"><span class="d-face lg off">?</span><div style="flex:1"><div style="display:flex;gap:10px;align-items:center"><span class="d-blank">Name</span></div><div class="d-line" style="margin-top:6px"><span class="d-filled">Elf</span> · <span class="d-filled">Sage</span> · <span class="d-blank on">Choose a class</span></div></div><span class="d-chip-left">5 choices left</span></div>' +
          '<div class="d-plate" style="justify-content:start"><div><span class="d-eb">AC</span><span class="v">12</span></div><div><span class="d-eb">Hit points</span><span class="v d-amb">--</span></div><div><span class="d-eb">Speed</span><span class="v">30</span></div><div><span class="d-eb">Prof.</span><span class="v">+2</span></div></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px"><div><span class="d-eb">Abilities</span>' + ABFULL.map(function (a) { return '<div class="d-lrow"><span>' + a + '</span><span class="d-blank">Choose</span></div>'; }).join("") + '</div><div><span class="d-eb">Skills</span><div class="d-lrow"><span><span class="sh-pf p"></span> Arcana</span><span class="d-muted">Sage</span></div><div class="d-lrow"><span><span class="sh-pf p"></span> History</span><span class="d-muted">Sage</span></div><div class="d-lrow"><span class="d-blank">Two class skills</span><span></span></div><span class="d-eb" style="display:block;margin-top:12px">Gear</span><div class="d-lrow"><span class="d-blank">Choose equipment</span><span></span></div></div></div></div>' +
          '<div class="d-q" style="border-left:1px solid var(--line-strong)"><div></div><div class="qbody"><h3>Choose a class</h3>' + CLASSES.slice(8).map(function (c) { return '<div class="d-orow' + (c[0] === "Wizard" ? " on" : "") + '"><div><b>' + c[0] + "</b> <span>" + c[2] + "</span></div><span></span>" + (c[0] === "Wizard" ? '<div class="more">' + c[1] + ". At level 1: Spellcasting, Ritual Adept, Arcane Recovery.</div>" : "") + "</div>"; }).join("") + '<span class="d-muted">And 8 more above</span></div><div class="qfoot"><span class="d-btn">Next blank: class skills</span><span class="grow"></span><button type="button" class="cup">Take Wizard</button></div></div></div>';
        head = recHead("Create a character", "Fill the blanks in any order", '<span class="btn">Done</span>');
      }
      return lap('<div class="d-pg">' + head + body + "</div>");
    }
    // phone
    var pstep = '<div class="d-pstep"><div class="t"><span><b>Step 3 of 7</b> · Class and level</span><span>Wizard 1</span></div><div class="d-prog">' + STEPS.map(function (s, i) { return '<i class="' + (i < CUR ? "done" : i === CUR ? "cur" : "") + '"></i>'; }).join("") + "</div></div>";
    var foot = '<div class="d-pfoot"><span class="d-btn ghost">' + IC.left + 'Back</span><button type="button" class="cup">Next: Class features</button></div>';
    var mid;
    if (v === "detail") mid = '<div class="d-body" style="overflow:hidden"><h3 class="d-eb" style="margin:0 0 8px">Class · Barbarian to Ranger above</h3>' + classGrid(8).replace('<div class="d-ch on"><b>Wizard</b><span>Learned magic from a spellbook</span><span class="k">d6 · INT</span></div>', '<div class="d-ch on"><b>Wizard</b><span>Learned magic from a spellbook</span><span class="k">d6 · INT</span><span>Saves Intelligence and Wisdom. At level 1: Spellcasting, Ritual Adept, Arcane Recovery.</span></div>') + "</div>";
    else if (v === "live") mid = '<div class="d-body" style="overflow:hidden">' + classGrid(8) + '</div><div class="d-sheetpop" style="max-height:none;height:150px;bottom:0"><div class="grab"></div><div class="sb2"><div style="display:flex;justify-content:space-between;align-items:center"><span class="d-eb">Your character so far</span><span class="d-muted">Pull up</span></div><div class="d-plate"><div><span class="d-eb">AC</span><span class="v">12</span></div><div class="new"><span class="d-eb">HP</span><span class="v hp">8</span></div><div><span class="d-eb">Speed</span><span class="v">30</span></div></div></div></div>';
    else if (v === "one") mid = '<div class="d-body" style="overflow:hidden"><h2 style="margin:0 0 10px;font:600 22px/1.1 var(--f-display);text-transform:uppercase;letter-spacing:.04em">Which class?</h2>' + CLASSES.slice(6).map(function (c) { return '<div class="d-orow' + (c[0] === "Wizard" ? " on" : "") + '"><div><b>' + c[0] + '</b><br><span>' + c[1] + '</span></div><span class="k">' + c[2] + "</span>" + (c[0] === "Wizard" ? '<div class="more">At level 1: Spellcasting, Ritual Adept, Arcane Recovery.</div>' : "") + "</div>"; }).join("") + "</div>";
    else mid = '<div class="d-body" style="overflow:hidden"><div style="display:flex;gap:10px;align-items:center"><span class="d-face off">?</span><div><span class="d-blank">Name</span><div class="d-line" style="margin-top:4px">Elf · Sage · <span class="d-blank on">Class</span></div></div></div><div class="d-plate" style="margin-top:10px"><div><span class="d-eb">AC</span><span class="v">12</span></div><div><span class="d-eb">HP</span><span class="v d-amb">--</span></div><div><span class="d-eb">Speed</span><span class="v">30</span></div></div></div><div class="d-sheetpop"><div class="grab"></div><div class="sb2"><h3 class="d-eb" style="margin:0">Choose a class</h3>' + CLASSES.slice(9).map(function (c) { return '<div class="d-orow' + (c[0] === "Wizard" ? " on" : "") + '"><div><b>' + c[0] + "</b> <span>" + c[2] + '</span></div><span></span></div>'; }).join("") + '</div><div class="d-pfoot"><span class="d-chip-left">5 left</span><button type="button" class="cup">Take Wizard</button></div></div>';
    if (v === "onsheet") return ph(pbar("New character", ["close"]), '<div class="d-P" style="grid-template-rows:minmax(0,1fr)">' + mid + "</div>");
    return ph(pbar("New character", ["close"]), '<div class="d-P">' + pstep + mid + foot + "</div>");
  }

  /* ---------- 3. Levelling up: Borin, Fighter 7 to 8 ---------- */
  var B = P[0];
  function hpChoice() { return '<div class="d-grp"><span class="d-eb">Hit points</span><div class="d-segc"><span class="on">Take 6</span><span>Roll a d10</span></div><div class="d-chg"><span class="from">67</span><span class="arw">to</span><span class="to">76</span><span class="d-muted">6, plus 3 for Constitution</span></div></div>'; }
  function asiChoice(lit) {
    return '<div class="d-grp' + (lit ? " lit" : "") + '"><span class="d-eb">Ability Score Improvement</span><div class="d-segc"><span class="on">Raise ability scores</span><span>Take a feat</span></div><span class="d-muted">Two points: +2 to one score, or +1 to two. None above 20.</span><div class="d-ab2">' + ABN.map(function (a, i) { var on = i === 0; return '<div class="' + (on ? "on" : "") + '"><span class="a">' + a + '</span><span class="m">' + (on ? "20" : B.ab[i]) + '</span><span class="p">' + (on ? "+2" : "&nbsp;") + "</span></div>"; }).join("") + "</div></div>";
  }
  function whatElse() { return '<div class="d-open"><span class="d-eb">What else changes</span><div class="d-feat"><div>Fighter level 8<span>No new feature at this level</span></div><div>Proficiency Bonus<span>Stays +3</span></div><div>Strength modifier<span>+4 to +5: attacks, Athletics</span></div></div></div>'; }
  function miniLedger(c, opts) {
    opts = opts || {};
    var tabs = ["Actions", "Spells", "Gear", "Features", "Notes"];
    if (opts.lvl) tabs.push("Level 8");
    var band = '<div class="d-lband"><div class="id">' + face(c, "lg") + '<div><b>' + c.n + '</b><span class="d-line">' + line(c) + "</span>" + (opts.strip || "") + "</div></div>" +
      '<div class="d-plate"><div><span class="d-eb">AC</span><span class="v">' + c.ac + '</span></div><div' + (opts.lvl ? ' class="d-markup"' : "") + '><span class="d-eb">Hit points</span><span class="v hp">' + c.hp[0] + "<small>/" + c.hp[1] + "</small>" + (opts.lvl ? ' <span class="d-amb" style="font-size:.6em">to 76</span>' : "") + '</span></div><div><span class="d-eb">Init</span><span class="v">' + c.ini + '</span></div><div><span class="d-eb">Speed</span><span class="v">' + c.spd + '</span></div><div><span class="d-eb">Prof.</span><span class="v">' + c.pb + "</span></div></div><div>" + (opts.end || '<span class="btn">Rest</span>') + "</div></div>";
    var abs = '<div><span class="d-eb">Abilities</span>' + ABFULL.map(function (a, i) { var mark = opts.lvl && i === 0; return '<div class="d-lrow' + (mark ? " d-markup" : "") + '"><span>' + a + ' <span class="d-muted">' + c.ab[i] + (mark ? ' <span class="d-amb">to 20?</span>' : "") + '</span></span><span class="d-n">' + mod(c.ab[i]) + "</span></div>"; }).join("") + "</div>";
    var skills = '<div><span class="d-eb">Skills</span>' + [["Athletics", "+7"], ["Intimidation", "+2"], ["Perception", "+4"], ["Survival", "+4"], ["Acrobatics", "+1"], ["Insight", "+1"]].map(function (s) { return '<div class="d-lrow"><span>' + s[0] + '</span><span class="d-n">' + s[1] + "</span></div>"; }).join("") + "</div>";
    var box = '<div><div class="sh-tabs">' + tabs.map(function (t, i) { var on = opts.lvl ? t === "Level 8" : i === 0; return '<span class="sh-tab' + (on ? " on" : "") + '"' + (t === "Level 8" ? ' style="color:var(--caution-text)"' : "") + ">" + t + "</span>"; }).join("") + '</div><div style="padding:12px 2px;display:grid;gap:14px">' + (opts.box || '<div class="d-lrow"><span>Longsword</span><span class="d-n">+7</span></div><div class="d-lrow"><span>Heavy Crossbow</span><span class="d-n">+4</span></div><div class="d-lrow"><span>Second Wind</span><span class="d-muted">Bonus Action</span></div>') + "</div></div>";
    return '<div class="d-ledger">' + band + '<div class="d-lcols">' + abs + skills + box + "</div></div>";
  }
  function level(phone) {
    var v = S.d3;
    if (!phone) {
      var body;
      if (v === "steps") {
        var st = ["Species", "Background", "Class & level", "Class features", "Ability scores", "Equipment"];
        var rail = '<div class="d-steps">' + st.map(function (s, i) { return '<div class="d-step done"><span class="mk">✓</span><span>' + s + "</span></div>"; }).join("") + '<div class="d-step cur"><span class="mk">7</span><span>Level 8<small>Hit points, an improvement</small></span></div><div class="d-step"><span class="mk">8</span><span>Review</span></div></div>';
        body = '<div class="d-pg">' + recHead("Level up Borin Stoneguard", "Fighter 7 to 8 · the earlier steps keep their answers", '<span class="btn">Close</span>') + '<div class="d-make" style="grid-template-columns:240px minmax(0,1fr)">' + rail + '<div class="d-q"><div></div><div class="qbody" style="width:min(100%,760px)">' + hpChoice() + asiChoice(true) + '</div><div class="qfoot"><span class="d-btn ghost">' + IC.left + 'Back</span><span class="grow"></span><button type="button" class="cup">Next: Review</button></div></div></div></div>';
      } else if (v === "page") {
        body = '<div class="d-lvl">' + recHead("Borin Stoneguard", "Fighter 7 · level up or down", '<div class="d-segc"><span class="on">Up to 8</span><span>Down to 6</span></div>') + '<div class="lbody">' + hpChoice() + asiChoice(true) + whatElse() + '</div><div class="qfoot"><span class="d-btn ghost">Back to the sheet</span><span class="grow"></span><span class="d-muted">Two choices made</span><button type="button" class="cup">Apply level 8</button></div></div>';
      } else if (v === "sheet") {
        var bx = '<p class="d-desc" style="margin:0">Level 8 brings two choices. The rest of the sheet shows what changes in amber.</p>' + hpChoice() + asiChoice(true);
        body = '<div class="d-pg" style="grid-template-rows:auto minmax(0,1fr)"><div class="d-banner"><span class="tag need">Level 8</span><b>Borin can go up to level 8.</b><span class="d-muted">Two choices in the Level 8 tab</span><span class="grow"></span><span class="d-btn ghost">Not now</span><button type="button" class="cup" style="min-height:42px">Apply level 8</button></div>' + miniLedger(B, { lvl: 1, box: bx }) + "</div>";
      } else {
        var st2 = '<div class="dsteps"><span class="done"><span class="mk">✓</span>Hit points</span><span class="cur"><span class="mk">2</span>Improvement</span><span><span class="mk">3</span>Review</span></div>';
        body = '<div class="d-dim" style="height:100%">' + miniLedger(B) + '</div><div class="d-scrim"></div><div class="d-dlg"><div class="dh"><h2>Level 8 for Borin</h2>' + ico("close") + "</div>" + st2 + '<div class="db">' + asiChoice(true) + '</div><div class="df"><span class="d-btn ghost">' + IC.left + 'Back</span><span class="grow"></span><button type="button" class="cup">Next: Review</button></div></div>';
      }
      return lap(body);
    }
    // phone
    var hdr = pbar("Borin Stoneguard", ["close"]);
    var mid;
    if (v === "steps") mid = '<div class="d-P"><div class="d-pstep"><div class="t"><span><b>Step 7 of 8</b> · Level 8</span><span>Fighter 8</span></div><div class="d-prog">' + [1, 1, 1, 1, 1, 1, 2, 0].map(function (x) { return '<i class="' + (x === 1 ? "done" : x === 2 ? "cur" : "") + '"></i>'; }).join("") + '</div></div><div class="d-body" style="overflow:hidden;display:grid;gap:16px;align-content:start">' + hpChoice() + asiChoice(true) + '</div><div class="d-pfoot"><span class="d-btn ghost">' + IC.left + 'Back</span><button type="button" class="cup">Next: Review</button></div></div>';
    else if (v === "page") mid = '<div class="d-P"><div class="d-pstep"><div class="t"><span><b>Fighter 7 to 8</b></span><span class="d-segc"><span class="on">Up</span><span>Down</span></span></div></div><div class="d-body" style="overflow:hidden;display:grid;gap:16px;align-content:start">' + hpChoice() + asiChoice(true) + '</div><div class="d-pfoot"><button type="button" class="cup">Apply level 8</button></div></div>';
    else if (v === "sheet") mid = '<div class="d-P" style="grid-template-rows:auto auto minmax(0,1fr)"><div class="d-banner" style="flex-wrap:wrap"><span class="tag need">Level 8</span><b>Two choices waiting</b><span class="grow"></span><button type="button" class="cup" style="min-height:40px">Apply</button></div><div class="pstrip">' + ["Main", "Actions", "Gear", "Features", "Level 8"].map(function (t) { return '<span class="sb-tab' + (t === "Level 8" ? " on" : "") + '"' + (t === "Level 8" ? ' style="color:var(--caution-text)"' : "") + ">" + t + "</span>"; }).join("") + '</div><div class="d-body" style="overflow:hidden;display:grid;gap:16px;align-content:start">' + hpChoice() + asiChoice(true) + "</div></div>";
    else mid = '<div class="d-dim" style="height:100%;padding:12px">' + plate(B) + abil(B) + '</div><div class="d-scrim"></div><div class="d-sheetpop"><div class="grab"></div><div class="sb2"><div style="display:flex;align-items:center;gap:10px;margin:0 -14px;padding:0 6px 8px 14px;border-bottom:1px solid var(--line)"><b style="flex:1;font:600 18px var(--f-display);text-transform:uppercase;letter-spacing:.04em">Level 8 for Borin</b><span class="d-muted">2 of 3</span><span class="d-ico">' + IC.close + '</span></div>' + asiChoice(true) + '</div><div class="d-pfoot"><span class="d-btn ghost">Back</span><button type="button" class="cup">Next: Review</button></div></div>';
    return ph(hdr, mid);
  }

  /* ---------- 4. A party member, as Mirena's player sees them ---------- */
  var ME = P[1];
  function memberBand(c, full) {
    return '<div class="d-pm"><div class="head">' + face(c, "lg") + '<div><b>' + c.n + '</b><span class="d-line">' + line(c) + "</span>" + (c.cond ? '<div style="margin-top:6px"><span class="tag need">' + c.cond + "</span></div>" : "") + "</div></div>" + plate(c) + (full ? abil(c) + '<div class="d-res">Hit Point Dice<b>' + c.hd + "</b>" + (c.slots ? " Spell slots<b>" + c.slots + "</b>" : "") + "</div>" : "") + "</div>";
  }
  function member(phone) {
    var v = S.d4;
    var others = [P[0], P[2], P[3]];
    if (!phone) {
      var body;
      if (v === "band") body = '<div class="d-dim" style="height:100%">' + miniLedger(ME) + '</div><div class="d-scrim"></div><div class="d-dlg" style="width:560px;grid-template-rows:auto minmax(0,1fr)"><div class="dh"><h2>Borin Stoneguard</h2>' + ico("close") + '</div><div class="db">' + memberBand(P[0], true).replace('<div class="head">' + face(P[0], "lg") + '<div><b>Borin Stoneguard</b>', '<div class="head">' + face(P[0], "lg") + '<div><b style="display:none">Borin Stoneguard</b>') + "</div></div>";
      else if (v === "page") body = '<div style="height:100%;overflow:hidden;padding:18px 24px;width:min(100%,880px);margin:0 auto;box-sizing:border-box"><p class="d-desc">What the party can see of each other. Your own sheet is the Sheet tab.</p>' + others.map(function (c, i) { return '<div class="d-band read" style="grid-template-columns:minmax(0,1fr) auto">' + '<div class="id">' + face(c, "lg") + '<div><b>' + c.n + '</b><span class="d-line">' + line(c) + "</span>" + (c.cond ? '<div style="margin-top:6px"><span class="tag need">' + c.cond + "</span></div>" : "") + "</div></div>" + plate(c) + (i === 0 ? '<div style="grid-column:1/-1;display:grid;gap:10px">' + abil(c) + '<div class="d-res">Hit Point Dice<b>' + c.hd + "</b></div></div>" : "") + "</div>"; }).join("") + "</div>";
      else if (v === "cards") body = '<div style="height:100%;overflow:hidden;padding:18px 24px"><p class="d-desc">What the party can see of each other.</p><div class="d-pcards">' + others.map(function (c, i) {
        return '<div class="d-card read" style="padding-top:12px">' + '<div style="display:flex;gap:12px;align-items:center">' + face(c, "lg") + '<div><b>' + c.n + '</b><br><span class="d-line">' + c.cls + " · " + c.sp + "</span></div></div>" + '<div class="stats">' + hpn(c) + '<span class="d-muted">AC</span><span class="d-n">' + c.ac + '</span><span class="d-muted">Speed</span><span class="d-n">' + c.spd + "</span></div>" + hpbar(c) + (c.cond ? '<span><span class="tag need">' + c.cond + "</span></span>" : "") + (i === 0 ? abil(c) + '<div class="d-res">Hit Point Dice<b>' + c.hd + "</b></div>" : '<span class="d-muted">Tap for abilities</span>') + "</div>";
      }).join("") + "</div></div>";
      else {
        var strip = '<div class="d-strip" style="margin-top:8px"><span class="d-eb">Party</span>' + others.map(function (c, i) { return '<span style="display:grid;gap:3px;width:32px' + (i === 0 ? ";box-shadow:inset 0 -2px 0 var(--cyan)" : "") + '">' + face(c, "sm") + hpbar(c) + "</span>"; }).join("") + "</div>";
        body = miniLedger(ME, { strip: strip }) + '<div class="d-pop" style="left:90px;top:96px">' + memberBand(P[0], true) + "</div>";
      }
      return lap(body);
    }
    var hdr = v === "page" || v === "cards" ? pbar("The party", []) : pbar("Mirena Dawnbright", ["dots"]);
    var mid;
    if (v === "band") mid = '<div class="d-dim" style="height:100%;padding:12px">' + plate(ME) + abil(ME) + '</div><div class="d-scrim"></div><div class="d-sheetpop"><div class="grab"></div><span class="d-ico" style="position:absolute;right:6px;top:16px">' + IC.close + '</span><div class="sb2">' + memberBand(P[0], true) + "</div></div>";
    else if (v === "page") mid = '<div class="d-body" style="height:100%;overflow:hidden">' + others.map(function (c, i) { return '<div class="d-band read" style="grid-template-columns:minmax(0,1fr)"><div class="id">' + face(c) + "<div><b style=\"font-size:16px\">" + c.n + '</b><span class="d-line">' + c.cls + " · " + c.sp + "</span></div></div>" + plate(c) + (i === 0 ? abil(c) : "") + "</div>"; }).join("") + "</div>";
    else if (v === "cards") mid = '<div class="d-body" style="height:100%;overflow:hidden"><div class="d-cards" style="grid-template-columns:1fr 1fr;gap:10px">' + others.map(function (c) { return '<div class="d-card read" style="padding:10px"><div style="display:flex;gap:8px;align-items:center">' + face(c, "sm") + "<b style=\"font-size:14px\">" + c.n.split(" ")[0] + '</b></div><span class="d-line">' + c.cls + '</span><div class="stats">' + hpn(c) + '<span class="d-muted">AC ' + c.ac + "</span></div>" + hpbar(c) + (c.cond ? '<span><span class="tag need">' + c.cond + "</span></span>" : "") + "</div>"; }).join("") + "</div></div>";
    else mid = '<div class="d-body" style="height:100%;overflow:hidden"><div style="display:flex;gap:10px;align-items:center">' + face(ME) + '<div><b style="font:600 18px var(--f-display);text-transform:uppercase">Mirena Dawnbright</b><div class="d-strip" style="margin-top:6px">' + others.map(function (c, i) { return '<span style="display:grid;gap:3px;width:32px' + (i === 0 ? ";box-shadow:inset 0 -2px 0 var(--cyan)" : "") + '">' + face(c, "sm") + hpbar(c) + "</span>"; }).join("") + '</div></div></div><div style="margin-top:12px">' + plate(ME) + '</div></div><div class="d-sheetpop"><div class="grab"></div><div class="sb2">' + memberBand(P[0], true) + "</div></div>";
    return ph(hdr, mid);
  }

  /* ---------- What each option means ---------- */
  var DEC = {
    d1: {
      n: 1, name: "Roster", page: "roster",
      what: "The GM's list of player characters in Prep, Party: who they are, how they stand, who plays them and what you can do to each (D2.1).",
      today: "A ROSTER title, four buttons, the join address, a sample notice, then tall cards with a large portrait, a line of small text, a Played at the table switch and up to five buttons each.",
      opts: {
        cards: ["Cards", "Today's cards made compact: a face, the name, class and species, hit points and AC, who plays, and two actions with the rest in a menu. Cradle edges, a Sample tag in the corner."],
        table: ["Table", "The theme's list as a table: one row per character with hit points, AC, Passive Perception and who plays, sortable, the actions at the row's end. The most to compare at once."],
        bands: ["Bands · chosen", "Each character as the Ledger sheet's vitals band: the face and name, then one plate of AC, hit points, Speed and Passive Perception, then who plays and the actions. The roster reads like the sheet."],
        split: ["Split", "A list at the left and the chosen character at the right: the band's numbers, abilities, who plays as a choice, and resources. Picking someone never leaves the page."]
      }
    },
    d2: {
      n: 2, name: "Making a character", page: "builder",
      what: "The character builder: species, background, class and level, class features, ability scores, equipment, then name and review (D3.1).",
      today: "Steps down the left, a grid of choices in the middle and the chosen one's detail at the right, with Next at the foot. The current step is boxed and filled; a phone shows Step 1 of 7.",
      opts: {
        detail: ["Steps and detail · chosen", "Today's builder, drawn to the theme: the Steps rail in cyan, the choices as Base line tiles, and the chosen one's facts and level 1 features at the right."],
        live: ["Steps and sheet", "The right column is your character so far, the Ledger's numbers filling in as you choose: hit points, AC, skills and features appear when a choice brings them, and what is still to come waits in amber."],
        one: ["One at a time", "No rail: one question at a time in a 680 px column, its choices as rows, the chosen one opening to say what it brings. A thin progress line names the steps. The same on a phone and a laptop."],
        onsheet: ["On the sheet", "The builder is an empty Ledger sheet. Each blank (name, class, abilities, skills, gear) is an amber mark; pick one and its choices open at the right. Fill them in any order; a chip counts what is left."]
      }
    },
    d3: {
      n: 3, name: "Levelling up", page: "level",
      what: "Taking a character up or down a level, with the choices the new level brings: hit points, features, a subclass, spells, an improvement (D3.2).",
      today: "A page of level numbers, then the builder again with every earlier step ticked and a Level 8 step added, then Review.",
      opts: {
        steps: ["Steps", "Today's flow, drawn to the theme: the builder's rail with the earlier steps done, the new level's step with its choices, then Review."],
        page: ["One page", "One page for the level: hit points, each choice it brings in a Cradle group, and what else changes, with Apply level 8 at the foot. Up or down is a choice at the top."],
        sheet: ["On the sheet", "Nothing new to learn: the Ledger sheet says Level 8 is ready, marks what will change in amber, and a Level 8 tab holds the choices. Apply from the banner."],
        dialog: ["Dialog · chosen", "A dialog over the sheet with the level's few steps along its top (hit points, the improvement, review). Small and focused; the sheet stays behind it."]
      }
    },
    d4: {
      n: 4, name: "A party member", page: "member",
      what: "What a player sees of another character in the party: class, hit points, AC, Speed, abilities, conditions and, where the GM allows, hit dice and spell slots. Nothing more is sent to them (D2.5).",
      today: "The sheet's menu opens a list of the party, and each opens a small dialog of plain lines: HP, AC, Speed, the six scores and any conditions.",
      opts: {
        band: ["Band · chosen", "The dialog, drawn as the Ledger's band: the face and class line, one plate of AC, hit points and Speed, the abilities in a row, then resources. A sheet from the bottom on a phone."],
        page: ["Party page", "A page of the party: each member as a band, the one you open showing abilities and resources. Everyone at once, no dialog."],
        cards: ["Cards", "The party as cards: face, name, hit points with a bar, AC, Speed and conditions; open one for abilities and resources."],
        strip: ["Strip", "The party sits on your own sheet, as small faces with hit point slivers beside your name. Point at one, or tap it, for their numbers in a popover."]
      }
    }
  };
  function renderIdea() {
    $("#idea").innerHTML = ["d1", "d2", "d3", "d4"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div><p class="eyebrow">' + d.n + " · " + d.name + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    var A = window.AUDIT || {};
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    $("#today").innerHTML =
      '<div class="today-strip" style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"><p class="eyebrow" style="grid-column:1/-1">Roster</p>' + fig("roster", "Prep, Party") + fig("random", "Roll a random character") + fig("pdf", "Import from D&D Beyond") + "</div>" +
      '<div class="today-strip"><p class="eyebrow">Making</p>' + fig("builder", "The builder, Species") + "</div>" +
      '<div class="today-strip"><p class="eyebrow">Levelling</p>' + fig("level", "Level up or down") + fig("levelup", "Then the builder, with Level 8") + "</div>" +
      '<div class="today-strip" style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"><p class="eyebrow" style="grid-column:1/-1">Phones</p>' + fig("roster-phone", "Roster") + fig("builder-phone", "Builder") + fig("level-phone", "Level") + "</div>";
    var R = [
      ["One primary in the bar", "New character is the Cup at the end of Prep's bar (theme rule 2). The other ways in, Roll a random character and Import (a D&D Beyond PDF or a file), sit in the roster's toolbar on Base lines.", "Today a Cup and three buttons in a row under the title."],
      ["The join address leaves the roster", "Players join from the table's Encounter tab before a fight and from the menu's Who is here (A). The roster no longer repeats it.", "Today the roster and the table both show it."],
      ["Samples are a line", "One description line says which characters are samples, with Remove sample characters on a Base line; each sample carries a Sample tag.", "Today a boxed notice."],
      ["Who plays", "Each character shows who plays them: on a player's device, at the table, or open to claim, with a lamp. Changing it, releasing a claim and archiving are in the character's menu.", "Today a Played at the table switch and a Release button."],
      ["Archived at the end", "Archived characters are one closed open group at the end of the roster, hidden from players as now.", ""],
      ["Steps are the theme's", "The builder and levelling use the one Steps rail (theme rule 4): done is a cyan check, current a cyan outline, a step that needs a choice an amber mark.", "Today the current step is a filled box."],
      ["Dialogs follow the pattern", "Roll a random character and Import are Dialogs: the title on the horizon edge, one sentence, Cancel as a ghost and the Cup at the right; a sheet from the bottom on a phone.", ""],
      ["Nothing claimed", "A player with no character sees the theme's empty state on Sheet: You aren't playing anyone yet, and a Pick a character button.", ""],
      ["Only what the party may see", "A party member shows only what the projection sends another player: the class line, hit points as given, AC, Speed, abilities, conditions, and hit dice and spell slots where the GM allows. Never skills, spells, gear or notes.", ""],
      ["Words from the rules", "Level 1, Hit Point Die, Ability Score Improvement, Proficiency Bonus, Short Rest: the SRD 5.2.1 words, as the sheet uses them.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }

  /* ---------- Page ---------- */
  var PGNAME = { roster: "GM · Prep, Party", builder: "GM · making a character", level: "GM · levelling Borin up", member: "Mirena's player · Borin, a party member" };
  function renderStage() {
    $("#cap-laptop").textContent = "Laptop · " + PGNAME[S.pg];
    $("#cap-phone").textContent = "Phone · " + PGNAME[S.pg];
    var f = { roster: roster, builder: builder, level: level, member: member }[S.pg];
    $("#v-laptop .fit").innerHTML = f(false);
    $("#v-phone .fit").innerHTML = f(true);
    fit();
  }
  function fit() {
    $$(".fit").forEach(function (box) {
      var fr = box.querySelector(".frame");
      if (!fr) return;
      var fw = parseFloat(fr.style.width), fh = parseFloat(fr.style.height);
      var k = Math.min(1, box.parentElement.clientWidth / fw);
      fr.style.transform = "scale(" + k + ")";
      box.style.width = fw * k + "px";
      box.style.height = fh * k + "px";
    });
    $$(".ap-nav [data-seat]").forEach(function (el) {
      el.style.setProperty("--win-w", el.closest(".ap-bar").offsetWidth + "px");
      el.style.setProperty("--win-x", -el.offsetLeft + "px");
    });
  }
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
        // A decision's switch shows its own page.
        if (DEC[k]) S.pg = DEC[k].page;
        sync();
        if (k === "show") { fit(); return; }
        renderIdea();
        renderStage();
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
    b.addEventListener("click", function () { document.documentElement.setAttribute("data-theme", b.dataset.th); paintTheme(); });
  });
  if (mq && mq.addEventListener) mq.addEventListener("change", paintTheme);

  var lastW = 0;
  if (window.ResizeObserver) new ResizeObserver(function (entries) {
    var w = Math.round(entries[0].contentRect.width);
    if (w !== lastW) { lastW = w; fit(); }
  }).observe($("#stage"));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  window.addEventListener("hashchange", function () { readHash(); sync(); renderIdea(); renderStage(); });

  readHash();
  if (window.matchMedia && window.matchMedia("(max-width: 650px)").matches) S.show = "phone";
  sync();
  renderIdea();
  renderStatic();
  renderStage();
  paintTheme();
})();
