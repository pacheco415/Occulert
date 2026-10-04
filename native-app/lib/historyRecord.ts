import type { FeedbackSession, SessionDeviceImpact, SessionTestConditions } from './feedback';
import type { MonitorPerformanceSnapshot } from './monitorPerformance';
import type { SensorFusionObservationSnapshot } from './sensorFusionObservation';

export interface SessionRecord extends FeedbackSession {
  driverId?: string;
  cloudSynced?: boolean;
  cloudSessionId?: string;
  assessmentUpdatedAt?: string;
  conditionsUpdatedAt?: string;
  deviceImpactUpdatedAt?: string;
  monitorPerformance?: MonitorPerformanceSnapshot;
  sensorFusion?: SensorFusionObservationSnapshot;
  recoveredFromInterruption?: boolean;
  recoveryNote?: string;
}

export type TestConditionKey = keyof SessionTestConditions;
export type TestConditionValue = NonNullable<SessionTestConditions[TestConditionKey]>;

export interface TestConditionGroup {
  key: TestConditionKey;
  label: string;
  options: Array<{ value: TestConditionValue; label: string }>;
}

export type DeviceImpactKey = keyof SessionDeviceImpact;
export type DeviceImpactValue = NonNullable<SessionDeviceImpact[DeviceImpactKey]>;

export interface DeviceImpactGroup {
  key: DeviceImpactKey;
  label: string;
  options: Array<{ value: DeviceImpactValue; label: string }>;
}

export type SessionOperation = 'saving' | 'deleting' | 'feedback';
export type HistoryRecordedFilterKey = 'sensitivity' | 'lighting' | 'eyewear';
