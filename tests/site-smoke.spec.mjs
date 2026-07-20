import { test, expect } from "@playwright/test";

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
