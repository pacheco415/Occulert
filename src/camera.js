import "./detector.js";
import "./calibration.js";
import "./metrics.js";
import { tone, speak } from "./alerts.js";
import "./storage-history.js";
import "./cloud-sync.js";
import { startupAllowsMonitoring, startBtn, cameraSourceRow, cameraSourceSelect, cameraSourceHint, cameraRefreshBtn, CAMERA_DEVICE_STORAGE_KEY, availableCameraDevices, cameraLabelsRevealed, unavailableCameraDeviceId, guardedCameraTrack, cameraMuteTimer, cameraFailureStopping, running, starting, log, setOverlay, showStoppedReason, stop, set_availableCameraDevices, set_cameraLabelsRevealed, set_unavailableCameraDeviceId, set_guardedCameraTrack, set_cameraMuteTimer, set_cameraFailureStopping } from "./ui.js";
export function isMobileCaptureDevice(nav = navigator) { const userAgent = String(nav && nav.userAgent || '').toLowerCase(), platform = String(nav && nav.platform || '').toLowerCase(), touchPoints = Number(nav && nav.maxTouchPoints) || 0; return /android|iphone|ipad|ipod|mobile/.test(userAgent) || (platform === 'macintel' && touchPoints > 1); }
export function buildCameraConstraints(deviceId = '', nav = navigator) {
    const videoConstraints = { width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 12, max: 16 } };
    if (deviceId && !isMobileCaptureDevice(nav))
        videoConstraints.deviceId = { exact: deviceId };
    else
        videoConstraints.facingMode = 'user';
    return { video: videoConstraints, audio: false };
}
export function cameraSelectionError(cause) {
    const error = new Error('The selected camera is no longer available.');
    error.name = 'CameraSelectionError';
    if (cause)
        error.cause = cause;
    return error;
}
export function cameraOptionLabel(device, index) { return String(device && device.label || '').trim() || 'Camera ' + (index + 1); }
export function savedCameraDeviceId() {
    try {
        return localStorage.getItem(CAMERA_DEVICE_STORAGE_KEY) || '';
    }
    catch (error) {
        return '';
    }
}
export function rememberCameraDeviceId(deviceId) {
    try {
        if (deviceId)
            localStorage.setItem(CAMERA_DEVICE_STORAGE_KEY, deviceId);
        else
            localStorage.removeItem(CAMERA_DEVICE_STORAGE_KEY);
    }
    catch (error) { }
}
export function setCameraControlsDisabled(disabled) {
    if (cameraSourceSelect)
        cameraSourceSelect.disabled = !!disabled;
    if (cameraRefreshBtn)
        cameraRefreshBtn.disabled = !!disabled;
}
export function updateCameraSourceHint(activeDeviceId = '') {
    if (!cameraSourceHint || !cameraSourceSelect)
        return;
    const selectedId = cameraSourceSelect.value, shownId = selectedId || activeDeviceId, device = availableCameraDevices.find(candidate => candidate.deviceId === shownId);
    if (selectedId && unavailableCameraDeviceId === selectedId) {
        cameraSourceHint.textContent = 'The saved camera is unavailable. Choose another camera before starting.';
        return;
    }
    if (selectedId && device && cameraLabelsRevealed) {
        cameraSourceHint.textContent = 'Selected: ' + cameraOptionLabel(device, availableCameraDevices.indexOf(device)) + '. Occulert will remember this choice on this browser.';
        return;
    }
    if (selectedId && !cameraLabelsRevealed) {
        cameraSourceHint.textContent = 'Your saved camera will be verified when monitoring starts. Choose Find cameras to see its name.';
        return;
    }
    if (selectedId) {
        cameraSourceHint.textContent = 'The saved camera is unavailable. Choose another camera before starting.';
        return;
    }
    if (activeDeviceId && device && cameraLabelsRevealed) {
        cameraSourceHint.textContent = 'This browser is using ' + cameraOptionLabel(device, availableCameraDevices.indexOf(device)) + '. Stop monitoring before changing cameras.';
        return;
    }
    if (cameraLabelsRevealed) {
        cameraSourceHint.textContent = 'Choose your Mac camera to keep Safari from using your iPhone.';
        return;
    }
    cameraSourceHint.textContent = 'Choose Find cameras and allow access once to see the camera names.';
}
export async function refreshCameraChoices(activeDeviceId = '') {
    if (!cameraSourceRow || !cameraSourceSelect)
        return [];
    const mediaDevices = navigator.mediaDevices;
    if (isMobileCaptureDevice() || !mediaDevices || typeof mediaDevices.enumerateDevices !== 'function') {
        cameraSourceRow.hidden = true;
        return [];
    }
    cameraSourceRow.hidden = false;
    let devices = [];
    try {
        devices = (await mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
    }
    catch (error) {
        devices = [];
    }
    set_availableCameraDevices(devices);
    set_cameraLabelsRevealed(devices.some(device => String(device.label || '').trim()));
    const savedId = savedCameraDeviceId();
    cameraSourceSelect.replaceChildren();
    const automatic = document.createElement('option');
    automatic.value = '';
    automatic.textContent = 'Automatic (browser choice)';
    cameraSourceSelect.appendChild(automatic);
    if (cameraLabelsRevealed)
        devices.forEach((device, index) => {
            if (!device.deviceId)
                return;
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = cameraOptionLabel(device, index);
            cameraSourceSelect.appendChild(option);
        });
    if (savedId) {
        const savedDeviceAvailable = devices.some(device => device.deviceId === savedId);
        if (cameraLabelsRevealed && savedDeviceAvailable)
            set_unavailableCameraDeviceId('');
        else if (cameraLabelsRevealed)
            set_unavailableCameraDeviceId(savedId);
        if (!cameraLabelsRevealed || !savedDeviceAvailable) {
            const missing = document.createElement('option');
            missing.value = savedId;
            missing.textContent = unavailableCameraDeviceId === savedId ? 'Saved camera (unavailable)' : 'Saved camera (camera access required)';
            cameraSourceSelect.appendChild(missing);
        }
        cameraSourceSelect.value = savedId;
    }
    updateCameraSourceHint(activeDeviceId);
    return devices;
}
export async function findCameraChoices() {
    if (!startupAllowsMonitoring())
        return;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function')
        return;
    setCameraControlsDisabled(true);
    if (cameraSourceHint)
        cameraSourceHint.textContent = 'Safari may connect briefly while it reveals the camera names.';
    let probe = null;
    try {
        const devices = await refreshCameraChoices();
        if (!devices.some(device => String(device.label || '').trim()))
            probe = await navigator.mediaDevices.getUserMedia(buildCameraConstraints());
        await refreshCameraChoices();
    }
    catch (error) {
        const recovery = cameraRecoveryGuidance(error);
        if (cameraSourceHint)
            cameraSourceHint.textContent = recovery.title + ': ' + recovery.text;
    }
    finally {
        if (probe)
            probe.getTracks().forEach(track => track.stop());
        setCameraControlsDisabled(running || starting);
    }
}
export async function openSelectedCamera() {
    const mediaDevices = navigator.mediaDevices, isMobile = isMobileCaptureDevice(), selectedId = isMobile ? '' : (cameraSourceSelect && cameraSourceSelect.value || savedCameraDeviceId());
    try {
        const cameraStream = await mediaDevices.getUserMedia(buildCameraConstraints(selectedId));
        set_unavailableCameraDeviceId('');
        try {
            const track = cameraStream.getVideoTracks && cameraStream.getVideoTracks()[0], activeDeviceId = track && track.getSettings ? track.getSettings().deviceId || '' : '';
            await refreshCameraChoices(activeDeviceId);
        }
        catch (error) { }
        return cameraStream;
    }
    catch (error) {
        if (selectedId && error && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')) {
            set_unavailableCameraDeviceId(selectedId);
            try {
                await refreshCameraChoices();
            }
            catch (refreshError) { }
            throw cameraSelectionError(error);
        }
        throw error;
    }
}
export function clearCameraTrackGuards() {
    if (cameraMuteTimer !== null)
        clearTimeout(cameraMuteTimer);
    set_cameraMuteTimer(null);
    if (guardedCameraTrack) {
        guardedCameraTrack.removeEventListener('ended', handleCameraTrackEnded);
        guardedCameraTrack.removeEventListener('mute', handleCameraTrackMuted);
        guardedCameraTrack.removeEventListener('unmute', handleCameraTrackUnmuted);
    }
    set_guardedCameraTrack(null);
}
export function handleCameraTrackEnded() { void haltForCameraFailure(Object.assign(new Error('The camera disconnected.'), { name: 'CameraDisconnectedError' })); }
export function handleCameraTrackMuted() {
    if (cameraMuteTimer !== null)
        clearTimeout(cameraMuteTimer);
    set_cameraMuteTimer(setTimeout(() => {
        if (guardedCameraTrack && guardedCameraTrack.muted)
            void haltForCameraFailure(Object.assign(new Error('The camera paused.'), { name: 'CameraPausedError' }));
    }, 2500));
}
export function handleCameraTrackUnmuted() {
    if (cameraMuteTimer !== null)
        clearTimeout(cameraMuteTimer);
    set_cameraMuteTimer(null);
}
export function attachCameraTrackGuards(cameraStream) {
    clearCameraTrackGuards();
    const track = cameraStream && cameraStream.getVideoTracks && cameraStream.getVideoTracks()[0];
    if (!track || typeof track.addEventListener !== 'function')
        return;
    set_guardedCameraTrack(track);
    track.addEventListener('ended', handleCameraTrackEnded);
    track.addEventListener('mute', handleCameraTrackMuted);
    track.addEventListener('unmute', handleCameraTrackUnmuted);
    if (track.readyState === 'ended')
        handleCameraTrackEnded();
    else if (track.muted)
        handleCameraTrackMuted();
}
export function cameraRecoveryGuidance(error, nav = navigator) {
    const name = error && error.name || '';
    const userAgent = String(nav && nav.userAgent || '').toLowerCase();
    const platform = String(nav && nav.platform || '').toLowerCase();
    const touchPoints = Number(nav && nav.maxTouchPoints) || 0;
    const isIOS = /iphone|ipad|ipod/.test(userAgent) || (platform === 'macintel' && touchPoints > 1);
    const isAndroid = /android/.test(userAgent);
    const cameraText = 'Occulert needs the front camera to detect eye closure and fatigue.';
    if (name === 'CameraSelectionError')
        return { title: 'Selected Camera Unavailable', text: 'Occulert could not open the camera saved for this browser.', hint: 'Choose another camera above, then press Start Monitoring again while parked.' };
    if (name === 'CameraDisconnectedError')
        return { title: 'Camera Disconnected', text: 'Monitoring stopped because the selected camera disconnected.', hint: 'Reconnect the camera or choose another one, then restart only while parked.' };
    if (name === 'CameraPausedError')
        return { title: 'Camera Paused', text: 'Monitoring stopped because the selected camera stopped sending video.', hint: 'Resume or reconnect the camera, then restart only while parked.' };
    if (name === 'DetectionRuntimeError')
        return { title: 'AI Monitoring Unavailable', text: 'Occulert cannot run monitoring because the on-device detector failed or stopped responding.', hint: 'Pull over safely, check your connection, reload this page, and try again while parked. Monitoring remains off until the detector passes.' };
    if (name === 'NotAllowedError' || name === 'SecurityError') {
        if (isIOS)
            return { title: 'Camera Access Blocked', text: cameraText, hint: '<strong>On iPhone or iPad:</strong> open Safari\'s Page Menu, choose More, then Website Settings → Camera → Allow, and reload this page.' };
        if (isAndroid)
            return { title: 'Camera Access Blocked', text: cameraText, hint: '<strong>On Android Chrome:</strong> open the site information menu, choose Permissions → Camera → Allow, and reload this page.' };
        return { title: 'Camera Access Blocked', text: cameraText, hint: '<strong>Fix:</strong> open this site\'s browser permissions, allow camera access, and reload this page.' };
    }
    if (name === 'NotReadableError' || name === 'AbortError')
        return { title: 'Camera Is Busy', text: 'Occulert could not open the front camera.', hint: '<strong>Try:</strong> close any other app or browser tab using the camera, then reload this page.' };
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError')
        return { title: 'Front Camera Not Found', text: cameraText, hint: '<strong>Try:</strong> confirm the camera is enabled and available, then reload this page.' };
    return { title: 'Camera Could Not Start', text: cameraText, hint: '<strong>Try:</strong> use Safari or Chrome over HTTPS, confirm camera access, then reload this page.' };
}
export async function haltForCameraFailure(error) {
    if (cameraFailureStopping || !running)
        return;
    set_cameraFailureStopping(true);
    const recovery = cameraRecoveryGuidance(error);
    setOverlay(recovery.title, recovery.text, recovery.hint, false);
    startBtn.disabled = true;
    tone(660, 300, .22);
    speak('Camera monitoring stopped. Pull over safely before restarting.');
    log(recovery.title + ' - monitoring stopped');
    try {
        const stopPromise = stop({ preserveOverlay: true });
        if (stopPromise && typeof stopPromise.catch === 'function')
            stopPromise.catch(() => { });
        showStoppedReason('Camera monitoring stopped. Pull over safely before restarting.');
        await refreshCameraChoices();
    }
    finally {
        set_cameraFailureStopping(false);
        startBtn.disabled = false;
        setCameraControlsDisabled(false);
    }
}
