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
  org: { id: string; name: string; role: Role; timezone: string; logoUrl: string | null } | null;
  isAdmin: boolean;
  isPlatformAdmin: boolean;
  employeeId: string | null;
}

/** Innlogget bruker, bedriftene hen er med i, og valgt bedrift. */
export const getContext = cache(async (): Promise<AppContext> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: memberships }, { data: platform }] = await Promise.all([
    supabase.from("memberships").select("role, organizations(id, name, timezone, logo_url)").eq("user_id", user.id),
    supabase.rpc("is_platform_admin"),
  ]);

  type Row = { role: Role; organizations: { id: string; name: string; timezone: string; logo_url: string | null } | null };
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
      }
    : null;

  let employeeId: string | null = null;
  if (org) {
    const { data } = await supabase.rpc("my_employee_id", { p_org: org.id });
    employeeId = (data as string | null) ?? null;
  }

  return {
    supabase,
    userId: user.id,
    email: user.email ?? "",
    orgs,
    org,
    isAdmin: org ? org.role !== "employee" : false,
    isPlatformAdmin: Boolean(platform),
    employeeId,
  };
});

/** For sider som krever valgt bedrift. */
export async function requireOrg() {
  const ctx = await getContext();
  if (!ctx.org) redirect(ctx.isPlatformAdmin ? "/ny-bedrift" : "/");
  return ctx as AppContext & { org: NonNullable<AppContext["org"]> };
}

export async function requireAdmin() {
  const ctx = await requireOrg();
  if (!ctx.isAdmin) redirect("/");
  return ctx;
}
