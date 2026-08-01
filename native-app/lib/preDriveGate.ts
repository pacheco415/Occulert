export const PRE_DRIVE_CONFIRMATION_TTL_MS = 5 * 60 * 1_000;

let confirmedAt = 0;

export function confirmPreDriveSafety(now = Date.now()): void {
  confirmedAt = now;
}

export function consumePreDriveSafety(now = Date.now()): boolean {
  const isCurrent = confirmedAt > 0
    && now >= confirmedAt
    && now - confirmedAt <= PRE_DRIVE_CONFIRMATION_TTL_MS;
  confirmedAt = 0;
  return isCurrent;
}

export function clearPreDriveSafetyConfirmation(): void {
  confirmedAt = 0;
}
