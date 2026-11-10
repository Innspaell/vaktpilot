export const metadata = { title: "Uten nett – Vaktpilot" };

export default function Offline() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 text-center">
      <div className="text-sm font-semibold uppercase tracking-wider text-brand">Vaktpilot</div>
      <h1 className="h1 mt-2">Ingen nettforbindelse</h1>
      <p className="mt-2 text-muted">Vaktplanen og timene hentes fra nettet. Prøv igjen når du har dekning.</p>
      {/* Vanlig lenke med vilje: last hele siden på nytt fra nett */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="btn-primary mt-6">Prøv igjen</a>
    </main>
  );
}
