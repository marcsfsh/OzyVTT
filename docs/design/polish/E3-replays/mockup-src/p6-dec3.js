  /* ---------- The replays round's decisions ---------- */
  var DEC = {
    r1: {
      n: 1, name: "The replays list", page: "list",
      what: "Every fight that ends is kept (E3.3): its name, when it was fought, its turns and length, whether players see it, Watch, and the GM's More. Drawn with five replays, two named by the GM and three shared.",
      today: "Rows under Replays: the name, a line of turns and length, an eye for whether players see it, Watch and More.",
      opts: {
        today: ["Today's rows", "Today's rows drawn to the theme."],
        shelf: ["A card per replay", "E's shelf cards: the map's picture, the name, turns and length in VT323, who sees it, Watch and More."],
        side: ["Who sees it at the side", "E2's folders at the side: All, Players see it, Only you, and by month; the replays as rows at the right."],
        table: ["A table", "One table: the replay, when, turns, rounds, length and who sees it, each row with Watch."],
        beside: ["A replay beside the list", "Like a map beside its folder's list (E2 2.2): the rows at the left, the chosen replay at the right with its map, who fought, Players see it and Watch."],
        mix: ["A table, the replay beside it", "The owner's mix of A table and A replay beside the list: the table at the left (the replay, when, turns, length and whether players see it), the chosen replay at the right with its map, who fought, Players see it and Watch. On a phone, the table; a row opens the replay."]
      }
    },
    r2: {
      n: 2, name: "Watching a replay", page: "viewer",
      what: "Where the map, the turn order and the turn's log sit while a replay plays (E3.4). Drawn on turn 8 of 15, Borin's turn in round 2, as the GM sees it: exact hit points and the hidden archer with its GM tag.",
      today: "The transport above, the turn's name, then the map at the left and Turn order with During this turn at the right.",
      opts: {
        today: ["Today's map and side", "Today's viewer drawn to the theme."],
        docks: ["As the table", "C's two docks: the order at the left, the map, the log at the right, the transport under the map, so a replay reads like the fight did."],
        glass: ["The map on glass", "The map fills the page; the order, the turn's log and the transport sit on glass over it."],
        log: ["The whole fight beside", "Every turn of the fight as a list at the right, the current one lit; press a turn to go to it. The order sits on glass over the map."],
        stack: ["Map above, the rest under", "The map wide at the top, the order and the turn's log side by side under it."]
      }
    },
    r3: {
      n: 3, name: "Moving through the turns", page: "moving",
      what: "Going back and forward through a fight: one turn at a time, playing it, or jumping. Drawn as a player watching the same turn: monsters as bands, no hidden archer, no GM lines.",
      today: "Previous, Play, Next and a slider with 1 / 16 above the map.",
      opts: {
        today: ["Today's buttons and slider", "Today's transport drawn to the theme."],
        bar: ["The Playing bar", "E3's Playing bar (E3 2.2): WATCHING, the turn's name, the scrubber with the turn in VT323, one size of icon buttons and the speed."],
        ladder: ["The order is the ladder", "The order itself moves you: press a creature to go to its turn; Round as a Base line control and Previous turn and Next turn."],
        line: ["A line of rounds", "The scrubber as a line marked by round, each turn a tick, with marks for big hits, heals and a creature going down."],
        chips: ["Rounds and turns as chips", "Round 1, 2 and 3 as a Base line control, then the round's turns as chips."]
      }
    },
    r4: {
      n: 4, name: "The GM's actions on a replay", page: "actions",
      what: "Launch from here, Players see it, Rename (E3.5), Download JSON and Delete replay. Launch keeps today's confirm; Delete keeps its warning.",
      today: "Launch from here and Download JSON in the viewer; Rename, Download JSON and Delete replay in the list's More, the eye in the list, and Rename as a small dialog.",
      opts: {
        today: ["Today's buttons", "Today's split drawn to the theme, shown with Launch's confirm."],
        menu: ["A's menu at More", "Players see it as a Base line control, Launch from turn 8 as the Cup, and More with Rename, Download JSON and Delete replay."],
        title: ["The title row", "T 2.2's title row: the name edits in place, Players see it as a switch, Launch from turn 8 as the Cup, More for the rest."],
        side: ["In the side column", "Details opens a side column: the name, Players see it, when and how long, Download JSON, Delete replay and Launch from turn 8."],
        foot: ["Launch at the transport", "Launch from turn 8 sits at the end of the transport, by the turn it launches; the rest in More."]
      }
    },
    r5: {
      n: 5, name: "A player's replays", page: "player",
      what: "Where a player finds the fights the GM shared (C4.6): today, a shelf under the sheet when no encounter runs. A player sees the GM's name for a replay, or Encounter and the day.",
      today: "A Replays heading under the sheet with each shared replay as a row.",
      opts: {
        today: ["Today's shelf", "Today's rows under the sheet drawn to the theme."],
        cards: ["Cards under the sheet", "E's shelf cards under the sheet: the map's picture, the name and Watch."],
        log: ["In the Log tab", "The Log tab's head holds Replays · 3, each with Watch, above the table's log."],
        more: ["In the frame's menu", "Replays sits in the player's menu on a laptop and in More on a phone, opening the list."],
        last: ["The last fight", "One row under the sheet: the last fight shared, Watch, and All replays · 3."]
      }
    }
  };

  function renderIdea() {
    $("#idea").innerHTML = ["r1", "r2", "r3", "r4", "r5"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', P = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML = '<div class="today-strip" ' + W + ">" + E + "On the laptop</p>" + fig("t-list", "Replays, the GM's list") + fig("t-more", "A replay's More") + fig("t-rename", "Rename the replay") + fig("t-viewer", "Watching, turn 4") + fig("t-launch", "Launch from this moment?") + fig("t-pshelf", "A player's shelf under the sheet") + fig("t-pviewer", "A player watching") + "</div>" +
      '<div class="today-strip" ' + P + ">" + E + "On a phone</p>" + fig("t-list-p", "The GM's list") + fig("t-viewer-p", "The GM watching") + fig("t-pshelf-p", "A player's shelf") + fig("t-pviewer-p", "A player watching") + "</div>";
    var CI = [
      ["Prep's frame", "E rule 1", "Prep's Titled bar with Encounters, Party, Maps, Tokens, Sound and Replays."],
      ["Shelf cards", "E 2.1", "A card per thing with its picture, its name and a line in VT323."],
      ["Folders at the side, a thing beside its list", "E2 2.1, 2.2", "A list's groups at the left with counts; the chosen thing at the right."],
      ["Two docks and the order", "C 2.1, 2.2", "The order at the left, the map, the log at the right; the acting creature lit."],
      ["The Playing bar", "E3 2.2", "One row: the eyebrow, what is on, a scrubber with VT323 numbers, one size of icon buttons."],
      ["Glass over the map", "T, C2", "Panels on glass where the map should stay in view."],
      ["The title row", "T 2.2", "A record's name, its state and its one Cup."],
      ["A's menu and dialog", "A, C2", "Menus at the thing; dialogs with the horizon edge; from the foot on a phone."],
      ["Hidden reads one way", "F rule 2", "Violet with a dashed edge and an eye struck through, here for Only you and the GM's hidden creatures."],
      ["Numbers in VT323", "T", "Turns, rounds, minutes, hit points and initiative."]
    ];
    $("#carried").innerHTML = CI.map(function (c) { return "<div><h3>" + c[0] + '<span class="from">' + c[1] + "</span></h3><p>" + c[2] + "</p></div>"; }).join("");
    var R = [
      ["The server decides what a player sees", "A player's replay is the server's player projection: no hidden creature, no GM line, monsters as bands. The GM's viewer marks hidden things with the GM tag.", ""],
      ["A replay's name", "The GM's name, else the encounter and the day for the GM; a player sees the GM's name or Encounter and the day, as today.", ""],
      ["Launch keeps its confirm", "Launch from here asks first and keeps today's refusals (a full encounter list, a turn under review) with their way out.", ""],
      ["Players see it reads one way", "Shared is the eye; Only you is violet with a dashed edge and the eye struck through.", "Today the shared eye is magenta."],
      ["Nothing new in what the controls do", "Listing, watching, launching, renaming, sharing, downloading and deleting keep today's routes and words.", ""],
      ["Phones", "Lists as rows or cards, the viewer stacked with the transport in reach, sheets from the foot; 44 px hit areas.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
