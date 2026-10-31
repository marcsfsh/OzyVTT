  /* ---------- C2's decisions ---------- */
  var CHOSEN5 = { z1: "menu", z2: "menu", z3: "menu", z4: "menu", z5: "menu" };
  DEC.z1 = {
    n: 1, name: "A token's menu", page: "token",
    what: "What pressing a token with the other button, or a long press, opens (C2.5): how it moves and its height, the token's size, health display, image, Hide from players and Return to tray, then Open stat block and Use reaction. A player gets it on their own token: how they move, conditions, Open character sheet and Use reaction. C3 put hit points, conditions and position under the creature's row; the empty map's Place here (C2.7) follows whatever this decides.",
    today: "A tall popover beside the token that scrolls: how it moves as boxed buttons, Height, In the air and Set height, an amount with Damage and Heal, Damage type, Size, Health, Conditions folded, Open stat block, Set token image, Hide from players, Use reaction and Return to tray.",
    opts: {
      menu: ["A's menu at the token", "Today's place drawn as A's menu: how it moves and its height first, then the token and the creature as rows; hit points point to its row."],
      row: ["Its row in the dock", "No menu: the creature's row opens under it, as choosing it does (C3 2.2), with how it moves, height and the token's controls first and its hit points folded above."],
      glass: ["A card by the token", "A's glass card beside the token: how it moves, height and the few controls a fight needs, with More for the rest."],
      sheet: ["A sheet over the panel", "C5's sheet over the panel with the token's Cradles; the map stays in view."],
      tab: ["The Token tab", "The panel's Token tab (C3.10) opens with all of it; a player's Turn tab shows their token's part."]
    }
  };
  DEC.z2 = {
    n: 2, name: "How it moves", page: "moving",
    what: "Choosing how a creature moves before it is dragged: walk, climb, swim, jump or teleport (and Forced for the GM), what each costs and how far it reaches, and its height when it flies. Drawn on Borin's turn as his player climbs the bank: 10 of 15 ft.",
    today: "Boxed buttons at the top of the token's menu (Walk 30, Swim, Climb, Jump, Teleport); the path shows its feet while dragging; the turn's Move box shows only the feet left.",
    opts: {
      menu: ["In the token's menu", "Today's place: the modes as a segmented row in the token's menu, each with its feet."],
      movetab: ["In the Move tab", "The Move cost tab (C 2.3) opens to the modes as rows, each with what it costs and the feet left, and height under them."],
      drag: ["While dragging", "Picking the token up shows a glass strip at the map's foot: the modes as Base line controls and the feet so far."],
      chip: ["A chip on the token", "The token carries its mode as a small Base line chip (CLIMB); pressing it opens the modes as A's menu."],
      row: ["In its row", "The acting creature's row in the order shows its speeds as chips (Walk 30, Climb 15, Swim 15); pressing one sets the mode."]
    }
  };
  DEC.z3 = {
    n: 3, name: "A door", page: "door",
    what: "Pressing a door (C2.6): its state (closed, locked, the lock's DC, its AC and hit points), the ways through it (open it, pick the lock, force it, pry it), the ways to block it (an Iron Spike, Carpenter's Tools, an Immovable Rod), who does it, and the GM's Edit lock and strength.",
    today: "A menu titled Door with AC 15 · 18 HP, seven boxed rows, a line on who does it, a line on attacking the door, and Edit lock and strength.",
    opts: {
      menu: ["A's menu", "Today's list drawn as A's menu, the door's state in its title line."],
      rollrows: ["Roll rows", "Each way that takes a check is a roll row (rule 5) naming the check and the DC; Open the door and the blocks are Base line controls."],
      groups: ["By what it does", "The ways under four small heads: Open, Unlock, Break, Block."],
      turn: ["In the turn", "No menu: pressing a door puts its ways at the top of the acting creature's Action tab (C 2.3), as rows with their DC, where the action is spent."],
      glass: ["A card by the door", "A's glass card by the door: the lock's DC, AC and hit points in VT323, then the ways as Base line controls."]
    }
  };
  DEC.z4 = {
    n: 4, name: "A tool's options", page: "tools",
    what: "What a tool asks for once it is on (C2.2): the GM's Light (place or remove, which light, painting an area, the ambient light, sunlight and vision) and a player's Draw (the shape, who sees new drawings, the colour). Fog, Terrain, Traps, Weather, Walls and View take the same place.",
    today: "A column beside the tool rail, inside the map's edge, with the tool's name and a close button and its controls stacked; on a phone, a block under the tools row that pushes the map down.",
    opts: {
      beside: ["Beside the tools", "Today's place: a 250 px column between the dock and the map; on a phone, under the tools row."],
      dock: ["In the dock", "The options take the order's place in the dock while the tool is on, the dock widening to 330 px as a row's tools do (C3 2.2); on a phone, the order strip's place."],
      strip: ["A strip over the map", "One glass strip across the map's top, the tool's controls in a row and More for the rest."],
      sheet: ["A sheet over the panel", "C5's sheet over the panel, the whole map left clear; on a phone, from the foot."],
      menu: ["A menu from the tool", "A's menu opening from the tool's own button."]
    }
  };
  DEC.z5 = {
    n: 5, name: "A drawing", page: "drawing",
    what: "A drawing chosen on the map (C2.3): its size and shape, its colour, who sees it, whether others can move it, and Remove. The GM's 20 ft circle on the laptop; Borin's player's 30 ft line on the phone.",
    today: "The editor takes the tool options' column: the size and shape with its position, Color as a colour picker, Who sees this, Others can move this, and Remove.",
    opts: {
      options: ["Where the options are", "Today's place: the editor takes the tool options' column, wherever question 4 puts it."],
      glass: ["A card by the drawing", "A's glass card beside the drawing."],
      tab: ["A Drawing tab", "Like the Token tab (C rule 8): a Drawing tab shows in the panel while a drawing is chosen; on a phone, in the Turn view."],
      strip: ["A strip over the map", "One glass strip across the map's top with the drawing's controls."],
      menu: ["A's menu at the drawing", "A's menu opening at the drawing."]
    }
  };

  function renderIdea() {
    $("#idea").innerHTML = ["z1", "z2", "z3", "z4", "z5"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + (S[k] === CHOSEN5[k] ? " · chosen" : " · turned down") + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', P = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML = '<div class="today-strip" ' + W + ">" + E + "Menus on the laptop</p>" + fig("token", "The Goblin Boss's menu") + fig("door", "A door's menu") + fig("spot", "Place here, on the empty map") + "</div>" +
      '<div class="today-strip" ' + W + ">" + E + "A tool's options on the laptop</p>" + fig("light", "Light") + fig("fog", "Fog") + "</div>" +
      '<div class="today-strip" ' + P + ">" + E + "On a phone</p>" + fig("plmenu", "Borin's own token's menu") + fig("pldraw", "Draw's options under the tools row") + "</div>";
    var CI = [
      ["The table's frame", "C 2.1 to 2.4", "Two docks with the tools in the left dock, the panel's one row of tabs, cost tabs, and the phone's Switch with its tools row."],
      ["The map's own things", "C 2.1", "Nothing sits over the map but its own things: the tokens, the Tray chip, its controls, and what belongs to a thing on it."],
      ["A's menu and glass", "A", "The menu with its small capital heads and rows; the glass card over the map."],
      ["Under its row", "C3 2.2", "A creature's tools open under its row, the dock widening from 232 px to 330 px."],
      ["The Token tab", "C3.10, C rule 8", "Shows only while a token is chosen; keeps the token's size, image, Show or Hide, and Return to tray."],
      ["A sheet over the panel", "C5 2.4", "Opens over the panel under its tabs, the map left in view."],
      ["Cost tabs", "C 2.3", "Action, Bonus Action, Reaction and Move, each with its lamp or its feet."],
      ["The roll is the button", "T rule 5, C3 2.5", "A roll to be made is a row the player presses."],
      ["Controls", "T 2.5", "Base line controls and segmented rows; fields keep their box; chosen on cyan."],
      ["Numbers in VT323", "G 3.6", "Feet, DCs, AC and hit points, everywhere."],
      ["Colour keeps one meaning", "T rule 9", "Cyan chosen; a door and the GM's ink keep today's magenta."]
    ];
    $("#carried").innerHTML = CI.map(function (c) { return "<div><h3>" + c[0] + '<span class="from">' + c[1] + "</span></h3><p>" + c[2] + "</p></div>"; }).join("");
    var R = [
      ["One way to open what is on the map", "A token, a door, the empty map and a drawing open the same way (the other button, or a long press on a phone) as A's menu at the thing; a tool's options are A's menu from the tool.", "Today each is its own popover, and a tool's options are a column beside the rail."],
      ["One menu at a time", "Opening one menu closes any other; a tool stays on after its menu closes, and pressing the tool again opens it.", ""],
      ["Nothing new in what the controls do", "Every command, word and permission stays: a player reaches only their own token and their own drawings, and the server decides every move, door and light.", ""],
      ["Hit points live in the row", "C3 put a creature's hit points, conditions and position under its row; the token's menu points there instead of repeating them.", "Today the token's menu repeats Damage, Heal and Conditions."],
      ["Closing", "A menu, card, strip or sheet closes with Escape, its close control, or a press elsewhere on the map; a tool's options stay while the tool is on.", ""],
      ["The map keeps its room", "What opens over the map keeps clear of the chosen thing and the map's controls, and the map pans under it.", ""],
      ["Phones", "Every option has a phone form; a long press opens what the other button opens; every control keeps a 44 px hit area.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
