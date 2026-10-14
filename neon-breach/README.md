# Neon Breach

An original browser multiplayer tactical arena shooter. Node server (`ws`) + a dependency-free WebGL client — no build step, no CDN, no asset files.

## Run it

```bash
npm install
npm start          # http://localhost:3000   (PORT env var overrides)
npm test           # map validation, bot navigation walks, full bot match simulations, vote/callout and combat tests
```

Deploy anywhere that runs Node ≥ 18 (Railway, Fly, Render…): the start command is `npm start`, it listens on `$PORT`, and `/healthz` returns `ok`. WebSockets are served on `/ws` of the same origin.

## What's in it

- **6 modes** – Deathmatch, Team Deathmatch, Capture the Flag, King of the Hill, Golden Gun, Intel Recovery
- **7 arenas** – Foundry, Atrium, Courtyard, Reactor, plus **Crosswire** (ruined city street with shops, alleys and a central plaza), **Wildwood** (overgrown farmland: hedgerows, barns with hay lofts, a ruined hill) and **Wreckage** (crash site: downed helicopter, gas station, containers, overhead walkway). Each has its own lighting/fog theme; optional rain
- **Rooms** – always-on public rooms (PUB1–3, rotating map and mode), server browser, private rooms with 4-letter codes and invite links (`/?room=ABCD`), host-controlled staging area, team switching
- **Bots** – fill empty slots (2/4/6/8), step aside when people join; A* navigation, line-of-sight combat, mode-aware goals
- **Combat** – 15 weapons, armor, medkits, ammo, spawn protection, headshots, assists, killcam
  - Sidearms: PP9 pistol, **revolver** (2-shot kill, 6 rounds), **Desert-Eagle-style** (1-shot kill, 7 rounds). Both ignore armor
  - SMGs: VX, MK-5 (MP5-style), PD-90 (P90-style, 50-round mag). Rifles: KR-7, AUR-6 (AUG-style, scoped), CR-4 (M4-style)
  - Shotguns: Breacher (12 × 10 pellets, range 40), Ranger Pump (Mossberg-style), Spartan 12 (SPAS-12-style, semi-auto)
  - Heavy: Longshot sniper, **RL-7 rocket launcher** (splash damage, hurts you too)
  - Gadgets: proximity mines (`F`), **laser mines** (`T`; pickups come in pairs, max 3 placed per player), **throwing knives** (`X`), **melee** (`V`, 55 damage, instant kill from behind)
  - Weapon names live in `shared/weapons.js` so they are easy to rename
- **Map vote** – when a match ends, players vote between 3 random maps (live tallies); the winner is used for the next match in public rooms and the staging area in private ones
- **Callout wheel** – in team modes, hold `G` (D-pad up on a controller), flick towards Attack / Enemy spotted / Need help / Going here / Defend / Ping and release: teammates see a marker, beam, minimap blip and hear a chime. Tap for a plain ping.
- **Loadouts** – Arsenal (carry everything) or Tactical (sidearm + 2 primaries)
- **Player options** – rebindable keys, mouse + controller sensitivity, FOV, brightness, quality, 4 reticle shapes (red/green), 4 audio buses, 6 operator skins, minimap size/rotation, colour-vision palettes and shape cues, reduced camera motion
- **Controller support** via the Gamepad API
- Synthesised audio (no sound files), end-of-match scoreboard with screenshot

## Layout

```
server/index.js   HTTP static + /api/rooms + WebSocket entry
server/room.js    lobby, match lifecycle, authoritative combat, pickups, mines, mode rules
server/bots.js    bot AI
shared/maps.js    map definitions (used by server physics, bots AND the client renderer)
shared/physics.js player movement, ray queries
shared/nav.js     navigation graph built from map geometry
shared/weapons.js weapons, pickups, modes, defaults
client/           index.html, style.css, gl.js (renderer), game.js (sim/HUD), ui.js (menus), input.js, audio.js, settings.js
test/             validate-maps, physics-walk, sim-bots, vote-call, combat, mapview (ASCII map viewer: `node test/mapview.js wildwood`)
```

## Adding a map

Maps are lists of axis-aligned boxes, so the same data drives rendering, collision, bullets and bot navigation. In `shared/maps.js`:

1. Copy one of the builder functions (e.g. `courtyard`) and rename it. Use `mb.b(x, z, w, d, y0, y1, material)` for boxes and `mb.stairs(...)` for stairs. Maps are 56×56 (x, z ∈ [−28, 28]); team 0 defends z = +22, team 1 defends z = −22.
2. Return `pickups`, `golden`, `hill`, `base`, `spawnX`, a `theme` (sky/fog colours, fog range, light level) and register it in `BUILDERS`.
3. `npm test` — it checks that bots can path base-to-base and that every pickup, flag and hill is reachable with real player physics.

Helpers: `mb.wx / mb.wz` build walls with door and window gaps, `mb.car`, `mb.tree`. Materials: `floor wall metal crate accent marble stone grass hedge dark glow asphalt sand brick wood rust concrete olive blue red dirt leaf` (colours in `client/gl.js`).

## Adding a weapon or mode

- Weapons: add an entry in `shared/weapons.js` (`WEAPONS`, with a `cat`egory), optionally add it to `PICKUP_VARIANTS` so an existing map pickup can spawn it, then a view-model in `VIEWMODELS` (`client/game.js`) and a sound in `client/audio.js`.
- Modes: add to `MODES` in `shared/weapons.js`, then handle scoring in `kill()` / `tickMode()` in `server/room.js` and the HUD text in `client/game.js`.

## Known limits

- Player movement is client-authoritative (the server validates speed and bounds, and hits are server-authoritative). Fine for friends; a public game would want stricter movement validation.
- No accounts, persistence or matchmaking beyond the public rooms.
- Single server process — rooms live in memory.

## Rendering

Everything visual is generated in code, so there are no image or model files to ship.

- `client/textures.js` builds tileable procedural textures (brick, concrete, corrugated metal, marble, stone, wood, grass, foliage, fabric and more) with a baked bump emboss.
- `client/mapmesh.js` turns each map's boxes into UV-mapped meshes with per-vertex ambient occlusion, rounded edges on soft materials (hedges, sandbags, rocks) and the visual-only scenery listed in each map's `decor`: trees, cars, a helicopter, barrels, pipes, lamps, columns.
- `client/geom.js` holds the smooth primitives (sphere, capsule, cylinder, cone, rounded box) used for characters, weapons, pickups and effects.
- `client/gl.js` renders with a baked sun shadow map, hemisphere lighting, specular on metal, fog and a cloudy sky. Characters get soft contact shadows. Low quality turns shadow filtering down.

Collision, hitboxes and bot navigation still use the simple box layout, so the visuals can change without touching gameplay.
