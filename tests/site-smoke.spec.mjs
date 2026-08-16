import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("important public pages load with one primary heading", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (const path of ["/", "/features.html", "/how-it-works.html", "/install.html", "/pilot-signup.html", "/fleet-dashboard.html", "/fleet-onboarding.html", "/accept-invite.html", "/session-history.html", "/privacy.html", "/safety.html"]) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.ok(), `${path} should load`).toBeTruthy();
    expect(await page.locator("h1").count(), `${path} should have one h1`).toBe(1);
    expect(await page.locator('link[rel="canonical"]').count(), `${path} should have a canonical URL`).toBe(1);
  }

  expect(pageErrors).toEqual([]);
});

test("homepage external assets preserve theme and mobile navigation controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  expect(await page.locator('link[href="/homepage.css?v=31"]').count()).toBe(1);
  expect(await page.locator('link[rel="preload"][href="/homepage-journey-cinematic-v1.jpg"]').count()).toBe(1);
  expect(await page.locator('link[href="/homepage.css"]').count()).toBe(0);
  expect(await page.locator('script[src="/homepage.js"]').count()).toBe(1);
  await expect(page.locator("body")).toHaveCSS("font-family", /Inter/);
  await expect(page.locator("#safetyJourney")).toBeVisible();
  expect(await page.locator(".phone-wrap").count()).toBe(0);
  expect(await page.locator(".car-shell").count()).toBe(0);
  expect(await page.locator(".journey-frame").count()).toBe(4);
  await expect(page.locator("#safetyJourney")).toHaveAttribute("data-stage", "0");
  await page.locator("#journeyMotion").click();
  await expect(page.locator("#journeyMotion")).toHaveText("Play motion");
  await expect(page.locator("#journeyMotion")).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-journey-step="3"]').click();
  await expect(page.locator("#safetyJourney")).toHaveAttribute("data-stage", "3");
  await expect(page.locator("#journeyStep3")).toContainText("An alert creates time to act");
  await expect(page.locator(".safe-stop")).toHaveCSS("opacity", "1");
  await expect(page.locator(".journey-frame-alert")).toHaveCSS("opacity", "1");
  await expect(page.locator(".journey-frame-enter")).toHaveCSS("opacity", "0");
  await expect(page.locator(".journey-scene")).toHaveCSS("overflow", "hidden");
  expect(await page.locator(".journey-copy").evaluate((element) => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(0);

  await page.evaluate(() => { document.documentElement.style.scrollBehavior = "auto"; window.scrollTo(0, 700); });
  await expect(page.locator("#siteNav")).toHaveClass(/nav-hidden/);
  expect(await page.locator("#siteNav").evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
  await expect(page.locator("#scrollTop")).not.toHaveClass(/visible/);
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect(page.locator("#siteNav")).not.toHaveClass(/nav-hidden/);

  const initialTheme = await page.locator("html").getAttribute("data-theme");
  await page.locator("#themeToggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", initialTheme === "light" ? "dark" : "light");

  await page.locator("#menuBtn").click();
  await expect(page.locator("#mobileMenu")).toHaveClass(/open/);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await page.locator(".disclaimer > .disclaimer-content").count()).toBe(1);
  expect(await page.locator(".disclaimer > .driver-groups").count()).toBe(1);
  await expect(page.locator(".disclaimer")).toHaveCSS("display", "grid");
  await expect(page.locator(".driver-groups-grid")).toHaveCSS("display", "grid");
  expect(await page.locator(".driver-groups-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator(".disclaimer")).toHaveCSS("display", "flex");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
});

test("forgot password stays on the login surface and opens reset mode", async ({ page }) => {
  await page.goto("/login.html", { waitUntil: "domcontentloaded" });
  await page.locator("#forgotPasswordBtn").click();

  await expect(page).toHaveURL(/\/login\.html\?mode=reset$/);
  await expect(page.locator("#authHeading")).toHaveText("Reset your password");
  await expect(page.locator("#passwordField")).toHaveClass(/hidden/);
  await expect(page.locator("#backToSignInBtn")).toHaveAttribute("href", "/login.html");
});

test("recovery links that land on the homepage hand off to Account Setup", async ({ page }) => {
  await page.goto("/#access_token=fake-token&refresh_token=fake-refresh&type=recovery&expires_in=3600", { waitUntil: "domcontentloaded" });

  await expect.poll(() => new URL(page.url()).pathname).toBe("/account.html");
  expect(new URL(page.url()).searchParams.get("recovery")).toBe("1");
});

test("passkey failures remain visible beside the passkey button", async ({ page }) => {
  await page.goto("/login.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.OcculertPasskeys = {
      ...window.OcculertPasskeys,
      isSupported: () => true,
      message: () => "No new Occulert passkey is enrolled. Sign in normally and add one from Account Setup.",
    };
    window.OcculertAuth.signInPasskey = async () => { throw new Error("not enrolled"); };
    initPasskeySignIn();
  });

  await page.locator("#passkeySignInBtn").click();
  await expect(page.locator("#passkeyStatus")).toBeVisible();
  await expect(page.locator("#passkeyStatus")).toContainText("No new Occulert passkey is enrolled");
  expect(await page.locator("#passkeyStatus").evaluate((element) => Boolean(element.compareDocumentPosition(document.querySelector("#authForm")) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
});

test("the passkey SDK loads through the resilient pinned loader", async ({ page }) => {
  await page.goto("/login.html", { waitUntil: "domcontentloaded" });

  await expect.poll(() => page.evaluate(() => window.OcculertSupabaseLoader?.state().ready)).toBe(true);
  expect(await page.evaluate(() => window.OcculertSupabaseLoader.sources[0])).toBe("/vendor/supabase-2.112.3.min.js");
  expect(await page.evaluate(() => typeof window.supabase?.createClient)).toBe("function");
  const sdkResources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.includes("supabase")));
  expect(sdkResources.some((name) => new URL(name).pathname === "/vendor/supabase-2.112.3.min.js")).toBe(true);
  expect(sdkResources.some((name) => name.startsWith("https://cdn.jsdelivr.net/"))).toBe(false);
});

test("signed-out mobile fleet dashboard keeps navigation and recovery actions visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/fleet-dashboard.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#cloudStatus")).toContainText("Not signed in");
  await expect(page.locator('.actions[aria-label="Fleet navigation"]')).toBeVisible();
  await expect(page.locator('.actions[aria-label="Fleet navigation"] a', { hasText: "Home" })).toBeVisible();
  await expect(page.locator('.actions[aria-label="Fleet navigation"] a', { hasText: "Sign In" })).toBeVisible();
  await expect(page.locator("#signedOutActions")).toBeVisible();
  await expect(page.locator("#signedOutActions")).toContainText("Back home");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("driver app external stylesheet preserves layout without moving monitoring scripts", async ({ page }) => {
  await page.goto("/app.html", { waitUntil: "domcontentloaded" });

  expect(await page.locator('link[href="/driver-app.css"]').count()).toBe(1);
  expect(await page.locator("script:not([src])").count()).toBe(2);
  await expect(page.locator("body")).toHaveCSS("font-family", /Inter/);
  await expect(page.locator(".top")).toHaveCSS("min-height", "74px");
  await expect(page.locator(".app")).toHaveCSS("display", "grid");
});

