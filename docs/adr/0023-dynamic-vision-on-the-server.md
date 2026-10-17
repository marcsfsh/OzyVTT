# ADR-0023: Dynamic vision and lighting, decided on the server

## Status

Accepted — 2026-10-17. Amends ADR-0022: its consequence that "a _public_ token inside fog is
visually covered but still present in the player payload" no longer holds. A creature wholly under
manual fog is now left out of what players receive, the same way as one out of sight.

## Context and decision drivers

The owner's decision: **the server hides what a character can't see.** Each player's device gets
only what that player's characters see, and a token out of their sight is never sent. Before this,
the app had manual fog only (ADR-0022). Fog was a mask painted over the map, and everything under it
still reached the player. A walkthrough found a public monster under fog with its exact position in
the player's DOM (`[data-token-id]`) and in their target lists. The fix belongs in the projections,
because they are already the security boundary (CLAUDE.md invariant 2). It must not be a better
mask on the client.

The other drivers: phones are first-class (invariant 4), so the client only paints what the server
sends. The server is one modest LAN box, so sight has to stay cheap when a token moves on a
dungeon map with a few hundred walls. And the rules already have places that ask "can this creature
see that one?" (an attack against a target you can't see, Hide). Those places should get one
answer.

## Considered options

- **Send everything, mask on the client** (how most VTTs do it): the simplest, but it breaks
  invariant 2. Anything the client can paint over is still in the payload.
- **Vision by 5-foot cell** (a line-of-sight raster per creature): coarse. Walls can only run
  along cell edges, it means nothing on a gridless map, and a large map's raster is heavy on the
  wire.
- **Visibility polygons on the server** (chosen): cast rays from each viewer to the wall ends,
  clipped to its senses and the lights, and send the polygons. A creature is tested by its own
  sample points, so token membership never depends on how a polygon is drawn.

## Decision

