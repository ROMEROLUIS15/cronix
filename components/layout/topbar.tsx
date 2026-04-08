"use client";

import React, { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Menu, Bell } from "lucide-react";
import { NotificationPanel, type InAppNotification } from "./notification-panel";

interface TopbarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  onMenuClick?: () => void;
  notifications?: InAppNotification[];
  onMarkAllRead?: () => void;
}

export function Topbar({
  title,
  subtitle,
  actions,
  onMenuClick,
  notifications = [],
  onMarkAllRead
}: TopbarProps) {
  const t = useTranslations('topbar');
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter(n => !n.is_read).length;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsPanelOpen(false);
      }
    }

    if (isPanelOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isPanelOpen]);

  const handleTogglePanel = () => {
    if (!isPanelOpen && unreadCount > 0 && onMarkAllRead) {
      onMarkAllRead();
    }
    setIsPanelOpen(!isPanelOpen);
  };

  return (
    <header
      className="relative z-10 flex h-14 sm:h-16 items-center gap-3 px-3 sm:px-6 flex-shrink-0"
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
        aria-label={t('openMenu')}
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
      <div ref={containerRef} className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
        {actions}
        <button
          className="relative p-2 rounded-xl transition-all duration-300 hover:bg-white/10 active:scale-90 group"
          style={{
            color: isPanelOpen ? "#F2F2F2" : "#B0B0B8",
            background: isPanelOpen ? "rgba(255,255,255,0.08)" : "transparent",
            boxShadow: isPanelOpen ? "0 0 15px rgba(255,255,255,0.05)" : "none",
          }}
          aria-label={t('notifications')}
          onClick={handleTogglePanel}
        >
          <Bell 
            size={22} 
            className={`transition-transform duration-300 ${isPanelOpen ? 'scale-110' : 'group-hover:scale-110'}`}
          />
          {unreadCount > 0 && (
            <div className="absolute top-1.5 right-1.5 pointer-events-none">
              <span
                className="absolute inset-0 h-2.5 w-2.5 rounded-full animate-sonar"
                style={{ 
                  backgroundColor: "#0062FF",
                  boxShadow: "0 0 8px rgba(0,98,255,0.6)"
                }}
              />
              <span
                className="relative block h-2.5 w-2.5 rounded-full"
                style={{
                  backgroundColor: "#0062FF",
                  boxShadow: "0 0 12px rgba(0,98,255,1)",
                  border: "2px solid #0F0F12"
                }}
              />
            </div>
          )}
        </button>

        <NotificationPanel
          isOpen={isPanelOpen}
          onClose={() => setIsPanelOpen(false)}
          notifications={notifications}
          onMarkAllRead={onMarkAllRead ?? (() => {})}
        />
      </div>
    </header>
  );
}
