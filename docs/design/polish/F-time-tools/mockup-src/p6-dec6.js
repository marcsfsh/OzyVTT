  /* ---------- The time and tools round's decisions ---------- */
  var DEC = {
    t1: {
      n: 1, name: "Prep templates: the library", page: "lib",
      what: "Where the templates live and how you pick one (F6.1): the built-in starting template, your own, which is the default, and New template. Drawn with three templates: the starting one (the default), Dungeon delve and Town and talk.",
      today: "More, Prep templates: the templates as cards across the top, the chosen one's sections under them, and New session from this template at the right. A phone lists them read only.",
      opts: {
        today: ["Today's cards and editor", "Today's page drawn to the theme."],
        side: ["Templates at the side", "E2's folders at the side: the templates with their counts and Default, the chosen one at the right with its title row and sections."],
        shelf: ["A card per template", "E's shelf cards, each with its kinds as tags and how many sessions it made; a card opens the template as a page."],
        sessions: ["Beside the sessions", "The templates sit in the story's Sessions tab, beside the sessions they make, since that is where a session is planned."],
        panes: ["Templates, the template, its sessions", "Three panes: the templates, the chosen one's sections, and the sessions made from it with Re-apply and New session."]
      }
    },
    t2: {
      n: 2, name: "Prep templates: editing one", page: "edit",
      what: "A template's sections (F6.1's editor): each has a title, a prompt shown while writing, and what it holds (Text, Checklist, Linked pages, Scenes, Clocks, Quests in play, Encounters). They reorder, and the template can be the default.",
      today: "The name, Default for new sessions, Duplicate and Save, then each section as a row of two fields (title and prompt) with its kind and More; Add a section opens a menu of kinds.",
      opts: {
        today: ["Today's rows of fields", "Today's editor drawn to the theme, with Add a section's menu open."],
        outline: ["The prep it makes", "The template drawn as the session page it makes: each section a heading with its prompt in place; Add a section here between them."],
        cards: ["A card per section", "Each section as a card with its number, kind and prompt; drag to reorder; the last card adds one."],
        side: ["Rows, the section at the side", "Compact rows; the chosen section opens in the side column with its title, prompt and what it holds as Base line controls."],
        kinds: ["The kinds at the side", "The seven kinds at the left, each with what it holds; drag one in among the sections, or press it to add at the end."]
      }
    },
    t3: {
      n: 3, name: "Prep templates: a session from one", page: "sess",
      what: "Making the next session from a template, and Re-apply, which gives a session made earlier the sections added to its template since, keeping what was written. Drawn with Dungeon delve, made into session 2, and a Treasure section added later.",
      today: "New session from this template beside the editor (Session, Played on, Template, Copies these sections, Create session 4), and Made from this template with Re-apply on each. A session's More has Re-apply a template.",
      opts: {
        today: ["Today's panel", "Today's panel and list drawn to the theme."],
        dialog: ["A's dialog", "New session from it opens A's dialog: the number, the date, the template as cards, and what it copies."],
        cup: ["One press", "Make session 4 from it is the template's Cup: the session opens at once with the next number; its date is set on the session."],
        sessions: ["From the Sessions tab", "Plan session 4 on the Sessions tab: the template as chips, what it copies, the date, Create session 4."],
        reapply: ["Re-apply shows what it adds", "Re-apply opens A's dialog listing the sections it adds and those it keeps with their writing, before it changes anything."],
        mix: ["Today's panel, and from the Sessions tab", "The owner's mix: the template page keeps today's panel at the right (New session from this template, and the sessions made from it with Re-apply), and the Sessions tab plans the next session with the template as chips."]
      }
    },
    t4: {
      n: 4, name: "The calendar", page: "cal",
      what: "The world's calendar (F4.4): months and their days, eras, the year's suffix, weekdays, and your date. A change that moves dates players can see warns first. Setting your date alone keeps today's small dialog (rule 3).",
      today: "Edit calendar opens one long dialog: Eras, Era suffix, Months as rows, Weekday names, Your date, Save calendar.",
      opts: {
        today: ["Today's dialog", "Today's dialog drawn to the theme."],
        tabs: ["A's dialog in tabs", "The same dialog with Months, Eras, Weekdays and Your date as tabs."],
        page: ["A calendar page", "A page in More: the parts at the side with what each holds now, the chosen part at the right; it saves as you go."],
        year: ["The year drawn", "The months as blocks in a year with their days, your date and the players' lit, eras on a line above, weekdays as chips; a month edits in its block."],
        rows: ["Settings rows", "I's rows: each part with what it holds now and its control at the right, the two dates last."]
      }
    },
    t5: {
      n: 5, name: "A timeline record", page: "rec",
      what: "What opens when you press a record on the timeline (F4.6): its date, session and who sees it, its text, what it links, and Edit, Hide from players and Delete.",
      today: "A's dialog titled with the record's kind, holding its card.",
      opts: {
        today: ["Today's dialog", "Today's dialog drawn to the theme."],
        side: ["In the side column", "The timeline stays; the story's side column turns into the record, with Back (F's swap)."],
        inline: ["Opens under its row", "The record opens under its row on the timeline, the rest moving down."],
        glass: ["A card on glass", "The record on glass beside its day, the timeline still in view."],
        page: ["Its own page", "The record opens as a page with T 2.2's title row and Timeline as its crumb."]
      }
    },
    t6: {
      n: 6, name: "The Codex's tools", page: "tools",
      what: "Download backup, Restore backup, Bring in notes (F6.2), Autosave and Version history (F6.3), from the Codex bar's More. Restore keeps its confirm listing every count.",
      today: "Two pages from the GM menu: Backup (three panels) and Settings (Autosave, Version history, Delete old versions).",
      opts: {
        today: ["Today's two pages", "Today's Backup page drawn to the theme; Settings stays its own page."],
        side: ["One page, the tools at the side", "One Codex tools page: the tools at the side with what each holds now, the chosen one at the right."],
        rows: ["One page of rows", "One page of I's rows under Backup and Saving, each with its control at the right."],
        settings: ["In Settings", "Settings (I) gets a Codex section in its side list; More opens Settings there."],
        cards: ["A card per tool", "E's shelf cards, one a tool, with what it holds now and its controls."],
        mix: ["The tools at the side, in Settings", "The owner's mix: Settings' side list gets a Codex group with each tool as its own row (Backup, Restore, Bring in notes, Autosave, Version history); the chosen tool's rows at the right. The Codex bar's More opens Settings there."]
      }
    }
  };

  function renderIdea() {
    $("#idea").innerHTML = ["t1", "t2", "t3", "t4", "t5", "t6"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">' + "Today" + '</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', P = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML = '<div class="today-strip" ' + W + ">" + E + "On the laptop</p>" + fig("t-templates", "Prep templates") + fig("t-home", "The Codex home with the date bar") + fig("t-calendar", "Edit calendar") + fig("t-yourdate", "Your date") + fig("t-timeline", "The timeline, by month") + fig("t-backup", "Backup") + fig("t-settings", "Settings: autosave and history") + fig("t-pcomp", "A player's Compendium in the Codex") + "</div>" +
      '<div class="today-strip" ' + P + ">" + E + "On a phone</p>" + fig("t-templates-p", "Prep templates") + fig("t-story-p", "The story with the date bar") + fig("t-backup-p", "Backup") + fig("t-settings-p", "Settings") + fig("t-pcomp-p", "A player's Compendium") + "</div>";
    var CI = [
      ["The Codex's frame", "F rule 1, 8", "The Titled bar; More after New holds Prep templates, Backup, Autosave and history."],
      ["A record's title row", "T 2.2, F rule 7", "The name, its line and its one Cup."],
      ["Folders at the side", "E2 2.1", "A list's groups at the left with counts, the chosen one lit."],
      ["Shelf cards", "E 2.1", "A card per thing with its count and a line."],
      ["The side column's swap", "F2 2.3", "The side column turns into the thing, with Back."],
      ["The studio's steps", "G 2.4", "A thing built in parts, each part's answer beside it."],
      ["Settings rows", "I 2.2", "A row a setting: what it is, what it holds now, its control at the right."],
      ["A's menu and dialog", "A, C2", "Menus at the thing; dialogs with the horizon edge; from the foot on a phone."],
      ["The campaign's date", "F rule 6", "VT323 cyan wherever it shows, with whether players have it."],
      ["Hidden reads one way", "F rule 2", "Violet with a dashed edge and an eye struck through."]
    ];
    $("#carried").innerHTML = CI.map(function (c) { return "<div><h3>" + c[0] + '<span class="from">' + c[1] + "</span></h3><p>" + c[2] + "</p></div>"; }).join("");
    var R = [
      ["Prep stays the GM's", "Templates and prep never reach a player, as today.", ""],
      ["A session keeps what was written", "Editing a template never changes the sessions made from it; Re-apply only adds sections and keeps the writing.", ""],
      ["Your date keeps its small dialog", "Pressing your date in the date bar opens today's Your date as A's dialog: year, month, day and how it reads.", ""],
      ["Restore asks first", "Restore backup keeps today's confirm with every section's count; nothing changes on a bad file.", ""],
      ["The Codex's Compendium reads as the Compendium", "A player's Compendium in the Codex takes G's three panes, read only, with no monsters, as today's tables do.", "Today it is one table with filters above it."],
      ["Nothing new in what the controls do", "Every template, calendar, record, backup and history action keeps today's routes and words.", ""],
      ["Phones", "Templates read and start sessions on a phone; the calendar and the tools work there too; 44 px hit areas.", "Today a phone cannot edit a template."]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
