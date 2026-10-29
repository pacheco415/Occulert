// Parked experiments only. The ordinary detector does not call these models.
/* global module, MessageChannel */
(function (root) {
  'use strict';

  const finite = value => typeof value === 'number' && Number.isFinite(value);

  function parseFlags(search = '') {
    const query = new URLSearchParams(search);
    const matches = (key, value) => query.getAll(key).length === 1 && query.get(key) === value;
    const selected = { elapsed: matches('fatigue-timing', 'elapsed'), pixels: matches('ear-units', 'pixels'),
      tasks: matches('detector', 'tasks'), noface: matches('noface-escalation', '1'),
      timePerclos: matches('perclos', 'time'), pitch: matches('pitch-gate', '1'),
      distractionConfidence: matches('distraction-confidence', 'stable'), observer: matches('observer', '1'), calibrationMin: matches('calibration-min', '12') };
    const names = Object.keys(selected).filter(key => selected[key]).sort();
    return Object.freeze({ ...selected, names: Object.freeze(names), any: names.length > 0,
      primary: names.some(name => !['tasks', 'distractionConfidence', 'observer', 'calibrationMin'].includes(name)), delegate: matches('tasks-delegate', 'cpu') ? 'CPU' : 'GPU' });
  }

  function eyeEAR(landmarks, indices, width, height) {
    if (!Array.isArray(landmarks) || !Array.isArray(indices) || indices.length !== 6 ||
        !finite(width) || !finite(height) || width <= 0 || height <= 0 || width > 16384 || height > 16384) return NaN;
    const points = indices.map(index => landmarks[index]);
    if (points.some(point => !point || !finite(point.x) || !finite(point.y))) return NaN;
    const distance = (a, b) => Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
    const horizontal = distance(points[0], points[3]);
    return horizontal < .001 ? NaN : (distance(points[1], points[5]) + distance(points[2], points[4])) / (2 * horizontal);
  }

  function createTimePerclos({ windowMs = 60000, maxGapMs = 1000, capacity = 1024 } = {}) {
    if (!finite(windowMs) || windowMs <= 0 || !finite(maxGapMs) || maxGapMs <= 0 ||
        !Number.isInteger(capacity) || capacity < 2 || capacity > 65536) throw new Error('Invalid PERCLOS bounds');
    const starts = new Float64Array(capacity), ends = new Float64Array(capacity), closed = new Uint8Array(capacity);
    const buffers = Object.freeze({ starts, ends, closed });
    let head = 0, size = 0, observedMs = 0, closedMs = 0, previousAt = null, previousClosed = null;
    let watermark = null, droppedIntervals = 0, truncatedUntil = -Infinity;
    const index = offset => (head + offset) % capacity;
    function removeOldest() {
      const dt = ends[head] - starts[head];
      observedMs -= dt;
      if (closed[head]) closedMs -= dt;
      head = (head + 1) % capacity;
      size--;
    }
    function prune(now) {
      const cutoff = now - windowMs;
      while (size && ends[head] <= cutoff) removeOldest();
      if (size && starts[head] < cutoff) {
        const expired = cutoff - starts[head];
        starts[head] = cutoff;
        observedMs -= expired;
        if (closed[head]) closedMs -= expired;
      }
      observedMs = Math.max(0, observedMs);
      closedMs = Math.max(0, Math.min(observedMs, closedMs));
    }
    function add(start, end, state) {
      if (end <= start) return;
      const tail = size ? index(size - 1) : -1;
      if (tail >= 0 && ends[tail] === start && closed[tail] === Number(state)) ends[tail] = end;
      else {
        if (size === capacity) {
          truncatedUntil = Math.max(truncatedUntil, ends[head] + windowMs);
          droppedIntervals++;
          removeOldest();
        }
        const at = index(size++);
        starts[at] = start; ends[at] = end; closed[at] = Number(state);
      }
      observedMs += end - start;
      if (state) closedMs += end - start;
    }
    function reset() {
      head = size = observedMs = closedMs = droppedIntervals = 0;
      previousAt = previousClosed = watermark = null;
      truncatedUntil = -Infinity;
    }
    const value = () => observedMs > 0 ? 100 * closedMs / observedMs : null;
    function update(now, state) {
      if (!finite(now) || now < 0) { previousAt = previousClosed = null; return value(); }
      if (watermark !== null && now < watermark) { reset(); watermark = now; return null; }
      prune(now);
      if (watermark === now) return value();
      watermark = now;
      const usable = typeof state === 'boolean';
      const gap = previousAt === null ? 0 : now - previousAt;
      if (usable && previousClosed !== null && gap > 0 && gap <= maxGapMs) {
        add(Math.max(previousAt, now - windowMs), now, previousClosed);
      }
      previousAt = usable ? now : null;
      previousClosed = usable ? state : null;
      return value();
    }
    function snapshot(now = watermark) {
      if (finite(now) && (watermark === null || now >= watermark)) prune(now);
      return { perclos: value(), observedMs, closedMs, windowMs, intervalCount: size,
        capacity, droppedIntervals, truncated: finite(now) && now < truncatedUntil,
        convention: 'previous-state; both endpoints usable; gaps above 1000ms unknown' };
    }
    return Object.freeze({ update, snapshot, reset, buffers });
  }

  // Only this accumulation clock changes; smoothing/episode/cooldown clocks are separate.
  function createElapsedRate(cadenceMs = 135) {
    let last = null, observed = false;
    function reset() { last = null; observed = false; }
    function scale(now, hasFace) {
      if (!finite(now) || now < 0) { reset(); return 0; }
      let dt = last === null ? 0 : Math.max(0, Math.min(500, now - last));
      if (hasFace && !observed) dt = 0;
      last = now; observed = hasFace === true;
      return dt / cadenceMs;
    }
    return Object.freeze({ scale, reset });
  }

  function pitchRatio(landmarks) {
    if (!Array.isArray(landmarks)) return null;
    const left = landmarks[33], right = landmarks[263], nose = landmarks[1], chin = landmarks[152];
    for (const p of [left, right, nose, chin]) if (!p || !finite(p.x) || !finite(p.y)) return null;
    const eyeY = (left.y + right.y) / 2, height = chin.y - eyeY;
    if (height <= 0.00001 || Math.abs(left.x - right.x) <= 0.00001) return null;
    const ratio = (nose.y - eyeY) / height;
    return ratio >= -0.5 && ratio <= 1.5 ? ratio : null;
  }

  function trimmed(values, count) {
    const sorted = Array.from(values.subarray(0, count)).sort((a, b) => a - b);
    const low = Math.floor(count * 0.2), high = Math.max(low + 1, Math.ceil(count * 0.8));
    let sum = 0;
    for (let i = low; i < high; i++) sum += sorted[i];
    return sum / (high - low);
  }

  function createParkedBaseline({ minSamples = 12, minDurationMs = 2500, capacity = 128, maxGapMs = 1000 } = {}) {
    if (!Number.isInteger(capacity) || capacity < minSamples || minSamples < 2 || minDurationMs <= 0) throw new Error('Invalid calibration bounds');
    const eyes = new Float64Array(capacity), pitches = new Float64Array(capacity);
    let count = 0, firstAt = null, lastAt = null, pitchCount = 0;
    function reset() { count = pitchCount = 0; firstAt = lastAt = null; }
    function add(now, ear, pitch, usable) {
      if (!usable || !finite(now) || !finite(ear) || now < 0) { reset(); return false; }
      if (lastAt !== null && (now < lastAt || now - lastAt > maxGapMs)) reset();
      if (now === lastAt) return false;
      if (firstAt === null) firstAt = now;
      lastAt = now;
      if (count === capacity) return false;
      eyes[count++] = ear;
      if (finite(pitch)) pitches[pitchCount++] = pitch;
      return true;
    }
    function finish() {
      const durationMs = firstAt === null ? 0 : lastAt - firstAt;
      const usable = count >= minSamples && durationMs >= minDurationMs;
      return { usable, samples: count, durationMs, eyeBaseline: usable ? trimmed(eyes, count) : null,
        pitchBaseline: usable && pitchCount === count ? trimmed(pitches, pitchCount) : null,
        pitchBand: 0.12, method: 'contiguous parked 20–80% trimmed baseline; 2D pitch estimate' };
    }
    return Object.freeze({ add, reset, finish });
  }

  function createNoFaceEvidence({ maxAgeMs = 3000, watchThreshold = 35 } = {}) {
    let eyesAt = null, fatigueAt = null, downAt = null, episode = null;
    function reset() { eyesAt = fatigueAt = downAt = episode = null; }
    function observe(now, { eyesClosed = false, fatigue = null, downward = false } = {}) {
      if (!finite(now) || now < 0) return;
      episode = null;
      if (eyesClosed === true) eyesAt = now;
      if (finite(fatigue) && fatigue >= watchThreshold) fatigueAt = now;
      if (downward === true) downAt = now;
    }
    function loss(now) {
      if (episode) return episode;
      let signal = null;
      if (finite(now) && now >= 0) {
        for (const [name, at] of [['eyes_closed', eyesAt], ['fatigue_watch', fatigueAt], ['downward_nose', downAt]]) {
          if (at !== null && now >= at && now - at <= maxAgeMs) { signal = name; break; }
        }
      }
      episode = Object.freeze({ qualified: signal !== null, signal, atMs: now });
      return episode;
    }
    return Object.freeze({ observe, loss, reset });
  }

  // Pinned Tasks 1.0.1 copies packed MatrixData unchanged. MatrixData defaults
  // to column-major. Decompose normalized Rz(roll) Ry(yaw) Rx(pitch); these
  // metric-coordinate rotations do not certify a physical looking-down angle.
  function matrixPose(matrix) {
    if (!matrix || matrix.rows !== 4 || matrix.columns !== 4 ||
        !(Array.isArray(matrix.data) || ArrayBuffer.isView(matrix.data)) || matrix.data.length !== 16) return null;
    const d = matrix.data;
    for (let i = 0; i < 16; i++) if (!finite(d[i])) return null;
    if (Math.abs(d[3]) > 0.00001 || Math.abs(d[7]) > 0.00001 || Math.abs(d[11]) > 0.00001 || Math.abs(d[15] - 1) > 0.00001) return null;
    const lengths = [Math.hypot(d[0], d[1], d[2]), Math.hypot(d[4], d[5], d[6]), Math.hypot(d[8], d[9], d[10])];
    if (lengths.some(n => n < 0.00001)) return null;
    const c = [[d[0] / lengths[0], d[1] / lengths[0], d[2] / lengths[0]],
      [d[4] / lengths[1], d[5] / lengths[1], d[6] / lengths[1]],
      [d[8] / lengths[2], d[9] / lengths[2], d[10] / lengths[2]]];
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
      if (Math.abs(c[a][0] * c[b][0] + c[a][1] * c[b][1] + c[a][2] * c[b][2]) > 0.02) return null;
    }
    const det = c[0][0] * (c[1][1] * c[2][2] - c[2][1] * c[1][2]) -
      c[1][0] * (c[0][1] * c[2][2] - c[2][1] * c[0][2]) + c[2][0] * (c[0][1] * c[1][2] - c[1][1] * c[0][2]);
    if (Math.abs(det - 1) > 0.02) return null;
    const yaw = Math.asin(Math.max(-1, Math.min(1, -c[0][2]))), gimbal = Math.abs(Math.cos(yaw)) < 0.00001;
    const degrees = radians => radians * 180 / Math.PI;
    return { pitchDeg: gimbal ? null : degrees(Math.atan2(c[1][2], c[2][2])), yawDeg: degrees(yaw),
      rollDeg: gimbal ? null : degrees(Math.atan2(c[0][1], c[0][0])), gimbal };
  }

  function parseTasksResult(result) {
    const face = Array.isArray(result?.faceLandmarks?.[0]) && result.faceLandmarks[0].length > 0;
    const categories = result?.faceBlendshapes?.[0]?.categories;
    const fields = { eyeBlinkLeft: null, eyeBlinkRight: null, jawOpen: null };
    if (face && Array.isArray(categories)) for (const name of Object.keys(fields)) {
      let value = null, matches = 0;
      for (const item of categories) if (item && item.categoryName === name) { matches++; value = item.score; }
      if (matches === 1 && finite(value) && value >= 0 && value <= 1) fields[name] = value;
    }
    const pose = face ? matrixPose(result?.facialTransformationMatrixes?.[0]) : null;
    return { ...fields, pitchDeg: pose?.pitchDeg ?? null, yawDeg: pose?.yawDeg ?? null,
      poseUsable: !!pose && !pose.gimbal, tasksUsable: face && fields.eyeBlinkLeft !== null && fields.eyeBlinkRight !== null };
  }

  // Independent observer input only; detector values never enter this model.
  function createObserverEpisodes({ capacity = 256 } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4096) throw Error('Invalid observer episode bound');
    let rows = [], open = null, lastAt = 0, rejected = 0;
    const validTime = at => finite(at) && at >= lastAt;
    function close(at) {
      if (open && at > open.start_ms) rows.push({ ...open, end_ms: at });
      open = null;
    }
    function mark(label, at) {
      if (!['drowsy', 'high_fatigue'].includes(label) || !validTime(at)) return false;
      lastAt = at;
      const previous = open?.label;
      close(at);
      if (previous === label) return true;
      if (rows.length >= capacity) { rejected++; return false; }
      open = { start_ms: at, label };
      return true;
    }
    function stop(at) { if (!validTime(at)) return false; lastAt = at; close(at); return true; }
    function reset() { rows = []; open = null; lastAt = rejected = 0; }
    function entries() { return rows.map(row => ({ ...row })); }
    function summary() { return { episodes: rows.length, activeLabel: open?.label ?? null, capacity, rejected }; }
    return Object.freeze({ mark, stop, reset, entries, summary });
  }

  const TRACE_FIELDS = Object.freeze(['frameId', 'atMs', 'mediaTime', 'rawEar', 'smoothedEar',
    'eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'pitchDeg', 'yawDeg', 'legacyInferenceMs',
    'tasksInferenceMs', 'combinedFrameMs', 'perclos', 'observedMs', 'closedMs', 'fatigue',
    'confidence', 'legacyUsable', 'tasksUsable', 'calibrating', 'pitchDown']);
  const BOOLEAN_FIELDS = new Set(['legacyUsable', 'tasksUsable', 'calibrating', 'pitchDown']);
  function createTraceStore({ capacity = 2400, alertCapacity = 256 } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20000 ||
        !Number.isInteger(alertCapacity) || alertCapacity < 1 || alertCapacity > 4096) throw new Error('Invalid trace bounds');
    const data = new Float64Array(capacity * TRACE_FIELDS.length), alertTimes = new Float64Array(alertCapacity), alertKinds = new Uint8Array(alertCapacity);
    let head = 0, size = 0, total = 0, validLegacy = 0, validTasks = 0, droppedFrames = 0;
    let alertHead = 0, alertSize = 0, droppedAlerts = 0, lastFrame = 0, lastAt = -1, lastMediaTime = null;
    function add(row) {
      if (!row || !Number.isSafeInteger(row.frameId) || row.frameId <= lastFrame ||
          !finite(row.atMs) || row.atMs < 0 || row.atMs < lastAt ||
          (finite(row.mediaTime) && row.mediaTime === lastMediaTime)) return false;
      lastFrame = row.frameId; lastAt = row.atMs;
      lastMediaTime = finite(row.mediaTime) ? row.mediaTime : null;
      if (size === capacity) { head = (head + 1) % capacity; size--; droppedFrames++; }
      const offset = ((head + size++) % capacity) * TRACE_FIELDS.length;
      for (let column = 0; column < TRACE_FIELDS.length; column++) {
        const name = TRACE_FIELDS[column], value = row[name];
        data[offset + column] = BOOLEAN_FIELDS.has(name) ? Number(value === true) : finite(value) ? value : NaN;
      }
      total++; if (row.legacyUsable === true) validLegacy++; if (row.tasksUsable === true) validTasks++;
      return true;
    }
    function recordAlert(atMs, reason) {
      if (!finite(atMs) || atMs < 0 || (alertSize && atMs < alertTimes[(alertHead + alertSize - 1) % alertCapacity])) return false;
      if (alertSize === alertCapacity) { alertHead = (alertHead + 1) % alertCapacity; alertSize--; droppedAlerts++; }
      const i = (alertHead + alertSize++) % alertCapacity;
      alertTimes[i] = atMs;
      alertKinds[i] = reason === 'Distraction' ? 2 : reason === 'Face lost after fatigue' ? 3 : 1;
      return true;
    }
    function samples() {
      const result = [];
      for (let i = 0; i < size; i++) {
        const offset = ((head + i) % capacity) * TRACE_FIELDS.length, row = {};
        for (let j = 0; j < TRACE_FIELDS.length; j++) {
          const name = TRACE_FIELDS[j], value = data[offset + j];
          row[name] = BOOLEAN_FIELDS.has(name) ? value === 1 : Number.isFinite(value) ? value : null;
        }
        result.push(row);
      }
      return result;
    }
    function alerts() {
      const result = [], kinds = ['unknown', 'fatigue', 'distraction', 'noface_after_fatigue'];
      for (let i = 0; i < alertSize; i++) {
        const at = (alertHead + i) % alertCapacity;
        result.push({ atMs: alertTimes[at], reason: kinds[alertKinds[at]] });
      }
      return result;
    }
    function summary() {
      const firstOffset = head * TRACE_FIELDS.length, lastOffset = ((head + size - 1) % capacity) * TRACE_FIELDS.length;
      return { totalFrames: total, legacyUsableFrames: validLegacy, tasksUsableFrames: validTasks,
        retainedFrames: size, capacity, droppedFrames, retainedAlerts: alertSize, droppedAlerts,
        retainedStartMs: size ? data[firstOffset + 1] : null, retainedEndMs: size ? data[lastOffset + 1] : null,
        backingBytes: data.byteLength + alertTimes.byteLength + alertKinds.byteLength,
        tasksEventMetricsAvailable: false, retention: 'last distinct processed/captured frames; full trace stays in memory' };
    }
    return Object.freeze({ add, recordAlert, samples, alerts, summary });
  }

  const api = Object.freeze({ parseFlags, eyeEAR, createTimePerclos, createElapsedRate, pitchRatio, createParkedBaseline,
    createNoFaceEvidence, matrixPose, parseTasksResult, createTraceStore, createObserverEpisodes });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OcculertDetectionExperiments = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// Loaded only for an explicitly selected parked experiment.
