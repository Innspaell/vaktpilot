import type { PayRules } from "./pay";

const DAY = ["", "man", "tir", "ons", "tor", "fre", "lør", "søn"];
const t = (h: number) => String(h).padStart(2, "0");
const kr = (n: number) => n.toLocaleString("nb-NO", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

function daysText(days: number[]) {
  const s = [...days].sort();
  if (s.length === 7) return "alle dager";
  if (s.join() === "1,2,3,4,5") return "hverdager";
  return s.map((d) => DAY[d]).join(", ");
}

/** Reglene i klart språk, til visning for kunden. */
export function describeRules(r: PayRules): string[] {
  const out: string[] = [];
  const w = r.ordinaryWindow;
  const allDay = [1, 2, 3, 4, 5, 6, 7].every((d) => w[d]?.[0] === 0 && w[d]?.[1] === 24);
  if (allDay) out.push("Ordinær arbeidstid kan legges til alle tider av døgnet.");
  else {
    const parts = [1, 2, 3, 4, 5, 6, 7].map((d) => (w[d] ? `${DAY[d]} ${t(w[d]![0])}–${t(w[d]![1])}` : `${DAY[d]} ingen`));
    out.push(`Ordinær arbeidstid: ${parts.join(", ")}.`);
  }
  const ot: string[] = [];
  if (!allDay) ot.push("arbeid utenfor ordinær arbeidstid");
  if (r.dailyOvertimeAfterHours !== null) ot.push(`over ${r.dailyOvertimeAfterHours} timer per dag`);
  ot.push(r.weeklyOvertimeAfterHours !== null ? `over ${r.weeklyOvertimeAfterHours} timer per uke` : "over heltid per uke");
  out.push(`Overtid ${r.overtimePercent} %: ${ot.join(" og ")}. Deltidsansatte får mertid mellom avtalt tid og heltid.`);
  const h100: string[] = [];
  if (r.overtime100AfterHour !== null) h100.push(`etter kl. ${r.overtime100AfterHour} på hverdager`);
  if (r.saturday100AfterHour !== null) h100.push(`etter kl. ${r.saturday100AfterHour} på lørdag`);
  if (r.sundayHoliday100) h100.push("på søndager og helligdager");
  if (h100.length) out.push(`Overtid 100 %: ${h100.join(", ")}.`);
  if (r.calledOvertimeMinMinutes > 0) out.push(`Tilsagt overtid som ikke henger sammen med ordinær tid: minst ${r.calledOvertimeMinMinutes / 60} timer.`);
  if (r.shiftWorkersNoOvertime) out.push("Ansatte som jobber turnus eller skift får tillegg i stedet for overtid utenfor ordinær tid.");
  for (const s of r.supplements) {
    const when = s.holidays === "only" ? "på helligdager" : `${daysText(s.days)} kl. ${t(s.fromHour)}–${t(s.toHour)}`;
    out.push(`${s.label}: ${kr(s.ratePerHour)} kr per time, ${when}${s.appliesTo === "shift_workers" ? ", for turnus og skift" : ""}.`);
  }
  if (!r.supplements.length) out.push("Ingen faste tillegg for kveld, natt eller helg.");
  if (r.holidayPay) {
    out.push(r.holidayPay.onlyKinds?.includes("may")
      ? `Timelønnede får lønn for 1. og 17. mai på hverdager når de har vært ansatt i minst ${r.holidayPay.minDays} dager.`
      : `Timelønnede får helligdagsgodtgjørelse for helligdager på hverdager når de har vært ansatt i minst ${r.holidayPay.minDays} dager.`);
  }
  return out;
}
