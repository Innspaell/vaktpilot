// Menypunkter som brukes både i klientmenyen og på serversider (f.eks. /meny).

export interface NavCounts { approvals: number; mine: number }

/** Lederområdene. Hver samler flere sider (faner inne på siden). */
export const LEAD = [
  { href: "/vaktplan/rediger", label: "Planlegge", match: ["/vaktplan/rediger", "/bemanning", "/turnus", "/tilgjengelighet"] },
  { href: "/ansatte", label: "Ansatte", match: ["/ansatte"] },
  { href: "/fravaer", label: "Fravær og godkjenning", match: ["/fravaer", "/ferie"], count: "approvals" as const },
  { href: "/lonn", label: "Lønn og rapporter", match: ["/lonn", "/rapporter"] },
  { href: "/innstillinger", label: "Innstillinger", match: ["/innstillinger"] },
];
