# Parked multitasking camera experiment

Side-by-side monitoring is unvalidated. Folded, full-screen use remains the supported driving mode. This experiment does not change detection, alerts, app orientation or background modes, and does not add an entitlement.

The default installation leaves VisionCamera's capture-session source byte-for-byte unchanged. For a dedicated parked test build, set `OCCULERT_MULTITASKING_CAMERA_EXPERIMENT=1` in the build environment **before dependency installation**:

```sh
OCCULERT_MULTITASKING_CAMERA_EXPERIMENT=1 npm ci --include=dev
```

For EAS, set that variable only on a dedicated experiment build profile or environment. This is a native build/install flag; changing a JavaScript runtime flag or publishing an update cannot enable it. Rebuild the native app after changing it. An unset flag, an empty value, or `0` restores the exact original source on the next install/postinstall. Any other value fails installation.

`scripts/patch-camera-multitasking.mjs` accepts only VisionCamera 4.7.3 and the pinned `CameraSession.swift` bytes. It covers both the normal video start and VisionCamera's runtime-error start. On iOS 16 or later, immediately before starting a stopped session, it enables multitasking camera access only when that session reports support. Unsupported sessions retain their default. The separate audio session is unchanged. Unknown package versions, upstream changes or edited experimental patches fail closed. Watch-connectivity and decoder patches still run independently.

The native condition module observes interruption and end notifications with `object: nil`, keeps weak session references, and filters metadata to the selected camera ID. It updates its locked snapshot before sending `cameraInterrupted`. Error and watchdog recovery must query `getCameraInterruptionState` before reserving an automatic restart, and must ignore callbacks after their camera/session owner ends. A named multitasking interruption stops monitoring with its parked-restart message and existing paused cue; interruption end never restarts monitoring automatically.

Status reads have a 500 ms timeout, and do not reset the sample clock, transition-grace deadline or restart budget. A missing optional module or a valid native report that no session has been observed retains the existing camera-error handling. During error/watchdog recovery, a rejected, invalid or timed-out status read returns `queryFailed` and stops visibly without spending restart budget. Once a named pause has been observed, an unavailable reply cannot undo its latch. Explicit parked Start/Setup actions clear it; queued work from a previous start, camera epoch or selected device is rejected.

Before enabling this beyond a parked experiment, record fresh-session support on a physical Duo, whether an Apple entitlement is required, frame continuity beside Maps, camera identity and frame gaps across fold/unfold, heat/pressure, and audio/Watch alert delivery over navigation voice. The simulator and source tests cannot establish these results. Do not advertise side-by-side monitoring without device acceptance evidence.

Apple references: [multitasking support](https://developer.apple.com/documentation/avfoundation/avcapturesession/ismultitaskingcameraaccesssupported), [enable access before starting](https://developer.apple.com/documentation/avfoundation/avcapturesession/ismultitaskingcameraaccessenabled), [interruption reasons](https://developer.apple.com/documentation/avfoundation/avcapturesession/interruptionreason).
