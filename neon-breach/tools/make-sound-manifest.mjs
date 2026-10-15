#!/usr/bin/env node
// Builds client/sounds/manifest.json from the audio files in client/sounds/ using a simple naming convention, so a downloaded sound pack
// (for example CC0 clips from freesound.org) can be dropped in without editing JSON by hand.
//
//   <name>[_<variant>].<ext>      ->  sound <name>            e.g.  hurt.wav, hurt_2.wav, reload_magout.ogg -> "reload_magout" (see ALIASES)
//   gun_<weapon>[_<variant>].ext  ->  "gun:<weapon>"          e.g.  gun_m4.ogg, gun_m4_2.ogg, gun_sniper.wav
//   die_<n>.ext / dieo_<n>.ext    ->  "die" (your own death) / "dieo" (other players dying)
//
// Run:  node tools/make-sound-manifest.mjs
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'sounds');
// reload_<cue>.ext is a friendlier spelling of the animation cue names
const ALIASES = { reload_magout: 'magout', reload_magin: 'magin', reload_rack: 'rack', reload_shell: 'shell', reload_pump: 'pump', reload_bolt: 'bolt', reload_cyl: 'cyl' };
const man = {};
for (const f of readdirSync(dir).sort()) {
  const ext = extname(f).toLowerCase(); if (!['.ogg', '.wav', '.mp3', '.m4a', '.flac'].includes(ext)) continue;
  let base = f.slice(0, -ext.length).replace(/[ -]/g, '_');
  const gun = /^gun_([a-z0-9]+?)(?:_\d+)?$/.exec(base);
  let name;
  if (gun) name = 'gun:' + gun[1]; else { base = base.replace(/_\d+$/, ''); name = ALIASES[base] || base; }
  (man[name] ||= []).push(f);
}
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(man, null, 2) + '\n');
console.log(`Wrote manifest.json with ${Object.keys(man).length} sounds (${Object.values(man).flat().length} files).`);
for (const [k, v] of Object.entries(man)) console.log(' ', k.padEnd(14), v.join(', '));
