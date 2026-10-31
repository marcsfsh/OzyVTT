  /* ---------- F round 3's decisions ---------- */
  var CHOSEN9 = { q1: "rail", q2: "ringglass", q3: "side", q4: "inline", q5: "tab" };
  DEC = {
    q1: {
      n: 1, name: "Quests", page: "quests",
      what: "The campaign's quests (F5.1): each one's status, its objectives and who sees each, and the pages it touches. Drawn with four quests: two active, one not started and hidden, one done.",
      today: "A Filters drawer (a field, Status and Who sees it as chips, the quests as a list) beside the chosen quest as a page: its status and audience, its objectives with a check and an audience menu each, and a side column of Status, Progress and Linked pages.",
      opts: {
        today: ["Today's list and page", "Today's drawer and quest page drawn to the theme."],
        rail: ["Status at the side", "Like the pages index (F2): Status and Who sees it at the left with counts, the chosen status's quests as rows with their progress; a quest opens as a page."],
        panes: ["Quests and the quest", "G's panes: the status at the left, the quests in the middle, the chosen quest at the right with its objectives."],
        board: ["A board by status", "Not started, Active and Done as three columns of quest cards, each with its progress and first objectives."],
        cards: ["Quest cards", "Every quest as a card (E's shelf) with its status, line and progress, the statuses as chips over them."]
      }
    },
    q2: {
      n: 2, name: "Relationships", page: "rels",
      what: "How pages are tied (F5.2): the ties of the page you centre on, who they are, and which are hidden. Drawn centred on the Ashen Hand, with five ties, one hidden.",
      today: "Centre on a page, then Web, Factions grid or Over time. The web draws the centred page with its ties above and below it; a panel at the right lists the ties by label.",
      opts: {
        today: ["Today's web", "Today's web and ties panel drawn to the theme."],
        ring: ["A ring", "The centred page in the middle and every tie around it, each line named; the ties panel stays at the right."],
        rows: ["Ties as rows", "No picture: the centred page's ties as rows in groups (its people, its enemies, other factions), the chosen tie beside them."],
        grid: ["One grid", "People and factions as one grid, each row toward each column, with Toward the party as its last column."],
        glass: ["The web on glass", "The web takes the whole page; Centre on, the views and the ties sit on glass over it, as the table's map does."],
        ringglass: ["A ring on glass", "The two put together: the ring, every tie named on its line, across the whole page, with Centre on, the views and the ties on glass over it."]
      }
    },
    q3: {
      n: 3, name: "A faction's standing", page: "standing",
      what: "Moving how a faction stands toward the party (F5.3): the word (Hunted to Exalted), its number from −100 to 100, and an optional reason only the GM sees. Each change goes on the chronicle. Drawn as the GM moves the Ashen Hand from −52.",
      today: "From the Factions grid, a dialog: the word on a bar, the number in a field, Why it moved, and Record change.",
      opts: {
        today: ["Today's dialog", "Today's dialog drawn to the theme, the word first."],
        menu: ["A's menu at the standing", "A's menu from the grid's cell: the word and number, steps of 5 and 10, the reason, and Record change."],
        side: ["In the side column", "On the faction's page, the side column turns into its standing: the word, steps, the seven words with the current one lit, the reason, and Record change."],
        words: ["Choose the word", "A dialog of the seven words with their ranges; choosing one moves the number to its middle, with the exact number and the reason under it."],
        record: ["A record with its history", "The standing as a record: the word large with its number, the seven words, and how it moved, change by change; Change opens the fields."]
      }
    },
    q4: {
      n: 4, name: "Adding to the chronicle", page: "compose",
      what: "Putting something on the chronicle (F4.5): an entry, a deadline, downtime or a milestone, with what players read and a hidden note. It is dated to your date and the session.",
      today: "A dialog, Add to the chronicle: Entry, Deadline, Downtime and Milestone as tabs, What players read and Hidden note as two editors with toolbars, Cancel and Add entry.",
      opts: {
        today: ["Today's dialog", "Today's dialog drawn to the theme."],
        inline: ["At the head of the line", "The composer opens at the top of the chronicle: the kinds, Filed under (any session, the active one first) and the date, the text, Hidden note and Link a page, and Add entry. Each session in the line has Add here."],
        side: ["In the side column", "The story's side column (your date and the calendar) turns into the composer, with Back."],
        fitted: ["A menu, then a fitted dialog", "Add to the chronicle is A's menu of the four kinds; each opens a dialog with only its own fields (a deadline: what is due, when, who sees it)."],
        quick: ["One line", "One line at the head of the chronicle with the kinds as chips and Add; More opens the hidden note, the date and a page."]
      }
    },
    q5: {
      n: 5, name: "Downtime and deadlines", page: "downtime",
      what: "Days each character has spent between sessions, and what falls due on the campaign's calendar (F4.7). Drawn with two characters' downtime and three deadlines, one two days away.",
      today: "A Downtime card in the story's side column (No downtime logged yet, Log downtime); deadlines show only as chronicle entries.",
      opts: {
        today: ["Today's card", "Today's card drawn to the theme."],
        rows: ["Days and deadlines at the side", "The story's side column lists the deadlines with the days left (amber when close) and each character's downtime days."],
        line: ["On the Timeline", "Deadlines as amber marks on the Timeline tab's line, and each character's downtime as a span under it."],
        tab: ["A Downtime tab", "A fourth tab on the story. What the tab holds is its own question in the next round; drawn here as the round showed it."],
        home: ["On the home", "Deadlines and downtime as two groups on the Codex's dashboard (F 2.1)."]
      }
    }
  };

  function renderIdea() {
    $("#idea").innerHTML = ["q1", "q2", "q3", "q4", "q5"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + (S[k] === CHOSEN9[k] ? " · chosen" : " · turned down") + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', P = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML = '<div class="today-strip" ' + W + ">" + E + "People, on the laptop</p>" + fig("t-quests", "Quests, every status") + fig("t-quest", "A quest") + fig("t-rel", "Relationships: the web") + fig("t-grid", "The Factions grid") + fig("t-standing", "Standing with a faction") + "</div>" +
      '<div class="today-strip" ' + W + ">" + E + "The story, on the laptop</p>" + fig("t-story", "The chronicle, with the Downtime card at the right") + fig("t-composer", "Add to the chronicle") + fig("t-downtime", "Log downtime") + "</div>" +
      '<div class="today-strip" ' + P + ">" + E + "On a phone</p>" + fig("t-quests-p", "Quests") + fig("t-quest-p", "A quest") + fig("t-rel-p", "Relationships") + fig("t-story-p", "The story") + "</div>";
    var CI = [
      ["The Codex's frame", "F rule 1", "Codex's Titled bar with its pages; Search the Codex is its field and New its Cup."],
      ["A page reads as a Wiki", "F 2.2", "The title row, the text in a reading measure, and the side column."],
      ["The side column swaps", "F2 rule 3", "A tag, a reveal or the versions take the page's side column in turn, with Back."],
      ["Hidden reads one way", "F rule 2", "Violet with a dashed edge and an eye struck through, with Reveal beside it."],
      ["The story's tabs", "F 2.4", "The Chronicle's line, the Timeline across the top, the Sessions cards."],
      ["Folders at the side", "E2 2.1", "A list's groups at the left with their counts, the chosen one lit."],
      ["Panes", "G", "Filters, results and the record side by side."],
      ["Shelf cards", "E 2.1", "A card per thing, a picture or a line, its state as a tag."],
      ["Glass over a map", "C 2.1", "Controls float on glass over the picture they work on."],
      ["A's menu and dialog", "A, C2", "Menus at the thing; dialogs with the horizon edge; from the foot on a phone."],
      ["Controls", "T 2.5", "Base line controls and chips; chosen on cyan; the Cup for the one primary."]
    ];
    $("#carried").innerHTML = CI.map(function (c) { return "<div><h3>" + c[0] + '<span class="from">' + c[1] + "</span></h3><p>" + c[2] + "</p></div>"; }).join("");
    var R = [
      ["Standing reads as a word", "Hunted, Hostile, Unfriendly, Uninvested, Friendly, Allied or Exalted comes first; the number follows in VT323. Never a bar length or a colour alone, as today.", ""],
      ["Hidden reads one way", "A hidden quest, objective, tie or entry is violet with its Hidden tag and Reveal beside it (F rule 2); players never receive it.", ""],
      ["Nothing new in what the controls do", "Every quest, objective, tie, standing, entry, deadline and downtime keeps today's routes and words.", ""],
      ["Dates are the campaign's", "Deadlines and downtime count days on the campaign's calendar (your date), never real days.", ""],
      ["Any session can take an entry", "The composer's Filed under offers every session and Not in a session, the active one first, as today's Session field does; each session in the line has Add here, which opens the composer filed under it.", "Today the session is a field inside the dialog."],
      ["The calendar and the record", "Edit calendar and a timeline record keep today's dialogs, drawn as A's dialog, until a later round.", ""],
      ["Phones", "One column; groups as chips; menus and dialogs from the foot; 44 px hit areas.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
