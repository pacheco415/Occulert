import { test, expect } from "@playwright/test";
import { observePageLoads } from "./helpers/page-load-diagnostics.mjs";

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.pageLoadDiagnostics = await observePageLoads(page);
});
test.afterEach(async ({}, testInfo) => {
  const diagnostics = testInfo.pageLoadDiagnostics;
  try {
    if (testInfo.status !== testInfo.expectedStatus) await diagnostics?.attach(testInfo);
  } finally { diagnostics?.stop(); }
});

function installCameraFixture({ mobile = false, ipadDesktop = false, savedDeviceId = "", failSelected = false, labelsInitiallyHidden = false } = {}) {
  window.__cameraDevices = [
    { kind: "videoinput", deviceId: "iphone-camera", label: "Rich's iPhone Camera" },
    { kind: "videoinput", deviceId: "mac-camera", label: "FaceTime HD Camera" },
  ];
  window.__cameraLabelsRevealed = !labelsInitiallyHidden;
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: mobile ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" : "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)",
  });
  Object.defineProperty(navigator, "platform", { configurable: true, value: mobile ? "iPhone" : "MacIntel" });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: mobile || ipadDesktop ? 5 : 0 });
  if (savedDeviceId) localStorage.setItem("occulert-camera-device-id", savedDeviceId);
  window.__cameraCalls = [];
  window.__cameraTrackStops = 0;
  window.__cameraTrack = new EventTarget();
  window.__cameraTrack.muted = false;
  window.__cameraTrack.readyState = "live";
  window.__cameraTrack.stop = () => {
    window.__cameraTrackStops += 1;
    window.__cameraTrack.readyState = "ended";
  };
  window.__cameraTrack.getSettings = () => ({ deviceId: "mac-camera" });
  window.__cameraStream = {
    getTracks: () => [window.__cameraTrack],
    getVideoTracks: () => [window.__cameraTrack],
  };
  const mediaDevices = new EventTarget();
  mediaDevices.enumerateDevices = async () => window.__cameraDevices.map((device) => ({
    ...device,
    label: window.__cameraLabelsRevealed ? device.label : "",
  }));
  mediaDevices.getUserMedia = async (constraints) => {
    window.__cameraCalls.push(constraints);
    if (failSelected && constraints.video.deviceId) {
      throw Object.assign(new Error("missing"), { name: "NotFoundError" });
    }
    window.__cameraLabelsRevealed = true;
    return window.__cameraStream;
  };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: mediaDevices,
  });
}

test("desktop users can choose and remember the Mac camera", async ({ page }) => {
  await page.addInitScript(installCameraFixture, {});
  await page.goto("/app.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#cameraSourceRow")).toBeVisible();
  await expect(page.locator("#cameraSourceSelect option")).toHaveCount(3);
  await expect(page.locator("#cameraSourceHint")).toHaveAttribute("aria-live", "polite");
  await page.locator("#cameraSourceSelect").selectOption("mac-camera");
  expect(await page.evaluate(() => localStorage.getItem("occulert-camera-device-id"))).toBe("mac-camera");

  const request = await page.evaluate(async () => {
    await openSelectedCamera();
    return window.__cameraCalls.at(-1);
  });
  expect(request.video.deviceId).toEqual({ exact: "mac-camera" });
  expect(request.video.facingMode).toBeUndefined();
  await expect(page.locator("#cameraSourceHint")).toContainText("FaceTime HD Camera");
});

test("automatic desktop camera choice remains available", async ({ page }) => {
  await page.addInitScript(installCameraFixture, {});
  await page.goto("/app.html", { waitUntil: "domcontentloaded" });

  const request = await page.evaluate(async () => {
    await openSelectedCamera();
    return window.__cameraCalls.at(-1);
  });
  expect(request.video.deviceId).toBeUndefined();
  expect(request.video.facingMode).toBe("user");
  expect(await page.evaluate(() => localStorage.getItem("occulert-camera-device-id"))).toBeNull();
});

