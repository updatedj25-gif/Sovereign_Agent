import React, { useState, createContext, useContext } from "react";
import { useLocation } from "wouter";
import {
  Menu,
  X,
  Plus,
  Terminal,
  MessageSquare,
  Shield,
  Zap,
} from "lucide-react";

interface ShellContextType {
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;
  refreshHistory: () => void;
  handleNewChat: () => void;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
}

const ShellContext = createContext<ShellContextType | undefined>(undefined);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [activeSessionId, setActiveSessionId] = useState<string>(
    () => `sovereign-session-${Date.now()}`
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);

  const refreshHistory = () => {};

  const handleNewChat = () => {
    const newId = `sovereign-session-${Date.now()}`;
    setActiveSessionId(newId);
  };

  const toggleSidebar = () => setIsSidebarOpen((prev) => !prev);

  return (
    <ShellContext.Provider
      value={{
        activeSessionId,
        setActiveSessionId,
        refreshHistory,
        handleNewChat,
        isSidebarOpen,
        toggleSidebar,
      }}
    >
      {children}
    </ShellContext.Provider>
  );
}

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) {
    return {
      activeSessionId: "default-session",
      setActiveSessionId: () => {},
      refreshHistory: () => {},
      handleNewChat: () => {},
      isSidebarOpen: true,
      toggleSidebar: () => {},
    };
  }
  return ctx;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { isSidebarOpen, toggleSidebar, handleNewChat } = useShell();

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* 1. Left Sidebar Navigation (Fixed with overflow-hidden & opacity transition) */}
      <aside
        className={`${
          isSidebarOpen
            ? "w-64 opacity-100"
            : "w-0 opacity-0 pointer-events-none"
        } overflow-hidden transition-all duration-300 ease-in-out bg-slate-900 border-r border-slate-800 flex flex-col z-40 relative shrink-0 select-none`}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between min-w-[256px]">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400 fill-amber-400" />
            <div>
              <h1 className="font-bold text-xs tracking-wider font-mono text-slate-100 uppercase">
                Sovereign Agent
              </h1>
              <span className="text-[10px] text-amber-400 font-mono">Cockpit v2.0</span>
            </div>
          </div>
          <button
            onClick={toggleSidebar}
            className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded"
            title="Collapse Sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* New Session Button */}
        <div className="p-3 min-w-[256px]">
          <button
            onClick={handleNewChat}
            className="w-full py-2 px-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs font-mono flex items-center justify-center gap-2 transition-colors shadow-lg"
          >
            <Plus className="w-4 h-4" /> New Session
          </button>
        </div>

        {/* Nav Links */}
        <nav className="flex-1 px-3 py-2 space-y-1 font-mono text-xs min-w-[256px]">
          <button
            onClick={() => setLocation("/")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg font-medium transition-colors ${
              location === "/"
                ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <MessageSquare className="w-4 h-4 text-amber-400" /> Agent Cockpit
          </button>

          <button
            onClick={() => setLocation("/terminal")}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg font-medium transition-colors ${
              location === "/terminal"
                ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <Terminal className="w-4 h-4 text-amber-400" /> Sandbox Terminal
          </button>
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/40 text-[10px] font-mono text-slate-500 flex justify-between items-center min-w-[256px]">
          <span className="flex items-center gap-1 text-emerald-400">
            <Shield className="w-3 h-3" /> HITL Active
          </span>
          <span>E2B + Cloudflare</span>
        </div>
      </aside>

      {/* 2. Main Workspace Viewport */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-slate-950 min-w-0">
        {/* Top Header Bar with Hamburger Menu Button */}
        <header className="h-10 border-b border-slate-800 bg-slate-900/80 px-3 flex items-center gap-3 z-30 font-mono text-xs shrink-0">
          {!isSidebarOpen && (
            <button
              onClick={toggleSidebar}
              className="p-1.5 hover:bg-slate-800 text-amber-400 hover:text-amber-300 rounded transition-colors flex items-center gap-1"
              title="Open Navigation Menu"
            >
              <Menu className="w-4 h-4" />
              <span className="text-[10px] text-slate-400">Menu</span>
            </button>
          )}
          <span className="text-slate-400 text-[11px] truncate">
            Workspace: <span className="text-slate-200 font-semibold">{location === "/" ? "Agent Console" : "Terminal"}</span>
          </span>
        </header>

        <div className="flex-1 overflow-hidden relative">{children}</div>
      </main>
    </div>
  );
}