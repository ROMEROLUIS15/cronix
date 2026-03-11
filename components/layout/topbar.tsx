"use client";

import { Menu, Bell } from "lucide-react";

interface TopbarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  onMenuClick?: () => void;
  user?: any;
}

export function Topbar({ title, subtitle, actions, onMenuClick }: TopbarProps) {
  return (
    <header
      className="sticky top-0 z-20 flex h-14 sm:h-16 items-center gap-3 px-3 sm:px-6"
      style={{
        backgroundColor: "rgba(15,15,18,0.9)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid #272729",
      }}
    >
      {/* Mobile/tablet menu button */}
      <button
        className="p-2 rounded-xl transition-colors hover:bg-white/5 lg:hidden flex-shrink-0"
        onClick={onMenuClick}
        aria-label="Abrir menú"
        style={{ color: "#909098" }}
      >
        <Menu size={20} />
      </button>

      {/* Title */}
      <div className="flex-1 min-w-0">
        <h1
          className="text-base sm:text-lg font-black leading-none tracking-tight truncate"
          style={{ color: "#F2F2F2", letterSpacing: "-0.025em" }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className="text-[10px] sm:text-[11px] font-bold mt-0.5 uppercase tracking-widest truncate"
            style={{ color: "#909098" }}
          >
            {subtitle}
          </p>
        )}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
        {actions}
        <button
          className="relative p-2 rounded-xl transition-all duration-200 hover:bg-white/5"
          style={{ color: "#909098" }}
          aria-label="Notificaciones"
        >
          <Bell size={18} />
          <span
            className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full"
            style={{
              backgroundColor: "#0062FF",
              boxShadow: "0 0 6px rgba(0,98,255,0.8)",
            }}
          />
        </button>
      </div>
    </header>
  );
}
