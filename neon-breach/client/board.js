// Scoreboard HTML, shared by the in-match scoreboard (Tab) and the end-of-match screen.
import { teamInfo, OPERATORS } from './settings.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function kd(p) { return p.d ? (p.k / p.d).toFixed(2) : p.k.toFixed(2); }

/**
 * players: [{id,name,team,bot,op,k,d,a,cp,rt,sc}]; mode: 'dm'|'tdm'|'ctf'|'koth'|'gg'|'kc'
 * teamScore: [n,n]; myId highlights the viewer; winner: optional {type,id} for the end screen.
 */
export function boardHTML({ players, teamMode, mode, myId, teamScore = [0, 0], winner = null }) {
  const col = (p) => {
    const trim = OPERATORS[p.op % OPERATORS.length].trim.map(c => Math.round(c * 255)).join(',');
    return `rgb(${trim})`;
  };
  const objHead = mode === 'ctf' ? '<th>Caps</th><th>Ret</th>' : mode === 'kc' ? '<th>Intel</th>' : mode === 'koth' ? '' : '';
  const objCells = (p) => mode === 'ctf' ? `<td>${p.cp}</td><td>${p.rt}</td>` : mode === 'kc' ? `<td>${p.sc}</td>` : '';

  const row = (p, i, shape) => `<tr class="${p.id === myId ? 'me' : ''}${p.alive === false ? ' dead' : ''}">
    <td class="rank">${i + 1}</td>
    <td class="who"><i class="dot" style="background:${col(p)}"></i>${shape ? `<b class="shape">${shape}</b>` : ''}${esc(p.name)}${p.bot ? ' <em>BOT</em>' : ''}</td>
    ${teamMode ? '' : `<td>${p.sc}</td>`}<td>${p.k}</td>${teamMode ? `<td>${p.a}</td>` : ''}<td>${p.d}</td>${teamMode ? objCells(p) : `<td>${kd(p)}</td>`}</tr>`;

  if (!teamMode) {
    const list = [...players].sort((a, b) => b.sc - a.sc || b.k - a.k || a.d - b.d);
    return `<table class="board"><thead><tr><th></th><th>Operator</th><th>Score</th><th>K</th><th>D</th><th>K/D</th></tr></thead>
      <tbody>${list.map((p, i) => row(p, i)).join('')}</tbody></table>`;
  }
  const out = [];
  for (const t of [0, 1]) {
    const ti = teamInfo(t);
    const list = players.filter(p => p.team === t).sort((a, b) => b.k - a.k || a.d - b.d);
    const won = winner && winner.type === 'team' && winner.id === t;
    out.push(`<div class="teamtbl ${won ? 'won' : ''}" style="--tc:${ti.css}">
      <div class="teamhead"><span>${ti.shape} ${ti.name}</span><strong>${teamScore[t]}</strong>${won ? '<em>WINNER</em>' : ''}</div>
      <table class="board"><thead><tr><th></th><th>Operator</th><th>K</th><th>A</th><th>D</th>${objHead}</tr></thead>
      <tbody>${list.map((p, i) => row(p, i, '')).join('')}</tbody></table></div>`);
  }
  return `<div class="teams">${out.join('')}</div>`;
}
