import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { employeeImportExample } from "@/lib/employee-import-example";
import { xlsxResponseHeaders } from "@/lib/xlsx";

/** Eksempelfil for import av ansatte. */
export async function GET() {
  const ctx = await getContext();
  if (!ctx.isAdmin) return NextResponse.json({ error: "Ikke tillatt" }, { status: 403 });
  return new NextResponse(new Uint8Array(employeeImportExample()), { headers: xlsxResponseHeaders("vaktpilot-ansatte-eksempel.xlsx") });
}
