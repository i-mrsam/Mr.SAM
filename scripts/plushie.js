/**
 * Plushie — a photo you can grab and stretch like a soft toy.
 *
 * The picture is a textured grid. Each node carries a displacement `u` from
 * where it belongs, and the whole sheet obeys a damped wave equation with a
 * restoring term:
 *
 *     ü = c²∇²u − ω²·u − γ·u̇ + ν∇²u̇
 *
 * ∇²u is the skin pulling on its neighbours (so a pull drags the area around
 * it and waves travel outward on release), −ω²u is the skin's attachment to
 * the skull underneath, γ is how fast the wobble dies, and ν∇²u̇ is the
 * fleshy part: fine ripples die at once while the big slow wobble carries on.
 * The ratio c/ω is the distance a pull spreads; ω alone is the wobble pitch.
 * Working on the displacement rather than on absolute positions means the
 * sheet has no rest lengths to buckle around.
 *
 * The hand is a round brush that lives in the *deformed* picture: whatever
 * skin is under it right now moves with it, fully at the centre and less
 * toward the rim. Skin ahead of the hand piles up and skin behind it draws
 * out into a web, which is what a handful of cheek does.
 *
 * On top of the skin, the head as a whole leans toward the pull on a slower,
 * floppier spring, like a toy on a soft neck.
 *
 * Rendering is one WebGL draw. Lighting is faked from the deformation itself:
 * pulled skin lifts toward the viewer and bunched skin ridges up, and the
 * slope of that height field is used as a surface normal.
 *
 * No dependencies. Usage:
 *
 *     const plush = await createPlushie(canvas, { faces: { smile: "a.webp" } });
 */

const DEFAULTS = {
  faces: {}, // name → url. The first one is the resting face.
  hit: null, // element that receives the grab; defaults to the canvas
  grid: 72, // cells per side
  pad: 0.3, // empty margin around the image, in image widths, for skin to stretch into
  wobble: 2.3, // Hz
  reach: 0.085, // how far a pull spreads beyond the handful, in image widths
  damping: 0.14, // damping ratio: 0 rings forever, 1 doesn't wobble at all
  flesh: 0.35, // how quickly fine ripples are swallowed (0 = rubber sheet)
  grabRadius: 0.085, // size of the handful, in image widths
  maxPull: 0.6, // rubber-band limit of a pull, in image widths
  // A cursor that is merely on the face already has half a hold of it: the
  // skin under it comes along, resists, and slips free again.
  rub: 500, // how firmly a hovering cursor catches the skin (0 = not at all)
  rubRadius: 0.075, // how much skin it catches, in image widths
  rubSlip: 0.09, // how far the skin lets itself be dragged before it slips free, in image widths
  // Fingers (and pens) share the screen with scrolling, so they don't grab on
  // contact the way a mouse button does. A finger that lands on him gives the
  // skin a prod and catches it like a hovering cursor; it becomes a grab once
  // it sets off sideways, or has rested in one spot for `hold` (a long
  // press, as phones have it); a swipe up or down scrolls the page; a touch
  // that just lifts again is a tap.
  hold: 400, // ms a finger rests on him before it has hold of him (0 = never)
  prod: 1, // strength of the prod a finger landing on him gives (0 = none)
  relief: 1, // strength of the fake lighting
  sway: 1, // how much the whole head leans into a pull
  neck: { x: 0.5, y: 0.8 }, // pivot of that lean, in image space
  duotone: 0, // 0 = photo, 1 = ink/orange/paper
  frame: null, // { kind: "circle" | "square", x, y, r } in image space; the bust is clipped to it, the head pops out
  expressions: true, // pull faces when he's handled
  // Which faces those are, most wanted first; one that hasn't loaded is
  // passed over. `hovered` while a mouse rests on him, `held` the moment
  // he's grabbed, `pulled` once he's being stretched, then on letting go:
  // `tapped` after a mere touch, `dazed` after a proper pull, `fedUp` after
  // several in a row.
  reactions: {}, // { hovered: [face, …], held, pulled, tapped, dazed, fedUp }
  // Eyes that follow the cursor, and blink. `sheet` is a grid of cells, one
  // per eye pose, named in reading order by `cells`; each cell holds two
  // patches side by side, the left eye's and the right eye's, covering the
  // rectangles `eyes` ([u, v, w, h] in image space). Outside the eyes
  // themselves every patch is the resting face to the pixel, so swapping
  // patches moves nothing but the eyes. `rest` is the cell with the eyes as
  // they are, `looks` the direction each glance points in ([x, y], y down),
  // `blink` the cells with the eyes shut and, optionally, half shut.
  // `linger` is how long (ms, a range) he keeps watching a cursor that has
  // stopped before looking back at you. The theme's make-eyes.py tool builds
  // the sheet and its manifest; the tuning below has defaults (GAZE).
  // Tuning: `follow: false` stops him watching the cursor, `blinks: false`
  // stops the blinking, `blinkEvery` is the range (ms) between blinks,
  // `jumpBlink` the chance of one as his eyes jump, `cut` how long (ms) a
  // jump takes.
  gaze: null, // { sheet, grid: [cols, rows], eyes: [rect, rect], centres: [[u, v], [u, v]], cells, looks: { cell: [x, y] }, blink: { shut, half }, near, linger: [min, max] }
  // Things he does when the page has gone quiet: a yawn, a whistle, a doze.
  // Each act is a sequence of frames. A frame is [show, fade ms, hold ms] or
  // { show, fade, hold, … }, where `show` is a face or, to move only the
  // eyes, a cell of the eye sheet ("look-w", "closed", "rest"…). Extras:
  //   tilt, drop  lean the head (radians) and let it sink (image heights),
  //               easing there over the frame
  //   wake        end this frame early if the visitor does anything
  //   jolt        give him a physical jump as the frame starts; or
  //               [u, v, du, dv] for a nudge somewhere in particular
  //   hand, grip  a phantom hand: `hand` is where it is by the end of the
  //               frame ([u, v], it glides there from the previous frame's,
  //               or from the act's `handFrom`), and with `grip` it has
  //               hold of the skin, exactly as a visitor's grab would
  //   watch       his eyes follow the phantom hand during this frame
  //   optional    an eyes-only frame the act can do without, if he has no
  //               eye sheet to draw it from
  // An act's `prop` names what the phantom hand looks like ("hand", "fly");
  // drawing it is the page's job, from plush.state.ghost.
  // An act's `bob` (0–1) rocks his head from side to side while it plays.
  // `after` is how many idle seconds bring on the first act, `every` the
  // range between the next ones. `first` names the act that always opens;
  // after it they come at random, never the same one twice running.
  // `off: true`, on the whole thing or on one act, switches it off without
  // forgetting it.
  idle: null, // { acts: { name: { frames: [frame, …], bob } }, first, after, every: [min, max] }
  debug: false,
};

// How his eyes behave unless told otherwise (see `gaze` above).
const GAZE = { near: 0.24, linger: [250, 450], blinkEvery: [2400, 6200], jumpBlink: 0.07, cut: 60 };
// Options that shape him when he's created and can't be changed afterwards.
const FIXED = ["faces", "hit", "grid", "pad", "neck"];
const MAX_STEPS = 48; // most simulation steps in one frame
const HARDEST = 8; // how many times stiffer than at rest over-stretched skin can get
const GRIP = 2500; // how fast (per second) held skin takes on the hand's speed: as good as rigid
const PROD = 26; // how fast (per second) a prod draws the skin in around a fingertip
const DETAIL = 1.2; // how much finer than the screen his pictures are kept, since stretched skin is magnified
const INTERACTIVE = "a, button, input, select, textarea, label"; // what can take the pointer from him

const VERT = `
attribute vec2 aHome;
attribute vec2 aDisp;
attribute vec3 aShade;
uniform vec2 uGrid;
uniform float uPad;
varying vec2 vUv;
varying vec3 vShade;
void main() {
  vec2 p = (aHome + aDisp) / uGrid;
  vUv = aHome / uGrid * (1.0 + 2.0 * uPad) - uPad;
  vShade = aShade;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
}`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform float uMix;
uniform sampler2D uEyes;
uniform vec2 uEyeGrid;
uniform vec4 uEyeL; // the left eye's patch on the face: u, v, w, h
uniform vec4 uEyeR;
uniform vec4 uEyeCells; // from, to, half shut, shut: cell numbers, or -1 for the face as it is
uniform float uEyeMix;
uniform float uBlink; // 0 open, 0.5 half shut, 1 shut
uniform float uEye;
uniform float uRelief;
uniform float uDuotone;
uniform float uWire;
uniform vec4 uFrame; // x, y, r, kind (0 none, 1 circle, 2 square)
varying vec2 vUv;
varying vec3 vShade;

const vec3 INK = vec3(0.039, 0.039, 0.039);
const vec3 ORANGE = vec3(0.980, 0.357, 0.004);
const vec3 PAPER = vec3(1.0, 0.965, 0.92);
const vec3 LIGHT = vec3(-0.42, -0.55, 0.72);

float frameMask(vec2 uv) {
  if (uFrame.w < 0.5) return 1.0;
  vec2 d = uv - uFrame.xy;
  float aa = 0.0015;
  if (uFrame.w < 1.5) {
    // Circle, open at the top: everything above the centre line and within
    // the circle's width stays, so the head pops out of it.
    float inCircle = 1.0 - smoothstep(uFrame.z - aa, uFrame.z + aa, length(d));
    float column = (1.0 - smoothstep(uFrame.z - aa, uFrame.z + aa, abs(d.x))) * step(d.y, 0.0);
    return max(inCircle, column);
  }
  return 1.0 - smoothstep(uFrame.z - aa, uFrame.z + aa, abs(d.x));
}

