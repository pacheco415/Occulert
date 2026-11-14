import { strings } from './strings.ts';
export type CameraSetupState =
  | 'waiting'
  | 'no-face'
  | 'reposition'
  | 'visibility'
  | 'ready';

export interface CameraSetupSample {
  faceFound: boolean;
  faceX: number;
  faceY: number;
  faceWidth: number;
  faceHeight: number;
  frameWidth: number;
  frameHeight: number;
  leftEyeOpenProbability: number;
  rightEyeOpenProbability: number;
  pitchAngle: number;
  yawAngle: number;
  rollAngle: number;
}

export interface CameraSetupAssessment {
  state: CameraSetupState;
  title: string;
  detail: string;
  ready: boolean;
  faceCentered: boolean;
  faceSized: boolean;
  eyesVisible: boolean;
  facingCamera: boolean;
}

const WAITING_ASSESSMENT: CameraSetupAssessment = {
  state: 'waiting',
  title: strings.monitor.cameraSetup.waitingTitle,
  detail: strings.monitor.cameraSetup.waitingDetail,
  ready: false,
  faceCentered: false,
  faceSized: false,
  eyesVisible: false,
  facingCamera: false,
};

export function initialCameraSetupAssessment(): CameraSetupAssessment {
  return { ...WAITING_ASSESSMENT };
}

function validPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function assessCameraSetup(sample: CameraSetupSample): CameraSetupAssessment {
  if (
    !sample.faceFound
    || !validPositive(sample.frameWidth)
    || !validPositive(sample.frameHeight)
    || !validPositive(sample.faceWidth)
    || !validPositive(sample.faceHeight)
  ) {
    return {
      state: 'no-face',
      title: strings.monitor.cameraSetup.noFaceTitle,
      detail: strings.monitor.cameraSetup.noFaceDetail,
      ready: false,
      faceCentered: false,
      faceSized: false,
      eyesVisible: false,
      facingCamera: false,
    };
  }

  const frameArea = sample.frameWidth * sample.frameHeight;
  const faceAreaRatio = (sample.faceWidth * sample.faceHeight) / frameArea;
  const centerX = (sample.faceX + sample.faceWidth / 2) / sample.frameWidth;
  const centerY = (sample.faceY + sample.faceHeight / 2) / sample.frameHeight;
  const faceCentered = centerX >= 0.18 && centerX <= 0.82
    && centerY >= 0.15 && centerY <= 0.85;
  const faceSized = faceAreaRatio >= 0.025 && faceAreaRatio <= 0.48;
  const eyesVisible = sample.leftEyeOpenProbability >= 0
    && sample.rightEyeOpenProbability >= 0;
  const facingCamera = Math.abs(sample.pitchAngle) <= 28
    && Math.abs(sample.yawAngle) <= 28
    && Math.abs(sample.rollAngle) <= 35;

  if (!faceCentered) {
    return {
      state: 'reposition',
      title: strings.monitor.cameraSetup.repositionTitle,
      detail: strings.monitor.cameraSetup.repositionDetail,
      ready: false,
      faceCentered,
      faceSized,
      eyesVisible,
      facingCamera,
    };
  }

  if (!faceSized) {
    return {
      state: 'reposition',
      title: faceAreaRatio < 0.025 ? strings.monitor.cameraSetup.closerTitle : strings.monitor.cameraSetup.fartherTitle,
      detail: strings.monitor.cameraSetup.distanceDetail,
      ready: false,
      faceCentered,
      faceSized,
      eyesVisible,
      facingCamera,
    };
  }

  if (!facingCamera) {
    return {
      state: 'reposition',
      title: strings.monitor.cameraSetup.aimTitle,
      detail: strings.monitor.cameraSetup.aimDetail,
      ready: false,
      faceCentered,
      faceSized,
      eyesVisible,
      facingCamera,
    };
  }

  if (!eyesVisible) {
    return {
      state: 'visibility',
      title: strings.monitor.cameraSetup.visibilityTitle,
      detail: strings.monitor.cameraSetup.visibilityDetail,
      ready: false,
      faceCentered,
      faceSized,
      eyesVisible,
      facingCamera,
    };
  }

  return {
    state: 'ready',
    title: strings.monitor.cameraSetup.readyTitle,
    detail: strings.monitor.cameraSetup.readyDetail,
    ready: true,
    faceCentered,
    faceSized,
    eyesVisible,
    facingCamera,
  };
}
