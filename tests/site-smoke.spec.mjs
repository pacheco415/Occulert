import { test, expect } from "@playwright/test";

test("important public pages load with one primary heading", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (const path of ["/", "/features.html", "/how-it-works.html", "/install.html", "/pilot-signup.html", "/fleet-dashboard.html", "/session-history.html", "/privacy.html", "/safety.html"]) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.ok(), `${path} should load`).toBeTruthy();
    expect(await page.locator("h1").count(), `${path} should have one h1`).toBe(1);
    expect(await page.locator('link[rel="canonical"]').count(), `${path} should have a canonical URL`).toBe(1);
  }

  expect(pageErrors).toEqual([]);
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
