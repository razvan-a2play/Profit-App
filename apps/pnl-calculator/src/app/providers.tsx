"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster as Sonner } from "sonner";
import { useState } from "react";
import { Toaster, TooltipProvider } from "@platform/ui";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          {children}
          <Toaster />
          <Sonner richColors position="top-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
