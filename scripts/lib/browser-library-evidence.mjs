import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, opendirSync, readlinkSync, readSync } from 'node:fs';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

export const LIBRARY_EVIDENCE_LIMITS = Object.freeze({
  intervalMs: 1000, samples: 120, processes: 64, tasksPerProcess: 64,
  procReads: 512, procBytes: 8 * 1024 * 1024, mapsBytes: 1024 * 1024,
  smallFileBytes: 16 * 1024, libraryBytes: 8 * 1024 * 1024,
  records: 16, segments: 16, issues: 16, sampleMs: 500,
});
const marker = 'occulert-browser-library-evidence';
const errorCode = error => typeof error?.code === 'string' ? error.code : 'UNAVAILABLE';
const failure = code => Object.assign(new Error(code), { code });
const pidValue = value => /^\d{1,10}$/.test(String(value)) && Number(value) > 0 && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const libraryName = /^libsoup-\d+(?:\.\d+)*\.so(?:\.\d+)*$/;
const processRoles = new Set(['WebKitNetworkProcess', 'WebKitWebProcess', 'WPEWebProcess', 'WPENetworkProcess', 'MiniBrowser']);

function boundedLimits(overrides = {}) {
  overrides ||= {};
  return Object.fromEntries(Object.entries(LIBRARY_EVIDENCE_LIMITS).map(([key, maximum]) => [key,
    Number.isSafeInteger(overrides[key]) && overrides[key] > 0 ? Math.min(overrides[key], maximum) : maximum]));
}

function processIdentity(text, pid) {
  const close = text.lastIndexOf(')');
  const fields = text.slice(close + 2).trim().split(/\s+/);
  if (close < 0 || Number(text.slice(0, text.indexOf(' '))) !== pid || !/^\d{1,20}$/.test(fields[19] || '') || !/^\d{1,10}$/.test(fields[1] || '')) throw failure('INVALID_PROCESS_IDENTITY');
  return { pid, parentPid: Number(fields[1]), startTimeTicks: fields[19] };
}

function mappedLibraries(text) {
  const libraries = new Map();
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{1,16})-([0-9a-f]{1,16})\s+([r-][w-][x-][ps])\s+([0-9a-f]{1,16})\s+([0-9a-f]{1,8}):([0-9a-f]{1,8})\s+(\d{1,20})\s+(.+)$/.exec(line);
    if (!match) continue;
    const deleted = match[8].endsWith(' (deleted)'), path = deleted ? match[8].slice(0, -10) : match[8];
    if (!path.startsWith('/') || path.length > 4096 || !libraryName.test(basename(path))) continue;
    const device = `${BigInt(`0x${match[5]}`).toString(16)}:${BigInt(`0x${match[6]}`).toString(16)}`;
    const key = `${device}:${match[7]}:${path}`;
    if (!libraries.has(key)) libraries.set(key, { path, device, inode: match[7], deleted, segments: [] });
    libraries.get(key).segments.push({ start: match[1], end: match[2], permissions: match[3], offset: match[4] });
  }
  return [...libraries.values()].filter(item => item.segments.some(segment => segment.permissions.includes('x')));
}

export function linuxDeviceNumber(device) {
  // Linux/glibc dev_t encoding, including major bits above bit 43.
  const major = ((device >> 8n) & 0xfffn) | ((device >> 32n) & 0xfffff000n);
  const minor = (device & 0xffn) | ((device >> 12n) & 0xffffff00n);
  return `${major.toString(16)}:${minor.toString(16)}`;
}

function fileIdentity(stat) {
  return { device: linuxDeviceNumber(stat.dev), inode: String(stat.ino) };
}

