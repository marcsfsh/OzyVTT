
  /* ---------- Round 2's decisions ---------- */
  var CHOSEN2 = { r1: "form", r2: "row", r3: "menu", r4: "panes", r5: "rollrow" };
  DEC.r1 = {
    n: 1, name: "Starting an encounter", page: "start",
    what: "The Encounter tab before a fight (C3.3): who is in it, who plays each character, initiative, who is surprised, how hard it is, and Start the encounter in the panel's foot. The turn order in the left dock already lists the staged creatures with -- for initiative (C 2.2).",
    today: "A long form: In this encounter as ticks, then the staging box listing the same creatures again (also headed In this encounter), Who plays per character, two initiative switches, Surprised chips, the difficulty in a line, and Start the encounter. On a phone, a card of four summary rows that open sheets.",
    opts: {
      form: ["One form", "Today's sections drawn as Cradles, each once: In this encounter with its ticks and Add monsters, Who plays, Initiative, Surprised; the difficulty as an open group. The staging box's repeat goes."],
      ready: ["Ready lines", "Prep's ready lines (E 3.2), in its words: In this encounter, Placed, Who plays, Initiative, Surprised and Difficulty, each a line with its answer that opens in place. The phone's summary card, on every size."],
      ladder: ["In the order", "Who is in it, who plays and who is surprised move onto each row of the turn order in the left dock; the panel keeps initiative, the difficulty and what is not ready yet."],
      who: ["Who is in it", "Prep's Who is in it tab (E 2.2): one row per creature with its choices under its name (who plays, surprised) and its tick; initiative and the difficulty under the list."]
    }
  };
  DEC.r2 = {
    n: 2, name: "A creature's tools", page: "tools",
    what: "What the GM does to one creature (C3.6, C3.10): hit points with damage type, conditions and effects, cover, attitude, spend its reaction, hold its breath, open its sheet, take it out. Drawn with the Goblin Boss chosen.",
    today: "Two places with overlapping tools: a row in the panel's Turn order and tools opens a popover (Amount with Damage, KO, Heal, Temp, Set, Max; Damage type; conditions; attitude; cover; Spend reaction, Hold breath, Open sheet, Take out of the encounter), and a chosen token opens the Token tab with its own controls.",
    opts: {
      token: ["In the Token tab", "One place: choosing the creature's row in the order or its token opens the Token tab (C rule 8), which holds every tool in Cradles under the creature's head. The popover goes."],
      row: ["Under its row", "The chosen row opens in place in the left dock, which widens while it is open, with every tool under it."],
      pop: ["Beside the order", "A card opens beside the chosen row, over the map's edge, with every tool; Escape or a press outside closes it."],
      split: ["Hit points in place", "Hit points open under the chosen row in the dock, for the fast part of a fight; everything else is the Token tab's."]
    }
  };
  DEC.r3 = {
    n: 3, name: "The encounter's options", page: "options",
    what: "The encounter's own settings and actions (C3.7): the rules assistant, players' hits, players' initiative, health display, underwater, adding characters and monsters, awarding experience, and ending the encounter. The strip they hung from has gone (C 2.1).",
    today: "An Encounter menu at the strip's end: selects for the rules assistant, players' hits, players' initiative, health display and health is; Underwater; Add to the encounter with the roster, Recent and + Add monsters; Experience Points after a monster falls; End the encounter.",
    opts: {
      menu: ["A menu on the tabs", "A More button at the end of the panel's tabs opens today's menu, its rules written as Settings writes them (I 2.3), with Add monsters and End the encounter."],
      chip: ["On the live chip", "The top bar's live chip (A), which already picks the live encounter, opens the same menu under the encounters list."],
      sheet: ["A sheet over the panel", "More on the panel's tabs opens a sheet over the panel with Settings' Encounters rows for this encounter, grouped by moment as Settings groups them, and Add monsters and End the encounter at its foot."],
      foot: ["At the end of Encounter", "The same rows as an open group at the end of the Encounter tab, under the turn, with Add monsters and End the encounter."]
    }
  };
  DEC.r4 = {
    n: 4, name: "Adding monsters", page: "monsters",
    what: "Finding a monster and adding it to the encounter (C3.8), mid-fight or before one, with its stat block (G 3.5: one stat block everywhere).",
    today: "A dialog of the bestiary: search, CR, type, size and sort as menus, Roll hit points, the visibility from the tray, and rows of name, CR (XP), size and type, AC and HP with Add; a row opens its stat block in place.",
    opts: {
      dialog: ["The dialog", "Today's dialog drawn to the theme: the search field, the filters as Base line controls, the rows as the Compendium's result rows with Add."],
      panes: ["The Compendium's panes", "A wide dialog laid out as the Compendium's browse (G 2.3): filters with their counts, the results, and the chosen monster's stat block with Add to Old road as its Cup."],
      panel: ["In the panel", "The panel turns into the list (search, filter chips, result rows with Add) with the chosen monster's stat block under it, and Back to the turn."],
      compendium: ["The Compendium itself", "Add monsters opens the Compendium's Browse on monsters with a line saying it is adding to Old road; every monster's record has Add to Old road as its Cup (G's Add to an encounter), and Back to the table returns."]
    }
  };
  DEC.r5 = {
    n: 5, name: "The prompts' controls", page: "prompts",
    what: "The controls inside a waiting card (C3.12): a monster's saving throw the GM rolls, a death save and stabilizing, an opportunity attack. The cards themselves are round 1's.",
    today: "Each card carries its controls as boxed buttons: the roll's result as a line, then Adv, Disadv, Confirm (lit), Choose to fail and Reroll; the damage on a failure as a field; a dying creature's pips with Roll the save, and Who gives the aid with First aid, Healer's Kit, Spare the Dying and Mark stable.",
    opts: {
      buttons: ["Today's controls", "The same controls, drawn as Base line controls with the main one lit as round 1's cards do, and the result in VT323."],
      rollrow: ["The roll is the button", "Theme rule 5: the roll is a row, its number at the right in VT323; pressing the row rolls or confirms. Adv, Disadv, Reroll and the rest follow as Base line controls."],
      fold: ["One button, the rest folded", "The result and the one main button; Adv, Disadv, Reroll, Choose to fail and the damage field fold under More, and stabilizing under Stabilize."]
    }
  };

  function renderIdea() {
    $("#idea").innerHTML = ["r1", "r2", "r3", "r4", "r5"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + (S[k] === CHOSEN2[k] ? " · chosen" : " · turned down") + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML = '<div class="today-strip" ' + W + ">" + E + "Before and during the fight</p>" + fig("start", "Start an encounter") + fig("start-phone", "Start an encounter on a phone") + fig("rowtools", "A row's tools") + fig("menu", "The Encounter menu") + fig("monsters", "Add monsters") + fig("waiting", "A save, a hit and a death save waiting") + "</div>";
    // What every option is built from: the decisions already settled.
    var CI = [
      ["The table's frame", "C 2.1 to 2.4", "Two docks, the Ladder in the left dock, the panel's one row of tabs with the Cup in its foot, and the phone's Switch."],
      ["What waits on the GM", "C3, first round", "The list over the turn (or its own tab), cards with a lit main button, the bell, and tabs with unread counts."],
      ["Boxes and open groups", "T 2.3, 2.4", "A group you act in is a Cradle; a group you only read is open. Never a box in a box."],
      ["Controls", "T 2.5", "Secondary controls on a Base line; chosen on cyan; danger in red; fields keep their box; on and off is a switch."],
      ["One primary", "T rule 2, C rule 1", "Start the encounter or End turn, as the Cup, in the panel's foot. Nothing else is a Cup in the panel."],
      ["A number you roll is the button", "T rule 5", "The row or cell is the button; no box round the number."],
      ["Ready in one set of words", "E 3.2", "Ready lines with a cyan lamp, or what is missing in amber with Go to it, in today's words."],
      ["One stat block", "G 3.5", "The SRD's order and words, the name in capitals, the abilities as cells, section heads over a magenta line."],
      ["The encounter's rules are Settings' rows", "I 2.3", "The same names, lines and choices, grouped by moment."],
      ["Colour keeps one meaning", "T rule 9", "Amber waiting, cyan chosen, gold hit points, red damage and danger, violet GM only."]
    ];
    $("#carried").innerHTML = CI.map(function (c) { return "<div><h3>" + c[0] + '<span class="from">' + c[1] + "</span></h3><p>" + c[2] + "</p></div>"; }).join("");
    var R = [
      ["A row opens in the order", "Choosing a creature's row in the left dock, or its token on the map, opens its tools under its row; the dock widens to 330 px while a row is open and closes back to 232 px. One row is open at a time, as today.", ""],
      ["The Token tab keeps the token's own", "With the creature's tools under its row, the Token tab keeps what belongs to the token: its size, its image, Show or Hide from players, and Return to the tray.", "Today the Token tab and the row's popover both offer damage, healing and conditions."],
      ["Nothing new in the controls", "Every option keeps today's settings, words and commands; it changes where they are and how they are drawn.", ""],
      ["The Party tab", "Its rows are the party as D draws a party member (D 2.4); Rest the party stays a Base line control that opens today's Rest dialog. Its own design comes with D's.", ""],
      ["The Notes tab", "Tonight and the Codex read as the Codex reads (F); their own design comes with F's later rounds.", ""],
      ["One In this encounter", "The start of a fight names who is in it once; the staging box's repeat and its second heading go.", "Today two regions share the name In this encounter."],
      ["Confirms are A's dialog", "Take out of the encounter, End the encounter and Award the encounter's XP ask first in A's dialog, with today's words.", ""],
      ["Phones", "Every option on a phone keeps the Switch, the order's cards and the pinned foot; a creature's tools and Add monsters open as sheets over the Map and Encounter views.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