test("camera permission recovery is platform specific and actionable", async ({ page }) => {
  await page.goto("/app.html", { waitUntil: "domcontentloaded" });

  const guidance = await page.evaluate(() => ({
    ios: cameraRecoveryGuidance(
      { name: "NotAllowedError" },
      { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 },
    ),
    android: cameraRecoveryGuidance(
      { name: "NotAllowedError" },
      { userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)", platform: "Linux armv8l", maxTouchPoints: 5 },
    ),
    busy: cameraRecoveryGuidance(
      { name: "NotReadableError" },
      { userAgent: "Mozilla/5.0", platform: "MacIntel", maxTouchPoints: 0 },
    ),
  }));

  expect(guidance.ios.title).toBe("Camera Access Blocked");
  expect(guidance.ios.hint).toContain("Page Menu");
  expect(guidance.ios.hint).toContain("Website Settings → Camera → Allow");
  expect(guidance.android.title).toBe("Camera Access Blocked");
  expect(guidance.android.hint).toContain("Permissions → Camera → Allow");
  expect(guidance.busy.title).toBe("Camera Is Busy");
  expect(guidance.busy.hint).toContain("other app or browser tab");
});

test("driver alerts enhance only successful triggers and sensitivity is unambiguous", async ({ page }) => {
  await page.goto("/app.html", { waitUntil: "domcontentloaded" });
  expect(await page.locator('[data-sensitivity="low"]').count()).toBe(1);
  expect(await page.locator('[data-sensitivity="medium"]').count()).toBe(1);
  expect(await page.locator('[data-sensitivity="high"]').count()).toBe(1);
  expect(await page.locator('input[oninput*="setSensitivity"]').count()).toBe(0);

  await page.evaluate(() => demoAlert());
  await expect(page.locator("#alerts")).toHaveText("1");
  const firstAlertLogs = await page.evaluate(() => _sessionLog.filter((entry) => entry.type === "alert").length);
  expect(firstAlertLogs).toBe(1);

  await page.evaluate(() => trigger("Cooldown check"));
  await expect(page.locator("#alerts")).toHaveText("1");
  const cooldownAlertLogs = await page.evaluate(() => _sessionLog.filter((entry) => entry.type === "alert").length);
  expect(cooldownAlertLogs).toBe(1);

  await page.locator('[data-sensitivity="high"]').click();
  expect(await page.evaluate(() => localStorage.getItem("occulert-sensitivity"))).toBe("high");
  expect(await page.evaluate(() => eyeClosedThreshold)).toBeCloseTo(0.21, 5);
});

