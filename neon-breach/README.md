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

The art style is a stylised, Team Fortress-like look: painterly softened textures, chamfered architecture, a soft-ramp sun with cool shadows and richer colour, rim light, and cartoon outlines on characters, pickups and projectiles. Characters have big heads with faces, chunky limbs, big boots and gloves, and one of six hats per operator (balaclava, hard hat, helmet, cap, beanie, headset). In team modes the shirt takes the team colour.

Set dressing lives in `client/clutter.js`: per-map debris, tyres, cones, pallets, papers, plants and puddles on the floor, plus posters, vents, lamps, banners and extinguishers on walls. It is deterministic, visual only, and never placed on pickups, spawns or inside solid objects. It also adds floor markings (manholes, drains, cracks, hazard stripes, parking lines, patches) and architectural trim (baseboards, cornices, pilasters). Weapon models (first person and third person) are defined once in `client/guns.js`, each shaped after its real-world counterpart (AK, M4, AUG, MP5, P90, Mossberg 500, SPAS-12, Desert Eagle, Python, RPG-7, bolt-action sniper...). Soldiers are drawn by `client/avatar.js`: lofted bodies with IK limbs, camo uniforms, plate carriers, helmets/headgear, gloves and boots, with team colour on the armband, chest strip and helmet band.



### Audio
`client/audio.js` synthesises everything (no asset files): layered gunshots (supersonic crack, blast body, sub thump, reverberant tail) through a soft-clip punch stage, metallic reload and bolt foley, convolution reverb, weighty footsteps/impacts/explosions, and a cinematic score (string pads, brass swells, timpani/taiko, low ostinato in matches). Sound volumes are in Settings.

### Movement, maps and recorded sounds
- Walking speed is 8 m/s; hold **Shift** (or click the left stick) to sprint at 10.4 m/s (+30%, forward only, not while crouched or aiming). Rebind in Settings.
- Every map is enclosed by a ceiling with light strips; almost all waist-high cover is now full-height partitions (a few low pieces remain). This is applied in `enclose()` in `shared/maps.js`.
- Guns are built from 100-260 parts each (rails, serrations, vents, sights, controls...) baked into merged meshes with a distant low-detail version.
- To use recorded sound effects, see `client/sounds/README.md` (only audio you have rights to use).

## Lighting, detail and HUD (latest round)
- **Dynamic lighting** (`client/lights.js`, shader in `client/gl.js`): every map gets ceiling lamps hung from the roof strips, floor uplights along the walls
  (some flicker) and eight sweeping flood lights. The renderer lights surfaces with the 8 most relevant lights per frame, plus transient
  muzzle-flash and explosion lights. Fixtures and soft light beams are drawn in the world.
- **Gun detail**: every gun now has at least 5000 parts (`PARTS_PER_GUN` in `client/guns.js`): the hand-built silhouette and detail kits plus
  deterministic surface micro-detail (screw heads, bolts, grooves, weld beads). Guns are baked once into a few meshes, with three levels of detail
  (silhouette / detail kit / full) chosen by distance.
- **Item icons** (`client/items.js`): weapon pickups show the real gun model; medkit, armour, ammo crate, laser mine, knives and proximity mine are
  detailed 5000-part models too.
- **Crosshair**: a cross that opens up when you move, jump, sprint or fire, closes when you crouch or aim. Ring and chevron styles remain in Settings.
- **Hands** in the first-person view are 20% larger and lighter, with knuckle and glove-plate detail.

## Killstreaks
Kills in a row without dying earn a pick-one reward at **3, 5 and 7**. A menu appears above your HUD; press **1 / 2 / 3** to choose (12 s, then the first option that fits is picked for you). Rewards queue if you earn another before choosing. Kills made by your own units do not count toward the next streak.

| Streak | Choices |
|---|---|
| 3 | **UAV** (enemies on your minimap, 30 s, shared with your team) · **Metal helmet** (absorbs one headshot) · **Wall boots** (hold forward into a wall to run up it; lasts until you die) |
| 5 | **Attack dog** (75 hp, hunts the nearest enemy) · **Sentry gun** (immobile, 100 rounds, auto-targets enemies in line of sight, 150 hp) · **Barrier** (spans the hallway ahead wall to wall, 300 hp, blocks movement and bullets) |
| 7 | **Radar** (60 s, every player and the way they face) · **Rat swarm** (10 rats, 1000 shared life, 80 dps) · **Clone** (50 hp, stays within ~0.8 m of you, copies your weapon and shoots enemies) |

Units are server-side (`server/streaks.js`, tuned in `shared/weapons.js` → `STREAK_UNITS`), show health bars, can be shot, blasted or knifed, and are listed in the kill feed. `node test/streaks.js` covers all nine rewards.

## Character and killstreak detail

Soldiers, clones, dogs, sentries, rats and barriers carry far more than 3000 triangles each (roughly 15-20k per soldier/dog/sentry/barrier, ~37k for the 10-rat swarm), so this round added *visible* detail instead of raw count:
laced and treaded boots, cargo pockets, plate-carrier pouches and webbing, fingers, watch, headset and NVG mount on soldiers; fur, jaw and teeth, harness and claws on dogs;
gimbal, sensor head, radar dish, ammo belt and tripod joints on sentries; legs, whiskers and teeth on rats; bolts, chevrons, beacons and conduit on barriers.
Tiny parts use low-poly spheres and scaled cubes to keep the cost down.

