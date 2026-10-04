import "./camera.js";
import { signalDetectionResult } from "./detector.js";
import { updateCalibration } from "./calibration.js";
import { alerts, escalationLevel, tone, trigger, speak, triggerBreakCheck } from "./alerts.js";
import "./storage-history.js";
import { queueBackendEvent } from "./cloud-sync.js";
import { experimentFlags, experimentController, experimentSessionSummary, video, canvas, ctx, faceStateEl, nodsEl, gpsEl, locationEl, perclosEl, microsleepsEl, distractionEl, gpsConsent, cloudConsent, running, fatigue, confidence, earHistory, maxFatigue, fatigueSampleSum, fatigueSampleCount, noseYHistory, headNods, lastNod, driverId, gpsWatch, lastPosition, routePoints, distanceMeters, perclosWindow, eyesClosedSince, microsleeps, lastMicro, turnedSince, totalDistractionMs, calibrating, calibrated, eyeClosedThreshold, eyeWatchThreshold, noFaceSince, lastFaceSeen, LEFT, RIGHT, log, setTextIfChanged, render, drawEyes, yawnCount, lastYawn, _marHist, _mouthOpenSince, MAR_YAWN_THRESH, YAWN_HOLD_MS, YAWN_COOLDOWN_MS, _lastLightCheck, _trackLostSince, _lastTrackingWarning, TRACKING_WARNING_DELAY_MS, TRACKING_WARNING_COOLDOWN_MS, set_fatigue, set_confidence, set_earHistory, set_maxFatigue, set_fatigueSampleSum, set_fatigueSampleCount, set_noseYHistory, set_headNods, set_lastNod, set_gpsWatch, set_lastPosition, set_routePoints, set_distanceMeters, set_perclosWindow, set_eyesClosedSince, set_microsleeps, set_lastMicro, set_turnedSince, set_totalDistractionMs, set_noFaceSince, set_lastFaceSeen, set_yawnCount, set_lastYawn, set__marHist, set__mouthOpenSince, set__lastLightCheck, set__trackLostSince, set__lastTrackingWarning } from "./ui.js";
export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function calcEAR(lm, idx) {
    if (experimentFlags.pixels)
        return window.OcculertDetectionExperiments.eyeEAR(lm, idx, video.videoWidth, video.videoHeight);
    let p1 = lm[idx[0]], p2 = lm[idx[1]], p3 = lm[idx[2]], p4 = lm[idx[3]], p5 = lm[idx[4]], p6 = lm[idx[5]], h = dist(p1, p4);
    return h < .001 ? .28 : (dist(p2, p6) + dist(p3, p5)) / (2 * h);
}
export function smooth(v) {
    earHistory.push(v);
    if (earHistory.length > 6)
        earHistory.shift();
    return earHistory.reduce((a, b) => a + b, 0) / earHistory.length;
}
export function headTurn(lm) { let n = lm[4], l = lm[234], r = lm[454], w = Math.abs(r.x - l.x); return w < .05 ? true : Math.abs((n.x - (l.x + r.x) / 2) / w) > .34; }
export function detectHeadNod(lm) {
    let y = lm[4].y;
    noseYHistory.push({ y, t: Date.now() });
    if (noseYHistory.length > 10)
        noseYHistory.shift();
    if (noseYHistory.length < 6)
        return false;
    let now = Date.now();
    if (noseYHistory.length < 8)
        return false;
    let midPt = noseYHistory[Math.floor(noseYHistory.length / 2)], earliest = noseYHistory[0], latest = noseYHistory[noseYHistory.length - 1], dip = midPt.y - earliest.y, recover = midPt.y - latest.y;
    if (dip > .04 && recover > .018 && now - lastNod > 1800) {
        set_lastNod(now);
        (set_headNods(headNods + 1) - 1);
        nodsEl.textContent = headNods;
        log('Head nod detected');
        queueBackendEvent('head_nod');
        return true;
    }
    return false;
}
export function miles(m) { return (m / 1609.344).toFixed(2); }
export function hav(a, b) { let R = 6371000, toRad = x => x * Math.PI / 180, dLat = toRad(b.lat - a.lat), dLon = toRad(b.lng - a.lng), s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
export function startGPS() {
    if (!gpsConsent.checked) {
        gpsEl.textContent = 'OFF';
        locationEl.textContent = '--';
        return;
    }
    if (!navigator.geolocation) {
        gpsEl.textContent = 'NO';
        gpsEl.className = 'value gps warn';
        return;
    }
    gpsEl.textContent = 'ASK';
    gpsEl.className = 'value gps warn';
    set_gpsWatch(navigator.geolocation.watchPosition(pos => {
        let p = { lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6), accuracy: Math.round(pos.coords.accuracy || 0), speed: pos.coords.speed ? Math.round(pos.coords.speed * 2.23694) : 0, ts: new Date().toISOString() };
        if (lastPosition) {
            let d = hav(lastPosition, p);
            if (d > 2 && d < 1000)
                set_distanceMeters(distanceMeters + (d));
        }
        set_lastPosition(p);
        routePoints.push(p);
        set_routePoints(routePoints.slice(-80));
        gpsEl.textContent = 'ON';
        gpsEl.className = 'value gps on';
        locationEl.textContent = p.lat.toFixed(2) + ',' + p.lng.toFixed(2);
    }, err => { gpsEl.textContent = 'OFF'; gpsEl.className = 'value gps warn'; log('GPS unavailable: ' + err.message); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 }));
}
export function stopGPS() {
    if (gpsWatch !== null)
        navigator.geolocation.clearWatch(gpsWatch);
    set_gpsWatch(null);
    gpsEl.textContent = lastPosition ? 'SAVED' : 'OFF';
    gpsEl.className = 'value gps ' + (lastPosition ? 'on' : 'warn');
}
export function resetContinuousObservations() {
    if (turnedSince)
        set_totalDistractionMs(totalDistractionMs + (Math.max(0, lastFaceSeen - turnedSince)));
    set_turnedSince(0);
    set_eyesClosedSince(0);
    set_earHistory([]);
    set_noseYHistory([]);
    set__mouthOpenSince(0);
    set__marHist([]);
    distractionEl.textContent = Math.round(totalDistractionMs / 1000) + 's';
}
export function updateEyeMetrics(ear, turned) {
    let now = Date.now(), closed = ear < eyeClosedThreshold;
    perclosWindow.push({ t: now, closed });
    set_perclosWindow(perclosWindow.filter(x => now - x.t < 60000));
    let perclos = perclosWindow.length ? Math.round(perclosWindow.filter(x => x.closed).length / perclosWindow.length * 100) : 0;
    perclosEl.textContent = perclos + '%';
    if (closed && !eyesClosedSince)
        set_eyesClosedSince(now);
    if (!closed)
        set_eyesClosedSince(0);
    if (eyesClosedSince && now - eyesClosedSince > 1500 && now - lastMicro > 3000 && confidence > 45) {
        (set_microsleeps(microsleeps + 1) - 1);
        set_lastMicro(now);
        microsleepsEl.textContent = microsleeps;
        log('Microsleep pattern detected');
    }
    if (turned && !turnedSince)
        set_turnedSince(now);
    if (!turned && turnedSince) {
        set_totalDistractionMs(totalDistractionMs + (now - turnedSince));
        set_turnedSince(0);
    }
    let live = turnedSince ? Date.now() - turnedSince : 0;
    distractionEl.textContent = Math.round((totalDistractionMs + live) / 1000) + 's';
    return perclos;
}
export function updateScore(ear, turned, nod, hasFace) {
    if (experimentFlags.primary)
        return experimentController.score(ear, turned, nod, hasFace);
    let now = Date.now();
    if (!hasFace) {
        resetContinuousObservations();
        if (!noFaceSince)
            set_noFaceSince(now);
        faceStateEl.textContent = 'NO';
        set_confidence(Math.max(0, confidence - 10));
        if (noFaceSince && now - noFaceSince > 3500)
            set_fatigue(Math.max(0, fatigue - 2));
        return;
    }
    set_noFaceSince(0);
    set_lastFaceSeen(now);
    faceStateEl.textContent = 'OK';
    if (calibrating) {
        updateCalibration(ear);
        set_confidence(Math.min(100, confidence + 2));
        set_fatigue(Math.max(0, fatigue - 2));
        return;
    }
    set_confidence(Math.min(100, confidence + (calibrated ? 5 : 3)));
    let perclos = updateEyeMetrics(ear, turned);
    if (turned) {
        set_confidence(Math.max(35, confidence - 5));
        if (turnedSince && now - turnedSince > 3000)
            set_fatigue(fatigue + (2));
        else
            set_fatigue(Math.max(0, fatigue - 1));
    }
    else {
        if (nod)
            set_fatigue(fatigue + (18));
        if (ear < eyeClosedThreshold * .82)
            set_fatigue(fatigue + (9));
        else if (ear < eyeClosedThreshold)
            set_fatigue(fatigue + (6));
        else if (ear < eyeWatchThreshold)
            set_fatigue(fatigue + (2));
        else
            set_fatigue(fatigue - (3));
        if (perclos > 45)
            set_fatigue(fatigue + (8));
        else if (perclos > 30)
            set_fatigue(fatigue + (5));
        else if (perclos > 18)
            set_fatigue(fatigue + (2));
        if (lastMicro && now - lastMicro < 30000)
            set_fatigue(fatigue + (1));
        if (confidence < 45)
            set_fatigue(fatigue + (1));
    }
    set_fatigue(Math.max(0, Math.min(100, fatigue)));
    set_maxFatigue(Math.max(maxFatigue, fatigue));
    set_fatigueSampleSum(fatigueSampleSum + (fatigue));
    (set_fatigueSampleCount(fatigueSampleCount + 1) - 1);
}
export function riskText() {
    if (running && noFaceSince && Date.now() - noFaceSince > 2500)
        return ['NO FACE', 'noface'];
    if (calibrating)
        return ['CALIBRATING', 'watch'];
    if (fatigue >= 80 && confidence >= 45)
        return ['ALERT', 'danger'];
    if (fatigue >= 60)
        return ['HIGH', 'danger'];
    if (fatigue >= 35)
        return ['WATCH', 'warn'];
    return ['SAFE', 'safe'];
}
export function fleetPayload() { let avg = fatigueSampleCount ? Math.round(fatigueSampleSum / fatigueSampleCount) : 0, score = Math.max(0, 100 - Math.round(maxFatigue * .65) - alerts * 8 - headNods * 3 - microsleeps * 5 - Math.round(totalDistractionMs / 20000)), r = riskText()[0], experiment = experimentFlags.any ? (experimentSessionSummary || experimentController?.summary()) : null, perclos = experimentFlags.timePerclos ? (experiment?.timePerclos?.perclos ?? null) : Number(perclosEl.textContent.replace('%', '')) || 0; return { ...(experimentFlags.any ? { detectorVersion: 'web-v81:parked:' + experimentFlags.names.join('+'), experiment } : {}), driverId, name: 'Local Driver', status: r, fatigue: Math.round(fatigue), confidence: Math.round(confidence), alerts, headNods, microsleeps, perclos, distractionSeconds: Math.round((totalDistractionMs + (turnedSince ? Date.now() - turnedSince : 0)) / 1000), escalationLevel, maxFatigue: Math.round(maxFatigue), avgFatigue: avg, safetyScore: score, lastUpdate: new Date().toISOString(), location: gpsConsent.checked ? lastPosition : null, route: gpsConsent.checked ? routePoints : [], distanceMiles: gpsConsent.checked ? Number(miles(distanceMeters)) : 0, speedMph: lastPosition && gpsConsent.checked ? lastPosition.speed : 0, gpsEnabled: gpsConsent.checked && !!lastPosition, cloudConsent: cloudConsent.checked }; }
export function onResults(res) {
    signalDetectionResult();
    if (!running)
        return;
    if (experimentController)
        experimentController.legacyResult();
    if (experimentFlags.primary)
        return experimentController.results(res);
    let has = !!(res.multiFaceLandmarks && res.multiFaceLandmarks.length);
    if (!has) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        updateScore(0, false, false, false);
        if (typeof updateTrackingState === 'function')
            updateTrackingState(false, false);
        ;
        render();
        experimentController?.recordResults(res, null, null, false);
        return;
    }
    let lm = res.multiFaceLandmarks[0], raw = (calcEAR(lm, LEFT) + calcEAR(lm, RIGHT)) / 2, ear = smooth(raw), turned = headTurn(lm), nod = calibrating ? false : detectHeadNod(lm);
    updateScore(ear, turned, nod, true);
    // ── New: MAR/Yawn, Light, Tracking ──
    if (typeof detectYawn === 'function')
        detectYawn(lm);
    if (typeof calcMAR === 'function') {
        const mar = calcMAR(lm);
        const marEl = document.getElementById('marEl');
        if (marEl)
            marEl.textContent = mar.toFixed(2);
    }
    const videoEl = document.getElementById('video') || document.querySelector('video');
    if (typeof checkLightLevel === 'function' && videoEl)
        checkLightLevel(videoEl);
    if (typeof updateTrackingState === 'function') {
        const earOk = ear > .05 && ear < .65;
        updateTrackingState(true, earOk);
    }
    drawEyes(lm, fatigue >= 60 ? '#ff3344' : fatigue >= 35 ? '#ffaa00' : '#00ff88');
    render(ear);
    if (!calibrating && confidence >= 45 && fatigue >= 80)
        trigger('Fatigue');
    else if (!calibrating && confidence >= 45 && turnedSince && Date.now() - turnedSince > 6500)
        trigger('Distraction');
    experimentController?.recordResults(res, raw, ear, turned);
}
export function calcMAR(lm) {
    try {
        const top = lm[13], bot = lm[14], left = lm[61], right = lm[291];
        if (!top || !bot || !left || !right)
            return 0;
        const vert = Math.sqrt((bot.x - top.x) ** 2 + (bot.y - top.y) ** 2 + (bot.z - top.z) ** 2);
        const horiz = Math.sqrt((right.x - left.x) ** 2 + (right.y - left.y) ** 2 + (right.z - left.z) ** 2);
        return horiz < 0.001 ? 0 : vert / horiz;
    }
    catch (e) {
        return 0;
    }
}
export function smoothMAR(v) {
    _marHist.push(v);
    if (_marHist.length > 5)
        _marHist.shift();
    return _marHist.reduce((a, b) => a + b, 0) / _marHist.length;
}
export function detectYawn(lm) {
    const mar = smoothMAR(calcMAR(lm));
    const now = Date.now();
    if (mar > MAR_YAWN_THRESH) {
        if (!_mouthOpenSince)
            set__mouthOpenSince(now);
        if (now - _mouthOpenSince > YAWN_HOLD_MS && now - lastYawn > YAWN_COOLDOWN_MS) {
            (set_yawnCount(yawnCount + 1) - 1);
            set_lastYawn(now);
            const yEl = document.getElementById('yawnCountEl');
            if (yEl)
                yEl.textContent = yawnCount;
            log('Yawn detected (MAR=' + mar.toFixed(2) + ')');
            queueBackendEvent('yawn');
            triggerBreakCheck();
            set_fatigue(Math.min(100, fatigue + 8));
        }
    }
    else {
        set__mouthOpenSince(0);
    }
    const mEl = document.getElementById('marEl');
    if (mEl)
        mEl.textContent = mar.toFixed(2);
}
export function checkLightLevel(videoEl) {
    const now = Date.now();
    if (now - _lastLightCheck < 5000)
        return;
    set__lastLightCheck(now);
    try {
        const tc = document.createElement('canvas');
        tc.width = 64;
        tc.height = 48;
        const tx = tc.getContext('2d');
        tx.drawImage(videoEl, 0, 0, 64, 48);
        const d = tx.getImageData(0, 0, 64, 48).data;
        let lum = 0;
        for (let i = 0; i < d.length; i += 16)
            lum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        lum /= (d.length / 16);
        const b = document.getElementById('lightBadge');
        if (b) {
            if (lum < 18) {
                b.textContent = '🌑 Too Dark to Track';
                b.style.color = '#ff4444';
                b.style.display = 'inline-flex';
            }
            else if (lum < 28) {
                b.textContent = '⚠️ Low Light';
                b.style.color = '#ffaa00';
                b.style.display = 'inline-flex';
            }
            else {
                b.style.display = 'none';
            }
        }
    }
    catch (e) { }
}
export function warnTrackingLoss(now) {
    if (!running || !_trackLostSince || now - _trackLostSince < TRACKING_WARNING_DELAY_MS || now - _lastTrackingWarning < TRACKING_WARNING_COOLDOWN_MS)
        return;
    set__lastTrackingWarning(now);
    tone(660, 260, .2);
    setTimeout(() => tone(440, 320, .2), 320);
    speak('Camera view lost. Pull over safely before repositioning the phone.');
    log('Tracking lost - pull over safely before adjusting the camera');
}
export function updateTrackingState(hasFace, hasGoodEAR) {
    const b = document.getElementById('trackingBadge');
    if (!b)
        return;
    const now = Date.now();
    if (!hasFace || !hasGoodEAR) {
        if (!_trackLostSince)
            set__trackLostSince(now);
        if (now - _trackLostSince > 3000) {
            setTextIfChanged(b, '⚠️ Tracking Unavailable');
            b.style.color = '#ffaa00';
            b.style.display = 'inline-flex';
        }
        warnTrackingLoss(now);
    }
    else {
        set__trackLostSince(0);
        setTextIfChanged(b, '✓ Tracking Active');
        b.style.color = '#00ff88';
        b.style.display = 'inline-flex';
    }
}
