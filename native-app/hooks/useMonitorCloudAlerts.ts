import React, { useCallback } from 'react';
import { EyeMetrics } from '../hooks/useEyeTracking';

interface Options {
  prevAlertingRef: React.RefObject<boolean>;
  alertCountRef: React.RefObject<number>;
  setAlertCount: React.Dispatch<React.SetStateAction<number>>;
  cloudSessionRef: React.RefObject<Promise<string | null> | null>;
  cloudEventQueueRef: React.RefObject<Promise<void>>;
  queueNativeCloudAlert: (session: Promise<string | null>, fatigueScore: number, occurredAt: string) => Promise<void> | null;
  logCloudAlert: (sessionId: string, fatigueScore: number, occurredAt?: string) => Promise<boolean>;
}

export function useMonitorCloudAlerts({
  prevAlertingRef, alertCountRef, setAlertCount,
  cloudSessionRef, cloudEventQueueRef, logCloudAlert, queueNativeCloudAlert,
}: Options) {
  const recordCloudAlertTransition = useCallback((result: EyeMetrics, now: number) => {
    const alerting = result.state === 'closed';
    if (alerting && !prevAlertingRef.current) {
      alertCountRef.current += 1;
      setAlertCount(alertCountRef.current);
      const cloudSession = cloudSessionRef.current;
      if (cloudSession) {
        const occurredAt = new Date(now).toISOString();
        const retryWork = queueNativeCloudAlert(cloudSession, result.fatigueScore, occurredAt);
        if (retryWork) cloudEventQueueRef.current = Promise.all([cloudEventQueueRef.current, retryWork]).then(() => {}).catch(() => {});
        else cloudEventQueueRef.current = cloudEventQueueRef.current
          .then(async () => {
            const sessionId = await cloudSession;
            if (sessionId) await logCloudAlert(sessionId, result.fatigueScore, occurredAt);
          })
          .catch(() => {});
      }
    }
    prevAlertingRef.current = alerting;
  }, [logCloudAlert, queueNativeCloudAlert]);

  return recordCloudAlertTransition;
}
