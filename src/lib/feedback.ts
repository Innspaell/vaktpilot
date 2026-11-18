export const KIND_LABEL: Record<string, string> = { idea: "Ønske", problem: "Noe virker ikke", other: "Annet" };
export const STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: "Sendt", cls: "bg-paper text-muted" },
  planned: { label: "Vi skal lage det", cls: "bg-brand-soft text-brand" },
  done: { label: "På plass", cls: "bg-good-soft text-good" },
  declined: { label: "Ikke nå", cls: "bg-paper text-muted" },
};
