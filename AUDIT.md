# Occulert Technical Audit

Last updated: 2026-06-14

## Completed quick wins

- Updated robots.txt to point search engines to the custom domain sitemap.
- Updated sitemap.xml to use https://occulert.com instead of the temporary Vercel URL.
- Improved the PWA manifest description and shortcuts.
- Added Vercel caching rules for static assets.
- Added security/privacy headers for safer browser behavior.

## App observations

The app is already more advanced than a basic demo. It includes:

- Camera permission flow
- MediaPipe FaceMesh loading
- Eye Aspect Ratio detection
- Calibration
- Sensitivity and cooldown controls
- Vibration/audio alerts
- Session stats
- Theme controls
- Bluetooth pairing UI
- Wake Lock support

## High-priority next fixes

1. Split large inline CSS and JavaScript out of index.html and app.html into separate files.
2. Add full homepage SEO tags directly inside index.html: canonical URL, Open Graph, Twitter cards, and longer meta description.
3. Improve camera permission fallback text for iPhone Safari and Android Chrome.
4. Add a real beta waitlist form that stores inquiries somewhere reliable.
5. Add a visible demo video section above the fold.
6. Add a safety/legal disclaimer page.
7. Improve app testing for night driving, sunglasses, bumpy roads, and false alerts.

## App reliability notes

- Monitoring pauses when the page is backgrounded; this is expected for browser-based camera apps.
- Phone/watch vibration depends on browser and device support.
- Bluetooth support varies by browser and is strongest on Chrome-based browsers.
- iOS Safari has stricter limitations for background camera, vibration, and Bluetooth.

## Recommended product direction

Prioritize fleet safety as the business model:

- Driver drowsiness alerts
- Fleet dashboard
- GPS tracking
- Driver safety scoring
- Incident history
- Pilot program for local fleet operators
