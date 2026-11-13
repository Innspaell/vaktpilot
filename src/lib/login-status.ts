export interface LoginStatusRow {
  employee_id: string;
  last_sign_in_at: string | null;
  invite_email: string | null;
  invite_created_at: string | null;
  invite_expires_at: string | null;
  invite_accepted_at: string | null;
  invite_open: boolean | null;
}

export type Tone = "good" | "warn" | "bad" | "muted";

const d = (s: string) => new Date(s).toLocaleDateString("nb-NO", { day: "numeric", month: "short", timeZone: "Europe/Oslo" });
const dt = (s: string) => new Date(s).toLocaleString("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Oslo" });

/** Kort status for innlogging: logget inn, invitasjon venter/utløpt, eller ingen innlogging. */
export function loginStatus(
  e: { user_id: string | null; must_change_password?: boolean | null; end_date?: string | null },
  r: LoginStatusRow | undefined,
): { short: string; long: string; tone: Tone } {
  if (r?.last_sign_in_at) {
    return { short: "Logget inn", long: `Logget inn sist ${dt(r.last_sign_in_at)}.`, tone: "good" };
  }
  if (r?.invite_open && r.invite_expires_at) {
    return {
      short: "Invitert",
      long: `Invitasjon sendt ${d(r.invite_created_at!)} til ${r.invite_email}. Ikke tatt i bruk ennå. Lenken virker til ${d(r.invite_expires_at)}.`,
      tone: "warn",
    };
  }
  if (e.user_id) {
    return {
      short: "Ikke logget inn",
      long: e.must_change_password ? "Har fått midlertidig passord, men har ikke logget inn ennå." : "Har innlogging, men har ikke logget inn ennå.",
      tone: "warn",
    };
  }
  if (r?.invite_expires_at && !r.invite_accepted_at) {
    return { short: "Invitasjon utløpt", long: `Invitasjonen gikk ut ${d(r.invite_expires_at)} uten å bli brukt. Send en ny.`, tone: "bad" };
  }
  return { short: "Ingen innlogging", long: "Har ikke fått innlogging ennå.", tone: "muted" };
}

export const TONE_CLASS: Record<Tone, string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  muted: "bg-paper text-muted",
};
