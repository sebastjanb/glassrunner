'use strict';

/* Glass Runner — three-lane endless runner for Meta Ray-Ban Display glasses.
   600×600 additive display: black is transparent, so the track is drawn as
   bright lines on black. Input is the D-pad plus pinch:
     Left / Right  change lane      Up    jump (low barriers)
     Down          slide (high bars)
     Pinch         start, pause, continue
   Trains fill a lane: go around them. Back leaves the app (browser history);
   the game pauses when hidden. */

const VERSION = '1.0.0';
const HORIZON = 170, GROUND = 545, CX = 300;
const DEPTH = 9;            // perspective strength: bigger is flatter
const LANE = 132;           // lane spacing at the player, px
const UNIT = 62;            // one world unit of height at the player, px
const FAR = 70;             // things appear at this distance
const JUMP_TIME = 0.62, JUMP_HEIGHT = 1.7, SLIDE_TIME = 0.62;
const START_SPEED = 13, MAX_SPEED = 27, SPEED_UP = 0.16;   // units per second, gain per second

const canvas = document.getElementById('game');
const g = canvas.getContext('2d');

let state, things, coins, player, speed, travelled, picked, best, lastRowEnd, last = 0, stripes = 0;

try { best = +localStorage.getItem('gr.best') || 0; } catch (e) { best = 0; }

/* ------------------------------------------------------------- projection */

// World: x in px at the player's distance, y up in units, z ahead in units.
function project(x, y, z) {
  const s = DEPTH / (DEPTH + Math.max(z, -DEPTH * 0.6));
  return { x: CX + x * s, y: HORIZON + (GROUND - HORIZON) * s - y * UNIT * s, s };
}
const laneX = (lane) => (lane - 1) * LANE;

/* ------------------------------------------------------------------ world */

function reset() {
  things = [];      // { kind: 'train' | 'low' | 'high', lane, z, len }
  coins = [];       // { lane, z }
  player = { lane: 1, pos: 1, jump: 0, slide: 0, run: 0 };
  speed = START_SPEED;
  travelled = 0;
  picked = 0;
  lastRowEnd = 34;  // a clear stretch to start with
  openBefore = [0, 1, 2];
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// One row of obstacles across the three lanes. At least one lane never holds a
// train, and a row is never more than one lane change away from wherever the
// runner could be after the row before it.
let openBefore = [0, 1, 2];   // lanes without a train in the previous row

function addRow() {
  // Reaction room grows with speed: a good second between rows, more early on.
  const gap = Math.max(16, speed * 1.05);
  const z = lastRowEnd + gap;
  const count = Math.random() < 0.25 ? 0 : Math.random() < 0.6 ? 1 : 2;
  let blocked;
  if (count === 2) {
    // One open lane: it must be next to (or the same as) every lane that was open before.
    const ok = [0, 1, 2].filter((f) => openBefore.every((l) => Math.abs(l - f) <= 1));
    const open = pick(ok);
    blocked = [0, 1, 2].filter((l) => l !== open);
  } else {
    blocked = count ? [pick([0, 1, 2])] : [];
  }
  let longest = 0;
  for (let lane = 0; lane < 3; lane++) {
    if (blocked.includes(lane)) {
      const len = 9 + Math.floor(Math.random() * 3) * 4;
      things.push({ kind: 'train', lane, z, len });
      longest = Math.max(longest, len);
      continue;
    }
    const kind = pick(['low', 'high', 'free', count === 2 ? 'free' : 'low']);
    if (kind !== 'free') things.push({ kind, lane, z, len: 0.5 });
  }
  openBefore = [0, 1, 2].filter((l) => !blocked.includes(l));
  // A line of coins in the clear stretch after the row.
  const lane = Math.floor(Math.random() * 3);
  for (let i = 0; i < 5; i++) coins.push({ lane, z: z + longest + 3 + i * 1.7 });
  lastRowEnd = z + longest;
}

function over() {
  state = 'over';
  const total = score();
  if (total > best) {
    best = total;
    try { localStorage.setItem('gr.best', String(best)); } catch (e) { /* storage may be gone */ }
  }
}

const score = () => Math.floor(travelled) + picked * 10;
const height = () => (player.jump > 0 ? JUMP_HEIGHT * 4 * (player.jump / JUMP_TIME) * (1 - player.jump / JUMP_TIME) : 0);

function tick(dt) {
  if (state !== 'play') return;
  speed = Math.min(MAX_SPEED, speed + SPEED_UP * dt);
  const move = speed * dt;
  travelled += move;
  stripes = (stripes + move) % 3;
  player.run += move;

  // Lane change is a quick glide, not a jump cut.
  const d = player.lane - player.pos;
  player.pos += Math.sign(d) * Math.min(Math.abs(d), dt * 9);
  if (player.jump > 0) { player.jump += dt; if (player.jump >= JUMP_TIME) player.jump = 0; }
  if (player.slide > 0) player.slide = Math.max(0, player.slide - dt);

  lastRowEnd -= move;
  for (const t of things) t.z -= move;
  for (const c of coins) c.z -= move;
  things = things.filter((t) => t.z + t.len > -3);
  coins = coins.filter((c) => c.z > -2 && !c.got);
  while (lastRowEnd < FAR) addRow();

  const lane = Math.round(player.pos);
  const h = height();
  for (const c of coins) {
    if (c.lane === lane && Math.abs(c.z) < 0.9 && h < 1.3) { c.got = true; picked++; }
  }
  for (const t of things) {
    if (t.lane !== lane || t.z > 0.5 || t.z + t.len < -0.5) continue;
    if (t.kind === 'train' || (t.kind === 'low' && h < 0.75) || (t.kind === 'high' && player.slide <= 0)) return over();
  }
}

/* ---------------------------------------------------------------- drawing */

function label(text, x, y, size, colour, align) {
  g.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  g.fillStyle = colour || '#f4f4f4';
  g.textAlign = align || 'left';
  g.fillText(text, x, y);
}

function quad(a, b, c, d, fill, stroke) {
  g.beginPath();
  g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.stroke(); }
}