test("driver monitoring stops instead of appearing active after foreground loss", async ({ page }) => {
  await page.goto("/app.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    running = true;
    sessionStart = Date.now();
    await handleVisibilityChange(true);
  });
  expect(await page.evaluate(() => running)).toBe(false);
  await expect(page.locator("#overlayText")).toContainText("Supplemental prototype only");
  await expect(page.locator("#overlayHint")).toContainText("Foreground required");
});

test("opted-in driver sessions use authenticated cloud APIs without sending GPS by default", async ({ page }) => {
  const apiCalls = [];
  await page.addInitScript(() => {
    localStorage.setItem("occulert-auth", JSON.stringify({
      access_token: "test-access-token",
      refresh_token: "test-refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "user-1", email: "driver@example.com" },
    }));
  });
  await page.route("**/api/public-config", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, supabase: { configured: true, url: "https://example.supabase.co", anonKey: "public-test-key" } }),
  }));
  await page.route("**/api/sessions", async (route) => {
    const request = route.request();
    apiCalls.push({ method: request.method(), headers: request.headers(), body: request.postDataJSON() });
    const session = request.method() === "POST" ? { id: "session-1" } : { id: "session-1", ended_at: new Date().toISOString() };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, session }) });
  });
  await page.route("**/api/events", async (route) => {
    const request = route.request();
    apiCalls.push({ method: request.method(), headers: request.headers(), body: request.postDataJSON() });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, event: { id: "event-1" } }) });
  });

  await page.goto("/app.html", { waitUntil: "domcontentloaded" });
  await page.locator("#cloudConsent").check();
  await page.evaluate(() => initCloud());
  await expect(page.locator("#sync")).toHaveText("ON");
  await page.evaluate(async () => {
    backendSessionPromise = beginBackendSession();
    await backendSessionPromise;
    queueBackendEvent("drowsy");
    await finishBackendSession({ avgFatigue: 25, maxFatigue: 60, safetyScore: 72, alerts: 1, headNods: 0 });
  });

  expect(apiCalls.map((call) => call.method)).toEqual(["POST", "POST", "PATCH"]);
  expect(apiCalls.every((call) => call.headers.authorization === "Bearer test-access-token")).toBe(true);
  expect(apiCalls[1].body.type).toBe("drowsy");
  expect(apiCalls[1].body.latitude).toBeUndefined();
  expect(apiCalls[1].body.longitude).toBeUndefined();
});

test("pilot request controls use an accessible form", async ({ page }) => {
  const response = await page.goto("/pilot-signup.html", { waitUntil: "domcontentloaded" });
  expect(response?.headers()["content-security-policy"]).toContain("default-src 'self'");
  expect(await page.locator("form#pilotForm").count()).toBe(1);
  await expect(page.getByLabel("Name")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Company")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Email")).toHaveAttribute("required", "");
});

test("driver invitation tokens leave the URL immediately and stay in session storage", async ({ page }) => {
  const token = "a".repeat(43);
  await page.goto(`/accept-invite.html#token=${token}`, { waitUntil: "domcontentloaded" });
  expect(page.url()).toMatch(/\/accept-invite\.html$/);
  expect(await page.evaluate(() => sessionStorage.getItem("occulert-invite-token"))).toBe(token);
  expect(await page.evaluate(() => localStorage.getItem("occulert-invite-token"))).toBeNull();
});

