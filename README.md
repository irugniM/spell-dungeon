# Spell Dungeon — Web Edition

A full browser port of the libGDX/Java dungeon crawler that lives in
`../core` and `../lwjgl3`. The web version is a single-page vanilla
HTML/CSS/JS app — no build step, no dependencies, no server — and ships
the same feature set as the original game so it can drop straight into a
portfolio.

## Run it

Just open `index.html` — every screen is rendered straight in the
browser, with the canvas only swapping in once you start a run. From the
project root you can also use the launchers:

- `play.bat` — Windows
- `play.sh` — macOS / Linux
- `play.html` — universal HTML redirect

A static server works equally well: `npx serve .` or any GitHub Pages
deploy will run the site as-is.

## Default account

A single Admin account is seeded the first time the page loads:

```
Username: Admin
Password: cs2212
```

You can register additional `Player` accounts from the login screen.
Passwords are hashed with SHA-256 in the browser before being written
into `localStorage`; nothing leaves the device.

## Feature parity with the Java original

| Feature                                            | Web port |
| -------------------------------------------------- | -------- |
| Login / register / forgotten-password reset        | Yes      |
| Default seeded admin account                       | Yes      |
| Player home screen with stats summary              | Yes      |
| 4 save slots per account (load / new game)         | Yes      |
| Auto-save on level advance                         | Yes      |
| Spell-casting typing minigame (10 s, color markup) | Yes      |
| Per-cast WPM / accuracy / errors / time tracking   | Yes      |
| 12-slot inventory window with click + confirm-use  | Yes      |
| 90-second potion buffs                             | Yes      |
| Level 3+ shrinking-timer endless mode              | Yes      |
| Personal-best leaderboard (1 entry per player)     | Yes      |
| Tutorial / how-to-play screen                      | Yes      |
| Admin control panel (manage users, wipe board)     | Yes      |

## Controls

| Action          | Keys                                |
| --------------- | ----------------------------------- |
| Move            | `W` `A` `S` `D` or arrow keys       |
| Aim             | Mouse cursor                        |
| Fire fireball   | `Space` or left mouse button (10 MP)|
| Cast spell      | `Enter`                             |
| Inventory       | `Tab`                               |
| Open door       | `E` (when near a door)              |
| Pause / resume  | `Esc`                               |

## Gameplay loop

- Each level generates a procedural maze (4–9 rooms on a 3×3 grid)
  connected by corridors. Clear the current room, then press `E` at a
  door to open it — enemies and loot in the next room only spawn when
  the door opens.
- Each level introduces tougher enemies and a stronger boss. Defeating
  the boss advances to the next level and autosaves your slot.
- Casting a spell (`Enter`) shows a randomly picked sentence — type it in
  10 seconds without errors to load a charged fireball into your hotbar.
  Charged shots deal extra damage.
- Pickups (Health, Strength, Invincibility) drop into your inventory
  except for Health which heals on contact. Open the inventory with Tab,
  click a potion, and click "Use Selected" to consume it.
- Levels 3+ start with a 60-second timer that shrinks 5 seconds per
  level. Take down the boss before it hits zero.
- On death, your personal best is added to the local leaderboard and
  the slot is reset.

## Web edition extras

- **Minimap** (top-right): fog of war until you open a door or enter a room;
  `S` = start, `B` = boss, `?` = revealed but not visited; green outline = current room.
- **Floating combat text**: damage numbers and score pops on kills.
- **Room reveal**: opening a door with `E` spawns that room’s content and shows
  *Enemy ambush!*, *Treasure room!*, or *Boss chamber!*
- **Camera** stays within the maze bounds (no infinite void).
- **Lazy spawn**: enemies and loot only appear after a door is opened.

## Project layout

```
webgame/
├── index.html           # App shell + canvas + overlays
├── styles.css           # Retro neon theme + screen layouts
├── README.md
└── js/
    ├── app.js           # Boot & session restore
    ├── storage.js       # Accounts (SHA-256), players, slots, stats, sessions
    ├── leaderboard.js   # Personal-best leaderboard
    ├── sentences.js     # Sentence bank for the spell-casting minigame
    ├── screens.js       # Login / register / home / slots / stats / admin / tutorial
    └── game.js          # Gameplay loop, HUD, hotbar, inventory, spellcast
```

## Notes for portfolio reviewers

- Pure vanilla JS, ES5+. Runs offline from `file://`.
- Persistence is `localStorage`-only — no network calls, no analytics,
  no third-party assets.
- Password storage uses `crypto.subtle.digest("SHA-256", …)`; the
  hashing is async but the entire UI remains synchronous after login.
- The leaderboard logic mirrors the deduplication-by-personal-best fix
  that was applied to the Java `DataManager`, so each account always has
  exactly one leaderboard entry containing their best score.