**Model.** Each scene has `vision`: `enabled` (off by default), `ambient` (`bright`, `dim`,
`dark`), `walls`, `lights`, `measure` (the map's size and pixels per foot, so projections and
replays are pure functions of state) and `explored` (the party's memory). Walls are segments in
image pixels. A `wall` blocks sight, light and movement. A `door` blocks all three while closed and
nothing while open. A `window` blocks movement only. A light is placed at a point or carried by a
creature, with bright and dim radii in feet. An equipped Torch, Lamp, Hooded Lantern or Candle
lights its bearer from its record in the SRD bundle. Senses come from content: a stat block's
senses line, and species traits, features and feats through their modifiers (Darkvision,
Blindsight, Tremorsense, Truesight).

**Sight.** A creature sees a point it has a clear line to (walls and closed doors cut one) when the
point is lit (the ambient light is not dark, or a light reaches it with a clear line), or lies
within its Darkvision or Truesight. Blindsight sees within its range even when Blinded or in the
dark. An Invisible creature is seen only by Blindsight or Truesight, unless it is outlined (Faerie
Fire). Tremorsense pinpoints creatures through walls without seeing them. A creature counts as
perceived if any of five points of its space passes (its centre and four points toward its
corners). Ranges are circles in feet through the map's scale. `apps/server/src/vision/` holds the
geometry, the senses, the sight engine and the audiences.

**Audiences.** A player sees through their own placed characters. The table screen, a spectator
and a shared replay see through the whole party. The GM sees everything, and can look through any
token's eyes or the party's with the GM-only read `vision.preview`. `AudienceSight` is the one
answer the projections use:

- A creature that is not a player character is **hidden** from an audience, exactly like a GM-only
  one, when none of its viewers perceive it (vision on), or when its whole space lies under the
  scene's manual fog (fog on). It gets no token, no actor, no turn-order row, and no rolls. Feed
  lines and toasts naming it are GM-only, and as a source it is masked as "A hidden threat". A
  player may not target it by id. A creature staged in a prepared scene is hidden the same way
  until that scene goes live.
- Another player's character out of sight or under fog stays known (the party knows its own), but
  its token is left out.
- An audience's own characters are always sent. A creature any part of whose space is revealed is
  sent.

**What players get.** The fog shapes as before. With vision on: the polygons their characters see
now, the party's explored ground as rectangles (a bitmap of half-cells, at most 256 per side), the
walls they have seen, and a door's open or closed state only while it is in sight. Lights are never
sent. Terrain is clipped to what the party has seen. The table screen gets the party's polygons
and explored ground.

**Rules.** While vision is on, walls, closed doors and windows bar steps in the movement path search
(`movementPath`'s `isStepOpen`), and the drag preview mirrors it. A creature the mover doesn't
perceive is no obstacle to the mover's path, and for a player neither is one hidden from them under
fog, so a refusal can't give it away. An attack gains Advantage when the target can't see the
attacker and has Disadvantage when the attacker can't see the target, each named in the roll's
explained sources. Hide is refused (`hide.seen`) while an enemy can see the hider.

**Commands.** `vision.set-enabled`, `vision.set-ambient`, `vision.reset-explored`, `wall.add`,
`wall.move`, `wall.remove`, `wall.clear`, `light.add`, `light.move` and `light.remove` are the GM's
(`scene:write`), each with an optional `sceneId` to prepare a parked scene. `door.set-open` is
`combat:write`: the GM opens any door, and a player only a door within 5 feet of their own character
with a clear line to it. Vision won't turn on for a map with no grid or scale.

**Speed.** Visibility polygons are cached by a fingerprint of the sight-blocking walls, the origin
and the radius. Sight and each audience's answer are memoised on the committed (frozen) state. With
300 walls, 6 characters, 20 monsters and 10 lights in the dark, recording what the party has explored takes
about 60 ms the first time and 6 ms after that. Six player projections and the table screen take
about 40 ms in the dark (7 ms in bright light), and a player's vision block is about 13 KB.

## Consequences and tradeoffs

- **Fog is now part of the boundary.** ADR-0022's mask still goes to players verbatim, but a
  creature wholly under it is no longer in their payload. Hiding a monster no longer needs
  `gm-only`. The GM can leave it public under fog, and it appears when the fog over any part of
  its space lifts.
- The feed is one stream for the table, so its lines are gated by what the whole party perceives,
  not by what each player perceives.
- Turning vision on in bright light before drawing walls explores the whole map at once. Drawing
  the walls first, or "Forget what the party has seen", undoes that.
- Walls only matter while vision is on.
- Not modelled yet: the Light and Daylight spells (the GM places a light), the Bullseye Lantern's
  cone, Darkvision granted by an effect (the effect schema refuses senses), locked doors, opening a
  door as the turn's object interaction, magical Darkness and heavily obscured areas, and dim
  light's Disadvantage on Perception.

## Mobile, security, and visibility impact

The GM's tools are one more labelled group in the map toolbar, **Vision**: the switch, the light
level, the Wall, Door, Window, Light and Remove tools, the light to place, "Look through", "Remove
all walls" and "Forget what the party has seen". It works at 390 px with touch. A door's handle has
a 44-pixel touch ring, which a player taps to open the door beside their character. The client
paints the server's polygons as a second mask in `FogOverlay`: solid for players and the table
screen, dimmed for the GM.

## Migration / reversibility

Additive with defaults on schemaVersion 1. `vision` prefaults to off, so every existing save,
archive and replay parses and behaves as before. Vision is left out of the combat timeline's
restorable slice, as fog is, so a rewind keeps the walls and what the party has seen. Turning
vision off is one command. Removing the feature would strip one state field and its commands with
no data migration.

## Validation evidence

`apps/server/test/vision-boundary.test.ts` runs a real server end to end. A goblin hidden by a wall,
and another wholly under fog, never reach the player over the socket (state, feed, table events),
over HTTP (`GET /game`, the log), on the table screen or in the shared replay. A player can't
target the fogged goblin by id, can't look through the goblin's eyes, and can't touch the walls. A
player opens a door beside their character and not one across the room, and the creature appears
once the fog over it lifts. `vision-projections.test.ts` and `fog-projections.test.ts` check each
projection's whole payload (partly revealed, edge-touching, re-hidden, own and other characters,
staged scenes, replays turn by turn). `vision-geometry.test.ts`, `vision-sight.test.ts` and
`vision-rules.test.ts` cover the polygons, the senses and lights, movement through walls, the
attack modes and Hide. The rules-5e path test and the client's move-preview mirror test cover walls
in the path search. A browser look at 390 x 844 (touch) and 1280 x 800 covered a player's view in
the dark, a door tapped open on a phone, the GM's Vision group, looking through a character, and a
manual-fog scene with the goblins missing from the players' DOM.
