# Demo data: the Ashen Reach

NOTE FOR ANYONE TIDYING BRANCHES: this branch carries demo data on purpose. Do not merge it into `main` and
do not delete it. Leave its history as it is. The repo owner keeps it to load a filled-in campaign for
trying the app. It is `claude/friendly-babbage-g7gcge` plus this `demo-data/` folder and nothing else, so it
needs no code review. If that branch moves on, this one can stay where it is.

## What is in it

`ashen-reach-data.zip` is a complete OzyVTT data folder for a small invented campaign, built through the
app's own HTTP API so every record passed the server's validation:

- Characters: a party of five level-7 characters (fighter, cleric, wizard, rogue, ranger) rolled by the
  app's random generator, one retired bard (archived), and six named NPCs on the roster. The app's built-in
  example party was removed.
- Battlemaps and scenes: four plain grid battlemaps, calibrated at five feet per square, with tokens.
  Three scenes hold finished fights. The fourth, "Assault on the Watchtower", is live on the table with
  fog, difficult terrain and staged tokens.
- Combat history: three fights played turn by turn with server dice: attacks, damage, saving throws,
  conditions, a character dropping to 0 HP, death saves and healing. All three are archived as replays,
  and two are shared with players.
- Homebrew: at least one of every type: class, subclass, species, background, feat, spell, equipment
  and monster. They mix published, shown-to-players, GM-only, a draft, and a published spell with an
  unpublished edit.
- Codex, 95 pages in 17 folders:
  - 19 NPCs and a page for each party member, with backstory on the player side and secrets on the GM side.
  - 22 places from the world map down to a single tavern, 7 factions, 8 items, 6 creatures and 4 faiths.
  - 10 dated historical events, a player guide (primer, house rules, session zero, calendar and holidays,
    prices, names and speech, travel times) and GM prep (pitch, secrets and clues, the villain's clock,
    NPC voices, encounter and rumor tables).
  - 97 typed connections, plus wiki-links throughout.
- Campaign record:
  - A custom calendar with eras and an atlas of seven nested maps with 23 pins and a party marker.
  - Seven sessions: a session zero, five played sessions with full recaps and prep, and one planned.
  - Eleven quests across every status, and standing with six factions that changes session by session.
  - About 90 journal entries of every kind. They include a dated history, in-character diary entries,
    letters and handouts, deadlines, downtime (applied and waiting), milestones, and the combat, standing
    and quest records the server writes itself.

The GM password is not included. You set your own the first time the server starts.

## Loading it (Windows, PowerShell, from the repo root)

1. Stop the server if it is running (Ctrl+C in its terminal).
2. Move your current data out of the way so nothing is lost:
   `Move-Item apps\server\data C:\OzyVTT-data-backup`
3. Unpack the demo data where the server looks for it:
   `Expand-Archive demo-data\ashen-reach-data.zip -DestinationPath apps\server\data`
4. `npm run start`, open `http://localhost:3001` on this PC, choose Enter as GM and set a GM password.

`apps\server\data` is git-ignored, so it stays put when you switch back to another branch.

## Rebuilding it

`seed.mjs` builds the campaign from scratch against a running server with an empty data folder. The words
live in `lore-people.mjs`, `lore-world.mjs`, `notes.mjs` and `chronicle.mjs`. `campaign.mjs` holds the
calendar, folders, connections, quests and atlas pins, and `images.mjs` draws the placeholder maps and tokens.

```powershell
$env:DATA_DIR = "C:\OzyVTT-demo"; npm run start
# in a second terminal:
node demo-data/seed.mjs --url http://localhost:3001 --password "a GM password"
```

Characters and fights come out different every run because the server rolls them. Replay timestamps show
when the seed ran, since the API records real time; in-world dates and session dates are set properly.