(function(root){
  'use strict';
  const models = typeof module === 'object' && module.exports ? module.exports : root.OcculertDetectionExperiments;
  function createController(b, flags) {
    const perclos = models.createTimePerclos(), rates = models.createElapsedRate();
    const baseline = models.createParkedBaseline(), evidence = models.createNoFaceEvidence();
    let active = false, generation = 0, startedAt = 0, geometry = '', calibrationRevision = 0;
    let previousFrameAt = null, previousNose = null, pitchBaseline = null, calibration = null;
    let pitchDown = false, pitchUnknownLast = false, lossEpisode = null, lossRequested = false, calibrationDeadline = null;
    let distractionAt = null, previousDistracted = false, frame = null, frameSequence = 0, collector = null;
    let trace = models.createTraceStore(), lastTrace = null, invalidatedFrames = 0, skippedRepeatedFrames = 0;
    let scoringReplay = null, scoringWallStart = 0, scoringOrder = 0;
    const observer = flags.observer ? models.createObserverEpisodes() : null;
    let lastObserverCsv = null;
    const units = value => flags.pixels ? value * 4 / 3 : value;
    const now = () => b.now();
    function scoringSnapshot() {
      const source = b.scoringState(), result = {};
      const keys = ['fatigue','confidence','maxFatigue','fatigueSampleSum','fatigueSampleCount','perclosWindow','eyesClosedSince','microsleeps','lastMicro','turnedSince','totalDistractionMs','noFaceSince','lastFaceSeen','calibrating','calibrated','calibrationUntil','calibrationSamples','baselineEAR','baseClosedThreshold','baseWatchThreshold','eyeClosedThreshold','eyeWatchThreshold','lastAlert','earHistory','noseYHistory','lastNod','headNods'];
      for (const key of keys) result[key] = source[key];
      const snapshot = JSON.parse(JSON.stringify(result)), stamp = value => value === 0 ? 0 : 1700000000000 + value - scoringWallStart;
      for (const key of ['eyesClosedSince','lastMicro','turnedSince','noFaceSince','lastFaceSeen','calibrationUntil','lastAlert','lastNod']) snapshot[key] = stamp(snapshot[key]);
      snapshot.perclosWindow = snapshot.perclosWindow.map(row => ({ t: stamp(row.t), closed: row.closed }));
      snapshot.noseYHistory = snapshot.noseYHistory.map(row => ({ y: row.y, t: stamp(row.t) }));
      return snapshot;
    }
    function recordScoringInput(input) {
      if (!active || !scoringReplay || !frame || frame.recorded || frame.generation !== generation) return;
      frame.scoringInput = { order: ++scoringOrder, frameId: frame.frameId, atMs: now() - startedAt,
        wallMs: input.wall - scoringWallStart, rawEar: input.hasFace ? input.rawEar : null,
        ear: input.hasFace ? input.ear : null, hasFace: input.hasFace === true, faceMissing: input.faceMissing === true,
        turned: input.turned === true, nod: input.nod === true, noseY: input.hasFace ? input.noseY : null,
        sensitivity: b.scoringSettings().sensitivity, clocks: frame.scoringClocks ??= {} };
    }
    function recordScoringClock(phase, wall) {
      if (!active || !scoringReplay || !frame || frame.recorded || frame.generation !== generation
          || !['score','calibration','eye','distraction','nodSample','nodDecision','eligibility','trigger'].includes(phase)) return;
      (frame.scoringClocks ??= {})[phase] = { wallMs: wall - scoringWallStart, atMs: now() - startedAt };
    }
    function resetContinuity() {
      b.resetContinuous(); rates.reset(); evidence.reset(); previousNose = null; pitchUnknownLast = false;
      distractionAt = null; previousDistracted = false; lossEpisode = null; lossRequested = false;
    }
    function resetCalibration() {
      baseline.reset(); pitchBaseline = null; calibration = null; calibrationDeadline = null;
      perclos.reset(); resetContinuity(); pitchDown = false; calibrationRevision++;
      const s = b.read();
      s.baselineEAR = units(.28); s.baseClosedThreshold = units(.18); s.baseWatchThreshold = units(.22);
      s.calibrating = true; s.calibrated = false; s.calibrationSamples = [];
      s.calibrationUntil = b.wallNow() + b.calibrationMs;
      b.write(s); b.applySensitivity(); b.ui.calibration('0%', 'Keep eyes open and face centered while parked.');
    }
    function observeGeometry(force = false) {
      if (!active || (!flags.pixels && !flags.pitch)) return;
      const dims = b.dimensions(), signature = dims.width + 'x' + dims.height;
      if (!Number.isFinite(dims.width) || !Number.isFinite(dims.height) || dims.width <= 0 || dims.height <= 0) return;
      if (!geometry) { geometry = signature; return; }
      if (force || geometry !== signature) {
        geometry = signature; resetCalibration();
        b.log('Camera geometry changed — recalibrating the parked experiment.');
        return true;
      }
    }
    function begin() {
      stop(); active = true; generation++; startedAt = now(); geometry = '';
      previousFrameAt = null; frameSequence = invalidatedFrames = skippedRepeatedFrames = 0;
      trace = models.createTraceStore(); lastTrace = null; calibrationRevision = 0;
      observer?.reset(); lastObserverCsv = null;
      perclos.reset(); rates.reset(); baseline.reset(); evidence.reset();
      pitchBaseline = calibration = null; pitchDown = pitchUnknownLast = false; calibrationDeadline = null;
      previousNose = distractionAt = null; previousDistracted = false; lossEpisode = null; lossRequested = false;
      if (flags.pixels || flags.pitch) resetCalibration();
      scoringReplay = null; scoringOrder = 0;
      if ((flags.tasks || flags.observer) && typeof b.scoringState === 'function' && typeof b.scoringSettings === 'function') {
        scoringWallStart = b.wallNow();
        scoringReplay = { version: 1, epochMs: 1700000000000, initialState: scoringSnapshot(),
          initialSettings: { ...b.scoringSettings() }, frames: [], controls: [], droppedFrames: 0, droppedControls: 0 };
      }
      observeGeometry();
      b.ui.observer?.();
      if (flags.tasks && typeof b.createTasks === 'function') {
        const owner = generation;
        collector = b.createTasks({ delegate: flags.delegate, onStatus: status => {
          if (active && owner === generation) b.ui.tasks(status);
        }});
      }
    }
    function finishCalibration() {
      const result = baseline.finish(), s = b.read();
      s.baseClosedThreshold = units(.18); s.baseWatchThreshold = units(.22); s.baselineEAR = units(.28);
      if (result.usable) {
        s.baselineEAR = result.eyeBaseline;
        s.baseClosedThreshold = Math.max(units(.12), Math.min(units(.22), result.eyeBaseline * .66));
        s.baseWatchThreshold = Math.max(s.baseClosedThreshold + units(.025), Math.min(units(.28), result.eyeBaseline * .82));
      }
      s.calibrating = false; s.calibrated = result.usable; s.calibrationSamples = [];
      pitchBaseline = flags.pitch ? result.pitchBaseline : null;
      calibration = { ...result, units: flags.pixels ? 'pixels-reference-3x4' : 'normalized', revision: calibrationRevision,
        pitchAvailable: pitchBaseline !== null };
      b.write(s); b.applySensitivity();
      b.ui.calibration(result.usable ? 'DONE' : 'DEFAULT', result.usable ?
        'Parked experimental baseline recorded; physical accuracy is unverified.' :
        'Too little continuous calibration support; using current default thresholds.');
      b.log(result.usable ? 'Experimental calibration complete' : 'Experimental calibration used default thresholds');
      resetContinuity(); perclos.reset();
      return calibration;
    }
    function calibrate(ear, ratio, turned) {
      const s = b.read(), time = now();
      if (calibrationDeadline !== s.calibrationUntil) {
        baseline.reset(); pitchBaseline = null; calibration = null; calibrationDeadline = s.calibrationUntil;
      }
      baseline.add(time, ear, ratio, !turned && Number.isFinite(ear) && ear > Math.max(units(.16), s.eyeWatchThreshold) && ear < units(.45) &&
        (!flags.pitch || ratio !== null));
      const remaining = Math.max(0, s.calibrationUntil - b.wallNow('calibration')), progress = Math.min(100, Math.round((1 - remaining / b.calibrationMs) * 100));
      b.ui.calibration(progress + '%', 'Keep eyes open and face centered while parked… ' + progress + '%');
      if (!remaining) finishCalibration();
    }
    function eyeMetrics(ear, turned, down, time, unknown = false) {
      const s = b.read(), wall = b.wallNow('eye'), usable = Number.isFinite(ear) && !turned && !down && !unknown;
      const closed = usable && ear < s.eyeClosedThreshold;
      let percent;
      if (flags.timePerclos) percent = perclos.update(time, usable ? closed : null);
      else {
        // Pitch-gated samples are unknown, not artificially open-frame credit.
        if (!down && !unknown) s.perclosWindow.push({ t: wall, closed: ear < s.eyeClosedThreshold });
        s.perclosWindow = s.perclosWindow.filter(row => wall - row.t < 60000);
        percent = s.perclosWindow.length ? s.perclosWindow.filter(row => row.closed).length / s.perclosWindow.length * 100 : null;
      }
      if (!usable) s.eyesClosedSince = 0;
      else if (closed && !s.eyesClosedSince) s.eyesClosedSince = wall;
      else if (!closed) s.eyesClosedSince = 0;
      if (s.eyesClosedSince && wall - s.eyesClosedSince > 1500 && wall - s.lastMicro > 3000 && s.confidence > 45) {
        s.microsleeps++; s.lastMicro = wall; b.ui.microsleeps(s.microsleeps); b.log('Microsleep pattern detected');
      }
      if (flags.pitch) {
        const distracted = turned || down;
        const dt = distractionAt === null ? 0 : time - distractionAt;
        if (previousDistracted && dt > 0 && dt <= 1000) s.totalDistractionMs += dt;
        distractionAt = time; previousDistracted = distracted;
        s.turnedSince = 0;
        b.ui.distraction(Math.round(s.totalDistractionMs / 1000));
      } else {
        if (turned && !s.turnedSince) s.turnedSince = wall;
        if (!turned && s.turnedSince) { s.totalDistractionMs += wall - s.turnedSince; s.turnedSince = 0; }
        b.ui.distraction(Math.round((s.totalDistractionMs + (s.turnedSince ? wall - s.turnedSince : 0)) / 1000));
      }
      b.ui.perclos(percent); b.write(s); return percent;
    }
    function prepareObservation(time, hasFace, faceMissing) {
      if (previousFrameAt !== null && (time < previousFrameAt || time - previousFrameAt > 1000)) {
        // Unknown time cannot complete an eye, mouth, or nod episode.
        if (flags.timePerclos || flags.pitch || flags.pixels || flags.noface) {
          b.resetContinuous(); rates.reset(); previousNose = distractionAt = null; previousDistracted = false;
          if (hasFace || !faceMissing || time < previousFrameAt) {
            evidence.reset(); lossEpisode = null; lossRequested = false;
          }
          if (b.read().calibrating) baseline.reset();
        }
      }
    }
    function score(ear, turned, nod, hasFace, ratio = null, noseY = null, faceMissing = true, prepared = false) {
      const time = now(), wall = b.wallNow('score');
      recordScoringInput({ ear, rawEar: frame?.scoringRawEar ?? ear, turned, nod, hasFace, noseY, wall, faceMissing });
      if (!prepared) prepareObservation(time, hasFace, faceMissing);
      previousFrameAt = time;
      const scale = flags.elapsed ? rates.scale(time, hasFace) : 1;
      let s = b.read();
      if (!hasFace) {
        if (s.calibrating) baseline.reset();
        if (flags.timePerclos) { perclos.update(time, null); b.ui.perclos(perclos.snapshot().perclos); }
        // Capture the qualified episode before normal continuity is discarded.
        if (flags.noface && faceMissing && !s.calibrating && !lossEpisode) lossEpisode = evidence.loss(time);
        if (!faceMissing) { lossEpisode = null; lossRequested = false; evidence.reset(); }
        b.resetContinuous(); distractionAt = null; previousDistracted = false; previousNose = null;
        s = b.read(); if (!s.noFaceSince) s.noFaceSince = wall;
        s.confidence = Math.max(0, s.confidence - 10 * scale);
        if (!(flags.noface && lossEpisode?.qualified) && wall - s.noFaceSince > 3500) s.fatigue = Math.max(0, s.fatigue - 2 * scale);
        b.write(s); b.ui.face(false);
        if (lossEpisode?.qualified && !lossRequested) { lossRequested = true; b.alert('Face lost after fatigue', lossEpisode); }
        return;
      }
      lossEpisode = null; lossRequested = false; s.noFaceSince = 0; s.lastFaceSeen = wall; b.ui.face(true);
      if (s.calibrating) {
        b.write(s);
        if (flags.pixels || flags.pitch) calibrate(ear, ratio, turned);
        else b.defaultCalibration(ear);
        s = b.read(); s.confidence = Math.min(100, s.confidence + 2 * scale); s.fatigue = Math.max(0, s.fatigue - 2 * scale); b.write(s); return;
      }
      const nextDown = flags.pitch && pitchBaseline !== null && ratio !== null && ratio > pitchBaseline + .12;
      const pitchUnknown = flags.pitch && pitchBaseline !== null && ratio === null;
      if (!prepared && flags.pitch && (nextDown !== pitchDown || pitchUnknown || pitchUnknownLast)) { b.resetContinuous(); s = b.read(); }
      pitchDown = nextDown; pitchUnknownLast = pitchUnknown;
      const confidenceGain = s.calibrated || flags.distractionConfidence && turned ? 5 : 3;
      s.confidence = Math.min(100, s.confidence + confidenceGain * scale); b.write(s);
      const percent = flags.timePerclos || flags.pitch ? eyeMetrics(ear, turned, pitchDown, time, pitchUnknown) : b.defaultEyeMetrics(ear, turned);
      s = b.read();
      if (pitchUnknown) { b.write(s); return; }
      if (turned || pitchDown) {
        s.confidence = Math.max(35, s.confidence - 5 * scale);
        if (!pitchDown && s.turnedSince && wall - s.turnedSince > 3000) s.fatigue += 2 * scale;
        else s.fatigue = Math.max(0, s.fatigue - scale);
      } else {
        if (nod) s.fatigue += 18;
        if (ear < s.eyeClosedThreshold * .82) s.fatigue += 9 * scale;
        else if (ear < s.eyeClosedThreshold) s.fatigue += 6 * scale;
        else if (ear < s.eyeWatchThreshold) s.fatigue += 2 * scale;
        else s.fatigue -= 3 * scale;
        if (percent !== null && percent > 45) s.fatigue += 8 * scale;
        else if (percent !== null && percent > 30) s.fatigue += 5 * scale;
        else if (percent !== null && percent > 18) s.fatigue += 2 * scale;
        if (s.lastMicro && wall - s.lastMicro < 30000) s.fatigue += scale;
        if (s.confidence < 45) s.fatigue += scale;
      }
      s.fatigue = Math.max(0, Math.min(100, s.fatigue)); s.maxFatigue = Math.max(s.maxFatigue, s.fatigue);
      s.fatigueSampleSum += s.fatigue; s.fatigueSampleCount++; b.write(s);
      if (flags.noface) {
        const downward = Number.isFinite(noseY) && previousNose && time - previousNose.at <= 1000 && noseY - previousNose.y > .025;
        evidence.observe(time, { eyesClosed: !turned && !pitchDown && ear < s.eyeClosedThreshold, fatigue: s.fatigue, downward: !!downward });
        previousNose = Number.isFinite(noseY) ? { y: noseY, at: time } : null;
      }
    }
    function results(res) {
      observeGeometry();
      if (frame && frame.calibrationRevision !== calibrationRevision) { invalidatedFrames++; frame.recorded = true; b.render(); return; }
      const lm = res.multiFaceLandmarks?.[0];
      let raw = null, ear = null, turned = false;
      const has = Array.isArray(lm) && [4, 234, 454].every(i => lm[i] && Number.isFinite(lm[i].x) && Number.isFinite(lm[i].y));
      prepareObservation(now(), has, !res.multiFaceLandmarks?.length);
      if (has) raw = (b.calcEAR(lm, b.left) + b.calcEAR(lm, b.right)) / 2;
      if (frame) frame.scoringRawEar = raw;
      if (!has || !Number.isFinite(raw) || raw <= 0 || raw > 1) {
        b.clearEyes(); score(0, false, false, false, null, null, !res.multiFaceLandmarks?.length, true); b.tracking(false, false); b.render();
        recordResults(res, null, null, false); return;
      }
      const s = b.read(), ratio = flags.pitch ? models.pitchRatio(lm) : null;
      const nextDown = flags.pitch && pitchBaseline !== null && ratio !== null && ratio > pitchBaseline + .12;
      const unknown = flags.pitch && pitchBaseline !== null && ratio === null;
      // Invalidate old eye/nod evidence before processing this new observation.
      if (flags.pitch && (nextDown !== pitchDown || unknown || pitchUnknownLast)) b.resetContinuous();
      ear = b.smooth(raw); turned = b.headTurn(lm);
      const nod = s.calibrating ? false : b.detectNod(lm);
      score(ear, turned, nod, true, ratio, lm[4].y, false, true);
      if (flags.pitch && (pitchDown || ratio === null && pitchBaseline !== null)) b.resetMouth(); else b.otherFaceMetrics(lm); b.tracking(true, ear > .05 && ear < .65); b.draw(lm); b.render(ear);
      const after = b.read();
      if (!after.calibrating && after.confidence >= 45 && after.fatigue >= 80) b.alert('Fatigue');
      else if (!after.calibrating && after.confidence >= 45 && after.turnedSince && b.wallNow('eligibility') - after.turnedSince > 6500) b.alert('Distraction');
      recordResults(res, raw, ear, turned);
    }
    function capture(video) {
      if (!active || !flags.any) return null;
      const time = now(), mediaTime = Number.isFinite(video.currentTime) ? video.currentTime : null;
      if (frame && frame.mediaTime === mediaTime && mediaTime !== null) { skippedRepeatedFrames++; return { skip: true }; }
      let image = video, paired = false;
      if (flags.tasks) try {
        const canvas = b.captureCanvas(video); image = canvas; paired = true;
      } catch (_) { b.ui.tasks('capture unavailable; comparison unpaired'); }
      frame = { image, paired, frameId: ++frameSequence, mediaTime, at: time, inferenceStartedAt: now(), legacyEndedAt: null,
        generation, calibrationRevision, calibrating: b.read().calibrating };
      return frame;
    }
    function recordResults(res, rawEar, smoothedEar, turned) {
      if (!active || (!flags.tasks && !flags.observer) || !frame || frame.recorded || frame.generation !== generation) return;
      if (frame.calibrationRevision !== calibrationRevision) { invalidatedFrames++; frame.recorded = true; return; }
      const time = now(), s = b.read();
      let parsed = models.parseTasksResult(null), tasksMs = null;
      if (frame.paired && collector) {
        const sample = collector.sample(frame.image, frame.at);
        if (sample) { parsed = models.parseTasksResult(sample.result); tasksMs = sample.inferenceMs; }
      }
      const end = now(), support = flags.timePerclos ? perclos.snapshot() : null;
      trace.add({ frameId: frame.frameId, atMs: frame.at - startedAt, mediaTime: frame.mediaTime,
        rawEar, smoothedEar, ...parsed, legacyUsable: (frame.paired || flags.observer && !flags.tasks) && Number.isFinite(rawEar) && !frame.calibrating && !s.calibrating && !turned && !pitchDown && (!flags.pitch || pitchBaseline === null || models.pitchRatio(res.multiFaceLandmarks?.[0]) !== null),
        tasksUsable: frame.paired && parsed.tasksUsable && !frame.calibrating && !s.calibrating,
        legacyInferenceMs: frame.legacyEndedAt === null ? null : Math.max(0, frame.legacyEndedAt - frame.inferenceStartedAt), tasksInferenceMs: tasksMs,
        combinedFrameMs: Math.max(0, end - frame.at), perclos: support?.perclos ?? null,
        observedMs: support?.observedMs ?? null, closedMs: support?.closedMs ?? null,
        fatigue: s.fatigue, confidence: s.confidence, calibrating: frame.calibrating || s.calibrating, pitchDown });
      if (scoringReplay && frame.scoringInput) {
        if (scoringReplay.frames.length === 2400) { scoringReplay.frames.shift(); scoringReplay.droppedFrames++; }
        scoringReplay.frames.push(frame.scoringInput);
      }
      frame.recorded = true;
    }
    function recalibrate() {
      if (!active) return;
      if (flags.pixels || flags.pitch) resetCalibration(); else { resetContinuity(); perclos.reset(); calibrationRevision++; }
      if (scoringReplay) {
        if (scoringReplay.controls.length === 256) { scoringReplay.controls.shift(); scoringReplay.droppedControls++; }
        scoringReplay.controls.push({ order: ++scoringOrder, atMs: now() - startedAt,
          wallMs: b.wallNow() - scoringWallStart, kind: 'recalibrate', state: scoringSnapshot(), settings: { ...b.scoringSettings() } });
      }
    }
    function qualifiedLoss(context) { return active && flags.noface && context === lossEpisode && context?.qualified && !b.read().calibrating; }
    function legacyResult() { if (active && frame && frame.generation === generation) frame.legacyEndedAt = now(); }
    function recordAlert(reason) { if (active && (flags.tasks || flags.observer)) trace.recordAlert(now() - startedAt, reason); }
    function markObserver(label) {
      const marked = !!observer && active && observer.mark(label, Math.max(0, now() - startedAt));
      if (marked) b.ui.observer?.();
      return marked;
    }
    function observerState() { return observer ? { ...observer.summary(), collecting: active } : null; }
    function exportObserverEpisodes() {
      if (active || b.read().running) throw Error('Stop monitoring and remain parked before exporting.');
      return lastObserverCsv;
    }
    function summary() {
      return { version: 1, experimentFlags: flags.names, primary: 'legacy-ear', secondary: flags.tasks ? 'tasks-measurement-only' : null,
        alertsChangedByTasks: false, requestedDelegate: flags.tasks ? flags.delegate : null,
        usableDelegate: collector?.status?.() === 'ready' ? flags.delegate : null, comparisonStatus: collector?.status?.() ?? 'off',
        calibration, geometryUnits: flags.pixels ? 'pixels-reference-3x4' : 'normalized',
        timePerclos: flags.timePerclos ? perclos.snapshot(now()) : null,
        ...trace.summary(), invalidatedFrames, skippedRepeatedFrames,
        ...(observer ? { observerEpisodes: observer.summary().episodes, observerRejected: observer.summary().rejected } : {}) };
    }
    function exportData() {
      if (active || b.read().running) throw Error('Stop monitoring and remain parked before exporting.');
      return lastTrace;
    }
    function stop() {
      if (active) {
        const s = b.read();
        const durationMs = Math.max(0, now() - startedAt);
        if (observer) {
          const stopped = observer.stop(durationMs);
          lastObserverCsv = stopped && /^[A-Za-z0-9_-]{1,128}$/.test(s.localSessionId)
            ? 'session_id,start_ms,end_ms,label\n' + observer.entries().map(row =>
              [s.localSessionId, row.start_ms, row.end_ms, row.label].join(',')).join('\n') + '\n' : null;
        }
        lastTrace = { schema: 'occulert.parked-detection-trace', version: scoringReplay ? 2 : 1,
          session: { sessionId: s.localSessionId, durationMs, platform: 'web',
            detectorVersion: b.detectorVersion(), ...b.provenance(), ...summary() },
          samples: trace.samples(), legacyAlerts: trace.alerts(),
          ...(scoringReplay ? { scoringReplay: { ...scoringReplay, invalidatedFrames } } : {}) };
      }
      active = false; generation++; frame = null; pitchDown = pitchUnknownLast = false; lossEpisode = null; lossRequested = false;
      b.ui.observer?.();
      if (collector) { collector.stop(); collector = null; }
      rates.reset(); baseline.reset(); evidence.reset(); previousNose = null;
      return lastTrace?.session ?? null;
    }
    return Object.freeze({ begin, stop, score, results, observeGeometry, finishCalibration, capture, recordResults,
      qualifiedLoss, recordAlert, summary, exportData, units, legacyResult, recalibrate, recordScoringInput, recordScoringClock, prepareObservation,
      markObserver, observerState, exportObserverEpisodes });
  }
  const api = Object.freeze({ ...models, createController });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OcculertDetectionExperiments = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// Optional owned Tasks runtime; never drives default alerts.
(function(root){
'use strict';
  const PINS=[{"url": "/vendor/mediapipe/tasks-vision-1.0.1-occulert.1/vision_bundle.js", "integrity": "sha256-pCfCa2tALe6263Th9sdo0m7AzBWWlYyenj1RibfL9ao="}, {"url": "/vendor/mediapipe/tasks-vision-1.0.1-occulert.1/wasm/vision_wasm_internal.js", "integrity": "sha256-4XDuZ91OFsGm/NiECiBmh+WlmyLCDkqQK8RFsJVFTXM="}, {"url": "/vendor/mediapipe/tasks-vision-1.0.1-occulert.1/wasm/vision_wasm_internal.wasm", "integrity": "sha256-jaJ3pzOSbqzQR0uHBLNnQtbsMjHFeoYMW4id/48d+IY="}, {"url": "/vendor/mediapipe/tasks-vision-1.0.1-occulert.1/wasm/vision_wasm_nosimd_internal.js", "integrity": "sha256-6B1xWj1CzDNzYC6y96/3ldFkk022gOMklrZdq1N/llg="}, {"url": "/vendor/mediapipe/tasks-vision-1.0.1-occulert.1/wasm/vision_wasm_nosimd_internal.wasm", "integrity": "sha256-ooSDzULnToVb9evba0DZtmpbSeNelQILyXZp5oIqMZI="}, {"url": "/vendor/mediapipe/tasks-vision-1.0.1-occulert.1/face_landmarker.task", "integrity": "sha256-ZBhOIpsmMQe8K4BMZiXbE0H/K7cxh0sLzC/mVE4Lyf8="}];
let libraryPromise=null;
function loadLibrary(){
 if(libraryPromise)return libraryPromise;
 const pending=new Promise((resolve,reject)=>{
  const script=document.createElement('script'),pin=PINS[0];script.src=pin.url;script.integrity=pin.integrity;script.crossOrigin='anonymous';
  const timer=setTimeout(()=>{script.remove();reject(Error('Tasks library timeout'))},15000);
  script.onload=()=>{clearTimeout(timer);root.Vision?.FaceLandmarker?resolve(root.Vision):reject(Error('Tasks library unavailable'))};
  script.onerror=()=>{clearTimeout(timer);reject(Error('Tasks library integrity or load failure'))};document.head.appendChild(script);
 });
 libraryPromise=pending.catch(error=>{libraryPromise=null;throw error});return libraryPromise;
}
function verifyWorker(){return new Promise((resolve,reject)=>{
 const worker=navigator.serviceWorker?.controller;if(!worker){reject(Error('Reload after optional offline setup'));return}
 const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error('Integrity worker timeout'))},1500);
 channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();event.data?.type==='occulert.tasks.runtime'&&JSON.stringify(event.data.pins)===JSON.stringify(PINS)?resolve():reject(Error('Integrity worker pins mismatch'))};
 worker.postMessage({type:'occulert.tasks.runtime'},[channel.port2]);
})}
function createTasks({delegate='GPU',onStatus=()=>{}}={}){
 if(delegate!=='CPU'&&delegate!=='GPU')throw Error('Invalid Tasks delegate');
 let active=true,detector=null,status='loading',lastStamp=-Infinity;
 const state=value=>{status=value;if(active)onStatus(value)};
 const ready=(async()=>{
  await verifyWorker();if(!active)return;const Vision=await loadLibrary();if(!active)return;
  const modelPin=PINS.find(p=>p.url.endsWith('.task')),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);let model;
  try{const response=await fetch(modelPin.url,{integrity:modelPin.integrity,signal:controller.signal});if(!response.ok)throw Error('Model unavailable');model=new Uint8Array(await response.arrayBuffer())}finally{clearTimeout(timer)}
  if(!active)return;
  const files=await Vision.FilesetResolver.forVisionTasks('/vendor/mediapipe/tasks-vision-1.0.1-occulert.1/wasm');if(!active)return;
  const creation=Vision.FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetBuffer:model,delegate},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true,outputFacialTransformationMatrixes:true});
  let accept=true;
  const value=await new Promise((resolve,reject)=>{
   const deadline=setTimeout(()=>{accept=false;reject(Error('Tasks initialization timeout'))},15000);
   creation.then(value=>{clearTimeout(deadline);if(accept)resolve(value);else value.close()},error=>{clearTimeout(deadline);reject(error)});
  });
  if(!active){value.close();return}detector=value;state('ready');
 })().catch(()=>{if(active)state('unavailable')});
 return Object.freeze({ready,status:()=>status,
  sample(image,atMs){
   if(!active||!detector||typeof atMs!=='number'||!Number.isFinite(atMs)||atMs<0||atMs<=lastStamp)return null;
   lastStamp=atMs;const before=performance.now();
   try{return {result:detector.detectForVideo(image,atMs),inferenceMs:Math.max(0,performance.now()-before)}}
   catch(_){state('unavailable');try{detector.close()}catch(_){}detector=null;return null}
  },
  stop(){active=false;status='stopped';if(detector){try{detector.close()}catch(_){}detector=null}}
 });
}
const models=typeof module==='object'&&module.exports?module.exports:root.OcculertDetectionExperiments;
const api=Object.freeze({...models,createTasks,tasksPins:Object.freeze(PINS.map(pin=>Object.freeze(pin)))});
if(typeof module==='object'&&module.exports)module.exports=api;else root.OcculertDetectionExperiments=api;
})(typeof globalThis!=='undefined'?globalThis:this);

