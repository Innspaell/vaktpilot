import "server-only";
import type { getContext } from "./context";
import type { NavCounts } from "./nav-items";
import { todoCount } from "./todo";

/** Tallet i menyen: det som venter i «Å gjøre» (samme liste som på forsiden). */
export async function navCounts(ctx: Awaited<ReturnType<typeof getContext>>): Promise<NavCounts> {
  if (!ctx.org) return { todo: 0 };
  return { todo: await todoCount(ctx as Parameters<typeof todoCount>[0]) };
}
