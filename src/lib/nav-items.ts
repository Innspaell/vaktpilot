// Menypunkter som brukes både i klientmenyen og på serversider (f.eks. /meny).

/** Tallet i menyen: saker i «Å gjøre» som krever handling. */
export interface NavCounts { todo: number }

/** Lederområdene. Hver samler flere sider (faner inne på siden). */
export const LEAD = [
  { href: "/vaktplan/rediger", label: "Planlegge", match: ["/vaktplan/rediger", "/bemanning", "/turnus", "/tilgjengelighet"] },
  { href: "/ansatte", label: "Ansatte", match: ["/ansatte", "/fravaer", "/ferie"] },
  { href: "/lonn", label: "Lønn og rapporter", match: ["/lonn", "/rapporter", "/personalliste"] },
  { href: "/innstillinger", label: "Innstillinger", match: ["/innstillinger"], adminOnly: true },
];

/** Lederområdene en bruker skal se: ledere (ikke administrator) ser ikke innstillingene. */
export function leadItems(isAdmin: boolean) {
  return LEAD.filter((l) => isAdmin || !("adminOnly" in l && l.adminOnly));
}
