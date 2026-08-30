import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUDIO_ALERT_PREFERENCE_KEY,
  HAPTIC_ALERT_PREFERENCE_KEY,
  IN_EAR_ALERT_PREFERENCE_KEY,
  createAlertPreferenceStore,
} from '../native-app/lib/alertPreferenceStore.ts';
import { IN_EAR_ALERT_PATTERN_KEY } from '../native-app/lib/inEarAlerts.ts';

function memoryStorage(values = {}) {
  const stored = new Map(Object.entries(values));
  let reads = 0;
  let writes = 0;
  return {
    stored,
    counts: () => ({ reads, writes }),
    storage: {
      async getItem(key) {
        reads += 1;
        return stored.get(key) ?? null;
      },
      async setItem(key, value) {
        writes += 1;
        stored.set(key, value);
      },
    },
  };
}

test('alert preferences load once and stay synchronously available', async () => {
  assert.equal(IN_EAR_ALERT_PREFERENCE_KEY, IN_EAR_ALERT_PATTERN_KEY);
  const memory = memoryStorage({
    [HAPTIC_ALERT_PREFERENCE_KEY]: 'false',
    [AUDIO_ALERT_PREFERENCE_KEY]: 'true',
    [IN_EAR_ALERT_PREFERENCE_KEY]: 'alternating',
  });
  const store = createAlertPreferenceStore(memory.storage);

  const first = store.get();
  const second = store.get();
  assert.equal(first, second, 'concurrent startup reads should be deduplicated');
  assert.deepEqual(await first, {
    hapticEnabled: false,
    audioEnabled: true,
    inEarPattern: 'alternating',
  });
  assert.deepEqual(store.current(), await second);
  assert.deepEqual(memory.counts(), { reads: 3, writes: 0 });

  await store.get();
  assert.deepEqual(memory.counts(), { reads: 3, writes: 0 });
});

test('confirmed Settings writes update the alert fast-path snapshot', async () => {
  const memory = memoryStorage();
  const store = createAlertPreferenceStore(memory.storage);
  await store.get();

  await store.storage.setItem(AUDIO_ALERT_PREFERENCE_KEY, 'false');
  await store.storage.setItem(HAPTIC_ALERT_PREFERENCE_KEY, 'false');
  await store.storage.setItem(IN_EAR_ALERT_PREFERENCE_KEY, 'alternating');

  assert.deepEqual(store.current(), {
    hapticEnabled: false,
    audioEnabled: false,
    inEarPattern: 'alternating',
  });
  assert.deepEqual(memory.counts(), { reads: 3, writes: 3 });
});

test('failed Settings writes do not replace the confirmed alert snapshot', async () => {
  const memory = memoryStorage({ [AUDIO_ALERT_PREFERENCE_KEY]: 'true' });
  const store = createAlertPreferenceStore({
    getItem: memory.storage.getItem,
    async setItem() {
      throw new Error('storage unavailable');
    },
  });
  await store.get();

  await assert.rejects(
    store.storage.setItem(AUDIO_ALERT_PREFERENCE_KEY, 'false'),
    /storage unavailable/,
  );
  assert.equal(store.current().audioEnabled, true);
});
