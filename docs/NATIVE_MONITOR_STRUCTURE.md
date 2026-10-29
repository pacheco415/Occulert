# Native monitor ownership

`native-app/app/monitor.tsx` owns screen state and ref identities, permission and
pre-drive checks, local session reservations, protected cloud/storage actions,
start/stop ordering, navigation and Maps handoff. Hooks receive those actual refs
and actions; they do not create another consent, account or session authority.

| Owner | Responsibility |
| --- | --- |
| `hooks/useMonitorAnalysis.ts` | Current eye-state processing, parked baseline samples, observation counters, UI throttling and the stable native frame bridge/worklet. |
| `hooks/useMonitorCameraLifecycle.ts` | Native interruption subscription, stale-callback guards, camera restart budget, watchdog and thermal/device-condition observation. |
| `hooks/useMonitorCameraIdentity.ts` | Current front-camera identity, parked preview, baseline invalidation and injected baseline/sensitivity loading. |
| `hooks/useMonitorCheckpoint.ts` | The existing 15-second checkpoint timer and an explicit checkpoint callback using the injected persistence action. |
| `hooks/useMonitorCloudAlerts.ts` | Accepted closed-eye transitions, immediate local alert counting, original detection-time capture and the injected guarded event actions. |
| `lib/monitorCheckpointModel.ts` | The existing local checkpoint field set and averaging/duration calculations, without storage. |
| `lib/monitorPresentationModel.ts` | Lifecycle/status label and color precedence, without effects. |
| `components/monitor/MonitorPresentation.tsx` | Typed camera, controls, warnings, safe-stop choices, permission states and active-monitoring wake-lock presentation. |
| `components/monitor/monitorStyles.ts` | The original styles, without layout or copy changes. |

The screen keeps `useAlertAudioPlayer` ownership of the monitoring-paused sound.
`AlertSystem`, its audio-session owner and Watch delivery code remain unchanged.
The extracted view receives the original timing and level callbacks; ordinary
renders retain the same camera instance and active wake lock.

Detection thresholds and alert policy are unchanged. The frame worklet retains
its stable shared values and existing 100 ms normal / 200 ms reduced-load policy.
Camera startup grace, stall handling and restart limits remain in their existing
pure policy modules. Headphone motion stays observation-only and local.

Start still reserves recovery storage before activating the camera. Stop still
invalidates pending camera starts and native event retries before local saving,
then clears only its own checkpoint and finalizes the original cloud session.
The cloud hook calls the injected native retry adopter at detection, before
session creation or earlier event work settles. Flag-off legacy requests and
their guarded timestamp fallback keep the existing path. The retry engine,
capability/consent gates and process-boundary policy are described in
[EVENT_OUTBOX_CONTRACT.md](EVENT_OUTBOX_CONTRACT.md).

## Verification boundaries

Existing monitor-layout, alert-layout, audio-lifecycle and capture-load test files
retain their original behavior assertions. Source-based callback fixtures follow
the actual moved owners instead of assuming every function lives in the screen.
The fixed `native-app/scripts/lib/monitor-source-owners.mjs` helper proves real imports,
hook calls, screen-owned action/ref bindings, rendered components and model/style
links. It rejects missing, duplicate, detached or ambiguous owners. It does not
discover arbitrary files, copy implementations or concatenate executable source.

Mounted interaction tests run actual React and the actual hooks/models/TSX, with
native bridges and screen-owned asynchronous actions substituted. They cover
current ref identity, pending session/cloud/storage work, stopped/disposed
callbacks, timer cleanup, camera ownership, frame cadence and injected control
actions. The original behavior assertions, inputs, expected outcomes and timeouts
remain intact in the source-location adaptations.

Original-owner AST, complete rendered-tree and checkpoint-storage transcript
comparisons independently check the extraction against the preceding main source.
These are source and React checks; they do not establish installed iPhone/Watch,
physical camera, Silent-mode, Bluetooth or thermal acceptance. Those remain in
[DEVICE_ACCEPTANCE.md](DEVICE_ACCEPTANCE.md) for the eventual reviewed build.
Operational receipts stay local.

The isolated simulator profile still enters the actual analysis callback through
`useSimulatorTrace`; its proof ref and one-time deep-link Start grant stay owned
by the screen. The view shows the existing synthetic preview without requiring a
camera. Simulator permission/pre-drive gates and cloud suppression retain their
profile checks; ordinary app permission, Start and Stop behavior is unchanged.
Mounted React coverage also checks trace interval disposal on Stop and the
camera-free view's explicit controls.
