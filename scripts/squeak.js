/**
 * Squeak — optional rubber-toy sounds for a Plushie.
 *
 * Everything is synthesised; there are no audio files. A stretched-rubber
 * creak follows the pull (higher the further it goes, louder the faster the
 * hand moves) and letting go fires a snap and a boing sized to the pull.
 * When he whistles to himself, there is a tune to go with it.
 *
 * Browsers only let a page make sound from inside a click, a key press or a
 * finger lifting (a finger landing or dragging doesn't count), so that is
 * where the AudioContext is created and woken. Nothing plays or even loads
 * until then, and while sound is switched off the context is put to sleep.
 *
 *     const squeak = attachSqueak(plush);
 *     squeak.enabled = false;
 */
function attachSqueak(plush, { volume = 0.6 } = {}) {
  let ctx = null, master = null, creak = null, creakGain = null, creakFilter = null;
  let enabled = true, asleep = 0;

  function boot() {
    clearTimeout(asleep);
    // Not inside a gesture the browser accepts: it would only refuse.
    if (navigator.userActivation && !navigator.userActivation.isActive) return !!ctx;
    // "suspended", or iOS's "interrupted" after a call or a trip to another app.
    if (ctx) { if (ctx.state !== "running") ctx.resume().catch(() => {}); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);

    // The creak runs silently the whole time and is only turned up while
    // the hand is moving.
    creak = ctx.createOscillator();
    creak.type = "sawtooth";
    creakFilter = ctx.createBiquadFilter();
    creakFilter.type = "bandpass";
    creakFilter.Q.value = 7;
    creakGain = ctx.createGain();
    creakGain.gain.value = 0;
    creak.connect(creakFilter).connect(creakGain).connect(master);
    creak.start();
    return true;
  }

  // The creak follows the hand, frame by frame as the engine draws them.
  function follow() {
    if (!ctx || ctx.state !== "running") return;
    const { pull, speed, grabbing } = plush.state;
    const now = ctx.currentTime;
    const pitch = 150 + pull * 620;
    creak.frequency.setTargetAtTime(pitch, now, 0.03);
    creakFilter.frequency.setTargetAtTime(pitch * 3.1, now, 0.03);
    // Stick-slip: rubber doesn't sing evenly, it judders.
    const grit = 0.55 + Math.random() * 0.45;
    const loud = grabbing && enabled ? Math.min(1, speed * 0.9) * 0.16 * grit : 0;
    creakGain.gain.setTargetAtTime(loud, now, 0.025);
  }

  function boing(pulled) {
    const now = ctx.currentTime;
    const size = Math.min(1, pulled * 2.6);
    if (size < 0.08) return;

    // Snap: a very short burst of filtered noise as the skin lets go.
    const len = Math.floor(ctx.sampleRate * 0.05);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const snap = ctx.createBufferSource();
    snap.buffer = buffer;
    const snapFilter = ctx.createBiquadFilter();
    snapFilter.type = "bandpass";
    snapFilter.frequency.value = 1400;
    const snapGain = ctx.createGain();
    snapGain.gain.value = 0.35 * size;
    snap.connect(snapFilter).connect(snapGain).connect(master);
    snap.start(now);

    // Boing: a falling tone with a wobble on it that dies away, pitched and
    // sized by how far he was pulled.
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(190 + size * 260, now);
    osc.frequency.exponentialRampToValueAtTime(72, now + 0.55);
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 9 + size * 5;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(50 * size, now);
    depth.gain.exponentialRampToValueAtTime(1, now + 0.6);
    wobble.connect(depth).connect(osc.frequency);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.32 * size, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    osc.connect(gain).connect(master);
    osc.start(now); wobble.start(now);
    osc.stop(now + 0.75); wobble.stop(now + 0.75);
  }

  // A breathy sine sliding between a handful of notes, different each time.
  let tune = null;
  function whistle() {
    const now = ctx.currentTime;
    const scale = [1047, 1175, 1319, 1568, 1760, 2093]; // C major pentatonic, high
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.5;
    const depth = ctx.createGain();
    depth.gain.value = 9;
    vibrato.connect(depth).connect(osc.frequency);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    let t = now + 0.15, note = 2;
    for (let n = 0; n < 8; n++) {
      note = Math.max(0, Math.min(scale.length - 1, note + Math.round(Math.random() * 4 - 2)));
      const long = Math.random() < 0.35 ? 0.5 : 0.28;
      osc.frequency.setTargetAtTime(scale[note], t, 0.025); // slide into each note
      gain.gain.setTargetAtTime(0.11, t, 0.02);
      gain.gain.setTargetAtTime(0.02, t + long * 0.8, 0.03);
      t += long;
    }
    gain.gain.setTargetAtTime(0.0001, t, 0.05);
    osc.connect(gain).connect(master);
    osc.start(now); vibrato.start(now);
    osc.stop(t + 0.4); vibrato.stop(t + 0.4);
    tune = { gain, osc, vibrato };
  }
  function hush() {
    if (!tune) return;
    const now = ctx.currentTime;
    tune.gain.gain.cancelScheduledValues(now);
    tune.gain.gain.setTargetAtTime(0.0001, now, 0.03);
    try { tune.osc.stop(now + 0.2); tune.vibrato.stop(now + 0.2); } catch {}
    tune = null;
  }
  plush.on("act", ({ name }) => { if (name === "whistle" && enabled && ctx && ctx.state === "running") whistle(); });
  plush.on("actend", () => { if (ctx) hush(); });

  // Caught on the way down the page (capture), so that the sound is awake by
  // the time the engine hears the same event and lets go of him.
  const unlock = () => { if (enabled) boot(); };
  const GESTURES = ["pointerdown", "pointerup", "touchend", "click", "keydown"];
  GESTURES.forEach((type) => window.addEventListener(type, unlock, { passive: true, capture: true }));
  plush.on("frame", () => { if (plush.state.grabbing) follow(); });
  plush.on("release", ({ pulled, cancelled }) => {
    if (!ctx) return;
    creakGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    if (!enabled || cancelled) return;
    // A context only just woken takes a moment to start running.
    if (ctx.state === "running") boing(pulled);
    else ctx.resume().then(() => { if (ctx && enabled) boing(pulled); }, () => {});
  });

  return {
    get enabled() { return enabled; },
    // Off means off at once, including anything already sounding.
    set enabled(on) {
      enabled = !!on;
      // Switched on from a click, this is the gesture that lets it start.
      if (enabled) boot();
      if (!ctx) return;
      master.gain.setTargetAtTime(enabled ? volume : 0, ctx.currentTime, 0.02);
      if (enabled) return;
      creakGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      hush();
      // Once it has faded, stop the audio hardware working for nothing.
      asleep = setTimeout(() => { if (ctx && !enabled) ctx.suspend().catch(() => {}); }, 300);
    },
    destroy() {
      enabled = false;
      clearTimeout(asleep);
      GESTURES.forEach((type) => window.removeEventListener(type, unlock, { capture: true }));
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
    },
  };
}

if (typeof window !== 'undefined') {
  window.attachSqueak = attachSqueak;
}
