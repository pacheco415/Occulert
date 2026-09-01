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
  title: 'Check your camera setup',
  detail: 'While parked, start the camera check and position the phone where it will stay for the drive.',
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
      title: 'Center your face in view',
      detail: 'Move the mounted phone until your full face is visible. Keep adjusting only while parked.',
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
      title: 'Reposition the mounted phone',
      detail: 'Center your face in the preview without reaching for the phone after the vehicle moves.',
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
      title: faceAreaRatio < 0.025 ? 'Move the phone closer' : 'Move the phone farther away',
      detail: 'Your full face and both eyes should remain comfortably inside the preview.',
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
      title: 'Aim the phone toward your face',
      detail: 'Adjust the parked mount so Occulert can see your eyes during normal forward-facing driving.',
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
      title: 'Improve eye visibility',
      detail: 'Clean the lens and use more even light. Glare, deep shadow, or an obstruction may hide the eyes.',
      ready: false,
      faceCentered,
      faceSized,
      eyesVisible,
      facingCamera,
    };
  }

  return {
    state: 'ready',
    title: 'Camera setup looks ready',
    detail: 'Your face and eyes are visible. Secure the phone and do not adjust it while driving.',
    ready: true,
    faceCentered,
    faceSized,
    eyesVisible,
    facingCamera,
  };
}
