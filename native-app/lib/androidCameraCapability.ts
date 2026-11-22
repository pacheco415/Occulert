import { requireOptionalNativeModule } from 'expo-modules-core';
import type { CameraReadiness } from './deviceReadiness';

type CameraCapability = Pick<CameraReadiness, 'multiCamSupported' | 'frontBackMultiCamSupported'>;
type ConcurrentCameraModule = { getConcurrentLensFacings(): Promise<unknown> };

export async function getAndroidCameraCapability(): Promise<CameraCapability> {
  const unknown = { multiCamSupported: null, frontBackMultiCamSupported: null };
  try {
    const bridge = requireOptionalNativeModule<ConcurrentCameraModule>('OcculertConcurrentCamera');
    const groups = await bridge?.getConcurrentLensFacings();
    if (!Array.isArray(groups)) return unknown;

    let multiCamSupported = false;
    let possiblePair = false;
    for (const group of groups) {
      if (!Array.isArray(group) || group.length < 2) return unknown;
      multiCamSupported = true;
      const front = group.includes('front');
      const back = group.includes('back');
      if (front && back) return { multiCamSupported, frontBackMultiCamSupported: true };

      const unclassified = group.filter(facing => !['front', 'back', 'external'].includes(facing)).length;
      if (unclassified >= 2 || (unclassified === 1 && (front || back))) possiblePair = true;
    }
    return { multiCamSupported, frontBackMultiCamSupported: possiblePair ? null : false };
  } catch {
    return unknown;
  }
}
