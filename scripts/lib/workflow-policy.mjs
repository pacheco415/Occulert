// Keep reviewed action upgrades possible without accepting mutable tags or
// replacing the project's Node version with an action-specific override.
export const MINIMUM_NODE_ACTION_MAJOR = 6;

export function auditWorkflowPolicy(source, { requireNodeSetup = false } = {}) {
  const failures = [];
  const lines = source.split(/\r?\n/);
  const actions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^([ \t]*)(-\s+)?uses:\s*(\S+)(.*)$/);
    if (!match) continue;
    const [, indent, marker, reference, suffix] = match;
    if (!/^[\w-]+\/[\w.-]+(?:\/[\w.-]+)*@[a-f0-9]{40}$/.test(reference)) {
      failures.push('every action must be pinned to a full 40-character commit SHA');
    }
    const action = reference.match(/^actions\/(checkout|setup-node)@/)?.[1];
    if (!action) continue;
    const version = suffix.match(/^[ \t]+# v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)[ \t]*$/);
    if (!version || Number(version[1]) < MINIMUM_NODE_ACTION_MAJOR) {
      failures.push(`${action} must have a trailing # vX.Y.Z comment with major >= ${MINIMUM_NODE_ACTION_MAJOR}`);
    }
    actions.push(action);
    if (action !== 'setup-node') continue;

    // A named step puts uses two spaces below its list marker. Bound each
    // setup's input check to that step, so a different step cannot satisfy it.
    const stepIndent = indent.length - (marker ? 0 : 2);
    let end = index + 1;
    while (end < lines.length) {
      const line = lines[end];
      if (line.trim() && !line.trimStart().startsWith('#')) {
        const leading = line.match(/^[ \t]*/)[0].length;
        if (leading <= stepIndent || (leading <= indent.length && /^\s*(?:uses|run):/.test(line))) break;
      }
      end += 1;
    }
    const block = lines.slice(index + 1, end);
    const withLines = block.map((line, position) => /^[ \t]*with:[ \t]*(?:#.*)?$/.test(line) ? position : -1).filter(position => position >= 0);
    const withLine = withLines.length === 1 ? withLines[0] : -1;
    const inputIndent = withLine < 0 ? -1 : block[withLine].match(/^[ \t]*/)[0].length + 2;
    const inputs = [];
    for (let item = withLine + 1; withLine >= 0 && item < block.length; item += 1) {
      const line = block[item];
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const leading = line.match(/^[ \t]*/)[0].length;
      if (leading < inputIndent) break;
      if (leading === inputIndent) inputs.push(line.trim());
    }
    const files = inputs.filter(line => /^node-version-file:/.test(line));
    if (files.length !== 1 || !/^node-version-file:[ \t]*(?:\.nvmrc|'\.nvmrc'|"\.nvmrc")[ \t]*(?:#.*)?$/.test(files[0])
      || block.some(line => /^[ \t]*node-version:/.test(line))) {
      failures.push('every setup-node step must read node-version-file: .nvmrc without a node-version override');
    }
  }
  if (requireNodeSetup) {
    for (const action of ['checkout', 'setup-node']) {
      if (!actions.includes(action)) failures.push(`required ${action} action is missing`);
    }
  }
  // OS aliases move independently of reviewed application changes.
  if (/^[ \t]*runs-on:[ \t]*['"]?(?:ubuntu-latest|macos-latest)['"]?[ \t]*(?:#.*)?$/m.test(source)) {
    failures.push('runner images must use an explicit OS version');
  }
  return failures;
}