test("mobile keeps the front-camera request and ignores a desktop preference", async ({ page }) => {
  await page.addInitScript(installCameraFixture, { mobile: true, savedDeviceId: "mac-camera" });
  await page.goto("/app.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#cameraSourceRow")).toBeHidden();
  const request = await page.evaluate(async () => {
    await openSelectedCamera();
    return window.__cameraCalls.at(-1);
  });
  expect(request.video.deviceId).toBeUndefined();
  expect(request.video.facingMode).toBe("user");
});

test("iPad desktop mode keeps the mobile front-camera path", async ({ page }) => {
  await page.addInitScript(installCameraFixture, { ipadDesktop: true, savedDeviceId: "mac-camera" });
  await page.goto("/app.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#cameraSourceRow")).toBeHidden();
  const request = await page.evaluate(async () => {
    await openSelectedCamera();
    return window.__cameraCalls.at(-1);
  });
  expect(request.video.deviceId).toBeUndefined();
  expect(request.video.facingMode).toBe("user");
});

test("hidden Safari labels are revealed before cameras become selectable", async ({ page }) => {
  await page.addInitScript(installCameraFixture, { labelsInitiallyHidden: true, savedDeviceId: "mac-camera" });
  await page.goto("/app.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#cameraSourceSelect option")).toHaveCount(2);
  await expect(page.locator("#cameraSourceSelect option").nth(1)).toHaveText("Saved camera (camera access required)");
  await expect(page.locator("#cameraSourceHint")).not.toContainText("unavailable");
  await page.locator("#cameraRefreshBtn").click();
  await expect(page.locator("#cameraSourceSelect option")).toHaveCount(3);
  await expect(page.locator("#cameraSourceSelect option")).toContainText(["Automatic (browser choice)", "Rich's iPhone Camera", "FaceTime HD Camera"]);
  expect(await page.evaluate(() => window.__cameraTrackStops)).toBe(1);
});

test("device changes refresh the desktop camera list", async ({ page }) => {
  await page.addInitScript(installCameraFixture, {});
  await page.goto("/app.html", { waitUntil: "domcontentloaded" });

  await page.evaluate(() => {
    window.__cameraDevices.push({ kind: "videoinput", deviceId: "usb-camera", label: "USB Camera" });
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
  });
  await expect(page.locator("#cameraSourceSelect option")).toHaveCount(4);
  await expect(page.locator("#cameraSourceSelect option").last()).toHaveText("USB Camera");
});

test("a missing saved camera never silently falls back to the iPhone", async ({ page }) => {
  await page.addInitScript(installCameraFixture, { savedDeviceId: "missing-camera", failSelected: true });
  await page.goto("/app.html", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    try {
      await openSelectedCamera();
      return { name: "", calls: window.__cameraCalls.length };
    } catch (error) {
      return { name: error.name, calls: window.__cameraCalls.length };
    }
  });
  expect(result).toEqual({ name: "CameraSelectionError", calls: 1 });
  await expect(page.locator("#cameraSourceSelect")).toHaveValue("missing-camera");
  await expect(page.locator("#cameraSourceHint")).toContainText("unavailable");
});

test("a disconnected camera stops locally even when cloud finalization stalls", async ({ page }) => {
  await page.addInitScript(installCameraFixture, {});
  await page.goto("/app.html", { waitUntil: "domcontentloaded" });

  await page.evaluate(() => {
    cloudConsent.checked = true;
    cloudReady = false;
    backendSessionPromise = new Promise(() => {});
    backendSessionId = null;
    backendEventQueue = Promise.resolve();
    stream = window.__cameraStream;
    running = true;
    attachCameraTrackGuards(window.__cameraStream);
    window.__cameraTrack.dispatchEvent(new Event("ended"));
  });
  await expect.poll(() => page.evaluate(() => running)).toBe(false);
  await expect.poll(() => page.evaluate(() => cameraFailureStopping)).toBe(false);
  expect(await page.evaluate(() => window.__cameraTrackStops)).toBeGreaterThan(0);
  await expect(page.locator("#startBtn")).toBeEnabled();
  await expect(page.locator("#overlayTitle")).toHaveText("Camera Disconnected");
  await expect(page.locator("#overlayHint")).toContainText("restart only while parked");
});

