// Solmara — input.js
// Keyboard + touch input. One object, polled once per frame by game.js.
// Movement (x, y) is a normalised -1..1 vector from WASD/arrows or the
// on-screen joystick. Held actions (run/act/fire) are live getters.
// Edge-triggered keys (pause/mute/quality/start/mission/act) set a flag on
// the keydown and stay set until the game consumes them, so a 60 Hz poll
// can never miss a press.
const Sol = window.Sol = window.Sol || {};

const JOY_RADIUS = 64;
const JOY_KNOB = 28;
const BUTTON_R = 36; // 72 px diameter, above the 68 px minimum
const DEADZONE = 0.14;

export function createInput(canvas) {
  const keys = new Set();
  let joyPointerId = null;
  let joyBaseX = 96;
  let joyBaseY = 0;
  let joyDX = 0;
  let joyDY = 0;
  const buttonPointers = new Map(); // pointerId -> button id
  let clickAt = -1000000; // ms timestamp of the last tap/click (tap-to-start edge)

  const touch = {
    active: false, // true while the joystick is being held
    joyX: 0,
    joyY: 0,
    joyBaseX: 96,
    joyBaseY: 0,
    joyRadius: JOY_RADIUS,
    // Render draws the touch UI from these; positions are CSS pixels.
    buttons: [
      { id: 'fire', label: 'FIRE', x: 0, y: 0, r: BUTTON_R, pressed: false },
      { id: 'act', label: 'ACT', x: 0, y: 0, r: BUTTON_R, pressed: false },
      { id: 'run', label: 'RUN', x: 0, y: 0, r: BUTTON_R, pressed: false },
    ],
  };

  function layout() {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    joyBaseX = 96;
    joyBaseY = h - 104;
    touch.joyBaseX = joyBaseX;
    touch.joyBaseY = joyBaseY;
    const byId = {};
    for (const b of touch.buttons) byId[b.id] = b;
    byId.fire.x = w - 76;
    byId.fire.y = h - 92;
    byId.act.x = w - 168;
    byId.act.y = h - 64;
    byId.run.x = w - 76;
    byId.run.y = h - 196;
  }

  function buttonAt(px, py) {
    for (const b of touch.buttons) {
      const dx = px - b.x;
      const dy = py - b.y;
      if (dx * dx + dy * dy <= (b.r + 6) * (b.r + 6)) return b;
    }
    return null;
  }

  function posOf(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function updateJoy(px, py) {
    let dx = px - joyBaseX;
    let dy = py - joyBaseY;
    const len = Math.hypot(dx, dy);
    const max = JOY_RADIUS;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    joyDX = dx;
    joyDY = dy;
    let nx = dx / max;
    let ny = dy / max;
    const mag = Math.hypot(nx, ny);
    if (mag < DEADZONE) {
      nx = 0;
      ny = 0;
    } else if (mag > 1) {
      nx /= mag;
      ny /= mag;
    }
    touch.joyX = nx;
    touch.joyY = ny;
    touch.active = true;
  }

  function releaseJoy() {
    joyPointerId = null;
    joyDX = 0;
    joyDY = 0;
    touch.joyX = 0;
    touch.joyY = 0;
    touch.active = false;
  }

  const input = {
    // --- edge-triggered flags (cleared by consume* helpers) ---
    pausePressed: false,
    mutePressed: false,
    qualityPressed: false,
    startPressed: false,
    actPressed: false,
    missionKey: null, // 1..5, or null
    anyKey: false,

    touch,

    isDown(code) { return keys.has(code); },
    get joy() { return { x: touch.joyX, y: touch.joyY }; },
    get clicked() { return performance.now() - clickAt < 200; },

    get x() {
      let v = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) v -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) v += 1;
      if (v === 0) v = touch.joyX;
      return v;
    },
    get y() {
      let v = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) v -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) v += 1;
      if (v === 0) v = touch.joyY;
      return v;
    },
    get run() {
      if (keys.has('ShiftLeft') || keys.has('ShiftRight')) return true;
      const runBtn = touch.buttons[2];
      return runBtn.pressed;
    },
    get act() {
      if (keys.has('KeyE')) return true;
      return touch.buttons[1].pressed;
    },
    get fire() {
      if (keys.has('Space')) return true;
      return touch.buttons[0].pressed;
    },

    // --- consume helpers: return the pending edge event, then clear it ---
    consumePause() {
      const v = this.pausePressed;
      this.pausePressed = false;
      return v;
    },
    consumeMute() {
      const v = this.mutePressed;
      this.mutePressed = false;
      return v;
    },
    consumeQuality() {
      const v = this.qualityPressed;
      this.qualityPressed = false;
      return v;
    },
    consumeStart() {
      const v = this.startPressed;
      this.startPressed = false;
      return v;
    },
    consumeAct() {
      const v = this.actPressed;
      this.actPressed = false;
      return v;
    },
    consumeMission() {
      const v = this.missionKey;
      this.missionKey = null;
      return v;
    },
    consumeAny() {
      const v = this.anyKey;
      this.anyKey = false;
      return v;
    },
    // Clear every pending edge event at once (e.g. on screen change).
    consume() {
      this.pausePressed = false;
      this.mutePressed = false;
      this.qualityPressed = false;
      this.startPressed = false;
      this.actPressed = false;
      this.missionKey = null;
      this.anyKey = false;
    },
    // True while any movement key or the joystick is held.
    get moving() {
      return this.x !== 0 || this.y !== 0;
    },
    layout,
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', layout);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    },
  };

  function onKeyDown(e) {
    const gameKeys = [
      'KeyW', 'KeyA', 'KeyS', 'KeyD',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Space', 'ShiftLeft', 'ShiftRight',
    ];
    if (gameKeys.includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    input.anyKey = true;
    if (e.code === 'KeyP' || e.code === 'Escape') input.pausePressed = true;
    else if (e.code === 'KeyM') input.mutePressed = true;
    else if (e.code === 'KeyQ') input.qualityPressed = true;
    else if (e.code === 'Enter') input.startPressed = true;
    else if (e.code === 'KeyE') input.actPressed = true;
    else if (e.code >= 'Digit1' && e.code <= 'Digit5') {
      input.missionKey = Number(e.code.slice(5));
    }
  }

  function onKeyUp(e) {
    keys.delete(e.code);
  }

  function onPointerDown(e) {
    e.preventDefault();
    layout();
    const p = posOf(e);
    input.anyKey = true;
    const btn = buttonAt(p.x, p.y);
    if (btn) {
      btn.pressed = true;
      buttonPointers.set(e.pointerId, btn.id);
      if (btn.id === 'act') input.actPressed = true;
      return;
    }
    const joyDist = Math.hypot(p.x - joyBaseX, p.y - joyBaseY);
    if (joyDist <= JOY_RADIUS + 30 || (p.x < 220 && p.y > canvas.getBoundingClientRect().height - 240)) {
      joyPointerId = e.pointerId;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_err) {
        // Pointer capture is best-effort; the move/up handlers still work.
      }
      updateJoy(p.x, p.y);
      return;
    }
    // Tap anywhere else: start / confirm.
    input.startPressed = true;
    clickAt = performance.now();
  }

  function onPointerMove(e) {
    if (e.pointerId === joyPointerId) {
      const p = posOf(e);
      updateJoy(p.x, p.y);
    }
  }

  function onPointerUp(e) {
    if (e.pointerId === joyPointerId) releaseJoy();
    const btnId = buttonPointers.get(e.pointerId);
    if (btnId) {
      const btn = touch.buttons.find((b) => b.id === btnId);
      if (btn) btn.pressed = false;
      buttonPointers.delete(e.pointerId);
    }
  }

  function onBlur() {
    keys.clear();
    releaseJoy();
    for (const b of touch.buttons) b.pressed = false;
    buttonPointers.clear();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', layout);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  // Belt-and-braces against pull-to-refresh / scroll on touch devices.
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  layout();

  return input;
}

Sol.createInput = createInput;
