import { AppShell } from "@/components/shell/app-shell";
import { PageHeading } from "@/components/shell/page-heading";
import { ChatHubBell } from "@/components/shell/chat-hub-bell";
import { NotificationBell } from "@/components/shell/notification-bell";
import { TrpcProvider } from "@/lib/trpc/provider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <TrpcProvider>
      <AppShell
        header={
          <div className="flex w-full items-center justify-between">
            <PageHeading />
            <div className="flex items-center gap-1">
              <NotificationBell />
              <ChatHubBell />
            </div>
          </div>
        }
      >
        {children}
      </AppShell>
    </TrpcProvider>
  );
}
