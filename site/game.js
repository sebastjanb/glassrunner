'use strict';

/* Glass Runner — three-lane endless runner for Meta Ray-Ban Display glasses.
   600×600 additive display. Flat-coloured shapes in simple perspective: track,
   houses, wires, trains. Input is the D-pad plus pinch:
     Left / Right  change lane      Up    jump (low barriers)
     Down          slide (high bars)
     Pinch         start, pause, continue
   Trains fill a lane: go around them. Back leaves the app (browser history);
   the game pauses when hidden. */

const VERSION = '1.2.0';
const HORIZON = 196, GROUND = 548, CX = 300;
const DEPTH = 7.4;          // perspective strength: bigger is flatter
const CURVE = 0.0013;       // the world falls away with distance, like running over a hill
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

// The camera rides behind the runner: it drifts sideways with the lane, lifts
// a little in a jump and bobs with each step. Near things shift more than far
// ones, which is what makes the scene read as deep.
const cam = { x: 0, y: 0 };

// World: x in px at the player's distance, y up in units, z ahead in units.
function project(x, y, z) {
  const zc = Math.max(z, -DEPTH * 0.6);
  const s = DEPTH / (DEPTH + zc);
  const drop = zc > 0 ? CURVE * zc * zc : 0;
  return { x: CX + (x - cam.x) * s, y: HORIZON + (GROUND - HORIZON) * s - (y - cam.y - drop) * UNIT * s, s };
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
  const base = HORIZON + 44;   // the curved ground sinks below the true horizon
  if (!sky) {
    sky = g.createLinearGradient(0, 0, 0, base);
    sky.addColorStop(0, '#050e24');
    sky.addColorStop(1, '#2f6aa6');
  }
  g.fillStyle = sky;
  g.fillRect(0, 0, 600, base);
  // Moon and a few stars; they stay put, so everything else moves against them.
  g.fillStyle = '#f3f0dc';
  g.beginPath(); g.arc(96 - cam.x * 0.02, 112, 20, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 14; i++) g.fillRect(chance(i + 3) * 600, 78 + chance(i + 31) * 90, 2, 2);
  // Far skyline in two layers that slide at different rates.
  for (const [colour, rate, tall, seed] of [['#1f4878', 0.04, 34, 50], ['#173a63', 0.09, 58, 90]]) {
    g.fillStyle = colour;
    for (let i = -1; i < 17; i++) {
      const h = 14 + chance(i + seed) * tall;
      g.fillRect(i * 38 - cam.x * rate, base - h, 31, h);
    }
  }
  // Open ground beyond the walls: dark, so the scene has no holes.
  g.fillStyle = '#0c1830';
  g.fillRect(0, base, 600, 600 - base);
}

