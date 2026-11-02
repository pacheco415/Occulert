# Parked emergency-readiness guidance

Reviewed November 1, 2026 for
[Task 1.3](VISION_ROADMAP.md#task-13--emergency-readiness-guidance). This is
informational source preparation, not a native build, device-acceptance result
or confirmation that any Apple feature is available or configured.

## Product boundary

The iOS Settings card links to Apple’s setup guides. The existing pre-drive
screen links to that Settings guidance. These are preparation contexts, not a
measurement that the phone or vehicle is parked. The card explicitly says to
review the guides only while safely parked. It does not certify readiness,
fitness to drive or a completed setup step.

The fixed English copy and exact HTTPS destinations live in
[`emergencyReadiness.ts`](../native-app/lib/emergencyReadiness.ts). This catalog
has no runtime imports or side effects. Opening a guide is a user-directed
external link, not an emergency action. The feature reads or changes no Apple
settings, Medical ID, emergency contacts or device capabilities. It adds no
permissions, Health access, data collection, messaging, emergency calling or
Siren control. It does not activate Emergency SOS or Crash Detection, and it
cannot guarantee emergency help. Existing monitoring and alert contracts stay
separate.

No telephone/SMS URL, private settings scheme, button-press instructions,
automatic configuration, emergency demonstration or test-call action belongs
in this card. Do not infer a user’s hardware, OS, region, connectivity or
sharing choices from the presence of a link. Future copy or link changes need
a fresh primary-source review.

## Reviewed Apple guides

| Card link | Verified meaning and limit |
|---|---|
| [Medical ID and emergency contacts](https://support.apple.com/en-us/105072) | Apple Health holds the information and contact choices. Lock Screen visibility and emergency-call sharing are distinct choices; neither is enabled by this card. |
| [Emergency SOS on iPhone](https://support.apple.com/guide/iphone/iph3c99374c/ios) | Apple’s instructions and connection requirements vary by model, software and region. Optional texting, satellite and other enhanced features are not universal. |
| [Crash Detection](https://support.apple.com/en-us/104959) | Review Apple’s current device/software requirements and connectivity limits. The feature does not detect every crash. A supported-device list is deliberately not reproduced in app copy. |
| [Siren on Apple Watch Ultra](https://support.apple.com/guide/watch/apd49c8baf38/watchos) | Ultra models have a user-activated sound for attracting attention nearby. This sound is separate from contacting emergency services. The card supplies a guide, not an activation control. |
| [Apple Watch haptic settings](https://support.apple.com/en-us/108368) | Apple describes haptic preferences and skin-contact/fit guidance. Settings alone do not establish delivery or perception of any Occulert cue. |

Keep supported-model wording qualified. Apple’s
[SE 3 technical specifications](https://support.apple.com/en-us/125094)
include Crash Detection, so an older support-article model list must not be
treated as an exhaustive current device inventory. The card instead asks the
user to review the applicable Apple requirements. No universal availability
claim or automated hardware check follows from this research.

## Medical ID sharing and privacy

“Show When Locked” permits people who have the locked iPhone to view the
Medical ID without its passcode. Emergency-call sharing is a separate optional
choice, available only in supported regions. The current
[iPhone Medical ID guide](https://support.apple.com/guide/iphone/iph08022b192/ios)
describes automatic emergency-call sharing in the U.S. and Canada. Labels and
navigation can differ with OS versions; the card does not instruct every user
to enable either option.

Apple’s [Health privacy description](https://www.apple.com/legal/privacy/data/en/health-app/)
explains Medical ID visibility and optional sharing. Its
[Emergency SOS privacy description](https://www.apple.com/legal/privacy/data/en/emergency-sos/)
explains contact notifications and location sharing associated with Apple’s
emergency workflows. Adding a contact in Health, viewing this card or opening
a guide is not an Occulert notification. These contacts are not read, copied
or adopted as an Occulert contact channel.

## Verification and acceptance

Check the actual catalog and mounted card: exact owned Apple HTTPS links,
parked-only copy, qualified availability, explicit application limits, no
emergency actions and no inferred settings state. Settings/pre-drive linking
must preserve the existing monitoring lifecycle. Run the required verification
and report the actual results separately; this document claims no completed
checks.

A source merge does not update an installed iPhone app. Exact-build layout,
large-text/VoiceOver readability, link opening and return behavior still need
the normal [device acceptance](DEVICE_ACCEPTANCE.md). No signed build,
distribution, Apple setting change or physical emergency-feature test is part
of this source task. It adds no emergency-response capability to Occulert.
