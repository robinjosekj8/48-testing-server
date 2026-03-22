/**
 * scheduler.js  –  Blank-screen / screen-saver for Caffe Screen
 *
 * Reads settings from /scheduler.json:
 *   enabled            – master on/off switch
 *   screensaverMode    – 'drift' (moving text) | 'blank' (pure black)
 *   driftText          – text shown in drift mode
 *   idleTimeoutMinutes – blank after N minutes of no interaction
 *   scheduledBlankPeriods – [{label, startTime "HH:MM", endTime "HH:MM", enabled}]
 *
 * On page-load during a scheduled period: shows label + 60-s countdown,
 * then activates the screensaver.
 */
(function () {
  'use strict';

  const CONFIG_URL = '/scheduler.json';
  const COUNTDOWN_SECONDS = 60;

  let config = null;
  let idleTimer = null;
  let isBlankActive = false;

  // Drift screensaver state
  let driftRaf = null;      // requestAnimationFrame handle
  let driftEl = null;       // the moving element
  let driftX = 0, driftY = 0, driftVX = 0.4, driftVY = 0.3;


  // ── Overlay element ──────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'screen-blank-overlay';
  document.documentElement.appendChild(overlay);

  // ── Core show/hide ───────────────────────────────────────────────────────────
  function showBlank(reason) {
    if (!isBlankActive) {
      console.log('[Scheduler] Blanked –', reason);
      isBlankActive = true;
    }
    overlay.innerHTML = '';
    overlay.classList.add('blank-active');
    // Start drift or stay pure black based on config
    if ((config.screensaverMode || 'drift') === 'drift') {
      startDrift();
    }
  }

  function hideBlank() {
    if (isBlankActive) {
      console.log('[Scheduler] Woken.');
      isBlankActive = false;
    }
    stopDrift();
    overlay.innerHTML = '';
    overlay.classList.remove('blank-active');
  }

  // ── Drift screensaver ─────────────────────────────────────────────────────────
  function startDrift() {
    stopDrift();   // clear any previous loop
    const text = (config && config.driftText) || 'Caffe Screen';

    driftEl = document.createElement('div');
    driftEl.className = 'drift-label';
    driftEl.textContent = text;
    overlay.appendChild(driftEl);

    // Start near center with a small random offset
    const ow = overlay.offsetWidth  || window.innerWidth;
    const oh = overlay.offsetHeight || window.innerHeight;
    driftX = ow * 0.3 + Math.random() * ow * 0.4;
    driftY = oh * 0.3 + Math.random() * oh * 0.4;

    // Random direction, constant slow speed
    const speed = 0.55;   // pixels per frame (~33 px/s at 60 fps)
    const angle = Math.random() * 2 * Math.PI;
    driftVX = Math.cos(angle) * speed;
    driftVY = Math.sin(angle) * speed;

    function tick() {
      if (!driftEl) return;
      const ew = driftEl.offsetWidth;
      const eh = driftEl.offsetHeight;
      const maxX = (overlay.offsetWidth  || window.innerWidth)  - ew;
      const maxY = (overlay.offsetHeight || window.innerHeight) - eh;

      driftX += driftVX;
      driftY += driftVY;

      if (driftX <= 0)    { driftX = 0;    driftVX = Math.abs(driftVX); }
      if (driftX >= maxX) { driftX = maxX; driftVX = -Math.abs(driftVX); }
      if (driftY <= 0)    { driftY = 0;    driftVY = Math.abs(driftVY); }
      if (driftY >= maxY) { driftY = maxY; driftVY = -Math.abs(driftVY); }

      driftEl.style.transform = `translate(${driftX}px, ${driftY}px)`;
      driftRaf = requestAnimationFrame(tick);
    }
    driftRaf = requestAnimationFrame(tick);
  }

  function stopDrift() {
    if (driftRaf) { cancelAnimationFrame(driftRaf); driftRaf = null; }
    driftEl = null;
  }

  // ── Time helpers ─────────────────────────────────────────────────────────────
  function toMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  // Returns the active scheduled period object (or null).
  // Handles overnight windows like 23:00 → 07:00.
  function getActivePeriod() {
    if (!config || !config.enabled) return null;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const periods = config.scheduledBlankPeriods || [];
    return periods.find(p => {
      if (!p.enabled) return false;
      const s = toMinutes(p.startTime);
      const e = toMinutes(p.endTime);
      if (s <= e) return nowMin >= s && nowMin < e;
      return nowMin >= s || nowMin < e;   // overnight
    }) || null;
  }

  // ── Countdown shown on page-load during a scheduled period ──────────────────
  function showCountdownThenBlank(period) {
    let remaining = COUNTDOWN_SECONDS;
    overlay.classList.add('blank-active');
    isBlankActive = true;
    renderCountdown(period.label, remaining);

    const tick = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(tick);
        showBlank('scheduled period – countdown ended');
      } else {
        renderCountdown(period.label, remaining);
      }
    }, 1000);
  }

  function renderCountdown(label, seconds) {
    overlay.innerHTML = `
      <div class="sched-message">
        <div class="sched-icon">🌙</div>
        <div class="sched-label">${label}</div>
        <div class="sched-sub">Screen will go blank in</div>
        <div class="sched-countdown">${seconds}</div>
        <div class="sched-unit">seconds</div>
      </div>`;
  }

  // ── Periodic schedule check (every 30 s) ─────────────────────────────────────
  function checkSchedule() {
    if (!config || !config.enabled) return;
    const activePeriod = getActivePeriod();
    if (activePeriod) {
      if (!isBlankActive) showBlank('scheduled period');
    } else if (isBlankActive) {
      hideBlank();
      resetIdleTimer();
    }
  }

  // ── Idle timer ──────────────────────────────────────────────────────────────
  function resetIdleTimer() {
    if (!config || !config.enabled) return;
    const ms = (config.idleTimeoutMinutes || 0) * 60 * 1000;
    if (ms <= 0) return;

    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      // Only trigger idle blank if not already in a scheduled period
      if (!isBlankActive) {
        showBlank('idle timeout');
      }
    }, ms);
  }

  function handleActivity() {
    if (getActivePeriod()) return;   // scheduled period – ignore user input
    hideBlank();
    resetIdleTimer();
  }

  const WAKE_EVENTS = ['mousemove', 'mousedown', 'touchstart', 'keydown', 'click'];

  function attachActivityListeners() {
    WAKE_EVENTS.forEach(evt => {
      document.addEventListener(evt, handleActivity, { passive: true });
    });
  }

  // ── Initialise ──────────────────────────────────────────────────────────────
  fetch(CONFIG_URL)
    .then(res => {
      if (!res.ok) throw new Error('scheduler.json not found');
      return res.json();
    })
    .then(cfg => {
      config = cfg;

      if (!config.enabled) {
        console.log('[Scheduler] Disabled via config.');
        return;
      }

      const activePeriod = getActivePeriod();
      if (activePeriod) {
        // Page refreshed during a scheduled period → show label + countdown → blank
        showCountdownThenBlank(activePeriod);
      }

      setInterval(checkSchedule, 30_000);
      attachActivityListeners();
      resetIdleTimer();

      console.log('[Scheduler] Ready. Idle:', config.idleTimeoutMinutes, 'min');
    })
    .catch(err => {
      console.warn('[Scheduler] Could not load scheduler.json –', err.message);
    });
})();
