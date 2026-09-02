import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const nativeAppRoot = resolve(dirname(scriptPath), '..');
const watchConnectivitySourcePath = resolve(
  nativeAppRoot,
  'node_modules/react-native-watch-connectivity/ios/WatchConnectivity.mm',
);

export const vulnerableUserInfoErrorCallback =
  '    [self dispatchEventWithName:EVENT_WATCH_USER_INFO_ERROR body:@{@"userInfo": [userInfoTransfer userInfo], @"error": dictionaryFromError(error)}];';

export const hardenedUserInfoErrorCallback = `    NSMutableDictionary<NSString *, id> *body =
      [@{@"error": dictionaryFromError(error)} mutableCopy];
    NSDictionary<NSString *, id> *userInfo = [userInfoTransfer userInfo];
    if (userInfo != nil) {
      body[@"userInfo"] = userInfo;
    }
    [self dispatchEventWithName:EVENT_WATCH_USER_INFO_ERROR body:body];`;

export function patchWatchConnectivitySource(source) {
  if (source.includes(hardenedUserInfoErrorCallback)) {
    return { source, changed: false };
  }
  if (!source.includes(vulnerableUserInfoErrorCallback)) {
    throw new Error(
      'Cannot safely patch react-native-watch-connectivity: the upstream error callback changed.',
    );
  }
  return {
    source: source.replace(
      vulnerableUserInfoErrorCallback,
      hardenedUserInfoErrorCallback,
    ),
    changed: true,
  };
}

export function applyWatchConnectivityPatch(path = watchConnectivitySourcePath) {
  const currentSource = readFileSync(path, 'utf8');
  const result = patchWatchConnectivitySource(currentSource);
  if (result.changed) writeFileSync(path, result.source);
  return result.changed;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const changed = applyWatchConnectivityPatch();
    console.log(
      changed
        ? 'Applied WatchConnectivity nil-safety patch.'
        : 'WatchConnectivity nil-safety patch already applied.',
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
