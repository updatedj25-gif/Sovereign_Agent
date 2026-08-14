import React from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ChatPage from "./pages/chat";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export default function App() {
  // Use BASE_URL for wouter base path to support Codespaces / Replit preview proxies
  const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={basePath}>
        <Switch>
          <Route path="/" component={ChatPage} />
          <Route>
            <div className="p-8 text-center text-slate-400 font-mono">
              404 - Page Not Found
            </div>
          </Route>
        </Switch>
      </WouterRouter>
    </QueryClientProvider>
  );
}