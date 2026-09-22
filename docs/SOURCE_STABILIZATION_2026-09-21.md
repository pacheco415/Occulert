# Source-only stabilization — September 21, 2026

## Release notes

This local source package improves the Occulert website and native app without
queuing a native build or publishing the website.

- Website navigation now has consistent keyboard skip links, accessible mobile
  menu state, larger touch targets, improved fleet mobile layouts, and clearer
  field-level fleet-request validation.
- Native session history now supports filters, review progress, privacy-limited
  sharing, individual deletion, and clearer local-versus-cloud status.
- Native Settings now explains local data and provides confirmed controls for
  deleting local history or an interrupted-drive recovery checkpoint.
- Native setup, recovery, safe-stop, cloud, and connected-device controls have
  clearer labels, larger-text layouts, and system Reduce Motion and Reduce
  Transparency support.
- Stabilization review fixed a stale-confirmation deletion race and made history
  reads wait for pending local writes before updating the screen.
- A temporary local-storage read failure now keeps any last-loaded sessions
  visible, explains that saved data was not deleted, and offers an accessible
  retry instead of showing a misleading empty-history screen.
- Review changes and deletion now run one operation at a time per session,
  announce their pending state, and temporarily disable conflicting controls.
- Settings now keeps destructive local-data controls disabled until session and
  recovery status are confirmed, explains read failures, and offers a retry.
- Home now prevents a new session from starting while interrupted-drive
  recovery is still checking or has failed, protecting an unresolved checkpoint
  from being replaced before retry succeeds.
- Recovery storage now rejects a different session before monitoring starts,
  so restored routes and direct navigation cannot bypass the Home-screen guard.
- A recovery-blocked monitoring screen now provides a direct accessible action
  back to Home, where the interrupted-drive recovery check can run again.

## Local verification completed

- Full source verification suite passed.
- Native TypeScript check passed.
- Expo dependency compatibility check passed without changing dependencies.
- Website asset-version, integrity, cache-policy, offline-shell, and CSP checks
  passed.
- 192 browser tests passed in Chromium and WebKit.
- No native build, TestFlight submission, website deployment, push, or pull
  request was created.

## Physical-device checklist for a future approved build

- Install over the current pilot build and confirm existing local session
  history and preferences remain intact.
- With VoiceOver and larger text enabled, review Home, pre-drive, monitoring,
  History, Settings, cloud sign-in, and every destructive confirmation.
- Toggle Reduce Motion and Reduce Transparency while the app is open; confirm
  modal animation and glass surfaces update without hiding controls.
- Delete one session after leaving its confirmation open briefly; confirm only
  the named session is removed. Then verify Delete All and recovery-checkpoint
  clearing remain separate and do not imply cloud deletion.
- Start monitoring, force-quit after at least one checkpoint, relaunch, and
  confirm one clearly marked partial recovery record appears without replacing
  a complete record.
- Verify parked camera framing guidance, normal monitoring, foreground-loss
  stop, camera interruption recovery, and the safe-stop Maps handoff.
- Verify phone audio and haptics through the speaker, AirPods or Bluetooth, and
  car audio; confirm music/navigation audio returns normally after tests.
- Verify Apple Watch live status, foreground haptics, background notification,
  locked-screen behavior, queued fallback, and Settings test feedback.
- Verify optional Apple Health permission, refresh, local-summary removal, and
  the no-fitness-to-drive wording.
- Verify cloud sign-in, explicit sync consent, sign-out, offline behavior, and
  the separation between local deletion and protected cloud records.
- Run a representative 30–60 minute drive test and record battery use, phone
  heat, camera stalls, alert timing, false alerts, missed alerts, and late alerts.

Physical results must be recorded separately; passing source checks does not
claim real-device alert timing, accessory delivery, thermal performance, or
driving-safety effectiveness.
