import { test, expect } from "@playwright/test";

test("important public pages load with one primary heading", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  for (const path of ["/", "/features.html", "/how-it-works.html", "/install.html", "/pilot-signup.html", "/fleet-dashboard.html", "/session-history.html", "/privacy.html", "/safety.html"]) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.ok(), `${path} should load`).toBeTruthy();
    expect(await page.locator("h1").count(), `${path} should have one h1`).toBe(1);
    expect(await page.locator('link[rel="canonical"]').count(), `${path} should have a canonical URL`).toBe(1);
  }

  expect(errors).toEqual([]);
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

test("pilot request controls use an accessible form", async ({ page }) => {
  const response = await page.goto("/pilot-signup.html", { waitUntil: "domcontentloaded" });
  expect(response?.headers()["content-security-policy"]).toContain("default-src 'self'");
  expect(await page.locator("form#pilotForm").count()).toBe(1);
  await expect(page.getByLabel("Name")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Company")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Email")).toHaveAttribute("required", "");
});
