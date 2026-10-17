const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** Parses `30s`, `15m`, `12h` or `7d` (the format enforced on JWT_*_TTL) into milliseconds. */
export function parseDurationMs(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (match === null) throw new Error(`Invalid duration: ${value}`);
  const [, amount, unit] = match as unknown as [string, string, keyof typeof UNIT_MS];
  return Number(amount) * UNIT_MS[unit];
}
