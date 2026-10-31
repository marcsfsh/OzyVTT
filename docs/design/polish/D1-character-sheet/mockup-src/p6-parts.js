(function () {
  "use strict";

  /* ---------- The character: Lyra Emberwise, from the app's own sheet mockups ---------- */
  var D = {
    name: "Lyra Emberwise",
    sub: "Evoker Wizard 7 · Elf · Sage",
    ac: 15, init: "+2", speed: 30, prof: "+3",
    hp: 38, hpMax: 44, temp: 0,
    hd: { left: 5, of: 7, die: "d6" },
    abilities: [
      ["Strength", "STR", 8, "−1", "−1", 0],
      ["Dexterity", "DEX", 14, "+2", "+2", 0],
      ["Constitution", "CON", 14, "+2", "+2", 0],
      ["Intelligence", "INT", 18, "+4", "+7", 1],
      ["Wisdom", "WIS", 12, "+1", "+4", 1],
      ["Charisma", "CHA", 10, "+0", "+0", 0]
    ],
    skills: [
      ["Acrobatics", "DEX", "+2", 0], ["Animal Handling", "WIS", "+1", 0], ["Arcana", "INT", "+10", 2],
      ["Athletics", "STR", "−1", 0], ["Deception", "CHA", "+0", 0], ["History", "INT", "+7", 1],
      ["Insight", "WIS", "+4", 1], ["Intimidation", "CHA", "+0", 0], ["Investigation", "INT", "+7", 1],
      ["Medicine", "WIS", "+1", 0], ["Nature", "INT", "+4", 0], ["Perception", "WIS", "+4", 1],
      ["Performance", "CHA", "+0", 0], ["Persuasion", "CHA", "+0", 0], ["Religion", "INT", "+4", 0],
      ["Sleight of Hand", "DEX", "+2", 0], ["Stealth", "DEX", "+2", 0], ["Survival", "WIS", "+1", 0]
    ],
    pinned: [["Perception", "+4", 1], ["Arcana", "+10", 2], ["Investigation", "+7", 1], ["Insight", "+4", 1]],
    slots: [[1, 4, 1], [2, 3, 0], [3, 3, 1], [4, 1, 0]],
    actions: [
      ["Attacks", [
        ["Dagger", "", "+5 · 20/60 ft · 1d4 + 2 piercing · Finesse, Light, Thrown", "Attack"],
        ["Quarterstaff", "", "+2 · 1d6 − 1 bludgeoning · Versatile (1d8)", "Attack"],
        ["Fire Bolt", "", "Cantrip · +7 · 120 ft · 2d10 + 4 fire", "Cast"],
        ["Ray of Frost", "", "Cantrip · +7 · 60 ft · 2d8 + 4 cold", "Cast"]
      ]],
      ["Actions", [
        ["Magic Missile", "", "Level 1 · 120 ft · three darts, 1d4 + 1 force each", "Cast"],
        ["Scorching Ray", "", "Level 2 · +7 · 120 ft · three rays, 2d6 fire each", "Cast"],
        ["Web", "C", "Level 2 · DC 15 Dex · 60 ft · 1 hour", "Cast"],
        ["Fireball", "", "Level 3 · DC 15 Dex · 150 ft · 8d6 fire", "Cast"],
        ["Dimension Door", "", "Level 4 · 500 ft · you and one willing creature", "Cast"]
      ]],
      ["Bonus actions", [["Misty Step", "", "Level 2 · Self · teleport 30 ft", "Cast"]]],
      ["Reactions", [
        ["Shield", "", "Level 1 · Self · +5 AC until your next turn", "Cast"],
        ["Counterspell", "", "Level 3 · 60 ft · Con save or the spell fails", "Cast"]
      ]]
    ],
    spells: [
      ["Cantrips", null, [
        ["Fire Bolt", "", "Action · 120 ft · +7 · 2d10 + 4 fire"],
        ["Light", "", "Action · Touch · 1 hour"],
        ["Mage Hand", "", "Action · 30 ft · 1 minute"],
        ["Prestidigitation", "", "Action · 10 ft · up to 1 hour"],
        ["Ray of Frost", "", "Action · 60 ft · +7 · 2d8 + 4 cold"]
      ]],
      ["Level 1", 0, [
        ["Detect Magic", "CR", "Action · Self · 10 minutes"],
        ["Mage Armor", "", "Action · Touch · 8 hours"],
        ["Magic Missile", "", "Action · 120 ft · 1d4 + 1 force × 3"],
        ["Shield", "", "Reaction · Self · +5 AC"]
      ]],
      ["Level 2", 1, [
        ["Misty Step", "", "Bonus action · Self · 30 ft"],
        ["Scorching Ray", "", "Action · 120 ft · +7 · 2d6 fire × 3"],
        ["Web", "C", "Action · 60 ft · DC 15 Dex"]
      ]],
      ["Level 3", 2, [
        ["Counterspell", "", "Reaction · 60 ft · Con save"],
        ["Fireball", "", "Action · 150 ft · DC 15 Dex · 8d6 fire"]
      ]],
      ["Level 4", 3, [
        ["Dimension Door", "", "Action · 500 ft"],
        ["Greater Invisibility", "C", "Action · Touch · 1 minute"]
      ]]
    ],
    gear: {
      coins: [["PP", 0], ["GP", 46], ["EP", 0], ["SP", 12], ["CP", 30]],
      worn: [
        ["Wand of the War Mage, +1", "Attuned · +1 to spell attack rolls"],
        ["Quarterstaff", "Arcane focus · 1d6 bludgeoning · Versatile (1d8)"],
        ["Dagger", "× 2 · 1d4 piercing · Finesse, Light, Thrown (20/60)"],
        ["Robe", "Worn"]
      ],
      pack: [
        ["Spellbook", "34 spells copied"],
        ["Ink (1-ounce bottle)", "Enough for about 500 pages"],
        ["Ink Pen", ""],
        ["Parchment", "× 10"],
        ["Book", "× 2 · Histories of the Thornwood"]
      ]
    },
    features: [
      ["Wizard 7 · Evoker", [
        ["Spellcasting", "Intelligence · save DC 15 · attack +7"],
        ["Ritual Adept", "Cast a ritual from your book without preparing it"],
        ["Scholar", "Expertise in Arcana"],
        ["Evocation Savant", "Copy evocation spells for half the time and gold"],
        ["Potent Cantrip", "A damaging cantrip still deals half on a miss or a save"],
        ["Sculpt Spells", "Choose allies who take no damage from your evocations"]
      ]],
      ["Elf · High Elf", [
        ["Darkvision", "60 ft"],
        ["Fey Ancestry", "Advantage on saves against being Charmed"],
        ["Keen Senses", "Proficiency in Perception"],
        ["Trance", "A Long Rest in 4 hours"]
      ]],
      ["Sage · Feats", [["Magic Initiate (Wizard)", "Two cantrips and a level 1 spell, once a day without a slot"]]]
    ],
    facts: [
      ["Species and size", "Elf · Medium"],
      ["Background", "Sage"],
      ["Languages", "Common, Elvish, Draconic, Sylvan"],
      ["Armor training", "None"],
      ["Weapons", "Simple weapons"],
      ["Tools", "Calligrapher's Supplies"]
    ],
    senses: [["Darkvision", "60 ft"], ["Passive Perception", "14"], ["Passive Insight", "14"], ["Passive Investigation", "17"]]
  };

  /* ---------- Icons ---------- */
  var I = {
    hat: '<svg viewBox="0 0 48 48" fill="none" stroke="var(--party)" stroke-width="2.4" stroke-linejoin="round" aria-hidden="true"><path d="M24 6 33 32H15z"/><path d="M8 35c4 3.4 28 3.4 32 0"/><circle cx="22" cy="22" r="1.6" fill="var(--hp)" stroke="none"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
    screen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17h16"/><path d="M6 17a6 6 0 0 1 12 0"/><path d="M12 8V6"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/></svg>',
    dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>',
    die: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16"/><circle cx="9" cy="9" r="0.8"/><circle cx="15" cy="15" r="0.8"/><circle cx="15" cy="9" r="0.8"/><circle cx="9" cy="15" r="0.8"/></svg>',
    person: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/></svg>',
    doc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h7"/></svg>',
    lines: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h10"/></svg>'
  };

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

  /* ---------- Parts ---------- */
  var P = {};
  P.port = function () { return '<div class="sh-port">' + I.hat + "</div>"; };
  P.who = function (sub) {
    return '<div class="who"><h2 class="sh-name">' + esc(D.name) + "</h2>" + (sub === false ? "" : '<p class="sh-sub">' + esc(D.sub) + "</p>") + "</div>";
  };
  P.life = function () {
    var n = Math.max(1, Math.min(22, Math.ceil(D.hpMax / 2)));
    var lit = Math.round((D.hp / D.hpMax) * n);
    var s = "";
    for (var i = 0; i < n; i++) s += i < lit ? "<i></i>" : '<i class="lost"></i>';
    return '<div class="sh-life" role="img" aria-label="' + D.hp + " of " + D.hpMax + ' hit points">' + s + "</div>";
  };
  P.hp = function (o) {
    o = o || {};
    var top = '<div class="sh-hp-top">' + (o.label === false ? "" : '<span class="sh-eb" style="align-self:center;margin-right:2px">HP</span>') +
      '<span class="cur">' + D.hp + '</span><span class="max">/ ' + D.hpMax + "</span>" + (o.temp === false ? "" : '<span class="tmp">Temp ' + D.temp + "</span>") + "</div>";
    var quick = o.quick ? '<div class="sh-hpq"><span class="amt">0</span><button type="button" class="sh-btn">Damage</button><button type="button" class="sh-btn">Heal</button><button type="button" class="sh-btn">Temp</button></div>' : "";
    return '<div class="sh-hp">' + top + P.life() + quick + "</div>";
  };
  P.stat = function (label, value, unit) {
    return '<div class="sh-stat"><span class="sh-eb">' + label + '</span><span class="v">' + value + (unit ? "<small> " + unit + "</small>" : "") + "</span></div>";
  };
  P.stats4 = function () { return P.stat("AC", D.ac) + P.stat("Initiative", D.init) + P.stat("Speed", D.speed, "ft") + P.stat("Proficiency", D.prof); };
  P.pips = function (of, used) {
    var s = "";
    for (var i = 0; i < of; i++) s += i < of - used ? "<i></i>" : '<i class="used"></i>';
    return '<span class="sh-pips">' + s + "</span>";
  };
  P.hitDice = function () {
    return '<span class="sh-eb">Hit dice</span><div style="display:flex;align-items:center;gap:8px"><span class="sh-num" style="font-size:22px">' + D.hd.left + "/" + D.hd.of + '</span><span style="font-size:12px;color:var(--text-muted)">' + D.hd.die + "</span>" + P.pips(D.hd.of, D.hd.of - D.hd.left) + "</div>";
  };
  P.effects = function (o) {
    o = o || {};
    return '<div class="sh-chips"><span class="sh-chip is-effect">Mage Armor <span class="t">8 h</span></span>' + (o.add === false ? "" : '<button type="button" class="sh-link">Add condition</button>') + "</div>";
  };
  P.insp = function () { return '<span class="sh-lamp is-lit"><i></i>Heroic Inspiration</span>'; };
  P.exh = function () { return '<span class="sh-lamp"><span>Exhaustion</span>' + P.pips(6, 6).replace('class="sh-pips"', 'class="sh-pips" style="opacity:.9"') + "</span>"; };
  P.rest = function () { return '<button type="button" class="sh-btn lg">' + I.moon + "Rest" + I.down + "</button>"; };
  P.more = function () { return '<span class="sh-iconbtn" aria-label="Sheet menu">' + I.dots + "</span>"; };

  P.abRows = function () {
    return '<div class="sh-ab">' + D.abilities.map(function (a) {
      return '<div class="sh-abrow"><div class="n"><b>' + a[0] + '</b><span class="sh-num">' + a[2] + '</span></div><div class="mod">' + a[3] +
        '</div><div class="sv"><span class="sh-pf' + (a[5] ? " p" : "") + '"></span>Save<span class="sh-num">' + a[4] + "</span></div></div>";
    }).join("") + "</div>";
  };
  P.abTiles = function (six) {
    return '<div class="sh-abtiles' + (six ? " six" : "") + '">' + D.abilities.map(function (a) {
      return '<div class="sh-abtile"><span class="a">' + a[1] + '</span><span class="mod">' + a[3] + '</span><span class="sc">' + a[2] +
        '</span><span class="sv"><span class="sh-pf' + (a[5] ? " p" : "") + '"></span>Save <span class="sh-num">' + a[4] + "</span></span></div>";
    }).join("") + "</div>";
  };
  P.skills = function (cols) {
    var list = D.skills.map(function (s) {
      return '<div class="sh-sk' + (s[3] ? " is-prof" : "") + '"><span class="sh-pf' + (s[3] === 2 ? " x" : s[3] ? " p" : "") + '"></span><span>' + s[0] + '</span><span class="ab">' + s[1] + '</span><span class="sh-num">' + s[2] + "</span></div>";
    });
    if (!cols || cols === 1) return '<div class="sh-skills">' + list.join("") + "</div>";
    var per = Math.ceil(list.length / cols);
    var out = "";
    for (var c = 0; c < cols; c++) out += "<div>" + list.slice(c * per, (c + 1) * per).join("") + "</div>";
    return '<div class="sh-skills c' + cols + '">' + out + "</div>";
  };
  P.facts = function (rows) {
    return '<dl class="sh-facts">' + rows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("") + "</dl>";
  };
  P.pinned = function () {
    return '<div class="sh-chips">' + D.pinned.map(function (p) {
      return '<button type="button" class="sh-chip is-pin' + (p[2] ? " is-prof" : "") + '"><span class="sh-pf' + (p[2] === 2 ? " x" : " p") + '"></span>' + p[0] + ' <span class="sh-num">' + p[1] + "</span></button>";
    }).join("") + "</div>";
  };
  P.slots = function () {
    return '<div class="slotline">' + D.slots.map(function (s) {
      return '<span><span class="sh-num">' + ["", "1st", "2nd", "3rd", "4th"][s[0]] + "</span>" + P.pips(s[1], s[2]) + "</span>";
    }).join("") + "</div>";
  };
  P.uses = function () {
    return '<div class="sh-list">' + row("Arcane Recovery", "", "Back on a Long Rest · recover 4 levels of slots on a Short Rest", P.pips(1, 0) + '<button type="button" class="sh-btn">Use</button>') +
      row("Magic Initiate", "", "Detect Magic without a slot · back on a Long Rest", P.pips(1, 0) + '<button type="button" class="sh-btn">Cast</button>') + "</div>";
  };
  function row(name, tags, meta, end, tight) {
    var t = "";
    if (tags) t = tags.split("").map(function (c) { return '<span class="sh-tag' + (c === "C" ? " c" : "") + '">' + c + "</span>"; }).join("");
    return '<div class="sh-row' + (tight ? " is-tight" : "") + '"><div class="nm"><span>' + esc(name) + "</span>" + t + "</div>" + (meta ? '<div class="mt">' + esc(meta) + "</div>" : "") + '<div class="end">' + (end || "") + "</div></div>";
  }
  P.row = row;
  P.actions = function (o) {
    o = o || {};
    var head = o.filter ? '<div class="sh-seg" role="group" aria-label="Show"><span class="on">All</span><span>Attacks</span><span>Actions</span><span>Bonus</span><span>Reactions</span></div>' : "";
    var groups = D.actions.map(function (g) {
      return '<div class="sh-grouphead"><span class="sh-eb">' + g[0] + '</span><span class="sh-eb">' + g[1].length + '</span></div><div class="sh-list">' +
        g[1].map(function (a) { return row(a[0], a[1], a[2], '<button type="button" class="sh-btn">' + a[3] + "</button>"); }).join("") + "</div>";
    }).join("");
    return head + "<div>" + groups + "</div>";
  };
  P.spells = function () {
    var top = '<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px"><div class="sh-seg" role="group" aria-label="Show"><span class="on">Prepared</span><span>Spellbook</span><span>Rituals</span></div>' +
      '<span style="font-size:13px;color:var(--text-muted)">Save DC <span class="sh-num" style="font-size:19px;color:var(--text)">15</span> · Attack <span class="sh-num" style="font-size:19px;color:var(--text)">+7</span> · INT</span></div>';
    var groups = D.spells.map(function (g) {
      var slot = g[1] === null ? "" : P.pips(D.slots[g[1]][1], D.slots[g[1]][2]);
      return '<div class="sh-grouphead"><span class="sh-eb">' + g[0] + "</span>" + slot + '</div><div class="sh-list">' +
        g[2].map(function (s) { return row(s[0], s[1], s[2], '<button type="button" class="sh-btn">Cast</button>'); }).join("") + "</div>";
    }).join("");
    return top + "<div>" + groups + "</div>";
  };
  P.gear = function () {
    var coins = '<div class="sh-coins">' + D.gear.coins.map(function (c) { return '<div><span class="sh-num">' + c[1] + "</span><span>" + c[0] + "</span></div>"; }).join("") + "</div>";
    var att = '<div class="sh-grouphead"><span class="sh-eb">Attunement</span><span style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted)"><span class="sh-num" style="font-size:17px">1 of 3</span>' + P.pips(3, 2) + "</span></div>";
    var worn = '<div class="sh-grouphead"><span class="sh-eb">Worn and held</span></div><div class="sh-list">' + D.gear.worn.map(function (g) { return row(g[0], "", g[1], '<span class="sh-iconbtn" style="width:24px">›</span>'); }).join("") + "</div>";
    var pack = '<div class="sh-grouphead"><span class="sh-eb">In the backpack</span><span style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted)"><span class="sh-num" style="font-size:17px">12 / 30 lb</span><span class="sh-meter" style="width:80px"><i style="width:40%"></i></span></span></div><div class="sh-list">' +
      D.gear.pack.map(function (g) { return row(g[0], "", g[1], '<span class="sh-iconbtn" style="width:24px">›</span>'); }).join("") + "</div>";
    return att + coins + worn + pack + '<div style="padding-top:12px"><button type="button" class="sh-btn lg">Add an item</button></div>';
  };
  P.features = function () {
    var xp = '<div class="sh-grouphead"><span class="sh-eb">Experience</span><span class="sh-num" style="font-size:17px;color:var(--text-dim)">23,000 / 34,000 XP</span></div><div class="sh-meter"><i style="width:68%"></i></div>';
    var uses = '<div class="sh-grouphead"><span class="sh-eb">Uses</span></div>' + P.uses();
    var groups = D.features.map(function (g) {
      return '<div class="sh-grouphead"><span class="sh-eb">' + g[0] + '</span></div><div class="sh-list">' + g[1].map(function (f) { return row(f[0], "", f[1], ""); }).join("") + "</div>";
    }).join("");
    return xp + uses + groups;
  };
  P.notes = function () {
    return P.facts(D.facts) + '<div class="sh-grouphead"><span class="sh-eb">Notes</span><button type="button" class="sh-link">Edit</button></div>' +
      '<p style="margin:0;font-size:14px;color:var(--text-dim);max-width:62ch">Owes Grukk Twotooth a favour for the safe passage through the warren. The second book is on loan from the Hollins farm and should go back before winter.</p>';
  };
  P.senses = function () { return P.facts(D.senses); };

  /* ---------- Tabs ---------- */
  P.tabs = function (gid, items, on, o) {
    o = o || {};
    return '<div class="sh-tabs' + (o.scroll ? " is-scroll" : "") + '" role="tablist" data-tabs="' + gid + '"' + (o.style ? ' style="' + o.style + '"' : "") + ">" +
      items.map(function (t) { return '<button type="button" role="tab" class="sh-tab' + (t[0] === on ? " on" : "") + '" data-tab="' + t[0] + '" aria-selected="' + (t[0] === on) + '">' + t[1] + "</button>"; }).join("") +
      '<span class="sh-ink" aria-hidden="true"></span></div>';
  };
  P.panel = function (gid, key, on, html, extra) {
    return '<section class="tp" data-group="' + gid + '" data-panel="' + key + '"' + (key === on ? "" : " hidden") + (extra ? " " + extra : "") + ">" + html + "</section>";
  };

  window.SHEET = { D: D, I: I, P: P, esc: esc };
})();
