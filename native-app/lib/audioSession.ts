import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';

/**
 * Configure the global audio session for Occulert alerts.
 *
 * Goals for a driving safety app:
 *  - Alerts must be audible even when the phone is on silent (iOS mute switch).
 *  - Alerts must keep playing while the app is backgrounded during a drive.
 *  - Audio should route to the active Bluetooth output (AirPods / car audio)
 *    when one is connected. iOS/Android route to the connected output device
 *    automatically; we only need the correct session category + options.
 *  - We duck (lower) other audio instead of stopping it, so navigation and
 *    music keep playing.
 *
 * Call this once before the first alert plays. Safe to call repeatedly.
 */
export async function configureAlertAudioMode(): Promise<void> {
  await Audio.setAudioModeAsync({
    // Play through the earpiece/speaker/Bluetooth even when the ringer is silenced.
    playsInSilentModeIOS: true,
    // Keep the session alive so background alerts still fire while driving.
    staysActiveInBackground: true,
    // We are not recording; keep this false so playback isn't forced to the
    // receiver and can route to AirPods / speaker.
    allowsRecordingIOS: false,
    // Lower other audio (music, nav) during an alert rather than pausing it.
    interruptionModeIOS: InterruptionModeIOS.DuckOthers,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    shouldDuckAndroid: true,
    // Route audio to speaker/Bluetooth output rather than the earpiece on Android.
    playThroughEarpieceAndroid: false,
  });
}