// The mounted helper shares these reviewed classic-script driver bindings.
/* global running, starting, localSessionId, CALIBRATION_MS, LEFT, RIGHT,
  EXPERIMENT_HELPER_INTEGRITY, video, canvas, ctx, cloudConsent, calHint,
  faceStateEl, perclosEl, microsleepsEl, distractionEl, calibrationEl, calibrationFill,
  applySensitivity, resetContinuousObservations, updateCalibration, updateEyeMetrics,
  calcEAR, smooth, headTurn, detectHeadNod, log, updateTrackingState, drawEyes,
  render, trigger, detectYawn, calcMAR, checkLightLevel, scoringMetricState, scoringReadWallClock, lastAlert, calibrationMinimumSamples */
/* global calibrating: writable, calibrated: writable, calibrationUntil: writable,
  sensitivityLevel: readonly, calibrationSamples: writable, baselineEAR: writable, baseClosedThreshold: writable,
  baseWatchThreshold: writable, eyeClosedThreshold: writable, eyeWatchThreshold: writable,
  fatigue: writable, maxFatigue: writable, confidence: writable, fatigueSampleSum: writable,
  fatigueSampleCount: writable, noFaceSince: writable, lastFaceSeen: writable,
  perclosWindow: writable, eyesClosedSince: writable, lastMicro: writable,
  microsleeps: writable, turnedSince: writable, totalDistractionMs: writable,
  _mouthOpenSince: writable, _marHist: writable */
