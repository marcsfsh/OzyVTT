  /* ---------- F3 the Atlas, and the Downtime tab: the decisions ---------- */
  var CHOSEN10 = { a1: "mix", a2: "side", a3: "tabs", a4: "tree", a5: "side" };
  DEC = {
    a1: {
      n: 1, name: "The Atlas", page: "atlas",
      what: "The campaign's maps with their pins (F3.1): the map, its pins (places, people, the party's position), which layers show, and the pins as a list. Drawn on The Thornwood, a regional map with five pins, one hidden, and the party at Thornwick.",
      today: "The map at the left under a bar of People, Hidden pins, Factions and Set party position; a panel at the right with the map's name, who sees it, and Pins, Maps inside and Details as tabs.",
      opts: {
        today: ["Today's map and panel", "Today's map and panel drawn to the theme."],
        glass: ["The map on glass", "The map takes the whole page, as the ring does: where you are and the layers on glass at the top left, the pins on glass at the right, Add a pin and Set party position at the bottom left."],
        rail: ["Maps at the side", "Like the maps' folders (E2): the maps as a tree at the left with the layers under them, the map at the right."],
        panes: ["Pins, the map and the pin", "G's panes: the pins at the left, the map in the middle, the chosen pin at the right."],
        full: ["The map alone", "The map under one thin bar (where you are, the layers as icons, Add a pin, More); a pin opens at the pin."],
        mix: ["Maps at the side, pins at the right", "The two put together: the maps as a tree at the left with the layers under it, the map in the middle, and the pins at the right with Filter pins. A pin chosen in the list or on the map opens in that right column with All pins; a right-click on a pin opens its menu."]
      }
    },
    a2: {
      n: 2, name: "A pin", page: "pin",
      what: "What a pin says when chosen (F3.2): its name and kind, who sees it, the page it links to, the map it opens, and its journal. Drawn with Thornwick chosen.",
      today: "The panel turns into the pin: All pins, its name and who sees it, the linked page, Edit pin, Set party position here, and Journal.",
      opts: {
        today: ["Today's panel", "Today's pin panel drawn to the theme."],
        card: ["A card at the pin", "A glass card beside the pin: its name, kind, the page's first lines, Open the page, Edit and More."],
        side: ["The page beside the map", "The linked page opens in the right column beside the map, with its facts and journal and All pins at its head; chosen from the list or on the map. A right-click on any pin opens its menu."],
        menu: ["A's menu at the pin", "A's menu from the pin: Open the page, Edit pin, Set party position here, Hide from players, and the journal."],
        sheet: ["A drawer from the foot", "A glass drawer along the map's foot: the pin, its page, its journal, and its actions."]
      }
    },
    a3: {
      n: 3, name: "Editing a pin", page: "pinedit",
      what: "Changing a pin (F3.2): its label, icon and colour, who sees it, the party's pin, tags, linked pages, the map it opens, and the encounters staged there.",
      today: "The panel turns into Edit pin: Label with a switch for who sees it, Tags, the party's pin, Linked pages, Opens a map and Encounters staged here, saved as you go.",
      opts: {
        today: ["Today's panel", "Today's editor drawn to the theme."],
        glass: ["At the pin", "A glass editor beside the pin with the label, icon, colour and who sees it; More opens the links, tags and encounters."],
        dialog: ["A's dialog", "A's dialog in two columns, Look and Links, with who sees it under them, and Save pin."],
        side: ["In the side column", "The side column turns into the editor with Back, in three groups: Look, Links, Who sees it."],
        tabs: ["Tabs in the editor", "The side column with Look, Links, Encounters and Who sees it as tabs, one at a time."]
      }
    },
    a4: {
      n: 4, name: "Moving between maps", page: "maps",
      what: "Maps sit inside maps (F3.3): a world, its regions, and battle maps opened from a pin. How you see where you are, go up and go in, and where Add a map sits.",
      today: "A Maps inside tab in the panel lists the maps under this one; Details has Sits inside as a menu, and Add a pin and Add a map at its foot.",
      opts: {
        today: ["Today's Maps inside tab", "Today's tab drawn to the theme."],
        crumbs: ["Crumbs on glass", "Where you are as crumbs on glass (The Sunhold Reaches › The Thornwood); a pin that opens a map says so at the pin."],
        tree: ["A tree at the side", "Every map as a tree at the left, nested, the current one lit, Add a map at its foot."],
        stack: ["Maps stacked", "The maps above and below this one as a stack of pictures on glass; pressing one goes there."],
        zoom: ["Zoom into it", "A pin that opens a map shows that map as a framed picture beside it; pressing it zooms in, with the crumbs on glass."]
      }
    },
    a5: {
      n: 5, name: "The Downtime tab", page: "downtime2",
      what: "What the story's Downtime tab holds (F4.7, placed by F's last round): each character's days this month, what waits to be confirmed, Log downtime, and the deadlines on the calendar.",
      today: "A Downtime card in the Chronicle's side column: No downtime logged yet, Log downtime, and what waits to be confirmed when there is any.",
      opts: {
        table: ["One table", "The round's draft: a table of each character's days and last downtime, what waits above it, and the deadlines beside it."],
        cards: ["A card per character", "Each character as a card: the days this month large in VT323, what they last spent them on or what waits, and Log downtime."],
        ledger: ["Every entry as a row", "Every downtime entry as a row (when, who, days, what), the characters as chips with their totals; a row that waits has Confirm."],
        side: ["Characters at the side", "Like the folders (E2): the characters and the deadlines at the left, the chosen character's downtime at the right."],
        calendar: ["On the calendar", "Two weeks of the campaign's calendar with each character's downtime as a bar and the deadlines as amber lines."]
      }
    }
  };

  function renderIdea() {
    $("#idea").innerHTML = ["a1", "a2", "a3", "a4", "a5"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + (S[k] === CHOSEN10[k] ? " · chosen" : " · turned down") + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', P = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML = '<div class="today-strip" ' + W + ">" + E + "On the laptop</p>" + fig("t-atlas", "The Atlas with its pins") + fig("t-pin", "A pin chosen") + fig("t-pinedit", "Editing a pin") + fig("t-mapedit", "The map's details: Sits inside, Add a map") + fig("t-story-dt", "The story, with the Downtime card at the right") + "</div>" +
      '<div class="today-strip" ' + P + ">" + E + "On a phone</p>" + fig("t-atlas-p", "The Atlas") + "</div>";
    var CI = [
      ["The Codex's frame", "F rule 1", "Codex's Titled bar with its pages; Search the Codex is its field and New its Cup."],
      ["Glass over the picture", "F story 2.2, C 2.1", "The ring on glass: the picture takes the page, the controls float on glass over it."],
      ["The side column swaps", "F2 rule 3", "A tag, a reveal, the versions or the standing take the side column in turn, with Back."],
      ["Hidden reads one way", "F rule 2", "Violet with a dashed edge and an eye struck through, with Reveal beside it."],
      ["The story's tabs", "F 2.4, F story 2.5", "Chronicle, Timeline, Sessions and Downtime."],
      ["Folders at the side", "E2 2.1", "A list's groups at the left with their counts, the chosen one lit."],
      ["Panes", "G", "Filters, results and the record side by side."],
      ["The map picker", "E2 2.5", "Folders, the library and a preview, for choosing a map's picture."],
      ["A's menu and dialog", "A, C2", "Menus at the thing; dialogs with the horizon edge; from the foot on a phone."],
      ["Controls", "T 2.5", "Base line controls and chips; chosen on cyan; the Cup for the one primary."],
      ["Numbers in VT323", "G 3.6", "Counts and days."]
    ];
    $("#carried").innerHTML = CI.map(function (c) { return "<div><h3>" + c[0] + '<span class="from">' + c[1] + "</span></h3><p>" + c[2] + "</p></div>"; }).join("");
    var R = [
      ["Adding a map uses the picker", "Add a map opens E2's picker (folders, the library and a preview) for the picture, then asks its name, kind and where it sits.", "Today Add a map is a form in Details."],
      ["Hidden reads one way", "A hidden pin, map or downtime entry is violet with its Hidden tag (F rule 2); players never receive it.", ""],
      ["A pin's own menu", "A right-click on a pin (a long press on a phone) opens A's menu at it: Open its page, Edit pin, Set party position here, Hide from players, Move pin, Delete pin. A right-click on the map offers Add a pin here.", "Today a pin has no menu of its own."],
      ["The party's pin", "The party's position is one pin marked in amber under it; Set party position here moves it, as today.", ""],
      ["Nothing new in what the controls do", "Every map, pin, link, reveal, party position and downtime keeps today's routes and words.", ""],
      ["Dates are the campaign's", "Downtime days and deadlines count on the campaign's calendar.", ""],
      ["Phones", "The map fills the screen; lists and editors from the foot or as tabs; 44 px hit areas.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
