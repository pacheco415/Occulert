# App Privacy inputs — draft, not submitted

Source review: October 3, 2026, native runtime from main `e00e2834` plus the
native audio lifetime change. These are draft inputs for iPhone and its Watch
companion, not attested App Store Connect selections. No archive, device network
capture, EAS build or App Store metadata change was performed.

**The draft overall answer is that data is collected.** Native sign-in/profile
and enabled session sync establish retained off-device collection independently
of unresolved SDK diagnostics. Apple includes partner collection and ongoing
opt-in flows; optional permission alone does not exempt a data type. Its feedback
exemption has multiple conditions that this app's Mail flow has not demonstrated.
[Apple App Privacy details](https://developer.apple.com/app-store/app-privacy-details/)

## Source data flows

| Feature | Actual data behavior | User choice and destination |
| --- | --- | --- |
| Camera monitoring/setup preview | Transient front-camera frames processed with VisionCamera/ML Kit; eye/head metrics, no app media recording/upload | Camera permission and foreground setup/monitoring |
| Parked camera diagnostic | User-started five-second front/rear capture test counts frames and reports pressure/thermal state; no saved/uploaded media | Parked Readiness controls; local result, no cloud endpoint |
| Local session history | Up to 50 summaries, reviews, conditions, bounded performance and aggregate motion observations; separate temporary recovery checkpoint | Device storage; local deletion controls |
| Apple Health | Read-only sleep analysis and latest HRV SDNN; protected local summary of 24-hour sleep minutes, latest HRV value/time and capture time | Explicit Connect/Refresh; no Health writes/background delivery, cloud, feedback or export path for those values |
| Headphone motion | Transient compatible-headphone pitch/yaw/roll and acceleration; saved aggregate counts/status, no raw sample storage/upload | Optional foreground observation; does not change scores/alerts |
| Watch | Running state, fatigue/PERCLOS, duration, severity and timestamps | Optional companion via WatchConnectivity; local notifications/haptics, no developer collection server in this path |
| Cloud sign-in/profile | Email/password to Supabase Auth; verified user email/ID and derived driver handle/profile through Occulert API | Explicit sign-in creates/refreshes a profile even with session sync off. Local tokens use device-only SecureStore |
| Cloud sessions/events | Platform/OS, app build, detector identity, start/end times, average/max fatigue, safety score, alert counts and drowsiness-event scores | Separate signed-in sync opt-in; Vercel API/Supabase storage linked to account/driver/fleet. Native candidate head-nod count currently null |
| Pending summary outbox | Up to 20 local pending completions, owner/cloud IDs and local session mapping; retries original end time on launch/foreground/next session | Requires current owner and sync consent. Sign-out/disable clears it; deleting local history alone does not |
| Shown-summary export | Session date/duration, alerts, average fatigue, sensitivity, review and partial-session status | User chooses share sheet and recipient; excludes account/cloud IDs, coordinates, media, audio, raw motion and performance diagnostics |
| Pilot-progress export | Aggregate review/condition/heat/battery counts, report-generation time | User-chosen recipient; no individual session IDs/dates or raw sensors/media |
| Support feedback | Editable Mail draft to hello@occulert.com; optional local session ID, summary/aggregate head observations, review/conditions, build and tester-reported heat/battery information | Nothing automatically sent; fallback Share requires a second choice. Mail received by Occulert may be retained/linked through its sender |
| Maps | Selected search phrase in external Maps with web fallback | User choice after stopping monitoring; Occulert does not request/read/upload coordinates |
| SDK/provider diagnostics | Vendor-described ML Kit telemetry; deployed Vercel/Supabase log/IP retention not established by app code | Separate from cloud summary consent; verify actual components, traffic and provider configuration |

The local eye baseline is additionally stored when
`EXPO_PUBLIC_EYE_BASELINE_EXPERIMENT=1`; that build flag suppresses native session
sync. Checked-in EAS configuration does not attest the production environment.
Export/support choices can still share derived session summaries in that mode.
HealthKit values and fusion diagnostics remain excluded from those payloads.

Sources: native `lib/cloudSync.ts`, `sessionSummaryOutbox.ts`, `appleHealth.ts`,
`healthReadiness.ts`, `feedback.ts`, `sessionHistoryExport.ts`,
`pilotProgressExport.ts`, `safeStopLinks.ts`, `eyeBaselineModel.ts`,
`eyeBaselineStorage.ts`, device-condition/headphone-motion Swift modules,
`ParkedReadinessCard.tsx`, Watch `AlertReceiver.swift` and app call sites.

## Draft category, purpose and linkage inputs

Mappings below are source-based inferences to review against Apple's current
taxonomy. They are not confirmed console answers.

| Candidate category | Evidence / draft treatment | Purpose and linkage input |
| --- | --- | --- |
| Email Address | Native sign-in/profile; developer-received support sender | App Functionality; account-linked |
| User ID | Auth account ID, driver association and derived profile handle | App Functionality; account-linked |
| Health | Collected fatigue/eye-probability-derived summaries/events require category review. Recommend conservative inclusion for collected fatigue metrics; local-only HealthKit readings do not establish that all Health data is uncollected | Functionality for cloud; linked to account or feedback sender |
| Other Usage Data / Product Interaction | Session times/counts, app/detector metadata, SDK events | Cloud Functionality; Analytics where pilot/SDK usage analysis is actually performed; cloud linked |
| Customer Support | Developer-received feedback text/session observations | Functionality and any actual pilot-analysis use; may be linked by sender/local session ID |
| Head | Aggregate head-movement observations in manually sent feedback | Category inference to review; not automatic cloud sync; sender may link |
| Performance Data / Other Diagnostic Data | Vendor-described ML Kit latency/errors/configuration; feedback heat/battery/build information | SDK diagnostic/analytics and support uses; exact SDK linkage unresolved |
| Device ID | Vendor-described installation identifier | Confirm exact SDK/manifest interpretation and linkage; do not assume anonymization because it is not email or a hardware ID |
| Name | No native name-entry submission. Server may return a previously stored profile name; support users can supply one | Include if actually collected through an app/support path; do not invent a native name form |

Review whether collected eye/fatigue metrics need any additional biometric
classification. Detection is not identity authentication. Do not label all derived
sensor data as Usage Data merely to omit a relevant sensitive category.

No app-code collection path was found for camera photos/video, microphone audio,
contacts, coordinates/routes, raw HealthKit samples or raw headphone motion.
Bundled alert sounds are not user recordings. User-directed export to another app
differs from developer-received support mail; such mail is not necessarily anonymous.

**Tracking remains a draft “none found”**, pending SDK/provider review. No app
cross-company advertising linkage, ad ID request or data-broker path was found;
analytics alone does not establish tracking. Account-linked cloud data is not
anonymous. Provider-retained IP use may affect diagnostics/location/identifier
inputs. App-level disclosures should include the Watch and integrated partners.
[Apple App Store Connect privacy guidance](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/)

## ML Kit and binary verification

Lockfile: Expo 57.0.26, expo-audio 57.0.5, VisionCamera 4.7.3, its face detector
1.10.2, HealthKit 14.0.2 and WatchConnectivity 2.0.0. The detector's installed
podspec pins **GoogleMLKit/FaceDetection 8.0.0**. Google's 8-family release table
separately lists MLKitFaceDetection 7.0.0 and MLKitCommon 13.0.0; those are distinct
artifacts, not interchangeable version names. No archive Podfile.lock was available.
[Google ML Kit release notes](https://developers.google.com/ml-kit/release-notes)

Google documents default device/app information, an installation identifier,
latency, image format/resolution configuration, SDK events and error codes for
diagnostics/usage analytics. That page describes latest SDKs, so verify the pinned
components and production traffic before final category/linkage selections. These
are vendor statements, not a physical network observation of this build.
[Google ML Kit iOS disclosure](https://developers.google.com/ml-kit/ios-data-disclosure)

There is no app Sentry/advertising integration found in source. `expo-updates` is
not installed; `expo-updates-interface` is. CLI/build telemetry does not establish
production app collection, while absence of an app analytics import does not
exempt ML Kit. Neither “no data collected” nor “all diagnostics anonymous” is
supported by this review.

Before publishing, inspect the final generated app/Watch Info.plists, entitlements,
Podfile.lock, embedded privacy manifests and Xcode privacy report; verify production
build flags and exact SDK traffic; review deployed provider/support retention and
purposes. Align public privacy policy wording with verified collection. The current
policy's conditional analytics paragraph does not establish actual native SDK behavior.

## Permission text checked in source

Camera text covers front-camera monitoring and the optional parked check of both
cameras. Motion text describes optional foreground headphone observations. Health
Share text describes read-only local sleep/HRV context. Health Update is configured
false because no write feature exists. The unused native location declaration is
removed; Maps remains an external search-phrase link. Expo audio disables microphone
permission/recording. Watch notification authorization is explicit and optional.
Generated archive declarations remain a separate verification step.