(function(root){'use strict';
function createMountedController(flags){
 const api=window.OcculertDetectionExperiments;let capturedCanvas=null;
 const controller=api.createController({
 scoringState:()=>({...scoringMetricState(),lastAlert,calibrationUntil,calibrationSamples,baselineEAR,baseClosedThreshold,baseWatchThreshold}),
 scoringSettings:()=>({sensitivity:sensitivityLevel,minimumSamples:calibrationMinimumSamples}),
 read:()=>({running,localSessionId,calibrating,calibrated,calibrationUntil,calibrationSamples,baselineEAR,baseClosedThreshold,baseWatchThreshold,eyeClosedThreshold,eyeWatchThreshold,fatigue,maxFatigue,confidence,fatigueSampleSum,fatigueSampleCount,noFaceSince,lastFaceSeen,perclosWindow,eyesClosedSince,lastMicro,microsleeps,turnedSince,totalDistractionMs}),
 write:s=>{({calibrating,calibrated,calibrationUntil,calibrationSamples,baselineEAR,baseClosedThreshold,baseWatchThreshold,eyeClosedThreshold,eyeWatchThreshold,fatigue,maxFatigue,confidence,fatigueSampleSum,fatigueSampleCount,noFaceSince,lastFaceSeen,perclosWindow,eyesClosedSince,lastMicro,microsleeps,turnedSince,totalDistractionMs}=s)},
 now:()=>typeof performance!=='undefined'&&typeof performance.now==='function'?performance.now():Date.now(),wallNow:phase=>scoringReadWallClock(phase),calibrationMs:CALIBRATION_MS,left:LEFT,right:RIGHT,
 dimensions:()=>({width:video.videoWidth,height:video.videoHeight}),applySensitivity:()=>applySensitivity(sensitivityLevel),
 resetContinuous:resetContinuousObservations,resetMouth:()=>{_mouthOpenSince=0;_marHist=[]},defaultCalibration:updateCalibration,defaultEyeMetrics:updateEyeMetrics,
 calcEAR,smooth,headTurn,detectNod:detectHeadNod,log,tracking:updateTrackingState,clearEyes:()=>ctx.clearRect(0,0,canvas.width,canvas.height),
 draw:lm=>drawEyes(lm,fatigue>=60?'#ff3344':fatigue>=35?'#ffaa00':'#00ff88'),render,alert:(reason,eligibility)=>trigger(reason,eligibility),
 otherFaceMetrics:lm=>{detectYawn(lm);const el=document.getElementById('marEl');if(el)el.textContent=calcMAR(lm).toFixed(2);checkLightLevel(video)},
 ui:{face:has=>{faceStateEl.textContent=has?'OK':'NO'},perclos:value=>{perclosEl.textContent=value===null?'--':Math.round(value)+'%'},microsleeps:n=>{microsleepsEl.textContent=n},distraction:n=>{distractionEl.textContent=n+'s'},
 calibration:(label,hint)=>{calibrationEl.textContent=label;calibrationFill.style.width=label==='DONE'||label==='DEFAULT'?'100%':label;if(calHint)calHint.textContent=hint;const rb=document.getElementById('recalBtn');if(rb)rb.style.display=label==='DONE'||label==='DEFAULT'?'block':'none'},tasks:value=>{const el=document.getElementById('experimentStatus');if(el)el.textContent='Parked experiment · local only · Tasks '+value},observer:()=>refreshObserverPanel()},
 captureCanvas:input=>{const snapshot=capturedCanvas??=document.createElement('canvas');snapshot.width=input.videoWidth;snapshot.height=input.videoHeight;const context=snapshot.getContext('2d');if(!context||!snapshot.width||!snapshot.height)throw Error('No capture');context.drawImage(input,0,0);return snapshot},
 createTasks:options=>api.createTasks(options),detectorVersion:()=> 'web-v81:parked:'+flags.names.join('+'),provenance:()=>({runtimeVersion:'1.0.1-occulert.1',runtimePins:api.tasksPins,modelIntegrity:api.tasksPins.find(pin=>pin.url.endsWith('.task')).integrity,helperIntegrity:EXPERIMENT_HELPER_INTEGRITY,poseConvention:'column-major Rz Ry Rx metric-coordinate degrees; physical orientation unvalidated'})
 },flags);
 function refreshObserverPanel(){
  if(!flags.observer)return;
  const state=controller.observerState(),active=state.collecting&&running;
  const note=document.getElementById('observerLabelStatus');
  if(note)note.textContent=state.rejected?'Episode limit reached. Stop and export before starting another session.':active?(state.activeLabel?'Marking '+state.activeLabel.replace('_',' ')+'. Press again to end.':'Labeling active. Mark only what you observe.'):'Labeling stopped. Start a new parked session or export the completed episodes.';
  for(const [id,label]of [['observerDrowsy','drowsy'],['observerHighFatigue','high_fatigue']]){
   const button=document.getElementById(id);if(button){button.disabled=!active;button.setAttribute('aria-pressed',String(state.activeLabel===label))}
  }
  const button=document.getElementById('exportObserverEpisodes');if(button)button.hidden=running||starting||!controller.exportObserverEpisodes();
 }
 if(flags.observer){
  const panel=document.getElementById('observerLabels');
  if(panel){panel.hidden=false;panel.style.removeProperty('display')}
  // Hide all detector-derived indicators, logs and colored overlays from both
  // visual and accessibility views. Keep Stop and lifecycle warnings usable.
  for(const id of ['driverStatusBadges','alertScreen','breakBanner','report','feedbackCard']){
   document.getElementById(id)?.style.setProperty('display','none','important');
  }
  for(const id of ['fatigue','confidence','faceState','ear','perclos','risk','riskDetail','microsleeps','nods','distraction','alerts','escalation','log','alertnessChart','calibration','yawnCountEl','marEl']){
   document.getElementById(id)?.closest('.card')?.style.setProperty('display','none','important');
  }
  const mark=label=>{const marked=controller.markObserver(label);refreshObserverPanel();if(marked)panel?.focus({preventScroll:true})};
  document.getElementById('observerDrowsy')?.addEventListener('click',()=>mark('drowsy'));
  document.getElementById('observerHighFatigue')?.addEventListener('click',()=>mark('high_fatigue'));
  document.addEventListener('keydown',event=>{
   if(!running||starting||event.repeat||event.altKey||event.ctrlKey||event.metaKey||event.target?.isContentEditable||event.target?.closest?.('input,textarea,select,button,a'))return;
   const label=event.code==='Space'||event.key===' '?'drowsy':event.key?.toLowerCase()==='h'?'high_fatigue':null;
   if(label){event.preventDefault();mark(label)}
  });
  document.getElementById('exportObserverEpisodes')?.addEventListener('click',()=>{
   if(running||starting)return;const csv=controller.exportObserverEpisodes();if(!csv)return;
   const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'})),link=document.createElement('a');link.href=url;link.download='occulert-observer-episodes.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  refreshObserverPanel();
 }
 cloudConsent.checked=false;cloudConsent.disabled=true;
 const status=document.getElementById('experimentStatus');if(status){status.hidden=false;status.textContent='Parked experiment · local only · '+flags.names.join(', ')}
 const exportBtn=document.getElementById('exportDetectionTrace');if(exportBtn){exportBtn.hidden=!flags.tasks&&!flags.observer;exportBtn.addEventListener('click',()=>{
  if(running||starting)return;const data=controller.exportData();if(!data){log('Run and stop a parked comparison first.');return}
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='occulert-parked-detection.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 })}
 window.addEventListener('orientationchange',()=>controller.observeGeometry(true));window.screen?.orientation?.addEventListener('change',()=>controller.observeGeometry(true));
 return controller;
}
const api=Object.freeze({...root.OcculertDetectionExperiments,createMountedController});
if(typeof module==='object'&&module.exports)module.exports=Object.freeze({...module.exports,createMountedController});else root.OcculertDetectionExperiments=api;
})(typeof globalThis!=='undefined'?globalThis:this);
