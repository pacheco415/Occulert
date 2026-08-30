# 👁 Occulert™ — AI Drowsiness Detection

**Stop Drowsy Driving Before It Stops You.**

Occulert is a prototype real-time AI drowsiness detection platform that uses your phone's front camera to estimate eye openness and fatigue patterns. When it detects warning signs, it can trigger phone-based alerts to help remind the driver to pull over safely.

🌐 **Live at [occulert.com](https://www.occulert.com)**

---

## ✨ Features

- 👁 **AI Eye Tracking** — Uses MediaPipe FaceMesh landmarks to estimate eye openness.
- ⚡ **Fast Alerts** — Designed to warn quickly when signs of fatigue appear.
- 🔒 **Privacy First** — Core camera processing is intended to run on device.
- 📍 **Opt-In GPS** — Location tracking is off by default and only starts when enabled.
- ☁️ **Opt-In Cloud Sync** — Fleet cloud sync is off by default. When enabled it uses Supabase Auth with fleet-scoped row-level security.
- 📊 **Session Event Log** — Alerts and fatigue metrics can be saved locally in the browser.
- 📱 **PWA Installable** — Add to iPhone or Android home screen like a native app.

---

## ⚠️ Safety Notice

Occulert is an assistive prototype. It cannot guarantee crash prevention, driver alertness, emergency response, or legal compliance. Do not drive while tired. Do not interact with the app while actively driving. If you feel drowsy, pull over safely and rest.

---

## 📱 Device Compatibility

| Device | Support |
|---|---|
| iPhone Safari | ✅ Supported, keep screen unlocked |
| Android Chrome | ✅ Supported |
| Phone vibration | Device/browser dependent |
| Wearables / earbuds | May work through paired-device behavior, not guaranteed |
| GPS / fleet dashboard | Optional and consent-based |

---

## 🚗 Who It's For

- Uber, Lyft, and rideshare drivers
- Amazon, FedEx, and delivery drivers
- Long-haul truck drivers
- Everyday commuters
- Fleet managers and commercial operators

---

## 📁 File Structure

```text
occulert/
├── index.html              # Landing page
├── app.html                # Driver monitoring app
├── driver-app.js           # Driver monitoring and alert behavior
├── fleet-dashboard.html    # Prototype fleet dashboard
├── session-history.html    # Local session history
├── privacy.html            # Privacy policy
├── safety.html             # Safety disclaimer
├── login.html              # Driver / fleet manager sign-in
├── account.html            # Account and profile
├── fleet-onboarding.html   # Fleet creation and driver invitations
├── accept-invite.html      # Invitation acceptance
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker
├── occulert-backend.js     # Browser client for Supabase Auth + /api routes
├── auth-helper.js          # Profile and session helper
├── api/                    # Vercel serverless endpoints
├── db/schema.sql           # Database schema and RLS policies
├── PERFORMANCE_ROADMAP.md  # Runtime budgets and evidence gates
└── BACKEND_SETUP.md        # Backend configuration guide
```

---

## 🚀 How to Use

1. Go to **[occulert.com](https://www.occulert.com)** on your iPhone or Android.
2. Tap **Launch App**.
3. Mount your phone on your dashboard facing you.
4. Tap **Start Monitoring**.
5. Allow camera access.
6. Keep the browser visible and screen unlocked.
7. Only enable GPS/cloud sync if you intentionally want fleet/demo data saved.

---

## 🔐 Backend / Fleet Security

Before using Occulert with real drivers or fleet data, review `BACKEND_SETUP.md` and the row-level security policies in `db/schema.sql`. Driver sessions and events are scoped to the authenticated driver, fleet history is scoped to the fleet owner, and invitations are stored as hashed one-time tokens. Never expose the Supabase service-role key to the browser — only the publishable anon key is served, via `/api/public-config`.

## 🧪 Site Audit

Run the static safety checks before deploying:

```bash
npm run audit:site
```

The audit checks local links/assets, inline script/style extraction, the Supabase public-config contract, no-store cache rules for sensitive helper files, CSP headers, protected session and invitation handling, and the bundled native alert sound.

## 📬 Pilot Lead Capture

Pilot signup always stores a local browser copy for the demo. When the Supabase
server variables from `BACKEND_SETUP.md` are configured, validated requests are
stored in the `pilot_leads` table. To additionally forward requests, set:

```bash
PILOT_LEADS_WEBHOOK_URL=https://your-webhook-endpoint.example
OCCULERT_ALLOWED_ORIGINS=https://www.occulert.com,https://occulert.com
```

The `/api/pilot-leads` endpoint requires same-origin JSON submissions, validates
required fields and form timing, strips oversized values, rate limits bursts,
and only forwards to an HTTPS webhook.

---

## 💚 Support the Project

Occulert is free because safety should be accessible. If it helped you, consider supporting:

- **GoFundMe:** [Support Occulert](https://gofund.me/bc4aab056)

---

## 👤 About

Built by **Richard Pacheco** — an automotive technology student and fleet driver from San Francisco, CA.

> *"No one should lose their life because they fell asleep at the wheel."*

---

## 📬 Contact

- General: [hello@occulert.com](mailto:hello@occulert.com)
- Fleet & Enterprise: [fleet@occulert.com](mailto:fleet@occulert.com)
- Instagram: [@occulert](https://instagram.com/occulert)
- X / Twitter: [@occulert](https://x.com/occulert)
- TikTok: [@occulert](https://tiktok.com/@occulert)

---

© 2026 Occulert™ · All rights reserved · San Francisco, CA