function drawTrack() {
  g.lineWidth = 2;
  // Rails: two per lane, running to the horizon.
  g.strokeStyle = '#5b6b8c';
  g.beginPath();
  for (let lane = 0; lane < 3; lane++) {
    for (const side of [-0.3, 0.3]) {
      const a = project(laneX(lane) + side * LANE, 0, -2), b = project(laneX(lane) + side * LANE, 0, FAR);
      g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
    }
  }
  g.stroke();
  // Sleepers slide toward the player: this is what reads as speed.
  g.strokeStyle = '#3b465e';
  g.beginPath();
  for (let z = 3 - stripes; z < FAR; z += 3) {
    for (let lane = 0; lane < 3; lane++) {
      const a = project(laneX(lane) - 0.4 * LANE, 0, z), b = project(laneX(lane) + 0.4 * LANE, 0, z);
      g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
    }
  }
  g.stroke();
  // Posts along both sides.
  g.strokeStyle = '#4d7dff';
  g.beginPath();
  for (let z = 6 - (stripes * 2) % 6; z < FAR; z += 6) {
    for (const x of [-2.15 * LANE, 2.15 * LANE]) {
      const a = project(x, 0, z), b = project(x, 2.4, z);
      g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
    }
  }
  g.stroke();
}

function drawThing(t) {
  const x = laneX(t.lane), w = LANE * 0.42;
  g.lineWidth = 3;
  g.lineJoin = 'round';
  if (t.kind === 'train') {
    const z0 = Math.max(t.z, -1.5), z1 = t.z + t.len, top = 2.5;
    const f = [project(x - w, 0, z0), project(x + w, 0, z0), project(x + w, top, z0), project(x - w, top, z0)];
    const b = [project(x - w, 0, z1), project(x + w, 0, z1), project(x + w, top, z1), project(x - w, top, z1)];
    quad(f[3], f[2], b[2], b[3], 'rgba(255,90,90,.16)', '#ff5a5a');            // roof
    if (t.lane !== 1) {                                                       // the side facing the middle
      const i = t.lane === 0 ? 1 : 0, j = t.lane === 0 ? 2 : 3;
      quad(f[i], b[i], b[j], f[j], 'rgba(255,90,90,.10)', '#ff5a5a');
    }
    quad(f[0], f[1], f[2], f[3], 'rgba(255,90,90,.30)', '#ff5a5a');            // front
    // Windscreen and lights, so it reads as a train and not a wall.
    const s = f[0].s, cx = (f[0].x + f[1].x) / 2, yTop = f[3].y, hgt = f[0].y - f[3].y, half = (f[1].x - f[0].x) / 2;
    g.strokeStyle = '#ffd0d0';
    g.lineWidth = Math.max(1.5, 3 * s);
    g.strokeRect(cx - half * 0.7, yTop + hgt * 0.14, half * 1.4, hgt * 0.3);
    g.fillStyle = '#ffe9a8';
    for (const sgn of [-1, 1]) {
      g.beginPath();
      g.arc(cx + sgn * half * 0.6, yTop + hgt * 0.8, Math.max(1.5, 6 * s), 0, Math.PI * 2);
      g.fill();
    }
    return;
  }
  const low = t.kind === 'low';
  const y0 = low ? 0 : 1.25, y1 = low ? 0.7 : 1.75, colour = low ? '#ffc23d' : '#c77bff';
  const a = project(x - w, y0, t.z), b = project(x + w, y0, t.z), c = project(x + w, y1, t.z), d = project(x - w, y1, t.z);
  quad(a, b, c, d, low ? 'rgba(255,194,61,.28)' : 'rgba(199,123,255,.28)', colour);
  // Warning stripes.
  g.beginPath();
  for (let i = 1; i < 4; i++) {
    const u = i / 4;
    g.moveTo(a.x + (b.x - a.x) * u, a.y); g.lineTo(d.x + (c.x - d.x) * u, d.y);
  }
  g.stroke();
  if (!low) {
    // Posts hold the bar up; the gap under it is where the runner slides.
    g.beginPath();
    for (const px of [x - w, x + w]) {
      const p0 = project(px, 0, t.z), p1 = project(px, y0, t.z);
      g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y);
    }
    g.stroke();
  }
}

