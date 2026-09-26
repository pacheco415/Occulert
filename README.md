# 👁 Occulert™ — AI Drowsiness Detection

**Stop Drowsy Driving Before It Stops You.**

Occulert is a prototype real-time AI drowsiness detection platform that uses your phone's front camera to estimate eye openness and fatigue patterns. When it detects warning signs, it can trigger phone-based alerts to help remind the driver to pull over safely.

🌐 **Live at [occulert.com](https://www.occulert.com)**

Development status is maintained in the [authoritative roadmap](docs/APP_ROADMAP.md).
The protected Supabase fleet workflow, reporting, TV aggregate view, and pilot
launch checklist are released web features. PR #138 shipped quick start,
printable reporting, data-quality explanations, and TV controls; PR #139 shipped
the native clean-install and stale Watch-feedback repair. Recorded PR #139
release baseline is `969849b`. TestFlight 1.0.0 (52) is built/submitted, Apple VALID / IN_BETA_TESTING,
with embedded Watch packaging confirmed. Physical build-52 acceptance is not
recorded, and 0 iOS builds remain this cycle. Pilot owner/participant details
remain unanswered. Distribution and source checks do not establish detection
accuracy, device acceptance, or safety effectiveness.

---

## ✨ Features

- 👁 **AI Eye Tracking** — Uses MediaPipe FaceMesh landmarks to estimate eye openness.
- ⚡ **Fast Alerts** — Designed to warn quickly when signs of fatigue appear.
- 🔒 **Privacy First** — Camera processing runs on device; these workflows do not upload camera video, audio, or raw motion.
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
├── driver-app.v57.js       # Versioned browser monitoring and alerts
├── fleet-dashboard.html    # Protected manager workflow + separate demo
├── fleet-display.html      # Protected read-only TV aggregate view
├── pilot-guide.html        # Released manager-and-driver quick start
├── fleet-pricing.html      # Managed early-access fleet plans
├── pilot-signup.html       # Pilot and rollout qualification form
├── session-history.html    # Local session history
├── privacy.html            # Privacy policy
├── safety.html             # Safety disclaimer
├── login.html              # Driver / fleet manager sign-in
├── account.html            # Account and profile
├── fleet-onboarding.html   # Fleet creation and driver invitations
├── accept-invite.html      # Invitation acceptance
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker
├── occulert-backend.v47.js  # Browser client for Supabase Auth + /api routes
├── api/                    # Vercel serverless endpoints
├── db/schema.sql           # Initial schema and RLS policies
├── supabase/migrations/    # Subsequent protected schema/function changes
├── native-app/             # Private iPhone/Watch source
├── docs/APP_ROADMAP.md      # Authoritative release/source/evidence status
├── docs/PILOT_OVERVIEW.md   # One-page voluntary 30-day pilot overview
├── docs/PILOT_OUTREACH.md   # Qualification and unsent outreach drafts
└── BACKEND_SETUP.md        # Backend configuration guide
```

---

## 🚀 How to Use

1. Go to **[occulert.com](https://www.occulert.com)** on your iPhone or Android.
2. Tap **Launch App**.
3. While safely parked, secure the phone in a lawful mount facing you.
4. Tap **Start Monitoring**.
5. Allow camera access.
6. Keep the browser visible and screen unlocked.
7. Choose cloud sync deliberately if you want protected fleet session records;
   GPS is a separate optional choice and is not needed for monitoring or a pilot.

---

## 🔐 Backend / Fleet Security

Review [backend setup](BACKEND_SETUP.md), the initial schema, and subsequent
migrations before handling real fleet data. Server endpoints derive driver and
fleet scope from verified identity; invitations use hashed one-time tokens.
Protected manager reports exclude coordinates, personal media, and raw motion.
TV further excludes identities and individual scores. Summaries use adaptive
polling and the latest 50 sessions; a 7/30-day view can be incomplete. Metrics
are unverified client reports. Never expose the Supabase service-role key to a
browser; `/api/public-config` serves only publishable configuration.

## 🧪 Site Audit

Run the static safety checks before deploying:

```bash
npm run audit:site
```

The audit checks local links/assets, inline script/style extraction, the Supabase public-config contract, no-store cache rules for sensitive helper files, CSP headers, protected session and invitation handling, and the bundled native alert sound.

## 📬 Pilot Lead Capture

Pilot signup sends validated requests to the protected server endpoint without
retaining contact details in browser localStorage. With the Supabase server
variables from `BACKEND_SETUP.md`, requests are stored in `pilot_leads`. To
additionally forward requests, set:

```bash
PILOT_LEADS_WEBHOOK_URL=https://your-webhook-endpoint.example
OCCULERT_ALLOWED_ORIGINS=https://www.occulert.com,https://occulert.com
```

The `/api/pilot-leads` endpoint requires same-origin JSON submissions, validates
required fields and form timing, strips oversized values, rate limits bursts,
and only forwards to an HTTPS webhook.

The [pilot package](docs/PILOT_OUTREACH.md) includes a one-page overview,
qualification questions, and unsent email drafts for one fleet owner and up to
five voluntary drivers over 30 days. Reviews evaluate participation, setup,
missing data, and workflow; they do not establish detection accuracy. No
external outreach has been sent by this source work.

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
