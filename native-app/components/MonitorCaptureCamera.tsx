import React, { useEffect, useMemo } from 'react';
import { Camera, useCameraFormat, type CameraProps, type FormatFilter } from 'react-native-vision-camera';
import {
  CAPTURE_LOAD_EXPERIMENT,
  captureLoadConfiguration,
  selectCaptureLoadFormat,
  type CaptureLoadConfiguration,
} from '../lib/captureLoadPolicy';
import type { CameraLoadPolicy } from '../lib/cameraResilience';

export interface CaptureConfigurationChange {
  key: string;
  configuration: CaptureLoadConfiguration | null;
}

interface MonitorCaptureCameraProps extends CameraProps {
  loadMode: CameraLoadPolicy['mode'];
  monitoring: boolean;
  experimentEnabled?: boolean;
  onCaptureConfiguration: (change: CaptureConfigurationChange) => void;
}

const CAPTURE_FILTERS: FormatFilter[] = [{ videoResolution: { width: 1_280, height: 720 } }, { fps: 30 }];

/** Preserve native Camera props exactly when the capture experiment is off. */
export function MonitorCaptureCamera({
  loadMode, monitoring, experimentEnabled = CAPTURE_LOAD_EXPERIMENT,
  onCaptureConfiguration, ...cameraProps
}: MonitorCaptureCameraProps) {
  const candidate = useMemo(() => experimentEnabled
    ? selectCaptureLoadFormat(cameraProps.device.formats)
    : undefined, [cameraProps.device, experimentEnabled]);
  const filteredDevice = useMemo(() => candidate
    ? { ...cameraProps.device, formats: [candidate] }
    : undefined, [cameraProps.device, candidate]);
  // A single prevalidated candidate makes the hook's preference scoring safe.
  // An empty formats array would throw; undefined preserves default capture.
  const format = useCameraFormat(filteredDevice, CAPTURE_FILTERS);
  const configuration = useMemo(() => captureLoadConfiguration(experimentEnabled, format, loadMode),
    [experimentEnabled, format, loadMode]);
  const configurationKey = format && configuration
    ? JSON.stringify(format) + ':' + configuration.fps
    : 'default';

  useEffect(() => {
    if (!experimentEnabled || !monitoring) return;
    onCaptureConfiguration({ key: configurationKey, configuration });
  }, [configuration, configurationKey, experimentEnabled, monitoring, onCaptureConfiguration]);

  const captureProps = configuration && format ? { format, fps: configuration.fps } : {};
  // Keep the real device identity and every callback/frame-processor prop.
  return <Camera {...cameraProps} {...captureProps} />;
}
