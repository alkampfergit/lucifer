// New-request alerts for the admin approval page (#62): OS notification, alert
// sound and a tab-title counter, raised only while the approver is looking
// elsewhere. Served at /admin/approvals/alerts.js and loaded by
// approval_page.html before its inline script, which drives it through the
// `LuciferAlerts` global.
window.LuciferAlerts = (() => {
  const ALERTS_KEY = 'lucifer.alerts';
  const SOUND_MUTED_KEY = 'lucifer.alerts.muted';
  const BASE_TITLE = 'Lucifer Approvals';
  const COMMAND_SUMMARY_MAX = 40;
  const REDACTED = '•••';
  const notifications = new Map();
  const unseen = new Set();
  // Mirrors every choice, so alerts still work for this tab where storage throws.
  const memorySettings = new Map();
  let audioCtx = null;

  function readSetting(key) {
    if (memorySettings.has(key)) return memorySettings.get(key);
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function writeSetting(key, value) {
    memorySettings.set(key, value);
    try { localStorage.setItem(key, value); } catch { /* Private mode: the in-memory copy lasts for this tab. */ }
  }

  function alertsEnabled() { return readSetting(ALERTS_KEY) === 'on'; }
  function soundMuted() { return readSetting(SOUND_MUTED_KEY) === 'true'; }

  /** `granted`, `default` or `denied` from the browser, or why notifications cannot work here. */
  function notificationSupport() {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (window.isSecureContext === false) return 'insecure';
    return Notification.permission;
  }

  const SOUND_ONLY_REASONS = {
    unsupported: 'This browser cannot show desktop notifications, so only the alert sound plays.',
    insecure: 'Browsers only show notifications on HTTPS or http://localhost. Enable TLS to get them here; until then only the alert sound plays.',
    denied: 'Notifications are blocked for this site in the browser settings, so only the alert sound plays.',
    default: 'Click to allow desktop notifications.'
  };

  function updateControls() {
    const btn = document.getElementById('notify-btn');
    const soundBtn = document.getElementById('sound-btn');
    const enabled = alertsEnabled();
    const support = notificationSupport();

    btn.classList.toggle('active', enabled);
    if (!enabled) {
      btn.textContent = '🔔 Enable notifications';
      btn.title = 'Alert me when a new request arrives while this tab is in the background';
    } else if (support === 'granted') {
      btn.textContent = '🔔 Notifications on';
      btn.title = 'Click to turn new-request alerts off';
    } else {
      btn.textContent = '🔔 Sound alerts only';
      btn.title = SOUND_ONLY_REASONS[support];
    }

    soundBtn.style.display = enabled ? 'inline-block' : 'none';
    soundBtn.textContent = soundMuted() ? '🔇' : '🔊';
    soundBtn.title = soundMuted() ? 'Unmute the alert sound' : 'Mute the alert sound';
  }

  /** Runs from a click, which is the user gesture browsers require for both permission and audio. */
  async function toggleAlerts() {
    const support = notificationSupport();
    if (alertsEnabled() && support !== 'default') {
      writeSetting(ALERTS_KEY, 'off');
      updateControls();
      return;
    }
    writeSetting(ALERTS_KEY, 'on');
    unlockAudio();
    if (support === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        // Refusing to ask is the same as a denial: sound alerts still work.
      }
    }
    updateControls();
    if (!soundMuted()) playAlertSound();
  }

  function toggleSound() {
    writeSetting(SOUND_MUTED_KEY, soundMuted() ? 'false' : 'true');
    updateControls();
    if (!soundMuted()) {
      unlockAudio();
      playAlertSound();
    }
  }

  function getAudioContext() {
    if (audioCtx) return audioCtx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try { audioCtx = new Ctor(); } catch { return null; }
    return audioCtx;
  }

  /** Audio stays suspended until a gesture, including after a reload with alerts already on. */
  function unlockAudio() {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  /** Two short tones synthesised on the fly, so there is no audio file to ship. */
  function playAlertSound() {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    [880, 1320].forEach((frequency, i) => {
      const start = ctx.currentTime + i * 0.18;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.17);
    });
  }

  function isApproverAway() {
    return document.hidden || !document.hasFocus();
  }

  // Flags whose value is typically a credential (curl -H/-u, docker -e, mysql -p, ...).
  const SECRET_FLAG = /^(-H|--header|-u|--user|-p|--pass(word)?|-e|--env|-b|--cookie|--token|--secret|--api-?key|--auth\S*)$/i;
  const SECRET_WORD = /auth|bearer|token|secret|passw|api[-_]?key|credential|cookie|private/i;
  // Long opaque strings with letters and digits and no path separator look like keys.
  const OPAQUE = /^(?=.*[A-Za-z])(?=.*\d)[\w+=.-]{24,}$/;

  /** Whitespace-separated words, keeping quoted spans together. */
  function tokenize(command) {
    return String(command).match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+|\S+/g) || [];
  }

  function redactToken(token) {
    const assignment = /^(-{0,2}[A-Za-z_][\w.-]*)=/.exec(token);
    if (assignment) return assignment[1] + '=' + REDACTED;
    if (token.includes('$') || SECRET_WORD.test(token) || OPAQUE.test(token)) return REDACTED;
    if (/:\/\/[^/\s]*@/.test(token)) return REDACTED;
    return token;
  }

  /** An unquoted bare word such as `Bearer` or `Authorization:`, whose value follows it. */
  function isSecretKeyword(token) {
    return SECRET_WORD.test(token) && !/[=$]/.test(token) && !/^['"]/.test(token);
  }

  /** Masks credential-bearing words, and the word after a credential flag or keyword. */
  function redactCommand(command) {
    let previous = '';
    return tokenize(command).map((token) => {
      const afterSecret = SECRET_FLAG.test(previous) || isSecretKeyword(previous);
      previous = token;
      return afterSecret ? REDACTED : redactToken(token);
    });
  }

  /**
   * Executable plus the start of its arguments, with anything that looks like a
   * credential masked. Notifications outlive the page on the lock screen and in
   * the OS history, so only the card inside the page shows the real command.
   */
  function summarizeCommand(command) {
    const words = redactCommand(command);
    const text = words.join(' ');
    if (text.length <= COMMAND_SUMMARY_MAX) return text;
    const kept = [];
    let length = 0;
    for (const word of words) {
      if (length + word.length > COMMAND_SUMMARY_MAX - 2) break;
      kept.push(word);
      length += word.length + 1;
    }
    // A first word too long to show whole is never cut: a prefix can leak a secret.
    return kept.length > 0 ? kept.join(' ') + ' …' : '…';
  }

  function updateTitle() {
    document.title = unseen.size > 0 ? '(' + unseen.size + ') ' + BASE_TITLE : BASE_TITLE;
  }

  function markSeen() {
    unseen.clear();
    updateTitle();
  }

  function showNotification(req, onClick) {
    if (notificationSupport() !== 'granted') return;
    const risk = (req.riskAnalysis && req.riskAnalysis.level) || 'safe';
    let notification;
    try {
      notification = new Notification('Lucifer: approval needed (' + risk.toUpperCase() + ')', {
        body: summarizeCommand(req.command) + '\nKey: ' + req.apiKeyName,
        // One notification per request, even if the browser sees it twice.
        tag: req.requestId,
        requireInteraction: risk === 'danger'
      });
    } catch {
      // Some mobile browsers only allow notifications from a service worker;
      // the sound and the title counter still announce the request.
      return;
    }
    notification.onclick = () => {
      window.focus();
      onClick(req.requestId);
      notification.close();
    };
    notification.onclose = () => {
      if (notifications.get(req.requestId) === notification) notifications.delete(req.requestId);
    };
    notifications.set(req.requestId, notification);
  }

  /** Announce a request that is new to this page; `onClick` receives its id. */
  function alertNewRequest(req, onClick) {
    if (!isApproverAway()) return;
    unseen.add(req.requestId);
    updateTitle();
    if (!alertsEnabled()) return;
    if (!soundMuted()) playAlertSound();
    showNotification(req, onClick);
  }

  /** The request was decided here, in another tab or on Telegram: its alert is stale. */
  function dismiss(requestId) {
    const notification = notifications.get(requestId);
    if (notification) {
      notifications.delete(requestId);
      notification.close();
    }
    if (unseen.delete(requestId)) updateTitle();
  }

  /** After a reconnect, drop alerts for requests decided while the stream was down. */
  function reconcile(pendingIds) {
    const stillPending = new Set(pendingIds);
    const stale = new Set([...notifications.keys(), ...unseen].filter((id) => !stillPending.has(id)));
    stale.forEach(dismiss);
  }

  function install() {
    window.addEventListener('focus', markSeen);
    document.addEventListener('visibilitychange', () => {
      if (!isApproverAway()) markSeen();
    });
    // With alerts already on from a previous visit, the first interaction lets audio play.
    const unlockIfAlerting = () => { if (alertsEnabled()) unlockAudio(); };
    document.addEventListener('pointerdown', unlockIfAlerting, { once: true });
    document.addEventListener('keydown', unlockIfAlerting, { once: true });
  }

  return { install, updateControls, toggleAlerts, toggleSound, alertNewRequest, dismiss, reconcile, summarizeCommand };
})();
