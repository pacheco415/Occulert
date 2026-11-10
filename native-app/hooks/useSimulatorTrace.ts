import { useEffect, useRef, useState } from 'react';
import { SIMULATOR_TRACE_INTERVAL_MS, simulatorTraceSample, type SimulatorTracePhase } from '../lib/simulatorTraceModel';

export type SimulatorEyeStateHandler = (
  left: number, right: number, faceFound: boolean, pitch: number, yaw: number, roll: number,
  inferenceMs: number, x: number, y: number, width: number, height: number, frameWidth: number, frameHeight: number,
) => void;

export function useSimulatorTrace(enabled: boolean, onEyeState: SimulatorEyeStateHandler) {
  const callback = useRef(onEyeState);
  callback.current = onEyeState;
  const [phase, setPhase] = useState<SimulatorTracePhase>('open');
  useEffect(() => {
    if (!enabled) return;
    const startedAt = Date.now();
    const tick = () => {
      const sample = simulatorTraceSample(Date.now() - startedAt);
      setPhase(sample.phase);
      callback.current(sample.eyeProbability, sample.eyeProbability, sample.faceFound,
        0, 0, 0, 0, 320, 180, 640, 360, 1_280, 720);
    };
    tick();
    const timer = setInterval(tick, SIMULATOR_TRACE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  return phase;
}
