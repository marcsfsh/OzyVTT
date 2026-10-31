  /* ---------- F round 2's decisions ---------- */
  var CHOSEN7 = { f1: "panes", f2: "rail", f3: "panes", f4: "side", f5: "side" };
  DEC = {
    f1: {
      n: 1, name: "All the results", page: "search",
      what: "The Codex's search page (F1.3): every page that matches, what kind it is, the line that matched, and who sees it. A's search dialog (A 2.3) is the quick way in; this is where its \"all results\" leads. Drawn as the GM searches for \"ash\": six pages, one hidden, one with a hidden block that matched.",
      today: "A table of results under Type, Visibility and Modified menus and a Sort: Name, Type, Matching line, Who sees it (Everyone or Hidden) and Modified, the typed part lit in each line.",
      opts: {
        today: ["Today's table", "Today's columns drawn to the theme, the menus as Base line controls."],
        rows: ["Rows with their line", "One page a row: its kind's icon, its name, its kind and the line that matched, and who sees it; the kinds as Base line chips with counts over them."],
        grouped: ["By kind", "The same rows under each kind as open groups: People, Places, Factions, Lore."],
        panes: ["Results and the page", "G's panes: the kinds and who sees it at the left, the results in the middle, the chosen page at the right with the match lit."],
        dialog: ["Only the dialog", "No page of its own: A's search dialog grows to hold every result, with the kinds as chips at its head."]
      }
    },
    f2: {
      n: 2, name: "The pages index", page: "index",
      what: "Every page in the Codex (F2.1): by kind, by tag, by name, and who sees each. Twelve pages: four people, three places, two factions, a thing and two pieces of lore; two of them hidden.",
      today: "A narrow column: Find a page by name, the tags as chips, the five kinds as rows with how many are revealed and hidden, then Every page as a list.",
      opts: {
        today: ["Today's index", "Today's column drawn to the theme."],
        shelf: ["Cards by kind", "Each kind an open group of page cards: the kind's icon, the name, its line, who sees it and its tags; a hidden page's card dashed in violet."],
        rail: ["Kinds at the side", "Like the maps' folders (E2): the kinds with their counts and the tags at the left, the chosen kind's pages as rows at the right."],
        table: ["One table", "Every page in one table: name, kind, tags, who sees it, when it changed; the kinds as chips."],
        alpha: ["A to Z", "Every page under its first letter in VT323, two columns, the kinds as chips."]
      }
    },
    f3: {
      n: 3, name: "A tag", page: "tag",
      what: "What pressing a tag shows (F1.5): every page and pin that carries it. Drawn with #thornwick: four pages, no pins.",
      today: "A page of its own: the tag's name, its pages as a list with an eye on each, and its pins (\"No pins carry this tag.\").",
      opts: {
        today: ["Today's page", "Today's page drawn to the theme."],
        filter: ["A filter on the index", "No page of its own: the tag lights as a chip on the pages index and the list narrows to its pages; the chip's × clears it."],
        record: ["A record", "T 2.2's title row for the tag (#thornwick, how many pages and pins, Rename the tag), its pages as cards, its pins."],
        menu: ["A menu at the tag", "Pressing a tag on a page opens A's menu: its pages, its pins, and See them on the pages index."],
        panes: ["In the side column", "Pressing a tag on a page turns the page's side column into the tag's pages, with Back to the page's facts."]
      }
    },
    f4: {
      n: 4, name: "Revealing to players", page: "reveal",
      what: "Making a hidden block, field or page readable by players (F2.5): to everyone or to chosen characters, what they will read, and the stamp it leaves (the session and the players' date). Drawn as the GM reveals What she hides on Sister Ilsa's page.",
      today: "A dialog, Reveal {block}: Who sees it (Everyone, or Chosen characters with a box for each), What they will read, the stamp's line, Cancel and Reveal to everyone.",
      opts: {
        today: ["Today's dialog", "Today's dialog drawn to the theme."],
        menu: ["A menu at Reveal", "A's menu from the block's Reveal: Everyone and each character as checks, and Reveal at its foot."],
        inplace: ["In place", "The hidden block becomes a Cradle where it is: who sees it as Base line chips, the stamp's line, Cancel and Reveal."],
        preview: ["Beside the preview", "A wide dialog: who sees it at the left, and at the right the page as everyone will read it with the block in place (rule 3.4's preview)."],
        side: ["In the side column", "The page's side column turns into the reveal: who sees it, what they will read, the stamp and Reveal as the Cup."]
      }
    },
    f5: {
      n: 5, name: "Version history", page: "history",
      what: "A page's earlier versions (F2.6): when each was saved, what changed, reading one, and restoring it. Sister Ilsa's page has four.",
      today: "A dialog, Version history: a line on how often versions are saved, then each version's number, date and title with Restore.",
      opts: {
        today: ["Today's dialog", "Today's dialog drawn to the theme, with what changed in each."],
        side: ["In the side column", "The side column becomes the versions, one compact line each (the version, when, what changed); choosing one shows the page as it was under a cyan line with Restore this version and Back to now."],
        compare: ["Side by side", "A wide dialog: the versions at the left, the chosen one and now side by side, added in cyan and taken out struck through, Restore at its foot."],
        timeline: ["A line of versions", "Under the title row, the versions as marks on a line like the story's Timeline; choosing one shows the page as it was."],
        menu: ["A's menu", "The page's More lists the versions; choosing one shows the page as it was under the cyan line."]
      }
    }
  };

  function renderIdea() {
    $("#idea").innerHTML = ["f1", "f2", "f3", "f4", "f5"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + (S[k] === CHOSEN7[k] ? " · chosen" : " · turned down") + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', P = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML = '<div class="today-strip" ' + W + ">" + E + "Finding, on the laptop</p>" + fig("t-search", "The search page for \"ash\"") + fig("t-pages", "The pages index") + fig("t-tag", "The tag #thornwick") + "</div>" +
      '<div class="today-strip" ' + W + ">" + E + "On a page, on the laptop</p>" + fig("t-palette", "Ctrl K's palette") + fig("t-reveal", "Revealing a block") + fig("t-history", "Version history") + "</div>" +
      '<div class="today-strip" ' + P + ">" + E + "On a phone</p>" + fig("t-pages-p", "The pages index") + fig("t-search-p", "Search") + fig("t-page-p", "A page") + "</div>";
    var CI = [
      ["The Codex's frame", "F rule 1", "Codex's Titled bar with its pages; Search the Codex is its field and New its Cup."],
      ["Search is A's dialog", "A 2.3, rule 4", "Ctrl K, the bar's field and the search icon open one dialog with where to look; the Codex uses its own search and its own authorization."],
      ["Hidden reads one way", "F rule 2", "Anything only the GM sees is violet with a dashed edge and an eye struck through, with Reveal beside it."],
      ["A page reads as a Wiki", "F 2.2", "The title row, the text in a reading measure, and the side column of Facts, Relationships, Tags and the journal."],
      ["Preview is See as players", "F rule 4", "Showing the page as players get it, under a violet line that says so."],
      ["Folders at the side", "E2 2.1", "A list's groups at the left with their counts, the chosen one lit."],
      ["Panes", "G", "Filters, results and the record side by side."],
      ["A's menu and dialog", "A, C2", "Menus at the thing; dialogs with the horizon edge; from the foot on a phone."],
      ["Controls", "T 2.5", "Base line controls and chips; chosen on cyan; fields keep their box."],
      ["Numbers in VT323", "G 3.6", "Counts, version numbers and dates' figures."]
    ];
    $("#carried").innerHTML = CI.map(function (c) { return "<div><h3>" + c[0] + '<span class="from">' + c[1] + "</span></h3><p>" + c[2] + "</p></div>"; }).join("");
    var R = [
      ["The palette is A's search", "Ctrl K in the Codex opens A's search dialog looking in the Codex (A 2.3, rule 4), keeping today's last row, New page \"{text}\". The Codex's own palette goes.", "Today the Codex has its own palette."],
      ["Picking a page is search", "Linking a page (F2.8: a relationship, a field, a pin) opens A's search dialog in the Codex, titled for what it links, and only pages are offered.", "Today the page picker is its own menu."],
      ["Nothing new in what the controls do", "Every search, tag, reveal and restore keeps today's routes and words. A player's search and index list only what they can open; hidden pages and blocks never reach them.", ""],
      ["Hidden reads one way", "In every list a hidden page reads violet with its Hidden tag, and a hit inside a hidden block says so (F rule 2).", ""],
      ["A tag is #name", "A tag reads #name everywhere in the label face, never as a coloured pill.", ""],
      ["The side column swaps", "A tag, a reveal and the versions each take the page's side column in turn, with Back to the page's facts at its head; the text stays where it is. One at a time.", "Today each is a dialog or a page of its own."],
      ["Phones", "Lists run one a row; dialogs and menus open from the foot; every control keeps a 44 px hit area.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