test("verified fleet managers can create a server-owned fleet from onboarding", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("occulert-auth", JSON.stringify({
      access_token: "manager-token",
      refresh_token: "manager-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "manager-1", email: "manager@example.com" },
    }));
  });
  await page.route("**/api/fleets", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "fleet_not_found" }) });
      return;
    }
    expect(request.headers().authorization).toBe("Bearer manager-token");
    expect(request.postDataJSON()).toEqual({ company_name: "Safe Transit" });
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, fleet: { id: "fleet-1", company_name: "Safe Transit", plan: "trial" } }) });
  });
  await page.route("**/api/fleet-invitations", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, invitations: [] }),
  }));

  await page.goto("/fleet-onboarding.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#createCard")).toBeVisible();
  await page.locator("#companyName").fill("Safe Transit");
  await page.getByRole("button", { name: "Create Fleet" }).click();
  await expect(page.locator("#fleetName")).toHaveText("Invite drivers to Safe Transit");
  await expect(page.locator("#inviteCard")).toBeVisible();
});

test("fleet managers can email invitations and replace pending one-time links", async ({ page }) => {
  const invitationPosts = [];
  await page.addInitScript(() => {
    localStorage.setItem("occulert-auth", JSON.stringify({
      access_token: "manager-token",
      refresh_token: "manager-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "manager-1", email: "manager@example.com" },
    }));
  });
  await page.route("**/api/fleets", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, fleet: { id: "fleet-1", company_name: "Safe Transit", plan: "trial" } }),
  }));
  await page.route("**/api/fleet-invitations", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          invitations: [{
            id: "11111111-1111-4111-8111-111111111111",
            email: "pending@example.com",
            created_at: new Date(Date.now() - 120000).toISOString(),
            expires_at: new Date(Date.now() + 86400000).toISOString(),
            accepted_at: null,
            revoked_at: null,
          }],
        }),
      });
      return;
    }
    const body = request.postDataJSON();
    invitationPosts.push(body);
    const renewed = Boolean(body.replace_invitation_id);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        invitation: {
          id: renewed ? "22222222-2222-4222-8222-222222222222" : "33333333-3333-4333-8333-333333333333",
          email: renewed ? "pending@example.com" : body.email,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          accept_path: `/accept-invite.html#token=${renewed ? "renewed-token" : "new-token"}`,
        },
      }),
    });
  });

  await page.goto("/fleet-onboarding.html", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Send New Link" })).toBeVisible();
  await page.getByRole("button", { name: "Send New Link" }).click();
  await expect(page.locator("#inviteStatus")).toContainText("Choose Email Link or Copy Link");
  await expect(page.locator("#inviteLink")).toHaveValue(/renewed-token$/);
  await expect(page.locator("#emailInvite")).toHaveAttribute("href", /^mailto:pending%40example\.com/);
  expect(invitationPosts[0]).toEqual({ replace_invitation_id: "11111111-1111-4111-8111-111111111111" });

  await page.locator("#driverEmail").fill("new-driver@example.com");
  await page.getByRole("button", { name: "Send Invite" }).click();
  await expect(page.locator("#inviteStatus")).toContainText("Choose Email Link or Copy Link");
  await expect(page.locator("#inviteLink")).toHaveValue(/new-token$/);
  await expect(page.locator("#emailInvite")).toHaveAttribute("href", /^mailto:new-driver%40example\.com/);
  expect(invitationPosts[1]).toEqual({ email: "new-driver@example.com" });
});

test("authenticated fleet dashboards never fall back to unrelated local driver data", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("occulert-auth", JSON.stringify({
      access_token: "manager-token",
      refresh_token: "manager-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "manager-1", email: "manager@example.com" },
    }));
    localStorage.setItem("occulert-live-session", JSON.stringify({
      name: "Unrelated Local Driver",
      driverId: "local-driver",
      status: "ALERT",
      alerts: 99,
      lastUpdate: new Date().toISOString(),
    }));
  });
  await page.route("**/api/fleet-summary", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      fleet: { id: "fleet-1", company_name: "Safe Transit", plan: "trial" },
      drivers: [],
      sessions: [],
    }),
  }));

  await page.goto("/fleet-dashboard.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#cloudStatus")).toContainText("Protected connection active");
  await expect(page.locator("#kpiDrivers")).toHaveText("0");
  await expect(page.getByText("Unrelated Local Driver")).toHaveCount(0);
});

