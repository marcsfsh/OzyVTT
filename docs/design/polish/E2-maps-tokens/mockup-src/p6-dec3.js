  /* ---------- E2's decisions, approved ---------- */
  var CHOSEN6 = { x1: ["rail"], x2: ["panes"], x3: ["menu", "select"], x4: ["groups"], x5: ["panes"] };
  DEC.x2.opts.panes = ["Beside the list, in the folders", "The folders at the left, the chosen folder's maps in a list beside them, and the chosen map's page at the right: its title row, the map, and Grid, Type and folder, and Where it is used. On a phone, the folders as chips and the map opening under its row."];
  DEC.x3.opts.menu = ["In its menu", "A's menu on a map's card files it: the folders with the current one marked, Move to a new folder and Take out of its folder. Choose in the toolbar files several (the next option)."];
  DEC.x3.opts.select = ["Choose several", "Choose in the toolbar puts a box on each card; the bar at the foot moves the chosen maps to a folder. A map's own menu files one."];
  DEC.x4.opts.groups = ["Party, Monsters and your groups", "The creatures in groups: Party and Monsters always, and any group the GM makes with New group. A row's menu moves a creature to another group; a group the GM made can be renamed or deleted."];
  DEC.x5.opts.panes = ["Folders and a preview", "A wide dialog: the folders at the left, the library in the middle, the token as it will look at the right with Use for {name}. On a phone, from the foot, the preview on top."];

  function renderIdea() {
    $("#idea").innerHTML = ["x1", "x2", "x3", "x4", "x5"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + (CHOSEN6[k].indexOf(S[k]) >= 0 ? " · chosen" : " · turned down") + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  var renderStatic0 = renderStatic;
  renderStatic = function () {
    renderStatic0();
    var R = [
      ["Nothing new in what the controls do, but groups", "Every command and route stays: upload, rename, type, folder and grid for a map; setting a token's image and offering an image to players. The one new thing is the GM's token groups (next rule), which need a stored value and their commands. Who sees an image stays the server's; a player's picker lists only what they are offered and their own uploads.", ""],
      ["Token groups", "Party (the characters) and Monsters (everyone else) are always there and cannot be renamed or deleted. New group adds one by name; a creature moves to it from its row's menu. Renaming keeps its creatures; deleting a group returns them to Party or Monsters by their kind. Groups are the GM's alone: players and the table screen never receive them.", "Today the Tokens page is one flat list."],
      ["Folders in one place", "The folder list at the side is where maps are filed and found: each folder with its count, New folder at its foot. A map's menu and Choose both move maps between the same folders.", "Today folders live in the Folder column and the row's menu."],
      ["One Cup", "New encounter is the bar's Cup on Prep's lists; with a map open beside the list it steps down, and the page's own actions are Base line controls (E rule 1).", ""],
      ["A missing grid is said once", "\"No grid yet\" in amber wherever a map is listed or shown, with Set the grid where it opens.", ""],
      ["A token looks as it does on the map", "Wherever a creature's picture shows (rows, the picker's preview), it is drawn as its token: round, in the party's or the foe's ring.", "Today the Tokens page names the picture in words."],
      ["Players and the library", "An image players are offered carries the cyan eye; the rest carry it struck through, and a player's picker leaves them out.", ""],
      ["Phones", "Folders become a row of chips over the list; a map opens under its row; menus, the Choose bar and the picker open from the foot; every control keeps a 44 px hit area.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  };
