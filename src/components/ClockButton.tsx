import { clockAction } from "@/app/(app)/actions";

type State = "out" | "working" | "on_break";

export function ClockButton({ state, since }: { state: State; since?: string }) {
  const primary =
    state === "out"
      ? { kind: "in", label: "Start arbeidsdagen" }
      : state === "on_break"
        ? { kind: "break_end", label: "Avslutt pausen" }
        : { kind: "out", label: "Avslutt arbeidsdagen" };

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <span className="h2">Stempling</span>
        <span className={`badge ${state === "out" ? "bg-paper text-muted" : state === "on_break" ? "bg-warn-soft text-warn" : "bg-good-soft text-good"}`}>
          {state === "out" ? "Ikke på jobb" : state === "on_break" ? "Pause" : `På jobb${since ? ` siden ${since}` : ""}`}
        </span>
      </div>
      <form action={clockAction} className="mt-3 flex gap-2">
        <button name="kind" value={primary.kind} className="btn-primary flex-1 py-4 text-base">{primary.label}</button>
        {state === "working" && (
          <button name="kind" value="break_start" className="btn-ghost py-4">Start pause</button>
        )}
      </form>
    </div>
  );
}
