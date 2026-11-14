import { createClient } from "./supabase/server";

export type SiteSlot = "hero" | "tavle" | "syk";

/** Bildene på vaktpilot.no. Standardbildene ligger i appen; InnSpæll kan bytte dem under Plattform › Nettsiden. */
export const SITE_IMAGES: Record<SiteSlot, { label: string; where: string; src: string; srcSet: string; alt: string; w: number; h: number }> = {
  hero: {
    label: "Søndagskvelden",
    where: "Øverst, ved siden av overskriften",
    src: "/nettside/sofa-1600.webp",
    srcSet: "/nettside/sofa-800.webp 800w, /nettside/sofa-1600.webp 1536w",
    alt: "En leder sitter i sofaen en søndagskveld og stirrer oppgitt på en vaktliste i et regneark.",
    w: 1536, h: 1024,
  },
  tavle: {
    label: "Vaktlista på kjøleskapet",
    where: "Ved «Dette slipper du»",
    src: "/nettside/tavle-1600.webp",
    srcSet: "/nettside/tavle-800.webp 800w, /nettside/tavle-1600.webp 1448w",
    alt: "En tavle på kjøleskapet med vaktliste, spørsmålstegn og lapper: «Hvem tar ekstra vakt lørdag?»",
    w: 1448, h: 1086,
  },
  syk: {
    label: "Sykmelding klokka sju",
    where: "Ved ledige vakter",
    src: "/nettside/syk-1600.webp",
    srcSet: "/nettside/syk-800.webp 800w, /nettside/syk-1600.webp 1536w",
    alt: "En leder holder seg til hodet og ser på mobilen: noen har meldt seg syk.",
    w: 1536, h: 1024,
  },
};

export async function loadSiteImages() {
  const out = Object.fromEntries(Object.entries(SITE_IMAGES).map(([k, v]) => [k, { ...v, custom: false }])) as
    Record<SiteSlot, (typeof SITE_IMAGES)[SiteSlot] & { custom: boolean }>;
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("site_images").select("slot, url, alt");
    for (const r of data ?? []) {
      const s = r.slot as SiteSlot;
      if (out[s]) out[s] = { ...out[s], src: r.url, srcSet: "", alt: r.alt || out[s].alt, custom: true };
    }
  } catch {
    // Standardbildene brukes
  }
  return out;
}
