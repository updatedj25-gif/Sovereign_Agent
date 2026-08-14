import React from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShellProvider } from "./components/layout/Shell";
import ChatPage from "./pages/chat";
import TerminalPage from "./pages/terminal";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export default function App() {
  const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={basePath}>
        <ShellProvider>
          <Switch>
            <Route path="/" component={ChatPage} />
            <Route path="/terminal" component={TerminalPage} />
            <Route>
              <div className="flex h-screen items-center justify-center bg-slate-950 p-8 text-center text-slate-400 font-mono text-xs">
                404 - Page Not Found
              </div>
            </Route>
          </Switch>
        </ShellProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}