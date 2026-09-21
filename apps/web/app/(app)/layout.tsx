import { AppShell } from "@/components/shell/app-shell";
import { PageHeading } from "@/components/shell/page-heading";
import { TrpcProvider } from "@/lib/trpc/provider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <TrpcProvider>
      <AppShell header={<PageHeading />}>{children}</AppShell>
    </TrpcProvider>
  );
}
