# Wear OS parked alert experiment

A tester can send a synthetic Occulert alert from an Android phone to a paired Wear OS watch. A fresh alert requests one 180 ms vibration on the watch. This experiment has its own application ID and produces a handheld APK and a watch APK. The phone sender is a manual test fixture. Production monitoring continues to use its existing delivery paths.

## Install and exercise

Use JDK 17 or later, Android SDK Platform 36, and a paired Android phone and Wear OS watch with Google Play services. Build both debug APKs on the same machine so they use the same signing key. From `native-app/` run:

```sh
npm ci --include=dev
./node_modules/@react-native/gradle-plugin/gradlew -p wear-os-spike assembleDebug testWearDebugUnitTest
adb -s PHONE_SERIAL install -r wear-os-spike/build/outputs/apk/handheld/debug/wear-os-spike-handheld-debug.apk
adb -s WATCH_SERIAL install -r wear-os-spike/build/outputs/apk/wear/debug/wear-os-spike-wear-debug.apk
```

Open **Occulert wrist test** on both devices while parked. Select the alert level on the phone and tap **Send parked test pulse**. The sender looks for exactly one nearby reachable node advertising the spike capability. The phone reports whether the transport accepted the send. The watch displays the last fresh receipt, its arrival age and whether it requested a pulse. The tester records whether they felt it.

The Google Wearable Data Layer associates both installs through their matching application ID and signing certificate. MessageClient attempts a live send without queuing retries. The watch registers a WearableListenerService for the exact message path. The Data Layer requires an Android phone for this pairing. [Data Layer overview](https://developer.android.com/training/wearables/data/overview) · [Client types](https://developer.android.com/training/wearables/data/client-types) · [Listening for events](https://developer.android.com/training/wearables/data/events)

## Contract and delivery delay

The path is `/occulert-alert`. Its UTF-8 JSON has the four fields produced by [watchBridge.ts](../lib/watchBridge.ts). For example:

```json
{"type":"occulert-alert","level":"alert","perclos":0.25,"at":1700000000000}
```

The phone generates a new epoch timestamp immediately before sending. Each accepted cue level (tracking, watch, alert and critical) requests the same single pulse. The receiver discards duplicate, out-of-order, future, malformed and stale alerts, including a message **exactly 2,000 ms** old. It checks freshness again before requesting vibration. The cutoff follows the live alert ingress window in [AlertReceiver.swift](../targets/occulert-watch/AlertReceiver.swift).

**Measured physical delivery delay is pending.** The receipt shows the watch arrival time minus the phone send timestamp in milliseconds. This estimate includes clock offset. The displayed receipt excludes messages outside the acceptance window, so count every send attempt and every missing receipt separately when evaluating delay. Haptic onset and perception require direct observation.

## Permissions and local data

The watch requests the normal Android `VIBRATE` permission. It supplies notification usage to the vibrator so the OS can apply the user's interruption settings. The spike adds no camera, sensor, health, location or notification-posting permissions. The phone uses the paired-device transport managed by Play services. The watch retains only its latest accepted timestamp, arrival age and pulse-request flag in private preferences, with backup disabled. [Android vibration API](https://developer.android.com/reference/android/os/Vibrator)

## Open device checks

| Parked test | Record |
| --- | --- |
| Phone and watch awake, repeated trials for each cue level | Device models, OS builds, connection, attempts, receipts, min/median/max arrival age, felt pulses and misses. |
| Watch face visible, screen asleep, battery saver and Do Not Disturb | Receipt and pulse-request status, physical sensation and delays for each state. |
| Disconnect before sending, wait over two seconds, reconnect | Sender outcome, any late receipt or unexpected pulse, next fresh send. |
| Watch absent, second test watch nearby, incompatible signature | Verify sender feedback and absence of unintended pulses. |
| Clock skew and receiver restart | Compare displayed age with measured clock offset. Confirm stale or duplicate messages produce no extra pulse. |
| Transport versus wrist onset | Use a common external clock or a single video of both devices with consent to measure tap-to-pulse where observable. |

The JVM fixture tests cover the JSON contract and the receiver's freshness and replay boundaries. A successful debug build or emulator receipt leaves physical wrist delay and perception open.
