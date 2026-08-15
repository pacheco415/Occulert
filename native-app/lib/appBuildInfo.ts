import Constants from 'expo-constants';

export interface AppBuildInfo {
  appVersion?: string;
  appBuildNumber?: string;
}

export function formatAppBuildLabel({ appVersion, appBuildNumber }: AppBuildInfo): string {
  if (appVersion && appBuildNumber) return `v${appVersion} (${appBuildNumber})`;
  if (appVersion) return `v${appVersion}`;
  if (appBuildNumber) return `Build ${appBuildNumber}`;
  return 'Version unavailable';
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
