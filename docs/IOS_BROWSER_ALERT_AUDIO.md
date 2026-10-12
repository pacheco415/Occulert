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
preparation only while monitoring is starting/active or the deliberate parked
test is active. Stop, failed Start, and test completion restore the prior
AudioSession setting and cancel fallback playback. An ownership generation
prevents an older test timeout from releasing a newer monitoring session.
These actions never queue or replay an alert. A context that is
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

## Optional stronger pattern

Open `/app.html?alert-pattern=strong` only for parked evaluation. The option
requires one exact value; absent, duplicate or differently cased values retain
the standard alerts. It is not saved as a preference and remains off by default.
It changes audio and the red alert screen independently of the detector flags;
scoring, confidence, cooldowns, escalation timing and cloud consent are unchanged.

Levels 1–2 alternate 880/1100 Hz every 250 ms for 2.5 seconds at Web Audio gain
0.6. Levels 3–4 use the same alternating pattern for 4 seconds at gain 1.0.
The red screen lasts for the same duration. Strong mode replaces the existing
short main tone and delayed 55 Hz pulses; notifications and vibration retain
their existing mappings. The deliberate parked Test Alert uses the lower band
without adding a detection event or delivered-alert count.

When Web Audio is unavailable or interrupted at alert start, the existing 880 Hz WAV loops
for the same bounded duration at media volume 0.6 or 1.0. This fallback repeats
one pitch; it does not reproduce the two Web Audio pitches. One owned oscillator
or one reusable audio element produces the pattern. Stop, a hidden tab, a new
audio scope and pattern completion cancel its output and red screen. Stale
completion callbacks cannot cancel a newer pattern or monitoring scope.

Keep this option parked until the exact website release passes the physical
checks in [DEVICE_ACCEPTANCE.md](DEVICE_ACCEPTANCE.md), including Safari and
Home Screen PWA Silent mode, speaker/headphone/car routes, interruptions and
immediate Stop/background cancellation. All these results remain **Not tested**.