function drawCoin(c, now) {
  const p = project(laneX(c.lane), 0.55, c.z);
  const r = 13 * p.s, squash = Math.abs(Math.cos(now / 220 + c.z));
  g.fillStyle = '#ffd83f';
  g.beginPath();
  g.ellipse(p.x, p.y, Math.max(1.5, r * squash), r, 0, 0, Math.PI * 2);
  g.fill();
}

function drawPlayer() {
  const p = project((player.pos - 1) * LANE, height(), 0);
  const x = p.x, y = p.y;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // Shadow on the track: tells how high the jump is.
  const sh = project((player.pos - 1) * LANE, 0, 0);
  g.fillStyle = 'rgba(79,227,255,.25)';
  g.beginPath();
  g.ellipse(sh.x, sh.y + 4, 34 - height() * 8, 8, 0, 0, Math.PI * 2);
  g.fill();

  g.strokeStyle = '#4fe3ff';
  g.fillStyle = '#4fe3ff';
  if (player.slide > 0) {
    // Sliding: flat on the back, feet first.
    g.lineWidth = 16;
    g.beginPath(); g.moveTo(x - 30, y - 14); g.lineTo(x + 22, y - 14); g.stroke();
    g.beginPath(); g.arc(x - 40, y - 20, 13, 0, Math.PI * 2); g.fill();
    return;
  }
  const swing = player.jump > 0 ? 0.9 : Math.sin(player.run * 2.2);
  g.lineWidth = 11;
  g.beginPath();                                                  // legs
  g.moveTo(x - 6, y - 46); g.lineTo(x - 6 - swing * 16, y - 6 - Math.max(0, swing) * 14);
  g.moveTo(x + 6, y - 46); g.lineTo(x + 6 + swing * 16, y - 6 - Math.max(0, -swing) * 14);
  g.stroke();
  g.lineWidth = 9;
  g.beginPath();                                                  // arms
  g.moveTo(x - 17, y - 86); g.lineTo(x - 26, y - 62 + swing * 12);
  g.moveTo(x + 17, y - 86); g.lineTo(x + 26, y - 62 - swing * 12);
  g.stroke();
  g.beginPath();                                                  // body, seen from behind
  g.roundRect(x - 17, y - 96, 34, 54, 12);
  g.fill();
  g.beginPath(); g.arc(x, y - 112, 14, 0, Math.PI * 2); g.fill();  // head
}

