
  /* ---------- What each option means ---------- */
  var DEC = {
    d1: {
      n: 1, name: "The Codex's home", page: "home",
      what: "What the Codex opens on (F1.2), for the GM. A player's home is the same pattern with only what they have been shown, and New since your last visit where today's player home has it.",
      today: "A date bar, the counts by kind with Places, Factions and the next session, Where the party is, a reveal check, and a table of what changed lately with who sees each.",
      opts: {
        dash: ["Dashboard · chosen", "Today's home drawn to the theme: the date bar, the counts by kind, what changed lately with who sees it, and at the right the next session, where the party is and the reveal check."],
        front: ["Front page", "The story so far leads: the last session's recap as a headline, the quests in play under it, and the next session and what is new beside it. Reads like the campaign's newspaper."],
        index: ["Index", "Every page in five columns by kind, like the index of a book, with hidden pages marked and New under each column; the quests and what changed under that."],
        next: ["Next session", "Home is the next session's prep: its strong start, scenes, clues and encounters, Start session 3, and what you plan to reveal tonight with Reveal beside each."],
        shelf: ["Shelf", "The pages as cards with their portraits, grouped by kind, and the kinds as chips to narrow them. Pairs with Prep's shelf."],
        find: ["Search first", "One large search field, then tags, the kinds as chips, what you opened lately and the next session. For a Codex you navigate by name."]
      }
    },
    d2: {
      n: 2, name: "Reading a page", page: "page",
      what: "One page as the GM reads it and as a player reads it (F2.2): a person here. The GM sees the hidden block and the hidden field marked; a player never receives them.",
      today: "A title row with See as players, Edit and the menu; the text at the left with the hidden block in violet; a panel at the right with fields, relationships, tags and the page's journal.",
      opts: {
        wiki: ["Wiki · chosen", "Today's layout drawn to the theme: the text at the left with hidden parts in a dashed violet box, and the facts, relationships, tags and journal as open groups at the right."],
        band: ["Band", "The portrait and a plate of the page's fields across the top, as the character sheet's band (D1) does, then the text with relationships and the journal beside it."],
        book: ["Book", "The text in a centred reading column at a larger size, the fields as margin notes at the left, and hidden parts as violet margin notes at the right."],
        tabs: ["Tabs", "Overview, Relations, Mentions and Journal as tabs, today's phone layout on every size; the overview shows the portrait, the text and the facts."],
        dossier: ["Dossier", "A dossier at the left (a large portrait and the facts in a Cradle), and the page's sections as open groups at the right."],
        layers: ["Two layers", "For the GM, two columns: what everyone sees at the left and what only you see at the right (hidden blocks, hidden fields, hidden pages it names). A player sees the left alone."]
      }
    },
    d3: {
      n: 3, name: "Writing a page", page: "write",
      what: "The GM writing or editing a page (F2.3, F2.4): the text, the [[links]], hidden blocks and who sees each field.",
      today: "The page turns editable in place: a toolbar, the text with the hidden block, and a fields panel at the right with a switch for who sees each field; Saved and Done at the top.",
      opts: {
        inplace: ["In place · chosen", "Today's editor drawn to the theme: the toolbar over the text, the hidden block in violet, and the fields in a Cradle at the right with Everyone or Hidden for each. A Preview switch in the title row shows the page as players get it, and turns back to writing. On a phone it is Write and Preview."],
        preview: ["With a preview", "What you write at the left (text with [[links]] and hidden sections marked) and what players will see at the right, updated as you type."],
        fields: ["Fields first", "A form: the kind, then each field with who sees it, then the text under it. Suits pages that are mostly facts."],
        blocks: ["Blocks", "Every paragraph has a handle at its left: drag it to move it, and its eye to say who sees it. Hiding a paragraph turns it into a hidden block."],
        quick: ["Quick note", "New page is a small dialog: the name, the kind, one text box with [[links]] and who sees it. Fields and hidden blocks come later, on the page."],
        focus: ["Focus", "The text alone in a wide reading column, nothing else on screen; the fields wait in a drawer at the edge, with the word count and Saved at the top."]
      }
    },
    d4: {
      n: 4, name: "The story", page: "story",
      what: "The campaign's time (F4.1 to F4.3): sessions, what happened in each, quests changing, and the in-world calendar.",
      today: "Chronicle, Timeline and Sessions as tabs. The chronicle is one line of sessions with their entries, and the date bar, a month calendar, downtime and Add to the chronicle at the right.",
      opts: {
        chron: ["Chronicle · chosen for the Chronicle tab", "Today's chronicle drawn to the theme: one line of sessions, the next one amber, entries under each, and the date bar, the month and Add to the chronicle at the right."],
        sessions: ["Sessions · chosen for the Sessions tab", "The sessions as cards: the next one leads with Start session 3, then each played session with its recap, what happened in it and who came."],
        cal: ["Calendar", "The in-world month as a grid, sessions, events and quest changes on their days, today outlined, and the chosen day's entries at the right."],
        line: ["Timeline · chosen for the Timeline tab", "A horizontal line across the top from the first session to the eclipse ahead, today marked, and a card under each point."],
        diary: ["Journal", "A diary: each session a dated heading and a paragraph with its links, then its quest changes in a line. Reads top to bottom."],
        board: ["Board", "Three columns: what was played, the next session with what to reveal and Start, and the quests in play."]
      }
    }
  };
  function renderIdea() {
    $("#idea").innerHTML = ["d1", "d2", "d3", "d4"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML =
      '<div class="today-strip" ' + W + ">" + E + "Laptop</p>" + fig("home", "The Codex's home") + fig("pages", "Pages") + fig("page", "A page, as the GM") + fig("edit", "Writing a page") + fig("place", "A place") + fig("story", "The story: Chronicle") + fig("sessions", "A session's prep") + fig("search", "Search") + "</div>" +
      '<div class="today-strip" ' + W + ">" + E + "Phone</p>" + fig("home-phone", "Home") + fig("page-phone", "A page") + fig("edit-phone", "Writing") + fig("story-phone", "The story") + "</div>";
    var R = [
      ["The Codex takes the Titled bar", "Codex in the section bar (T 2.1) with its pages as words: Home, Pages, Atlas, Story, Quests and Relationships. Search the Codex is the bar's field and New (a menu of page, quest, session) its Cup. Search and the Compendium leave the strip: search is the field, the Compendium is its own section.", "Today the Codex has its own boxed strip of seven pages with icons, a search box, New and the GM menu."],
      ["Hidden reads one way", "Anything only the GM sees is violet with a dashed edge and an eye struck through, with Reveal beside it: a hidden block, a hidden field, a hidden page in a list. Everything else says Everyone in quiet ink.", ""],
      ["A player gets the same page, smaller", "A player's page is the GM's with the hidden parts left out (the server never sends them), no Edit, and nothing that says something is missing.", ""],
      ["See as players", "The GM's See as players is a switch in the page's title row; while it is on, the page draws exactly as a player gets it, under a violet line that says so.", ""],
      ["Links are cyan", "A [[link]] to another page reads cyan with a thin line under it; a link to a hidden page reads violet for the GM and as plain text for a player.", ""],
      ["The date in VT323", "The campaign's date is VT323 cyan wherever it shows, with whether players have it.", ""],
      ["One kind of page header", "Every Codex record (page, quest, session) opens with T 2.2's title row: its title, its kind and who sees it, one line, and its actions.", ""],
      ["The GM menu goes", "Today's GM menu (What players see, reveal audit, templates, backup, settings) moves into the frame's menu (A) and the Codex's More.", ""],
      ["On a phone", "The pages run under the Codex header as a strip of words; a page's actions are the header's icons; writing hides the strip and pins Done.", ""],
      ["Left for later", "The Atlas, quests, relationships, version history, templates, backup and the Codex's Compendium reader come in F's later rounds, inside this frame.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
