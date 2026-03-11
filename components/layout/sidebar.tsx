"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Users,
  DollarSign,
  BarChart3,
  Settings,
  ChevronRight,
  X,
  LogOut,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signout } from "@/app/login/actions";

const navItems = [
  { href: "/dashboard", label: "Agenda", icon: CalendarDays },
  { href: "/dashboard/clients", label: "Clientes", icon: Users },
  { href: "/dashboard/services", label: "Servicios", icon: Wrench },
  { href: "/dashboard/finances", label: "Finanzas", icon: DollarSign },
  { href: "/dashboard/reports", label: "Reportes", icon: BarChart3 },
  { href: "/dashboard/settings", label: "Ajustes", icon: Settings },
];

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
  user?: any;
  business?: any;
}

export function Sidebar({
  open = true,
  onClose,
  user,
  business,
}: SidebarProps) {
  const pathname = usePathname();
  const initials =
    user?.name
      ?.split(" ")
      .map((n: string) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase() || "U";

  return (
    <>
      {/* Mobile backdrop */}
      {onClose && open && (
        <div
          className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "flex flex-col h-full w-64 flex-shrink-0",
          // Mobile: fixed overlay
          "fixed top-0 left-0 z-40 lg:static lg:z-auto",
          "transition-transform duration-300 ease-in-out",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
        style={{ backgroundColor: "#0C0C0F", borderRight: "1px solid #262629" }}
      >
        {/* Logo */}
        <div
          className="flex items-center justify-between px-4 py-5 flex-shrink-0"
          style={{ borderBottom: "1px solid #262629" }}
        >
          <Link
            href="/dashboard"
            className="flex items-center gap-3 group min-w-0"
          >
            <div className="h-9 w-9 flex-shrink-0 rounded-xl overflow-hidden">
              <Image
                src="/cronix-logo.jpg"
                alt="Cronix"
                width={36}
                height={36}
                className="h-full w-full object-cover"
                unoptimized
              />
            </div>
            <div className="relative h-6 w-24 flex-shrink-0">
              <Image
                src="/cronix-letras.jpg"
                alt="Cronix"
                fill
                className="object-contain object-left"
                unoptimized
              />
            </div>
          </Link>

          {/* Close button — mobile only */}
          {onClose && (
            <button
              className="p-1.5 rounded-lg lg:hidden transition-colors hover:bg-white/5 flex-shrink-0"
              style={{ color: "#8A8A90" }}
              onClick={onClose}
              aria-label="Cerrar menú"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* Business chip */}
        {business && (
          <div
            className="mx-3 mt-4 px-3 py-2.5 rounded-xl flex-shrink-0"
            style={{
              backgroundColor: "rgba(0,98,255,0.08)",
              border: "1px solid rgba(0,98,255,0.15)",
            }}
          >
            <p
              className="text-[10px] font-bold uppercase tracking-widest mb-0.5"
              style={{ color: "#0062FF" }}
            >
              Negocio activo
            </p>
            <p
              className="text-sm font-bold truncate"
              style={{ color: "#F5F5F5" }}
            >
              {business.name}
            </p>
            <p className="text-xs truncate" style={{ color: "#8A8A90" }}>
              {business.category || "Servicios"}
            </p>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <p
            className="px-3 mb-2 text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "#8A8A90" }}
          >
            Principal
          </p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => onClose?.()}
                className={cn(
                  "nav-item",
                  isActive ? "nav-item-active" : "nav-item-inactive",
                )}
              >
                <Icon size={18} className="flex-shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {isActive && (
                  <ChevronRight
                    size={14}
                    style={{ color: "#0062FF" }}
                    className="flex-shrink-0"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        {/* User profile + logout */}
        {user && (
          <div
            className="px-3 py-3 space-y-2 flex-shrink-0"
            style={{ borderTop: "1px solid #262629" }}
          >
            <Link
              href="/dashboard/profile"
              onClick={() => onClose?.()}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200"
              style={{
                backgroundColor:
                  pathname === "/dashboard/profile"
                    ? "rgba(0,98,255,0.1)"
                    : "#1E1E21",
                border:
                  pathname === "/dashboard/profile"
                    ? "1px solid rgba(0,98,255,0.2)"
                    : "1px solid #262629",
              }}
            >
              <div
                className="h-8 w-8 rounded-full flex-shrink-0 overflow-hidden"
                style={{ border: "2px solid #262629" }}
              >
                {user.avatar_url ? (
                  <Image
                    src={user.avatar_url}
                    alt={user.name ?? "Avatar"}
                    width={32}
                    height={32}
                    className="h-full w-full object-cover"
                    unoptimized
                  />
                ) : (
                  <div
                    className="h-full w-full flex items-center justify-center text-xs font-bold"
                    style={{
                      backgroundColor: "rgba(0,98,255,0.15)",
                      color: "#4D83FF",
                    }}
                  >
                    {initials}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-semibold truncate"
                  style={{ color: "#F5F5F5" }}
                >
                  {user.name}
                </p>
                <p
                  className="text-[10px] uppercase tracking-wider"
                  style={{ color: "#8A8A90" }}
                >
                  {user.role}
                </p>
              </div>
            </Link>

            <form action={signout}>
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 active:scale-[0.98] hover:brightness-125"
                style={{
                  backgroundColor: "rgba(255,59,48,0.08)",
                  color: "#FF3B30",
                  border: "1px solid rgba(255,59,48,0.2)",
                }}
              >
                <LogOut size={13} />
                Cerrar sesión
              </button>
            </form>
          </div>
        )}
      </aside>
    </>
  );
}
