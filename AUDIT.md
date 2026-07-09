# Occulert Technical Audit

Last updated: 2026-07-08 (previously 2026-07-05, 2026-06-14). For the current consolidated near/mid/long-term gap list across both the web app and native-app, see issue #6.

## Completed quick wins

Updated robots.txt to point search engines to the custom domain sitemap. Updated sitemap.xml to use https://occulert.com instead of the temporary Vercel URL. Improved the PWA manifest description and shortcuts. Added Vercel caching rules for static assets. Added security/privacy headers for safer browser behavior. Lengthened the homepage meta description and removed a duplicate canonical tag that had been inlined on the robots meta line (PR #17). Drafted Supabase-based backend scaffolding for sessions, events, and the fleet dashboard, per BACKEND_ROADMAP.md (PR #18) -- not yet connected to a real database.

## App observations

The app is already more advanced than a basic demo. It includes a camera permission flow, MediaPipe FaceMesh loading, Eye Aspect Ratio detection, calibration, sensitivity and cooldown controls, vibration/audio alerts, session stats, theme controls, a Bluetooth pairing UI, and Wake Lock support.

Separately, a native iOS app (Expo/React Native, under native-app/) is now in progress with a real vision-camera plus ML Kit eye-tracking pipeline, history and settings screens, and AirPods/Apple Watch alert bridges. That work has its own audit trail (see PR #1, "Audit fixes," in this repo) and is tracked going forward in issue #6 rather than this document.

## High-priority next fixes

Status of the items identified in the original audit: splitting the large inline CSS and JavaScript out of index.html and app.html into separate files is still open. Full homepage SEO tags inside index.html (canonical URL, Open Graph, Twitter cards, meta description) are now in place, including a lengthened meta description and a fixed duplicate canonical tag (PR #17); several other pages such as pilot-signup.html, product-hub.html, privacy.html, and session-history.html also have canonical/OG/PWA meta tags. Improving camera permission fallback text for iPhone Safari and Android Chrome is still open. Adding a real beta waitlist form that stores inquiries reliably is partially addressed, since pilot-signup.html and pilot-leads.html now exist, but the backend storage should be verified. Adding a visible demo video section above the fold is still open. Adding a safety/legal disclaimer page is done, since safety.html and privacy.html are live and safety.html has since gained an accuracy-status and pilot-fleet-program section. Improving app testing for night driving, sunglasses, bumpy roads, and false alerts is still open. Moving the fleet dashboard off localStorage now has a scaffolded starting point (api/sessions.js, api/events.js, api/fleet-summary.js, db/schema.sql, BACKEND_SETUP.md in PR #18), but it requires a real Supabase project, environment variables, and frontend wiring before it does anything -- see BACKEND_SETUP.md.

## App reliability notes

Monitoring pauses when the page is backgrounded; this is expected for browser-based camera apps. Phone/watch vibration depends on browser and device support. Bluetooth support varies by browser and is strongest on Chrome-based browsers. iOS Safari has stricter limitations for background camera, vibration, and Bluetooth.

## Recommended product direction

Prioritize fleet safety as the business model: driver drowsiness alerts, a fleet dashboard, GPS tracking, driver safety scoring, incident history, and a pilot program for local fleet operators.

A fleet dashboard prototype exists today using localStorage (see BACKEND_ROADMAP.md); backend scaffolding toward a real database with driver/fleet/session tables now exists in api/ and db/schema.sql (PR #18), but needs a real Supabase project, credentials, and frontend integration to go live.