/** A bounded point-in-time observation. Never returns argv, environment, or unrelated maps. */
export function sampleLoadedLibraries({ rootPid, expectedRootParentPid, expectedRootStartTimeTicks, procRoot = '/proc', limits: requestedLimits } = {}) {
  const limits = boundedLimits(requestedLimits), deadline = performance.now() + limits.sampleMs;
  const sample = { observedAt: new Date().toISOString(), root: null, processesExamined: 0, mapsRead: 0, networkProcessesObserved: 0,
    procReads: 0, procBytes: 0, records: [], issues: [], limited: false };
  const issue = (stage, code) => {
    if (sample.issues.some(item => item.stage === stage && item.code === code)) return;
    if (sample.issues.length < limits.issues) sample.issues.push({ stage, code });
    else sample.limited = true;
  };
  const budget = () => {
    if (performance.now() >= deadline || sample.procReads >= limits.procReads || sample.procBytes >= limits.procBytes) {
      sample.limited = true; throw failure('SAMPLE_LIMIT');
    }
  };
  const read = (path, maximum) => {
    budget(); sample.procReads++;
    let fd;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
      const buffer = Buffer.alloc(Math.min(maximum + 1, limits.procBytes - sample.procBytes));
      let used = 0;
      while (used < buffer.length) {
        budget();
        const count = readSync(fd, buffer, used, buffer.length - used, null);
        if (!count) break;
        used += count; sample.procBytes += count;
      }
      const truncated = used > maximum || used === buffer.length;
      if (truncated) { sample.limited = true; issue('proc-read', 'TRUNCATED'); }
      return { text: buffer.subarray(0, Math.min(used, maximum)).toString('utf8'), truncated };
    } finally { if (fd !== undefined) closeSync(fd); }
  };
  const identity = pid => {
    const data = read(join(procRoot, String(pid), 'stat'), limits.smallFileBytes);
    if (data.truncated) throw failure('TRUNCATED_PROCESS_IDENTITY');
    return processIdentity(data.text, pid);
  };
  const sameIdentity = (left, right) => left.pid === right.pid && left.startTimeTicks === right.startTimeTicks && left.parentPid === right.parentPid;
  const verifyLineage = lineage => {
    try {
      for (const expected of lineage) if (!sameIdentity(identity(expected.pid), expected)) throw failure('PROCESS_CHANGED');
    } catch (error) { throw Object.assign(failure(errorCode(error)), { invalidatesMapping: true }); }
  };
  const maps = pid => {
    const data = read(join(procRoot, String(pid), 'maps'), limits.mapsBytes);
    sample.mapsRead++;
    // Never parse a partial final line as a valid file identity.
    return mappedLibraries(data.truncated ? data.text.slice(0, data.text.lastIndexOf('\n') + 1) : data.text);
  };
  const children = pid => {
    budget(); sample.procReads++;
    const directory = opendirSync(join(procRoot, String(pid), 'task')), found = new Set();
    try {
      let entries = 0, entry;
      while ((entry = directory.readSync())) {
        budget();
        if (++entries > limits.tasksPerProcess) { sample.limited = true; issue('descendants', 'TASK_LIMIT'); break; }
        const tid = pidValue(entry.name); if (!tid) continue;
        try {
          const data = read(join(procRoot, String(pid), 'task', entry.name, 'children'), limits.smallFileBytes);
          const values = data.truncated ? data.text.slice(0, data.text.search(/\S+$/)) : data.text;
          for (const value of values.trim().split(/\s+/)) {
            const child = pidValue(value); if (child) found.add(child);
            if (found.size >= limits.processes) { sample.limited = true; issue('descendants', 'PROCESS_LIMIT'); break; }
          }
        } catch (error) { issue('children', errorCode(error)); }
      }
    } finally { directory.closeSync(); }
    return [...found];
  };
  const roleFor = pid => {
    budget(); sample.procReads++;
    const name = basename(readlinkSync(join(procRoot, String(pid), 'exe')));
    return processRoles.has(name) ? name : 'other';
  };
  const hash = (process, lineage, library, role) => {
    if (library.deleted) throw failure('DELETED_MAPPING');
    let fd;
    try {
      // The process root resolves mount namespaces; device/inode verification rejects a replaced pathname.
      fd = openSync(join(procRoot, String(process.pid), 'root', library.path), constants.O_RDONLY | constants.O_NONBLOCK);
      const before = fstatSync(fd, { bigint: true }), backing = fileIdentity(before);
      if (!before.isFile()) throw failure('NOT_REGULAR_FILE');
      if (backing.device !== library.device || backing.inode !== library.inode) throw failure('MAPPED_FILE_MISMATCH');
      if (before.size <= 0n || before.size > BigInt(limits.libraryBytes)) throw failure('LIBRARY_SIZE_LIMIT');
      const digest = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
      let size = 0;
      while (size < Number(before.size)) {
        budget();
        const count = readSync(fd, buffer, 0, Math.min(buffer.length, Number(before.size) - size), null);
        if (!count) throw failure('FILE_CHANGED');
        digest.update(buffer.subarray(0, count)); size += count;
      }
      const after = fstatSync(fd, { bigint: true });
      if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw failure('FILE_CHANGED');
      verifyLineage(lineage);
      if (roleFor(process.pid) !== role) throw failure('PROCESS_ROLE_CHANGED');
      const current = maps(process.pid).find(item => item.path === library.path && item.device === library.device && item.inode === library.inode && !item.deleted);
      if (!current || !library.segments.some(segment => segment.permissions.includes('x') && current.segments.some(now => JSON.stringify(now) === JSON.stringify(segment)))) throw failure('MAPPING_CHANGED');
      return { status: 'verified', sha256: digest.digest('hex'), sizeBytes: size, source: 'process-root', device: backing.device, inode: backing.inode };
    } finally { if (fd !== undefined) closeSync(fd); }
  };
  try {
    if (!pidValue(rootPid)) throw failure('INVALID_ROOT_PID');
    const root = identity(rootPid); sample.root = root;
    if (expectedRootParentPid !== undefined && root.parentPid !== expectedRootParentPid) throw failure('ROOT_PARENT_CHANGED');
    if (expectedRootStartTimeTicks && root.startTimeTicks !== expectedRootStartTimeTicks) throw failure('ROOT_PROCESS_CHANGED');
    const pending = [{ process: root, lineage: [root] }], visited = new Set();
    while (pending.length) {
      budget();
      if (sample.processesExamined >= limits.processes || sample.records.length >= limits.records) { sample.limited = true; issue('descendants', 'RECORD_OR_PROCESS_LIMIT'); break; }
      const { process, lineage } = pending.shift();
      if (visited.has(process.pid)) continue;
      visited.add(process.pid);
      try {
        verifyLineage(lineage); sample.processesExamined++;
        let role = 'other';
        try { role = roleFor(process.pid); } catch (error) { issue('process-role', errorCode(error)); }
        if (role.endsWith('NetworkProcess')) sample.networkProcessesObserved++;
        let libraries = [];
        try { libraries = maps(process.pid); } catch (error) { issue('process-maps', errorCode(error)); }
        verifyLineage(lineage);
        for (const library of libraries) {
          if (sample.records.length >= limits.records) { sample.limited = true; break; }
          const record = { process: { ...process, role }, lineage, mapping: { ...library, segments: library.segments.slice(0, limits.segments) }, backingFile: null };
          if (library.segments.length > limits.segments) sample.limited = true;
          try { record.backingFile = hash(process, lineage, library, role); }
          catch (error) {
            if (error.invalidatesMapping || errorCode(error) === 'PROCESS_ROLE_CHANGED') { issue('mapping-provenance', errorCode(error)); continue; }
            record.backingFile = { status: 'unavailable', error: errorCode(error) };
          }
          // Even an unavailable hash must not retain a pathname read from a reused or unverified process.
          try { verifyLineage(lineage); }
          catch (error) { issue('mapping-provenance', errorCode(error)); continue; }
          sample.records.push(record);
        }
        for (const pid of children(process.pid)) {
          try {
            const child = identity(pid);
            if (child.parentPid !== process.pid) { issue('descendants', 'PARENT_CHANGED'); continue; }
            if (pending.length + visited.size >= limits.processes) { sample.limited = true; issue('descendants', 'PROCESS_LIMIT'); break; }
            pending.push({ process: child, lineage: [...lineage, child] });
          } catch (error) { issue('descendant-identity', errorCode(error)); }
        }
      } catch (error) { issue('process-sample', errorCode(error)); }
    }
  } catch (error) { issue('root-sample', errorCode(error)); }
  return sample;
}

