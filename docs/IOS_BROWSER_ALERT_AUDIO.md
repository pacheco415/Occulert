# Browser alert audio recovery

The Start Monitoring gesture requests `navigator.audioSession.type = 'playback'`
when supported, before camera/model preparation. The deliberate parked alert
check does the same. WebKit documents this setting for iOS 17 and later to
avoid ambient Web Audio being muted by the Silent switch. The API is feature
detected; this is a delivery request, not proof the user heard a signal.
[WebKit bug 237322, comment 6](https://bugs.webkit.org/show_bug.cgi?id=237322#c6).

`playback` may pause other media. Volume, Focus, routing and OS/browser
interruptions still affect perception. Verify the exact site build in both
Safari and a Home Screen PWA with the Silent switch on, including a parked
retest after Siri or an incoming call. Record these as **Not tested** until a
physical iPhone result is available. iOS Safari does not support vibration.
[MDN AudioSession.type](https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type).

Suspended and interrupted contexts receive a bounded, single-flight resume
attempt. Returning to a visible page and the next pointer gesture retry audio
preparation. These actions never queue or replay an alert. A context that is
still unavailable or not running uses one same-origin HTML audio element for
an actual tone request. It plays the original 880 Hz `audio/alert.v1.wav`,
limited to the requested duration and at most 900 ms, with no loop or remote
media. A muted 150 ms gesture prime is silent and may be rejected by browser
permissions; failures are contained. Leaving the foreground cancels fallback
playback. No delayed Web Audio oscillator is scheduled while interrupted.
[MDN BaseAudioContext.state](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state).

The 28,844-byte sound is reproducible with
`node scripts/generate-browser-alert.mjs`. Its SHA-256 is recorded in
`asset-integrity.json`; the service worker pins the same digest and requires
this small sound for the new offline cache. Keep its published URL immutable.
Detection thresholds, scoring, alert cooldowns and escalation timing are
unchanged. Software stubs verify delivery paths and rejection handling; they
cannot verify a physical speaker, Silent switch or notification route.
