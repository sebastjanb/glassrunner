'use strict';

/* Glass Runner — three-lane endless runner for Meta Ray-Ban Display glasses.
   600×600 additive display. Flat-coloured shapes in simple perspective: track,
   houses, wires, trains. Input is the D-pad plus pinch:
     Left / Right  change lane      Up    jump (low barriers)
     Down          slide (high bars)
     Pinch         start, pause, continue
   Trains fill a lane: go around them. Back leaves the app (browser history);
   the game pauses when hidden. */

const VERSION = '1.1.0';
const HORIZON = 170, GROUND = 545, CX = 300;
const DEPTH = 9;            // perspective strength: bigger is flatter
const LANE = 132;           // lane spacing at the player, px
const UNIT = 62;            // one world unit of height at the player, px
const FAR = 70;             // things appear at this distance
const JUMP_TIME = 0.62, JUMP_HEIGHT = 1.7, SLIDE_TIME = 0.62;
const START_SPEED = 13, MAX_SPEED = 27, SPEED_UP = 0.16;   // units per second, gain per second

const canvas = document.getElementById('game');
const g = canvas.getContext('2d');

let state, things, coins, player, speed, travelled, picked, best, lastRowEnd, last = 0;

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

// Everything is flat-coloured shapes, drawn far to near. No images, no
// shadows, no per-frame gradients: the glasses' processor is small.

const SIDE = 1.62 * LANE;          // edge of the track bed
const WALL = 2.45 * LANE;          // where the buildings stand
const WIRE = 7;                    // height of the overhead wires
const BLOCK = 10;                  // one building every ten units
const HOUSES = ['#b5523c', '#3f7fb0', '#c48a3a', '#5a9a6a', '#8a5aa8', '#a8504e', '#4f8f96'];
let sky = null;

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

// A flat rectangle standing across the track at distance z.
function board(x0, x1, y0, y1, z, fill, stroke) {
  quad(project(x0, y0, z), project(x1, y0, z), project(x1, y1, z), project(x0, y1, z), fill, stroke);
}

// The same answer for the same building every frame, without storing any.
const chance = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

function drawSky() {
  if (!sky) {
    sky = g.createLinearGradient(0, 0, 0, HORIZON);
    sky.addColorStop(0, '#06122a');
    sky.addColorStop(1, '#2a5f96');
  }
  g.fillStyle = sky;
  g.fillRect(0, 0, 600, HORIZON);
  // Open ground beyond the walls: dark, so the scene has no holes.
  g.fillStyle = '#0c1830';
  g.fillRect(0, HORIZON, 600, 600 - HORIZON);
  // Far skyline, standing still.
  g.fillStyle = '#1b3f6b';
  for (let i = 0; i < 16; i++) {
    const h = 12 + chance(i + 50) * 46;
    g.fillRect(i * 38 - 4, HORIZON - h, 30, h);
  }
}

function drawGround(dist) {
  // Track bed.
  quad(project(-SIDE, 0, -3), project(SIDE, 0, -3), project(SIDE, 0, FAR), project(-SIDE, 0, FAR), '#2c1b10');
  // Pavements on both sides.
  for (const sgn of [-1, 1]) {
    quad(project(sgn * SIDE, 0, -3), project(sgn * WALL, 0, -3), project(sgn * WALL, 0, FAR), project(sgn * SIDE, 0, FAR), '#4a4f5c');
  }
  // Sleepers slide toward the player: this is what reads as speed.
  g.fillStyle = '#8a5730';
  g.beginPath();
  for (let z = 3 - dist % 3; z < FAR; z += 3) {
    for (let lane = 0; lane < 3; lane++) {
      const x = laneX(lane), a = project(x - 0.43 * LANE, 0, z), b = project(x + 0.43 * LANE, 0, z);
      const c = project(x + 0.43 * LANE, 0, z + 0.8), d = project(x - 0.43 * LANE, 0, z + 0.8);
      g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath();
    }
  }
  g.fill();
  // Rails: two bright bars per lane, thinning toward the horizon.
  g.fillStyle = '#cdd6e0';
  g.beginPath();
  for (let lane = 0; lane < 3; lane++) {
    for (const side of [-0.3, 0.3]) {
      const x = laneX(lane) + side * LANE;
      const a = project(x - 4, 0, -3), b = project(x + 4, 0, -3), c = project(x + 4, 0, FAR), d = project(x - 4, 0, FAR);
      g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath();
    }
  }
  g.fill();
}