function emptyEvidence(platform, limits) {
  return { schema: 1, platform, scope: 'Launched test runner and observed descendants only',
    startedAt: new Date().toISOString(), finishedAt: null, status: 'collecting', stopReason: null,
    limits, samples: 0, processesExamined: 0, mapsRead: 0, networkProcessesObserved: 0, verifiedNetworkLibraries: 0,
    limited: false, records: [], issues: [] };
}

function finish(evidence, reason) {
  evidence.finishedAt = new Date().toISOString(); evidence.stopReason = reason;
  evidence.status = evidence.records.some(record => record.backingFile.status === 'verified') ? 'observed'
    : evidence.records.length || !evidence.mapsRead || evidence.issues.length || evidence.limited ? 'unavailable' : 'not_observed';
  return evidence;
}

/** Sampling runs off the runner's event loop and is terminated when the child closes. */
export function startLibraryEvidence({ rootPid, platform = process.platform, procRoot = '/proc', limits: requestedLimits } = {}) {
  const limits = boundedLimits(requestedLimits);
  let evidence = emptyEvidence(platform, limits), worker, stopped = false;
  if (platform !== 'linux' || !pidValue(rootPid)) {
    finish(evidence, platform !== 'linux' ? 'unsupported_platform' : 'child_not_started');
    if (platform !== 'linux') evidence.status = 'unsupported';
    return { snapshot: () => structuredClone(evidence), stop: () => evidence };
  }
  try {
    worker = new Worker(new URL(import.meta.url), { workerData: { marker, rootPid, procRoot, limits } });
    worker.on('message', value => { if (!stopped) evidence = value; });
    worker.on('error', error => {
      if (!stopped) { evidence.issues.push({ stage: 'worker', code: errorCode(error) }); finish(evidence, 'worker_error'); }
    });
    worker.on('exit', code => {
      if (!stopped && evidence.status === 'collecting') { evidence.issues.push({ stage: 'worker', code: `EXIT_${code}` }); finish(evidence, 'worker_exit'); }
    });
    worker.unref();
  } catch (error) { evidence.issues.push({ stage: 'worker', code: errorCode(error) }); finish(evidence, 'worker_unavailable'); }
  return { snapshot: () => structuredClone(evidence), stop() {
    stopped = true;
    if (worker) void worker.terminate().catch(() => {});
    return evidence.status === 'collecting' ? finish(evidence, 'child_closed') : evidence;
  } };
}

