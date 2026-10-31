  /* ---------- The leftovers round's decisions ---------- */
  var DEC = {
    k1: {
      n: 1, name: "The API reference", page: "api",
      what: "Every operation the server answers (I7), read live from the server: its method, path, summary, tag and who can call it, with a way to narrow and sort them. Drawn with the Actors tag.",
      today: "API in Settings: How to call this API, then Operations and Commands as a switch, a find field, Tags, Filters and Sort, and one table of 405 operations.",
      opts: {
        today: ["Today's table", "Today's page drawn to the theme."],
        side: ["Tags at the side", "The settled side list: the tags with their counts, then Who can call; the chosen tag's operations at the right."],
        beside: ["An operation beside the list", "Like a map beside its list (E2 2.2): the operations as rows at the left, the chosen one open at the right."],
        groups: ["Grouped as Settings' rows", "Each tag a group of I's rows: the method, the summary, the path, who can call it."],
        cards: ["A card per tag", "E's shelf cards, one a tag with its count; a card opens its operations."]
      }
    },
    k2: {
      n: 2, name: "An operation's page", page: "op",
      what: "One operation (I7's operation page): what it does, who can call it, the request's fields, the responses, and an example. Drawn with adding an SRD monster to the roster.",
      today: "The operation as one document (request, body fields, responses) with its facts in a panel at the right, at its own address.",
      opts: {
        today: ["Today's document and facts", "Today's page drawn to the theme."],
        tabs: ["Tabs", "Request, Responses, Example and About as tabs under the title."],
        side: ["Facts in the side column", "The document at the left with the example; About it in the side column."],
        rows: ["Settings' rows", "Who can call it and each field as I's rows."],
        split: ["Request and response side by side", "The request and its example at the left, the response and its example at the right."]
      }
    },
    k3: {
      n: 3, name: "The commands", page: "cmd",
      what: "The commands the live-game socket takes (I7's second table): each command's type, its scope and what it does.",
      today: "Commands is the other half of the Operations and Commands switch: one table.",
      opts: {
        today: ["Today's switch", "Today's second table drawn to the theme."],
        side: ["In the side list", "With tags at the side, The live game adds Commands and Events as rows of the same list."],
        each: ["On each operation", "An operation's page says which command it is, under its title."],
        sec: ["Two groups", "Operations and Commands as two groups of I's rows on one page."],
        column: ["A column of the table", "The operations table gains an As a command column."]
      }
    },
    k4: {
      n: 4, name: "At the table: a player's actions", page: "at",
      what: "Players' At the table row (I2): each claimed character with whether their player is connected, and the GM's two actions on it, Set token image and Force release.",
      today: "Actions on each row opens a menu with Force release and Set token image.",
      opts: {
        today: ["Today's Actions menu", "Today's menu drawn to the theme, open on Lyra."],
        buttons: ["Two buttons on the row", "Token image and Release as Base line buttons on each row."],
        menu: ["A's menu at More", "More on each row opens A's menu at the row."],
        under: ["Opens under its row", "The row opens under itself with who claimed it and since when, and the two actions."],
        side: ["In the side column", "A row opens the character in a side column with the two actions and what Force release does."]
      }
    },
    k5: {
      n: 5, name: "A credential's history", page: "hist",
      what: "What happened to an integration credential (I6's History): created, used, a wrong secret refused, rotated, revoked, each with when. Drawn with the stream overlay.",
      today: "History on a credential's row opens a dialog: Created, Expires, Revoked, then When and What happened as a table.",
      opts: {
        today: ["Today's dialog", "Today's dialog drawn to the theme."],
        side: ["In the side column", "History opens in the side column beside Access, with Back."],
        under: ["Under its row", "The credential's row opens under itself with its latest events."],
        page: ["A credential's page", "Each credential opens as its own page: Rotate and Revoke as rows, then its history as rows."],
        feed: ["One feed", "What happened, for every credential, as one list under the table."]
      }
    }
  };

  function renderIdea() {
    $("#idea").innerHTML = ["k1", "k2", "k3", "k4", "k5"].map(function (k) {
      var d = DEC[k], o = d.opts[S[k]];
      return '<div' + (DOFP[S.pg] === k ? ' class="cur"' : "") + '><p class="eyebrow">' + d.n + " · " + d.name + "</p><h2>" + o[0] + "</h2><p>" + o[1] + '</p><p class="eyebrow" style="margin-top:12px">What it is</p><p style="font-size:14px">' + d.what + '</p><p class="eyebrow" style="margin-top:12px">' + "Today" + '</p><p style="font-size:14px">' + d.today + "</p></div>";
    }).join("");
  }
  function renderStatic() {
    function fig(k, cap) { return A[k] ? '<figure><img alt="' + cap + '" src="' + A[k] + '"><figcaption>' + cap + "</figcaption></figure>" : ""; }
    var W = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))"', P = 'style="grid-column:1/-1;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))"', E = '<p class="eyebrow" style="grid-column:1/-1">';
    $("#today").innerHTML = '<div class="today-strip" ' + W + ">" + E + "On the laptop</p>" + fig("t-api", "The API reference") + fig("t-filters", "Its filters") + fig("t-op", "An operation's page") + fig("t-players", "Players, At the table") + fig("t-access", "Access and the credentials") + fig("t-history", "A credential's history") + "</div>" +
      '<div class="today-strip" ' + P + ">" + E + "On a phone</p>" + fig("t-api-p", "The API reference") + fig("t-op-p", "An operation") + fig("t-players-p", "Players") + fig("t-access-p", "Access") + "</div>";
    var CI = [
      ["Settings' frame", "I 2.1", "The side list with search and a line of what each section holds now; the section at the right."],
      ["Settings' rows", "I 2.2", "A row a setting, its control at the right; groups under an eyebrow."],
      ["The settled side list", "E2 2.1, G2 2.1", "An eyebrow, a row a thing with its count, the chosen lit."],
      ["A thing beside its list", "E2 2.2", "The rows at the left, the chosen one open at the right."],
      ["The side column", "F2 2.3", "The side column turns into the thing, with Back."],
      ["Shelf cards", "E 2.1", "A card per thing with its count."],
      ["A's menu and dialog", "A, C2", "Menus at the thing; dialogs with the horizon edge; from the foot on a phone."],
      ["Numbers and code in VT323", "T", "Paths, scopes, counts and times."]
    ];
    $("#carried").innerHTML = CI.map(function (c) { return "<div><h3>" + c[0] + '<span class="from">' + c[1] + "</span></h3><p>" + c[2] + "</p></div>"; }).join("");
    var R = [
      ["The reference reads the server", "The API reference keeps reading the OpenAPI document and the command catalog live, so it can't drift.", ""],
      ["Download OpenAPI stays the Cup", "The API section's one primary, at the head, as I's frame says.", ""],
      ["Force release asks first", "Force release keeps today's confirm, and says the player can claim another character.", ""],
      ["A secret is shown once", "Rotate shows the new secret once, as today; History never shows a secret.", ""],
      ["Nothing new in what the controls do", "Every route, command, release, token image and credential action keeps today's words.", ""],
      ["Phones", "Lists as rows or chips, an operation stacked, menus and dialogs from the foot; 44 px hit areas.", ""]
    ];
    $("#rules").innerHTML = R.map(function (r) { return '<div class="rule"><h3>' + r[0] + "</h3><p>" + r[1] + "</p>" + (r[2] ? '<p class="today">' + r[2] + "</p>" : "") + "</div>"; }).join("");
  }