// Houses along both sides: one wall each, a few lit windows, an awning stripe.
function drawHouses(dist) {
  const first = Math.floor(dist / BLOCK);
  for (let k = first + Math.ceil(FAR / BLOCK); k >= first - 1; k--) {
    const z0 = Math.max(k * BLOCK - dist, -3), z1 = (k + 1) * BLOCK - dist - 0.6;
    if (z1 <= z0) continue;
    for (const sgn of [-1, 1]) {
      const id = k * 2 + (sgn > 0 ? 1 : 0), x = sgn * WALL;
      // Tall houses on the right, a low wall with sky above it on the left.
      const h = sgn > 0 ? 6.3 + chance(id) * 3 : 2.1 + chance(id) * 1.3;
      const wall = (y0, y1, za, zb, fill) => quad(project(x, y0, za), project(x, y0, zb), project(x, y1, zb), project(x, y1, za), fill);
      wall(0, h, z0, z1, HOUSES[Math.floor(chance(id + 9) * HOUSES.length)]);
      wall(1.5, 1.72, z0, z1, '#f2efe6');                              // awning line above the shop
      if (z0 > 46) continue;                                           // too far to see windows
      for (let w = 0; w < 3; w++) {
        const za = k * BLOCK - dist + 1.2 + w * 2.9;
        if (za < -2 || sgn < 0) continue;
        for (const y of [2.3, 4.3]) wall(y, y + 1.3, za, za + 1.7, chance(id * 7 + w + y) < 0.5 ? '#ffe3a1' : '#22364f');
      }
    }
  }
}

// Masts and the wires they carry.
function drawWires(dist) {
  g.strokeStyle = '#77839a';
  for (let z = 14 - dist % 14 + 56; z > 0; z -= 14) {
    const l0 = project(-SIDE, 0, z), l1 = project(-SIDE, WIRE + 0.4, z), r0 = project(SIDE, 0, z), r1 = project(SIDE, WIRE + 0.4, z);
    g.lineWidth = Math.max(1.5, 7 * l0.s);
    g.beginPath();
    g.moveTo(l0.x, l0.y); g.lineTo(l1.x, l1.y); g.lineTo(r1.x, r1.y); g.lineTo(r0.x, r0.y);
    g.stroke();
  }
  g.strokeStyle = '#5c6880';
  g.lineWidth = 1.5;
  g.beginPath();
  for (let lane = 0; lane < 3; lane++) {
    const a = project(laneX(lane), WIRE, -5), b = project(laneX(lane), WIRE, FAR);
    g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
  }
  g.stroke();
}

function drawTrain(t) {
  const x = laneX(t.lane), w = LANE * 0.44, top = 3.2;
  const z0 = Math.max(t.z, -1.5), z1 = t.z + t.len;
  const f = [project(x - w, 0.25, z0), project(x + w, 0.25, z0), project(x + w, top, z0), project(x - w, top, z0)];
  const b = [project(x - w, 0.25, z1), project(x + w, 0.25, z1), project(x + w, top, z1), project(x - w, top, z1)];
  quad(f[3], f[2], b[2], b[3], '#6f7a86');                                   // roof
  if (t.lane !== 1) {                                                        // the side facing the middle
    const i = t.lane === 0 ? 1 : 0, j = t.lane === 0 ? 2 : 3, sx = t.lane === 0 ? x + w : x - w;
    quad(f[i], b[i], b[j], f[j], '#8b96a2');
    quad(project(sx, 1.7, z0), project(sx, 1.7, z1), project(sx, 2.5, z1), project(sx, 2.5, z0), '#20324a');   // window band
    quad(project(sx, 0.25, z0), project(sx, 0.25, z1), project(sx, 0.6, z1), project(sx, 0.6, z0), '#c8433c'); // red skirt
  }
  quad(f[0], f[1], f[2], f[3], '#aeb8c2');                                   // front
  board(x - w, x + w, 0.25, 0.75, z0, '#c8433c');                            // red bumper
  board(x - w * 0.34, x + w * 0.34, 0.85, 2.75, z0, '#8b96a2');              // door
  board(x - w * 0.84, x - w * 0.42, 1.75, 2.6, z0, '#20324a');               // windows
  board(x + w * 0.42, x + w * 0.84, 1.75, 2.6, z0, '#20324a');
  board(x - w * 0.22, x + w * 0.22, 1.75, 2.6, z0, '#20324a');
  const lamp = project(0, 1.2, z0);
  g.fillStyle = '#fff3c4';
  for (const sgn of [-1, 1]) {
    g.beginPath();
    g.arc(CX + (x + sgn * w * 0.64) * lamp.s, lamp.y, Math.max(1.5, 7 * lamp.s), 0, Math.PI * 2);
    g.fill();
  }
}

