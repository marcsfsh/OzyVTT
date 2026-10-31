
  /* ---------- What each option means ---------- */
  var DEC = {
    d1: {
      n: 1, name: "Prep's front page", page: "front",
      what: "What Prep opens on (E1.1) and the encounter list (E1.2). This campaign has six encounters: three prepared, two drafts and one that has ended.",
      today: "New map and New encounter as two large buttons, a Maps and Encounters toggle, filters, then a table of encounters with State, Progress, Map, Tokens, Light, Codex and Modified.",
      opts: {
        list: ["List", "Today's table drawn to the theme: one line of description, a toolbar (the count, the states as chips, the order, New map), then one row per encounter with its map, who is in it, whether it is ready, and when it changed."],
        tonight: ["Up next", "A page for the next session: the first prepared encounter large, with its map, who is in it, what is ready and Make live; the other prepared ones, the drafts and what has ended under it."],
        shelf: ["Shelf · chosen", "The encounters as cards, four to a row, each led by its map. It reads like a stack of battle maps."],
        split: ["Split", "The list at the left and the chosen encounter at the right: its map, who is in it, what is ready, Open and Make live, without leaving the list. A phone shows the list."],
        order: ["Running order", "The encounters in the order you plan to run them, numbered and dragged to reorder. The first prepared one carries Make live; what has ended folds away at the end."],
        board: ["Board", "Three columns by state, Draft, Prepared and Ended, with each encounter as a card. A phone shows one column at a time."]
      }
    },
    d2: {
      n: 2, name: "An encounter's page", page: "enc",
      what: "One encounter while you prepare it (E1.3): its map and tokens, who is in it, its rules, light and sound, and Make live.",
      today: "A title row, a tool rail at the left, the staging tray over the map, and a panel at the right with Combat, Setup and Tokens tabs and Make live at its foot.",
      opts: {
        bench: ["Workbench · chosen", "The table's own frame (C): the tools in a dock at the left, the map with its tray chip, and a 380 px panel with Who is in it, Rules, and Light and sound, Make live at its foot. Preparing looks like playing."],
        doc: ["Document", "A record that reads top to bottom: the title row with Make live, a line of what is ready, the map as a picture with Open the map, then who is in it and its rules side by side."],
        check: ["Checklist", "What makes it ready down the left (map, grid, who is in it, light, sound, rules), each with its answer; the chosen one's settings in the middle; the map at the right. Make live at the foot of the list."],
        mapfirst: ["Map first", "The map fills the page; the title, the tools, who is in it and Make live float over it in glass."],
        tabs: ["Tabs", "The title row with Make live, then tabs: Overview, Map, Who is in it, Rules, Light and sound. The overview shows the map, what is ready, who is in it and your notes."],
        side: ["Side column", "One column at the left holds everything you set, with Make live at its foot; the map takes the rest, its tools floating at its edge."]
      }
    },
    d3: {
      n: 3, name: "Making an encounter", page: "new",
      what: "Making a new encounter (E1.4). Today it is five steps: Map, Tokens and monsters, Walls and light, Sound, and Review and make live.",
      today: "A steps rail at the left, the step's form, and the map at the right, with Back and Next at the foot.",
      opts: {
        steps: ["Steps", "Today's steps drawn to the theme (T rule 4): the rail with each answer under its step, the step in the middle, the map at the right, and Next naming the next step as the Cup."],
        quick: ["Quick start", "A dialog asks only the name, the map and who is in it, then makes the encounter and opens its page, where walls, light, sound and rules live."],
        onepage: ["One page", "No steps: name and map, who is in it, light and sound as groups on one page, the map at the right and Save in the title row."],
        draft: ["Draft page · chosen", "New encounter makes an untitled draft at once and opens its page, which lists what is left to make it ready and starts with picking a map."],
        gallery: ["Map gallery", "It starts from the maps: pick one from a gallery of your maps or upload one, then who is in it, then its page."],
        sheet: ["Side sheet", "The steps open in a sheet at the right over the list, in three short steps: Map, Who is in it and Review."]
      }
    },
    d4: {
      n: 4, name: "Setting a map's grid", page: "grid",
      what: "Telling OzyVTT how big a square is on a map (E2.3), so tokens snap and rulers measure.",
      today: "A four-step editor (Upload, Grid, Check the alignment, Name and use). Grid offers a printed square grid or none; you drag across a three by three block of printed squares.",
      opts: {
        wizard: ["Steps · chosen", "Today's flow drawn to the theme: the rail, the choice between printed squares and none, the instruction, and the map with your marked block and the grid it makes."],
        drag: ["Drag a square", "One screen: the map fills it, one line says to drag across three squares, the grid appears as you drag, and a bar at the foot nudges the size and saves."],
        points: ["Two points", "Tap two grid corners on one line and say how many squares lie between them. It works on maps whose grid is faint or partly covered."],
        count: ["Count squares", "Count the printed squares across and down; the grid fits itself to the image, with arrows to nudge it. No dragging."],
        sliders: ["Sliders", "Move the grid by hand: square size, left edge and top edge as sliders with their numbers, until the lines sit on the printed ones."],
        inline: ["On the map page", "No separate editor: the map's own page opens its Grid group in place, with the way to set it, the size and Save, beside the map."]
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
      '<div class="today-strip" ' + W + ">" + E + "Laptop</p>" + fig("front", "Prep's front page") + fig("enc", "An encounter's page") + fig("new", "New encounter: Map") + fig("newtokens", "New encounter: Tokens and monsters") + fig("review", "New encounter: Review and make live") + fig("maps", "Maps") + fig("map", "A map's page") + fig("grid1", "Setting the grid: the choice") + fig("grid2", "Setting the grid: marking squares") + "</div>" +
      '<div class="today-strip" ' + W + ">" + E + "Phone</p>" + fig("front-phone", "Prep's front page") + fig("enc-phone", "An encounter's page") + fig("map-phone", "A map's page") + "</div>";
    var R = [
      ["One Cup in Prep's bar", "New encounter is the bar's Cup on Prep's lists. On a record (an encounter, a map) it steps down to a Base line control, so the record's own action (Make live, Use this grid, Save) is the only Cup.", "Today the front page has New map and New encounter as two large buttons."],
      ["Ready in one set of words", "Every encounter says Ready to go with a cyan lamp, or what is missing in amber (No grid yet, 6 tokens in the tray), in the words today's Ready to go list uses, each with Go to it where it opens.", ""],
      ["Four states", "Draft, Prepared, Live and Ended as VT323 tags. Only Live is lit.", ""],
      ["The map leads", "Wherever an encounter or a map is listed, its map is the thumbnail, 16 by 10, never stretched.", ""],
      ["The map is the table's map", "Preparing uses the table's map (C): the same tools, tray chip and map controls, so what you set is what the table shows.", ""],
      ["Maps and Encounters are two pages", "The toggle between Maps and Encounters on today's front page goes; each has its own page in the bar.", "Today both pages show the toggle under the two buttons."],
      ["The other lists follow", "Maps, Tokens and Replays take the front page's chosen pattern for their toolbar and rows. Their own details come in E2 and E3's rounds.", ""],
      ["Dialogs", "Duplicate, rename, delete and the confirm before making an encounter live use A's Dialog pattern.", ""],
      ["On a phone", "The pages run under Prep's header as a strip of words (T 2.1). Lists become rows led by the map; an encounter's map follows C's phone Switch; Make live is pinned above the tabs.", ""],
      ["Left for later", "The tokens page, the sound board, replays, the map list's own details, and the map's walls, light and fog tools come in E2 and E3's rounds and C2.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
