// @ts-check
/** @typedef {{x:number,y:number,z?:number}} FaceLandmark */
/** @typedef {{multiFaceLandmarks?:FaceLandmark[][]}} FaceResult */
/** @typedef {HTMLVideoElement|HTMLCanvasElement|ImageBitmap|ImageData} DetectorImage */
/** @typedef {{setOptions:(options:{maxNumFaces:number,refineLandmarks:boolean,minDetectionConfidence:number,minTrackingConfidence:number})=>void|Promise<void>,onResults:(callback:(result:FaceResult)=>void)=>void,send:(input:{image:DetectorImage})=>Promise<void>,close:()=>void|Promise<void>}} LegacyDetector */
/** @typedef {{afterGeneration:number,resolve:(generation:number)=>void}} DetectionWaiter */
import { cameraRecoveryGuidance } from "./camera.js";
import "./calibration.js";
import { onResults } from "./metrics.js";
import { tone, speak } from "./alerts.js";
import "./storage-history.js";
import "./cloud-sync.js";
import { experimentFlags, experimentController, experimentGeneration, video, canvas, startBtn, running, stream, detectionResultGeneration, raf, sessionStart, performanceSamples, processedFrames, performanceSessionStart, PROCESS_INTERVAL, DETECTION_INFERENCE_TIMEOUT_MS, DETECTION_CLOSE_TIMEOUT_MS, log, setOverlay, render, showStoppedReason, stop, set_running, set_stream, set_detectionResultGeneration, set_raf, set_calibrating, set_performanceSamples, set_processedFrames, set_performanceSessionStart } from "./ui.js";
export let faceMesh = /** @type {LegacyDetector|null} */ (null), faceMeshScriptPromise = /** @type {Promise<void>|null} */ (null), detectionRuntimePromise = /** @type {Promise<boolean>|null} */ (null), processingFrame = false, detectorFailureStopping = false, consecutiveInferenceFailures = 0, lastDetectionResultAt = 0, detectionResultWaiters = /** @type {DetectionWaiter[]} */ ([]), lastFrame = 0, busyFrameSkips = 0;
export const PERFORMANCE_WINDOW_SIZE = 120, DETECTION_STARTUP_TIMEOUT_MS = 12000, DETECTION_RESULT_TIMEOUT_MS = 6000, MAX_CONSECUTIVE_INFERENCE_FAILURES = 3, FACE_MESH_VERSION = '0.4.1633559619', FACE_MESH_ASSET_BASE = '/vendor/mediapipe/face-mesh-' + FACE_MESH_VERSION + '-occulert.1/', FACE_MESH_SCRIPT_URL = FACE_MESH_ASSET_BASE + 'face_mesh.js', FACE_MESH_GRAPH_URL = FACE_MESH_ASSET_BASE + 'face_mesh.binarypb', FACE_MESH_SCRIPT_INTEGRITY = 'sha384-nKiz5QrpRlMQLw5nrZcprT7N9vmmAcIgV8TuGuep4x91V4JIPsXa+D44Wxj0guoa';
/** @param {number} durationMs */
export function recordFramePerformance(durationMs) {
    (set_processedFrames(processedFrames + 1) - 1);
    if (Number.isFinite(durationMs) && durationMs >= 0)
        performanceSamples.push(durationMs);
    if (performanceSamples.length > PERFORMANCE_WINDOW_SIZE)
        performanceSamples.shift();
}
export function resetFramePerformance() { set_performanceSamples([]); set_processedFrames(0); busyFrameSkips = 0; set_performanceSessionStart(sessionStart); }
export function framePerformanceSnapshot() { let sorted = [...performanceSamples].sort((a, b) => a - b), average = performanceSamples.length ? performanceSamples.reduce((sum, value) => sum + value, 0) / performanceSamples.length : 0, p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)] : 0; return { processedFrames, busyFrameSkips, averageInferenceMs: Math.round(average * 10) / 10, p95InferenceMs: Math.round(p95 * 10) / 10 }; }
/** @param {string} message @param {unknown} [cause] @returns {Error} */
export function detectionRuntimeError(message, cause) {
    const error = new Error(message);
    error.name = 'DetectionRuntimeError';
    if (cause)
        error.cause = cause;
    return error;
}
/** @template T @param {T|PromiseLike<T>} promise @param {number} timeoutMs @param {string} message @param {()=>void} [onTimeout] @returns {Promise<T>} */
export function withDetectionTimeout(promise, timeoutMs, message, onTimeout) {
    let timer = /** @type {ReturnType<typeof setTimeout>|null} */ (null), settled = false;
    return new Promise((resolve, reject) => {
        /** @type {<V>(callback:(value:V)=>void,value:V)=>void} */
        const finish = (callback, value) => {
            if (settled)
                return;
            settled = true;
            if (timer !== null)
                clearTimeout(timer);
            callback(value);
        };
        timer = setTimeout(() => {
            try {
                if (onTimeout)
                    onTimeout();
            }
            catch (e) { }
            finish(reject, detectionRuntimeError(message));
        }, timeoutMs);
        Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
    });
}
/** @param {string} url @param {number} [timeoutMs] @returns {Promise<{response:Response,body:ArrayBuffer|null}>} */
export function fetchDetectionAsset(url, timeoutMs = DETECTION_STARTUP_TIMEOUT_MS) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null, options = /** @type {RequestInit} */ ({ cache: 'force-cache', credentials: 'omit', mode: 'cors' });
    if (controller)
        options.signal = controller.signal;
    const request = (async () => { const response = await fetch(url, options); const body = response.ok ? await response.arrayBuffer() : null; return { response, body }; })();
    return withDetectionTimeout(request, timeoutMs, 'The AI detector download timed out.', () => {
        if (controller)
            controller.abort();
    });
}
export async function verifyDetectionRuntime() {
    if (detectionRuntimePromise)
        return detectionRuntimePromise;
    detectionRuntimePromise = (async () => {
        try {
            if (typeof WebAssembly !== 'object' || typeof WebAssembly.compile !== 'function')
                throw new Error('WebAssembly is unavailable');
            await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
            const asset = await fetchDetectionAsset(FACE_MESH_GRAPH_URL), response = asset.response;
            if (!response.ok)
                throw new Error('model graph returned HTTP ' + response.status);
            const graph = /** @type {ArrayBuffer} */ (asset.body);
            if (!graph.byteLength)
                throw new Error('model graph was empty');
            return true;
        }
        catch (error) {
            detectionRuntimePromise = null;
            throw detectionRuntimeError('The on-device AI detector failed its startup check.', error);
        }
    })();
    return detectionRuntimePromise;
}
export function loadFaceMeshScript() {
    if (typeof FaceMesh !== 'undefined')
        return Promise.resolve();
    if (faceMeshScriptPromise)
        return faceMeshScriptPromise;
    faceMeshScriptPromise = new Promise((resolve, reject) => {
        let settled = false;
        const existing = /** @type {HTMLScriptElement|null} */ (document.querySelector('script[data-occulert-face-mesh]')), script = existing || document.createElement('script'), timer = setTimeout(() => failed('The pinned AI model loader timed out.'), DETECTION_STARTUP_TIMEOUT_MS);
        function cleanup() { clearTimeout(timer); script.removeEventListener('load', loaded); script.removeEventListener('error', failed); }
        /** @param {Error} [error] */
        function finish(error) {
            if (settled)
                return;
            settled = true;
            cleanup();
            if (error) {
                faceMeshScriptPromise = null;
                script.remove();
                reject(error);
            }
            else
                resolve();
        }
        /** @param {string|Event} message */
        function failed(message) { finish(detectionRuntimeError(typeof message === 'string' ? message : 'The pinned AI model loader could not be verified or loaded.')); }
        function loaded() { typeof FaceMesh !== 'undefined' ? finish() : failed('The pinned AI model loader did not initialize.'); }
        script.addEventListener('load', loaded, { once: true });
        script.addEventListener('error', failed, { once: true });
        if (!existing) {
            script.src = FACE_MESH_SCRIPT_URL;
            script.integrity = FACE_MESH_SCRIPT_INTEGRITY;
            script.crossOrigin = 'anonymous';
            script.referrerPolicy = 'no-referrer';
            script.async = true;
            script.dataset.occulertFaceMesh = 'true';
            document.head.appendChild(script);
        }
    });
    return faceMeshScriptPromise;
}
/** @param {DetectorImage} image @param {number} [timeoutMs] @returns {Promise<void>} */
export async function sendFaceMeshFrame(image, timeoutMs = DETECTION_INFERENCE_TIMEOUT_MS) {
    if (!faceMesh || typeof faceMesh.send !== 'function')
        throw detectionRuntimeError('The AI detector is unavailable.');
    return withDetectionTimeout(faceMesh.send({ image }), timeoutMs, 'The AI detector stopped responding.');
}
export function signalDetectionResult() { (set_detectionResultGeneration(detectionResultGeneration + 1) - 1); lastDetectionResultAt = Date.now(); consecutiveInferenceFailures = 0; const ready = detectionResultWaiters.filter(waiter => detectionResultGeneration > waiter.afterGeneration); detectionResultWaiters = detectionResultWaiters.filter(waiter => detectionResultGeneration <= waiter.afterGeneration); ready.forEach(waiter => waiter.resolve(detectionResultGeneration)); }
/** @param {number} afterGeneration @param {number} timeoutMs @returns {Promise<number>} */
export function waitForDetectionResult(afterGeneration, timeoutMs) {
    if (detectionResultGeneration > afterGeneration)
        return Promise.resolve(detectionResultGeneration);
    /** @type {DetectionWaiter|undefined} */
    let waiter;
    /** @type {Promise<number>} */
    const pending = new Promise(resolve => { waiter = { afterGeneration, resolve }; detectionResultWaiters.push(waiter); });
    return withDetectionTimeout(pending, timeoutMs, 'The AI detector did not return its first camera result.').finally(() => { detectionResultWaiters = detectionResultWaiters.filter(candidate => candidate !== waiter); });
}
/** @param {number} [timeoutMs] @returns {Promise<void>} */
export async function discardFaceMesh(timeoutMs = DETECTION_CLOSE_TIMEOUT_MS) {
    const failedModel = faceMesh;
    faceMesh = null;
    detectionRuntimePromise = null;
    if (failedModel && typeof failedModel.close === 'function') {
        try {
            await withDetectionTimeout(Promise.resolve().then(() => failedModel.close()), timeoutMs, 'The failed AI detector did not close cleanly.');
        }
        catch (e) { }
    }
}
export async function initModel() {
    if (faceMesh)
        return;
    await verifyDetectionRuntime();
    await loadFaceMeshScript();
    if (typeof FaceMesh === 'undefined')
        throw detectionRuntimeError('The pinned AI model loader did not initialize.');
    faceMesh = new FaceMesh({ locateFile: f => FACE_MESH_ASSET_BASE + f });
    faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: .62, minTrackingConfidence: .58 });
    if (experimentFlags.any) {
        const owner = experimentGeneration;
        faceMesh.onResults(res => {
            if (owner === experimentGeneration)
                onResults(res);
        });
    }
    else
        faceMesh.onResults(onResults);
    log('AI model loader ready');
}
export async function verifyFirstInference(timeoutMs = DETECTION_STARTUP_TIMEOUT_MS) {
    const startedAt = Date.now(), generation = detectionResultGeneration;
    try {
        await sendFaceMeshFrame(video, timeoutMs);
        const remaining = Math.max(1, timeoutMs - (Date.now() - startedAt));
        await waitForDetectionResult(generation, remaining);
        log('AI model startup check passed');
    }
    catch (error) {
        throw error && /** @type {{readonly name?:unknown}} */ (error).name === 'DetectionRuntimeError' ? error : detectionRuntimeError('The AI detector failed its first camera check.', error);
    }
}
/** @param {unknown} cause */
export async function haltForDetectionFailure(cause) {
    if (detectorFailureStopping)
        return;
    detectorFailureStopping = true;
    const error = cause && /** @type {{readonly name?:unknown}} */ (cause).name === 'DetectionRuntimeError' ? cause : detectionRuntimeError('The AI detector stopped returning reliable results.', cause);
    set_running(false);
    set_calibrating(false);
    if (raf)
        cancelAnimationFrame(raf);
    if (stream)
        stream.getTracks().forEach(track => track.stop());
    set_stream(null);
    video.srcObject = null;
    startBtn.disabled = true;
    startBtn.textContent = 'MONITORING STOPPED';
    const recovery = cameraRecoveryGuidance(error);
    setOverlay(recovery.title, recovery.text, recovery.hint, false);
    tone(660, 300, .22);
    speak('AI monitoring stopped. Pull over safely before restarting.');
    log('AI monitoring stopped after a detector failure');
    const stopPromise = stop({ preserveOverlay: true });
    stopPromise.catch(() => { });
    showStoppedReason('AI monitoring stopped. Pull over safely before restarting.');
    await discardFaceMesh();
    lastDetectionResultAt = 0;
    consecutiveInferenceFailures = 0;
    detectorFailureStopping = false;
    startBtn.disabled = false;
    startBtn.textContent = 'START MONITORING';
}
/** @param {number} ts @returns {Promise<void>} */
export async function loop(ts) {
    if (!running)
        return;
    set_raf(requestAnimationFrame(loop));
    if (document.hidden) {
        render();
        return;
    }
    if (lastDetectionResultAt && Date.now() - lastDetectionResultAt > DETECTION_RESULT_TIMEOUT_MS) {
        await haltForDetectionFailure(detectionRuntimeError('The AI detector stopped returning camera results.'));
        return;
    }
    if (ts - lastFrame < PROCESS_INTERVAL)
        return;
    if (video.readyState >= 2 && faceMesh) {
        if (processingFrame) {
            busyFrameSkips++;
            return;
        }
        lastFrame = ts;
        if (performanceSessionStart !== sessionStart)
            resetFramePerformance();
        if (canvas.width !== video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }
        processingFrame = true;
        const inferenceStartedAt = Date.now(), frameOwner = experimentGeneration;
        try {
            const captured = experimentController?.capture(video);
            if (!captured?.skip)
                await sendFaceMeshFrame(captured?.image || video);
        }
        catch (error) {
            if (experimentFlags.any && frameOwner !== experimentGeneration)
                return;
            consecutiveInferenceFailures++;
            log('AI frame failed (' + consecutiveInferenceFailures + '/' + MAX_CONSECUTIVE_INFERENCE_FAILURES + ')');
            if (error && /** @type {{readonly name?:unknown}} */ (error).name === 'DetectionRuntimeError' || consecutiveInferenceFailures >= MAX_CONSECUTIVE_INFERENCE_FAILURES)
                await haltForDetectionFailure(error);
        }
        finally {
            if (!experimentFlags.any || frameOwner === experimentGeneration) {
                processingFrame = false;
                recordFramePerformance(Date.now() - inferenceStartedAt);
            }
        }
    }
}
/** @param {boolean} value */
export function set_processingFrame(value) { processingFrame = value; return value; }
/** @param {boolean} value */
export function set_detectorFailureStopping(value) { detectorFailureStopping = value; return value; }
/** @param {number} value */
export function set_consecutiveInferenceFailures(value) { consecutiveInferenceFailures = value; return value; }
/** @param {number} value */
export function set_lastDetectionResultAt(value) { lastDetectionResultAt = value; return value; }
