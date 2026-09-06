// Live USD→ILS exchange rate — owner request: fold Render's USD spend into
// the dashboard's single "סה״כ הוצאות החודש" ILS number instead of showing
// it as a separate currency. Uses Frankfurter (frankfurter.dev), a free,
// keyless API publishing European Central Bank reference rates — no
// secret to manage, no invented number (spec §18 principle: a REAL sourced
// rate, not a made-up one). ECB rates update once per weekday; on a
// weekend/holiday this returns the last published rate, which is normal
// and expected, not a bug.
//
// Returns null (never throws) on any failure — callers must fall back to
// showing currencies separately rather than blocking the whole dashboard
// on a third-party API being down.
export interface FxRate {
  rate: number; // 1 USD = `rate` ILS
  asOf: string; // date the rate is published for, e.g. "2026-09-02"
}

export async function getUsdToIlsRate(): Promise<FxRate | null> {
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=ILS', {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { date?: string; rates?: { ILS?: number } };
    const rate = data.rates?.ILS;
    if (!rate || !Number.isFinite(rate) || !data.date) return null;
    return { rate, asOf: data.date };
  } catch {
    return null;
  }
}
