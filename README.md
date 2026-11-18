# Solmara

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/sijepex01x/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/sijepex01x/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Solmara is a top-down 2.5D open-world crime game in the spirit of GTA 6, set in a fictional sun-soaked city that is entirely its own invention. You are Jace Rook, a driver-for-hire trying to make a name for himself. Fixer Mama Rosa hands you five jobs that take you from a first taxi fare all the way to a downtown bank heist — driving, running, shooting, and staying one step ahead of the Solmara police as the wanted stars climb.

The whole thing is vanilla JavaScript and Canvas 2D. No libraries, no downloaded assets, no network requests at all: the city, its cars and people, and every sound are generated in code, and the game weighs roughly 170 KB while aiming for a steady 60 frames per second on desktop and on phones.

## Play it

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. You can also just open `game/index.html` straight from the files — there is no build step and no server is required.

## Controls

- **Move:** WASD or arrow keys — on touch screens, the on-screen joystick
- **Run:** Shift (or the RUN button)
- **Act / get in or out of a car:** E (or ACT)
- **Shoot:** Space (or FIRE)
- **Pause:** P or Esc · **Mute:** M · **Quality high / low:** Q
- **Pick a mission:** keys 1–5

## The city and its systems

- **Five missions, one arc:** a timed first fare, a stolen car to deliver, a package run across town, shaking a three-star wanted level, and the Solmara Job — the bank.
- **Wanted levels, 0–5 stars:** the police react when they catch you committing crimes, chase you with sirens, and back off once you break line of sight long enough. Get busted and you lose some cash; get wasted and you pick yourself up and carry on.
- **A living city:** traffic on the roads, pedestrians on the sidewalks, parked cars you can steal, and shops where you can repair your ride, buy ammo, or grab a snack.
- **Day and night:** a full day cycle runs as you play. After dark the headlights come on, windows light up, and the lamps glow.
- **Progress that sticks:** money, reputation, and mission progress save in the browser, so you can close the tab and pick up where you left off.

## Inside the repo

- `game/` — the game itself: `index.html` plus ES modules under `game/src/` (world generation, rendering, input including touch, the main loop, and synthesised audio). Nothing is fetched from the network.
- `main.ts` — the make.fun entrypoint: copies `game/` and `screenshots/` to `/output` and writes `dossier.json`.
- `serve.ts` — a tiny static server (Node 22 standard library only) for playing locally.
- `vendor/makefun-game.ts` — the vendored make.fun game library, unmodified.
- `screenshots/` — screenshots taken from the game running in a real browser.

Everything here is original — the city, the characters, the story, the art, and the music were made for this entry, with nothing taken from any existing game.

---

<sub>Entered on [make.fun](https://make.fun/?ref=s3jx158p&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
