import { SemaShell } from "@/components/layout/SemaShell";
import { SessionWorkspace } from "@/components/session/SessionWorkspace";

export default function SessionPage() {
  return (
    <SemaShell status="Client-only session">
      <SessionWorkspace />
    </SemaShell>
  );
}
