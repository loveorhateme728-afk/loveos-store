/* LOVE OS — Gamepad Bridge (games/gamepad.js)
   Shared controller support for the LOVE OS hub games.
   Translates a standard gamepad (e.g. an Xbox controller paired to a phone
   over Bluetooth) into the keyboard events these games already use, so their
   existing keyboard controls work unchanged:
     - Left stick (axes 0/1, deadzone 0.35) + D-pad (buttons 12-15)
         -> Arrow keys AND WASD (keydown/keyup, with key auto-repeat while held)
     - A (0) -> Space · B (1) -> Escape · X (2) -> E · Start (9) -> Enter
   Events are dispatched on the page body so they bubble up through document
   to window, reaching handlers registered at any level.
   Idle and silent when no gamepad is present; never throws on a device
   without one. */
(function () {
  'use strict';

  var DEADZONE = 0.35;

  var KEY_INFO = {
    ArrowUp:    { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 },
    ArrowDown:  { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40 },
    ArrowLeft:  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    KeyW: { key: 'w', code: 'KeyW', keyCode: 87 },
    KeyA: { key: 'a', code: 'KeyA', keyCode: 65 },
    KeyS: { key: 's', code: 'KeyS', keyCode: 83 },
    KeyD: { key: 'd', code: 'KeyD', keyCode: 68 },
    Space:  { key: ' ',       code: 'Space',  keyCode: 32 },
    Escape: { key: 'Escape',  code: 'Escape', keyCode: 27 },
    KeyE:   { key: 'e',       code: 'KeyE',   keyCode: 69 },
    Enter:  { key: 'Enter',   code: 'Enter',  keyCode: 13 }
  };

  function sendKey(type, name) {
    var info = KEY_INFO[name];
    if (!info) return;
    try {
      var ev = new KeyboardEvent(type, {
        key: info.key,
        code: info.code,
        bubbles: true,
        cancelable: true
      });
      /* The KeyboardEvent constructor cannot set the legacy keyCode/which
         fields that some handlers read, so define them on the instance. */
      try {
        Object.defineProperty(ev, 'keyCode', {
          get: function () { return info.keyCode; }
        });
        Object.defineProperty(ev, 'which', {
          get: function () { return info.keyCode; }
        });
      } catch (ignore) { /* key/code are still set */ }
      var target = document.body || document.documentElement || document;
      target.dispatchEvent(ev);
    } catch (ignore) {
      /* The bridge must never break the page it rides on. */
    }
  }

  /* ---- Directions: each direction drives its arrow key + WASD twin ---- */
  var DIRECTIONS = {
    up:    ['ArrowUp', 'KeyW'],
    down:  ['ArrowDown', 'KeyS'],
    left:  ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD']
  };
  var dirHeld = { up: false, down: false, left: false, right: false };

  function applyDirection(dir, active) {
    var keys = DIRECTIONS[dir];
    var i;
    if (active) {
      /* keydown on the press edge, then repeated while held — the same
         stream a held physical key produces. */
      for (i = 0; i < keys.length; i++) sendKey('keydown', keys[i]);
      dirHeld[dir] = true;
    } else if (dirHeld[dir]) {
      for (i = 0; i < keys.length; i++) sendKey('keyup', keys[i]);
      dirHeld[dir] = false;
    }
  }

  /* ---- Buttons: edge-triggered taps ---- */
  var BUTTON_KEYS = { 0: 'Space', 1: 'Escape', 2: 'KeyE', 9: 'Enter' };
  var btnPrev = {};

  function pollButtons(pad) {
    for (var idx in BUTTON_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(BUTTON_KEYS, idx)) continue;
      var b = pad.buttons ? pad.buttons[idx] : null;
      var pressed = !!(b && (b.pressed || b.value > 0.5));
      if (pressed && !btnPrev[idx]) {
        sendKey('keydown', BUTTON_KEYS[idx]);
        sendKey('keyup', BUTTON_KEYS[idx]);
      }
      btnPrev[idx] = pressed;
    }
  }

  function releaseAll() {
    for (var dir in DIRECTIONS) {
      if (Object.prototype.hasOwnProperty.call(DIRECTIONS, dir)) {
        applyDirection(dir, false);
      }
    }
    btnPrev = {};
  }

  /* ---- "Controller connected" note ---- */
  var noteEl = null;
  var noteHideTimer = null;
  var noteRemoveTimer = null;

  function showConnectedNote() {
    try {
      if (!document.body) return;
      if (!noteEl) {
        noteEl = document.createElement('div');
        noteEl.textContent = 'Controller connected';
        noteEl.style.cssText =
          'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);' +
          'z-index:99999;pointer-events:none;' +
          'background:rgba(10,10,16,0.85);color:#ffffff;' +
          'border:1px solid rgba(255,255,255,0.25);border-radius:999px;' +
          'padding:6px 14px;font:13px/1.4 system-ui,sans-serif;' +
          'opacity:0;transition:opacity 0.4s ease;';
      }
      if (!noteEl.parentNode) document.body.appendChild(noteEl);
      if (noteHideTimer) clearTimeout(noteHideTimer);
      if (noteRemoveTimer) clearTimeout(noteRemoveTimer);
      /* Force a reflow so the fade-in transition runs. */
      void noteEl.offsetWidth;
      noteEl.style.opacity = '1';
      noteHideTimer = setTimeout(function () {
        if (noteEl) noteEl.style.opacity = '0';
        noteRemoveTimer = setTimeout(function () {
          if (noteEl && noteEl.parentNode) {
            noteEl.parentNode.removeChild(noteEl);
          }
        }, 450);
      }, 2600);
    } catch (ignore) { /* note is cosmetic; never throw */ }
  }

  /* ---- Polling loop ---- */
  function getPad() {
    if (!navigator.getGamepads) return null;
    var pads;
    try {
      pads = navigator.getGamepads();
    } catch (ignore) {
      return null;
    }
    if (!pads) return null;
    for (var i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) return pads[i];
    }
    return null;
  }

  function buttonDown(pad, i) {
    var b = pad.buttons ? pad.buttons[i] : null;
    return !!(b && b.pressed);
  }

  var announced = false;
  var hadPad = false;

  function poll() {
    var pad = getPad();
    if (pad) {
      hadPad = true;
      if (!announced) {
        announced = true;
        showConnectedNote();
      }
      var axes = pad.axes || [];
      var x = axes[0] || 0;
      var y = axes[1] || 0;
      applyDirection('up', y < -DEADZONE || buttonDown(pad, 12));
      applyDirection('down', y > DEADZONE || buttonDown(pad, 13));
      applyDirection('left', x < -DEADZONE || buttonDown(pad, 14));
      applyDirection('right', x > DEADZONE || buttonDown(pad, 15));
      pollButtons(pad);
    } else if (hadPad) {
      hadPad = false;
      releaseAll();
    }
    schedule(poll);
  }

  var schedule =
    window.requestAnimationFrame ||
    function (cb) { return setTimeout(cb, 16); };

  if (window.addEventListener) {
    window.addEventListener('gamepadconnected', function () {
      announced = true;
      showConnectedNote();
    });
    window.addEventListener('gamepaddisconnected', function () {
      releaseAll();
    });
  }

  schedule(poll);
})();
