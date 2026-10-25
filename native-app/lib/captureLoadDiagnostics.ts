import type { CaptureLoadConfiguration } from './captureLoadPolicy';

export interface CaptureLoadSnapshot {
  available: number;
  width: number;
  height: number;
  fps: number;
  changes: number;
  unavailableConfigurations: number;
  transitionGraceCount: number;
}

/** Fixed-size, local numeric diagnostics; no device IDs, frames or clock series. */
export function createCaptureLoadDiagnostics() {
  let current: CaptureLoadSnapshot | undefined;
  return {
    record(configuration: CaptureLoadConfiguration | null, graceGranted = false) {
      if (configuration && (
        !Number.isFinite(configuration.width) || configuration.width <= 0
        || !Number.isFinite(configuration.height) || configuration.height <= 0
        || ![15, 30].includes(configuration.fps)
      )) return;
      const next = {
        available: configuration ? 1 : 0,
        width: configuration?.width ?? 0,
        height: configuration?.height ?? 0,
        fps: configuration?.fps ?? 0,
      };
      const changed = current && (['available', 'width', 'height', 'fps'] as const)
        .some(key => current![key] !== next[key]);
      current = {
        ...next,
        changes: (current?.changes ?? 0) + (changed ? 1 : 0),
        unavailableConfigurations: (current?.unavailableConfigurations ?? 0) + (configuration ? 0 : 1),
        transitionGraceCount: (current?.transitionGraceCount ?? 0) + (graceGranted ? 1 : 0),
      };
    },
    reset() { current = undefined; },
    snapshot(): CaptureLoadSnapshot | undefined { return current ? { ...current } : undefined; },
  };
}
