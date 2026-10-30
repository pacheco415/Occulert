import { useCallback, useLayoutEffect, useRef } from 'react';
import { useAudioPlayer, type AudioPlayer, type AudioSource } from 'expo-audio';

/** Own a short cue, without retaining the shared audio session while silent. */
export function useAlertAudioPlayer(source: AudioSource) {
  const player = useAudioPlayer(source, { keepAudioSessionActive: false });
  const activePlayer = useRef<AudioPlayer | null>(null);

  // Expo releases its SharedObject in a passive effect. Pause in the earlier
  // layout cleanup so completion/unmount can still request automatic release.
  // Expo checks all playing audio before deactivating; never globally disable
  // audio here, which would pause a newer alert or another screen's test tone.
  useLayoutEffect(() => {
    activePlayer.current = player;
    return () => {
      if (activePlayer.current === player) activePlayer.current = null;
      try { player.pause(); } catch {}
    };
  }, [player]);

  const isCurrent = useCallback(() => activePlayer.current === player, [player]);
  return { player, isCurrent };
}
