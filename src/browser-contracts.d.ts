interface BrowserAudioSession { type: string; }
interface Navigator { readonly audioSession?: BrowserAudioSession; }
interface Window { webkitAudioContext?: typeof AudioContext; }
declare const FaceMesh: {
  new(options: {locateFile: (file: string) => string}): import('./detector.js').LegacyDetector;
} | undefined;
// These two setters follow the browser's WebIDL string conversion at the
// existing call sites. Standard DOM getters remain strings; this is not a
// global redefinition of every element or Storage operation.
type CoercingTextElement = Omit<HTMLElement, 'textContent'> & {
  get textContent(): string | null;
  set textContent(value: string | number | null);
};
type WebIdlStorage = Omit<Storage, 'setItem'> & {
  setItem(key: string, value: string | boolean): void;
};
interface DriverExperimentFlags {
  readonly any: boolean;
  readonly primary: boolean;
  readonly names: readonly string[];
  readonly delegate?: 'CPU' | 'GPU';
  readonly elapsed?: boolean;
  readonly pixels?: boolean;
  readonly tasks?: boolean;
  readonly noface?: boolean;
  readonly timePerclos?: boolean;
  readonly pitch?: boolean;
}
interface CapturedExperimentFrame {
  readonly image: HTMLVideoElement | HTMLCanvasElement;
  readonly paired: boolean;
  readonly frameId: number;
  readonly mediaTime: number | null;
  readonly at: number;
  readonly inferenceStartedAt: number;
  legacyEndedAt: number | null;
  readonly generation: number;
  readonly calibrationRevision: number;
  readonly calibrating: boolean;
  recorded?: boolean;
  readonly skip?: false;
}
interface MountedExperimentController {
  capture(video: HTMLVideoElement): null | {skip: true; image?: never} | CapturedExperimentFrame;
  // The helper checks identity against its own private loss episode. The
  // caller cannot construct eligibility by satisfying a public shape.
  qualifiedLoss(context: unknown): boolean | undefined;
}
