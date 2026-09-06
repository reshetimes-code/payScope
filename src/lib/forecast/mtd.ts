// Shared month-to-date forecast math (spec §5.8: "MTD spend / elapsed days *
// days in month"). Used by both the budget threshold evaluation job and any
// UI that shows a forecast, so the number is computed exactly one way.

export interface MonthProgress {
  monthStart: Date;
  elapsedDays: number;
  totalDays: number;
}

export function monthProgress(now: Date = new Date()): MonthProgress {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const elapsedDays = Math.max(
    1,
    Math.floor((now.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );
  const totalDays = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return { monthStart, elapsedDays, totalDays };
}

/** Simple explainable run-rate forecast — not presented as guaranteed (spec §5.8). */
export function projectedMonthEnd(spend: number, elapsedDays: number, totalDays: number): number {
  return (spend / elapsedDays) * totalDays;
}
