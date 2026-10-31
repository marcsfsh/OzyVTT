  /* ---------- E2's decisions ---------- */
  DEC = {
    x1: {
      n: 1, name: "The map list", page: "maps",
      what: "Prep's Maps page (E2.1): every map in the library with its picture, whether its grid is set, its folder and the encounters that use it. This campaign has six battle maps, five of them in two folders. E rule 7 gave it the shelf's toolbar meanwhile.",
      today: "A table with a small picture, Name, Type, Grid, Size, Folder, Used in, Modified and a ⋯ menu, under Filters, Type, Modified and Sort; on a phone, rows with the picture, the name and the grid.",
      opts: {
        table: ["Today's table", "Today's columns drawn to the theme: the picture first, the grid with its lamp, the encounters that use it, and More."],
        shelf: ["The shelf", "E's shelf: map cards four to a row, the picture leading, the folder as a tag, the grid and the encounter that uses it."],
        folders: ["The shelf by folder", "The same cards under each folder's head as open groups: Act 1, Act 2, No folder."],
        rail: ["Folders at the side", "A folder list at the left with each count and New folder, where G's filters sit; the shelf, three to a row, at the right."],
        rows: ["Rows with pictures", "One map a row with a wide picture, its grid, type and size, the encounters that use it, and its folder as a chip."]
      }
    },
    x2: {
      n: 2, name: "A map's page", page: "map",
      what: "One map (E2.2): its picture, its grid, its type and folder, the encounters and atlas maps that use it, its file, and what comes next: setting the grid again, starting an encounter on it, renaming or moving it.",
      today: "The title row with the type and ⋯; View; the map at the left; at the right Grid with Edit, Type and folder as two fields, Where it is used, and File and history; Set the grid as the main button while it has none.",
      opts: {
        today: ["Today's page", "Today's page drawn to the theme with E's title row: the map at the left and its sections in a 380 px column."],
        bench: ["The workbench", "Like an encounter's page (E 2.2): the tools in a dock, the map, and a panel with Grid, Used in and File over New encounter on this map."],
        record: ["The record", "G's record: the picture as a banner, the facts in one line with VT323 numbers, then Grid, Type and folder, and Where it is used side by side."],
        panes: ["Beside the list", "The list stays at the left and the chosen map opens at the right, as G's panes do; on a phone, under its row."],
        uses: ["What uses it first", "The encounters that use it lead as cards, with New encounter on this map beside them; the picture, grid and folder sit at the right."]
      }
    },
    x3: {
      n: 3, name: "Folders", page: "folders",
      what: "Filing a map in a folder (E2.1, E2.2), drawn as Ruined keep moves from Act 1 to Act 2. The token library's folders work the same way.",
      today: "The row's ⋯ menu lists Move to a new folder, Move to {folder} for each other folder, and Take out of its folder; the map's page has a Folder field with New folder….",
      opts: {
        menu: ["In its menu", "Today's: A's menu on the card lists the folders, the current one marked, with Move to a new folder and Take out of its folder."],
        field: ["On its page", "Only the map's page: its Folder field opens A's menu of folders."],
        drag: ["Drag onto a folder", "The toolbar lists the folders as Base line chips; a card dragged onto one moves there, and its menu stays for keyboards."],
        select: ["Choose several", "A Choose mode puts a box on each card; a bar at the foot moves, re-grids or deletes the chosen ones."],
        chips: ["The folder on the card", "Each card names its folder as a Base line chip at its foot; pressing it opens A's menu of folders."]
      }
    },
    x4: {
      n: 4, name: "The tokens page", page: "tokens",
      what: "Prep's Tokens page (E3.1): every creature at the table with the picture its token shows, and the way to change it. The library holds eight images in two folders; Mirena and the Goblin Warrior show the default picture.",
      today: "A table of Name, Kind, Picture (\"Default picture\" or the image's name) and Set token image…; on a phone, rows of the name, kind and picture.",
      opts: {
        table: ["Today's table", "Today's rows drawn to the theme, each with its token as the map shows it."],
        faces: ["Faces", "Each creature as its token, large, with its name and its picture's name; pressing one opens the picker."],
        groups: ["Party and monsters", "The party and the monsters in encounters as two open groups of rows."],
        library: ["The library", "The page is the image library: every image with who shows it and whether players are offered it; who has no picture is named at the top."],
        panes: ["Two panes", "The creatures at the left and the chosen one's picture with the library at the right, so choosing needs no dialog; on a phone, under its row."]
      }
    },
    x5: {
      n: 5, name: "The token picker", page: "picker",
      what: "Choosing a token's picture (C6.8), from the Tokens page, the token's menu, the Token tab, the sheet and Settings: search, folders, what was used before, the library with which images players are offered, and Upload an image.",
      today: "A dialog, Token image · {name}: search, a folder menu, Upload into folder, Previously used, the library as boxed tiles each with an eye for players, and Done.",
      opts: {
        dialog: ["A's dialog", "Today's dialog drawn to the theme; on a phone, from the foot."],
        side: ["A side sheet", "A sheet from the right edge with the same parts in one column, the page left in view."],
        row: ["Under its row", "The picker opens under the creature's row, as a cast's choices do (C6); from the map, in the token's menu."],
        panes: ["Folders and a preview", "A wide dialog: the folders at the left, the library in the middle, the token as it will look at the right with Use for Borin."],
        recent: ["Theirs first", "The dialog leads with what this creature used before and Upload; the whole library folds under it."]
      }
    }
  };

  function renderIdea() {
    $("#idea").innerHTML = ["x1", "x2", "x3", "x4", "x5"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', P = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML = '<div class="today-strip" ' + W + ">" + E + "Maps on the laptop</p>" + fig("t-maps", "The Maps page") + fig("t-map", "A map's page") + "</div>" +
      '<div class="today-strip" ' + W + ">" + E + "Tokens on the laptop</p>" + fig("t-tokens", "The Tokens page") + fig("t-picker", "The token picker") + "</div>" +
      '<div class="today-strip" ' + P + ">" + E + "On a phone</p>" + fig("t-maps-p", "The Maps page") + fig("t-map-p", "A map's page") + fig("t-tokens-p", "The Tokens page") + "</div>";
    var CI = [
      ["Prep's frame", "E 2.1, rules 6 and 9", "Prep's Titled bar with its pages and New encounter as its Cup on lists; on a phone, a strip of words."],
      ["The shelf", "E 2.1", "Cards from 270 px, 16 px apart, the picture 16 by 10, a tag at the top left."],
      ["The record's title row", "E 2.2, T 2.2", "A crumb, the name in display capitals with its tag, one line, the actions as Base line controls."],
      ["The map leads", "E rule 4", "Wherever a map is listed, its picture leads, 16 by 10, never stretched."],
      ["Ready in one set of words", "E rule 2", "\"No grid yet\" in amber with its lamp; a set grid lit cyan."],
      ["Panes", "G", "The list and a record side by side."],
      ["Under its row", "C3 2.2, C6", "What belongs to one row opens under it and closes with it."],
      ["A's menu and dialog", "A, C2", "Menus at the thing; dialogs from the foot on a phone."],
      ["Controls", "T 2.5", "Base line controls; fields keep their box; chosen on cyan."],
      ["Numbers in VT323", "G 3.6", "Grid sizes, picture sizes and counts."]
    ];
    $("#carried").innerHTML = CI.map(function (c) { return "<div><h3>" + c[0] + '<span class="from">' + c[1] + "</span></h3><p>" + c[2] + "</p></div>"; }).join("");
    var R = [
      ["Nothing new in what the controls do", "Every command and route stays: upload, rename, type, folder and grid for a map; setting a token's image and offering an image to players. Who sees an image stays the server's; a player's picker lists only what they are offered and their own uploads.", ""],
      ["One Cup", "New encounter is the bar's Cup on Prep's lists; on a map's page it steps down, and the page's own action is the only Cup (E rule 1).", ""],
      ["A missing grid is said once", "\"No grid yet\" in amber wherever a map is listed or shown, with Set the grid where it opens.", ""],
      ["A token looks as it does on the map", "Wherever a creature's picture shows (rows, faces, the picker's preview), it is drawn as its token: round, in the party's or the foe's ring.", "Today the Tokens page names the picture in words."],
      ["Players and the library", "An image players are offered carries the cyan eye; the rest carry it struck through, and a player's picker leaves them out.", ""],
      ["Phones", "Lists run two to a row or one a row; dialogs and menus open from the foot; every control keeps a 44 px hit area.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
