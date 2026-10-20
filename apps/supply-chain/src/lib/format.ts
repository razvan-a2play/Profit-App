const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const money = (n: number | null | undefined) => (n == null ? "—" : usd0.format(n));
export const money2 = (n: number | null | undefined) => (n == null ? "—" : usd2.format(n));
export const count = (n: number | null | undefined) => (n == null ? "—" : int.format(n));
export const pct = (n: number | null | undefined, dp = 1) => (n == null ? "—" : `${(n * 100).toFixed(dp)}%`);

export function monthLabel(month: string, style: "short" | "long" = "short"): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-US", {
    month: style === "short" ? "short" : "long",
    year: style === "short" ? "2-digit" : "numeric",
    timeZone: "UTC",
  });
}
