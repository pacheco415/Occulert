// Durable aggregate telemetry plus narrowly scoped cleanup capabilities.
// Account credentials and sensor media never enter this store.
interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
export interface PendingSession {
  id: string;
  owner: string;
  cancelToken?: string;
  cleanupToken?: string;
  start: Record<string, unknown>;
  created: boolean;
  createAttempted?: boolean;
  abandoned?: boolean;
  partial?: boolean;
  cleanupId?: string;
  cleanupIds?: string[];
  events: Array<{ id: string; body: Record<string, unknown> }>;
  finish?: Record<string, unknown>;
  localSessionId?: string;
}

export type SessionUploadOutcome = 'sent' | 'retry' | 'discard' | { cleanupIds: string[] };
const MAX_CLEANUP_ATTEMPTS_PER_FLUSH = 3;
export function createSessionOutbox(storage: Storage) {
  const key = 'occulert-session-outbox-v1';
  let mutations = Promise.resolve();
  let flight: Promise<void> | null = null;
  let revocation: Promise<void> | null = null;
  let revoking = false;
  let epoch = 0;
  const activeCleanupCandidates = new Map<string, PendingSession>();
  function explicitCleanupIds(row: PendingSession): string[] {
    return [...new Set([
      ...(typeof row.cleanupId === 'string' ? [row.cleanupId] : []),
      ...(Array.isArray(row.cleanupIds) ? row.cleanupIds.filter(id => typeof id === 'string') : []),
    ])];
  }
  function hasExplicitCleanup(row: PendingSession): boolean {
    return explicitCleanupIds(row).length > 0;
  }
  function cleanupTombstone(row: PendingSession): PendingSession | null {
    if (
      typeof row?.id !== 'string'
      || typeof row?.owner !== 'string'
      || (!row.created && row.createAttempted === false && !hasExplicitCleanup(row))
    ) return null;
    return {
      id: row.id,
      owner: row.owner,
      ...(row.cancelToken ? { cancelToken: row.cancelToken } : {}),
      ...(row.cleanupToken ? { cleanupToken: row.cleanupToken } : {}),
      start: { client_session_id: row.id },
      created: Boolean(row.created),
      createAttempted: Boolean(row.createAttempted),
      abandoned: true,
      events: [],
      ...(row.cleanupId ? { cleanupId: row.cleanupId } : {}),
      ...(row.cleanupIds?.length ? { cleanupIds: explicitCleanupIds(row) } : {}),
      ...(row.localSessionId ? { localSessionId: row.localSessionId } : {}),
    };
  }
  function rememberCleanupCandidate(row: PendingSession): void {
    const tombstone = cleanupTombstone(row);
    if (tombstone) activeCleanupCandidates.set(row.id, tombstone);
  }
  function forgetCleanupCandidate(id: string, version: number): void {
    if (version === epoch) activeCleanupCandidates.delete(id);
  }
  async function read(): Promise<PendingSession[]> {
    const raw = await storage.getItem(key);
    const rows = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(rows)) throw new Error('invalid_outbox');
    return rows;
  }
  async function recover(version: number): Promise<void> {
    const rows = await read();
    if (version !== epoch) return;
    // A relaunch must not replay an interrupted drive as a newly active session.
    // Recover unfinished rows as owner-scoped cleanup work. This also removes a
    // server row when the create request succeeded but its local acknowledgement
    // was lost immediately before the process stopped.
    const recovered = rows.flatMap(row => {
      if (row.finish) return [row];
      // New rows persist createAttempted=false before any network work. They
      // cannot have a server counterpart and need no cleanup after a restart.
      if (!row.created && row.createAttempted === false) return [];
      return [{ ...row, abandoned: true, events: [] }];
    });
    if (recovered.length !== rows.length || recovered.some((row, index) => row !== rows[index])) {
      await storage.setItem(key, JSON.stringify(recovered));
    }
  }
  function startRecovery(version: number): Promise<void> {
    const attempt = recover(version);
    void attempt.catch(() => {});
    return attempt;
  }
  // Start recovery immediately so clear() can always capture and order behind
  // any in-flight recovery write before it persists consent revocation.
  let initializationEpoch = epoch;
  let initialization = startRecovery(initializationEpoch);
  function ready(): Promise<void> {
    const current = initialization;
    const version = initializationEpoch;
    return current.catch(error => {
      // A transient storage read must not poison this app run. Do not start a
      // replacement after clear() changes the epoch; clear owns that ordering.
      if (current === initialization && version === epoch) {
        initializationEpoch = epoch;
        initialization = startRecovery(epoch);
      }
      throw error;
    });
  }
  function change<T>(update: (rows: PendingSession[]) => T): Promise<T> {
    const operation = mutations.then(async () => {
      await ready();
      const rows = await read();
      const result = update(rows);
      await storage.setItem(key, JSON.stringify(rows));
      return result;
    });
    mutations = operation.then(() => {}, () => {});
    return operation;
  }
  function deferCleanup(id: string): Promise<void> {
    return change(rows => {
      const index = rows.findIndex(item => item.id === id);
      if (index < 0) return;
      const [row] = rows.splice(index, 1);
      rows.push(row);
    });
  }
  return {
    async list() {
      if (revocation) await revocation;
      await mutations;
      await ready();
      return read();
    },
    async clear() {
      if (revocation) return revocation;
      revoking = true;
      epoch += 1;
      const pendingInitialization = initialization.catch(() => {});
      const queued = mutations.then(async () => {
        await pendingInitialization;
        const raw = await storage.getItem(key);
        let rows: PendingSession[] = [];
        try {
          const parsed: unknown = raw ? JSON.parse(raw) : [];
          if (Array.isArray(parsed)) rows = parsed as PendingSession[];
        } catch {
          // Corrupt storage has no recoverable server identifiers. Clearing
          // it is the only safe local recovery available.
        }
        // Consent revocation must stay local and bounded. Keep only the IDs
        // needed to remove possibly accepted session writes; discard queued
        // telemetry immediately and retry cleanup in the background.
        const candidates = new Map(activeCleanupCandidates);
        for (const row of rows) {
          const tombstone = cleanupTombstone(row);
          if (tombstone) candidates.set(row.id, tombstone);
        }
        const tombstones = [...candidates.values()];
        activeCleanupCandidates.clear();
        for (const tombstone of tombstones) activeCleanupCandidates.set(tombstone.id, tombstone);
        await storage.setItem(key, JSON.stringify(tombstones));
        initialization = Promise.resolve();
        initializationEpoch = epoch;
      });
      mutations = queued.then(() => {}, () => {});
      const operation = queued.finally(() => {
        revoking = false;
        revocation = null;
      });
      revocation = operation;
      return operation;
    },
    async add(session: PendingSession, allowed: () => Promise<boolean>) {
      const version = epoch;
      if (revoking || !await allowed() || version !== epoch) return false;
      return change(rows => {
        if (revoking || version !== epoch || rows.filter(row => !row.abandoned && !hasExplicitCleanup(row)).length >= 100) return false;
        session.createAttempted ??= false;
        rows.push(session);
        return true;
      });
    },
    event(id: string, event: PendingSession['events'][number]) {
      if (revoking) return Promise.resolve(false);
      return change(rows => {
        const row = rows.find(item => item.id === id);
        if (!row || row.finish || row.abandoned || hasExplicitCleanup(row)) return false;
        if (row.events.length >= 10000) {
          row.partial = true;
          return false;
        }
        row.events.push(event);
        return true;
      });
    },
    markPartial(id: string) {
      if (revoking) return Promise.resolve(false);
      return change(rows => {
        const row = rows.find(item => item.id === id);
        if (!row || row.abandoned || hasExplicitCleanup(row)) return false;
        row.partial = true;
        return true;
      });
    },
    finish(id: string, body: Record<string, unknown>, localSessionId?: string, partial = false) {
      if (revoking) return Promise.resolve(false);
      return change(rows => {
        const row = rows.find(item => item.id === id);
        if (!row || row.abandoned || hasExplicitCleanup(row)) return false;
        row.finish ??= body;
        row.localSessionId = localSessionId;
        if (partial) row.partial = true;
        return true;
      });
    },
    flush(
      send: (
        owner: string,
        method: 'POST' | 'PATCH' | 'DELETE',
        path: string,
        body: Record<string, unknown>,
        markDispatched?: (cleanupToken?: string) => Promise<boolean>,
      ) => Promise<SessionUploadOutcome>,
      completed: (localId: string, cloudId: string, partial: boolean) => Promise<void>,
      failed: (localId: string, cloudId: string) => Promise<void>,
    ): Promise<void> {
      if (revoking) return revocation || Promise.resolve();
      if (flight) return flight;
      const version = epoch;
      flight = (async () => {
        await mutations;
        await ready();
        const snapshots = await read();
        // Clear bounded revocation work before normal uploads. A retryable
        // create for a new account must not starve an older account's cleanup.
        const ordered = snapshots.filter(row => row.abandoned || hasExplicitCleanup(row))
          .concat(snapshots.filter(row => !row.abandoned && !hasExplicitCleanup(row)));
        let cleanupAttempts = 0;
        for (const snapshot of ordered) {
          if (version !== epoch) return;
          rememberCleanupCandidate(snapshot);

          const cleanupTargets = explicitCleanupIds(snapshot);
          if (cleanupTargets.length) {
            let remaining = cleanupTargets;
            const tokenCleanup = Boolean(snapshot.cancelToken && snapshot.cleanupToken);
            for (const cleanupId of cleanupTargets) {
              if (cleanupAttempts >= MAX_CLEANUP_ATTEMPTS_PER_FLUSH) break;
              cleanupAttempts += 1;
              const outcome = await send(snapshot.owner, 'DELETE', tokenCleanup ? '/api/session-cancel-v1' : '/api/sessions', {
                session_id: cleanupId,
                ...(tokenCleanup ? {
                  cancel_token: snapshot.cancelToken,
                  cleanup_token: snapshot.cleanupToken,
                } : {}),
              });
              if (version !== epoch) return;
              if (outcome === 'retry' || typeof outcome !== 'string') continue;
              const nextRemaining = remaining.filter(id => id !== cleanupId);
              // Keep the final cleanup target durable until local history has
              // recorded that the cloud summary was removed.
              if (!nextRemaining.length && snapshot.localSessionId) {
                await failed(snapshot.localSessionId, snapshot.id);
              }
              remaining = nextRemaining;
              await change(rows => {
                if (version !== epoch) return;
                const row = rows.find(item => item.id === snapshot.id);
                if (!row) return;
                if (row.cleanupId === cleanupId) delete row.cleanupId;
                if (row.cleanupIds) row.cleanupIds = row.cleanupIds.filter(id => id !== cleanupId);
                if (!hasExplicitCleanup(row)) rows.splice(rows.indexOf(row), 1);
              });
              delete snapshot.cleanupId;
              snapshot.cleanupIds = remaining;
              if (remaining.length) rememberCleanupCandidate(snapshot);
            }
            if (remaining.length) {
              await deferCleanup(snapshot.id);
            } else {
              forgetCleanupCandidate(snapshot.id, version);
            }
            continue;
          }

          if (snapshot.abandoned) {
            // Bound cleanup work so an unreachable API cannot turn one retry
            // into minutes of timeouts before normal uploads continue.
            if (cleanupAttempts >= MAX_CLEANUP_ATTEMPTS_PER_FLUSH) continue;
            cleanupAttempts += 1;
            const tokenCleanup = Boolean(snapshot.cancelToken && snapshot.cleanupToken);
            const outcome = await send(snapshot.owner, 'DELETE', tokenCleanup ? '/api/session-cancel-v1' : '/api/sessions', {
              session_id: snapshot.id,
              ...(tokenCleanup ? {
                cancel_token: snapshot.cancelToken,
                cleanup_token: snapshot.cleanupToken,
              } : {}),
            });
            // A cleanup-specific server failure must not starve later completed
            // summaries. The tombstone stays durable for the next retry.
            if (outcome === 'retry' || typeof outcome !== 'string') {
              if (version !== epoch) return;
              await deferCleanup(snapshot.id);
              continue;
            }
            if (version !== epoch) return;
            if (snapshot.localSessionId) await failed(snapshot.localSessionId, snapshot.id);
            await change(rows => {
              if (version !== epoch) return;
              const index = rows.findIndex(item => item.id === snapshot.id);
              if (index >= 0) rows.splice(index, 1);
            });
            forgetCleanupCandidate(snapshot.id, version);
            continue;
          }

          if (!snapshot.created) {
            const outcome = await send(
              snapshot.owner,
              'POST',
              '/api/sessions',
              snapshot.start,
              async cleanupToken => {
                if (version !== epoch) return false;
                await change(rows => {
                  const row = rows.find(item => item.id === snapshot.id);
                  if (row) {
                    row.createAttempted = true;
                    if (cleanupToken) row.cleanupToken = cleanupToken;
                  }
                });
                if (version !== epoch) return false;
                snapshot.createAttempted = true;
                if (cleanupToken) snapshot.cleanupToken = cleanupToken;
                rememberCleanupCandidate(snapshot);
                return version === epoch;
              },
            );
            if (outcome === 'retry') return;
            if (version !== epoch) return;
            if (typeof outcome !== 'string') {
              const cleanupIds = [...new Set(outcome.cleanupIds.filter(id => typeof id === 'string'))];
              await change(rows => {
                if (version !== epoch) return;
                const row = rows.find(item => item.id === snapshot.id);
                if (row) row.cleanupIds = cleanupIds;
              });
              snapshot.cleanupIds = cleanupIds;
              if (version === epoch) rememberCleanupCandidate(snapshot);
              continue;
            }
            if (outcome === 'discard') {
              if (snapshot.localSessionId) await failed(snapshot.localSessionId, snapshot.id);
              await change(rows => {
                if (version !== epoch) return;
                const index = rows.findIndex(item => item.id === snapshot.id);
                if (index >= 0) rows.splice(index, 1);
              });
              forgetCleanupCandidate(snapshot.id, version);
              continue;
            }
            await change(rows => {
              if (version !== epoch) return;
              const row = rows.find(item => item.id === snapshot.id);
              if (row) row.created = true;
            });
          }

          let partial = Boolean(snapshot.partial);
          for (const event of snapshot.events) {
            if (version !== epoch) return;
            const outcome = await send(snapshot.owner, 'POST', '/api/events', event.body);
            if (outcome === 'retry' || typeof outcome !== 'string') return;
            if (version !== epoch) return;
            await change(rows => {
              if (version !== epoch) return;
              const row = rows.find(item => item.id === snapshot.id);
              if (row) {
                row.events = row.events.filter(item => item.id !== event.id);
                if (outcome === 'discard') row.partial = true;
              }
            });
            if (outcome === 'discard') partial = true;
          }
          if (snapshot.finish) {
            if (version !== epoch) return;
            const outcome = await send(snapshot.owner, 'PATCH', '/api/sessions', snapshot.finish);
            if (outcome === 'retry' || typeof outcome !== 'string') return;
            if (version !== epoch) return;
            if (outcome === 'discard') {
              const cleanup = await send(snapshot.owner, 'DELETE', '/api/sessions', {
                session_id: snapshot.id,
              });
              if (cleanup === 'retry' || typeof cleanup !== 'string') return;
              if (version !== epoch) return;
              if (snapshot.localSessionId) await failed(snapshot.localSessionId, snapshot.id);
              await change(rows => {
                if (version !== epoch) return;
                const index = rows.findIndex(item => item.id === snapshot.id);
                if (index >= 0) rows.splice(index, 1);
              });
              forgetCleanupCandidate(snapshot.id, version);
              continue;
            }
            // Mark history first: a failed local write retries an idempotent server write.
            if (snapshot.localSessionId) {
              await completed(snapshot.localSessionId, snapshot.id, partial);
            }
            await change(rows => {
              if (version !== epoch) return;
              const index = rows.findIndex(item => item.id === snapshot.id);
              if (index >= 0 && !rows[index].events.length) rows.splice(index, 1);
            });
            forgetCleanupCandidate(snapshot.id, version);
          }
        }
      })().finally(() => { flight = null; });
      return flight;
    },
  };
}
