import Link from "next/link";
import type { TodoAction, TodoItem, TodoLevel } from "@/lib/todo";
import { ConfirmSubmit } from "./ConfirmSubmit";
import {
  todoAbsence, todoAnswerSwap, todoApproveEntries, todoApprovePlanned, todoConfirmShift, todoPublish, todoRequest, todoSwap,
} from "@/app/(app)/gjore/actions";

const DOT: Record<TodoLevel, string> = { red: "bg-bad", amber: "bg-warn", blue: "bg-brand", grey: "bg-muted/50" };
const DUE: Record<TodoLevel, string> = { red: "text-bad", amber: "text-warn", blue: "text-muted", grey: "text-muted" };

// Hver knapp i listen er sitt eget skjema; avgjørelsen ligger i et skjult felt
const ACTIONS: Record<string, { fn: (fd: FormData) => Promise<void>; decision?: string }> = {
  approveAbsence: { fn: todoAbsence, decision: "approve" },
  rejectAbsence: { fn: todoAbsence, decision: "reject" },
  approveSwap: { fn: todoSwap, decision: "approve" },
  rejectSwap: { fn: todoSwap, decision: "reject" },
  approveRequest: { fn: todoRequest, decision: "approve" },
  rejectRequest: { fn: todoRequest, decision: "reject" },
  approveEntries: { fn: todoApproveEntries },
  approvePlanned: { fn: todoApprovePlanned },
  publish: { fn: todoPublish },
  confirmShift: { fn: todoConfirmShift },
  acceptSwap: { fn: todoAnswerSwap, decision: "approve" },
  declineSwap: { fn: todoAnswerSwap, decision: "reject" },
};

function Act({ a, primary, formId }: { a: TodoAction; primary: boolean; formId: string }) {
  const cls = `${primary ? "btn-primary" : "btn-ghost"} min-h-10 whitespace-nowrap px-3.5 py-2`;
  if (a.kind === "link") return <Link href={a.href} className={cls}>{a.label}</Link>;
  const def = ACTIONS[a.action];
  return (
    <form id={formId} action={def.fn}>
      {def.decision && <input type="hidden" name="decision" value={def.decision} />}
      {Object.entries(a.fields).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x, i) => <input key={`${k}${i}`} type="hidden" name={k} value={x} />))}
      {a.confirm ? <ConfirmSubmit form={formId} label={a.label} warning={a.confirm} className={cls} /> : <button className={cls}>{a.label}</button>}
    </form>
  );
}

/** Arbeidslisten: én linje per sak, med knappene rett i listen. */
export function TodoList({ items, waiting = [], title = "Å gjøre" }: { items: TodoItem[]; waiting?: string[]; title?: string }) {
  return (
    <section aria-labelledby="todo-h" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 id="todo-h" className="h2">{title}</h2>
        {items.length > 0 && <span className="text-sm text-muted">{items.length} {items.length === 1 ? "sak" : "saker"}</span>}
      </div>
      {items.length === 0 ? (
        <p className="card text-sm text-good">Alt er gjort. Ingenting venter på deg nå.</p>
      ) : (
        <ul className="card divide-y divide-line p-0">
          {items.map((it) => (
            <li key={it.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[it.level]}`} aria-hidden />
              <div className="min-w-0 flex-1 basis-56">
                <div className="font-semibold">{it.title}</div>
                {it.detail && <div className="mt-0.5 text-sm text-muted">{it.detail}</div>}
              </div>
              {it.due && <span className={`text-xs font-bold ${DUE[it.level]}`}>{it.due}</span>}
              <div className="flex flex-wrap items-center gap-2">
                {it.secondary && <Act a={it.secondary} primary={false} formId={`${it.key}-b`} />}
                <Act a={it.primary} primary formId={`${it.key}-a`} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {waiting.length > 0 && (
        <p className="px-1 text-sm text-muted">Venter på lederen: {waiting.join(" · ")}</p>
      )}
    </section>
  );
}