test("a track that already ended is caught when guards attach", async ({ page }) => {
  await page.addInitScript(installCameraFixture, {});
  await page.goto("/app.html", { waitUntil: "domcontentloaded" });

  await page.evaluate(() => {
    window.__guardFailure = "";
    haltForCameraFailure = async (error) => { window.__guardFailure = error.name; };
    running = true;
    window.__cameraTrack.readyState = "ended";
    attachCameraTrackGuards(window.__cameraStream);
  });
  await expect.poll(() => page.evaluate(() => window.__guardFailure)).toBe("CameraDisconnectedError");
});

test("camera mute recovery debounces a brief pause and catches a sustained pause", async ({ page }) => {
  await page.addInitScript(installCameraFixture, {});
  await page.goto("/app.html", { waitUntil: "domcontentloaded" });

  await page.evaluate(() => {
    window.__guardFailure = "";
    haltForCameraFailure = async (error) => { window.__guardFailure = error.name; };
    running = true;
    window.__cameraTrack.muted = true;
    attachCameraTrackGuards(window.__cameraStream);
    setTimeout(() => {
      window.__cameraTrack.muted = false;
      window.__cameraTrack.dispatchEvent(new Event("unmute"));
    }, 50);
  });
  await page.waitForTimeout(2700);
  expect(await page.evaluate(() => window.__guardFailure)).toBe("");

  await page.evaluate(() => {
    window.__cameraTrack.muted = true;
    attachCameraTrackGuards(window.__cameraStream);
  });
  await expect.poll(() => page.evaluate(() => window.__guardFailure), { timeout: 4000 }).toBe("CameraPausedError");
});


test("completed local browser history survives reopening the app", async ({ page }) => {
  await page.addInitScript(installCameraFixture, {});
  await page.goto("/app.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    for (const count of [2, 3]) {
      running = true;
      sessionStart = Date.now() - 10_000;
      localSessionId = createLocalDriverId();
      alerts = count;
      maxFatigue = count * 10;
      await stop();
    }
  });
  const before = await page.evaluate(() => ({
    history: JSON.parse(localStorage.getItem('occulert-session-history')),
    latest: localStorage.getItem('occulert-live-session'),
  }));
  expect(before.history).toHaveLength(2);
  expect(before.history.map(record => record.alerts)).toEqual([3, 2]);
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => localStorage.getItem('occulert-live-session'))).toBe(before.latest);
  await page.goto("/session-history.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator('#sessions')).toHaveText('2');
  await expect(page.locator('#alerts')).toHaveText('5');
});

test("late screen wake lock is released after monitoring leaves the foreground", async ({ page }) => {
  await page.addInitScript(installCameraFixture, {});
  await page.goto("/app.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
      request: () => new Promise(resolve => { window.__resolveWakeLock = resolve; }),
    } });
    initModel = async () => {};
    openSelectedCamera = async () => new MediaStream();
    video.play = async () => {};
    verifyFirstInference = async () => {};
    window.__gpsStarts = 0;
    startGPS = () => { window.__gpsStarts += 1; };
    await start();
  });
  expect(await page.evaluate(() => ({ running, starting, gpsStarts: window.__gpsStarts })))
    .toEqual({ running: true, starting: false, gpsStarts: 1 });
  await page.evaluate(async () => {
    await handleVisibilityChange(true);
    window.__resolveWakeLock({ release: async () => { window.__wakeReleased = true; } });
  });
  await expect.poll(() => page.evaluate(() => window.__wakeReleased)).toBe(true);
  expect(await page.evaluate(() => ({ running, holdsLock: !!wakeLock, gpsStarts: window.__gpsStarts })))
    .toEqual({ running: false, holdsLock: false, gpsStarts: 1 });
  await expect(page.locator('#startBtn')).toHaveText('START MONITORING');
});
