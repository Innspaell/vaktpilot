import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export const ORG_COOKIE = "vp_org";

export type Role = "owner" | "admin" | "employee";

export interface AppContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  email: string;
  orgs: { id: string; name: string; role: Role }[];
  org: { id: string; name: string; role: Role; timezone: string; logoUrl: string | null; availabilityEnabled: boolean; clockEnabled: boolean;
    /** Bedriften fører personalliste. staffView: alle ansatte kan vise den (for kontroll). */
    personnelList: boolean; personnelListStaffView: boolean;
    /** Sperret for ubetalt faktura: lederne har bare ansatt-tilgang. */
    blocked: boolean } | null;
  /** Eier eller administrator i bedriften, også når bedriften er sperret (abonnement og fakturaer). */
  isLeader: boolean;
  isAdmin: boolean;
  isPlatformAdmin: boolean;
  employeeId: string | null;
  /** «Når kan jeg jobbe» er slått på for bedriften og for denne ansatte. */
  canSetAvailability: boolean;
}

/** Innlogget bruker, bedriftene vedkommende er med i, og valgt bedrift. */
export const getContext = cache(async (): Promise<AppContext> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: memberships }, { data: platform }, { data: aal }, { data: mfaRequired }] = await Promise.all([
    supabase.from("memberships").select("role, organizations(id, name, timezone, logo_url, availability_enabled, clock_enabled, blocked_at, personnel_list, personnel_list_staff_view)").eq("user_id", user.id),
    supabase.rpc("is_platform_admin"),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.rpc("mfa_required"),
  ]);
  // Tofaktor: ledere og InnSpæll må ha det; andre som har skrudd det på, må bekrefte koden ved innlogging
  if (aal?.currentLevel !== "aal2" && (aal?.nextLevel === "aal2" || mfaRequired)) redirect("/tofaktor");

  type Row = { role: Role; organizations: { id: string; name: string; timezone: string; logo_url: string | null; availability_enabled: boolean | null; clock_enabled: boolean | null; blocked_at: string | null; personnel_list?: boolean | null; personnel_list_staff_view?: boolean | null } | null };
  const rows = ((memberships ?? []) as unknown as Row[]).filter((m) => m.organizations);
  const orgs = rows.map((m) => ({ id: m.organizations!.id, name: m.organizations!.name, role: m.role }));

  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  const chosen = rows.find((m) => m.organizations!.id === wanted) ?? rows[0];
  const org = chosen
    ? {
        id: chosen.organizations!.id,
        name: chosen.organizations!.name,
        role: chosen.role,
        timezone: chosen.organizations!.timezone,
        logoUrl: chosen.organizations!.logo_url,
        availabilityEnabled: Boolean(chosen.organizations!.availability_enabled),
        clockEnabled: chosen.organizations!.clock_enabled !== false,
        personnelList: Boolean(chosen.organizations!.personnel_list),
        personnelListStaffView: chosen.organizations!.personnel_list_staff_view !== false,
        blocked: Boolean(chosen.organizations!.blocked_at),
      }
    : null;

  let employeeId: string | null = null;
  let canSetAvailability = false;
  if (org) {
    const { data } = await supabase.rpc("my_employee_id", { p_org: org.id });
    employeeId = (data as string | null) ?? null;
    if (employeeId && org.availabilityEnabled) {
      const { data: me } = await supabase.from("employees").select("availability_enabled").eq("id", employeeId).maybeSingle();
      canSetAvailability = Boolean(me?.availability_enabled);
    }
  }

  return {
    supabase,
    userId: user.id,
    email: user.email ?? "",
    orgs,
    org,
    isAdmin: org ? org.role !== "employee" && !org.blocked : false,
    isLeader: org ? org.role !== "employee" : false,
    isPlatformAdmin: Boolean(platform),
    employeeId,
    canSetAvailability,
  };
});

/** For sider som krever valgt bedrift. */
export async function requireOrg() {
  const ctx = await getContext();
  if (!ctx.org) redirect(ctx.isPlatformAdmin ? "/ny-bedrift" : "/");
  return ctx as AppContext & { org: NonNullable<AppContext["org"]> };
}

/** Abonnement og fakturaer: ledere, også når bedriften er sperret. */
export async function requireLeader() {
  const ctx = await requireOrg();
  if (!ctx.isLeader) redirect("/");
  return ctx;
}

export async function requireAdmin() {
  const ctx = await requireOrg();
  if (!ctx.isAdmin) redirect("/");
  return ctx;
}
