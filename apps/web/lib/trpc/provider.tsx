"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { getTrpcUrl, trpc } from "./client";

export function TrpcProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Workload counts and MIS figures are expected to be near-real-time
            // (BRS: within 5 minutes), but not chatty. 30s keeps screens live
            // without hammering the API on every tab focus.
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  const [trpcClient] = React.useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: getTrpcUrl(), transformer: superjson })],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
