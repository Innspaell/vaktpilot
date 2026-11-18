import { ServiceNotices } from "@/components/ServiceNotices";

/** Driftsmeldinger vises også på innloggingssiden, så folk ser det hvis noe er nede. */
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mx-auto max-w-md px-4 pt-4"><ServiceNotices /></div>
      {children}
    </>
  );
}
