import type { PayRules, Supplement } from "./pay";

export type RulesJson = Omit<PayRules, "key" | "name">;
export const SUPPLEMENT_ROWS_EXTRA = 3;

const numOrNull = (v: FormDataEntryValue | null) => {
  const t = String(v ?? "").trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/** Leser skjemaet for et regelsett. Returnerer feilmelding hvis noe er ugyldig. */
export function rulesFromForm(fd: FormData): { rules?: RulesJson; error?: string } {
  const errors: string[] = [];
  const hour = (v: number | null, label: string, allowNull = true) => {
    if (v === null) { if (!allowNull) errors.push(`${label} mangler.`); return null; }
    if (Number.isNaN(v) || v < 0 || v > 24) { errors.push(`${label} må være et klokkeslett mellom 0 og 24.`); return null; }
    return v;
  };

  const ordinaryWindow: Record<number, [number, number] | null> = {};
  for (let d = 1; d <= 7; d++) {
    if (fd.get(`w${d}_off`) === "on") { ordinaryWindow[d] = null; continue; }
    const f = hour(numOrNull(fd.get(`w${d}_from`)), `Fra-klokkeslett dag ${d}`, false);
    const t = hour(numOrNull(fd.get(`w${d}_to`)), `Til-klokkeslett dag ${d}`, false);
    if (f !== null && t !== null && t <= f) errors.push(`Ordinær tid dag ${d}: til må være etter fra.`);
    ordinaryWindow[d] = f !== null && t !== null ? [f, t] : null;
  }

  const pct = numOrNull(fd.get("overtimePercent"));
  if (pct === null || Number.isNaN(pct) || pct < 40 || pct > 200) errors.push("Overtidssats må være minst 40 % (arbeidsmiljøloven).");
  const daily = numOrNull(fd.get("dailyOvertimeAfterHours"));
  const weekly = numOrNull(fd.get("weeklyOvertimeAfterHours"));
  if (daily !== null && (Number.isNaN(daily) || daily <= 0 || daily > 24)) errors.push("Dagsgrense for overtid er ugyldig.");
  if (weekly !== null && (Number.isNaN(weekly) || weekly <= 0 || weekly > 80)) errors.push("Ukegrense for overtid er ugyldig.");
  const called = numOrNull(fd.get("calledOvertimeMinHours"));
  if (called !== null && (Number.isNaN(called) || called < 0 || called > 12)) errors.push("Minstetid ved utkalling er ugyldig.");

  const supplements: Supplement[] = [];
  const rows = Number(fd.get("supp_rows") ?? 0);
  for (let i = 0; i < rows; i++) {
    const label = String(fd.get(`s${i}_label`) ?? "").trim();
    if (!label || fd.get(`s${i}_delete`) === "on") continue;
    const rate = numOrNull(fd.get(`s${i}_rate`));
    const from = hour(numOrNull(fd.get(`s${i}_from`)), `Fra for «${label}»`, false);
    const to = hour(numOrNull(fd.get(`s${i}_to`)), `Til for «${label}»`, false);
    const days = [1, 2, 3, 4, 5, 6, 7].filter((d) => fd.get(`s${i}_d${d}`) === "on");
    const holidays = fd.get(`s${i}_holidays`) === "only" ? "only" : "exclude";
    if (rate === null || Number.isNaN(rate) || rate < 0) errors.push(`Sats for «${label}» mangler.`);
    if (holidays === "exclude" && days.length === 0) errors.push(`Velg minst én dag for «${label}».`);
    let key = String(fd.get(`s${i}_key`) ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!key) key = label.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || `tillegg_${i}`;
    if (supplements.some((s) => s.key === key)) key = `${key}_${i}`;
    supplements.push({
      key, label, ratePerHour: rate ?? 0, days: holidays === "only" ? [1, 2, 3, 4, 5, 6, 7] : days,
      fromHour: from ?? 0, toHour: to ?? 24, holidays,
      appliesTo: fd.get(`s${i}_applies`) === "shift_workers" ? "shift_workers" : "all",
    });
  }

  const hpMode = String(fd.get("holidayPay") ?? "none");
  const hpDays = numOrNull(fd.get("holidayPayMinDays")) ?? 30;

  if (errors.length) return { error: errors.join(" ") };
  return {
    rules: {
      ordinaryWindow,
      overtimePercent: pct!,
      overtime100AfterHour: hour(numOrNull(fd.get("overtime100AfterHour")), "Overtid 100 % etter (hverdag)"),
      saturday100AfterHour: hour(numOrNull(fd.get("saturday100AfterHour")), "Overtid 100 % etter (lørdag)"),
      sundayHoliday100: fd.get("sundayHoliday100") === "on",
      dailyOvertimeAfterHours: daily,
      weeklyOvertimeAfterHours: weekly,
      calledOvertimeMinMinutes: Math.round((called ?? 0) * 60),
      shiftWorkersNoOvertime: fd.get("shiftWorkersNoOvertime") === "on",
      supplements,
      holidayPay: hpMode === "none" ? null : hpMode === "may" ? { minDays: hpDays, onlyKinds: ["may"] } : { minDays: hpDays },
    },
  };
}
