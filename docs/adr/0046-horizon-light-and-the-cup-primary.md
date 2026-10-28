# ADR-0046: Horizon light and the Cup primary

## Status

Accepted

## Context and decision drivers

Light rail (ADR-0045) shipped beside the arcade cabinet's primary button: a magenta key with dark Bungee ink over a 5px
pressed edge. Next to the glass surfaces and the thin lit lines Light rail draws, the key read as off-brand. It was the
one heavy block of colour in the interface. The chosen tab's ink was cyan, while the horizon carried the app's own
colours on the top bar and along overlay edges.

The owner chose the replacement over three rounds of mockups, kept in `docs/design/light-rail/horizon/history/`. The
first round replaced the magenta key with a rail of light. The second chose the Horizon colours for it and Chakra Petch
for its label and for plain titles. The third chose the Cup among the Rail versions.

What the decision had to keep:

- The primary stays the one loud control in a view, readable at 4.5:1 in Dusk and Dawn.
- Colours that mean something keep their meaning: gold, red and cyan for hit points, damage, healing and targeting.
- Phones stay first-class: every hit area stays at 44px, and every strip is checked at 390px.

## Considered options

- Keep the magenta key.
- A Terminal primary: a plate with a square of light at one end where a press starts (Before, Both ends, Corner and
  Hook).
- A Cradle primary: a plate whose line wraps up from its base (Before, Frame, Cup and Holder).
- For lettering: Bungee everywhere, as before, or Chakra Petch for plain titles with Bungee kept for chrome.
- For the light: the colours Light rail shipped with (white comets and a cyan ink), or the horizon's own colours.

## Decision

1. The primary is the Cup: a plate like the other controls that holds a horizon. A 3px horizon line runs along its base
   and 1px lines run up both sides at full height, with no top. The horizon's colours tint the lower half of the plate
   through a veil. The label is the text ink in Chakra Petch capitals. A press sinks the plate 1px, lights the base
   from the press point and fills the cup with a wash of the horizon that settles back.
2. Chakra Petch 600 replaces Bungee wherever Bungee was plain: page and record titles, dialog titles and the primary's
   label. Bungee stays for chrome lettering: the wordmark, YOUR TURN and the acting creature's name, on the turn card
   and the table screen.
3. Light rail takes the horizon's colours. A comet or burst that carries no meaning of its own takes the colour of the
   horizon where it leaves and where it lands. A chosen tab's ink is a horizon with a faint cast rising from it. An ink
   lies on its strip's line and never stacks a second line above it. Where that line is already the horizon, the ink
   shows the horizon's own colours there, brightened. A cast fades out sideways as well as away from its line, and an
   overlay's top edge casts the same faint light down into the surface.
4. Hit points, damage, healing and targeting keep their gold, red and cyan light. The sun frame, the lamps, the chrome
   catch, the chroma settle, the life bar and the wash stay as ADR-0045 built them.

## Consequences and tradeoffs

- The horizon gains two jobs: the primary's lines and the chosen tab's ink. The sun frame goes back to its one job,
  showing who is acting, since the encounter panel's primary no longer borrows it.
- A third face loads: Chakra Petch at one weight, about 10 kB for Latin.
- Display text is written in sentence case in the code, and each display rule sets the capitals. A convention check
  fails a display rule that sets none.
- A strip whose line was a border just past its tabs now draws that line inside itself, or its tabs reach over it, so
  the ink can lie on it. The section bar is 52px tall, line included.
- A small primary is a 44px box with a 42px plate in it. Its lines take the `::after` that `.tap-target` would use for
  the hit area, so the box is the hit area.
- One listener per page lights every primary, including the encounter panel's own buttons, which are not Button
  components.
- The magenta key's tokens are gone. `--magenta` stays for the Action lamp and pink words.

## Mobile, security, and visibility impact

- Mobile: every primary keeps a 44px hit area. The strips and their inks were checked at 390px and 1280px, and a smoke
  journey fails if a line lies beside a chosen ink at either size.
- Security and visibility: the change is styles and client motion only. Nothing new reaches a player, the table screen
  or the Codex player view.

## Migration / reversibility

Tokens, styles and client code only, with no data to migrate. Reverting the Horizon update commits restores the magenta
key, Bungee titles and the colours Light rail shipped with.

## Validation evidence

- `packages/ui/src/theme/themes.test.ts`: the Cup's label at 4.5:1 or more on its plate and over the horizon's cast at
  each stop, at rest and on hover, in Dusk and Dawn.
- `packages/ui/src/primitives/button-ink.test.tsx`, `packages/ui/src/motion/press.test.tsx` and
  `packages/ui/src/motion/lightRail.test.tsx`: the label's ink, the press light, and the horizon's colours in the engine.
- `packages/ui/src/primitives/strip-ink.test.tsx` and the smoke journey "a chosen tab's ink lies on its strip's line,
  with no second line beside it".
- `apps/client/src/design-conventions.test.ts` check (i): the display face is set in capitals.
- The mockups the owner approved, in `docs/design/light-rail/horizon/mockups/`, compared at 390px and 1280px in Dusk and
  Dawn.
