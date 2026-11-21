"use client";

/**
 * NeoBet Quant Pro — single entry point (App Router page).
 * Wraps the commercial AppShell with TanStack Query provider.
 */

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AppShell from "@/components/layout/AppShell";

export default function Page() {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 2,
            refetchOnWindowFocus: false,
            staleTime: 45_000,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={qc}>
      <AppShell />
    </QueryClientProvider>
  );
}
