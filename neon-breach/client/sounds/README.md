# Optional recorded sounds

The game synthesises all of its audio, but any sound can be replaced by a recording. Put audio files (.ogg, .wav, .mp3) in this folder and
list them in `manifest.json`, e.g.

```json
{
  "gun:m4": ["m4_a.ogg", "m4_b.ogg"],
  "gun:shotgun": "shotgun.wav",
  "reload": "reload.ogg",
  "boom": "explosion.ogg"
}
```

Names: `gun:<weapon id>` (pistol, smg, rifle, shotgun, sniper, revolver, deagle, mp5, p90, aug, m4, mossberg, spas, launcher, golden),
`reload`, `empty`, `hit`, `headshot`, `kill`, `hurt`, `die`, `pickup`, `weapon`, `jump`, `land`, `step`, `mine`, `boom`, `melee`, `meleehit`, `throw`, `click`, ...

Only use audio you have the rights to (your own recordings, CC0 / royalty-free libraries such as freesound.org's CC0 filter, or purchased
effects packs). Do not use ripped film or game audio in a game you publish.
