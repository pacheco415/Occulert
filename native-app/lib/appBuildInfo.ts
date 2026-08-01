import Constants from 'expo-constants';

export interface AppBuildInfo {
  appVersion?: string;
  appBuildNumber?: string;
}

function normalized(value: string | number | null | undefined): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

export function currentAppBuildInfo(): AppBuildInfo {
  const nativeBuild = Constants.platform?.ios?.buildNumber
    ?? Constants.platform?.android?.versionCode
    ?? Constants.expoConfig?.ios?.buildNumber
    ?? Constants.expoConfig?.android?.versionCode;
  return {
    appVersion: normalized(Constants.expoConfig?.version),
    appBuildNumber: normalized(nativeBuild),
  };
}
