import AsyncStorage from '@react-native-async-storage/async-storage';
import { validEyeProbability, EYE_BASELINE_MIN_SAMPLES } from './eyeBaselineModel';
const KEY='occulert-device-eye-baseline-v1';
// A camera-switch clear must follow any in-flight parked save.
let baselineStorageQueue: Promise<void> = Promise.resolve();
function withBaselineStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = baselineStorageQueue.then(operation);
  baselineStorageQueue = result.then(() => {}, () => {});
  return result;
}
export async function loadDeviceEyeBaseline(): Promise<number|null> {
  return withBaselineStorage(async () => {
  const raw=await AsyncStorage.getItem(KEY);if(raw===null)return null;
  const value=JSON.parse(raw);
  if(value?.version!==1 || !validEyeProbability(value.baseline) || value.baseline<.5
      || !Number.isSafeInteger(value.samples) || value.samples<EYE_BASELINE_MIN_SAMPLES || value.samples>64) {
    throw new Error('Saved eye baseline could not be verified.');
  }
  return value.baseline;
  });
}
export async function saveDeviceEyeBaseline(baseline:number,samples:number) {
  if(!validEyeProbability(baseline)||baseline<.5||!Number.isSafeInteger(samples)||samples<EYE_BASELINE_MIN_SAMPLES||samples>64)throw new Error('Invalid eye baseline');
  await withBaselineStorage(() => AsyncStorage.setItem(KEY,JSON.stringify({version:1,baseline,samples})));
}
export async function clearDeviceEyeBaseline(){await withBaselineStorage(() => AsyncStorage.removeItem(KEY));}
