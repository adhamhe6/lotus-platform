import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { ApiError } from "@/api/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { JobTrackerProvider } from "@/lib/jobs";
import { ThemeProvider } from "@/lib/theme";

export function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache(),
    defaultOptions: {
      queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2 },
    },
  });
}

export function Providers({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const qc = client ?? makeQueryClient();
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider>
            <JobTrackerProvider>{children}</JobTrackerProvider>
          </AuthProvider>
        </TooltipProvider>
        <Toaster position="bottom-right" richColors closeButton />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
