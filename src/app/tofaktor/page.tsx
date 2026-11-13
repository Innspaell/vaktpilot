import type { Metadata } from "next";
import { TwoFactor } from "./TwoFactor";

export const metadata: Metadata = { title: "Tofaktor – Vaktpilot" };

export default function TwoFactorPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <TwoFactor />
    </main>
  );
}