function render(now) {
  g.fillStyle = '#000';
  g.fillRect(0, 0, 600, 600);
  drawTrack();

  if (things) {
    // Far to near, so near things cover far ones.
    const all = things.map((t) => ({ z: t.z, t })).concat(coins.map((c) => ({ z: c.z, c })));
    all.sort((a, b) => b.z - a.z);
    let drawn = false;
    for (const item of all) {
      if (!drawn && item.z < 0 && state !== 'title') { drawPlayer(); drawn = true; }
      if (item.t) { if (item.t.z < FAR) drawThing(item.t); } else if (item.c.z < FAR && item.c.z > -1) drawCoin(item.c, now);
    }
    if (!drawn && state !== 'title') drawPlayer();
  }

  label('SCORE', 24, 28, 16, '#a9adb3');
  label(String(things ? score() : 0), 24, 58, 30);
  label('COINS', 300, 28, 16, '#a9adb3', 'center');
  label(String(picked || 0), 300, 58, 30, '#ffd83f', 'center');
  label('BEST', 576, 28, 16, '#a9adb3', 'right');
  label(String(Math.max(best, things ? score() : 0)), 576, 58, 30, '#f4f4f4', 'right');

  const banner = (title, colour, sub, hint) => {
    g.fillStyle = 'rgba(0,0,0,.86)';
    g.fillRect(90, 210, 420, hint ? 190 : 140);
    label(title, 300, 266, 38, colour, 'center');
    if (Math.floor(now / 600) % 2 === 0) label(sub, 300, 316, 22, '#f4f4f4', 'center');
    if (hint) {
      label('Swipe left / right: change lane', 300, 356, 17, '#a9adb3', 'center');
      label('Up: jump   ·   Down: slide', 300, 380, 17, '#a9adb3', 'center');
    }
  };
  if (state === 'title') banner('GLASS RUNNER', '#4fe3ff', 'Pinch to run', true);
  else if (state === 'over') banner('CRASH', '#ff5a5a', 'Pinch to run again', false);
  else if (state === 'pause') banner('PAUSED', '#fff', 'Pinch to continue', false);
}

/* ------------------------------------------------------------------ input */

document.addEventListener('keydown', (e) => {
  const k = e.key;
  if (!k.startsWith('Arrow') && k !== 'Enter' && k !== ' ') return;
  e.preventDefault();
  if (k === 'Enter' || k === ' ') {
    if (e.repeat) return;
    if (state === 'play') state = 'pause';
    else if (state === 'pause') state = 'play';
    else { reset(); state = 'play'; }
    return;
  }
  if (state !== 'play') return;
  if (k === 'ArrowLeft') player.lane = Math.max(0, player.lane - 1);
  else if (k === 'ArrowRight') player.lane = Math.min(2, player.lane + 1);
  else if (k === 'ArrowUp') { if (!player.jump) { player.jump = 0.0001; player.slide = 0; } }
  else if (k === 'ArrowDown') { player.jump = 0; player.slide = SLIDE_TIME; }   // also cuts a jump short
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'play') state = 'pause';
});

/* ------------------------------------------------------------------- loop */

state = 'title';
function frame(now) {
  // A long gap (hidden tab, slow frame) must not carry the runner through an obstacle.
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  tick(dt);
  render(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
}