if (!isMainThread && workerData?.marker === marker) {
  const { rootPid, procRoot, limits } = workerData, evidence = emptyEvidence(process.platform, limits);
  let rootStartTimeTicks;
  const tick = () => {
    const sample = sampleLoadedLibraries({ rootPid, procRoot, limits, expectedRootParentPid: process.pid, expectedRootStartTimeTicks: rootStartTimeTicks });
    rootStartTimeTicks ||= sample.root?.startTimeTicks;
    evidence.samples++; evidence.processesExamined += sample.processesExamined; evidence.mapsRead += sample.mapsRead;
    evidence.networkProcessesObserved += sample.networkProcessesObserved; evidence.limited ||= sample.limited;
    for (const issue of sample.issues) if (!evidence.issues.some(item => item.stage === issue.stage && item.code === issue.code)) {
      if (evidence.issues.length < limits.issues) evidence.issues.push(issue); else evidence.limited = true;
    }
    for (const record of sample.records) {
      const same = item => item.process.pid === record.process.pid && item.process.startTimeTicks === record.process.startTimeTicks && item.mapping.path === record.mapping.path && item.mapping.inode === record.mapping.inode;
      const prior = evidence.records.findIndex(same);
      if (prior >= 0) { if (evidence.records[prior].backingFile.status !== 'verified') evidence.records[prior] = { ...record, observedAt: sample.observedAt }; }
      else if (evidence.records.length < limits.records) evidence.records.push({ ...record, observedAt: sample.observedAt });
      else evidence.limited = true;
    }
    evidence.verifiedNetworkLibraries = evidence.records.filter(record => record.process.role.endsWith('NetworkProcess') && record.backingFile.status === 'verified').length;
    const reason = evidence.verifiedNetworkLibraries ? 'verified_network_library'
      : !sample.root || sample.issues.some(item => ['ROOT_PROCESS_CHANGED', 'ROOT_PARENT_CHANGED'].includes(item.code)) ? 'root_unavailable'
        : evidence.samples >= limits.samples ? 'sample_limit' : evidence.records.length >= limits.records ? 'record_limit' : null;
    if (reason) { if (reason.endsWith('_limit')) evidence.limited = true; finish(evidence, reason); }
    parentPort.postMessage(evidence);
    if (reason) parentPort.close(); else setTimeout(tick, limits.intervalMs);
  };
  tick();
}
