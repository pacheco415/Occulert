import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { isSimulatorTraceConfiguration } from './simulatorTraceModel';

export const SIMULATOR_TRACE = isSimulatorTraceConfiguration(
  Platform.OS, Constants.expoConfig?.extra?.simulatorTrace, Constants.expoConfig?.ios?.bundleIdentifier,
);
