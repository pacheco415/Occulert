export interface HeadPoseSample {
  at: number;
  faceFound: boolean;
  pitchAngle?: number;
  yawAngle?: number;
  rollAngle?: number;
}

export interface HeadNodObservationResult {
  observed: boolean;
  calibrated: boolean;
  phase: 'calibrating' | 'steady' | 'excursion';
  baselinePitch: number | null;
  pitchDelta: number | null;
}

const CALIBRATION_SAMPLES = 15;
const MAX_SIDE_ANGLE_DEG = 25;
const EXCURSION_DEG = 12;
const RETURN_DEG = 6;
const MIN_EXCURSION_MS = 180;
const MAX_EXCURSION_MS = 1_500;
const OBSERVATION_COOLDOWN_MS = 2_000;
const BASELINE_ADAPTATION = 0.05;

/**
 * Detects candidate head-nod observations from the face detector's pitch
 * angle. This signal is intentionally observational: it does not change the
 * fatigue score or trigger an alert until real-device evidence supports that
 * behavior.
 */
export class HeadNodDetector {
  private baselinePitch: number | null = null;
  private calibrationSamples = 0;
  private phase: HeadNodObservationResult['phase'] = 'calibrating';
  private excursionStartedAt: number | null = null;
  private lastObservationAt = Number.NEGATIVE_INFINITY;
  private lastSampleAt = Number.NEGATIVE_INFINITY;

  reset(): void {
    this.baselinePitch = null;
    this.calibrationSamples = 0;
    this.phase = 'calibrating';
    this.excursionStartedAt = null;
    this.lastObservationAt = Number.NEGATIVE_INFINITY;
    this.lastSampleAt = Number.NEGATIVE_INFINITY;
  }

  update(sample: HeadPoseSample): HeadNodObservationResult {
    const pitch = sample.pitchAngle;
    const yaw = sample.yawAngle;
    const roll = sample.rollAngle;
    const validPose = sample.faceFound
      && Number.isFinite(sample.at)
      && typeof pitch === 'number' && Number.isFinite(pitch)
      && typeof yaw === 'number' && Number.isFinite(yaw)
      && typeof roll === 'number' && Number.isFinite(roll);

    if (!validPose || sample.at <= this.lastSampleAt) {
      this.cancelExcursion();
      return this.result(false, null);
    }
    this.lastSampleAt = sample.at;

    if (Math.abs(yaw) > MAX_SIDE_ANGLE_DEG || Math.abs(roll) > MAX_SIDE_ANGLE_DEG) {
      this.cancelExcursion();
      return this.result(false, null);
    }

    if (this.baselinePitch === null || this.calibrationSamples < CALIBRATION_SAMPLES) {
      this.calibrationSamples += 1;
      this.baselinePitch = this.baselinePitch === null
        ? pitch
        : this.baselinePitch + (pitch - this.baselinePitch) / this.calibrationSamples;
      if (this.calibrationSamples >= CALIBRATION_SAMPLES) this.phase = 'steady';
      return this.result(false, pitch - this.baselinePitch);
    }

    const delta = pitch - this.baselinePitch;
    if (this.phase === 'excursion') {
      const duration = sample.at - (this.excursionStartedAt ?? sample.at);
      if (duration > MAX_EXCURSION_MS) {
        this.cancelExcursion();
        return this.result(false, delta);
      }
      if (duration >= MIN_EXCURSION_MS && Math.abs(delta) <= RETURN_DEG) {
        this.phase = 'steady';
        this.excursionStartedAt = null;
        this.lastObservationAt = sample.at;
        this.adaptBaseline(delta);
        return this.result(true, delta);
      }
      return this.result(false, delta);
    }

    if (
      Math.abs(delta) >= EXCURSION_DEG
      && sample.at - this.lastObservationAt >= OBSERVATION_COOLDOWN_MS
    ) {
      this.phase = 'excursion';
      this.excursionStartedAt = sample.at;
      return this.result(false, delta);
    }

    if (Math.abs(delta) <= RETURN_DEG) this.adaptBaseline(delta);
    return this.result(false, delta);
  }

  private cancelExcursion(): void {
    this.excursionStartedAt = null;
    this.phase = this.calibrationSamples >= CALIBRATION_SAMPLES ? 'steady' : 'calibrating';
  }

  private adaptBaseline(delta: number): void {
    if (this.baselinePitch !== null) this.baselinePitch += delta * BASELINE_ADAPTATION;
  }

  private result(observed: boolean, pitchDelta: number | null): HeadNodObservationResult {
    return {
      observed,
      calibrated: this.calibrationSamples >= CALIBRATION_SAMPLES,
      phase: this.phase,
      baselinePitch: this.baselinePitch,
      pitchDelta,
    };
  }
}
