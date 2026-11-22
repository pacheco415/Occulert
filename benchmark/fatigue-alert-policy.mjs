// A policy instance belongs to one session. Window ends are session-relative milliseconds.
export function createFatigueAlertPolicy(threshold, consecutiveWindows, stepMs) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1 ||
      !Number.isSafeInteger(consecutiveWindows) || consecutiveWindows < 1) {
    throw Error('Invalid fatigue model alert policy');
  }
  let lastWindow = -Infinity, lastAlert = -Infinity, streak = 0;
  return function isAlert(end, score) {
    if (end !== lastWindow + stepMs) streak = 0;
    lastWindow = end;
    streak = score >= threshold ? streak + 1 : 0;
    if (streak < consecutiveWindows || end - lastAlert < 12000) return false;
    lastAlert = end;
    return true;
  };
}
