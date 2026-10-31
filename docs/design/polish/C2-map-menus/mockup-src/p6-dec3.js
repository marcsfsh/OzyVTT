
  /* ---------- C5's decisions ---------- */
  var CHOSEN3 = { l1: "lines", l2: "card", l3: "line", l4: "sheet", l5: "list" };
  DEC.l1 = {
    n: 1, name: "The log", page: "log",
    what: "The log the GM and the players read (C5.1): turns, rolls, hits, talk and whispers, in the panel's Log tab (and a player's Log on a phone). It is read, not filled in, so it is an open group (T 2.3).",
    today: "One flat list, newest at the foot: turn lines, rolls as boxed cards, plain lines for everything else, chat with its author; no GM-only mark on what players cannot see, and no grouping or filters.",
    opts: {
      list: ["One list", "Today's list drawn to the theme: one entry a row on a hairline, rolls drawn as the round's roll (2), turn lines as small capitals, the current turn in amber."],
      turns: ["By turn", "Entries gathered under each turn's head (the creature's face and name, as the order's row), the current turn lit as the acting row is."],
      lines: ["One line each", "Every entry one line of 34 px: who and what, the total at the right in VT323; the dice show when a line is pressed."],
      latest: ["Latest roll on top", "The newest roll the reader may see stands at the top, as the TV shows it (H 2.1), and the log runs under it."],
      filter: ["With filters", "Base line chips over the list with counts: All, Rolls, Talk and Turns for the GM; All, Rolls, Talk and Mine for a player."]
    }
  };
  DEC.l2 = {
    n: 2, name: "One roll in the log", page: "roll",
    what: "How one roll reads (C5.1): who and what, the total, the dice (a kept and a dropped die for advantage), the formula, a natural 20, and a GM-only roll.",
    today: "A box: who and the label, a big total, each die in a small box (a dropped die struck through), and the formula. No NAT 20 mark and no mark on a GM-only roll in the log.",
    opts: {
      card: ["Card", "Today's card drawn to the theme, with the NAT 20 and GM ONLY tags."],
      row: ["Row", "The Ledger's row (D1): who and what at the left with the dice and formula under it in VT323, the total at the right. No box: the log is read."],
      tv: ["As the TV shows it", "The TV's latest roll (H 2.1): who and what in small capitals, the total large, the dice in words (d20 18 (9) + 7)."],
      dice: ["Dice first", "The dice as they fell, the kept one lit cyan and the dropped one struck, then + 7 = 25."],
      first: ["Total first", "The total in a 52 px column at the left, as the turn ladder puts the initiative (H), then who, what and the dice."]
    }
  };
  DEC.l3 = {
    n: 3, name: "Saying and rolling", page: "compose",
    what: "The composer under the log (C5.1): quick dice, who hears it (the table or a whisper), the field (\"Say, or /roll 1d20\"), Send, and the way to the dice options. Drawn while the GM whispers to Lyra and Borin's player talks.",
    today: "A row of six boxed dice, then Who hears it as a menu, the field and Send, then the roll's visibility in words and Dice options.",
    opts: {
      today: ["Today's composer", "The same rows drawn to the theme: the dice as Base line controls, the menu and field as fields, Send lit."],
      line: ["Field first", "Who hears it as a Base line control at the start of the field's row (violet while a whisper), the dice under it with More."],
      "switch": ["Say or Roll", "A segmented control, Say or Roll, over one row: Say is who hears it and the field; Roll is the dice, Advantage and the modifier."],
      tray: ["The tray in place", "The field's row, then the dice, Advantage, Disadvantage, the modifier and the roll's visibility in place, so the dialog is only for formulas and falls."],
      ondemand: ["Dice on demand", "One row: who hears it, the field, a d20 button and Send. The d20 opens the dice, Advantage and the modifier above the row."]
    }
  };
  DEC.l4 = {
    n: 4, name: "The dice options", page: "dice",
    what: "Everything past the quick dice (C5.2): the roll's visibility, how you roll (Digital or Manual), the dice with Advantage, Disadvantage and a modifier, a custom formula, falling damage, and the recent rolls. A player chooses between Shown to players, Hidden from players and GM only.",
    today: "A dialog, Dice options: Roll dice or Call for a roll for the GM, Visibility, Digital or Manual, the dice, Advantage, Disadvantage and the modifier as boxed buttons, Custom formula and Falling damage folded, and Recent rolls as cards.",
    opts: {
      dialog: ["The dialog", "Today's dialog drawn to the theme: the roller as a Cradle, the formula and falls as folded rows, the recent rolls as an open group."],
      sheet: ["A sheet over the panel", "The same, as a sheet over the panel, the map left in view."],
      panes: ["Two panes", "A wide dialog: the roller at the left, the recent rolls at the right."],
      inplace: ["In place", "The composer opens upward in the Log tab to the whole roller, and Fewer dice closes it; no dialog."],
      recent: ["Recent rolls first", "A dialog that leads with the recent rolls, the roller pinned at its foot."]
    }
  };
  DEC.l5 = {
    n: 5, name: "Calling for a roll", page: "call",
    what: "The GM asking for a check or a saving throw (C5.3): check or save, ability, skill, what the check needs, what it is about, the DC, who rolls, whether players see their results; then the open call with each answer as it comes back.",
    today: "The second mode of Dice options: the form with menus and chips, Call for the check as a full-width primary, and Open calls under it with each character's result or Waiting and Roll for them.",
    opts: {
      mode: ["In the dice options", "Today's place drawn to the theme: Call for a roll as the dice options' second mode, the open calls under the form."],
      menu: ["In the encounter's menu", "Call for a roll in the menu on the panel's tabs (C3) opens A's dialog with the form; the open call waits in the waiting list as a card (C3)."],
      list: ["From the waiting list", "Call for a roll in the waiting list's head (C3) opens the form in place; the open call is a waiting card on players, its answers in rows."],
      party: ["From the Party tab", "The party's rows carry who rolls (their ticks) and each answer as it comes back; the form sits under them."],
      composer: ["Beside the composer", "Call for a roll beside Dice options in the composer opens the form above it, in the Log tab, where the answers arrive."]
    }
  };

  function renderIdea() {
    $("#idea").innerHTML = ["l1", "l2", "l3", "l4", "l5"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + (S[k] === CHOSEN3[k] ? " · chosen" : " · turned down") + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">Today</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML = '<div class="today-strip" ' + W + ">" + E + "The log and the dice</p>" + fig("log", "The GM's Log tab") + fig("options", "Dice options") + fig("call", "Call for a roll") + fig("plcall", "A player's roll call and Log on a phone") + "</div>";
    var CI = [
      ["The table's frame", "C 2.1, 2.4", "The panel's one row of tabs with Log, End turn in its foot, and the phone's Switch with its Log view."],
      ["Tabs count news", "C3, first round", "Log's count is the lines since the GM last opened it, and drops when Log opens."],
      ["What is read is open", "T 2.3", "The log is an open group: rows on 1 px lines, no boxes. What takes input is a Cradle."],
      ["Controls", "T 2.5", "Quick dice, Advantage and the rest on a Base line; fields keep their box; chosen on cyan."],
      ["Numbers in VT323", "G 3.6", "Totals, dice and modifiers, everywhere."],
      ["GM only is a tag", "T rule 7", "A line players cannot see carries the violet GM ONLY tag; a whisper is violet too."],
      ["Colour keeps one meaning", "T rule 9", "Red damage, gold hit points, cyan chosen and a natural 20, amber waiting, violet GM only."],
      ["The roll is the button", "T rule 5, C3 2.5", "Wherever a roll is to be made, the row is the button."],
      ["The TV's latest roll", "H 2.1", "Who and what, the total, the dice in words."],
      ["Waiting on players", "C3, first round", "An open call is a card on the waiting list, grey while it waits on players."],
      ["Dialogs and menus", "A", "Dice options and Call for a roll use A's dialog; the encounter's menu is C3's."]
    ];
    $("#carried").innerHTML = CI.map(function (c) { return "<div><h3>" + c[0] + '<span class="from">' + c[1] + "</span></h3><p>" + c[2] + "</p></div>"; }).join("");
    var R = [
      ["A line opens to its card", "In the log, a roll's line opens in place to the roll's card (who and what, the total, the dice with a dropped die struck, the formula) and closes again; one is open at a time. The dice sheet's recent rolls are the same cards.", ""],
      ["Calls wait with what waits", "A call for a roll is made from the waiting list's head and waits there as a grey card on players until each has answered or the GM closes it; the bell does not count it.", "Today calls live in the dice options' second mode."],
      ["Nothing new in what the controls do", "Every option keeps today's commands, words and visibility: who sees a roll or a line is the server's, and a player never gets a GM-only line or another player's whisper.", ""],
      ["GM only, marked", "A line or roll only the GM sees carries the GM ONLY tag in the GM's log; a whisper carries WHISPER TO {name}, or WHISPER TO THE GM.", "Today the GM's log marks neither."],
      ["A natural 20 or 1", "A roll with a natural 20 carries NAT 20 in cyan, a natural 1 NAT 1 in red, in the log as in the dice options and on the TV.", "Today only the dice options mark them."],
      ["Damage reads red", "A number of damage in a log line is red VT323; healing is gold.", ""],
      ["The log stays where the reader is", "New lines arrive at the foot and the log follows them only while the reader is at the foot; scrolled up, a line says how many new lines wait below.", "Today the log jumps to the foot on every line."],
      ["A player's call", "The player's own prompt for a call (C4.3) and the band away from the table (A rule 10) stay as they are; C4 designs the prompt.", ""],
      ["Phones", "A player's Log on a phone is the Switch's Log view with the composer under it; the dice options and a call's form open as sheets.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