test("fleet dashboard does not turn missing or inactive telemetry into active safety scores", async ({ page }) => {
  const now = new Date().toISOString();
  await page.addInitScript(() => {
    localStorage.setItem("occulert-auth", JSON.stringify({
      access_token: "manager-token",
      refresh_token: "manager-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "manager-1", email: "manager@example.com" },
    }));
  });
  await page.route("**/api/fleet-summary", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      fleet: { id: "fleet-1", company_name: "Safe Transit", plan: "trial" },
      drivers: [
        { id: "driver-no-session", name: "No Session", active: true, vehicle_id: "Van 1" },
        { id: "driver-inactive", name: "Inactive Driver", active: false, vehicle_id: "Van 2" },
        { id: "driver-measured", name: "Measured Driver", active: true, vehicle_id: "Van 3" },
      ],
      sessions: [
        { id: "session-inactive", driver_id: "driver-inactive", started_at: now, ended_at: now, safety_score: 91 },
        { id: "session-measured", driver_id: "driver-measured", started_at: now, ended_at: null, safety_score: 64, max_fatigue: 58, alert_count: 1 },
      ],
      events: [],
      telemetry_trust: "unverified_client_report",
      privacy: { includes_location: false, includes_personal_media: false, includes_raw_motion: false },
    }),
  }));

  await page.goto("/fleet-dashboard.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#cloudStatus")).toContainText("Protected connection active");
  await expect(page.locator("#kpiDrivers")).toHaveText("2");
  await expect(page.locator("#kpiDriversSub")).toHaveText("1 live");
  await expect(page.locator("#kpiScore")).toHaveText("64");
  await expect(page.locator("#kpiScoreSub")).toHaveText("1 below 70");

  const noSession = page.locator(".driver").filter({ hasText: "No Session" });
  await expect(noSession).toContainText("NO DATA");
  await expect(noSession).toContainText("No recorded session metrics");
  await expect(noSession).toContainText("--");

  const inactive = page.locator(".driver").filter({ hasText: "Inactive Driver" });
  await expect(inactive).toContainText("INACTIVE");
  await expect(page.locator("#coverageSummary")).toContainText("GPS data");
  await expect(page.locator("#coverageSummary")).toContainText("Excluded");
  await expect(page.locator("#map")).toContainText("GPS is not included");
  await expect(page.locator('#riskFilter option[value="gps"]')).toBeDisabled();
  await expect(page.locator('#riskFilter option[value="nogps"]')).toBeDisabled();
});

test("protected fleet history shows scoped events and exports formula-safe rows without coordinates", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("occulert-auth", JSON.stringify({
      access_token: "manager-token",
      refresh_token: "manager-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "manager-1", email: "manager@example.com" },
    }));
    localStorage.setItem("occulert-session-history", JSON.stringify([{
      id: "local-session",
      name: "Unrelated Local History",
      safetyScore: 1,
    }]));
  });
  await page.route("**/api/fleet-summary", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      fleet: { id: "fleet-1", company_name: "Safe Transit", plan: "trial" },
      drivers: [{ id: "driver-1", name: "Alex Driver", active: true, vehicle_id: "Van 12" }],
      sessions: [{
        id: "11111111-1111-4111-8111-111111111111",
        driver_id: "driver-1",
        started_at: "2026-08-01T16:00:00.000Z",
        ended_at: "2026-08-01T16:30:00.000Z",
        average_fatigue: 24,
        max_fatigue: 61,
        safety_score: 76,
        alert_count: 1,
        head_nod_count: 2,
        device: '=WEBSERVICE("https://example.invalid")',
      }],
      events: [{
        id: "event-1",
        session_id: "11111111-1111-4111-8111-111111111111",
        type: "drowsy",
        fatigue_score: 61,
        confidence: 88,
        created_at: "2026-08-01T16:12:00.000Z",
        latitude: 37.7749,
        longitude: -122.4194,
      }],
      telemetry_trust: "unverified_client_report",
      privacy: { includes_location: false, includes_personal_media: false, includes_raw_motion: false },
    }),
  }));

  await page.goto("/fleet-dashboard.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#cloudStatus")).toContainText("Protected connection active");
  await expect(page.locator("#sessionHistory")).toContainText("Alex Driver");
  await expect(page.locator("#sessionHistory")).toContainText("drowsy");
  await expect(page.locator("#sessionHistory")).toContainText("Client-reported telemetry");
  await expect(page.getByText("Unrelated Local History")).toHaveCount(0);
  await expect(page.locator("#sessionHistory")).not.toContainText("37.7749");
  await expect(page.locator("#sessionHistory")).not.toContainText("-122.4194");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Session CSV" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const csv = await readFile(downloadPath, "utf8");
  expect(csv).toContain("Alex Driver");
  expect(csv).toContain("'=WEBSERVICE");
  expect(csv).not.toMatch(/latitude|longitude|37\.7749|-122\.4194/i);
});
