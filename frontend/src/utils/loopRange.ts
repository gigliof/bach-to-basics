export function loopRange(total: number, start: number | null, end: number | null): [number | null, number | null] {
  if (!Number.isFinite(total) || total <= 0 || start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end)) return [null, null];
  const gap = Math.min(0.1, total);
  const b = Math.max(gap, Math.min(total, end));
  const a = Math.max(0, Math.min(b - gap, start));
  return [a, b];
}
export function loopTime(seconds: number) {
  const tenths = Math.round(seconds * 10);
  return `${Math.floor(tenths / 600)}:${(Math.floor(tenths / 10) % 60).toString().padStart(2, "0")}.${tenths % 10}`;
}
