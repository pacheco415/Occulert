import { test, expect } from "@playwright/test";

test("the pinned detector produces a real result under the production policy", async ({ page }) => {
  test.setTimeout(120_000);
  const diagnostics = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      diagnostics.push(`console ${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.stack || error.message}`));
  page.on("requestfailed", (request) => {
    diagnostics.push(`requestfailed: ${request.url()} ${request.failure()?.errorText || "unknown"}`);
  });

  await page.goto("/app.html", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    await initModel();
    const image = document.createElement("canvas");
    image.width = 640;
    image.height = 480;
    const context = image.getContext("2d");
    context.fillStyle = "#ddd";
    context.fillRect(0, 0, image.width, image.height);
    const before = detectionResultGeneration;
    await sendFaceMeshFrame(image, 60_000);
    await waitForDetectionResult(before, 60_000);
    const snapshot = {
      generation: detectionResultGeneration,
      lastResultAt: lastDetectionResultAt,
    };
    await discardFaceMesh(5_000);
    return snapshot;
  }).catch((error) => {
    throw new Error(`${error.stack || error.message}\nDIAGNOSTICS\n${diagnostics.join("\n")}`);
  });

  expect(result.generation).toBeGreaterThan(0);
  expect(result.lastResultAt).toBeGreaterThan(0);
});