// Striped board: alternating blocks of two colours.
function stripes(x0, x1, y0, y1, z, a, b, count) {
  const step = (x1 - x0) / count;
  for (let i = 0; i < count; i++) board(x0 + i * step, x0 + (i + 1) * step, y0, y1, z, i % 2 ? b : a);
}

function drawBarrier(t) {
  const x = laneX(t.lane), w = LANE * 0.42;
  const post = (px, y1) => board(px - 4, px + 4, 0, y1, t.z, '#59626f');
  if (t.kind === 'low') {
    // Jump over: red and white board on two short posts.
    post(x - w + 8, 0.78); post(x + w - 8, 0.78);
    stripes(x - w, x + w, 0.34, 0.78, t.z, '#e8433c', '#f4f4f4', 6);
    const lamp = project(0, 0.92, t.z);
    g.fillStyle = '#ffb300';
    for (const sgn of [-1, 1]) {
      g.beginPath();
      g.arc(CX + (x + sgn * (w - 8)) * lamp.s, lamp.y, Math.max(1.5, 6 * lamp.s), 0, Math.PI * 2);
      g.fill();
    }
    return;
  }
  // Slide under: yellow and black bar held up high.
  post(x - w + 6, 1.72); post(x + w - 6, 1.72);
  stripes(x - w, x + w, 1.24, 1.72, t.z, '#ffcf33', '#2a2a2a', 6);
}

