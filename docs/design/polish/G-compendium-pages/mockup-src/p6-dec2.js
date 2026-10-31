  /* ---------- G round 2's decisions, and the Atlas check ---------- */
  DEC = {
    g1: {
      n: 1, name: "Sources", page: "sources",
      what: "Where the Compendium's records come from (G4): the SRD, this table's homebrew and imported packs, how many each has, published and shared, whether pickers offer them, and Import a pack and Export a selection. Drawn with the SRD, this table's four records and one imported pack.",
      today: "A table of sources (records, published, shared, credit, in pickers) under Import a pack and Export a selection, then Needs you and By kind further down.",
      opts: {
        today: ["Today's table", "Today's page drawn to the theme."],
        shelf: ["A card per source", "Each source as a shelf card (E 2.1) with its count large, what is published and shared, In pickers, and More; Import a pack as the last card."],
        rail: ["Sources at the side", "Like the folders (E2): the sources at the left, the chosen one at the right with its kinds, In pickers, Export and what needs you."],
        kinds: ["By kind", "One table: each kind a row, each source a column, with drafts, shared and In pickers along the foot."],
        dash: ["A dashboard", "F's dashboard: Sources, By kind, Needs you and the last import as groups side by side."]
      }
    },
    g2: {
      n: 2, name: "Sharing", page: "sharing",
      what: "Who can open which homebrew record (G5): hidden, everyone, or chosen characters. The SRD is open to everyone. Drawn with four homebrew records: an item sent to Lyra, a spell for everyone, a draft monster and a hidden feat.",
      today: "Who sees what: the published records as a list with Tick records to set them together; the chosen record's row at the right.",
      opts: {
        today: ["Today's list and row", "Today's page drawn to the theme, the chosen record at the right."],
        grid: ["Records by character", "One grid: each record a row, Everyone and each character a column with a box."],
        rail: ["Kinds at the side", "The kinds at the left with Shared and Hidden, the records as rows with who sees it as a Base line control, and Choose for several."],
        chars: ["Characters at the side", "Everyone and each character at the left; the chosen one's records at the right, with Take back and Share a record."],
        panes: ["Records and the record", "G's panes: the kinds, the records, and the chosen record's sharing."]
      }
    },
    g3: {
      n: 3, name: "A record's history", page: "history",
      what: "A homebrew record's versions (G6): when each was saved, on which device, what changed, restoring one, and how the copy differs from the SRD record it was made from.",
      today: "The History tab: a table of versions (version, when, device, what changed), Based on with Open the SRD record, and Compare with the SRD as a table of the fields that differ.",
      opts: {
        today: ["Today's tab", "Today's tab drawn to the theme."],
        rows: ["Compact rows, as the Codex's", "F2's version history: one line a version in a side column; choosing one shows the record as it was under the cyan line, with Restore this version."],
        line: ["A line of versions", "The versions as marks on a line; the chosen one's changes under it, then the SRD comparison."],
        diff: ["What each changed", "Each version as a group of the fields it changed, the old struck through and the new in cyan, with Restore."],
        compare: ["Side by side", "The SRD record (or an earlier version) and this copy side by side, the differences lit."]
      }
    },
    g4: {
      n: 4, name: "When two devices changed it", page: "merge",
      what: "When another device saved the same record while you edited it (G6's merge): which fields differ, and keeping yours or theirs for each. Drawn with hit points and the Grey Palm. bonus action changed on both.",
      today: "A panel in the editor: each differing field as a row with this device's value and the other's, a choice for each, and save.",
      opts: {
        today: ["Today's panel", "Today's rows with a choice each, drawn to the theme."],
        rows: ["Mine and theirs as cards", "Each field as two cards side by side, Keep this on each, Keep all mine and Take all theirs at the head."],
        inline: ["At each field", "The editor itself, each field that differs edged amber with the other device's value under it and Use theirs."],
        dialog: ["A's dialog", "A's dialog before saving: each field with Mine and Theirs as choices."],
        side: ["In the side column", "The record stays; a side column lists the fields that differ with Mine and Theirs, and Save the record."]
      }
    },
    g5: {
      n: 5, name: "A record's sharing", page: "rshare",
      what: "Sharing one homebrew record (G6's Sharing tab): hidden, everyone or chosen characters, sent or not, and what players read of it. A monster's stat block never reaches players.",
      today: "The Sharing tab: Hidden, Everyone and Characters as a control, a box for each character with Not sent, and the line about stat blocks.",
      opts: {
        today: ["Today's tab", "Today's tab drawn to the theme."],
        chips: ["Who as chips", "Hidden, Everyone and each character as Base line chips in one row."],
        side: ["In the side column", "Like revealing in the Codex (F2): the side column turns into Share, with who, what they will read, and the Cup."],
        menu: ["A's menu at Share", "Share in the record's head opens A's menu with a check for Everyone and each character."],
        rows: ["One row a player", "Each character a row with a lamp for whether they have it, Send or Take back."]
      }
    }
  };

  function renderIdea() {
    $("#idea").innerHTML = ["g1", "g2", "g3", "g4", "g5"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">' + "Today" + '</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', P = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML = '<div class="today-strip" ' + W + ">" + E + "On the laptop</p>" + fig("t-sources", "Sources") + fig("t-sharing", "Sharing, with nothing published yet") + fig("t-history", "A homebrew copy's History") + fig("t-rsharing", "A homebrew copy's Sharing") + fig("t-search", "Search the SRD and homebrew (Ctrl K)") + "</div>" +
      '<div class="today-strip" ' + P + ">" + E + "On a phone</p>" + fig("t-sources-p", "Sources") + fig("t-history-p", "History") + fig("t-rsharing-p", "Sharing") + "</div>";
    var CI = [
      ["The Compendium's frame", "G rule 1", "Compendium's Titled bar with its pages; Search the SRD and homebrew is its field and New homebrew its Cup."],
      ["Three panes and open tabs", "G 2.2", "Filters, results and the record, the open records as tabs."],
      ["A record's head", "G 2.3", "Its name, kind, source and state, its stats, Edit and Publish, and its sections."],
      ["Folders at the side", "E2 2.1", "A list's groups at the left with their counts, the chosen one lit."],
      ["Version history", "F2 2.5", "One compact line a version; reading one under a cyan line with Restore."],
      ["Revealing in the side column", "F2 2.4", "Who sees it, what they will read, and the Cup, in the side column."],
      ["Hidden reads one way", "F rule 2", "Violet with a dashed edge and an eye struck through."],
      ["Shelf cards and the dashboard", "E 2.1, F 2.1", "A card per thing; groups side by side."],
      ["A's menu and dialog", "A, C2", "Menus at the thing; dialogs with the horizon edge; from the foot on a phone."],
      ["Controls", "T 2.5", "Base line controls and chips; chosen on cyan; the Cup for the one primary."],
      ["Numbers in VT323", "G 3.6", "Counts, versions and stats."]
    ];
    $("#carried").innerHTML = CI.map(function (c) { return "<div><h3>" + c[0] + '<span class="from">' + c[1] + "</span></h3><p>" + c[2] + "</p></div>"; }).join("");
    var R = [
      ["Search is A's dialog", "Ctrl K and Search the SRD and homebrew open A's search dialog looking in the Compendium (A 2.3), as the Codex's does (F2 rule 1).", "Today the Compendium has its own search dialog."],
      ["Picking a record is search", "A homebrew field that links a record (the catalog picker, G11) opens A's search dialog in the Compendium, offering only that kind.", "Today the picker is its own list."],
      ["Every kind edits in the studio", "Spells, items, feats and the other kinds take the studio's frame (G 2.4): each step's answer in its rail.", ""],
      ["Import and export are A's dialog", "Import a pack's review (what it adds, what clashes) and Export a selection open as A's dialog, as today's do.", ""],
      ["Stat blocks stay with the GM", "Sharing a monster shares its name, look and description; players never get its stat block, as today.", ""],
      ["Nothing new in what the controls do", "Every import, export, publish, share, restore and merge keeps today's routes and words.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
