# Eyes detected recovery cue

The browser gives one short rising tone and says “Eyes detected.” when valid eye
landmarks return after that same loss actually passed `warnTrackingLoss`'s
existing five-second delay and thirty-second warning cooldown. A loss that ends
before the warning, or a later loss suppressed by the cooldown, produces no
recovery cue. Repeated valid frames do not repeat it. Face presence alone does
not recover a loss while eye landmarks are invalid.

The quiet sine tone rises from 740 to 1480 Hz over 180 ms and fades to silence at
220 ms. This differs from the unchanged 660/440 Hz loss pair and fatigue alarm.
It uses the existing audio scope and only a running audio context. Unavailable
or suspended recovery audio neither queues an oscillator nor substitutes the
fatigue WAV. Normal alarm fallback behavior is unchanged.

The informational voice key is `driver.voice.cue.eyesDetected` in every supported
catalog: English, Spanish, French, Portuguese, German, Arabic, Chinese and
Japanese. The optional catalog returns its current text and language together;
missing, malformed or throwing catalog access retains “Eyes detected.” with
`en-US`. The central `speak` helper keeps the existing voice preference and
parked-observer guards. Existing safety, tracking-loss, camera, detector and
rest-stop speech retains its exact English wording and `en-US` default.

Each accepted warning records its loss and a generation. Recovery consumes it;
actual start and stop reset it. Delayed loss-tail callbacks from an older warning
or lifecycle cannot play. A new loss and lifecycle reset stop owned recovery
sound and speech, while a later safety message retains speech ownership. The
cue does not increment alert counts, change fatigue scores, alter calibration,
or write a new cloud or fleet event.

## Validation

The detection suite compiles the real source before release. Deterministic
cases exercise 4,999 ms and 5,000 ms losses, cooldown-suppressed losses, repeated
warnings in one continuous loss, both face and eye validity, once-only recovery,
actual stop/start, stale delayed callbacks, eight speech languages, voice-off,
observer mode, optional-catalog failures and unavailable audio. The source and
released speech checks keep one central dispatch, English safety defaults and
only the new informational language exception. The existing browser catalog
suite also exercises recovery through the actual loaded Arabic/Spanish catalog
and language switch; this requires the released assets.

## Measured release size

Against main `58454df44f4a66754d000456f237b41445c66a23`, the source-only driver
baseline is 126,892 bytes. After integrating the release-control-only main
`39ea2906cb91ed3fe77a9de79c9cd7689f8e5dbe`, immutable `driver-app.v132.js` is
128,372 bytes, up 1,480 (36,238 bytes gzip). Cache `occulert-v213` contains
375,854 selected static bytes, up from 374,374. The 771-byte catalog increase
in `driver-i18n.v3.js` remains outside the static install list; the driver uses
`driver-startup-guard.v53.js`. These are measured released bytes after filename
and integrity-pin generation.

The reviewed feature ceilings are 128,500 driver bytes and 376,000 static-cache
bytes, replacing 127,000 and 375,000 respectively. Recovery reuses the existing
tone path; compiler settings, source identity proofs, install membership and
optional-catalog loading policy are unchanged. These measured increases fund
per-loss warning ownership, bounded audio cancellation and localized recovery.
