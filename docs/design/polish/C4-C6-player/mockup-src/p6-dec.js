
  /* ---------- What each option means ---------- */
  var CHOSEN = { d1: ["top", "tab"], d2: ["card"], d3: ["counts"], d4: ["bell"] };
  var DEC = {
    d1: {
      n: 1, name: "Where the waiting list sits", page: "fight",
      what: "What waits on the GM in a fight (C3.2): a player's hit to apply, a target to choose, a ruling to give, a save to roll, and what waits on a player. Drawn on Lyra's turn with two things waiting.",
      today: "A section at the top of the Encounter tab, above the acting creature, headed with a bell and NEEDS YOU · 2. With the acting creature under it, it is squeezed to one clipped line: its cards scroll inside a box 21 px tall. On every other tab it is gone, and only an amber count on the Encounter tab says it is there.",
      opts: {
        top: ["Top of Encounter", "Where it is today, given its room: the list opens above the acting creature with every item whole, and the turn scrolls under it. Own tab in the list's head moves it to its own tab."],
        tab: ["Its own tab", "A first tab in the panel holds the list; the tab carries the signal. The Encounter tab stays the turn. On a phone, the signal is the Switch's first choice. Over the turn in the list's head puts it back."],
        above: ["Above every tab", "The list sits above the panel's tabs, one line per item, on whichever tab is open, with Hide. On a phone, one line under the turn order with Show."],
        foot: ["By End turn", "The list sits in the panel's foot over End turn, one line per item, so what is owed is next to the button that moves on."],
        dock: ["In the left dock", "The list sits in the left dock under the turn order, beside the map, and the panel stays the turn. On a phone, the first card in the turn order."],
        drawer: ["A drawer", "One line under the tabs shows the newest with its main button; the signal opens every item in a drawer over the panel. On a phone, the signal sits in the header and opens a sheet."]
      }
    },
    d2: {
      n: 2, name: "One waiting item", page: "items",
      what: "How each item reads, drawn with four kinds: a target to choose, a hit to apply, a ruling to give, and a save that waits on a player. Every item keeps today's words and buttons.",
      today: "A card with an amber rim at its left: the title, a line, and its buttons (Apply 8 as a primary with Change and Dismiss; Choose the target and Turn down). A ruling has a violet rim; an item waiting on a player hides its buttons behind Answer for {name}.",
      opts: {
        card: ["Card", "Today's card drawn to the theme: the creature's face and the title, the line, then the buttons with the main one lit."],
        row: ["One line each", "Each item is one line: its kind's icon, who and what, the main button, and More for the rest."],
        ticket: ["Ticket", "Who and whom as faces with an arrow, the number that matters large in VT323 (9 slashing, DC 10, +10 feet), and the buttons under them."],
        expand: ["Fold out", "One line each; the oldest is open with its line and every button, and pressing another opens it in place."],
        kind: ["Grouped by what you do", "Items gathered under what they ask of you: Aim, Apply, Rule, and Waiting on players last, each with its count."],
        who: ["Grouped by creature", "Items gathered under the creature they came from, with its face, so everything owed for Lyra reads together."]
      }
    },
    d3: {
      n: 3, name: "The panel's tabs", page: "tabs",
      what: "The GM panel's one row of tabs (C3.1): Encounter, Log, Party, Notes, and Token while a token is chosen. Drawn on the Log tab with a token chosen, while two things wait.",
      today: "Words: Encounter, Log, Party, Notes and Token, the chosen one on the horizon ink; an amber square with the count on Encounter. On a phone an Order tab joins in a fight.",
      opts: {
        words: ["Words", "Today's row drawn to the theme, with the signal after Encounter."],
        counts: ["Words and counts", "The same words, and a tab with something new since it was last opened carries the count in quiet VT323 (Log 3 new lines, Notes 2 for tonight). Opening the tab drops it, as reading marks a message read."],
        icons: ["Icons over words", "Each tab an icon over its word, sharing the width; the signal sits at the corner. The Token tab shows the chosen token's face."],
        iconsonly: ["Icons only", "Square icons, 48 px each, with their names on hover or a long press; the Token tab is the token's face."],
        rail: ["Rail at the side", "The tabs as a rail of icons down the panel's left edge, so the content gets the panel's whole height."],
        menu: ["Encounter and a menu", "Encounter (and Token while chosen) as tabs, and Log, Party and Notes in one menu at the right, which shows the one open."]
      }
    },
    d4: {
      n: 4, name: "The attention signal", page: "signal",
      what: "How the app says something waits on the GM, without saying Needs you. It shows on every option above, and wherever something waits: the panel's tab, the list's head, the turn order, the top bar away from Play, a phone's tabs, and between fights.",
      today: "The words NEEDS YOU · 2 with a bell over the list, an amber square with the count on the Encounter tab, and the same words in the Compendium's home and in several lines of help.",
      opts: {
        lamp: ["Amber lamp", "A small amber lamp, as the theme's lamps are, with the count beside it in VT323. No words."],
        words: ["Needs attention", "The words NEEDS ATTENTION in small capitals with the count, over the list; the count alone on a tab."],
        bell: ["Bell", "A bell with the count on a small amber badge at its corner."],
        count: ["Count only", "The count alone in an amber box, VT323. No icon and no words."],
        flag: ["Diamond", "An amber diamond with a mark in it, the way a road sign warns, and the count beside it."],
        ink: ["Amber ink", "The tab's own line turns amber while something waits, with the count in amber beside its name; over the list, the count large."]
      }
    }
  };
  function renderIdea() {
    $("#idea").innerHTML = ["d1", "d2", "d3", "d4"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + (CHOSEN[k].indexOf(S[k]) >= 0 ? (k === "d1" ? " · chosen, the GM's switch" : " · chosen") : " · turned down") + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML =
      '<div class="today-strip" ' + W + ">" + E + "Two things waiting, on Lyra's turn</p>" + fig("gm-two", "The list squeezed to one line above the acting creature") + fig("open", "The same two cards, forced open") + fig("gm-phone", "On a phone") + "</div>" +
      '<div class="today-strip" ' + W + ">" + E + "The panel's tabs</p>" + fig("gm-fight", "Encounter, nothing waiting") + fig("gm-log", "Log") + fig("gm-party", "Party") + "</div>";
    var R = [
      ["The list's place is the GM's", "The waiting list sits at the top of the Encounter tab or in its own tab, first in the row. The GM moves it with the switch in the list's head (Own tab, or Over the turn) or in Settings, Device, Waiting list (Top of Encounter or Its own tab, GM only). The choice is kept on the device, as the last tab is today.", ""],
      ["A count is news", "A number on the Log or Notes tab is how many entries arrived since the GM last opened that tab: new log lines, new notes for tonight or in the Codex. Party and Token show state and carry no number. Opening the tab drops it to nothing, and it counts again from there. The bell is different: it counts what the GM owes, and drops only as each item is answered.", "Today only the Encounter tab carries a number, the count of what waits."],
      ["One signal, everywhere something waits on the GM", "The bell with its count replaces the words Needs you wherever they are: the list's head, the Encounter tab or the list's own tab, the turn order, the top bar's live chip away from Play, a phone's tabs, a long rest to approve between fights, and the Compendium's home. Lines of help that say \"waits in Needs you\" name the list instead (\"waits in the list over the turn\").", "Today the words show in the list's head, the Compendium's home, the encounter settings' help, three result cards and a server message."],
      ["The list is never squeezed", "Every item shows whole; the list scrolls only when it is taller than half the panel, and the turn under it scrolls on its own.", "Today two items fit in a box 21 px tall."],
      ["Oldest first", "Items keep today's order by kind and arrival; nothing re-sorts them under the GM's hand.", ""],
      ["The words and the buttons stay", "Every item keeps today's title, line and buttons, and sends the same command: Apply N, Change, Dismiss; Choose the target, Turn down; Allow, Deny; Answer for {name}.", ""],
      ["Waiting on players is quieter", "An item that waits on a player is listed after what waits on the GM, with a grey rim, and the bell does not count it: the bell counts what the GM owes.", ""],
      ["Something new arrives", "The bell rings once with its burst, as a lamp lights (ADR-0045), and screen readers hear the newest title; no sound and no toast.", ""],
      ["End turn is never blocked", "The list never stops End turn; it steps down from the Cup only where it does today (a reaction, save or damage waiting).", ""],
      ["Phones", "The Switch keeps its choices (Map, Encounter, Log, Party, Notes), with the counts on its choices and the bell on the one that holds the list (a first choice of its own when the GM puts the list in its own tab), and on the Play tab at the foot. Today's Order tab goes, as the frame (C) decided.", ""],
      ["Left for later", "The prompts' own controls (rolling a save, the reaction prompt, death saves and stabilizing), starting an encounter, the row tools and the options menu come in C3's second round.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
