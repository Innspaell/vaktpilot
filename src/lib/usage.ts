export interface UsageMonth {
  org_id: string;
  month: string;
  active_count: number;
  active_employee_ids: string[];
  included: number;
  base_price: number;
  per_extra: number;
  amount: number;
  final: boolean;
  computed_at: string;
}

const MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];

/** «november 2026» */
export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export const kr = (n: number) => Number(n).toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

/** Første dag i inneværende måned i norsk tid, som «2026-11-01». */
export function currentMonth(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit" }).format(now);
  return `${p}-01`;
}
