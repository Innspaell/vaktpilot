import type { PayRules } from "@/lib/pay";
import { SUPPLEMENT_ROWS_EXTRA } from "@/lib/pay-rules-form";

const DAYS = ["", "Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
const v = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

/** Skjemafelt for et regelsett. Brukes inne i et ActionForm. */
export function RulesEditor({ rules }: { rules: PayRules }) {
  const rows = [...rules.supplements, ...Array.from({ length: SUPPLEMENT_ROWS_EXTRA }, () => null)];
  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Ordinær arbeidstid (klokkeslett i hele timer, 0–24)</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => {
            const w = rules.ordinaryWindow[d];
            return (
              <div key={d} className="flex items-center gap-2 rounded-lg border border-line p-2 text-sm">
                <span className="w-8 font-medium">{DAYS[d]}</span>
                <input name={`w${d}_from`} inputMode="decimal" defaultValue={w ? w[0] : ""} className="input w-14 px-2 py-1" aria-label={`${DAYS[d]} fra`} />
                –
                <input name={`w${d}_to`} inputMode="decimal" defaultValue={w ? w[1] : ""} className="input w-14 px-2 py-1" aria-label={`${DAYS[d]} til`} />
                <label className="ml-auto flex items-center gap-1 text-xs text-muted"><input type="checkbox" name={`w${d}_off`} defaultChecked={!w} /> ingen</label>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted">Uten tariff: 0–24 alle dager (all tid kan være ordinær, overtid styres av grensene under).</p>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">Overtid</legend>
        <label className="block"><span className="label">Laveste overtidssats (%)</span><input name="overtimePercent" inputMode="decimal" defaultValue={rules.overtimePercent} className="input" /></label>
        <label className="block"><span className="label">Overtid etter timer per dag</span><input name="dailyOvertimeAfterHours" inputMode="decimal" defaultValue={v(rules.dailyOvertimeAfterHours)} placeholder="ingen grense" className="input" /></label>
        <label className="block"><span className="label">Overtid etter timer per uke</span><input name="weeklyOvertimeAfterHours" inputMode="decimal" defaultValue={v(rules.weeklyOvertimeAfterHours)} placeholder="bedriftens heltid" className="input" /></label>
        <label className="block"><span className="label">100 % etter kl. (hverdager)</span><input name="overtime100AfterHour" inputMode="decimal" defaultValue={v(rules.overtime100AfterHour)} placeholder="ingen" className="input" /></label>
        <label className="block"><span className="label">100 % etter kl. (lørdag)</span><input name="saturday100AfterHour" inputMode="decimal" defaultValue={v(rules.saturday100AfterHour)} placeholder="ingen" className="input" /></label>
        <label className="block"><span className="label">Minstetid ved utkalling (timer)</span><input name="calledOvertimeMinHours" inputMode="decimal" defaultValue={rules.calledOvertimeMinMinutes / 60 || ""} placeholder="ingen" className="input" /></label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2 lg:col-span-3">
          <input type="checkbox" name="sundayHoliday100" defaultChecked={rules.sundayHoliday100} className="mt-0.5 h-4 w-4" />
          Overtid utenfor ordinær tid på søndag og helligdag er 100 %
        </label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2 lg:col-span-3">
          <input type="checkbox" name="shiftWorkersNoOvertime" defaultChecked={rules.shiftWorkersNoOvertime} className="mt-0.5 h-4 w-4" />
          Turnus/skift: tid utenfor ordinær tid er ordinær tid med tillegg, ikke overtid
        </label>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Tillegg (kroner per time)</legend>
        <input type="hidden" name="supp_rows" value={rows.length} />
        {rows.map((s, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-line p-3 text-sm md:grid-cols-[2fr_1fr_1fr_1fr]">
            <input type="hidden" name={`s${i}_key`} value={s?.key ?? ""} />
            <label className="block"><span className="label">Navn</span><input name={`s${i}_label`} defaultValue={s?.label ?? ""} placeholder={s ? "" : "Nytt tillegg, f.eks. Søndagstillegg"} className="input" /></label>
            <label className="block"><span className="label">Kr per time</span><input name={`s${i}_rate`} inputMode="decimal" defaultValue={s ? s.ratePerHour : ""} className="input" /></label>
            <label className="block"><span className="label">Fra kl.</span><input name={`s${i}_from`} inputMode="decimal" defaultValue={s ? s.fromHour : ""} className="input" /></label>
            <label className="block"><span className="label">Til kl.</span><input name={`s${i}_to`} inputMode="decimal" defaultValue={s ? s.toHour : ""} className="input" /></label>
            <div className="flex flex-wrap items-center gap-2 md:col-span-4">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <label key={d} className="flex items-center gap-1"><input type="checkbox" name={`s${i}_d${d}`} defaultChecked={s ? s.days.includes(d) : false} />{DAYS[d]}</label>
              ))}
              <select name={`s${i}_holidays`} defaultValue={s?.holidays ?? "exclude"} className="input w-auto py-1">
                <option value="exclude">Ikke helligdager</option>
                <option value="only">Bare helligdager</option>
              </select>
              <select name={`s${i}_applies`} defaultValue={s?.appliesTo ?? "all"} className="input w-auto py-1">
                <option value="all">Alle ansatte</option>
                <option value="shift_workers">Bare turnus/skift</option>
              </select>
              {s && <label className="ml-auto flex items-center gap-1 text-bad"><input type="checkbox" name={`s${i}_delete`} /> Fjern</label>}
            </div>
          </div>
        ))}
        <p className="text-xs text-muted">Over midnatt: fra 18 til 6. Hele dagen: 0 til 24. Trenger du flere rader, lagre og åpne igjen.</p>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Helligdager for timelønnede</legend>
        <label className="block"><span className="label">Godtgjørelse</span>
          <select name="holidayPay" defaultValue={!rules.holidayPay ? "none" : rules.holidayPay.onlyKinds?.includes("may") ? "may" : "all"} className="input">
            <option value="all">Alle helligdager på hverdager</option>
            <option value="may">Bare 1. og 17. mai (lovens minimum)</option>
            <option value="none">Ingen</option>
          </select>
        </label>
        <label className="block"><span className="label">Etter antall dager ansatt</span><input name="holidayPayMinDays" inputMode="numeric" defaultValue={rules.holidayPay?.minDays ?? 30} className="input" /></label>
      </fieldset>
    </div>
  );
}
