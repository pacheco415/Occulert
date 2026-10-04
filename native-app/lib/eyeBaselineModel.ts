import { SENSITIVITY_PRESETS, type SensitivityLevel, type SensitivityPreset } from '../constants/thresholds.ts';

export const EYE_BASELINE_EXPERIMENT = process.env.EXPO_PUBLIC_EYE_BASELINE_EXPERIMENT === '1';
export const EYE_BASELINE_WINDOW_MS = 3000;
export const EYE_BASELINE_MIN_SAMPLES = 8;
export function validEyeProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
export function trimmedEyeBaseline(samples: number[]): number | null {
  const valid = samples.filter(validEyeProbability).sort((a,b)=>a-b);
  if (valid.length < EYE_BASELINE_MIN_SAMPLES) return null;
  const trim = Math.floor(valid.length * .2), middle = valid.slice(trim,valid.length-trim);
  const mean = middle.reduce((sum,value)=>sum+value,0)/middle.length;
  return mean >= .5 && mean <= 1 ? mean : null;
}
export function baselinePreset(level: SensitivityLevel, baseline: number | null): SensitivityPreset {
  const preset = SENSITIVITY_PRESETS[level];
  if (!validEyeProbability(baseline) || baseline < .5) return preset;
  const closed = Math.max(.1,Math.min(.22,preset.eyeClosedThreshold*baseline));
  const watch = Math.max(closed+.015,Math.min(.28,preset.eyeWatchThreshold*baseline));
  return {...preset,eyeClosedThreshold:closed,eyeWatchThreshold:watch};
}
export class ParkedEyeBaseline {
  private startedAt: number | null = null;
  private previousAt: number | null = null;
  private samples: number[] = [];
  reset() {this.startedAt=null;this.previousAt=null;this.samples=[];}
  add(now: number, left: unknown, right: unknown, ready: boolean) {
    if (!Number.isFinite(now) || !ready || !validEyeProbability(left) || !validEyeProbability(right)
        || this.previousAt!==null&&(now<this.previousAt || now-this.previousAt>500)) {
      this.reset();return {progress:0,done:false,baseline:null,samples:0};
    }
    this.startedAt ??= now;this.previousAt=now;
    if(this.samples.length===64)this.samples.shift();this.samples.push((left+right)/2);
    const progress=Math.min(1,Math.max(0,(now-this.startedAt)/EYE_BASELINE_WINDOW_MS));
    return {progress,done:progress===1,baseline:progress===1?trimmedEyeBaseline(this.samples):null,samples:this.samples.length};
  }
}
