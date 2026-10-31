
  /* ---------- What each option means ---------- */
  var CHOSEN = { d1: "rail", d2: "row", d3: "moment", d4: "rows" };
  var DEC = {
    d1: {
      n: 1, name: "The settings frame", page: "home",
      what: "How Settings opens and how you move between its sections (Players, Encounters, Characters, Device, Access and API), and how you find one setting by its name. The frame (A) put Settings in the GM's menu; this is the page it opens.",
      today: "A boxed strip of the six sections with their icons, Search settings with Ctrl K at the right, and the section's own button beside it. Each section is a heading with GM ONLY, then one box of rows. The search opens a list under the field; a pick opens the section and flashes the row.",
      opts: {
        bar: ["Titled bar", "Today's frame drawn to the theme: T's Titled bar with Settings, the sections as words, Search settings and the section's own button as the Cup. One column of rows under it. On a phone, a header and a strip of the sections."],
        rail: ["Side list", "The sections as a list at the left with the search at its top, drawn as every side list is (ADR-0071): each section a row with its icon and a count, then the Codex's tools. What a section holds now sits in its own head. On a phone the list is the first page and a section opens with Back."],
        onepage: ["One page", "Every section on one page, one after the other, with an index at the left that lights the section in view. The search filters the page in place: only the matching rows stay, under their sections, with their controls."],
        home: ["Home of cards", "Settings opens on a home of six cards, each with the section's name, its line and what it holds now. A card opens its section with a crumb back. The bar keeps the search."],
        search: ["Search first", "A wide search band under the bar (\"Search 31 settings: a name, or what it does\"). Typing shows the matching rows from every section in place, grouped by section, with their controls live."],
        who: ["By who it touches", "The sections in a list at the left in three groups: This table (Players, Encounters, Characters, for everyone at it), This device (only this browser), and Access and tools (other GM browsers and integrations)."]
      }
    },
    d2: {
      n: 2, name: "How one setting reads", page: "device",
      what: "The pattern every setting follows: its name, a line about it, and its control. Drawn on Device (which a player sees too) and Characters.",
      today: "Rows in one box with a violet edge: the name, a line, and the control at the right; wide controls (the ability methods, the join address) under the line. Switches carry their own label. Some rows add a second line under the control.",
      opts: {
        row: ["Row, control at right", "Today's rows drawn to the theme: T's Group, the name and its line at the left, the control at the right, wide controls under. On a phone the control goes under the line."],
        cols: ["Two columns", "Like a form: every name and line in a column at the left (300 px), every control in a column at the right, lined up down the page, with a hairline between rows."],
        effect: ["Says what it does", "In place of a fixed line, each row says what its current choice does (\"Auto-roll: the app rolls your dice.\"), and the line changes as the choice changes."],
        cards: ["Cards", "Each setting is a card in a grid of two: its name, its line, and its control at the card's foot. Wide controls take a whole row."],
        sentence: ["Sentences", "Each setting reads as a sentence with its choice inside it as a menu: \"This device shows Dusk.\" \"Players build and level their own characters, up to level 20.\""],
        changed: ["Changed from the default", "Today's rows, and a row you changed carries a cyan mark at its left with its default and Reset. The section's head says how many are changed, with Show only changed."]
      }
    },
    d3: {
      n: 3, name: "The encounter rules", page: "fights",
      what: "Encounters, the longest section: the rules assistant and its six checks, players' hits, initiative, d20 rolls and damage, who picks targets, the health display and new tokens.",
      today: "One box of eight rows. The rules assistant has three lines under its control and a box of six switches; the d20 and damage rows each add a line under their control.",
      opts: {
        list: ["One list", "Today's eight rows in the order they are now, drawn in the chosen row (2)."],
        presets: ["Presets", "Three ways to run a table as cards at the top (By the book, Trust the table, Hands off) and Custom, lit when your choices match none; a preset sets the eight rows at once. The rows follow under Fine tune. Presets are new: they write today's settings, nothing else."],
        moment: ["By moment", "The same rows grouped by when they matter: when a token is staged, when dice are rolled, on a player's turn, and when a hit lands."],
        split: ["Rules and dice", "Two columns: the rules (the assistant and its checks, who picks targets, players' hits, initiative) at the left, and dice and tokens (d20 rolls, damage, the health display, new tokens) at the right."],
        assist: ["The assistant first", "The rules assistant as three large choices with what each does, its six checks as chips you light, then the rest in two columns."],
        story: ["A turn, told", "The rows at the left; at the right a player's turn told from your current choices (\"She types what her d20 shows; the app adds +7.\"), with the words that come from a setting lit. It changes as you choose."]
      }
    },
    d4: {
      n: 4, name: "Access and credentials", page: "access",
      what: "Access: the GM password, signing out, signing out every GM browser, and the integration credentials a tool uses to reach the table, with the dialog that makes one. The API reference (I7) is left for later.",
      today: "Three rows of buttons (Change GM password, Sign out, Sign out every GM browser in red), then the credentials as a table (name, scopes, state, last used, expires, Rotate, Revoke, History). New credential is the section's button; its dialog lists fourteen scopes as switches.",
      opts: {
        rows: ["Rows", "Today's page drawn to the theme: the three rows, then the credentials' table in its own row; the dialog keeps the fourteen switches."],
        cards: ["Credential cards", "The three rows, then each credential as a card with its lamp, state, scopes, when it was last used and when it expires, and Rotate, Revoke and History; New credential is the last card."],
        danger: ["Danger at the foot", "Three groups: This browser (password, sign out), Tools that reach this table (the credentials), and at the foot, with a red edge, If a device is lost: Sign out every GM browser."],
        grid: ["Scopes as a grid", "Today's page, and the new credential's scopes as a grid of what it reaches (the game, characters, encounters, combat, rolls, the Codex) by Read and Change, with admin set apart."],
        recipes: ["Start from a use", "A new credential starts from what the tool is for: Stream overlay, Dice bot, Codex sync, or Pick scopes yourself; a use picks its scopes. The list says what each credential is for."],
        twocol: ["Two columns", "Signing in at the left (password, sign out, every GM browser) and the credentials at the right; New credential opens in the right column in place of the list."]
      }
    }
  };
  function renderIdea() {
    $("#idea").innerHTML = ["d1", "d2", "d3", "d4"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + (S[k] === CHOSEN[k] ? " · chosen" : " · turned down") + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML =
      '<div class="today-strip" ' + W + ">" + E + "The sections</p>" + fig("players", "Players") + fig("fights", "Encounters, the whole page") + fig("characters", "Characters") + fig("device", "Device") + "</div>" +
      '<div class="today-strip" ' + W + ">" + E + "Finding and access</p>" + fig("search", "Search settings") + fig("qr", "The join address's QR code") + fig("access", "Access") + fig("cred", "New credential") + fig("api", "API") + "</div>" +
      '<div class="today-strip" ' + W + ">" + E + "Phones</p>" + fig("players-phone", "Players on a phone") + fig("fights-phone", "Encounters on a phone") + fig("device-phone", "Device on a phone") + "</div>";
    var R = [
      ["Settings keeps its sections and its words", "Players, Encounters, Characters, Device, Access and API, with today's names, lines and choices, which the encounter's own options share (one setting, one name). No setting is added or removed.", ""],
      ["A change saves when it is made", "As today, each choice writes at once; the row shows Saved for a moment, and a failed write puts the choice back and says why.", ""],
      ["GM only, where it helps", "The GM's sections are never shown to a player, so their heads drop the GM ONLY tag. It stays on a GM row inside a section players see (Device's Arrange new encounters).", "Today every GM section's heading carries GM ONLY."],
      ["The player's Settings", "A player's Settings is Device alone, with no section bar, and Leave the table as its last row, as today. The frame's menu also holds Leave the table.", ""],
      ["Search finds a setting by what it does", "The search reads each setting's name, its line and its other words, and a pick opens the section with the row lit, as today.", ""],
      ["One kind of control for one kind of choice", "Two to four short choices are Base line options; on and off is a switch with its own label; a longer list is a menu; a number is a stepper. On a phone, options that do not fit become a list of choices.", ""],
      ["Danger reads red and asks first", "Sign out every GM browser and Revoke are red, and each asks before it acts, as today.", ""],
      ["The join address is the first thing", "Players leads, as today, because the join address is what the GM opens at every session. Its QR code shows beside the address on a laptop.", "Today the QR code waits behind Show QR code."],
      ["Left for later", "The API reference and an operation's page (I7), Players' At the table actions, and the credential's History take this frame now and their own design later.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
