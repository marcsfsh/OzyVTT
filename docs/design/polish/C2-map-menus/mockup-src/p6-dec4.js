  /* ---------- C4 and C6's decisions ---------- */
  var CHOSEN4 = { p1: "map", p2: "rollrow", p3: "lamps", p4: "inplace", p5: "inplace" };
  DEC.p1 = {
    n: 1, name: "Where a player's prompt sits", page: "prompt",
    what: "Anything a player must answer before the fight goes on (C4.1, C4.3): a call for a roll, a saving throw against a trap or a spell, a reaction offer, a death save. Drawn with a DC 13 Dexterity saving throw against the tripwire's darts, a call for a roll waiting behind it, while the Goblin Boss acts.",
    today: "A box above the panel's tabs, capped at half the panel, with how many more wait under it (2 more after this). On the Sheet the open calls stack at the top of the page and push it down, and a reaction offer also arrives as a NOTE toast.",
    opts: {
      top: ["Over the panel's tabs", "Today's place drawn to the theme: C3's card above the panel's tabs, the next ones counted under it."],
      turn: ["Heading the Turn tab", "The card heads the Turn tab, as the GM's waiting list heads the Encounter tab (C3), and the turn reads under it."],
      band: ["A band over the table", "A's band (rule 10) across the top of the table with the prompt and its roll; the map and the panel keep their places under it."],
      map: ["Over the map", "The card on glass at the foot of the map, where eyes are while a creature acts; the panel stays as it was."],
      foot: ["Over End turn", "The card in the panel's foot, above End turn and who is next, where the thumb rests on a phone."]
    }
  };
  DEC.p2 = {
    n: 2, name: "A reaction", page: "reaction",
    what: "An offer to spend the reaction (C4.2): the Goblin Boss's Scimitar rolled 15 against Lyra's AC 11, and Shield's +5 AC would make it miss. The attack waits on the answer, Take the hit or Cast Shield; the GM can dismiss the offer.",
    today: "The prompt's box: Shield, then \"Goblin Boss's attack would hit Lyra Emberwise. +5 AC may turn it into a miss.\", then Take the hit and Cast Shield, Cast Shield the primary. A NOTE toast also says Lyra Emberwise may use Shield.",
    opts: {
      buttons: ["Card and buttons", "C3's card: what happened in a line, their roll, Lyra's AC and her AC with Shield in VT323, then Take the hit and Cast Shield."],
      rollrow: ["The answer is the row", "Cast Shield as a roll row (C3 2.5) saying what it does and what it spends; Take the hit as a Base line control under it."],
      compare: ["Two choices side by side", "Take the hit and Cast Shield as two equal choices, each saying what follows; pressing one answers."],
      numbers: ["Numbers first", "Their roll, your AC and your AC with Shield large in VT323, the way the TV shows a roll (H 2.1), then the line and the buttons."],
      costtab: ["On the Reaction tab", "The Turn tab opens on Reaction (C 2.3), Shield lit at the top of its list and the offer over it, so the answer sits with the reaction it spends."]
    }
  };
  DEC.p3 = {
    n: 3, name: "Dying", page: "dying",
    what: "Lyra at 0 hit points on her turn (C4.4): she rolls a death save before anything else and sees her successes and failures. End turn waits for the save, and the other tabs stay open for reading.",
    today: "The prompt's box in red: YOU ARE DYING, what Unconscious means, the success and failure pips, then the roll's result with Confirm. The Turn tab says she can't act, and End turn is greyed with Roll your death save first.",
    opts: {
      today: ["Today's card", "Today's box drawn as C3's card in red: what Unconscious means, the pips, and Roll death save."],
      rollrow: ["The roll is the row", "The same card with the death save as its roll row (rule 5): d20, 10 or higher a success, press to roll."],
      lamps: ["Lamps", "Successes and failures as the cost tabs' lamps (C 2.3), three each, lit cyan and red, over the roll row."],
      turn: ["The turn itself", "No card: the Turn tab becomes the dying turn, You are dying in place of Your turn, the lamps, the roll row, and the cost tabs at NOT NOW."],
      band: ["A red band", "A's band in red across the table with the save's roll; the Turn tab shows the lamps and what Unconscious means."]
    }
  };
  DEC.p4 = {
    n: 4, name: "Choosing for a spell", page: "choose",
    what: "What a cast asks before it goes (C6): Mirena's player casts Cure Wounds and chooses who it heals and which slot it spends. The same holds for every spell or feature that asks for a target, an option or a level.",
    today: "The cast opens in the sheet's right column with the slot levels as boxes (Level 1, 4 of 4 left), a line on what happens next and Cast at level 1; who it heals is then a centred dialog of names.",
    opts: {
      dialog: ["A dialog", "A's dialog: who as Base line chips, the slot as a segmented row, then Cancel and Cast."],
      targets: ["The Turn tab chooses", "The Turn tab becomes the choice: the party's rows (or their tokens on the map), the slots under them, and Cast in the foot where End turn was."],
      sheet: ["A sheet over the panel", "C5's sheet over the panel: who as rows with their hit points, the slot, and Cast in its foot."],
      inplace: ["Under its row", "The choice opens under Cure Wounds' row, as a monster's tools open under its row (C3 2.2), with Cast at level 1."],
      steps: ["One step at a time", "A's dialog asking one thing a step, the answered ones folded above it: who, then the slot."]
    }
  };
  DEC.p5 = {
    n: 5, name: "The spell card", page: "spell",
    what: "Reading a spell (C6): its level, school and classes, casting time, range, components and duration, the text and At Higher Levels, and the source line. It opens from a spell's name in the turn or the sheet.",
    today: "A centred dialog: the name, the level and classes in italics, four boxed cells, the text and At Higher Levels, then SRD 5.2.1, CC BY 4.0.",
    opts: {
      dialog: ["The dialog", "Today's card in A's dialog drawn to the theme."],
      record: ["The Compendium's record", "G's record in A's dialog: the name with its source tag, the facts in one line with VT323 numbers, then the text."],
      sheet: ["A sheet over the panel", "C5's sheet over the panel with the card in it; the turn stays under it."],
      inplace: ["Under its row", "The card opens under the spell's row in the turn and closes when the row is pressed again."],
      panel: ["In the panel", "The Turn tab shows the record, with Back to the turn above it and Cast Cure Wounds under it."]
    }
  };

  function renderIdea() {
    $("#idea").innerHTML = ["p1", "p2", "p3", "p4", "p5"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + (S[k] === CHOSEN4[k] ? " · chosen" : " · turned down") + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', P = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML = '<div class="today-strip" ' + W + ">" + E + "The prompts on the laptop</p>" + fig("dying", "Lyra's death save above the panel's tabs, with Confirm") + fig("react", "On the Sheet: two open calls at the top and the Shield toast") + "</div>" +
      '<div class="today-strip" ' + P + ">" + E + "The prompts on a phone</p>" + fig("phone", "A call for a roll over the Turn view, 2 more after it") + fig("phsheet", "On the Sheet: the open calls push the page down") + "</div>" +
      '<div class="today-strip" ' + W + ">" + E + "Casting and reading a spell</p>" + fig("heal", "Cure Wounds' slots in the sheet's right column") + fig("card", "The spell card") + "</div>";
    var CI = [
      ["The table's frame", "C 2.1 to 2.4", "Two docks, the ladder, the panel's one row of tabs with End turn in its foot, cost tabs with lamps, and the phone's Switch."],
      ["A prompt is a card", "C3, first round", "The left rule amber while it waits and red for danger, the eyebrow, the title, a line and its actions."],
      ["The roll is the button", "T rule 5, C3 2.5", "A roll to be made is a row the player presses, with what it rolls at the right."],
      ["The band follows you", "A rule 10", "What must be answered away from the table follows the player as A's band."],
      ["Dialogs and sheets", "A, C5", "A's dialog on the laptop and from the foot on a phone; C5's sheet over the panel."],
      ["Under its row", "C3 2.2", "What belongs to one row opens under that row and closes with it."],
      ["The record", "G", "A rule or a spell reads as the Compendium's record: the name, a source tag, facts in one line, the text."],
      ["Controls", "T 2.5", "Base line controls and segmented rows; chosen on cyan; fields keep their box."],
      ["Numbers in VT323", "G 3.6", "Rolls, AC, hit points and DCs, everywhere."],
      ["Colour keeps one meaning", "T rule 9", "Red damage and danger, gold hit points, cyan chosen and ready, amber waiting."]
    ];
    $("#carried").innerHTML = CI.map(function (c) { return "<div><h3>" + c[0] + '<span class="from">' + c[1] + "</span></h3><p>" + c[2] + "</p></div>"; }).join("");
    var R = [
      ["A prompt stays in view", "Whatever page the player is on, a prompt they must answer is in view: over the map at the table, and as A's band everywhere else. It leaves when it is answered or the GM dismisses it.", "Today the Sheet stacks open calls at the top of the page, and a reaction shows there only as a toast."],
      ["The card names its kind", "A prompt's eyebrow says what it is (Saving throw, Reaction, Death save, Damage) and nothing more; no words that hurry the player. The slot and its announcement name the prompt the same way.", "Today the eyebrows add \"answer now\" (and \"roll now\"), and the slot is the region Answer now."],
      ["One at a time", "One prompt shows and the rest are counted under it (1 more after this); they come up in the order the server holds them.", "Today the Sheet shows every open call at once."],
      ["Nothing new in what the controls do", "Every option keeps today's commands, words and timing: the server rolls, holds the attack until the answer, and decides who is asked and what they see.", ""],
      ["End turn waits for the prompt", "While a prompt holds the player's own turn, End turn steps down and says why (Roll your death save first), as today.", ""],
      ["What it spends, said", "A choice says what it spends before it is pressed: Cast Shield names the slot, Cast names the level, a reaction names the reaction.", ""],
      ["One spell card", "A spell reads the same wherever it opens: the turn, the sheet and the Compendium.", ""],
      ["Phones", "On a phone the prompt sits in the Switch's Turn view or as the band, and dialogs open from the foot.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