function drawCoin(c, now) {
  const p = project(laneX(c.lane), 0.62, c.z);
  const r = 15 * p.s, wide = Math.max(1.5, r * Math.abs(Math.cos(now / 220 + c.z)));
  g.fillStyle = '#e09a00';
  g.beginPath(); g.ellipse(p.x, p.y, wide, r, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffd83f';
  g.beginPath(); g.ellipse(p.x, p.y, wide * 0.72, r * 0.72, 0, 0, Math.PI * 2); g.fill();
}

// The runner, seen from behind: hooded top, backpack, white shoes.
function drawPlayer() {
  const p = project((player.pos - 1) * LANE, height(), 0);
  const x = p.x, y = p.y, h = height();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // Shadow on the track: tells how high the jump is.
  g.fillStyle = 'rgba(0,0,0,.55)';
  g.beginPath();
  g.ellipse(x, GROUND + 5, 36 - h * 8, 9 - h * 2, 0, 0, Math.PI * 2);
  g.fill();

  const TOP = '#ff8a3d', TOP_DARK = '#d9661f', LEGS = '#2f5fd0', SHOE = '#ffffff';
  if (player.slide > 0) {
    // Sliding: low on the back, feet first.
    g.strokeStyle = LEGS; g.lineWidth = 15;
    g.beginPath(); g.moveTo(x, y - 14); g.lineTo(x + 34, y - 12); g.stroke();
    g.strokeStyle = TOP; g.lineWidth = 26;
    g.beginPath(); g.moveTo(x - 24, y - 18); g.lineTo(x + 2, y - 16); g.stroke();
    g.fillStyle = TOP_DARK;
    g.beginPath(); g.arc(x - 42, y - 22, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = SHOE;
    g.beginPath(); g.ellipse(x + 42, y - 12, 10, 7, 0, 0, Math.PI * 2); g.fill();
    return;
  }
  const air = player.jump > 0;
  const swing = air ? 0.85 : Math.sin(player.run * 2.2);
  const footL = { x: x - 8 - swing * 15, y: y - 6 - Math.max(0, swing) * 16 - (air ? 12 : 0) };
  const footR = { x: x + 8 + swing * 15, y: y - 6 - Math.max(0, -swing) * 16 - (air ? 4 : 0) };
  g.strokeStyle = LEGS; g.lineWidth = 13;
  g.beginPath();
  g.moveTo(x - 8, y - 48); g.lineTo(footL.x, footL.y);
  g.moveTo(x + 8, y - 48); g.lineTo(footR.x, footR.y);
  g.stroke();
  g.fillStyle = SHOE;
  for (const f of [footL, footR]) { g.beginPath(); g.ellipse(f.x, f.y + 3, 11, 7, 0, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = TOP; g.lineWidth = 11;                               // arms
  g.beginPath();
  g.moveTo(x - 19, y - 90); g.lineTo(x - 29, y - 64 + swing * 13);
  g.moveTo(x + 19, y - 90); g.lineTo(x + 29, y - 64 - swing * 13);
  g.stroke();
  g.fillStyle = TOP;                                                   // body
  g.beginPath(); g.roundRect(x - 20, y - 100, 40, 58, 14); g.fill();
  g.fillStyle = TOP_DARK;                                              // backpack
  g.beginPath(); g.roundRect(x - 12, y - 92, 24, 32, 8); g.fill();
  g.fillStyle = TOP;                                                   // hood
  g.beginPath(); g.arc(x, y - 116, 17, 0, Math.PI * 2); g.fill();
}

function render(now) {
  const dist = travelled || 0;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 600, 600);
  drawSky();
  drawGround(dist);
  drawHouses(dist);
  drawWires(dist);

  if (things) {
    // Far to near, so near things cover far ones.
    const all = things.map((t) => ({ z: t.z, t })).concat(coins.map((c) => ({ z: c.z, c })));
    all.sort((a, b) => b.z - a.z);
    let drawn = false;
    for (const item of all) {
      if (!drawn && item.z < 0 && state !== 'title') { drawPlayer(); drawn = true; }
      if (item.z >= FAR) continue;
      // Things fade in out of the distance instead of popping up.
      g.globalAlpha = Math.min(1, (FAR - item.z) / 14);
      if (item.c) { if (item.c.z > -1) drawCoin(item.c, now); }
      else if (item.t.kind === 'train') drawTrain(item.t);
      else drawBarrier(item.t);
      g.globalAlpha = 1;
    }
    if (!drawn && state !== 'title') drawPlayer();
  }

  // Score plates: dark, so the numbers stay readable over the sky.
  g.fillStyle = 'rgba(0,0,0,.6)';
  for (const [x, w] of [[12, 150], [225, 150], [438, 150]]) { g.beginPath(); g.roundRect(x, 8, w, 60, 14); g.fill(); }
  label('SCORE', 24, 30, 15, '#a9adb3');
  label(String(things ? score() : 0), 24, 58, 28);
  label('COINS', 300, 30, 15, '#a9adb3', 'center');
  label(String(picked || 0), 300, 58, 28, '#ffd83f', 'center');
  label('BEST', 576, 30, 15, '#a9adb3', 'right');
  label(String(Math.max(best, things ? score() : 0)), 576, 58, 28, '#f4f4f4', 'right');

  const banner = (title, colour, sub, hint) => {
    g.fillStyle = 'rgba(0,0,0,.86)';
    g.beginPath(); g.roundRect(80, 206, 440, hint ? 196 : 136, 24); g.fill();
    label(title, 300, 264, 38, colour, 'center');
    if (Math.floor(now / 600) % 2 === 0) label(sub, 300, 314, 22, '#f4f4f4', 'center');
    if (hint) {
      label('Swipe left / right: change lane', 300, 354, 17, '#a9adb3', 'center');
      label('Up: jump   ·   Down: slide', 300, 378, 17, '#a9adb3', 'center');
    }
  };
  if (state === 'title') banner('GLASS RUNNER', '#ff8a3d', 'Pinch to run', true);
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
