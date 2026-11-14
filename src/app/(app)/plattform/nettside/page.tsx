import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { ActionForm, Field } from "@/components/Form";
import { loadSiteImages, type SiteSlot } from "@/lib/site-images";
import { resetSiteImage, saveSiteImage } from "./actions";

export default async function SiteImagesPage() {
  const ctx = await getContext();
  if (!ctx.isPlatformAdmin) redirect("/");
  const img = await loadSiteImages();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/plattform" className="text-sm text-brand">‹ Plattform</Link>
        <h1 className="h1 mt-1">Nettsiden</h1>
        <p className="mt-1 text-sm text-muted">
          Bytt bildene på <a href="/start" target="_blank" className="text-brand">vaktpilot.no</a>. Bruk liggende bilder, gjerne 1600 piksler bredt og under 1 MB.
          Bildeteksten leses opp for blinde og svaksynte og vises hvis bildet ikke laster: beskriv hva bildet viser.
        </p>
      </div>
      {(Object.keys(img) as SiteSlot[]).map((slot) => {
        const i = img[slot];
        return (
          <section key={slot} className="card grid gap-4 md:grid-cols-[240px_1fr]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={i.src} alt={i.alt} className="aspect-[3/2] w-full rounded-lg bg-paper object-cover" />
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="h2">{i.label}</h2>
                <span className={`badge ${i.custom ? "bg-brand-soft text-brand" : "bg-paper text-muted"}`}>{i.custom ? "Eget bilde" : "Standardbilde"}</span>
              </div>
              <p className="text-xs text-muted">{i.where}</p>
              <ActionForm action={saveSiteImage} submitLabel="Lagre" className="mt-3 space-y-3">
                <input type="hidden" name="slot" value={slot} />
                <Field label="Nytt bilde"><input name="file" type="file" accept="image/jpeg,image/png,image/webp" className="input" /></Field>
                <Field label="Bildetekst (hva bildet viser)"><input name="alt" defaultValue={i.alt} maxLength={300} className="input" /></Field>
              </ActionForm>
              {i.custom && (
                <form action={resetSiteImage} className="mt-2">
                  <input type="hidden" name="slot" value={slot} />
                  <button className="text-xs text-muted hover:text-bad">Tilbake til standardbildet</button>
                </form>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
