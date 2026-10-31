
  /* ---------- What each option means ---------- */
  var DEC = {
    d1: {
      n: 1, name: "The Compendium's home", page: "home", fams: ["Shelves", "Search first"],
      what: "What /compendium opens on (G3), for the GM: the kinds and their counts, what needs you, and a way in by name. Players read the Compendium inside the Codex; that reader comes in a later round.",
      today: "Homebrew in the strip: a Sources table, Needs you, and a By kind table of SRD, homebrew, draft and shared counts.",
      r1: "You kept Shelves and Search first.",
      opts: {
        shelves: ["Shelves, refined · chosen", "The nine kinds as cards, three to a row, each with its emblem, its count, its homebrew and drafts, and a few of its records. Needs you is a strip across the top; the sources are one line at the foot."],
        twoshelves: ["Two shelves", "The kinds stand on two shelves: For characters (classes, subclasses, species, backgrounds, feats) and For the table (spells, spell lists, items, monsters). Needs you and the sources sit at the right."],
        hbshelf: ["Homebrew shelf", "Your homebrew gets the top shelf as cards, each with who sees it and what it came from. The SRD's kinds sit on the shelf under it as small tiles with their counts."],
        find: ["Search first, refined", "The search field leads, with a line of examples under it and the kinds as chips with their counts. Under that, what you opened lately, what needs you, and your homebrew."],
        pins: ["Pinned", "The search field, then the records you pin as cards showing the line you look them up for: a monster's AC and HP, a spell's damage and range. For what you check every session."],
        findshelves: ["Search over shelves", "The two together: the search field and its examples on top, the kinds as cards under it, then what you opened lately and what needs you."]
      }
    },
    d2: {
      n: 2, name: "Browsing and records", page: "srd",
      what: "Finding monsters with the filter panel, opening several records beside the results, reading and changing them, changing the filters with records open, and going back to browsing without losing them (G2, G6). Asked again in a third round, after the joined screen of round 2.",
      today: "One table for every kind with its filters in menus, and one record at a time beside a narrowed table.",
      opts: {
        panes: ["Three panes · chosen", "Filters, results and the record side by side, all live: tick a filter and the list beside the record changes at once, new rows marked. The open records are tabs over the record only, and the record's Card, Sharing and History are a small switch in its head. Each pane folds from a button in its head. Back at the full-width table, a 3 records open button brings the record back, and the open ones are marked in the table."],
        sidebar: ["One sidebar", "One column at the left holds the filters and, under them, Open: the records you have open as a list. No strip of tabs."],
        summary: ["Filters fold into the list", "With a record open, the filters shrink to a card at the top of the list; Edit opens them in place above the live list."],
        preview: ["Preview, then keep", "Three panes, but a row opens as a preview tab that the next row replaces; Keep it open keeps it."],
        walk: ["Walk the results", "A record takes the width, with the results as a ribbon of names over it and Previous and Next."],
        lanes: ["Side by side", "Open records stand side by side as lanes, two at a time, for comparing."]
      }
    },
    d4: {
      n: 3, name: "Making homebrew", page: "make", fams: ["Studio", "One form"],
      what: "Writing a homebrew record (G7): your copy of the Goblin Boss, on its defences. New homebrew (G8) stays a small dialog whichever you pick; this is what opens after it.",
      today: "The Edit tab is a studio: Steps or All questions, a rail of nine steps, one step's questions in the middle, a live stat block at the right, and Back and Next.",
      r1: "You kept Studio and One form.",
      opts: {
        studio: ["Studio, refined · chosen", "The steps rail shows each step's answer (AC 17 · HP 27 · 30 ft.) and which are done; one step's questions in the middle; the live card at the right with Mark what differs. Steps and One page as a switch."],
        cardrail: ["Card as the steps", "The live card is the rail: each part of it (identity, defences, ability scores, details, actions) is a step you press, and its questions open beside it."],
        topsteps: ["Steps across the top", "The nine steps run across the top as a stepper, which gives the questions and the live card the full width under it."],
        form: ["One form, refined", "Every question on one page in groups. The contents at the left shows each section's answer and a mark when it is done, and the section you are in is lit. The live card stays at the right."],
        folds: ["Folding sections", "One page of sections that fold: each closed one shows its answer in a line, and the one you open shows its questions. The live card at the right."],
        paired: ["Paired with the card", "Each section of the form sits beside the lines of the stat block it makes, so you see what each answer does as you go."]
      }
    }
  };
  function renderIdea() {
    $("#idea").innerHTML = ["d1", "d2", "d4"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]], fam = d.fams ? d.fams[Math.floor(VALID[k].indexOf(S[k]) / 3)] : "";
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + "</p><h2>" + o[0] + "</h2>" + (fam ? '<p class="eyebrow" style="margin-top:2px">' + fam + " family</p>" : "") + "<p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML =
      '<div class="today-strip" ' + W + ">" + E + "Laptop</p>" + fig("home", "Home (the Homebrew tab)") + fig("monsters", "Browse: monsters") + fig("record", "An SRD monster") + fig("edit", "Editing a copy") + fig("share", "A copy's Sharing") + fig("history", "A copy's History") + fig("new", "New homebrew") + fig("search", "Search") + fig("sources", "Sources") + "</div>" +
      '<div class="today-strip" ' + W + ">" + E + "Phone</p>" + fig("home-phone", "Home") + fig("monsters-phone", "Monsters") + fig("record-phone", "A record") + fig("edit-phone", "Editing") + "</div>";
    var R = [
      ["The Compendium takes the Titled bar", "Compendium in the section bar (T 2.1) with its pages as words: Home, Browse, Sources and Sharing. Search the SRD and homebrew is the bar's field (Ctrl K, as today), Rules a Base line control, and New homebrew its Cup.", "Today the Compendium has its own boxed strip (Browse, Homebrew, Sources, Sharing), a search box, a Rules button and New homebrew."],
      ["Where it comes from reads one way", "An SRD record carries a quiet SRD 5.2.1 tag; homebrew carries a magenta Homebrew tag, and its counts are magenta wherever they show.", ""],
      ["Who sees it reads as in the Codex", "Hidden is violet with a dashed edge and the eye struck through; Everyone is quiet ink; Characters names them. The control is Hidden, Everyone and Characters as Base line options.", ""],
      ["Drafts", "A draft has a dashed state tag and Publish as its Cup. A draft cannot be shared, and its sharing says Publish it before you share it, as today.", ""],
      ["One stat block", "The SRD's order and words, the name in display capitals, the six abilities in a row of cells with VT323 numbers, and section heads (Actions, Bonus Actions, Reactions) in small capitals over a magenta line. The same block in the card, the editor's preview, Prep and the table.", ""],
      ["Numbers in VT323", "Counts, CR, AC, HP and ability scores, as the theme does for every number.", ""],
      ["One kind of record header", "Every record opens with T 2.2's title row: its name, one line (kind, type, source, AC, HP and CR), then its actions and, at the right, its Card, Sharing and History (Card and Your copies for the SRD) as a small switch. An SRD record: Add to an encounter, and Make a homebrew copy as the Cup. Homebrew: who sees it, Edit, and Publish as the Cup while it is a draft.", ""],
      ["Two rows of tabs at most", "The section bar, then the open records over the record pane. Filters always fold to words read across, never a label written sideways; changing a filter never hides the list it changes; an open record stays open when the filters change; and going back to the full table keeps the open records.", "Round 2's joined screen stacked three rows of tabs and wrote its folded filters sideways."],
      ["New homebrew stays a dialog", "Name, kind, blank or a copy of a record, and It starts as a draft only you can see, as today. What opens after it is decision 4.", ""],
      ["Monsters stay with the GM", "Players never get a monster's stat block, whoever it is shared with; the sharing says so wherever a monster is shared.", ""],
      ["On a phone", "The pages run under the Compendium header as a strip of words, with Search and New homebrew as the header's icons. Filters open as a sheet from the bottom. A record opens full screen or as a sheet, its main action pinned at the foot; editing pins Back and Next, or Done.", ""],
      ["Left for later", "Sources and export, the Sharing page, Compare and Merge, the editors for kinds other than monsters, search's own dialog and the catalog picker come in G's later rounds, inside this frame.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
