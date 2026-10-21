# Compact native monitoring screen

Implemented source only. This change does not update an installed app; an exact
native build and parked device acceptance are still required.

The monitoring screen gives Start/Stop its own row outside the scrolling
status, warnings, camera setup, metrics and safe-stop shortcut. The camera
stays in the same React slot while window size, safe-area insets and text size
change. Its preview uses contain sizing so a short pane does not crop the
camera image used by the positioning check.

Tall windows stack the camera and controls. Short wide windows use columns
when at least 480 points remain after horizontal safe-area insets. Large text
uses a vertical stack. The app's portrait orientation setting is preserved;
adaptive layout does not claim landscape or multitasking camera support.

Faults and actual alert-level changes restore the status area to the top.
Ordinary metrics updates preserve its scroll position. Inline warnings have
no scaling transform that could overlap neighboring actions. Alert decisions,
cooldowns, audio, haptics, Watch delivery, consent and start/stop handlers retain
their existing behavior. The parked safe-stop sheet scrolls its choices and
keeps Cancel outside that scrolling region, within safe-area bounds.

## Software verification

Run `npm ci --include=dev && npm run verify` in `native-app`, and the root
project verification after updating its layout contracts. The native
`test:monitor-layout` suite renders actual TSX with real React and the alert
policy/delivery logic; native camera, audio and platform bridges are replaced
with software adapters. It checks component identity, control placement,
attention scrolling, text-size and safe-area adaptation, warning content and
alert delivery continuity. It does not measure physical device geometry or
establish detector accuracy.

## Parked acceptance on the exact build

- Use a small supported iPhone and the largest supported Dynamic Type sizes.
  Confirm Start/Stop remains visible and all guidance can be scrolled/read.
- Exercise camera preview, preparation, monitoring, camera interruption,
  stopped recovery and Home/Settings navigation. Confirm exactly one local
  session is saved and deliberate parked setup is required before restarting.
- Scroll details away from the warning, then verify both an escalating
  closed-eye alert and sustained tracking-loss warning return to view.
- Check VoiceOver order and activation for Start/Stop, warnings, setup,
  recovery, safe-stop choices and Cancel. Confirm the status region does not
  group away its interactive children.
- Verify safe areas on the notched/home-indicator device. Confirm the complete
  preview remains visible, the face-position guide agrees with the camera,
  and privacy/stop-before-Maps behavior is retained.
- Confirm camera behavior, alert delivery, audio routes, Silent mode, Watch
  delivery, battery/heat and interruptions against the existing device
  acceptance checklist. Software fixtures cannot close those evidence gaps.
