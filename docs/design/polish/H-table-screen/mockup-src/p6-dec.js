
  /* ---------- What each option means ---------- */
  var CHOSEN = { d1: "refined", d2: "horizon", d3: "combo", d4: "pip" };
  var DEC = {
    d1: {
      n: 1, name: "The TV in a fight", page: "fight",
      what: "The live screen across the room: the map, whose turn it is and who is next, the turn order with a GM turn for a hidden creature, the round, and the latest public roll. On a phone held upright the same screen stacks.",
      today: "A strip across the top (the wordmark, the round on a VCR counter, a tile per turn), the map at the left and a column at the right with the acting card and the roll card. On a phone held upright the acting card breaks: its name runs down one letter at a time.",
      opts: {
        refined: ["Ladder, refined", "The order down the left in initiative order, top to bottom. The acting row grows into a card with its portrait and chrome name, NEXT is marked in cyan, and the latest roll sits at the ladder's foot, so nothing covers the map. On a phone: the ladder, the map, then the roll."],
        rolling: ["Rolling ladder", "The acting creature is always at the top, and the order rolls up a row each turn, so the ladder reads as what happens next. A line marks where the next round starts; those who already acted this round sit under it. The roll sits at the ladder's foot."],
        glass: ["Ladder over the map", "The map fills the screen and the TV centres it in the room beside the ladder, which floats over it as glass. The latest roll is a glass card at the bottom right. On a phone the ladder floats across the top and the roll across the foot."]
      }
    },
    d2: {
      n: 2, name: "Pairing and waiting", page: "pair", picked: 1,
      what: "What the TV shows when it is not showing the table: the pairing code, Paused, and Waiting for a map.",
      today: "A card with Pair this screen and the code; a paused screen shows one line on the sky, and its heading breaks over two lines.",
      opts: { horizon: ["Horizon line", "Black, with the horizon line across the middle: what this is above the line, the code or the words below it. Waiting for a map uses the same screen with its own words, and Tap to turn on sound sits at the bottom left while the screen waits for a tap."] }
    },
    d3: {
      n: 3, name: "The GM's screen controls", page: "screens", picked: 1,
      what: "The page behind Table screen settings: what the screens show, pausing them, presenting a map, the paired screens, pairing another, and pointing at the map with focus, ping and measure.",
      today: "Shared screen in two columns: the focus, ping and measure tools with a small map at the left; the address, the pairing form, four buttons and the paired screens at the right.",
      opts: { combo: ["Screens first, then Remote", "The page opens on what is on the screen, with Pause and Present a map, then a card for each paired screen with its live picture, and a card to pair another. Open a screen and it becomes a remote: a large live picture to press for focus, ping and measure, with what is on the screen and the other screens beside it."] }
    },
    d4: {
      n: 4, name: "In the menu, and the preview", page: "menu", picked: 1,
      what: "The table screen's row in the GM's menu, from the frame (A), with its lamp and its actions in place, and the preview of the screen.",
      today: "A lamp button in the top bar with a menu of Pause, Preview the table screen here and Table screen settings; the preview is a floating window that can be dragged, resized and popped out.",
      opts: { pip: ["Picture in picture", "Preview it here docks the screen in a small window at the bottom right that stays on every page, with Pause, Pop out and Close. Drag it to another corner. On a phone it sits over the bottom right, above the bar."] }
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
      '<div class="today-strip" ' + W + ">" + E + "The TV</p>" + fig("tv-pair", "Pair this screen") + fig("tv-paused", "Presentation paused") + fig("tv-waiting", "Waiting for a map") + fig("tv-fight", "In a fight, with a roll") + fig("tv-43", "On a 4:3 screen") + "</div>" +
      '<div class="today-strip" ' + W + ">" + E + "The GM</p>" + fig("controls", "Shared screen") + fig("controls-sound", "Sound") + fig("lamp", "The lamp's menu") + fig("preview", "The preview") + "</div>" +
      '<div class="today-strip" ' + W + ">" + E + "Phones</p>" + fig("tv-phone", "The screen on a phone, upright") + fig("controls-phone", "Shared screen on a phone") + "</div>";
    var R = [
      ["The TV shows only what it already gets", "The ladder draws from today's projection: the map, the tokens the party can see with health bands only when the GM shows them to everyone, the turn order with a GM turn for a hidden creature, the round, the latest public roll, pings and the measurement. Nothing here adds a field to it.", ""],
      ["One name: Table screen", "The TV, the GM's menu, the settings page and the help all say Table screen. Shared screen, Shared display and Table Viewer go.", "Today the page says Shared screen, the TV says open Shared screen, the lamp says Table screen and the window's title is Table Viewer."],
      ["Read from across the room", "Names at least 20 px on a 1080p TV, numbers in VT323 at 28 px or more, the acting name in chrome letters kept whole (it shrinks before a word breaks), and nothing that needs a pointer.", "Today the acting name breaks mid-word."],
      ["A map with no fight", "With a map on the screen and no encounter running, the ladder keeps its head (STOP and RND --), names the map under No encounter running where the turn would be, and its foot says No roll to show yet, as today.", ""],
      ["A long order", "When the turn order is longer than the ladder, the acting row and the next stay in view and the rest scroll with the turn; the ladder never shrinks its names to fit.", ""],
      ["Opening a screen", "Every paired screen shows the same thing, so focus, ping and measure in a screen's remote reach every screen; the remote says so. Its own rows are the screen's name, whether it is connected and can play sound, when it was paired, and Revoke.", ""],
      ["The preview", "Preview it here docks the picture in picture; it stays on every page until closed, and hides on the Table screen page, where the remote is the preview. Pop out opens it in its own window, as today.", ""],
      ["Turn on sound", "When the TV blocks sound until a tap, one quiet button at the bottom left says Tap to turn on sound, edged magenta while something waits to play, as today.", ""],
      ["The screen's own controls fade", "Fullscreen, zoom, Fit the map, Follow GM view and the Live or Reconnecting pill fade after a few seconds without input, as today; Reconnecting stays.", ""],
      ["On a phone held upright", "The live screen stacks: the ladder, the latest roll, then the map filling the rest. Every name is kept whole, and nothing scrolls sideways.", "Today the acting card turns into a narrow column."],
      ["Left for later", "The sound page, the scenes' See as: screen, and Settings' own table screen rows take this design later.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
