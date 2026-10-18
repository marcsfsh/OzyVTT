/**
 * The document's groups, in the order a reader meets them. Every operation carries exactly one, and every
 * operation on a path carries the same one.
 */
export const API_TAGS = [
  {
    name: "System",
    description: "Whether the server is up, which versions it speaks, what a credential may use, and this document."
  },
  {
    name: "Host",
    description:
      "The GM account on the computer that runs OzyVTT: the first password, sign-in and sign-out, and the addresses players and table screens open. These routes send no CORS headers and take no integration credential."
  },
  {
    name: "Integration credentials",
    description: "Scoped bearer tokens the GM mints for bots, overlays and other tools. Only a GM session manages them."
  },
  {
    name: "Player sessions",
    description: "A player seat for a headless or custom player client: the HTTP twin of the socket's open join."
  },
  {
    name: "Live game",
    description:
      "The table's state, its reads and every game command. A command runs through the same pipeline as the app's own socket call, with the same rules, idempotency and projections."
  },
  {
    name: "Reference content",
    description:
      "The SRD 5.2.1 catalogs and the GM's published homebrew merged into them, each with the CC BY 4.0 attribution line a screen showing it must carry."
  },
  {
    name: "Fight replays",
    description: "Permanent records of ended fights, which the GM may share with players and launch onto the table."
  },
  { name: "Map assets", description: "Battlemap, regional and world map images, their filing and their grids." },
  { name: "Token assets", description: "Token images. A player may upload their own character's token." },
  { name: "Sound assets", description: "The GM's library of music and ambient sound files." },
  {
    name: "Table viewer",
    description:
      "The shared table screen: pairing, the screens the GM has let in, and the player-safe presentation they show."
  },
  {
    name: "Codex",
    description:
      "The worldbuilding Codex. A GM session or a `codex:read` credential reads every record; a player session reads the revealed parts that reach the characters it holds. Every write is the GM's."
  },
  {
    name: "Homebrew",
    description: "The GM's homebrew authoring. Players see homebrew only through the reference catalogs."
  }
] as const;

export type ApiTag = (typeof API_TAGS)[number]["name"];