// One eye's patch from a cell of the sheet (side 0 = left, 1 = right), or
// the face itself for cell -1.
vec4 eyeCell(float cell, float side, vec2 p, vec4 face) {
  if (cell < 0.0) return face;
  // Row first, with half a cell of slack, so a cell number that arrives a
  // hair under a whole number still lands in the right row.
  float row = floor((cell + 0.5) / uEyeGrid.x);
  vec2 at = vec2(cell - row * uEyeGrid.x, row);
  return vec4(texture2D(uEyes, (at + vec2((side + p.x) * 0.5, p.y)) / uEyeGrid).rgb, 1.0) * face.a;
}

void main() {
  if (uWire > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.35); return; }
  if (vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0 || vUv.y > 1.0) discard;

  vec4 tex = mix(texture2D(uTexA, vUv), texture2D(uTexB, vUv), uMix); // premultiplied
  if (uEye > 0.001) {
    vec2 a = (vUv - uEyeL.xy) / uEyeL.zw, b = (vUv - uEyeR.xy) / uEyeR.zw;
    bool left = a.x > 0.0 && a.x < 1.0 && a.y > 0.0 && a.y < 1.0;
    bool right = b.x > 0.0 && b.x < 1.0 && b.y > 0.0 && b.y < 1.0;
    if (left || right) {
      vec2 p = left ? a : b;
      float side = left ? 0.0 : 1.0;
      vec4 eyes = mix(eyeCell(uEyeCells.x, side, p, tex), eyeCell(uEyeCells.y, side, p, tex), uEyeMix);
      if (uBlink > 0.0) {
        vec4 midway = eyeCell(uEyeCells.z, side, p, tex);
        eyes = uBlink < 0.5 ? mix(eyes, midway, uBlink * 2.0) : mix(midway, eyeCell(uEyeCells.w, side, p, tex), uBlink * 2.0 - 1.0);
      }
      // The patch already equals the face around its rim; fading its last
      // few pixels only keeps neighbouring cells from bleeding in.
      vec2 rim = min(p, 1.0 - p);
      tex = mix(tex, eyes, smoothstep(0.0, 0.03, rim.x) * smoothstep(0.0, 0.045, rim.y) * uEye);
    }
  }
  float alpha = tex.a * frameMask(vUv);
  if (alpha < 0.004) discard;
  vec3 rgb = tex.rgb / max(tex.a, 0.0001);

  // Lighting from the deformation. vShade.xy is the slope of the lifted
  // skin, vShade.z how much the area here has grown (>0) or shrunk (<0).
  vec3 n = normalize(vec3(-vShade.xy * uRelief, 1.0));
  vec3 l = normalize(LIGHT);
  float lit = dot(n, l) / l.z; // 1 where the skin is flat
  float bump = 1.0 - n.z;
  rgb *= clamp(mix(1.0, lit, 0.9), 0.62, 1.35);
  // Taut skin goes pale and thin; bunched skin gets darker and ruddier.
  float stretch = clamp(vShade.z, -1.0, 2.0);
  rgb = mix(rgb, rgb * vec3(1.10, 1.07, 1.05) + 0.03, clamp(stretch * 0.5, 0.0, 0.6) * uRelief);
  rgb *= mix(vec3(1.0), vec3(0.92, 0.82, 0.80), clamp(-stretch * 1.2, 0.0, 0.7) * uRelief);
  // A soft sheen where the skin is curved toward the light.
  vec3 h = normalize(l + vec3(0.0, 0.0, 1.0));
  rgb += pow(max(dot(n, h), 0.0), 28.0) * smoothstep(0.0, 0.05, bump) * 0.16 * uRelief;

  // Duotone goes last so the lighting above stays inside the palette.
  if (uDuotone > 0.5) {
    float tone = smoothstep(0.02, 0.92, dot(rgb, vec3(0.299, 0.587, 0.114)));
    rgb = tone < 0.55 ? mix(INK, ORANGE, tone / 0.55) : mix(ORANGE, PAPER, (tone - 0.55) / 0.45);
  }

  gl_FragColor = vec4(rgb * alpha, alpha);
}`;

async function createPlushie(canvas, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  // His outline comes from the picture's own alpha, never from the edge of a
  // triangle, so multisampling would buy nothing; it and a depth buffer would
  // only cost memory, which phones are short of.
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) throw new Error("WebGL unavailable");
  // A phone can take the context away at any moment, including while his
  // first picture is still on its way; `ended` is set further down, once
  // there is something to end.
  let ended = null;
  const onLost = () => { if (ended) ended(); };
  canvas.addEventListener("webglcontextlost", onLost);
  const gone = () => Object.assign(new Error("WebGL context lost"), { lost: true });

  // The canvas is bigger than the picture by `pad` on every side; whatever
  // stylesheet sizes it reads the number from here.
  canvas.style.setProperty("--plush-pad", opt.pad);

  const G = opt.grid;
  const S = G + 1; // nodes per side
  const N = S * S;
  const cellsPerImage = () => G / (1 + 2 * opt.pad);
  const toGrid = (t) => ((t + opt.pad) / (1 + 2 * opt.pad)) * G; // image space → grid
  const toImage = (g) => (g / G) * (1 + 2 * opt.pad) - opt.pad; // grid → image space

  // --- state -----------------------------------------------------------
  const ux = new Float32Array(N), uy = new Float32Array(N);
  const vx = new Float32Array(N), vy = new Float32Array(N);
  const ax = new Float32Array(N), ay = new Float32Array(N);
  const fixed = new Uint8Array(N);
  const lift = new Float32Array(N);
  const bob = new Float32Array(N); // how much each node follows the head's lean: 1 on the head, 0 at the shoulders
  const dyn = new Float32Array(N * 5); // dx, dy, slopeX, slopeY, areaChange
  const head = { tilt: 0, tiltV: 0, x: 0, xV: 0, y: 0, yV: 0 };

  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const k = j * S + i;
      const v = toImage(j);
      // The outer rim never moves, and neither does the cut edge at the
      // bottom of the bust, so the picture stays planted where it sits.
      fixed[k] = i === 0 || j === 0 || i === G || j === G || v >= 0.985 ? 1 : 0;
      const t = Math.max(0, Math.min(1, (opt.neck.y - v) / 0.22));
      bob[k] = t * t * (3 - 2 * t);
    }
  }

  // --- GL setup --------------------------------------------------------
  const program = link(gl, VERT, FRAG);
  gl.useProgram(program);
  const loc = (n) => gl.getUniformLocation(program, n);
  const U = {
    grid: loc("uGrid"), pad: loc("uPad"), texA: loc("uTexA"), texB: loc("uTexB"), mix: loc("uMix"),
    relief: loc("uRelief"), duotone: loc("uDuotone"), wire: loc("uWire"), frame: loc("uFrame"),
    eyes: loc("uEyes"), eyeGrid: loc("uEyeGrid"), eyeL: loc("uEyeL"), eyeR: loc("uEyeR"), eyeCells: loc("uEyeCells"), eyeMix: loc("uEyeMix"),
    blink: loc("uBlink"), eye: loc("uEye"),
  };

  const home = new Float32Array(N * 2);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { home[(j * S + i) * 2] = i; home[(j * S + i) * 2 + 1] = j; }
  const homeBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, homeBuf);
  gl.bufferData(gl.ARRAY_BUFFER, home, gl.STATIC_DRAW);
  const aHome = gl.getAttribLocation(program, "aHome");
  gl.enableVertexAttribArray(aHome);
  gl.vertexAttribPointer(aHome, 2, gl.FLOAT, false, 0, 0);

  const dynBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf);
  gl.bufferData(gl.ARRAY_BUFFER, dyn, gl.DYNAMIC_DRAW);
  const aDisp = gl.getAttribLocation(program, "aDisp");
  const aShade = gl.getAttribLocation(program, "aShade");
  gl.enableVertexAttribArray(aDisp);
  gl.vertexAttribPointer(aDisp, 2, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(aShade);
  gl.vertexAttribPointer(aShade, 3, gl.FLOAT, false, 20, 8);

  // Triangles, with the diagonal flipped on alternate cells so the mesh has
  // no grain; plus a line list for the debug wireframe.
  const tris = new Uint16Array(G * G * 6);
  const lines = new Uint16Array(G * G * 4 + G * 4);
  let t = 0, ln = 0;
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const a = j * S + i, b = a + 1, c = a + S, d = c + 1;
      if ((i + j) & 1) { tris.set([a, b, d, a, d, c], t); } else { tris.set([a, b, c, b, d, c], t); }
      t += 6;
      lines.set([a, b, a, c], ln); ln += 4;
    }
  }
  for (let i = 0; i < G; i++) { lines.set([G * S + i, G * S + i + 1, i * S + G, (i + 1) * S + G], ln); ln += 4; }
  const triBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tris, gl.STATIC_DRAW);
  const lineBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lines, gl.STATIC_DRAW);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  // --- faces -----------------------------------------------------------
  // He appears as soon as the resting face has loaded. Every other face, and
  // the eye sheet, arrive in their own time and switch themselves on as they
  // do; one that fails to load is simply a reaction he doesn't have.
  const wanted = Object.keys(opt.faces);
  const resting = wanted[0];
  // No picture is kept bigger than the screen can show it, which on a phone
  // halves the memory his faces take. If he's later shown larger (a rotated
  // phone, a zoomed page), they are fetched again at the new size.
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);
  const sizeWanted = () => Math.ceil(((canvas.clientWidth / (1 + 2 * opt.pad)) * pixelRatio() * DETAIL) / 64) * 64;
  let size = sizeWanted(), full = 0; // the size faces are kept at, and the size they come in
  let photo;
  try {
    photo = await loadImage(opt.faces[resting]);
    if (gl.isContextLost()) throw gone();
  } catch (error) {
    canvas.removeEventListener("webglcontextlost", onLost);
    throw gl.isContextLost() ? gone() : error;
  }
  full = Math.max(photo.naturalWidth, photo.naturalHeight);
  const textures = { [resting]: makeTexture(gl, photo, size) };
  const names = [resting];
  let destroyed = false;
  let loading = 0; // pictures still on their way
  // The rest are fetched in the background, two at a time and in the order
  // they were asked for, and handed over one by one when the page has a
  // moment to spare and never while he's being held: taking in a picture is
  // the heaviest thing a phone is asked to do here (tens of milliseconds on
  // a slow one). One that fails is simply not handed over.
  const queue = [];
  let fetching = 0;
  const spare = () => new Promise((done) => (window.requestIdleCallback ? requestIdleCallback(done, { timeout: 1500 }) : setTimeout(done, 0)));
  const pause = (ms) => new Promise((done) => setTimeout(done, ms));
  // Not while a finger is on him or the page has just been touched or
  // scrolled; but not put off for ever either.
  // (A face he pulls at being handled waits for a hand to let go only
  // briefly: it is wanted for that very grab.)
  const idleHands = async (urgent) => {
    const since = performance.now(), waited = () => performance.now() - since;
    const most = urgent ? 600 : 4000; // ms it will wait for quiet (a hand on him: for ever, unless urgent)
    await Promise.race([spare(), pause(urgent ? 200 : 1500)]);
    while (!destroyed && (((grab || armed) && !(urgent && waited() > most)) || (performance.now() - lastActive < 350 && waited() < most))) await pause(100);
  };
  function later(src, use, { first = false, fit = true, urgent = false, fail = null } = {}) {
    loading++;
    queue[first ? "unshift" : "push"]({ src, use, fit, first, urgent, fail });
    fetchNext();
  }
  function fetchNext() {
    // (One asked for `first` doesn't wait for a place: two slow pictures
    // mustn't keep his eyes from him.)
    while (queue.length && !destroyed && (fetching < 2 || queue[0].first)) {
      const { src, use, fit, urgent, fail } = queue.shift();
      fetching++;
      loadImage(src)
        .then(async (img) => { await idleHands(urgent); if (!destroyed && !gl.isContextLost()) use(makeTexture(gl, img, fit ? size : 0)); }, () => { if (fail) fail(); })
        .finally(() => { fetching--; loading--; fetchNext(); });
    }
  }
  const keep = (name) => (texture) => {
    if (textures[name]) gl.deleteTexture(textures[name]); else names.push(name);
    textures[name] = texture;
    wake();
  };
  const wantedNow = new Set(Object.values(opt.reactions).flat());
  for (const name of wanted.slice(1)) later(opt.faces[name], keep(name), { urgent: wantedNow.has(name) });
  // Shown bigger than his pictures were sized for: fetch them again.
  function refit() {
    if (destroyed || size >= full || sizeWanted() <= size * 1.1) return;
    size = sizeWanted();
    for (const name of names) later(opt.faces[name], keep(name));
  }
  let sheet = null, sheetDue = null; // the eye sheet, and one that's on its way (its address, or a promise of his eyes)
  // Give him eyes (see `gaze` in the options). Callable later, so a page
  // doesn't have to wait for the eye sheet's manifest before showing him.
  // Given a promise, he knows eyes are coming and acts that need them wait.
  function setGaze(gaze) {
    if (destroyed) return;
    if (gaze && typeof gaze.then === "function") {
      sheetDue = gaze;
      const settle = (eyes) => { if (sheetDue === gaze) { sheetDue = null; setGaze(eyes || null); } };
      gaze.then(settle, () => settle(null));
      return;
    }
    opt.gaze = gaze ? { ...GAZE, ...gaze } : null;
    if (sheet) gl.deleteTexture(sheet);
    sheet = null;
    const wanted = opt.gaze && opt.gaze.sheet;
    sheetDue = wanted || null;
    const over = () => { if (sheetDue === wanted) sheetDue = null; };
    // Still the sheet he's waiting for? (Another may have been asked for since.)
    // Ahead of the faces still waiting, and at its own size: its cells are
    // cut to the pixel.
    if (wanted) later(wanted, (texture) => { over(); if (opt.gaze && opt.gaze.sheet === wanted) { sheet = texture; keepBlinking(); wake(); } else gl.deleteTexture(texture); }, { first: true, fit: false, fail: over });
  }
  // The resting face has a cell of its own ("rest"): the same pixels as the
  // face, so the eyes are always drawn from the sheet and nothing shifts
  // when he starts or stops looking around.
  const cell = (name) => (sheet ? opt.gaze.cells.indexOf(name === resting ? "rest" : name) : -1);
  let faceA = resting, faceB = resting, faceMix = 1, faceSpeed = 0;
  if (opt.gaze) setGaze(opt.gaze);

  // Low-res alpha of the resting face, for "is the cursor on him?" tests.
  const MASK = 96;
  const mask = (() => {
    const out = new Uint8Array(MASK * MASK);
    try {
      const c = document.createElement("canvas");
      c.width = c.height = MASK;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(photo, 0, 0, MASK, MASK);
      const px = ctx.getImageData(0, 0, MASK, MASK).data;
      for (let i = 0; i < out.length; i++) out[i] = px[i * 4 + 3];
    } catch (e) {
      out.fill(255);
    }
    return out;
  })();
  const inFrame = (u, v) => {
    const f = opt.frame;
    if (!f) return true;
    const dx = u - f.x, dy = v - f.y;
    if (f.kind === "square") return Math.abs(dx) < f.r;
    return Math.hypot(dx, dy) < f.r || (dy < 0 && Math.abs(dx) < f.r);
  };
  const solidAt = (u, v) => {
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
    if (opt.frame && opt.frame.kind === "circle") {
      const dx = u - opt.frame.x, dy = v - opt.frame.y;
      return Math.hypot(dx, dy) <= (opt.frame.r || 0.5);
    }
    if (!inFrame(u, v)) return false;
    return mask[((v * MASK) | 0) * MASK + ((u * MASK) | 0)] > 100;
  };

  // --- pointer ---------------------------------------------------------
  const hit = opt.hit || canvas;
  // His own element: what he's drawn in, and whatever the page lays in it.
  const own = canvas.parentElement || canvas;
  // The cursor in grid coordinates, and the hand: where the brush is. While
  // hovering the two coincide; during a grab the hand lags on a rubber band.
  // `over` is a cursor, or a finger that has just landed, resting on him;
  // `since` is when the cursor last came onto him or went off him.
  const pointer = { x: 0, y: 0, seen: false, over: false, since: 0, cx: 0, cy: 0 };
  const showCursor = () => { hit.style.cursor = grab ? "grabbing" : pointer.over ? "grab" : ""; };
  // What his eyes are drawn to: the last place anything moved, for a moment.
  const eyesOn = { x: 0, y: 0, until: 0 };
  let lastActive = performance.now(); // last time the visitor did anything at all
  let visible = true; // is the picture on screen at all?
  let up = false; // …and in a tab that's showing? (see attend)
  const hand = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, touching: false };
  let grab = null; // { startX, startY, pullX, pullY, id, touch }
  // A finger that has landed on him and may yet grab: where it landed (cx,
  // cy) and last rested (rx, ry), its long-press timer, its latest event,
  // when it set off (`strayed`), whether it landed to stop a scroll, and how
  // many long presses' worth of resting it still owes (`patience`).
  let armed = null;
  let grabs = []; // timestamps of recent grabs, for the "really? again?" face
  const SLOP = 10; // px a finger may wander and still be said not to have set off
  const REST = 3; // px it may shift and still be said to be resting where it was
  // How much further across than up or down a swipe goes to be a grab: about
  // 30° either side of level. A grab missed costs a few px of scrolling; a
  // scroll mistaken for a grab is a page that won't move.
  const SIDEWAYS = 1.7;
  const UNCLAIMED = 160; // ms the browser has to claim a swipe for scrolling before it's a grab anyway
  const FLING = 150; // ms after the page last scrolled in which a touch is taken to be stopping it
  let lastScroll = -Infinity;

  const eventToGrid = (e) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * G, ((e.clientY - r.top) / r.height) * G];
  };
  const sampleU = (gx, gy) => {
    const i = Math.max(0, Math.min(G - 1, Math.floor(gx))), j = Math.max(0, Math.min(G - 1, Math.floor(gy)));
    const fx = Math.max(0, Math.min(1, gx - i)), fy = Math.max(0, Math.min(1, gy - j));
    const a = j * S + i, b = a + 1, c = a + S, d = c + 1;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    return [ux[a] * w00 + ux[b] * w10 + ux[c] * w01 + ux[d] * w11, uy[a] * w00 + uy[b] * w10 + uy[c] * w01 + uy[d] * w11];
  };
  // Where on the resting picture is the thing currently under this point?
  const restPoint = (gx, gy) => {
    let rx = gx, ry = gy;
    for (let n = 0; n < 3; n++) { const [dx, dy] = sampleU(rx, ry); rx = gx - dx; ry = gy - dy; }
    return [rx, ry];
  };

  // Is this point (in grid coordinates) on him, as he's currently stretched?
  const onHim = (gx, gy) => {
    const [rx, ry] = restPoint(gx, gy);
    return solidAt(toImage(rx), toImage(ry));
  };

  // Something moved at this point of the window (a cursor, a finger): real
  // movement, not a trackpad shiver. That's what he watches, and only for a
  // moment after it stops.
  function notice(at) {
    if (Math.hypot(at.clientX - pointer.cx, at.clientY - pointer.cy) < 4) return;
    pointer.cx = at.clientX; pointer.cy = at.clientY;
    const now = performance.now();
    lastActive = now;
    if (!visible) return;
    [eyesOn.x, eyesOn.y] = eventToGrid(at);
    const [min, max] = opt.gaze ? opt.gaze.linger : [0, 0];
    eyesOn.until = now + min + Math.random() * (max - min);
    wake();
  }

  function onMove(e) {
    notice(e);
    if (e.pointerType) state.finger = e.pointerType === "touch";
    const mine = armed && e.pointerId === armed.id;
    if (mine) {
      armed.last = e;
      const dx = e.clientX - armed.cx, dy = e.clientY - armed.cy;
      if (Math.hypot(dx, dy) > SLOP) {
        // It has set off, so it isn't a long press. Clearly sideways, it
        // takes hold. Up or down, the browser scrolls the page and takes
        // the finger away (pointercancel) within a frame or two; if moves
        // are still arriving well after that, the browser didn't want it,
        // and it's a grab after all.
        // (Both by the clock of the events and by this one: after a stall
        // either alone can mistake a swipe the browser is about to claim.)
        const now = performance.now();
        clearTimeout(armed.timer);
        armed.strayed = armed.strayed || { at: now, stamp: e.timeStamp };
        const unclaimed = now - armed.strayed.at > UNCLAIMED && e.timeStamp - armed.strayed.stamp > UNCLAIMED;
        if (Math.abs(dx) > Math.abs(dy) * SIDEWAYS || unclaimed) { take(e, true); return; }
      } else if (!armed.strayed && Math.hypot(e.clientX - armed.rx, e.clientY - armed.ry) > REST) {
        // Still on the spot, but not still: the long press starts over.
        rest(e);
      }
    }
    if (!visible && !grab) return;
    // While he's held, only the pointer that holds him moves the hand.
    if (grab && e.pointerId !== grab.id) return;
    // A finger is only ever a hand while it is on him: landed, or holding.
    if (e.pointerType === "touch" && !mine && !grab) return;
    const [gx, gy] = eventToGrid(e);
    pointer.x = gx; pointer.y = gy;
    if (!pointer.seen) { pointer.seen = true; hand.x = hand.px = gx; hand.y = hand.py = gy; }
    // A link or a button that has the pointer has it, not him: one laid over
    // him, or one behind him that the pointer has gone through to (see
    // seeThrough). Hovering it mustn't rub his skin or bother him. (While
    // he's held, it's his.)
    const t = e.target;
    const covered = !grab && t !== hit && t instanceof Element && !!t.closest(INTERACTIVE);
    const on = onHim(gx, gy);
    const over = !covered && on;
    if (over !== pointer.over) pointer.since = performance.now();
    pointer.over = over;
    seeThrough(e, on);
    showCursor();
    wake();
  }

  // What lies behind him at this point of the window, in his own element,
  // that can take the pointer: a link laid between the shape he sits in and
  // him, say. (Asked of the page with him out of the way.)
  function behind(x, y) {
    const was = hit.style.pointerEvents;
    hit.style.pointerEvents = "none";
    const under = document.elementFromPoint(x, y);
    hit.style.pointerEvents = was;
    const thing = under && under !== hit && under.closest(INTERACTIVE);
    return thing && own.contains(thing) ? thing : null;
  }

  // Where a cursor is on his picture but not on him, and something lies
  // behind him there, it goes through him to that: it gets the hover, the
  // cursor and the click, as if he weren't there. (A finger can't be let
  // through before it lands; its tap is passed on instead, see onClick.)
  function seeThrough(e, on) {
    if (e.pointerType === "touch") return;
    const r = hit.getBoundingClientRect();
    const onPicture = e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
    hit.style.pointerEvents = onPicture && !on && !grab && behind(e.clientX, e.clientY) ? "none" : "";
  }

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    // A second finger means a pinch: the page's, not his.
    if (e.pointerType === "touch" && !e.isPrimary) { letGo(); return; }
    // A new first finger while he's still held by one: that one's lift went
    // missing (it can't still be down), so he is let go of first.
    if (grab && grab.touch && e.pointerType === "touch") letGo();
    if (grab) return;
    const [gx, gy] = eventToGrid(e);
    // Not on him: the click that follows may belong to what's behind him.
    missed = onHim(gx, gy) ? 0 : performance.now();
    if (missed) return;
    if (e.pointerType === "mouse") {
      e.preventDefault();
      onMove(e);
      take(e);
      return;
    }
    disarm();
    // A finger put down on a page that's still gliding is there to stop it:
    // he doesn't flinch, and it isn't a tap. It can still take hold of him,
    // but it has to rest on him twice as long, on a page that has stopped.
    const stopping = performance.now() - lastScroll < FLING;
    armed = { id: e.pointerId, cx: e.clientX, cy: e.clientY, rx: 0, ry: 0, timer: 0, last: e, strayed: null, stopping, patience: stopping ? 2 : 1, since: performance.now() };
    // He's been touched: whatever he was up to by himself is over.
    if (act.at >= 0) { endAct(performance.now(), 0); armed.cut = true; }
    rest(e);
    onMove(e);
    // The first frame of a touch passes on no speed (see the frame loop), so
    // landing somewhere new doesn't fling the skin there.
    hand.touching = false;
    if (opt.prod > 0 && !stopping) shove(toImage(gx), toImage(gy), 0, 0, opt.prod);
  }

  // The armed finger is resting here; if it's still here after `hold`, with
  // the page still for all that time, it has hold of him.
  function rest(e) {
    clearTimeout(armed.timer);
    armed.rx = e.clientX; armed.ry = e.clientY;
    if (opt.hold > 0) armed.timer = setTimeout(() => {
      if (!armed || armed.strayed) return;
      if (--armed.patience > 0 || performance.now() - lastScroll < opt.hold) rest(armed.last); else take(armed.last, true);
    }, opt.hold);
  }

  const disarm = () => {
    if (!armed) return;
    clearTimeout(armed.timer);
    armed = null;
  };

  // Where the hand is, given where the pointer has got to. A rubber band:
  // the further the pointer goes, the less the hand follows, and it never
  // leaves the canvas, where there'd be nothing to draw on.
  function stretchHand() {
    const dx = pointer.x - grab.startX, dy = pointer.y - grab.startY;
    const len = Math.hypot(dx, dy), max = opt.maxPull * cellsPerImage();
    const eased = len > 0 ? (max * Math.tanh(len / max)) / len : 0;
    const within = (g) => Math.max(1, Math.min(G - 1, g));
    grab.pullX = within(grab.startX + dx * eased) - grab.startX;
    grab.pullY = within(grab.startY + dy * eased) - grab.startY;
  }

  // Take hold of him. A mouse takes hold where it is; a finger, where it
  // first landed, so the travel that made it a grab is part of the pull.
  function take(e, touch = false) {
    const [gx, gy] = eventToGrid(touch && armed ? { clientX: armed.cx, clientY: armed.cy } : e);
    const cut = !!armed && !!armed.cut; // this finger interrupted an act as it landed
    disarm();
    grab = { startX: gx, startY: gy, pullX: 0, pullY: 0, id: e.pointerId, touch };
    [pointer.x, pointer.y] = eventToGrid(e);
    pointer.seen = true;
    hand.x = hand.px = gx; hand.y = hand.py = gy;
    atRest = false;
    const now = lastActive = performance.now();
    // Grabbed in the middle of a yawn or a whistle: that's the end of it,
    // and of acts for a while.
    if (act.at >= 0) endAct(now, 8000);
    else if (cut) act.notBefore = Math.max(act.notBefore, now + 8000);
    grabs = grabs.filter((g) => now - g < 9000);
    grabs.push(now);
    showCursor();
    try { hit.setPointerCapture(e.pointerId); } catch {}
    emit("grab", { touch });
    wake();
  }

  // The end of a touch or a grab. With the event of a pointer lifting it is a
  // release (or, from a finger that never took hold, a tap); with anything
  // else — the browser taking the finger for a scroll, a second finger, the
  // window losing focus, the tab being hidden — he is simply let go of, and
  // makes nothing of it.
  function letGo(e) {
    const lifted = !!e && e.type === "pointerup";
    if (armed && (!e || e.pointerId === armed.id)) {
      const meant = lifted && !armed.stopping;
      disarm();
      pointer.over = false;
      showCursor();
      if (meant) tap(toImage(pointer.x), toImage(pointer.y), false);
      wake();
    }
    if (!grab || (e && e.pointerId !== undefined && e.pointerId !== grab.id)) return;
    // The pull as it stands now, not as of the last frame drawn: a quick
    // flick can be over between two frames.
    if (lifted) [pointer.x, pointer.y] = eventToGrid(e);
    stretchHand();
    // …and the skin is taken as far as the hand got, if no frame has yet.
    const toX = grab.startX + grab.pullX, toY = grab.startY + grab.pullY;
    if (lifted && Math.hypot(toX - hand.x, toY - hand.y) > 0.5) {
      // Over the time that really went by since the last frame, so the skin
      // leaves the hand at the speed the hand was going.
      const p = physics(), now = performance.now();
      const catchUp = Math.max(0.001, Math.min(0.05, (now - last) / 1000));
      simulate(p, catchUp, hand.x, hand.y, toX, toY, (toX - hand.x) / catchUp, (toY - hand.y) / catchUp, Math.max(1.8, opt.grabRadius * p.cells), GRIP);
      last = now; atRest = false; unshaded = true;
    }
    lastActive = performance.now();
    const pulled = Math.hypot(grab.pullX, grab.pullY) / cellsPerImage();
    if (grab.touch) pointer.over = false;
    // Only a real pull counts toward his patience.
    if (!lifted || pulled < 0.05) grabs.pop();
    grab = null;
    hand.x = hand.px = pointer.x; hand.y = hand.py = pointer.y;
    showCursor();
    emit("release", { pulled, cancelled: !lifted });
    wake();
  }

  // A tap: he's startled for a moment. `prod` gives the skin the prod a
  // finger gives on landing, for taps that come from somewhere else (a key).
  function tap(u, v, prod = true) {
    if (destroyed) return;
    if (act.at >= 0) endAct(performance.now(), 0);
    if (prod && opt.prod > 0) shove(u, v, 0, 0, opt.prod);
    mood = { until: performance.now() + 350, face: react("tapped") };
    emit("tap", { u, v });
    wake();
  }

  // Fingers keep sending touch events while the page scrolls under them,
  // long after the browser has taken their pointer events away, so that is
  // what his eyes follow on a touch screen.
  const onTouch = (e) => {
    state.finger = true;
    if (e.touches.length > 1) { letGo(); return; }
    // (The same missing lift, noticed when the next finger lands elsewhere:
    // the only finger on the screen has just landed, so one that has been
    // holding or resting on him for a while is no longer there.)
    if (e.type === "touchstart" && ((grab && grab.touch) || (armed && performance.now() - armed.since > 100))) letGo();
    if (e.touches.length === 1) notice(e.touches[0]);
  };
  // A finger that has hold of him doesn't scroll the page, whichever way it
  // goes next. (`touch-action` alone settles that only at the start of a
  // touch; this settles it for the rest.)
  const onTouchMove = (e) => {
    if (grab && grab.touch && e.touches.length === 1 && e.cancelable) e.preventDefault();
  };
  // A click (a tap) on his picture where he isn't goes to whatever is
  // behind him there, if anything is. A key's click (no point) is left
  // alone, and so is the end of a drag: that pointer went down on him.
  let missed = 0; // when a pointer last went down on his picture but not on him
  const onClick = (e) => {
    const went = missed;
    missed = 0;
    if (!went || e.detail === 0 || performance.now() - went > 1500) return;
    const thing = behind(e.clientX, e.clientY);
    if (!thing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    thing.click();
  };
  // The mouse leaving the window: he looks back at you at once.
  const onLeave = (e) => {
    if (e.pointerType === "touch") return;
    hit.style.pointerEvents = "";
    pointer.over = false; eyesOn.until = 0;
    wake();
  };
  // A long press must not bring up a menu (which, on Android, would also
  // take the finger away just as it takes hold). And a mouse's menu swallows
  // the button's release, so he is let go of rather than left stuck to it.
  const onMenu = (e) => {
    if (armed || (grab && grab.touch)) e.preventDefault();
    else if (grab) letGo();
  };
  const onActivity = (e) => { lastActive = performance.now(); if (e.type === "scroll") lastScroll = lastActive; };
  const ACTIVITY = ["pointerdown", "keydown", "wheel", "scroll"];
  ACTIVITY.forEach((type) => window.addEventListener(type, onActivity, { passive: true }));
  hit.addEventListener("pointerdown", onDown);
  hit.addEventListener("click", onClick);
  hit.addEventListener("touchmove", onTouchMove, { passive: false });
  hit.addEventListener("contextmenu", onMenu);
  document.documentElement.addEventListener("pointerleave", onLeave);
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerup", letGo);
  window.addEventListener("pointercancel", letGo);
  window.addEventListener("touchstart", onTouch, { passive: true });
  window.addEventListener("touchmove", onTouch, { passive: true });
  const onBlur = () => letGo();
  window.addEventListener("blur", onBlur);

  // --- expressions -----------------------------------------------------
  const listeners = {};
  const emit = (name, detail) => (listeners[name] || []).forEach((fn) => fn(detail));
  const react = (kind) => (opt.reactions[kind] || []).find((n) => textures[n]) || resting;
  let mood = { until: 0, face: resting };
  // A mouse resting on him, as opposed to one passing over: he takes a
  // moment to notice it, and a moment to notice it's gone, so a cursor
  // grazing his edge doesn't make him flicker. (Not a finger: on a phone
  // a touch is a tap or a grab, which have faces of their own.)
  const HOVER_IN = 120, HOVER_OUT = 220; // ms
  const hovered = (now) => !state.finger && (pointer.over
    ? now - pointer.since > HOVER_IN
    : faceB === react("hovered") && now - pointer.since < HOVER_OUT);

  function setFace(name, ms = 110) {
    if (!textures[name] || name === faceB) return;
    // Whatever is mostly on screen right now becomes the "from" side.
    if (faceMix > 0.5) faceA = faceB;
    faceB = name;
    faceMix = 0;
    faceSpeed = 1000 / ms;
  }

  // Idle acts. One plays at a time, never the same one twice running.
  // `opened` is the opening act, once it has played (through, or far enough
  // to have made its point).
  const act = { name: null, frames: [], total: 0, at: -1, notBefore: 0, last: null, opened: null, rock: 0, lean: 0, drop: 0, pose: null, poseFade: 60, index: -1, ghost: null, watching: false };
  const isPose = (name) => !textures[name] && cell(name) >= 0; // eyes only, not a whole face
  const actFrames = (name) => ((opt.idle && opt.idle.acts[name] && opt.idle.acts[name].frames) || [])
    .map((f) => (Array.isArray(f) ? { show: f[0], fade: f[1], hold: f[2] } : f));
  // An act can play once every picture it shows has arrived. A frame that
  // only poses his eyes waits for the eye sheet if one is on its way. With
  // no sheet at all, only frames that can do without their pose (`optional`,
  // or "rest": the eyes as they are) let the act play.
  const actReady = (name) => {
    const frames = actFrames(name);
    return frames.length > 0 && frames.every((f) => (f.show in opt.faces ? textures[f.show] : sheet ? cell(f.show) >= 0 : !sheetDue && (f.optional || f.show === "rest")));
  };
  // With a name, plays that act now, cutting short whatever was playing.
  // Without one, picks the next act if nothing is.
  let openerDue = 0; // when the opening act first came due
  function startAct(name) {
    if (destroyed || grab || armed || !opt.idle) return;
    if (name ? !actReady(name) : act.at >= 0) return;
    if (act.at >= 0) endAct(performance.now(), 0);
    if (!name) {
      const on = Object.keys(opt.idle.acts).filter((n) => !opt.idle.acts[n].off);
      // The opening act goes first, even if that means waiting for its
      // pictures and his eyes…
      const opener = act.opened !== opt.idle.first && on.includes(opt.idle.first) ? opt.idle.first : null;
      // …though not for ever, if something is stuck on the way: then others
      // fill in, and it opens as soon as it can.
      const due = (openerDue = openerDue || performance.now());
      if (opener && !actReady(opener) && performance.now() - due < 8000) return;
      const ready = on.filter(actReady);
      const fresh = ready.filter((n) => n !== act.last);
      const pool = fresh.length ? fresh : ready;
      name = opener && actReady(opener) ? opener : pool[Math.floor(Math.random() * pool.length)];
      if (!name) return;
    }
    // The frames are fixed from here on, whatever arrives or is changed
    // while the act plays.
    act.frames = actFrames(name);
    act.total = act.frames.reduce((sum, f) => sum + f.fade + f.hold, 0);
    act.name = act.last = name;
    act.at = performance.now();
    act.index = -1;
    emit("act", { name });
    wake();
  }
  function endAct(now, wait) {
    act.at = -1; act.name = null; act.rock = act.lean = act.drop = 0; act.pose = null; act.ghost = null; act.watching = false;
    act.notBefore = now + wait;
    emit("actend");
  }
  // Returns the frame the act wants right now, or null once it's over.
  function acting(now) {
    if (act.at < 0) return null;
    const { frames, total } = act;
    const elapsed = now - act.at;
    // Head rock: eases in and out over the act, a little over once a second.
    const bob = opt.idle.acts[act.name].bob || 0;
    act.rock = bob * Math.sin(Math.PI * Math.min(1, elapsed / total)) * Math.sin((elapsed / 780) * 2 * Math.PI);
    let start = 0, tilt = 0, drop = 0;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i], length = f.fade + f.hold;
      // Anything the visitor does cuts a `wake` frame short.
      if (f.wake && elapsed >= start && elapsed < start + length && lastActive > act.at + start + 120) {
        act.at -= start + length - elapsed;
        return acting(now);
      }
      if (elapsed < start + length) {
        if (i !== act.index) { act.index = i; atRest = false; if (f.jolt) shove(...(Array.isArray(f.jolt) ? f.jolt : [0.5, 0.42, 0, -0.03])); }
        // The head eases toward this frame's lean over the frame; a jolt snaps there.
        const k = f.jolt ? 1 : (elapsed - start) / length;
        act.lean = tilt + ((f.tilt || 0) - tilt) * k;
        act.drop = drop + ((f.drop || 0) - drop) * k;
        // The phantom hand glides to this frame's spot, easing in and out.
        if (f.hand) {
          const from = (i > 0 && frames[i - 1].hand) || opt.idle.acts[act.name].handFrom || f.hand;
          const e = k * k * (3 - 2 * k);
          const gx = toGrid(from[0] + (f.hand[0] - from[0]) * e), gy = toGrid(from[1] + (f.hand[1] - from[1]) * e);
          const g = act.ghost || { x: gx, y: gy, px: gx, py: gy, grip: false, sx: gx, sy: gy };
          g.px = g.x; g.py = g.y; g.x = gx; g.y = gy;
          if (f.grip && !g.grip) { g.sx = gx; g.sy = gy; } // where it took hold
          // Seen taking hold of him, an act has made its point even if it's cut short.
          if (f.grip && k > 0.5 && act.name === opt.idle.first) act.opened = act.name;
          g.grip = !!f.grip;
          act.ghost = g;
        } else {
          act.ghost = null;
        }
        return f;
      }
      start += length; tilt = f.tilt || 0; drop = f.drop || 0;
    }
    const [min, max] = opt.idle.every;
    if (act.name === opt.idle.first) act.opened = act.name;
    endAct(now, (min + Math.random() * (max - min)) * 1000);
    return null;
  }

  // `expressions: false` only stops the faces he pulls at being handled;
  // idle acts carry on regardless.
  function direct(now) {
    const frame = grab ? null : acting(now);
    if (grab) {
      const pull = Math.hypot(grab.pullX, grab.pullY) / cellsPerImage();
      if (opt.expressions) setFace(react(pull > 0.09 ? "pulled" : "held"), 80);
      else setFace(resting);
      mood = { until: 0, face: resting };
    } else if (frame && isPose(frame.show)) {
      // An eyes-only frame: the face stays as it is and the eyes are posed.
      setFace(resting, 200);
      act.pose = frame.watch ? null : frame.show; act.poseFade = frame.fade;
      act.watching = !!frame.watch;
    } else if (frame) {
      // (An eyes-only frame with no eye sheet to draw it from shows nothing new.)
      setFace(frame.show in opt.faces ? frame.show : resting, frame.fade);
      act.pose = null; act.watching = false;
    } else if (opt.expressions && now < mood.until) {
      setFace(mood.face, 140);
    } else if (opt.expressions && hovered(now)) {
      setFace(react("hovered"), 160);
    } else {
      setFace(resting, 260);
    }
  }

  // Eyes. He watches the cursor around the page and looks straight at you
  // when it's on him. Like real eyes they jump from one fixation to the
  // next rather than glide, so each change is a very short cut between two
  // photographs, never a slow dissolve.
  const eye = { from: resting, to: resting, mix: 1, fade: 0.06, on: 0, since: 0, blink: 0, blinkAt: -1, blinked: 0 };
  const shutCell = () => (opt.gaze && opt.gaze.blink ? cell(opt.gaze.blink.shut) : -1);
  function look(elapsed, now) {
    const g = opt.gaze;
    if (!g || !sheet) return false;
    // Only on the resting face; the other faces have eyes of their own.
    const calm = !grab && faceB === resting && faceMix >= 1;
    eye.on = calm ? Math.min(1, eye.on + elapsed * 8) : Math.max(0, eye.on - elapsed * 30);

    let want = resting;
    const watching = g.follow !== false && now < eyesOn.until;
    // What he's looking at: the thing an idle act has put in front of him,
    // if there is one, otherwise a cursor that's on the move.
    const prop = act.watching && act.ghost;
    const target = prop ? act.ghost : watching ? eyesOn : null;
    if (calm && target) {
      const dx = toImage(target.x) - (g.centres[0][0] + g.centres[1][0]) / 2;
      const dy = toImage(target.y) - (g.centres[0][1] + g.centres[1][1]) / 2;
      const dist = Math.hypot(dx, dy);
      // A little stickiness on both decisions, so he doesn't flicker when
      // the cursor sits on a boundary.
      if (dist > (eye.to === resting ? g.near : g.near * 0.8)) {
        let best = -2;
        for (const name in g.looks) {
          if (cell(name) < 0) continue;
          const [lx, ly] = g.looks[name];
          const score = (dx * lx + dy * ly) / (dist * Math.hypot(lx, ly)) + (name === eye.to ? 0.05 : 0);
          if (score > best) { best = score; want = name; }
        }
      }
    }
    // An idle act can pose the eyes; so can `pose`, for looking a frame over.
    const posed = calm && (act.pose || (g.pose && cell(g.pose) >= 0 ? g.pose : null));
    if (posed) want = posed === "rest" ? resting : posed;
    if (want !== eye.to && eye.mix >= 1 && now - eye.since > 110) {
      eye.from = eye.to; eye.to = want; eye.mix = 0; eye.since = now;
      // A glance is a cut; a posed frame takes as long as it asks for.
      eye.fade = (calm && act.pose ? Math.max(40, act.poseFade) : g.cut) / 1000;
      // People often blink as their eyes jump; it also covers the cut.
      if (!motion.matches && !act.pose && g.blinks !== false && now - eye.blinked > 2500 && Math.random() < g.jumpBlink) blink();
    }
    if (eye.mix < 1) eye.mix = Math.min(1, eye.mix + elapsed / eye.fade);

    if (eye.blinkAt >= 0) {
      // Lids drop fast, stay shut for a beat, and come back up more slowly.
      const t = now - eye.blinkAt;
      const up = Math.min(1, Math.max(0, (t - 115) / 150));
      eye.blink = !calm ? 0 : t < 75 ? t / 75 : 1 - up * up * (3 - 2 * up);
      if (t >= 265 || !calm) { eye.blinkAt = -1; eye.blink = 0; }
    }
    // Stay awake while he's watching, so the look back at you isn't missed.
    return eye.mix < 1 || want !== eye.to || eye.on !== (calm ? 1 : 0) || eye.blinkAt >= 0 || watching;
  }

  // Asked afresh each time, so switching the preference takes effect at once:
  // with reduced motion he does nothing of his own accord.
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let blinkTimer = 0, blinkAgain = 0, idleTimer = 0;
  const idle = () => {
    if (!opt.idle || opt.idle.off || motion.matches) return;
    const now = performance.now();
    if (now - lastActive > opt.idle.after * 1000 && now > act.notBefore && faceB === resting && now > mood.until) startAct();
  };
  function blink() {
    if (shutCell() < 0 || eye.blinkAt >= 0 || eye.on < 1 || act.pose || !up) return;
    eye.blinkAt = eye.blinked = performance.now();
    wake();
  }
  // Every few seconds, at uneven intervals, and now and then twice in a row.
  function keepBlinking() {
    clearTimeout(blinkTimer);
    if (destroyed || !up || shutCell() < 0) return;
    const [min, max] = opt.gaze.blinkEvery;
    blinkTimer = setTimeout(() => {
      // Not if he has only just blinked on an eye jump.
      if (opt.gaze && !motion.matches && opt.gaze.blinks !== false && performance.now() - eye.blinked > Math.min(1800, min)) {
        blink();
        if (Math.random() < 0.15) blinkAgain = setTimeout(blink, 360);
      }
      keepBlinking();
    }, min + Math.random() * Math.max(0, max - min));
  }

  (listeners.release = listeners.release || []).push(({ pulled, cancelled }) => {
    const now = performance.now();
    if (cancelled) return;
    if (pulled < 0.05) { tap(toImage(pointer.x), toImage(pointer.y), false); return; }
    if (grabs.length >= 4) { mood = { until: now + 2600, face: react("fedUp") }; grabs = []; return; }
    mood = { until: now + 500 + pulled * 2200, face: react("dazed") };
  });

  // --- simulation ------------------------------------------------------
  function physics() {
    const cells = cellsPerImage();
    const w = 2 * Math.PI * opt.wobble;
    const c = opt.reach * cells * w;
    return { cells, w, w2: w * w, c, c2: c * c, gamma: 2 * opt.damping * w, nu: opt.flesh * c, limit: (opt.maxPull * cells) ** 2 };
  }

  function accelerate(p) {
    for (let j = 1; j < G; j++) {
      for (let i = 1; i < G; i++) {
        const k = j * S + i;
        if (fixed[k]) continue;
        const x = ux[k], y = uy[k];
        // Skin resists harder the further it is from home, so it can't be
        // pulled out forever.
        const hard = p.w2 * Math.min(HARDEST, 1 + (x * x + y * y) / p.limit);
        ax[k] = p.c2 * (ux[k - 1] + ux[k + 1] + ux[k - S] + ux[k + S] - 4 * x) - hard * x - p.gamma * vx[k]
          + p.nu * (vx[k - 1] + vx[k + 1] + vx[k - S] + vx[k + S] - 4 * vx[k]);
        ay[k] = p.c2 * (uy[k - 1] + uy[k + 1] + uy[k - S] + uy[k + S] - 4 * y) - hard * y - p.gamma * vy[k]
          + p.nu * (vy[k - 1] + vy[k + 1] + vy[k - S] + vy[k + S] - 4 * vy[k]);
      }
    }
  }

  // Whatever skin is under the brush right now takes on the hand's velocity.
  // `grip` is how fast it does so (per second): effectively rigid for a
  // grab, a gentle drag for a passing cursor.
  function brush(hx, hy, hvx, hvy, radius, grip, dt) {
    const r2 = radius * radius;
    for (let j = 1; j < G; j++) {
      for (let i = 1; i < G; i++) {
        const k = j * S + i;
        const dx = i + ux[k] - hx, dy = j + uy[k] - hy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2 || fixed[k]) continue;
        const q = 1 - d2 / r2;
        // Flat-topped, so the middle of the handful moves as one lump.
        const hold = Math.min(1, q * q * 2.4);
        const blend = 1 - Math.exp(-grip * hold * dt);
        vx[k] += (hvx - vx[k]) * blend;
        vy[k] += (hvy - vy[k]) * blend;
      }
    }
  }

  // The head as a whole: a slow, floppy lean toward wherever it's being
  // pulled, on its own softer spring. This is what sells "toy" over "photo".
  function swayStep(p, dt) {
    const held = !grab && act.ghost && act.ghost.grip ? act.ghost : null;
    const px = grab ? grab.pullX / p.cells : held ? (held.x - held.sx) / p.cells : 0;
    const py = grab ? grab.pullY / p.cells : held ? (held.y - held.sy) / p.cells : 0;
    const w = 2 * Math.PI * 1.25, k = w * w, c = 2 * 0.2 * w;
    const tiltTo = px * 0.3 * opt.sway + act.rock * 0.014 + act.lean, xTo = px * 0.06 * opt.sway, yTo = py * 0.08 * opt.sway + act.drop;
    head.tiltV += (k * (tiltTo - head.tilt) - c * head.tiltV) * dt; head.tilt += head.tiltV * dt;
    head.xV += (k * (xTo - head.x) - c * head.xV) * dt; head.x += head.xV * dt;
    head.yV += (k * (yTo - head.y) - c * head.yV) * dt; head.y += head.yV * dt;
    return (head.tiltV ** 2 + head.xV ** 2 + head.yV ** 2 + (head.tilt ** 2 + head.x ** 2 + head.y ** 2) * 40) * 4000;
  }

  // How much is still going on after a step: `moving` is skin and head in
  // motion, `displaced` is skin away from home. The frame loop sleeps on them.
  let moving = 0, displaced = 0;
  // Nothing displaced and nothing moving: there is no physics to run and no
  // new shape to shade or upload, only (perhaps) his eyes to redraw.
  let atRest = true, unshaded = true;
  function step(p, dt, hx, hy, hvx, hvy, radius, grip) {
    accelerate(p);
    for (let k = 0; k < N; k++) {
      if (fixed[k]) continue;
      vx[k] += ax[k] * dt; vy[k] += ay[k] * dt;
    }
    if (grip > 0) brush(hx, hy, hvx, hvy, radius, grip, dt);
    moving = swayStep(p, dt); displaced = 0;
    for (let k = 0; k < N; k++) {
      if (fixed[k]) continue;
      ux[k] += vx[k] * dt; uy[k] += vy[k] * dt;
      moving += vx[k] * vx[k] + vy[k] * vy[k];
      displaced += (ux[k] * ux[k] + uy[k] * uy[k]) * 40;
    }
  }

  // Run the simulation for `elapsed` seconds while the brush goes from one
  // point to another at the given speed.
  // The integrator is explicit, so each step must be short enough for the
  // stiffest thing in the sheet: with stiffness K and damping d (their
  // largest values over the grid) it is stable while K·dt² + 2·d·dt < 4.
  // If that would take more steps than a frame can afford, he simply runs
  // in slow motion rather than blowing up.
  function simulate(p, elapsed, fromX, fromY, toX, toY, hvx, hvy, radius, grip) {
    const K = 8 * p.c2 + HARDEST * p.w2, d = p.gamma + 8 * p.nu;
    const stable = (0.8 * (Math.sqrt(d * d + 4 * K) - d)) / K;
    // …and short enough that the brush never jumps past the skin it holds:
    // no more than half its radius at a time.
    const reach = grip > 0 && radius > 0 ? Math.ceil(Math.hypot(toX - fromX, toY - fromY) / (radius * 0.5)) : 0;
    const steps = Math.min(MAX_STEPS, Math.max(2, Math.ceil(elapsed / stable), reach));
    const dt = Math.min(elapsed / steps, stable);
    // In slow motion the hand still covers its whole path, so it has to move
    // that much faster through the time that is simulated.
    const slowed = elapsed / (steps * dt);
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      step(p, dt, fromX + (toX - fromX) * f, fromY + (toY - fromY) * f, hvx * slowed, hvy * slowed, radius, grip);
    }
    // Belt and braces: numbers that have run away can't recover by themselves.
    if (!Number.isFinite(moving + displaced)) settle();
  }

  // Back to rest, all at once.
  function settle() {
    for (const a of [ux, uy, vx, vy]) a.fill(0);
    Object.assign(head, { tilt: 0, tiltV: 0, x: 0, xV: 0, y: 0, yV: 0 });
    moving = displaced = 0;
  }

  // A shove from nowhere, in image space: where, and which way. With `prod`
  // the skin around the spot is also drawn in toward it, the dent a fingertip
  // makes, and springs back.
  function shove(u, v, du, dv, prod = 0) {
    if (destroyed) return;
    atRest = false;
    const cells = cellsPerImage();
    const cx = toGrid(u), cy = toGrid(v), R = 0.16 * cells;
    for (let k = 0; k < N; k++) {
      if (fixed[k]) continue;
      const rx = (k % S) - cx, ry = Math.floor(k / S) - cy;
      const d = Math.hypot(rx, ry) / R;
      if (d >= 1) continue;
      const wt = (1 - d * d) ** 2;
      vx[k] += (du * cells * 30 - rx * prod * PROD) * wt;
      vy[k] += (dv * cells * 30 - ry * prod * PROD) * wt;
    }
    wake();
  }

  // --- shading ---------------------------------------------------------
  function shade() {
    let far = 0;
    for (let j = 1; j < G; j++) {
      for (let i = 1; i < G; i++) {
        const k = j * S + i;
        const uxx = (ux[k + 1] - ux[k - 1]) * 0.5, uxy = (ux[k + S] - ux[k - S]) * 0.5;
        const uyx = (uy[k + 1] - uy[k - 1]) * 0.5, uyy = (uy[k + S] - uy[k - S]) * 0.5;
        const area = (1 + uxx) * (1 + uyy) - uxy * uyx - 1;
        dyn[k * 5 + 4] = area;
        far = Math.max(far, ux[k] * ux[k] + uy[k] * uy[k]);
        // Pulled skin tents up toward the viewer; squeezed skin ridges.
        lift[k] = Math.hypot(ux[k], uy[k]) * 0.16 - Math.max(-1, Math.min(1.5, area)) * 0.9;
      }
    }
    const cells = cellsPerImage();
    state.stretch = Math.sqrt(far) / cells;
    const nx = toGrid(opt.neck.x), ny = toGrid(opt.neck.y);
    const cosT = Math.cos(head.tilt), sinT = Math.sin(head.tilt), hx = head.x * cells, hy = head.y * cells;
    for (let j = 1; j < G; j++) {
      for (let i = 1; i < G; i++) {
        const k = j * S + i;
        // Lean of the whole head about the neck, added on top of the skin.
        const rx = i - nx, ry = j - ny, b = bob[k];
        dyn[k * 5] = ux[k] + b * (cosT * rx - sinT * ry - rx + hx);
        dyn[k * 5 + 1] = uy[k] + b * (sinT * rx + cosT * ry - ry + hy);
        dyn[k * 5 + 2] = (lift[k + 1] - lift[k - 1]) * 0.5;
        dyn[k * 5 + 3] = (lift[k + S] - lift[k - S]) * 0.5;
      }
    }
  }

  // --- frame loop ------------------------------------------------------
  let raf = 0, last = 0, quiet = 0;
  // What he is up to, for add-ons (sound, props, the lab's readout). `pull`,
  // `speed` and `stretch` — how far the hand has pulled, how fast it is
  // moving, the furthest any skin is from home — are in image widths.
  // `finger` is whether the last pointer seen was a finger (null: none yet).
  const state = { pull: 0, speed: 0, stretch: 0, grabbing: false, look: "", face: "", act: null, ghost: null, blink: 0, finger: null };

  function resize() {
    const dpr = pixelRatio();
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    refit();
  }

  function draw() {
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (unshaded) {
      shade();
      gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, dyn);
      unshaded = false;
    }
    gl.uniform2f(U.grid, G, G);
    gl.uniform1f(U.pad, opt.pad);
    gl.uniform1f(U.mix, faceMix);
    gl.uniform1f(U.relief, opt.relief);
    gl.uniform1f(U.duotone, opt.duotone);
    const f = opt.frame;
    gl.uniform4f(U.frame, f ? f.x : 0, f ? f.y : 0, f ? f.r : 0, f ? (f.kind === "square" ? 2 : 1) : 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, textures[faceA]); gl.uniform1i(U.texA, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, textures[faceB]); gl.uniform1i(U.texB, 1);
    const g = sheet ? opt.gaze : null;
    const looking = g && (eye.from !== resting || eye.to !== resting);
    const shut = g && eye.blink > 0 ? shutCell() : -1;
    gl.uniform1f(U.eye, g ? eye.on : 0);
    if (g) {
      // The half-shut frame looks straight ahead, so it's only used when he does.
      const half = !looking && g.blink && cell(g.blink.half) >= 0 ? cell(g.blink.half) : shut;
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, sheet); gl.uniform1i(U.eyes, 2);
      gl.uniform2f(U.eyeGrid, g.grid[0], g.grid[1]);
      gl.uniform4f(U.eyeL, ...g.eyes[0]);
      gl.uniform4f(U.eyeR, ...g.eyes[1]);
      gl.uniform4f(U.eyeCells, cell(eye.from), cell(eye.to), half, shut);
      gl.uniform1f(U.eyeMix, eye.mix);
      gl.uniform1f(U.blink, shut >= 0 ? eye.blink : 0);
    }
    gl.uniform1f(U.wire, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triBuf);
    gl.drawElements(gl.TRIANGLES, tris.length, gl.UNSIGNED_SHORT, 0);
    if (opt.debug) {
      gl.uniform1f(U.wire, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineBuf);
      gl.drawElements(gl.LINES, lines.length, gl.UNSIGNED_SHORT, 0);
    }
  }

  function frame(now) {
    raf = 0;
    // Between a millisecond and a twentieth of a second, whatever the clock says.
    const elapsed = Math.max(0.001, Math.min(0.05, (now - last) / 1000 || 0.016));
    last = now;
    const p = physics();

    // Where the hand ends up this frame.
    hand.px = hand.x; hand.py = hand.y;
    if (grab) {
      stretchHand();
      hand.x = grab.startX + grab.pullX; hand.y = grab.startY + grab.pullY;
    } else {
      hand.x = pointer.x; hand.y = pointer.y;
    }
    let hvx = (hand.x - hand.px) / elapsed, hvy = (hand.y - hand.py) / elapsed;

    // The brush is the visitor's hand, unless a phantom one has hold of him.
    const ghost = !grab && act.ghost && act.ghost.grip ? act.ghost : null;
    let fromX = hand.px, fromY = hand.py, toX = hand.x, toY = hand.y;
    let radius = 0, grip = 0;
    if (grab) {
      radius = Math.max(1.8, opt.grabRadius * p.cells); grip = GRIP;
    } else if (ghost) {
      fromX = ghost.px; fromY = ghost.py; toX = ghost.x; toY = ghost.y;
      hvx = (toX - fromX) / elapsed; hvy = (toY - fromY) / elapsed;
      radius = Math.max(1.8, opt.grabRadius * p.cells); grip = GRIP;
    } else if (pointer.over && opt.rub > 0 && opt.rubSlip > 0) {
      // Not grabbed, just touched: the hold is firm on skin that's at home
      // and fades to nothing as that skin is dragged out to `rubSlip`, so it
      // follows the cursor, pulls back harder and harder, and then gives.
      const [rx, ry] = restPoint(hand.x, hand.y);
      const dragged = Math.hypot(hand.x - rx, hand.y - ry) / p.cells;
      const hold = Math.max(0, 1 - dragged / opt.rubSlip);
      radius = Math.max(1.8, opt.rubRadius * p.cells); grip = opt.rub * hold * hold;
      // A touch can't throw the skin: it passes on no more speed than would
      // carry the skin to its slipping point, and none at all on the frame
      // the cursor arrives, when it has jumped here from somewhere else.
      const speed = Math.hypot(hvx, hvy), most = opt.rubSlip * p.cells * 26;
      const pass = !hand.touching ? 0 : speed > most ? most / speed : 1;
      hvx *= pass; hvy *= pass;
    }
    hand.touching = !grab && !ghost && pointer.over;

    // An act only needs the simulation while it leans him (or handles him,
    // which is a grip like any other); a yawn or a glance is a change of
    // picture.
    const physical = act.at >= 0 && (act.rock !== 0 || act.lean !== 0 || act.drop !== 0);
    if (grip > 0 || physical) atRest = false;
    if (!atRest) {
      simulate(p, elapsed, fromX, fromY, toX, toY, hvx, hvy, radius, grip);
      // As good as home: put him exactly there and stop simulating.
      if (moving + displaced < 1e-4 && !grab && grip === 0 && !physical) { settle(); atRest = true; }
      unshaded = true;
    }

    direct(now);
    if (faceMix < 1) faceMix = Math.min(1, faceMix + elapsed * faceSpeed);
    const looking = look(elapsed, now);
    state.pull = grab ? Math.hypot(grab.pullX, grab.pullY) / p.cells : 0;
    state.speed = grab ? Math.hypot(hvx, hvy) / p.cells : 0;
    state.grabbing = !!grab;
    state.look = eye.to;
    state.face = faceB;
    state.act = act.name;
    state.ghost = act.ghost ? { u: toImage(act.ghost.x), v: toImage(act.ghost.y), grip: act.ghost.grip, prop: opt.idle.acts[act.name].prop || "hand" } : null;
    state.blink = eye.blink;
    draw();
    emit("frame");

    // Skin held still under a hovering cursor is displaced but not going
    // anywhere; that alone is no reason to keep running.
    const held = !grab && !ghost && grip > 0;
    const busy = grab || moving > 0.02 || (displaced > 0.02 && !held) || faceMix < 1 || looking || now < mood.until + 300 || act.at >= 0;
    quiet = busy ? 0 : quiet + 1;
    // Out of sight, he stops where he is and picks up again when he's back.
    if (quiet < 20 && (visible || grab)) wake();
  }

  function wake() {
    if (raf || destroyed) return;
    if (quiet >= 20) { last = performance.now(); quiet = 19; }
    raf = requestAnimationFrame(frame);
  }

  // A lost WebGL context is the end of him: listeners hear "lost" (the page
  // can show the photograph again, and start him afresh) and everything is
  // torn down.
  ended = () => { emit("lost"); destroy(); };
  // He is up while his picture is on screen in a tab that's showing. The
  // rest of the time nothing runs: no frames, no timers, and whatever he was
  // in the middle of is dropped, so he never comes back to finish an act the
  // visitor didn't see begin, or still held by a finger that has long gone.
  function attend() {
    const now = visible && !document.hidden;
    if (now === up || destroyed) return;
    up = now;
    clearInterval(idleTimer); clearTimeout(blinkTimer); clearTimeout(blinkAgain);
    if (up) {
      // Coming back counts as something happening: he doesn't start an act
      // the instant he's seen again.
      lastActive = last = performance.now();
      idleTimer = setInterval(idle, 250);
      keepBlinking();
    } else {
      letGo();
      if (act.at >= 0) endAct(performance.now(), 0);
      eyesOn.until = 0;
    }
    // One more frame either way, so the page's props catch up with him.
    quiet = Math.min(quiet, 19);
    wake();
  }
  // Several changes can arrive at once; the last is how things stand now.
  const watcher = new IntersectionObserver((entries) => { visible = entries.at(-1).isIntersecting; attend(); });
  // The picture itself, not the canvas: its margin is empty.
  watcher.observe(hit);
  document.addEventListener("visibilitychange", attend);
  // Reduced motion switched on while he's in the middle of something.
  const onMotion = () => { if (motion.matches && act.at >= 0) { endAct(performance.now(), 0); wake(); } };
  motion.addEventListener("change", onMotion);
  attend();
  const observer = new ResizeObserver(() => { resize(); draw(); });
  observer.observe(canvas);
  // The window moving to a screen with a different pixel ratio changes the
  // canvas's resolution without changing its size.
  let density = null;
  const onDensity = () => { watchDensity(); resize(); draw(); };
  function watchDensity() {
    if (density) density.removeEventListener("change", onDensity);
    density = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    density.addEventListener("change", onDensity);
  }
  watchDensity();
  resize();
  draw();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    clearTimeout(blinkTimer); clearTimeout(blinkAgain); clearInterval(idleTimer);
    observer.disconnect(); watcher.disconnect();
    document.removeEventListener("visibilitychange", attend);
    motion.removeEventListener("change", onMotion);
    density.removeEventListener("change", onDensity);
    canvas.removeEventListener("webglcontextlost", onLost);
    disarm();
    hit.removeEventListener("pointerdown", onDown);
    hit.removeEventListener("click", onClick);
    hit.removeEventListener("touchmove", onTouchMove);
    hit.removeEventListener("contextmenu", onMenu);
    hit.style.cursor = "";
    hit.style.pointerEvents = "";
    document.documentElement.removeEventListener("pointerleave", onLeave);
    ACTIVITY.forEach((type) => window.removeEventListener(type, onActivity));
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", letGo);
    window.removeEventListener("pointercancel", letGo);
    window.removeEventListener("touchstart", onTouch);
    window.removeEventListener("touchmove", onTouch);
    window.removeEventListener("blur", onBlur);
    for (const texture of [...Object.values(textures), sheet]) if (texture) gl.deleteTexture(texture);
    for (const buffer of [homeBuf, dynBuf, triBuf, lineBuf]) gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    emit("destroy");
  }

  return {
    options: opt,
    faces: names,
    state,
    // Change options on the fly. Those that shaped him at creation (FIXED)
    // are ignored; eyes are given with setGaze.
    set(patch) {
      if (destroyed) return;
      for (const key in patch) if (!FIXED.includes(key) && key !== "gaze") opt[key] = patch[key];
      wake();
      draw();
    },
    setGaze,
    blink,
    act: startAct, // act("yawn"), or act() for whichever comes next
    // Pull a face for a moment: react("shock", 800).
    react(name, ms = 900) {
      if (destroyed || !textures[name]) return;
      if (act.at >= 0) endAct(performance.now(), 0);
      mood = { until: performance.now() + ms, face: name };
      wake();
    },
    // Cut short whatever idle act is playing.
    stop() { if (!destroyed && act.at >= 0) { endAct(performance.now(), 0); wake(); } },
    // Startle him as a tap would, in image space: tap(0.5, 0.45).
    tap,
    // Events: grab { touch }, release { pulled, cancelled }, tap { u, v },
    // act { name }, actend, frame, lost, destroy.
    on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    // A shove from nowhere, in image space: where, and which way.
    poke: shove,
    shove,
    wake,
    destroy,
  };
}

function link(gl, vs, fs) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// A picture that hasn't arrived after this long is given up on, so it can't
// hold up the ones behind it.
const PATIENCE = 20000;

function loadImage(src) {
  const img = new Image();
  if (typeof location !== 'undefined' && location.protocol !== 'file:' && typeof src === 'string' && src.startsWith('http')) {
    try { img.crossOrigin = "anonymous"; } catch (e) {}
  }
  img.src = src;
  const failed = () => new Error("could not load " + src);
  let timer = 0;
  return Promise.race([
    img.decode ? img.decode().then(() => img, () => {
      return new Promise((res, rej) => {
        if (img.complete && img.naturalWidth) res(img);
        else { img.onload = () => res(img); img.onerror = rej; }
      });
    }) : new Promise((res, rej) => {
      if (img.complete && img.naturalWidth) res(img);
      else { img.onload = () => res(img); img.onerror = rej; }
    }),
    new Promise((_, reject) => { timer = setTimeout(() => { img.src = ""; reject(failed()); }, PATIENCE); }),
  ]).finally(() => clearTimeout(timer));
}

// `most` is the longest side the texture may have (0 = as it comes).
function makeTexture(gl, img, most = 0) {
  let source = img;
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (most > 0 && longest > most) {
    try {
      source = document.createElement("canvas");
      source.width = Math.round((img.naturalWidth * most) / longest);
      source.height = Math.round((img.naturalHeight * most) / longest);
      const ctx = source.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, source.width, source.height);
    } catch (e) {
      source = img;
    }
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  if (source !== img) source.width = source.height = 0;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

if (typeof window !== 'undefined') {
  window.createPlushie = createPlushie;
}
