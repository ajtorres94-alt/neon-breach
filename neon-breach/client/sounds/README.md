# Optional recorded sounds

The game synthesises all of its audio, but any sound can be replaced by a recording. Put audio files (.ogg, .wav, .mp3) in this folder, then run

    node tools/make-sound-manifest.mjs

which builds `manifest.json` from the file names (or edit the manifest by hand). Names follow this convention; add `_2`, `_3`... for random variants:

| File name | Sound |
|---|---|
| `gun_<weapon>.ogg` | gunshot: pistol, revolver, deagle, smg, mp5, p90, rifle, m4, aug, shotgun, mossberg, spas, sniper, launcher, golden |
| `reload_magout.wav`, `reload_magin.wav`, `reload_rack.wav` | magazine out / in / charging handle (pistols, SMGs, rifles) |
| `reload_cyl.wav`, `eject.wav`, `loader.wav`, `cylclose.wav` | revolver cylinder, spent cases, speed loader, closing |
| `reload_shell.wav`, `reload_pump.wav` | shotgun shell in / pump |
| `boltup.wav`, `boltback.wav`, `boltfwd.wav`, `bolt.wav` | sniper bolt cycle |
| `rocketin.wav`, `rocketlock.wav` | launcher reload |
| `reload.wav` | one single clip played at the start of any reload (replaces the per-action cues) |
| `die.wav` / `dieo.wav` / `thud.wav` | your own death / another player's death grunt / body hitting the floor |
| `hurt`, `hit`, `headshot`, `kill`, `pickup`, `weapon`, `empty`, `jump`, `land`, `step`, `mine`, `boom`, `melee`, `meleehit`, `throw`, `click` | everything else |

## Sourcing sounds (freesound.org)

freesound.org does not allow automated downloading and every download needs a (free) login, so the game cannot fetch sounds itself.
Download clips by hand instead:

1. Sign in at freesound.org and search e.g. "rifle shot", "pistol reload", "shotgun pump", "male death grunt", "body fall".
2. Filter by **License: Creative Commons 0** (no attribution needed). Clips under CC-BY need a credit line, CC-BY-NC is not allowed for a public game.
3. Save them here using the names above, run `node tools/make-sound-manifest.mjs`, and commit.
4. For any CC-BY clip add a line to `client/sounds/CREDITS.md` (title, author, link, license).

Do not use ripped film or game audio in a game you publish.
