import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = resolve(dirname(scriptPath), '..');
export const experimentFlag = 'OCCULERT_MULTITASKING_CAMERA_EXPERIMENT';
export const sourceRelativePath = 'node_modules/react-native-vision-camera/ios/Core/CameraSession.swift';
export const originalHash = 'f973b3f9b586dc81bbb16d40d1414edb3bb37c4190f545750c50ceda51f06d24';
const hash = source => createHash('sha256').update(source).digest('hex');

const originalStart = '      captureSession.startRunning()';
const originalRestart = '        self.captureSession.startRunning()';
const start = '      startRunningWithOcculertMultitaskingExperiment()';
const restart = '        self.startRunningWithOcculertMultitaskingExperiment()';
const anchor = '  private func checkIsActive(configuration: CameraConfiguration) {';
export const experimentHelper = `  // Occulert opt-in parked experiment. Reinstall without the flag to remove it.
  private func startRunningWithOcculertMultitaskingExperiment() {
    if !captureSession.isRunning {
      if #available(iOS 16.0, *), captureSession.isMultitaskingCameraAccessSupported {
        captureSession.isMultitaskingCameraAccessEnabled = true
      }
    }
    captureSession.startRunning()
  }

`;

export function readExperimentFlag(environment = process.env) {
  const value = environment[experimentFlag];
  if (value === undefined || value === '' || value === '0') return false;
  if (value === '1') return true;
  throw Error(`${experimentFlag} must be 0 or 1 (unset defaults to 0).`);
}

/** Restore only the precise reviewed transformation, then verify all upstream bytes. */
export function originalCameraSession(source) {
  if (hash(source) === originalHash) return source;
  const original = source.replace(experimentHelper + anchor, anchor).replace(start, originalStart).replace(restart, originalRestart);
  if (hash(original) !== originalHash || original === source) throw Error('Cannot safely patch VisionCamera multitasking: upstream source changed.');
  const expected = enable(original);
  if (source !== expected) throw Error('Cannot safely patch VisionCamera multitasking: experiment source changed.');
  return original;
}

function enable(source) {
  return source.replace(anchor, experimentHelper + anchor).replace(originalStart, start).replace(originalRestart, restart);
}

export function patchCameraMultitasking(source, version, enabled) {
  if (version !== '4.7.3') throw Error('Cannot safely patch VisionCamera multitasking: expected react-native-vision-camera 4.7.3.');
  const original = originalCameraSession(source);
  const next = enabled ? enable(original) : original;
  return { source: next, changed: next !== source };
}

export function applyCameraMultitaskingPatch(root = appRoot, environment = process.env) {
  const enabled = readExperimentFlag(environment);
  const { version } = JSON.parse(readFileSync(resolve(root, 'node_modules/react-native-vision-camera/package.json'), 'utf8'));
  const path = resolve(root, sourceRelativePath);
  const result = patchCameraMultitasking(readFileSync(path, 'utf8'), version, enabled);
  if (result.changed) writeFileSync(path, result.source);
  return { changed: result.changed, enabled };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const result = applyCameraMultitaskingPatch();
    console.log(`VisionCamera multitasking experiment ${result.enabled ? 'enabled' : 'disabled'}${result.changed ? ' (source updated)' : ''}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
