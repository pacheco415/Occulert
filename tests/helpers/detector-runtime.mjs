export async function prepareDetectorPage(page, scalar = false) {
  await page.addInitScript(forceScalar => {
    window.detectorCspViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      window.detectorCspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
    if (forceScalar) {
      // Reject only MediaPipe's pinned 29-byte SIMD feature probe. Keep the
      // real scalar WebAssembly module and the driver's startup check intact.
      const instantiate = WebAssembly.instantiate.bind(WebAssembly);
      WebAssembly.instantiate = (bytes, imports) => {
        if (bytes instanceof Uint8Array && bytes.length === 29 && bytes[25] === 253) {
          return Promise.reject(new WebAssembly.CompileError('SIMD unavailable in this test'));
        }
        return instantiate(bytes, imports);
      };
    }
  }, scalar);
}

export async function detectBlankFrame(page) {
  return page.evaluate(async () => {
    await initModel();
    const image = document.createElement('canvas');
    image.width = 640;
    image.height = 480;
    const context = image.getContext('2d');
    context.fillStyle = '#ddd';
    context.fillRect(0, 0, image.width, image.height);
    const before = detectionResultGeneration;
    await sendFaceMeshFrame(image, 60_000);
    await waitForDetectionResult(before, 60_000);
    const snapshot = { generation: detectionResultGeneration, lastResultAt: lastDetectionResultAt };
    await discardFaceMesh(5_000);
    return snapshot;
  });
}
