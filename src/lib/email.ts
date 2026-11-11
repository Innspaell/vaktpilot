import "server-only";

/** Avsender for all e-post fra Vaktpilot. */
export const EMAIL_FROM = "Vaktpilot <ikkesvar@vaktpilot.no>";

export interface Mail { to: string; subject: string; html: string; text: string }

/** Er e-postutsending satt opp (Resend)? */
export function emailEnabled() {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Send via Resend. Returnerer false hvis utsending ikke er satt opp eller feilet. */
export async function sendEmail(m: Mail): Promise<{ sent: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, error: "E-postutsending er ikke satt opp ennå." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
    });
    if (!res.ok) return { sent: false, error: `Resend svarte ${res.status}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : "Ukjent feil" };
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Velkomst-e-post til ny bruker. Passordet tas bare med når lederen har valgt det. */
export function welcomeEmail(p: { name: string; org: string; email: string; loginUrl: string; password?: string | null }): Mail {
  const first = p.name.split(" ")[0] || p.name;
  const pwLine = p.password
    ? `Midlertidig passord: ${p.password}\nDu blir bedt om å lage ditt eget passord første gang du logger inn.`
    : "Passordet får du av lederen din. Du blir bedt om å lage ditt eget passord første gang du logger inn.";
  const text = [
    `Hei ${first}!`,
    "",
    `${p.org} bruker Vaktpilot til vaktplan, timer og fravær. Nå har du fått tilgang.`,
    "",
    `Logg inn her: ${p.loginUrl}`,
    `E-post: ${p.email}`,
    pwLine,
    "",
    "Velg «Har du passord? Logg inn med passord» på innloggingssiden.",
    "Tips: Legg Vaktpilot på hjemskjermen. iPhone: Del-knappen i Safari › «Legg til på Hjem-skjerm». Android: menyen i Chrome › «Installer app».",
    "",
    "Hilsen Vaktpilot",
    "Denne e-posten kan ikke besvares. Spørsmål tar du med lederen din.",
  ].join("\n");
  const html = `<!doctype html><html lang="nb"><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#16202b">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#1f5fbf">Vaktpilot</div>
<div style="background:#fff;border:1px solid #e3e7ec;border-radius:14px;padding:24px;margin-top:12px">
<h1 style="margin:0 0 8px;font-size:22px">Hei ${esc(first)}!</h1>
<p style="margin:0 0 16px;line-height:1.5">${esc(p.org)} bruker Vaktpilot til vaktplan, timer og fravær. Nå har du fått tilgang.</p>
<table style="width:100%;border-collapse:collapse;font-size:15px;margin:0 0 16px">
<tr><td style="padding:6px 0;color:#5b6673">E-post</td><td style="padding:6px 0;font-weight:600">${esc(p.email)}</td></tr>
${p.password ? `<tr><td style="padding:6px 0;color:#5b6673">Midlertidig passord</td><td style="padding:6px 0;font-weight:600;font-family:ui-monospace,Menlo,monospace">${esc(p.password)}</td></tr>` : ""}
</table>
<p style="margin:0 0 20px;line-height:1.5;font-size:14px;color:#5b6673">${p.password ? "Du blir bedt om å lage ditt eget passord første gang du logger inn." : "Passordet får du av lederen din. Du blir bedt om å lage ditt eget passord første gang du logger inn."}</p>
<a href="${esc(p.loginUrl)}" style="display:inline-block;background:#1f5fbf;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Logg inn i Vaktpilot</a>
<p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#5b6673">Velg «Har du passord? Logg inn med passord» på innloggingssiden.<br>Tips: Legg Vaktpilot på hjemskjermen, så fungerer den som en app.</p>
</div>
<p style="font-size:12px;color:#5b6673;margin:16px 0 0">Denne e-posten kan ikke besvares. Spørsmål tar du med lederen din.</p>
</div></body></html>`;
  return { to: p.email, subject: `Velkommen til Vaktpilot – ${p.org}`, html, text };
}

/** Invitasjon: lenke der den ansatte lager passordet selv. */
export function inviteEmail(p: { name: string; org: string; email: string; link: string }): Mail {
  const first = p.name.split(" ")[0] || p.name;
  const text = [
    `Hei ${first}!`,
    "",
    `${p.org} bruker Vaktpilot til vaktplan, timer og fravær. Nå har du fått tilgang.`,
    "",
    `Lag passordet ditt her: ${p.link}`,
    "Lenken virker i 7 dager og kan brukes én gang.",
    `Etterpå logger du inn med e-posten ${p.email} og passordet du valgte.`,
    "",
    "Hilsen Vaktpilot",
    "Denne e-posten kan ikke besvares. Spørsmål tar du med lederen din.",
  ].join("\n");
  const html = `<!doctype html><html lang="nb"><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#16202b">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#1f5fbf">Vaktpilot</div>
<div style="background:#fff;border:1px solid #e3e7ec;border-radius:14px;padding:24px;margin-top:12px">
<h1 style="margin:0 0 8px;font-size:22px">Hei ${esc(first)}!</h1>
<p style="margin:0 0 16px;line-height:1.5">${esc(p.org)} bruker Vaktpilot til vaktplan, timer og fravær. Nå har du fått tilgang. Trykk på knappen og lag ditt eget passord.</p>
<a href="${esc(p.link)}" style="display:inline-block;background:#1f5fbf;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Lag passord</a>
<p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#5b6673">Lenken virker i 7 dager og kan brukes én gang. Etterpå logger du inn med e-posten <b>${esc(p.email)}</b> og passordet du valgte.<br>Tips: Legg Vaktpilot på hjemskjermen, så fungerer den som en app.</p>
</div>
<p style="font-size:12px;color:#5b6673;margin:16px 0 0">Denne e-posten kan ikke besvares. Spørsmål tar du med lederen din.</p>
</div></body></html>`;
  return { to: p.email, subject: `Velkommen til Vaktpilot – ${p.org}`, html, text };
}
