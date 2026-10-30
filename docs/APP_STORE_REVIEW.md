# App Review notes — draft for native source

Reviewed October 3, 2026. This document is source-based draft material, not a
submission or assurance of approval. A production archive and physical audio,
permission, Watch and network checks have not been performed for this change.
Privacy inputs and unresolved SDK details are in [APP_STORE_PRIVACY.md](APP_STORE_PRIVACY.md).

## Draft feature notes

Occulert's camera-based fatigue monitoring runs while its monitoring/setup screen
is in the foreground. Live frames are processed on device; the app does not save
or upload camera video/photos. Leaving the foreground stops face monitoring and
optional headphone motion, plays a distinct short warning and ends the session.
Restart monitoring only while safely parked. The app does not provide background
camera monitoring or determine fitness to drive.

The audio background mode permits a short bundled alert or monitoring-paused
warning to finish during foreground loss. Short-cue players release the audio
session after playback. Layout cleanup pauses only the departing screen's players
before Expo's passive disposal; it does not globally disable another playing cue.
Silent-mode playback, speaker/Bluetooth routing and restoration of external music
volume must be checked on the submitted binary before using these notes as attested
device behavior. Apple's 2.5.4 requirement concerns intended background-service
use; this source change does not establish an App Review outcome.
[Apple App Review guidelines](https://developer.apple.com/app-store/review/guidelines/#software-requirements)

An optional parked readiness test runs the supported front/rear camera pair for
five seconds, counts frames and reports device pressure/thermal labels. It does
not save images/video, upload data, or implement rear-camera road monitoring.
The UI starts it only in the foreground; backgrounding invalidates its result.

Apple Health connection is optional and read-only. It reads recent sleep analysis
and HRV SDNN, stores a small protected local pre-drive summary and does not write
Health data or change fatigue alerts. Compatible-headphone motion is optional
local observation, without changing alert thresholds or scores. The optional Watch
companion receives recent status/alerts and uses local notifications/haptics; it
does not independently monitor the driver's eyes or read Watch HealthKit data.

Core monitoring works without sign-in. Optional cloud sign-in authenticates through
Supabase and creates/refreshes a driver profile; separate session sync starts off
and sends account-linked summary metrics/events when enabled. Pending completions
retry only for the current signed-in consenting owner. Disabling sync/signing out
clears pending uploads; deleting local history does not delete cloud records or
clear that separate outbox. Experimental baseline builds suppress session sync.

History exports use a user-selected share sheet. Support feedback opens an editable
Mail draft, with a second Share choice if Mail is unavailable; nothing is sent
automatically. Maps receives a selected search phrase in an external app after
monitoring stops; Occulert does not read coordinates. Local HealthKit values, raw
motion, media and local performance diagnostics are excluded from automatic sync.
SDK diagnostics are separate and require the privacy review described above.

## Evidence to supply with the actual submission

Use a dedicated review account if enabled cloud/fleet features require sign-in;
none is invented or supplied here. Confirm final version/build and environment
flags, generated purpose strings, Health read authorization without a write prompt,
optional denied permissions, short-cue completion/overlap, foreground loss, Stop,
screen disposal, restored navigation/music volume and Watch behavior on devices.
Use parked testing; do not ask reviewers to drive to trigger alerts. Keep medical,
accuracy and driving-safety claims limited to available validated evidence.
