(function () {
  "use strict";
  var S = window.SHEET;
  var D = S.D, I = S.I, P = S.P, esc = S.esc;

  /* What Lyra does, as a VTT lists it: cost, name, what it is, range, hit or DC, damage and type, or the effect. */
  var ACTS = [
    ["action", "Dagger", "Simple weapon · Finesse, Light, Thrown", "20/60 ft", "+5", "1d4 + 2", "piercing"],
    ["action", "Quarterstaff", "Simple weapon · Versatile (1d8)", "5 ft", "+2", "1d6 − 1", "bludgeoning"],
    ["action", "Fire Bolt", "Cantrip · Evocation", "120 ft", "+7", "2d10 + 4", "fire"],
    ["action", "Ray of Frost", "Cantrip · Evocation", "60 ft", "+7", "2d8 + 4", "cold"],
    ["action", "Magic Missile", "Level 1 · Evocation", "120 ft", "Auto", "3 × 1d4 + 1", "force"],
    ["action", "Scorching Ray", "Level 2 · Evocation", "120 ft", "+7", "3 × 2d6", "fire"],
    ["action", "Web", "Level 2 · Conjuration · Concentration", "60 ft", "DC 15|DEX", "", "", "Restrained"],
    ["action", "Fireball", "Level 3 · Evocation", "150 ft", "DC 15|DEX", "8d6", "fire"],
    ["action", "Dimension Door", "Level 4 · Conjuration", "500 ft", "", "", "", "Teleport"],
    ["bonus", "Misty Step", "Level 2 · Conjuration", "Self", "", "", "", "Teleport 30 ft"],
    ["reaction", "Shield", "Level 1 · Abjuration", "Self", "", "", "", "+5 AC"],
    ["reaction", "Counterspell", "Level 3 · Abjuration", "60 ft", "DC 15|CON", "", "", "Spell fails"]
  ];
  /* Spells by level: name, tags, casting time, range, hit or DC, damage, type or effect */
  var SPELLS = [
    [0, [["Fire Bolt", "", "1A", "120 ft", "+7", "2d10 + 4", "fire"], ["Light", "", "1A", "Touch", "", "", "Light, 1 hour"], ["Mage Hand", "", "1A", "30 ft", "", "", "Utility"], ["Prestidigitation", "", "1A", "10 ft", "", "", "Utility"], ["Ray of Frost", "", "1A", "60 ft", "+7", "2d8 + 4", "cold"]]],
    [1, [["Detect Magic", "CR", "1A", "Self", "", "", "Detection"], ["Mage Armor", "", "1A", "Touch", "", "", "AC 13 + Dex"], ["Magic Missile", "", "1A", "120 ft", "Auto", "3 × 1d4 + 1", "force"], ["Shield", "", "1R", "Self", "", "", "+5 AC"]]],
    [2, [["Misty Step", "", "1BA", "Self", "", "", "Teleport 30 ft"], ["Scorching Ray", "", "1A", "120 ft", "+7", "3 × 2d6", "fire"], ["Web", "C", "1A", "60 ft", "DC 15|DEX", "", "Restrained"]]],
    [3, [["Counterspell", "", "1R", "60 ft", "DC 15|CON", "", "Spell fails"], ["Fireball", "", "1A", "150 ft", "DC 15|DEX", "8d6", "fire"]]],
    [4, [["Dimension Door", "", "1A", "500 ft", "", "", "Teleport"], ["Greater Invisibility", "C", "1A", "Touch", "", "", "Invisible"]]]
  ];
  var SCHOOL = { "Detect Magic": "Divination · Ritual", "Mage Hand": "Conjuration", "Prestidigitation": "Transmutation", "Mage Armor": "Abjuration", "Shield": "Abjuration", "Misty Step": "Conjuration", "Web": "Conjuration · Concentration", "Counterspell": "Abjuration", "Dimension Door": "Conjuration", "Greater Invisibility": "Illusion · Concentration" };
  var LEVEL = ["Cantrips", "Level 1", "Level 2", "Level 3", "Level 4"];
  var FULL = { STR: "Strength", DEX: "Dexterity", CON: "Constitution", INT: "Intelligence", WIS: "Wisdom", CHA: "Charisma" };
  var Q = {};

  function pf(n) { return '<span class="sh-pf' + (n === 2 ? " x" : n ? " p" : "") + '" aria-label="' + (n === 2 ? "Expertise" : n ? "Proficient" : "Not proficient") + '"></span>'; }
  function rb(label, mod, cls) { return '<button type="button" class="rb' + (cls ? " " + cls : "") + '" data-roll="' + esc(label) + "|" + mod + '">' + mod + "</button>"; }
  Q.rb = rb;
  function card(title, body, o) {
    o = o || {};
    return '<section class="c3' + (o.cls ? " " + o.cls : "") + '"' + (o.style ? ' style="' + o.style + '"' : "") + ">" + (title ? '<div class="c3-h"><span class="sh-eb">' + title + "</span>" + (o.aside || "") + "</div>" : "") + '<div class="c3-b">' + body + "</div></section>";
  }
  Q.card = card;

  /* ---------- Abilities ---------- */
  // kind: "row" six across, "grid" three by two, "col" stacked. save: show each save under its ability.
  Q.abil = function (kind, save, short) {
    return '<div class="ab3 ' + kind + '">' + D.abilities.map(function (a) {
      return '<div><span class="l">' + (short ? a[1] : a[0]) + "</span>" + rb(a[0] + " check", a[3], "lg") + '<span class="sc">' + a[2] + "</span>" +
        (save ? '<span class="sv">' + pf(a[5]) + "Save " + rb(a[0] + " save", a[4], "sm") + "</span>" : "") + "</div>";
    }).join("") + "</div>";
  };
  Q.saves = function () {
    return '<div class="sv3">' + D.abilities.map(function (a) {
      return '<button type="button" class="sk3 sv' + (a[5] ? " is-prof" : "") + '" data-roll="' + a[0] + " save|" + a[4] + '">' + pf(a[5]) + '<span class="n">' + a[1] + '</span><span class="b">' + a[4] + "</span></button>";
    }).join("") + "</div>";
  };
  Q.skills = function (cols) {
    var list = D.skills.map(function (s) {
      return '<button type="button" class="sk3' + (s[3] ? " is-prof" : "") + '" data-roll="' + s[0] + " check|" + s[2] + '">' + pf(s[3]) + '<span class="ab">' + s[1] + '</span><span class="n">' + s[0] + '</span><span class="b">' + s[2] + "</span></button>";
    });
    if (!cols || cols === 1) return '<div class="sks3">' + list.join("") + "</div>";
    var per = Math.ceil(list.length / cols), out = "";
    for (var c = 0; c < cols; c++) out += "<div>" + list.slice(c * per, (c + 1) * per).join("") + "</div>";
    return '<div class="sks3 c' + cols + '">' + out + "</div>";
  };
  Q.senses = function () {
    return '<div class="sn3">' + [["14", "Passive Perception"], ["17", "Passive Investigation"], ["14", "Passive Insight"]].map(function (s) {
      return '<div><span class="sh-num">' + s[0] + "</span>" + s[1] + "</div>";
    }).join("") + '<div class="tx">Darkvision 60 ft</div></div>';
  };
  Q.profs = function () {
    return P.facts([["Armor", "None"], ["Weapons", "Simple weapons"], ["Tools", "Calligrapher's Supplies"], ["Languages", "Common, Elvish, Draconic, Sylvan"]]);
  };

  /* ---------- Stats ---------- */
  function cell(label, v) { return '<div><span class="l">' + label + "</span>" + v + "</div>"; }
  Q.cell = cell;
  Q.num = function (v, unit) { return '<span class="v">' + v + (unit ? "<small> " + unit + "</small>" : "") + "</span>"; };
  Q.insp = function () { return '<button type="button" class="insp3 on" data-insp aria-pressed="true" aria-label="Heroic Inspiration"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>'; };
  Q.effects = function () {
    return '<div class="sh-chips"><span class="sh-chip">Mage Armor <span class="du3">8 h</span></span><button type="button" class="sh-link">Add</button></div>';
  };
  Q.hitDice = function () {
    return '<span class="hd3"><span class="sh-num">5</span> of <span class="sh-num">7</span> d6</span>';
  };
  Q.rest = function (stack) {
    return '<div class="rest3' + (stack ? " stack" : "") + '"><button type="button" class="sh-btn lg">' + I.moon + 'Short Rest</button><button type="button" class="sh-btn lg">' + I.moon + "Long Rest</button></div>";
  };
  Q.deathSaves = function () {
    var box = '<i></i><i></i><i></i>';
    return '<div class="ds3"><span>Successes</span><span class="bx">' + box + '</span><span>Failures</span><span class="bx f">' + box + "</span></div>";
  };

  /* ---------- Hit points: every form edits the same numbers ---------- */
  function amt() { return '<input class="amt3" type="number" inputmode="numeric" value="7" min="0" aria-label="Amount" data-amt>'; }
  function life() { return P.life(); }
  // D&D Beyond's box: Heal over the amount over Damage, then current, max and temp
  Q.hpBox = function () {
    return '<div class="hpb3" data-hpedit><div class="ed"><button type="button" class="sh-btn" data-hpdo="heal">Heal</button>' + amt() + '<button type="button" class="sh-btn dmg" data-hpdo="dmg">Damage</button></div>' +
      '<div class="nm"><div class="nums"><div><span class="l">Current</span><span class="v cur" data-hpcur>' + D.hp + '</span></div><div><span class="l">Max</span><span class="v">' + D.hpMax + '</span></div><div><span class="l">Temp</span><span class="v tmp" data-hptemp>' + D.temp + "</span></div></div>" +
      life() + '<span class="cap">Hit points</span></div></div>';
  };
  // Foundry's sidebar: the bar under the numbers, the change row under the bar
  Q.hpSide = function () {
    return '<div class="hps3" data-hpedit><div class="top"><span class="sh-eb">Hit points</span><span class="tmp">Temp <span class="sh-num" data-hptemp>' + D.temp + '</span></span></div>' +
      '<div class="big"><span class="cur" data-hpcur>' + D.hp + '</span><span class="max">/ ' + D.hpMax + "</span></div>" + life() +
      '<div class="row">' + amt() + '<button type="button" class="sh-btn dmg" data-hpdo="dmg">Damage</button><button type="button" class="sh-btn" data-hpdo="heal">Heal</button><button type="button" class="sh-btn" data-hpdo="temp">Temp</button></div></div>';
  };
  // The printed sheet: maximum on the line above, current large in the box, temporary in its own box
  Q.hpPaper = function () {
    return '<div class="hpp3" data-hpedit><div class="mx"><span>Hit point maximum</span><span class="sh-num">' + D.hpMax + "</span></div>" +
      '<div class="cur" data-hpcur>' + D.hp + '</div><span class="cap">Current hit points</span>' + life() +
      '<div class="row">' + amt() + '<button type="button" class="sh-btn dmg" data-hpdo="dmg">Damage</button><button type="button" class="sh-btn" data-hpdo="heal">Heal</button><button type="button" class="sh-btn" data-hpdo="temp">Temp</button></div></div>';
  };

  /* ---------- The phone's pinned bar: who, then AC, hit points, initiative and speed ---------- */
  Q.vitals = function () {
    return '<div class="mv3" data-vitals><div class="mv3-id">' + P.port() + '<div class="nm"><b>' + esc(D.name) + "</b><span>" + esc(D.sub) + '</span></div><button type="button" class="sh-btn">' + I.moon + "Rest</button></div>" +
      '<div class="mv3-row c3"><div class="cell"><span class="l">AC</span><span class="v">' + D.ac + "</span></div>" +
      '<button type="button" class="cell hp" data-hptoggle aria-expanded="false"><span class="l">Hit points <span class="chg">Change</span></span><span class="hpn"><span class="cur" data-hpcur>' + D.hp + '</span><span class="max">/ ' + D.hpMax + '</span><span class="tmp">+<span data-hptemp>' + D.temp + "</span></span></span>" + life() + "</button>" +
      '<div class="cell"><span class="l">Init</span>' + rb("Initiative", D.init, "sm") + "</div>" +
      '<div class="cell"><span class="l">Speed</span><span class="v">' + D.speed + "</span></div></div>" +
      '<div class="mv3-ed" data-hpedit hidden>' + amt() + '<button type="button" class="sh-btn dmg" data-hpdo="dmg">Damage</button><button type="button" class="sh-btn" data-hpdo="heal">Heal</button><button type="button" class="sh-btn" data-hpdo="temp">Temp</button></div></div>';
  };

  /* ---------- Tables: actions, spells and gear share one row ---------- */
  function hitCell(name, hit) {
    if (!hit) return '<span class="dim3">--</span>';
    if (hit.indexOf("DC") === 0) { var p = hit.split("|"); return '<span class="dc3"><small>' + p[1] + '</small><span class="sh-num">' + p[0].slice(3) + "</span></span>"; }
    if (hit === "Auto") return '<span class="dc3"><small>Auto</small><span class="sh-num">hit</span></span>';
    return rb(name + " to hit", hit);
  }
  function effCell(name, dmg, dt, bare) {
    if (dmg) return '<button type="button" class="rb dmg" data-dmg="' + esc(name) + "|" + dmg + "|" + dt + '" aria-label="' + esc(dmg + " " + dt) + '">' + dmg.replace(/ /g, "") + (bare ? "" : " <small>" + dt + "</small>") + "</button>";
    return '<span class="eff3">' + esc(dt || "--") + "</span>";
  }
  function tags(t) { return (t || "").split("").filter(Boolean).map(function (c) { return ' <span class="sh-tag' + (c === "C" ? " c" : "") + '" title="' + (c === "C" ? "Concentration" : "Ritual") + '">' + c + "</span>"; }).join(""); }
  function nm(name, meta, t) { return '<div class="nm"><b>' + esc(name) + tags(t) + "</b>" + (meta ? "<span>" + esc(meta) + "</span>" : "") + "</div>"; }
  function gh(title, aside) { return '<div class="g3"><span class="sh-eb">' + title + "</span>" + (aside || "") + "</div>"; }
  Q.gh = gh;

  Q.actions = function (narrow, o) {
    o = o || {};
    var head = narrow ? '<div class="t3-h"><span>Name</span><span>Hit / DC</span><span class="r">Damage</span></div>' : '<div class="t3-h"><span>Name</span><span>Range</span><span>Hit / DC</span><span class="r">Damage</span></div>';
    function rows(cost) {
      return ACTS.filter(function (a) { return a[0] === cost; }).map(function (a) {
        // On a phone the range and the damage type join the line under the name, so the damage column stays narrow
        var conc = a[2].indexOf("Concentration") > 0, kind = a[2].split(" · ")[0].replace("Simple weapon", "Weapon");
        var meta = narrow ? kind + " · " + a[3] + (a[5] ? " · " + a[6] : "") : a[2].replace(" · Concentration", "");
        return '<div class="t3-r">' + nm(a[1], meta, conc ? "C" : "") + (narrow ? "" : '<span class="c">' + a[3] + "</span>") +
          hitCell(a[1], a[4]) + '<span class="r">' + effCell(a[1], a[5], a[5] ? a[6] : a[7], narrow) + "</span></div>";
      }).join("");
    }
    // One header row for the page: the columns line up under it
    function table(cost) { return '<div class="t3 acts' + (narrow ? " n" : "") + '">' + (cost === "action" ? head : "") + rows(cost) + "</div>"; }
    var std = '<p class="std3">Every turn you can also Dash, Disengage, Dodge, Help, Hide, Ready, Search, Study, Influence or Utilize.</p>';
    var lim = '<div class="t3 lim">' +
      '<div class="t3-r">' + nm("Arcane Recovery", "Wizard · on a Short Rest, regain 4 levels of slots") + '<span class="r uses3">' + slotsHtml("ar", 1, 0) + "<span>1 per Long Rest</span></span></div>" +
      '<div class="t3-r">' + nm("Detect Magic", "Magic Initiate · without a slot") + '<span class="r uses3">' + slotsHtml("mi", 1, 0) + "<span>1 per Long Rest</span></span></div></div>";
    return gh("Actions") + table("action") + std +
      gh("Bonus Actions") + table("bonus") + gh("Reactions") + table("reaction") + gh("Limited use") + lim;
  };
  // The printed sheet's Attacks & Spellcasting box: weapons and cantrips, three columns
  Q.attacks = function () {
    return '<div class="t3 atk"><div class="t3-h"><span>Name</span><span>Atk bonus</span><span class="r">Damage / type</span></div>' +
      ACTS.slice(0, 4).map(function (a) { return '<div class="t3-r">' + nm(a[1], a[3]) + hitCell(a[1], a[4]) + '<span class="r">' + effCell(a[1], a[5], a[6]) + "</span></div>"; }).join("") + "</div>";
  };

  function slotsHtml(key, of, used) {
    var s = "";
    for (var i = 0; i < of; i++) s += '<button type="button" class="' + (i >= of - used ? "used" : "") + '" aria-label="' + (i >= of - used ? "Used" : "Available") + '"><i></i></button>';
    return '<span class="sl3" data-slot="' + key + '">' + s + "</span>";
  }
  Q.slots = slotsHtml;
  Q.spellHead = function () {
    return '<div class="sts3 c3 sp3">' + cell("Ability", Q.num("INT")) + cell("Spell attack", rb("Spell attack", "+7")) + cell("Save DC", Q.num(15)) + cell("Prepared", Q.num(14)) + "</div>";
  };
  Q.spells = function (narrow, o) {
    o = o || {};
    var head = narrow ? '<div class="t3-h"><span>Name</span><span>Hit / DC</span><span class="r">Effect</span></div>' : '<div class="t3-h"><span>Name</span><span>Time</span><span>Range</span><span>Hit / DC</span><span class="r">Effect</span></div>';
    return (o.noHead ? "" : Q.spellHead()) + SPELLS.map(function (g, gi) {
      var slot = g[0] ? D.slots[g[0] - 1] : null;
      var aside = slot ? '<span class="slotx">' + slotsHtml(String(g[0]), slot[1], slot[2]) + "<span>Slots</span></span>" : '<span class="sh-eb">At will</span>';
      return gh(LEVEL[g[0]], aside) + '<div class="t3 sps' + (narrow ? " n" : "") + '">' + (gi ? "" : head) + g[1].map(function (s) {
        var time = { "1A": "Action", "1BA": "Bonus action", "1R": "Reaction" }[s[2]];
        var meta = narrow ? time + " · " + s[3] + (s[5] ? " · " + s[6] : "") : (SCHOOL[s[0]] || "Evocation").replace(" · Concentration", "");
        return '<div class="t3-r">' + nm(s[0], meta, s[1]) + (narrow ? "" : '<span class="c">' + s[2] + '</span><span class="c">' + s[3] + "</span>") + hitCell(s[0], s[4]) + '<span class="r">' + effCell(s[0], s[5], s[6], narrow) + "</span></div>";
      }).join("") + "</div>";
    }).join("");
  };

  Q.gear = function (narrow) {
    var coins = '<div class="sh-coins c3">' + D.gear.coins.map(function (c) { return '<div><span class="sh-num">' + c[1] + "</span><span>" + c[0] + "</span></div>"; }).join("") + "</div>";
    function table(rows) {
      return '<div class="t3 gr"><div class="t3-h"><span>Name</span><span class="r">Qty</span><span class="r">Weight</span></div>' + rows.map(function (r) {
        return '<div class="t3-r">' + nm(r[0], r[1]) + '<span class="c r">' + r[2] + '</span><span class="c r">' + r[3] + "</span></div>";
      }).join("") + "</div>";
    }
    var worn = [["Wand of the War Mage, +1", "Attuned · +1 to spell attack rolls", 1, "1 lb"], ["Quarterstaff", "Arcane focus · Versatile (1d8)", 1, "4 lb"], ["Dagger", "Finesse, Light, Thrown (20/60)", 2, "2 lb"], ["Robe", "Worn", 1, "4 lb"]];
    var pack = [["Spellbook", "34 spells copied", 1, "3 lb"], ["Ink (1-ounce bottle)", "", 1, "--"], ["Ink Pen", "", 1, "--"], ["Parchment", "", 10, "--"], ["Book", "Histories of the Thornwood", 2, "10 lb"]];
    return coins + gh("Equipment", '<span class="att3">Attuned <span class="sh-num">1 / 3</span></span>') + table(worn) +
      gh("Backpack", '<span class="att3"><span class="sh-num">24 / 120 lb</span><span class="sh-meter" style="width:72px"><i style="width:20%"></i></span></span>') + table(pack) +
      '<div style="padding-top:12px"><button type="button" class="sh-btn lg">Add an item</button></div>';
  };

  Q.features = function () {
    return D.features.map(function (g, gi) {
      return gh(g[0]) + '<div class="t3 ft">' + g[1].map(function (f) {
        var end = f[0] === "Spellcasting" ? '<span class="r uses3"><span>DC 15 · +7</span></span>' : "";
        return '<div class="t3-r">' + nm(f[0], f[1]) + end + "</div>";
      }).join("") + "</div>";
    }).join("");
  };
  Q.featuresBrief = function () {
    var list = [["Spellcasting", "Intelligence · DC 15 · +7"], ["Arcane Recovery", "Regain 4 levels of slots on a Short Rest, once a day"], ["Ritual Adept", "Cast rituals from your book"], ["Scholar", "Expertise in Arcana"], ["Evocation Savant", "Copy evocation spells in half the time"], ["Potent Cantrip", "Half damage on a miss or a save"], ["Sculpt Spells", "Allies take no damage from your evocations"], ["Darkvision", "60 ft"], ["Fey Ancestry", "Advantage on saves against Charmed"], ["Keen Senses", "Proficiency in Perception"], ["Trance", "A Long Rest in 4 hours"], ["Magic Initiate", "Detect Magic once a day without a slot"]];
    return '<div class="ftb3">' + list.map(function (f) { return "<p><b>" + f[0] + ".</b> " + esc(f[1]) + "</p>"; }).join("") + "</div>";
  };
  Q.bio = function () {
    var facts = P.facts([["Background", "Sage"], ["Species", "High Elf · Medium"], ["Alignment", "Neutral good"], ["Age", "112"], ["Languages", "Common, Elvish, Draconic, Sylvan"]]);
    var traits = [["Personality", "Answers a question with three more, then a book recommendation."], ["Ideal", "Knowledge belongs to whoever goes looking for it."], ["Bond", "The library at Candlekeep turned her away once. She means to be invited back."], ["Flaw", "Will open the forbidden door to find out why it is forbidden."]];
    return facts + gh("Personality") + '<div class="ftb3">' + traits.map(function (t) { return "<p><b>" + t[0] + ".</b> " + esc(t[1]) + "</p>"; }).join("") + "</div>" +
      gh("Notes", '<button type="button" class="sh-link">Edit</button>') + '<p class="note3">Owes Grukk Twotooth a favour for the safe passage through the warren. The second book is on loan from the Hollins farm and should go back before winter.</p>';
  };

  S.Q = Q;
  S.ACTS3 = ACTS;
})();