function drawGround(dist) {
  // Track bed and pavements, in slices so they follow the curve of the ground.
  for (let z = FAR - 10; z >= -10; z -= 10) {
    const z0 = Math.max(z, -3), z1 = z + 10.2;
    quad(project(-SIDE, 0, z0), project(SIDE, 0, z0), project(SIDE, 0, z1), project(-SIDE, 0, z1), '#2c1b10');
    for (const sgn of [-1, 1]) {
      quad(project(sgn * SIDE, 0.18, z0), project(sgn * (WALL + 60), 0.18, z0), project(sgn * (WALL + 60), 0.18, z1), project(sgn * SIDE, 0.18, z1), '#4a4f5c');
      // Kerb: the pavement is a step up from the track.
      quad(project(sgn * SIDE, 0, z0), project(sgn * SIDE, 0, z1), project(sgn * SIDE, 0.18, z1), project(sgn * SIDE, 0.18, z0), '#30343d');
    }
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
  // Rails stand a little above the sleepers: a dark flank first, the bright top over it.
  for (const [lift, half, colour] of [[0, 6, '#5d6672'], [0.1, 3.5, '#dfe7ef']]) {
  g.fillStyle = colour;
  g.beginPath();
  for (let lane = 0; lane < 3; lane++) {
    for (const side of [-0.3, 0.3]) {
      const x = laneX(lane) + side * LANE;
      const a = project(x - half, lift, -3), b = project(x + half, lift, -3), c = project(x + half, lift, FAR), d = project(x - half, lift, FAR);
      g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath();
    }
  }
  g.fill();
  }
}

// Darker or lighter version of a colour: each face of a box gets its own shade.
const shadeCache = new Map();
function shade(hex, k) {
  const key = hex + k;
  let out = shadeCache.get(key);
  if (!out) {
    const n = parseInt(hex.slice(1), 16);
    const part = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    out = `rgb(${part(n >> 16)},${part((n >> 8) & 255)},${part(n & 255)})`;
    shadeCache.set(key, out);
  }
  return out;
}

// Houses are boxes: a wall along the track, an end wall facing the runner and,
// where it is low enough to see, a roof. They stand at different distances
// from the track with gaps between them, so their corners show.
function drawHouses(dist) {
  const first = Math.floor(dist / BLOCK);
  for (let k = first + Math.ceil(FAR / BLOCK); k >= first - 1; k--) {
    for (const sgn of [-1, 1]) {
      const id = k * 2 + (sgn > 0 ? 1 : 0);
      const start = k * BLOCK - dist, len = 6.4 + chance(id + 3) * 3.2;
      const z0 = Math.max(start, -3), z1 = start + len;
      if (z1 <= z0) continue;
      const x = sgn * (WALL + chance(id + 5) * 46), out = x + sgn * 260;
      // Tall houses on the right, low sheds with sky above them on the left.
      const h = sgn > 0 ? 6.6 + chance(id) * 3.2 : 2.0 + chance(id) * 1.6;
      const colour = HOUSES[Math.floor(chance(id + 9) * HOUSES.length)];
      // Haze: far houses sink into the night.
      g.globalAlpha = Math.min(1, (FAR + 6 - z0) / 30);
      const wall = (y0, y1, za, zb, fill) => quad(project(x, y0, za), project(x, y0, zb), project(x, y1, zb), project(x, y1, za), fill);
      if (h < 5.4) quad(project(x, h, z0), project(out, h, z0), project(out, h, z1), project(x, h, z1), shade(colour, 1.25));   // roof
      wall(0.18, h, z0, z1, colour);
      if (start > -3) quad(project(x, 0.18, z0), project(out, 0.18, z0), project(out, h, z0), project(x, h, z0), shade(colour, 0.62)); // end wall
      wall(1.5, 1.72, z0, z1, '#f2efe6');                              // awning line above the shop
      if (z0 < 44 && sgn > 0) {
        for (let w = 0; w < 3; w++) {
          const za = start + 0.9 + w * 2.1;
          if (za < -2 || za + 1.3 > z1) continue;
          for (const y of [2.4, 4.4]) wall(y, y + 1.3, za, za + 1.3, chance(id * 7 + w + y) < 0.5 ? '#ffe3a1' : '#22364f');
        }
      }
      g.globalAlpha = 1;
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

// Dark patch on the ground under something: the cheapest way to make it sit there.
function groundShadow(x0, x1, z0, z1) {
  quad(project(x0, 0.02, z0), project(x1, 0.02, z0), project(x1, 0.02, z1), project(x0, 0.02, z1), 'rgba(0,0,0,.5)');
}

function drawTrain(t) {
  const x = laneX(t.lane), w = LANE * 0.44, top = 3.2, floor = 0.45;
  const z0 = Math.max(t.z, -1.5), z1 = t.z + t.len;
  groundShadow(x - w - 10, x + w + 10, z0 - 0.4, z1);
  const f = [project(x - w, floor, z0), project(x + w, floor, z0), project(x + w, top, z0), project(x - w, top, z0)];
  const b = [project(x - w, floor, z1), project(x + w, floor, z1), project(x + w, top, z1), project(x - w, top, z1)];
  quad(f[3], f[2], b[2], b[3], '#7d8894');                                   // roof
  // Whichever side the camera can see.
  const sx = cam.x > x + w ? x + w : cam.x < x - w ? x - w : null;
  if (sx !== null) {
    const side = (y0, y1, fill) => quad(project(sx, y0, z0), project(sx, y0, z1), project(sx, y1, z1), project(sx, y1, z0), fill);
    side(0.12, floor, '#23272e');                                            // wheels and underframe
    side(floor, top, '#8b96a2');
    side(1.7, 2.5, '#20324a');                                               // window band
    side(floor, 0.8, '#c8433c');                                             // red skirt
  }
  board(x - w * 0.9, x + w * 0.9, 0.12, floor, z0, '#23272e');               // underframe
  quad(f[0], f[1], f[2], f[3], '#b4bec8');                                   // front
  board(x - w, x + w, floor, 0.9, z0, '#c8433c');                            // red bumper
  board(x - w * 0.34, x + w * 0.34, 0.95, 2.8, z0, '#8b96a2');               // door
  board(x - w * 0.84, x - w * 0.42, 1.8, 2.65, z0, '#20324a');               // windows
  board(x + w * 0.42, x + w * 0.84, 1.8, 2.65, z0, '#20324a');
  board(x - w * 0.22, x + w * 0.22, 1.8, 2.65, z0, '#20324a');
  g.fillStyle = '#fff3c4';
  for (const sgn of [-1, 1]) {
    const lamp = project(x + sgn * w * 0.64, 1.3, z0);
    g.beginPath();
    g.arc(lamp.x, lamp.y, Math.max(1.5, 7 * lamp.s), 0, Math.PI * 2);
    g.fill();
  }
}

// Striped board: alternating blocks of two colours.
function stripes(x0, x1, y0, y1, z, a, b, count) {
  const step = (x1 - x0) / count;
  for (let i = 0; i < count; i++) board(x0 + i * step, x0 + (i + 1) * step, y0, y1, z, i % 2 ? b : a);
}

function drawBarrier(t) {
  const x = laneX(t.lane), w = LANE * 0.42, deep = 0.45;
  const post = (px, y1) => board(px - 4, px + 4, 0, y1, t.z, '#59626f');
  // The top of the board, so it has thickness.
  const lid = (y, fill) => quad(project(x - w, y, t.z), project(x + w, y, t.z), project(x + w, y, t.z + deep), project(x - w, y, t.z + deep), fill);
  groundShadow(x - w, x + w, t.z - 0.3, t.z + deep + 0.3);
  if (t.kind === 'low') {
    // Jump over: red and white board on two short posts.
    post(x - w + 8, 0.78); post(x + w - 8, 0.78);
    lid(0.78, '#ffd9d6');
    stripes(x - w, x + w, 0.34, 0.78, t.z, '#e8433c', '#f4f4f4', 6);
    g.fillStyle = '#ffb300';
    for (const sgn of [-1, 1]) {
      const lamp = project(x + sgn * (w - 8), 0.92, t.z);
      g.beginPath();
      g.arc(lamp.x, lamp.y, Math.max(1.5, 6 * lamp.s), 0, Math.PI * 2);
      g.fill();
    }
    return;
  }
  // Slide under: yellow and black bar held up high. Its underside faces the runner's eye line.
  post(x - w + 6, 1.72); post(x + w - 6, 1.72);
  lid(1.72, '#fff0a8');
  stripes(x - w, x + w, 1.24, 1.72, t.z, '#ffcf33', '#2a2a2a', 6);
}

function drawCoin(c, now) {
  const sh = project(laneX(c.lane), 0.02, c.z);
  g.fillStyle = 'rgba(0,0,0,.45)';
  g.beginPath(); g.ellipse(sh.x, sh.y, 11 * sh.s, 4 * sh.s, 0, 0, Math.PI * 2); g.fill();
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
  const feet = project((player.pos - 1) * LANE, 0, 0);
  g.ellipse(feet.x, feet.y + 5, 36 - h * 8, 9 - h * 2, 0, 0, Math.PI * 2);
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
  g.fillStyle = 'rgba(0,0,0,.16)';                                     // the side away from the moon
  g.beginPath(); g.roundRect(x, y - 100, 20, 58, [0, 14, 14, 0]); g.fill();
  g.fillStyle = TOP_DARK;                                              // backpack
  g.beginPath(); g.roundRect(x - 12, y - 92, 24, 32, 8); g.fill();
  g.fillStyle = '#b8551a';
  g.beginPath(); g.roundRect(x - 12, y - 70, 24, 10, [0, 0, 8, 8]); g.fill();
  g.fillStyle = TOP;                                                   // hood
  g.beginPath(); g.arc(x, y - 116, 17, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,.22)';                               // moonlight on it
  g.beginPath(); g.arc(x - 5, y - 121, 8, 0, Math.PI * 2); g.fill();
}

function render(now) {
  const dist = travelled || 0;
  if (player && state !== 'title') {
    cam.x = (player.pos - 1) * LANE * 0.45;
    cam.y = height() * 0.22 + (state === 'play' && !player.jump && player.slide <= 0 ? Math.sin(player.run * 4.4) * 0.035 : 0) - (player.slide > 0 ? 0.25 : 0);
  }
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
