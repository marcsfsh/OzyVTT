# ADR-0023: Dynamic vision and lighting, decided on the server

## Status

Accepted on 2026-10-17. Amends ADR-0022: its consequence that "a _public_ token inside fog is
visually covered but still present in the player payload" no longer holds. A creature wholly under
manual fog is now left out of what players receive, the same way as one out of sight.

Amended on 2026-10-19 by "Light, obscurement and the rules that read sight" below, and again by
"Doors, objects and the walls spells make".

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
- With the fog on, a creature in the fight that isn't on the map yet (in the turn order or the tray)
  is hidden too, as dynamic vision hides it: the party can't see what isn't there.

**The shared hidden check.** `hiddenFrom` in `vision/audience.ts` is the one test for "is this
creature hidden from this audience as a GM-only one is": GM-only, or hidden by sight or the fog.
Without a session it answers for the table (the whole party's eyes), which every public line and die
follows, and the table screen too. With a player's session it answers for that player's characters,
which a refusal, a reply or a prompt only that player reads follows. Every rule and line that used to
ask only "is it GM-only" asks it. Where a line would name a hidden creature it says "A hidden threat",
the projections' mask, or leaves the name out, so play still reads for the GM. What it covers:

- Feed lines and toasts that name a cause: the GM's Apply of a hit, the turn reminder, an effect
  ended by Escape, by its bearer acting (Invisibility, Vicious Mockery) or by another rule, a
  strike-back offer, aura and trait lines, Heat Metal's note, a failed save's push (Thunderwave), a
  spell that Slow makes fail, a held creature dragged along, an opportunity attack against a hidden
  mover, and every resolver line built from a rules event.
- A creature that was hidden when it set off is narrated only where it is now ("came into view"),
  never with the distance it came or its old ranges.
- No opportunity attack opens for a player's character against a mover hidden from the table, and no
  strike-back (Hellish Rebuke, Retaliation) against a source hidden from the damaged creature's
  player. A player's Shield or Parry answer tells them only whether the attack landed and what it
  dealt.
- What a hidden creature would show in public dice: Disadvantage on a ranged attack beside it, Sneak
  Attack through it, Pack Tactics and Aura of Authority. A Paladin hidden from the table gives a
  visible creature none of its auras (Aura of Protection, Aura of Courage, Aura of Devotion, Smite
  of Protection's Half Cover), and its Holy Nimbus burns none. Holy Ward gives no Advantage against
  a Fiend or an Undead hidden from the table. Hide counts only the enemies the hider's player may
  know of.
- Refusals: the off-turn refusal, moving Hunter's Mark, a reeling creature, an effect that bars
  Reactions, spells or a second action under Slow, ending an imposed effect and a parked attack that
  can't finish name no hidden creature. A missing creature and someone
  else's get the same answer, so a player can't probe which ids exist.
- A public roll made by a creature hidden from the table becomes GM-only as the command that made it
  commits, so it never reaches players later, live or in a replay, when the creature steps into view.
- A light carried by a creature an audience doesn't perceive adds nothing to that audience's polygons
  or to what the party remembers. Its circle would draw the carrier's position.
- An area template drawn from a caster hidden from the table (a cone, line or emanation) is the GM's.
- A player may load a token image only for a creature in their own view, the table screen only for
  one the table may know of.
- A creature hidden from the table when the GM takes it out of the fight, or when a new fight leaves
  it out, becomes GM-only. Sight and the fog hide only what is on a map, and without this a creature
  no one saw would join every player's roster as it left.
- Players get opaque feed ids, the same for the same line, so the gaps between two lines don't count
  the GM-only lines between them.

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
- Left as they are, on purpose:
  - A hidden creature's turn still shows as a hidden turn, as a GM-only one's always has, so the
    table can count hidden slots in the order. The table needs to see play is waiting on the GM.
  - Every command still raises the revision players receive, a hidden creature's move included. The
    client checks staleness by it.
  - The movement path search uses every wall and door, seen or not, so a move's cost or refusal can
    tell a player a wall is there. At a table you learn of a wall by walking into it.
  - The map image reaches players whole, as with ADR-0022's fog. It shows the layout, never a token.
  - Damage, a save or a zone from a hidden source tells the player something unseen is there. The
    source is masked.
  - A hidden carrier's light isn't drawn even where it spills into sight round a corner. That is the
    price of not drawing where the carrier stands.
  - A rule that a hidden creature would trigger for a visible one (Pack Tactics, an aura, an ally for
    Sneak Attack, Disadvantage beside it) doesn't apply. The GM can still set the roll mode.
- Not modelled yet: opening a door as the turn's object interaction. The light spells, the Bullseye
  Lantern's Cone, senses from effects, magical Darkness, obscured areas and Dim Light's Disadvantage
  on Perception came with the first amendment below, and locked doors with the second.

## Amendment (2026-10-19): light, obscurement and the rules that read sight

**Light levels.** A point is in Bright Light, Dim Light or Darkness: the scene's ambient level, then
the painted areas over it (`bright`, `dim`, `dark`), then the lights that reach it with a clear line,
each Bright Light out to its bright radius and Dim Light for its dim radius more. Bright ambient
light may be sunlight (`vision.sunlight`), as may a light or an area (Daylight, Sunbeam, Holy
Nimbus, a Sun Blade). Dim Light is Lightly Obscured and Darkness Heavily Obscured. Darkvision sees
Dim Light as Bright and Darkness as Dim within its range; Devil's Sight and Truesight see both
normally. Painted `lightly-obscured` and `heavily-obscured` areas are fog and foliage whatever the
light, and `magical-darkness` stops every sight but Blindsight, Truesight and Devil's Sight. A
heavily obscuring area blocks sight through it, so no one sees into or across it, except the one
creature an area spares (Insect Cloud's holder).

**Where light and senses come from.** Senses: stat blocks, species, features, invocations, feats,
active items and live effects (True Seeing, See Invisibility, the Darkvision spell, Stonecunning),
including `see-invisibility`, `devils-sight` and `x-ray` (walls don't stop sight within range).
Goggles of Night add to Darkvision. Lights: an item in hand that is lit on its row (`item.set-light`:
a Tinderbox or another flame, a Bonus Action in a fight, a Hooded Lantern's hood, a Bullseye
Lantern's Cone aimed by its holder), which burns down on the game clock and is used up or needs Oil;
an item that always glows while held; an effect (Produce Flame, Faerie Fire's outline, Shining
Smite, Sacred Weapon); and a stat block's Illumination, put out by an effect tagged `light-out`. A
spell's or an action's `sight` places its light, fog or magical Darkness on its area, its user or
its targets, and dispels the spell light, Darkness or fog of a level it names that the new area
overlaps (Darkness and Daylight, Gust of Wind). What a cast makes ends with the Concentration, the
effect or the rounds that keep it (`vision/cast-sight.ts`, pruned after every command).

**The rules.** `vision/rules.ts` gives the rules one answer to "can this creature see that one":
the map while vision is on, and with it off the conditions plus Blindsight, Truesight and See
Invisibility by the distance between tokens, so an Invisible creature is seen by them even on a
scene with no vision. Light and line of sight are the GM's while vision is off, and a rule that
needs them keeps its printed effect there. With vision on:

- Cover comes from the map: of a target's four corners, the walls hide one or two (Half Cover),
  three (Three-Quarters) or all from every corner of the attacker (Total), and another creature on
  the line gives Half Cover. The GM's marks still count; the best applies.
- An area of effect leaves out a creature every straight line to which a wall or closed door blocks
  from its point of origin.
- Hide needs a Heavily Obscured space or Three-Quarters or Total Cover from each enemy
  (`hide.exposed`); Naturally Stealthy counts a creature a size larger as cover. The Hide total is
  the DC a Search with Perception meets to find the creature, and a Verbal spell ends hiding.
- Frightened gives its Disadvantage only while its source is within line of sight, and
  `movement.toward-fear` refuses a willing move closer to it.
- A Perception check to find a creature fails when the roller is Blinded or the creature is Heavily
  Obscured to it, and has Disadvantage when it is Lightly Obscured. Passive Perception against a
  hidden creature stays the GM's.
- Riders can name sight: `sees-other` (Dodge), `seen-by-other` (Faerie Fire's Advantage) and
  `other-lacks-sense` (Blur). A save with `sight.seenBy` reaches only creatures that see its user (a
  ghost's Horrific Visage) or its area (Hypnotic Pattern). A trait or feature can ask for sunlight
  or Bright Light (Sunlight Sensitivity, a vampire's burn at turn start) or Dim Light and Darkness
  (`light.too-bright`: Shadow Stealth, Merge with Shadows, One with Shadows; Shadowy Form's
  Resistance).

**Senses shown to one player.** An effect with `detects` (Divine Sense, Detect Evil and Good) adds
marks to its bearer's player's vision block for each public creature of a named type within range
(through walls unless `blockedByWalls`) that the player doesn't already see: its position and
creature type only. The table screen and other players get none, and a GM-only creature is never
marked. Nothing else about the creature crosses.

**Commands.** `vision.add-area` and `vision.remove-area` are the GM's (`scene:write`), and
`vision.set-ambient` takes `sunlight`. `item.set-light` is `combat:write`: a player lights, hoods
or aims only their own character's light.

**Speed.** Measured on the shared development machine under load (about 11 on 4 cores), 300 walls
in the dark: with 6 characters, 20 monsters and 10 lights, recording what the party has explored
takes about 120 ms the first time, six player projections and the table screen about 60 ms, and
13 ms once cached. With 30 tokens, 20 lights and 10 areas: about 180 ms, 120 ms and 8 ms. Asking
every creature whether it sees every other takes about 13 ms. A player's vision block is 8 to 30
KB. The first numbers in this record were taken on an idle machine; the cached paths are what a
turn mostly runs.

## Amendment (2026-10-19): doors, objects and the walls spells make

**Doors that stay shut.** A door may carry `door`: its `fastenings` (a `lock` with the DC to pick it,
an optional DC to break it by force and the creatures that hold its key; `stuck`, `barred` or
`jammed` with the Strength (Athletics) DC that forces it, 15 when none is set; `sealed` by Stone
Shape, which no check opens), an `arcaneLock` with its caster, the creatures it lets through and how
long Knock holds it off, and `hidden` for a secret door. `door.set-open` refuses a player a door held
shut against their character and says what holds it ("The door is locked."), so a player learns of
a lock by trying the door, as at a table. A secret door, or one out of reach, gets the answer a
missing door gets.

**Objects.** A wall or a door may carry `object`: an Armor Class, Hit Points, a damage threshold
and its immunities, resistances and vulnerabilities (SRD Breaking Objects). A door with none is a
Medium wooden door, AC 15 and 18 Hit Points. What holds a creature (a Net, a web, a rope) is an
object on the effect that holds it (`heldBy`). An object always shrugs off Poison and Psychic
damage, a Siege Monster's damage to it doubles, and at 0 Hit Points a wall or door is gone and a
held creature goes free.

**Walls made by spells.** A spell's `walls` raise walls on the template its cast placed: Wall of
Force (it stops movement, and sight passes), Wall of Stone and Wall of Ice in 10-foot panels that are objects,
and Forcecage's bars, which stop movement and no line, so they give no cover and stop no area. A
creature in the new wall's space is moved out of it. Each wall carries its `source` and goes with
the Concentration or effect that keeps it (`pruneEndedWalls`), unless the spell made it lasting (Wall
of Stone held for its full duration). A cast's `wallId` aims Knock, Arcane Lock, Mage Hand,
Thaumaturgy, Elementalism, Stone Shape, Passwall or Disintegrate at a door or a wall, checked for
range and, where the spell says so, sight. A gap cut in a wall (`openings`) lets sight and movement
through and closes with its spell. A creature that passes walls (Incorporeal Movement, Earth Glide,
Tunneler) is still stopped by one a spell raised.

**What players get.** No part of `door` or `object` reaches a player or the table screen. A secret
door is sent as a `wall`, a wall with gaps as the parts that stand (each with an id derived from
the wall's), and what holds a creature only as its name.

**Commands.** `door.set-state` and `object.set` are the GM's (`scene:write`), with an optional
`sceneId`. `door.use` and `object.attack` are `combat:write`: the GM's for any creature, a player's
for their own character, which must be beside the door to work on it. The server rolls every check
and attack. `object.damage` is the GM's alone.

**On the map.** A door's handle opens its menu: open or close the door and, with the player's
character or the GM's acting creature, pick, force, pry, jam or seal it. The GM's handle shows a
door held shut and a secret one, the GM sees the hit points of each wall or door that is an object,
and the menu edits the lock, the bar, the secret and the statistics. While an attack or a spell is
being aimed, a tap on a wall or a door makes it the target. A token's menu names what holds the
creature and aims a live attack at it.

## Mobile, security, and visibility impact

The GM's tools are one more labelled group in the map toolbar, **Vision**: the switch, the light
level, the Wall, Door, Window, Light and Remove tools, the light to place, "Look through", "Remove
all walls" and "Forget what the party has seen". The Light group also paints areas (Paint area,
with the kind to paint) and turns bright ambient light into sunlight; Remove takes an area away. A
player's light sources are lit, hooded and aimed in the item's detail on the sheet's Gear tab. It
works at 390 px with touch. A door's handle has
a 44-pixel touch ring, which opens the door's menu (see the second amendment). The client
paints the server's polygons as a second mask in `FogOverlay`: solid for players and the table
screen, dimmed for the GM. What is in sight but not in Bright Light keeps a light shade, and a
sensed creature is a dashed ring named with its creature type.

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
attack modes and Hide. The shared hidden check has its own end-to-end tests, each of which failed
before its fix: `hidden-narration.test.ts` (feed lines and toasts), `hidden-prompts.test.ts`
(reaction prompts and their replies), `hidden-rules.test.ts` (refusals, dice, templates, token
images, id probing), `hidden-rolls.test.ts` (rolls made while hidden, the replay, unplaced
creatures under the fog, feed ids) and `hidden-riders.test.ts` (the Phase 1 rules: pushes, a
slowing hit, effects that end as their bearer acts, refusals that name an effect, a Paladin's
auras, Holy Nimbus and Holy Ward). Each of its cases fails with its hidden check removed. `vision-projections.test.ts` covers a hidden creature's carried
light. The rules-5e path test and the client's move-preview mirror test cover walls
in the path search. A browser look at 390 x 844 (touch) and 1280 x 800 covered a player's view in
the dark, a door tapped open on a phone, the GM's Vision group, looking through a character, and a
manual-fog scene with the goblins missing from the players' DOM.

For the amendment: `vision-light.test.ts` (light levels, areas, sunlight, senses from effects and
items, lit items and their burn time), `vision-cast-sight.test.ts` (what casts and actions place,
keep and dispel), `vision-sight-rules.test.ts` (Cover, areas at walls, Hide, Search, Frightened,
Dodge, Blinded and obscured checks, light sensitivity, gazes, senses with vision off) and
`vision-features.test.ts` (invocations, feats, Divine Sense's marks for one player only, Shadowy
Form, Merge with Shadows, One with Shadows, seen-only saves). On the client,
`scene/vision-areas.test.tsx` paints and removes areas, sets sunlight and draws Dim Light and sensed
marks, and `sheet/item-light.test.tsx` lights, hoods and aims a light source.
