// @ts-check
/** @typedef {Omit<AudioContext,'state'> & {readonly state:AudioContextState|'interrupted'}} BrowserAudioContext */
/** @typedef {{previous:string,session:BrowserAudioSession}} OwnedAudioSession */
/** @typedef {number} AudioScopeOwner */
import "./camera.js";
import "./detector.js";
import "./calibration.js";
import "./metrics.js";
import "./storage-history.js";
import { pushFleet } from "./cloud-sync.js";
import { experimentFlags, experimentController, startupAllowsMonitoring, alertsEl, alertScreen, alertTitle, alertSub, nightOpacity, running, starting, confidence, sessionStart, calibrating, log, _lastBreakPrompt, set__lastBreakPrompt } from "./ui.js";
export let acceptedAlertHook = /** @type {((reason:string)=>void)|null} */ (null);
/** @param {(reason:string)=>void} hook */
export function registerAcceptedAlertHook(hook) { acceptedAlertHook = hook; }
export let lastAlert = 0, alerts = 0, escalationLevel = 0, lastEscalation = 0;
export let _ac = /** @type {BrowserAudioContext|null} */ (null), _acResumePending = /** @type {BrowserAudioContext|null} */ (null), _alertAudio = /** @type {HTMLAudioElement|null} */ (null), _alertAudioRequested = false;
export let _alertAudioTimer = /** @type {ReturnType<typeof setTimeout>|null} */ (null), _alertAudioRevision = 0, _alertAudioOwner = 0, _alertAudioSession = /** @type {OwnedAudioSession|null} */ (null), _alertTestOwner = 0;
export const ALERT_AUDIO_URL = '/audio/alert.v1.wav';
/** @returns {BrowserAudioContext|null} */
export function getAC() {
    if (!_ac || _ac.state === 'closed') {
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            _ac = AudioContextClass ? new AudioContextClass() : null;
        }
        catch (e) {
            _ac = null;
        }
    }
    return _ac;
}
export function requestAlertPlaybackSession() {
    try {
        const session = navigator.audioSession;
        if (!session)
            return;
        if (!_alertAudioSession)
            _alertAudioSession = { session, previous: typeof session.type === 'string' ? session.type : 'auto' };
        if (session.type !== 'playback')
            session.type = 'playback';
    }
    catch (e) { }
}
/** @returns {AudioScopeOwner} */
export function beginAlertAudioScope() {
    const owner = ++_alertAudioOwner;
    _alertAudioRequested = true;
    primeAlertAudio(true);
    return owner;
}
/** @param {AudioScopeOwner} [owner] @returns {boolean} */
export function releaseAlertAudioScope(owner = _alertAudioOwner) {
    if (owner !== _alertAudioOwner)
        return false;
    _alertAudioOwner++;
    _alertAudioRequested = false;
    cancelFallbackAlert();
    const held = _alertAudioSession;
    _alertAudioSession = null;
    try {
        if (held && navigator.audioSession === held.session && held.session.type === 'playback')
            held.session.type = held.previous;
    }
    catch (e) { }
    return true;
}
/** @param {AudioScopeOwner} owner @returns {void} */
export function clearParkedAlertTest(owner) {
    if (!_alertTestOwner || owner !== _alertTestOwner)
        return;
    _alertTestOwner = 0;
    alertScreen.classList.remove('show');
    alertTitle.textContent = 'DROWSY ALERT';
    alertSub.textContent = 'Pull over safely';
}
/** @returns {HTMLAudioElement|null} */
export function getAlertAudio() {
    if (!_alertAudio) {
        try {
            _alertAudio = new Audio(ALERT_AUDIO_URL);
            _alertAudio.preload = 'auto';
            _alertAudio.loop = false;
        }
        catch (e) {
            _alertAudio = null;
        }
    }
    return _alertAudio;
}
export function cancelFallbackAlert() {
    _alertAudioRevision++;
    if (_alertAudioTimer !== null)
        clearTimeout(_alertAudioTimer);
    _alertAudioTimer = null;
    if (_alertAudio) {
        try {
            _alertAudio.pause();
            _alertAudio.currentTime = 0;
        }
        catch (e) { }
    }
}
export function primeAlertAudio(userGesture = false) {
    if (!_alertAudioRequested || document.hidden)
        return;
    if (userGesture)
        requestAlertPlaybackSession();
    try {
        const ac = getAC();
        if (ac && (ac.state === 'suspended' || ac.state === 'interrupted') && _acResumePending !== ac) {
            _acResumePending = ac;
            const timeout = setTimeout(() => {
                if (_acResumePending === ac)
                    _acResumePending = null;
            }, 1000);
            Promise.resolve(ac.resume()).catch(() => { }).finally(() => {
                clearTimeout(timeout);
                if (_acResumePending === ac)
                    _acResumePending = null;
            });
        }
    }
    catch (e) {
        _acResumePending = null;
    }
    // A muted, bounded play in the gesture prepares the one fallback element.
    // Browser permission may still reject a later alert; no audible setup cue.
    if (userGesture && _alertAudioTimer === null) {
        const audio = getAlertAudio();
        if (!audio)
            return;
        const revision = ++_alertAudioRevision;
        try {
            audio.muted = true;
            audio.currentTime = 0;
            _alertAudioTimer = setTimeout(() => {
                if (revision === _alertAudioRevision)
                    cancelFallbackAlert();
            }, 150);
            Promise.resolve(audio.play()).catch(() => {
                if (revision === _alertAudioRevision)
                    cancelFallbackAlert();
            });
        }
        catch (e) {
            cancelFallbackAlert();
        }
    }
}
/** @param {number} dur @param {number} gain */
export function playFallbackAlert(dur, gain) {
    if (!_alertAudioRequested || document.hidden)
        return;
    const audio = getAlertAudio();
    if (!audio)
        return;
    cancelFallbackAlert();
    const revision = _alertAudioRevision;
    try {
        audio.muted = false;
        audio.volume = Math.max(0, Math.min(1, gain));
        audio.currentTime = 0;
        _alertAudioTimer = setTimeout(() => {
            if (revision === _alertAudioRevision)
                cancelFallbackAlert();
        }, Math.max(1, Math.min(900, dur)));
        Promise.resolve(audio.play()).catch(() => {
            if (revision === _alertAudioRevision)
                cancelFallbackAlert();
        });
    }
    catch (e) {
        cancelFallbackAlert();
    }
}
/** @param {number} freq @param {number} dur @param {number} gain */
export function tone(freq, dur, gain) {
    if (!_alertAudioRequested || document.hidden)
        return;
    try {
        const ac = getAC();
        if (ac && (ac.state === 'suspended' || ac.state === 'interrupted'))
            primeAlertAudio();
        // Do not schedule an oscillator that could play much later after recovery.
        if (!ac || ac.state !== 'running') {
            playFallbackAlert(dur, gain);
            return;
        }
        const o = ac.createOscillator(), g = ac.createGain();
        o.connect(g);
        g.connect(ac.destination);
        o.frequency.value = freq;
        g.gain.value = gain;
        o.start();
        setTimeout(() => {
            try {
                o.stop();
            }
            catch (e) { }
        }, dur);
    }
    catch (e) {
        playFallbackAlert(dur, gain);
    }
}
document.addEventListener('visibilitychange', () => {
    if (document.hidden)
        cancelFallbackAlert();
    else if (_alertAudioRequested)
        primeAlertAudio();
});
document.addEventListener('pointerdown', () => {
    if (_alertAudioRequested)
        primeAlertAudio(true);
}, { passive: true });
/** @param {string} reason @param {unknown} [eligibility] */
export function trigger(reason, eligibility) {
    let now = Date.now();
    const qualified = experimentFlags.noface && running && reason === 'Face lost after fatigue' && experimentController?.qualifiedLoss(eligibility);
    if (now - lastAlert < 12000 || calibrating || confidence < 45 && !qualified)
        return;
    lastAlert = now;
    alerts++;
    alertsEl.textContent = alerts;
    if (now - lastEscalation > 90000)
        escalationLevel = 0;
    escalationLevel = Math.min(4, escalationLevel + 1);
    lastEscalation = now;
    let titles = ['DROWSY ALERT', 'LOUD ALERT', 'FLEET WARNING', 'EMERGENCY CHECK'];
    alertTitle.textContent = titles[Math.max(0, escalationLevel - 1)] || 'DROWSY ALERT';
    alertSub.textContent = escalationLevel >= 3 ? 'Driver should pull over and confirm safety' : 'Pull over safely';
    alertScreen.style.background = 'rgba(255,51,68,' + Number(nightOpacity.value) / 100 + ')';
    alertScreen.classList.add('show');
    setTimeout(() => alertScreen.classList.remove('show'), 1300);
    if (navigator.vibrate)
        navigator.vibrate(escalationLevel >= 3 ? [700, 150, 700, 150, 700, 150, 700] : [500, 150, 500, 150, 300]);
    try {
        const _hac = getAC();
        if (_hac && (_hac.state === 'suspended' || _hac.state === 'interrupted'))
            primeAlertAudio();
        if (_hac && _hac.state === 'running') {
            const _pulses = escalationLevel >= 3 ? 3 : 2;
            for (let _pi = 0; _pi < _pulses; _pi++) {
                setTimeout(() => {
                    try {
                        if (document.hidden || _hac.state !== 'running')
                            return;
                        const _ho = _hac.createOscillator(), _hg = _hac.createGain();
                        _ho.connect(_hg);
                        _hg.connect(_hac.destination);
                        _ho.type = 'sine';
                        _ho.frequency.value = 55;
                        _hg.gain.setValueAtTime(0, _hac.currentTime);
                        _hg.gain.linearRampToValueAtTime(0.6, _hac.currentTime + 0.015);
                        _hg.gain.linearRampToValueAtTime(0, _hac.currentTime + 0.2);
                        _ho.start();
                        setTimeout(() => {
                            try {
                                _ho.stop();
                            }
                            catch (e) { }
                        }, 250);
                    }
                    catch (e) { }
                }, _pi * 300);
            }
        }
    }
    catch (e) { }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
            const _ntitle = 'Occulert ⚠️ Drowsiness Alert';
            const _nbody = escalationLevel >= 3 ? 'Pull over safely — confirm safety now' : 'Stay alert! Drowsiness detected.';
            const _nopts = { body: _nbody, icon: '/occulert-logo-main-192.png', badge: '/occulert-logo-main-96.png', tag: 'occulert-alert-' + Date.now(), silent: false, vibrate: escalationLevel >= 3 ? [700, 150, 700, 150, 700] : [500, 150, 500], requireInteraction: escalationLevel >= 3 };
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.ready.then(reg => reg.showNotification(_ntitle, _nopts)).catch(() => {
                    try {
                        new Notification(_ntitle, _nopts);
                    }
                    catch (e) { }
                });
            }
            else {
                try {
                    new Notification(_ntitle, _nopts);
                }
                catch (e) { }
            }
        }
        catch (e) { }
    }
    tone(escalationLevel >= 3 ? 1100 : 880, escalationLevel >= 3 ? 900 : 450, escalationLevel >= 3 ? .35 : .2);
    log((reason || 'Drowsy') + ' alert triggered - escalation ' + escalationLevel);
    pushFleet(true);
    if (typeof acceptedAlertHook === 'function')
        acceptedAlertHook(reason);
}
export function demoAlert() {
    if (!startupAllowsMonitoring() || running || starting)
        return;
    const result = document.getElementById('alertCheckResult');
    const audioOwner = beginAlertAudioScope();
    _alertTestOwner = audioOwner;
    alertTitle.textContent = 'TEST ALERT';
    alertSub.textContent = 'Sound and vibration check only';
    alertScreen.style.background = 'rgba(255,51,68,' + Number(nightOpacity.value) / 100 + ')';
    alertScreen.classList.add('show');
    tone(880, 450, .25);
    if (navigator.vibrate)
        navigator.vibrate([500, 150, 500]);
    if (result)
        result.textContent = 'Test sent to this device. If you did not hear or feel it, check volume, mute, Focus, and audio routing while parked.';
    setTimeout(() => {
        clearParkedAlertTest(audioOwner);
        releaseAlertAudioScope(audioOwner);
    }, 1800);
}
/** @type {boolean | undefined} */
export let _voiceEnabled;
// Restore at the original entry phase, after control/camera registrations.
export function initializeVoicePreference() {
    _voiceEnabled = localStorage.getItem('occulert-voice') === 'true';
}
/** A failed restore keeps the entry-owned preference uninitialized. */
function readVoicePreference() {
    if (typeof _voiceEnabled !== 'boolean')
        throw new ReferenceError("Cannot access '_voiceEnabled' before initialization");
    return _voiceEnabled;
}
export const VOICE_MSGS = ['Pull over safely', 'Take a break, you are tired', 'Drowsiness detected, rest now', 'Danger! Pull over immediately'];
/** @param {string} msg */
export function speak(msg) {
    if (!readVoicePreference() || !window.speechSynthesis)
        return;
    try {
        if (window.speechSynthesis.paused)
            window.speechSynthesis.resume();
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(msg);
        u.rate = 0.9;
        u.pitch = 1.0;
        u.volume = 1.0;
        window.speechSynthesis.speak(u);
    }
    catch (e) { }
}
export function toggleVoice() {
    _voiceEnabled = !readVoicePreference(); /** @type {WebIdlStorage} */
    (localStorage).setItem('occulert-voice', _voiceEnabled);
    const b = document.getElementById('voiceToggleBtn');
    if (b)
        b.textContent = _voiceEnabled ? '🔊 Voice ON' : '🔇 Voice OFF';
}
export let _alertsSinceBreak = 0;
export function triggerBreakCheck() {
    _alertsSinceBreak++;
    const sessionMs = sessionStart ? Date.now() - sessionStart : 0;
    if ((_alertsSinceBreak >= 3 || sessionMs > 40 * 60 * 1000) && Date.now() - _lastBreakPrompt > 15 * 60 * 1000) {
        set__lastBreakPrompt(Date.now());
        const el = document.getElementById('breakBanner');
        if (el) {
            const mins = Math.round(sessionMs / 60000);
            el.innerHTML = '🛑 Rest Stop Recommended — ' + mins + ' min driving, ' + _alertsSinceBreak + ' alerts. <button data-page-action="dismissBreak" style="background:none;border:1px solid #00ff88;color:#00ff88;padding:4px 10px;border-radius:6px;cursor:pointer;margin-left:10px">Dismiss</button>';
            el.style.display = 'block';
        }
        speak('Rest stop recommended. Please pull over safely and take a break.');
    }
}
export function dismissBreak() {
    const el = document.getElementById('breakBanner');
    if (el)
        el.style.display = 'none';
    _alertsSinceBreak = 0;
}
/** @param {number} value */
export function set_alerts(value) { alerts = value; return value; }
/** @param {number} value */
export function set_escalationLevel(value) { escalationLevel = value; return value; }