## Reloads, iron sights, deaths and natural scenery

- **Reload animations** (`client/reload.js`): every gun has a scripted 1-2 s reload (reload times were trimmed to 1.0-2.0 s). Magazine guns drop the old mag, bring a fresh one from a pouch and charge
  (each gun has its own well position, cant, charging style: AK rock-in, MP5 slap, M4 tactical, bullpup side charge, top-fed P90); the revolver dumps spent cases and uses a speed loader;
  shotguns feed shells one by one then pump (Ranger pumps twice); the Longshot cycles its bolt around a mag swap; the launcher takes a rocket down the tube. Sound cues fire at each action.
- **Iron sights**: every gun gets a rear notch and front post standing clear of the receiver/optic/handguard; aiming lines the sight picture up with the eye per gun (`gun.ads`).
- **Death animations** (`drawDead` in `client/avatar.js`): crumple forward, knocked backwards (headshots, shotguns), drop to the knees (blades), or thrown tumbling by blasts; the weapon is dropped, a blood pool spreads, other players' deaths have a grunt and a thud.
- **Scenery**: boulders, hedges, canopies and dunes are lumpy noise-carved solids that stay inside their collision boxes; trees have root flare, surface roots, limbs and multi-lobed canopies; stone columns have plinths, rings and capitals;
  all walls get mottling, floor dirt splash and moss on outdoor stone.
- **Sounds**: freesound.org cannot be pulled automatically (no automated downloads, login required). Drop clips into `client/sounds/` and run `node tools/make-sound-manifest.mjs` - see `client/sounds/README.md`.

## Sculpted scenery and micro-detail

Trees, rocks, hedges, bushes, logs and grass are built from smooth sculpted lattices (`client/organic.js`): ridged multifractal rock with cleave planes, lumpy foliage clumps, tapered bark trunks with flare and lichen, curved grass blades. Surfaces get vertex-baked weathering (mottle, dirt splash, moss). In the shader (`client/gl.js`) a world-space gradient-noise micro-relief bends normals and mottles albedo near the camera (`MICRO` table), and organic textures bake at 512 px, unblurred, on High quality. Wildwood is roughly 520k triangles and takes a few seconds to build; lower `DETAIL.v` in `client/organic.js` if a device struggles.

## Look, light and music pass

- **Lighting:** sun intensity, shadow contrast and dynamic lights are each about 30% stronger on every map (`client/gl.js`), with a filmic (ACES-style) tone-map, Schlick-fresnel sky reflections and sun-glint on glossy materials (`SPEC` table), warm forward-scattering haze toward the sun, and a soft vignette in matches.
- **Architecture cleanup:** wall trim (baseboards, cornices, pilasters) was rotated 90 degrees on east/west-facing walls and stuck out as beams; fixed. `enclose()` in `shared/maps.js` now only lifts real partition walls to ceiling height, so crates, sandbags, hedges and barriers stay waist-high instead of becoming 3 m pillars. Floor cables, a floating glow block on the helicopter and the solid-cyan rails and canopy were removed or re-skinned as metal.
- **Music:** the score is now a cyberpunk synthwave / dark-electro track: 132 bpm in matches (100 bpm in menus), four-on-the-floor kick, claps, rolling 16th bass, arps, detuned lead hooks and snare-roll risers into every 8th bar.

## Fluorescent lighting and security cameras

- **Ceiling lights:** the cone lamps and sweeping flood lights (and their beams) are gone. Each ceiling strip position now holds a two-tube fluorescent fixture that lights the room with a cool white point light; a few flicker (`client/lights.js`, `enclose()` in `shared/maps.js`).
- **Security cameras:** every match places 2 or 3 cameras at random wall mounts (`shared/cameras.js`, seeded by the server and sent to clients). Each swivels about 100 degrees back and forth, with a red translucent vision cone you can see in the world and as a wedge on the minimap. Anyone inside a cone with a clear line of sight is exposed to everyone on the map for 5 seconds (refreshed while they stay in view): a red EXPOSED marker, a minimap blip, an alarm beep and a toast. Detection is server-authoritative (`tickCameras` in `server/room.js`); spawn-protected players are ignored and dying clears exposure. Tune `CAM` in `shared/cameras.js` (range, cone angle, sweep speed, exposure time). Tests: `test/cameras.js`.

## Lofted gun models

Gun bodies are no longer stacks of rounded boxes. A new primitive, `L(...)` / `genPath` (`client/geom.js`), sweeps a superellipse cross-section along a path with smooth normals and metre-scaled texture coordinates, and `zl` / `vl` / `bl` helpers in `client/guns.js` build tapered receivers, round handguards, contoured pistol grips, curved magazines (AK, MP5, STANAG), shaped wooden stocks and barrel sleeves from real-world proportions (Glock, Colt Python, Desert Eagle, Uzi, MP5, P90, AK-47, M4A1, AUG, Benelli M4, Mossberg 500, SPAS-12, Arctic Warfare, RPG-7, 1911). Rails, serrations, sights, controls and the micro-detail still sit on top. Steel, polymer and walnut textures were re-authored (fine matte stipple, straight grain), and metal reflections are toned down. Handgun slides now extend back over the grip like the real pistols, and the default iron sights have proper bases.
