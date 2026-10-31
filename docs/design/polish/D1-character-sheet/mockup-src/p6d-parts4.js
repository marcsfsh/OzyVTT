(function () {
  "use strict";
  var S = window.SHEET;
  var D = S.D, I = S.I, P = S.P, Q = S.Q, esc = S.esc;

  function pf(n) { return '<span class="sh-pf' + (n === 2 ? " x" : n ? " p" : "") + '" aria-label="' + (n === 2 ? "Expertise" : n ? "Proficient" : "Not proficient") + '"></span>'; }
  function amt() { return '<input class="amt3" type="number" inputmode="numeric" value="7" min="0" aria-label="Amount" data-amt>'; }
  function change() { return '<button type="button" class="sh-btn dmg" data-hpdo="dmg">Damage</button><button type="button" class="sh-btn" data-hpdo="heal">Heal</button><button type="button" class="sh-btn" data-hpdo="temp">Temp</button>'; }
  function rest() { return '<button type="button" class="sh-btn">' + I.moon + "Rest" + I.down + "</button>"; }

  /* ---------- The vitals band: one strip for everything you watch in a fight, the same on every screen ---------- */
  Q.band = function () {
    var id = '<div class="vb-id">' + P.port() + '<div class="who3"><h2 class="sh-name">' + esc(D.name) + '</h2><p class="sh-sub">' + esc(D.sub) + "</p>" + Q.effects() + "</div></div>";
    var hp = '<div class="vb-c hp" data-hpedit><div class="hp-top"><span class="l">Hit points</span><span class="tmp">Temp <span class="sh-num" data-hptemp>' + D.temp + "</span></span></div>" +
      '<div class="hp-mid"><span class="cur" data-hpcur>' + D.hp + '</span><span class="max">/ ' + D.hpMax + '</span><span class="ctl">' + amt() + change() + "</span></div>" + P.life() + "</div>";
    var stats = '<div class="vb-stats c3"><div class="vb-c"><span class="l">AC</span><span class="v">' + D.ac + "</span></div>" + hp +
      '<button type="button" class="vb-c roll" data-roll="Initiative|' + D.init + '"><span class="l">Initiative</span><span class="v">' + D.init + "</span></button>" +
      '<div class="vb-c"><span class="l">Speed</span><span class="v">' + D.speed + "<small> ft</small></span></div>" +
      '<div class="vb-c"><span class="l">Proficiency</span><span class="v">' + D.prof + "</span></div>" +
      '<div class="vb-c"><span class="l">Inspiration</span>' + Q.insp() + "</div></div>";
    var r = '<div class="vb-rest">' + rest() + '<span class="hd">Hit dice <span class="sh-num">5/7</span> d6</span></div>';
    return '<div class="vb">' + id + stats + r + "</div>";
  };
  // The phone's version of the band: the same cells in the same order, with Change opening the hit point controls
  Q.band2 = function () {
    return '<div class="mv3" data-vitals><div class="mv3-id">' + P.port() + '<div class="nm"><b>' + esc(D.name) + "</b><span>" + esc(D.sub) + "</span></div>" + rest().replace("sh-btn", "sh-btn rs") + "</div>" +
      '<div class="mv3-row c3"><div class="cell"><span class="l">AC</span><span class="v">' + D.ac + "</span></div>" +
      '<button type="button" class="cell hp" data-hptoggle aria-expanded="false"><span class="l">Hit points <span class="chg">Change</span></span><span class="hpn"><span class="cur" data-hpcur>' + D.hp + '</span><span class="max">/ ' + D.hpMax + '</span><span class="tmp">+<span data-hptemp>' + D.temp + "</span></span></span>" + P.life() + "</button>" +
      '<button type="button" class="cell roll" data-roll="Initiative|' + D.init + '"><span class="l">Init</span><span class="v">' + D.init + "</span></button>" +
      '<div class="cell"><span class="l">Speed</span><span class="v">' + D.speed + "</span></div></div>" +
      '<div class="mv3-ed" data-hpedit hidden>' + amt() + change() + "</div></div>";
  };
  Q.trio = function () {
    return '<div class="sts3 c3">' + Q.cell("Proficiency", Q.num(D.prof)) + Q.cell("Heroic Inspiration", Q.insp()) + Q.cell("Hit dice", Q.num("5/7", "d6")) + "</div>";
  };

  /* ---------- Abilities, three ways. The number is the button: no box around it. ---------- */
  function check(a) { return 'data-roll="' + a[0] + " check|" + a[3] + '"'; }
  function save(a) { return 'data-roll="' + a[0] + " save|" + a[4] + '"'; }
  // Strip: across the top, each with its save underneath
  Q.abStrip = function (grid) {
    return '<div class="abx c3' + (grid ? " grid" : "") + '">' + D.abilities.map(function (a) {
      return '<div class="abx-c"><button type="button" class="abx-m" ' + check(a) + '><span class="l">' + a[0] + '</span><span class="m">' + a[3] + '</span><span class="sc">' + a[2] + "</span></button>" +
        '<button type="button" class="abx-s" ' + save(a) + ">" + pf(a[5]) + '<span>Save</span><span class="b">' + a[4] + "</span></button></div>";
    }).join("") + "</div>";
  };
  // Ledger: down a column, score beside the name, modifier then save
  Q.abLedger = function () {
    return '<div class="abl"><div class="abl-h"><span>Ability</span><span>Check</span><span>Save</span></div>' + D.abilities.map(function (a) {
      return '<div class="abl-r"><button type="button" class="abl-m" ' + check(a) + '><span class="n"><b>' + a[0] + '</b><span class="sc">' + a[2] + '</span></span><span class="m">' + a[3] + "</span></button>" +
        '<button type="button" class="abl-s" ' + save(a) + ">" + pf(a[5]) + '<span class="b">' + a[4] + "</span></button></div>";
    }).join("") + "</div>";
  };
  // Grouped: each ability is a block holding its save and its skills, as on the 2024 sheet
  Q.abGroup = function (i) {
    var a = D.abilities[i];
    var sk = D.skills.filter(function (s) { return s[1] === a[1]; });
    return '<section class="abg c3"><button type="button" class="abg-h" ' + check(a) + '><span class="n">' + a[0] + '</span><span class="sc">' + a[2] + '</span><span class="m">' + a[3] + "</span></button>" +
      '<div class="abg-b"><button type="button" class="sk3 g sv" ' + save(a) + ">" + pf(a[5]) + '<span class="n">Saving throw</span><span class="b">' + a[4] + "</span></button>" +
      sk.map(function (s) {
        return '<button type="button" class="sk3 g' + (s[3] ? " is-prof" : "") + '" data-roll="' + s[0] + " check|" + s[2] + '">' + pf(s[3]) + '<span class="n">' + s[0] + '</span><span class="b">' + s[2] + "</span></button>";
      }).join("") + "</div></section>";
  };
  Q.passives = function () {
    return '<div class="sts3 pv">' + Q.cell("Passive Perception", Q.num(14)) + Q.cell("Passive Investigation", Q.num(17)) + Q.cell("Passive Insight", Q.num(14)) + '</div><p class="dv">Darkvision 60 ft</p>';
  };

  /* Proficiencies and defenses move to the Features tab: reference, rarely needed mid-fight */
  Q.features2 = function () {
    return Q.gh("Proficiencies and defenses") + P.facts([["Armor", "None"], ["Weapons", "Simple weapons"], ["Tools", "Calligrapher's Supplies"], ["Languages", "Common, Elvish, Draconic, Sylvan"], ["Defenses", "Advantage on saves against Charmed"]]) + Q.features();
  };
})();
