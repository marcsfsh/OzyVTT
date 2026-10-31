  /* ---------- Sound and the screen: the decisions ---------- */
  var CHOSEN8 = { s1: "rail", s2: "onscreen", s3: "chips", s4: "page", s5: "today" };
  var DEC = {
    s1: {
      n: 1, name: "The board", page: "board",
      what: "The sound board (E3.2): what plays on the table screen, the library it plays from, and each encounter's own sound. It is the Sound half of the Table screen page (H 2.3); Prep's Sound opens it too. Drawn with three tracks, three ambient layers (Rain on leaves on) and five effects.",
      today: "Two columns under a Now playing bar: Music, Ambience and Effects at the left; the Library and Encounter sound at the right, each a framed section with its own hint.",
      opts: {
        today: ["Today's board", "Today's two columns drawn to the theme: Music, Ambience and Effects at the left, the Library and Encounter sound at the right."],
        desk: ["A mixing desk", "What is playing as channel strips with faders (Master, the track, each layer), the effects as pads under them, and the playlist, library and encounters as tabs at the right."],
        rail: ["Kinds at the side", "Like the maps' folders (E2): Playlist, Ambience and Effects with their counts, the library and encounter sound at the left; the chosen one at the right."],
        panes: ["Board and library", "G's panes: the board (music and ambience side by side, the effects under them) and the library as its own pane at the right, with a field and kind chips."],
        decks: ["Three decks", "Music, Ambience and Effects as three equal decks side by side; the library and encounter sound open beside them from the head."]
      }
    },
    s2: {
      n: 2, name: "What is playing", page: "now",
      what: "What the room hears now and the controls for it: the track and the layers that are on, pause or play, the next track, stop all, the master level, and whether each table screen can play sound (the GM cannot hear the TV from the laptop).",
      today: "A bar at the top: a badge for each table screen's sound, Music and Ambience with what plays, Pause (the primary), Next track, Stop all and a long Master volume slider.",
      opts: {
        today: ["Today's bar", "Today's bar drawn to the theme, Pause as the Cup."],
        onscreen: ["A bar like On the screen", "H 2.3's bar, made for sound and simplified: Playing, the room's lamp, the track and its layers, a scrubber, Pause, Next track and Stop all as three icon buttons of one size, and Master on the same slider as the scrubber."],
        vcr: ["The VCR counter", "The Ladder's counter (C 2.2): PLAY ▶ TRK 1/3 and the time in VT323, the track, the controls as icons, the room's lamp and Master."],
        card: ["A now playing card", "A card at the head of the board: the track large, how far in on the horizon line, Pause as the Cup, Next track, Stop all, Master and the room's lamp."],
        foot: ["Pinned at the foot", "A player's bar along the page's foot: the controls, the track and how far in, the room's lamp and Master; on a phone above the tabs."]
      }
    },
    s3: {
      n: 3, name: "Putting a sound on", page: "add",
      what: "Putting a library sound on the board as a track, a layer or an effect, and renaming or deleting it. Drawn as the GM adds Crowd murmur to the ambience.",
      today: "Each library row has Music, Ambience and Effect buttons; one reads In playlist, In ambience or In effects when the sound is there; then Rename and Delete as icons.",
      opts: {
        today: ["Today's buttons", "Today's three buttons on each row drawn to the theme."],
        chips: ["Kind chips", "Each row has Music, Ambience and Effect as Base line chips, lit with a check where the sound is; pressing one puts it on or takes it off."],
        menu: ["A's menu at the sound", "Each row says where the sound is and has Add: A's menu with Add to the playlist, Add to the ambience, Add as an effect, Rename and Delete."],
        drag: ["Drag onto the board", "Drag a row onto Music, Ambience or Effects, which light as it passes; on a phone, holding a row opens the same menu."],
        dialog: ["Add from the section", "Each section has Add: A's dialog of the library with boxes, what is already there marked, and Add 1 sound."]
      }
    },
    s4: {
      n: 4, name: "An encounter's sound", page: "enc",
      what: "Each encounter's own sound: the playlist and the layers that were on when the GM saved it, whether it starts when the encounter goes live, Play now, Replace and Clear (today's Encounter sound). E's workbench also names it under Light and sound.",
      today: "A section of rows: the encounter's name (Live), what is saved (\"2 tracks · 1 ambient layer\" or No sound saved), Save or Replace with current sound, Starts when live, Play and Clear.",
      opts: {
        today: ["Today's rows", "Today's rows drawn to the theme."],
        cards: ["Encounter cards", "E's shelf cards: each encounter's map, its name, what is saved, Play now, When live and More."],
        side: ["A list and the chosen one", "The encounters as a list; the chosen one shows what it saved, track by track, with Starts when it goes live, Play now, Replace and Clear."],
        strip: ["A strip under the head", "Every encounter's sound as a strip of chips under What is playing, the live one lit; Save what plays now as a menu at its end."],
        page: ["On the encounter's page", "The board lists no encounters; each encounter's sound sits on its page under Light and sound (E 2.2): what it saved, Starts when it goes live, Play now, and Replace with what plays now."]
      }
    },
    s5: {
      n: 5, name: "See as the table screen", page: "seeas",
      what: "From an encounter's page, seeing what the table screen (or one character's player) would get if it went live now. The server builds it from the same projections as the real screen. H left it for this round.",
      today: "A See as menu in the title row (You, the GM; The table screen; each character). The map swaps in place for the screen's stage under a cyan line, What the table screen shows, with Back to your view.",
      opts: {
        today: ["Today's swap", "Today's See as menu and the map swapped in place under the cyan line, drawn to the theme."],
        inplace: ["The screen in place", "From More (E 2.2), the map becomes the table screen's whole picture (H's turn ladder and map) under the line, with who it is seen as in a menu."],
        pip: ["Picture in picture", "H 2.4's picture in picture docks at the map's corner with what the screen would show; the GM's map stays as it is."],
        side: ["Side by side", "The panel folds away and the GM's map and the screen's picture sit side by side."],
        full: ["The whole screen", "A's dialog with the screen's picture large, and the table screen and each character as chips at its head."]
      }
    }
  };

  function renderIdea() {
    $("#idea").innerHTML = ["s1", "s2", "s3", "s4", "s5"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + (S[k] === CHOSEN8[k] ? " · chosen" : " · turned down") + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', P = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML = '<div class="today-strip" ' + W + ">" + E + "On the laptop</p>" + fig("t-sound", "The sound board") + fig("t-sound2", "Its foot: the library and encounter sound") + fig("t-seeas", "An encounter seen as the table screen") + fig("t-settings", "Settings' Players section, which ends with Preview the table screen") + "</div>" +
      '<div class="today-strip" ' + P + ">" + E + "On a phone</p>" + fig("t-sound-p", "The sound board") + fig("t-sound2-p", "Its foot") + fig("t-seeas-p", "Seen as the table screen") + "</div>";
    var CI = [
      ["The Table screen page", "H 2.3", "T's title row, Table screen, with Display and Sound as a segmented control and how many screens are connected."],
      ["One name: Table screen", "H rule 2", "The TV, the menu, the settings page and the preview all say Table screen."],
      ["The picture in picture", "H 2.4", "A docked preview of the screen with its bar: the lamp, the name, Pop out and Close."],
      ["The turn ladder", "H 2.1", "What the table screen shows in a fight: the ladder at the left and the map."],
      ["The workbench", "E 2.2", "An encounter's page: the title row, the tools at the left, the map, and the panel of Who is in it, Rules, and Light and sound; See as in More."],
      ["Folders at the side", "E2 2.1", "A list's groups at the left with their counts, the chosen one lit."],
      ["Panes", "G", "Filters, results and the record side by side."],
      ["The VCR counter", "C 2.2", "PLAY ▶ and a count in VT323 at the head of the Ladder."],
      ["A's menu and dialog", "A, C2", "Menus at the thing; dialogs with the horizon edge; from the foot on a phone."],
      ["Controls", "T 2.5", "Base line controls, switches and chips; chosen on cyan; the Cup for the one primary."],
      ["Numbers in VT323", "G 3.6", "Lengths, levels and counts."]
    ];
    $("#carried").innerHTML = CI.map(function (c) { return "<div><h3>" + c[0] + '<span class="from">' + c[1] + "</span></h3><p>" + c[2] + "</p></div>"; }).join("");
    var R = [
      ["Sound comes out of the table screen only", "The GM's device and the players' stay silent, as today; the page says so in its title row, and nothing on it plays a sound on the device it is on.", ""],
      ["The room's lamp", "Wherever what is playing shows, a lamp says whether each table screen can play it: on, waiting for a tap on the screen (caution), or no table screen connected.", "Today a badge for each screen."],
      ["Levels", "Every level is a Base line slider with its value in VT323, 0 to 100, at least 44 px to grab on a phone.", ""],
      ["Nothing new in what the controls do", "Every play, pause, next, stop, arrange, upload, rename, delete and encounter sound keeps today's commands, routes and words.", ""],
      ["The Playing bar", "One kind of control and one kind of slider: the three icon buttons share one size and each has its name for a screen reader; the scrubber and Master share the Base line slider, their numbers in VT323. Dragging the scrubber moves the track for every table screen. No menus in the bar.", "Today Pause is the primary, Stop all a button and Master a long slider."],
      ["See as stays in More", "See as opens from the workbench's More (E 2.2). While it is on, the title row shows who it is seen as (See as: The table screen) to switch, and the map swaps in place under the cyan line with Back to your view.", "Today See as is a menu in the title row."],
      ["Settings' row", "Settings' Players section keeps Preview the table screen; it opens H's picture in picture (H 2.4).", "Today it opens the preview."],
      ["Phones", "One column; the board's parts as chips or a segmented control; menus and dialogs from the foot; 44 px hit areas.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
