# Duo monitor layout preparation

Prepared October 24, 2026. Source and automated layout fixtures are separate
from runtime acceptance. The app retains `orientation: "portrait"`.

`AlertSystem` uses an owned portal for its optional header presentation. Its host
is a normal-flow row immediately after the custom monitor header and before the
camera/control body. The measured header and root safe-area padding therefore
count once, and the warning reserves space instead of covering Stop. The host
and informational warning pass touches through. Owner-checked cleanup prevents
an older portal from removing newer content, including React effect replay.
The normal-flow inline/docked warning does not scale outside its reserved bounds.
Header changes do not recreate the camera, alert players or pending cues.

The current monitor continues to use the inline banner in its scrolling
guidance, with Stop outside that scroll view. The warning comes before the
status pill and inner-camera note, so returning guidance to its beginning shows
the complete warning. Status and the announced camera note remain available in
the same scroll region.
At large text sizes the preview takes a smaller share of the available height,
preserving room for Stop and the full warning while keeping the camera mounted.

## Display evidence

The installed Xcode **27.1 (27A9275)** device profile is
`/Library/Developer/CoreSimulator/Profiles/DeviceTypes/iPhone Duo.simdevicetype/Contents/Resources/capabilities.plist`.
Its `capabilities.displays` entries explicitly report **both** pixel dimensions
and backing `scale: 3`; the fixture does not assume a scale from a phone model.
The installed iOS simulator runtime is **27.1 (24A94425)**.

| Display | Profile screen | Framebuffer pixels | Profile scale | Portrait points | Landscape points |
|---|---|---|---|---|---|
| Outer | `primary`, ID 1 | 1398 × 2034 | 3 | 466 × 678 | 678 × 466 |
| Inner | `primary-1`, ID 3 | 2007 × 2853 | 3 | 669 × 951 | 951 × 669 |

The captured fields and source metadata are committed in
[`iphone-duo-xcode27.1.json`](../native-app/scripts/fixtures/iphone-duo-xcode27.1.json).
Tests divide by each display's recorded scale. They cover both orientations,
equal half-width allocations of the inner display (334.5 × 951 and
475.5 × 669 points), and additional 313/445-point stress widths. Equal allocation
is an arithmetic fixture; the actual Split View divider and delivered app
viewport have not been measured. Insets are explicit stress inputs, not observed
Duo safe areas or fold/camera occlusion frames.

## Automated checks and remaining acceptance

`npm run test:monitor-layout` mounts the actual layout and alert TSX with React,
then uses the development-only Yoga engine to calculate the host tree's flex
bounds. The guidance fixture reads the actual monitor JSX and presentation
styles, including the status pill and inner-camera note. In both inline and
header presentations it checks Stop and the entire warning against the viewport
and scroll clipping, no overlap between them, a positive visible camera area,
and the same mounted camera through all 24 window/text combinations. Normal,
1.6× and 2× text are covered. Alert fixtures also check final header-relative
coordinates while details scroll, header resizing without replaying alerts or
discarding pending cues, portal ownership cleanup and React Strict Mode effect
replay. Native bridges and text metrics are
substituted; conservative text measurement is useful regression evidence, not a
native screenshot or physical-camera test.

Manual acceptance remains **open**. The current ML Kit dependency excludes arm64
simulators, so the Duo simulator cannot launch this camera build; a physical Duo
is unavailable. Index, pre-drive, monitor, History and settings still need an
exact-build manual pass in outer/inner portrait/landscape and 50/50 Split View,
including Stop, warning text, large text, fold/camera occlusions, resizing and
camera continuity. Actual safe areas, Split View viewport/divider sizes and pose
transitions must be recorded there. Keep portrait until that pass and all layout
checks succeed with `orientation: "default"`. No native reserved-region bridge
or multi-app capture support is established by this preparation.

Detection, thresholds, alert wording, cue levels, timing and delivery policy are
unchanged.

Local validation on Node 24.22.1: native clean installs with npm 10.9.8 and
11.6.2 each passed native verification (56 tests), and all 90 root checks passed.
The layout suite contains 16 tests, including the 48 composed inline/header
window/text cases. Reverting warning priority reproduces clipping with the real
preceding status and inner-camera note; reverting ownership checks lets an older portal
erase the newer owner's content.
