"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { BoardDay, BoardRow, Fit } from "@/lib/plan-board";
import { moveShiftTo, placeOnDay, removeFromBoard, setHolidayPayment, undoBoard, type BoardResult } from "@/app/(app)/vaktplan/actions";

export interface BoardTemplate { id: string; name: string; start: string; end: string; breakMinutes: number; workRoleId: string | null }

type Drag = { kind: "emp"; id: string } | { kind: "shift"; id: string; employeeId: string | null };
type Ask =
  | { kind: "confirm"; employeeId: string; date: string; text: string }
  | { kind: "time"; employeeId: string; date: string };

const FIT_BG: Record<Fit, string> = { good: "bg-good-soft", maybe: "bg-warn-soft", bad: "bg-bad-soft", none: "" };
const FIT_TEXT: Record<Fit, string> = { good: "text-good", maybe: "text-warn", bad: "text-bad", none: "text-muted" };

/** Ukeplan som tabell: dra ansatte inn på dager, flytt eller kopier vakter (Ctrl/Alt), trykk og plasser på mobil. */
export function PlanBoard({ days, rows, templates, department, back }: {
  days: BoardDay[]; rows: BoardRow[]; templates: BoardTemplate[]; department: string | null; back: string;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null); // trykk og plasser
  const [ask, setAsk] = useState<Ask | null>(null);
  const [toast, setToast] = useState<(BoardResult & { at: number }) | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nameOf = (id: string) => rows.find((r) => r.id === id)?.name ?? "Den ansatte";
  const firstName = (id: string) => nameOf(id).split(" ")[0];
  const dayLabel = (date: string) => days.find((d) => d.date === date)?.label ?? date;
  const activeEmp = drag?.kind === "emp" ? drag.id : picked;

  const show = (r: BoardResult) => {
    if (!r.ok && !r.error && !r.warning) return;
    setToast({ ...r, at: Date.now() });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), r.warning || r.error ? 12000 : 8000);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const run = (fn: () => Promise<BoardResult>, onNeedTime?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.needTime && onNeedTime) onNeedTime();
      else show(r);
    });

  /** Ansatt på en dag: spør først hvis dagen er rød, og om arbeidstid hvis det ikke er behov. */
  const place = (employeeId: string, date: string, confirmed = false) => {
    const cell = rows.find((r) => r.id === employeeId)?.cells.find((c) => c.date === date);
    if (!confirmed && cell?.fit === "bad") {
      setAsk({ kind: "confirm", employeeId, date, text: `${firstName(employeeId)}: ${cell.note?.toLowerCase() ?? "passer dårlig"} ${dayLabel(date).toLowerCase()}. Vil du legge inn vakt likevel?` });
      return;
    }
    run(() => placeOnDay({ employeeId, date, department }), () => setAsk({ kind: "time", employeeId, date }));
  };

  const dropOn = (employeeId: string | null, date: string, copy: boolean) => {
    const d = drag;
    setDrag(null);
    setOver(null);
    if (!d) return;
    if (d.kind === "emp") place(d.id, date);
    else run(() => moveShiftTo({ shiftId: d.id, employeeId, date, copy }));
  };

  const dragProps = (d: Drag) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.effectAllowed = "copyMove"; e.dataTransfer.setData("text/plain", d.id); setDrag(d); setPicked(null); },
    onDragEnd: () => { setDrag(null); setOver(null); },
  });
  const dropProps = (employeeId: string | null, date: string) => ({
    onDragOver: (e: React.DragEvent) => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = drag.kind === "shift" && (e.ctrlKey || e.altKey || e.metaKey) ? "copy" : "move"; setOver(`${employeeId ?? "open"}|${date}`); },
    onDragLeave: () => setOver((o) => (o === `${employeeId ?? "open"}|${date}` ? null : o)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); dropOn(employeeId, date, e.ctrlKey || e.altKey || e.metaKey); },
  });

  const cols = { gridTemplateColumns: `200px repeat(${days.length}, minmax(0, 1fr))` };

  return (
    <div className="space-y-3">
      {/* ---------- PC: tabell ---------- */}
      <div className={`card hidden overflow-x-auto p-0 md:block ${pending ? "opacity-70" : ""}`}>
        <div className="min-w-[60rem]">
          <div className="grid border-b border-line bg-paper text-xs font-semibold text-muted" style={cols}>
            <div className="px-3 py-2">Ansatt</div>
            {days.map((d) => (
              <div key={d.date} className="border-l border-line px-2 py-2">
                {d.label}{d.holiday && <span className="block font-normal text-warn">{d.holiday}</span>}
              </div>
            ))}
          </div>
          <div className="grid border-b border-line text-xs" style={cols}>
            <div className="px-3 py-2 font-semibold text-muted">Mangler</div>
            {days.map((d) => (
              <div key={d.date} className="flex flex-col gap-1 border-l border-line p-1.5">
                {d.closed ? <span className="text-muted">Stengt</span>
                  : d.gaps.length ? d.gaps.map((g) => <span key={g} className="badge bg-bad-soft text-bad">{g}</span>)
                  : d.full ? <span className="font-semibold text-good">Fullt</span>
                  : <span className="text-muted">Ingen behov</span>}
              </div>
            ))}
          </div>

          {rows.map((r) => {
            const lit = activeEmp === r.id;
            return (
              <div key={r.id} className="grid border-b border-line" style={cols}>
                <div {...dragProps({ kind: "emp", id: r.id })}
                  onClick={() => setPicked((p) => (p === r.id ? null : r.id))}
                  title="Dra inn på en dag, eller trykk og velg dag"
                  className={`cursor-grab select-none px-3 py-2.5 active:cursor-grabbing ${lit ? "bg-brand-soft" : "hover:bg-paper"}`}>
                  <div className="text-sm font-semibold">{r.name}</div>
                  <div className="text-xs text-muted">{r.hours}</div>
                </div>
                {r.cells.map((c) => {
                  const key = `${r.id}|${c.date}`;
                  const bg = lit ? FIT_BG[c.fit] : "";
                  const target = over === key || (lit && over?.endsWith(`|${c.date}`));
                  return (
                    <div key={c.date} {...dropProps(r.id, c.date)}
                      onClick={(e) => { if (e.target === e.currentTarget) place(picked ?? r.id, c.date); }}
                      className={`group flex min-h-16 cursor-pointer flex-col gap-1 border-l border-line p-1.5 ${bg} ${target ? "outline outline-2 -outline-offset-2 outline-brand" : ""}`}>
                      {c.shifts.map((s) => (
                        <div key={s.id} {...dragProps({ kind: "shift", id: s.id, employeeId: r.id })}
                          className={`relative cursor-grab rounded-md border-l-4 px-2 py-1 text-xs leading-tight ${s.draft ? "border border-dashed border-line bg-white" : "bg-paper"}`}
                          style={{ borderLeftColor: s.color, borderLeftStyle: "solid" }}>
                          <Link href={`/vaktplan/vakt/${s.id}?tilbake=${encodeURIComponent(back)}`} className="block pr-4 font-semibold tabular-nums hover:text-brand">{s.time}</Link>
                          {s.label && <div className="text-muted">{s.label}</div>}
                          <button type="button" aria-label={`Fjern vakten ${s.time}`} onClick={() => run(() => removeFromBoard(s.id))}
                            className="absolute right-0.5 top-0.5 hidden h-5 w-5 items-center justify-center rounded text-muted hover:bg-bad-soft hover:text-bad group-hover:flex">×</button>
                        </div>
                      ))}
                      {c.holidayPay && (c.holidayPay.marked !== null ? (
                        <span className="flex items-center justify-between gap-1 rounded-md bg-good-soft px-1.5 py-1 text-[11px] font-semibold text-good">
                          Betalt helligdag {c.holidayPay.marked.toLocaleString("nb-NO")} t
                          <button type="button" aria-label="Fjern betalt helligdag" className="text-good/70 hover:text-bad"
                            onClick={() => run(() => setHolidayPayment({ employeeId: r.id, date: c.date, hours: null }))}>×</button>
                        </span>
                      ) : (
                        <button type="button" title="Timelønnede får bare lønn for helligdager de jobber. Marker her hvis vedkommende likevel skal ha betalt, uten at det blir en vakt."
                          className="rounded-md border border-dashed border-line px-1.5 py-1 text-left text-[11px] text-muted hover:border-good hover:text-good"
                          onClick={() => run(() => setHolidayPayment({ employeeId: r.id, date: c.date, hours: c.holidayPay!.hours }))}>
                          + Betalt helligdag
                        </button>
                      ))}
                      {lit && c.note && <span className={`text-[11px] font-semibold ${FIT_TEXT[c.fit]}`}>{c.note}</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}

          <div className="grid" style={cols}>
            <div className="px-3 py-2.5">
              <div className="text-sm font-semibold">Ledige vakter</div>
              <div className="text-xs text-muted">Dra hit for å gjøre ledig</div>
            </div>
            {days.map((d) => (
              <div key={d.date} {...dropProps(null, d.date)}
                className={`flex min-h-12 flex-col gap-1 border-l border-line bg-brand-soft/40 p-1.5 ${over === `open|${d.date}` ? "outline outline-2 -outline-offset-2 outline-brand" : ""}`}>
                {d.open.map((s) => (
                  <div key={s.id} {...dragProps({ kind: "shift", id: s.id, employeeId: null })}
                    className="cursor-grab rounded-md border-l-4 bg-white px-2 py-1 text-xs leading-tight" style={{ borderLeftColor: s.color }}>
                    <Link href={`/vaktplan/vakt/${s.id}?tilbake=${encodeURIComponent(back)}`} className="block font-semibold tabular-nums hover:text-brand">{s.time}</Link>
                    <div className="text-muted">{s.label}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="hidden text-xs text-muted md:block">
        Dra en ansatt inn på en dag, eller trykk på navnet og så på dagen. Dra en vakt for å flytte den; hold Ctrl (Alt på Mac) for å kopiere.
        {days.some((d) => d.holiday) && <> Helligdager: timelønnede får bare lønn hvis de er satt opp, eller markert med «Betalt helligdag» (blir ikke en vakt).</>}
        {activeEmp && <> Fargene viser hvordan dagene passer for {firstName(activeEmp)}: grønn passer, gul bør du tenke over, rød har fravær eller er allerede på jobb.</>}
      </p>

      {/* ---------- Mobil: trykk og plasser ---------- */}
      <div className="space-y-3 md:hidden">
        <div className="card space-y-2">
          <p className="text-sm text-muted">{picked ? `${firstName(picked)} er valgt. Trykk på en dag.` : "Trykk på en ansatt, så på dagen."}</p>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {rows.map((r) => (
              <button key={r.id} type="button" onClick={() => setPicked((p) => (p === r.id ? null : r.id))}
                className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold ${picked === r.id ? "bg-brand text-white" : "border border-line bg-white"}`}>
                {r.name.split(" ")[0]}
              </button>
            ))}
          </div>
        </div>
        {days.map((d) => {
          const cell = picked ? rows.find((r) => r.id === picked)?.cells.find((c) => c.date === d.date) : null;
          const working = rows.flatMap((r) => r.cells.filter((c) => c.date === d.date).flatMap((c) => c.shifts.map((s) => `${r.name.split(" ")[0]} ${s.time}`)));
          return (
            <button key={d.date} type="button" disabled={!picked || pending} onClick={() => picked && place(picked, d.date)}
              className={`card block w-full text-left disabled:opacity-100 ${cell ? FIT_BG[cell.fit] : ""} ${cell?.fit === "good" ? "border-2 border-good" : ""}`}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{d.label}</span>
                <span className={`text-xs font-bold ${d.gaps.length ? "text-bad" : d.full ? "text-good" : "text-muted"}`}>
                  {d.closed ? "Stengt" : d.gaps.length ? `Mangler ${d.gaps.join(", ")}` : d.full ? "Fullt" : "Ingen behov"}
                </span>
              </span>
              <span className="mt-1 block text-sm text-muted">{working.length ? working.join(" · ") : "Ingen på jobb"}</span>
              {cell?.note && <span className={`mt-1 block text-sm font-semibold ${FIT_TEXT[cell.fit]}`}>{cell.note}</span>}
            </button>
          );
        })}
      </div>

      {/* ---------- Spørsmål ---------- */}
      {ask && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 md:items-center" onClick={(e) => { if (e.target === e.currentTarget) setAsk(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="ask-title" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            {ask.kind === "confirm" ? (
              <>
                <h2 id="ask-title" className="text-lg font-bold">Legge inn likevel?</h2>
                <p className="mt-2 text-sm text-muted">{ask.text}</p>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" className="btn-ghost" onClick={() => setAsk(null)}>Avbryt</button>
                  <button type="button" className="btn-primary" onClick={() => { const a = ask; setAsk(null); place(a.employeeId, a.date, true); }}>Ja, legg inn</button>
                </div>
              </>
            ) : (
              <TimeDialog name={nameOf(ask.employeeId)} day={dayLabel(ask.date)} templates={templates} onCancel={() => setAsk(null)}
                onPick={(t) => { const a = ask; setAsk(null); run(() => placeOnDay({ employeeId: a.employeeId, date: a.date, department, ...t })); }} />
            )}
          </div>
        </div>
      )}

      {/* ---------- Beskjed med angre ---------- */}
      {toast && (
        <div role="status" className="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-xl flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-lg md:bottom-6">
          <span className="min-w-0 flex-1">
            {toast.error ?? toast.ok}
            {toast.warning && <span className="mt-0.5 block text-warn-soft">Obs: {toast.warning}</span>}
          </span>
          {toast.undo && (
            <button type="button" className="font-bold text-brand-soft hover:underline" onClick={() => { const u = toast.undo!; setToast(null); run(() => undoBoard(u)); }}>Angre</button>
          )}
          <button type="button" aria-label="Lukk" className="text-white/70 hover:text-white" onClick={() => setToast(null)}>×</button>
        </div>
      )}
    </div>
  );
}

function TimeDialog({ name, day, templates, onPick, onCancel }: {
  name: string; day: string; templates: BoardTemplate[];
  onPick: (t: { start: string; end: string; breakMinutes: number; workRoleId: string | null }) => void; onCancel: () => void;
}) {
  const [sel, setSel] = useState<string>(templates[0]?.id ?? "egen");
  const [own, setOwn] = useState({ start: "08:00", end: "16:00", breakMinutes: 30 });
  const t = templates.find((x) => x.id === sel);
  const submit = () => (t ? onPick({ start: t.start, end: t.end, breakMinutes: t.breakMinutes, workRoleId: t.workRoleId }) : onPick({ ...own, workRoleId: null }));
  const opt = (on: boolean) => `flex min-h-12 w-full items-center justify-between rounded-xl px-3.5 text-left ${on ? "border-2 border-brand bg-brand-soft" : "border border-line bg-white hover:bg-paper"}`;
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2 id="ask-title" className="text-lg font-bold">{name}, {day.toLowerCase()}</h2>
      <p className="mt-1 text-sm text-muted">Det er ikke satt noe behov denne dagen. Velg arbeidstid.</p>
      <div className="mt-4 space-y-2">
        {templates.map((x) => (
          <button key={x.id} type="button" onClick={() => setSel(x.id)} className={opt(sel === x.id)} aria-pressed={sel === x.id}>
            <span className="font-semibold">{x.name}</span>
            <span className="text-sm tabular-nums text-muted">{x.start}–{x.end}{x.breakMinutes ? ` · ${x.breakMinutes} min pause` : ""}</span>
          </button>
        ))}
        <button type="button" onClick={() => setSel("egen")} className={opt(sel === "egen")} aria-pressed={sel === "egen"}>
          <span className="font-semibold">Egen arbeidstid</span>
          <span className="text-sm text-muted">Skriv inn fra–til</span>
        </button>
      </div>
      {sel === "egen" && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <label className="block"><span className="label">Fra</span><input type="time" required value={own.start} onChange={(e) => setOwn({ ...own, start: e.target.value })} className="input" /></label>
          <label className="block"><span className="label">Til</span><input type="time" required value={own.end} onChange={(e) => setOwn({ ...own, end: e.target.value })} className="input" /></label>
          <label className="block"><span className="label">Pause (min)</span><input type="number" min={0} step={5} value={own.breakMinutes} onChange={(e) => setOwn({ ...own, breakMinutes: Number(e.target.value) || 0 })} className="input" /></label>
        </div>
      )}
      {templates.length === 0 && <p className="mt-3 text-xs text-muted">Tips: lag vaktmaler under Bemanningsbehov, så kan du velge dem her.</p>}
      <p className="mt-3 text-xs text-muted">Vakten legges inn som utkast. Den ansatte får beskjed når du publiserer.</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>Avbryt</button>
        <button type="submit" className="btn-primary">Legg inn vakt</button>
      </div>
    </form>
  );
}
