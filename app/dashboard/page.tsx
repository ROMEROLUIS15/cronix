"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  BarChart3,
  Users,
  DollarSign,
  TrendingUp,
  ArrowRight,
  X,
  Check,
  Ban,
  Pencil,
  Loader2,
  Clock,
  Phone,
  User,
  Trash2,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatTime } from "@/lib/utils";
import { ServicesOnboardingBanner } from "@/components/dashboard/services-onboarding-banner";
import { AppointmentStatusBadge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  format,
  addDays,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  isSameDay,
  isSameMonth,
  parseISO,
  addMonths,
  subMonths,
} from "date-fns";
import { es } from "date-fns/locale";
import type { AppointmentStatus } from "@/types";

type Apt = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  is_dual_booking: boolean;
  notes: string | null;
  client: {
    id: string;
    name: string;
    phone: string | null;
    avatar_url: string | null;
  } | null;
  service: {
    id: string;
    name: string;
    color: string | null;
    duration_min: number;
    price: number;
  } | null;
  assigned_user: { id: string; name: string } | null;
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#FFD60A",
  confirmed: "#0062FF",
  completed: "#30D158",
  cancelled: "#FF3B30",
  no_show: "#8A8A90",
};

export default function DashboardPage() {
  const supabase = createClient();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [userName, setUserName] = useState("Usuario");
  const [tab, setTab] = useState<"agenda" | "resumen">("agenda");
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [monthApts, setMonthApts] = useState<Apt[]>([]);
  const [dayApts, setDayApts] = useState<Apt[]>([]);
  const [loading, setLoading] = useState(true);
  const [dayLoading, setDayLoading] = useState(false);
  const [selectedApt, setSelectedApt] = useState<Apt | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [dayPanelOpen, setDayPanelOpen] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [stats, setStats] = useState({
    todayCount: 0,
    totalClients: 0,
    monthRevenue: 0,
    pending: 0,
  });

  // ── Init ──────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: dbUser } = await supabase
        .from("users")
        .select("business_id, name")
        .eq("id", user.id)
        .single();
      if (dbUser?.business_id) {
        setBusinessId(dbUser.business_id);
        setUserName(dbUser.name?.split(" ")[0] || "Usuario");
      } else {
        setLoading(false);
      }
    }
    init();
  }, []);

  // ── Fetch entire month appointments ──────────────────────────
  const fetchMonthApts = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    const { data } = await supabase
      .from("appointments")
      .select(
        `id, start_at, end_at, status, is_dual_booking, notes,
        client:clients(id, name, phone, avatar_url),
        service:services(id, name, color, duration_min, price),
        assigned_user:users(id, name)`,
      )
      .eq("business_id", businessId)
      .gte("start_at", format(start, "yyyy-MM-dd") + "T00:00:00")
      .lte("start_at", format(end, "yyyy-MM-dd") + "T23:59:59")
      .order("start_at");
    setMonthApts((data as Apt[]) ?? []);
    setLoading(false);
  }, [businessId, currentMonth]);

  // ── Fetch selected day appointments ──────────────────────────
  const fetchDayApts = useCallback(async () => {
    if (!businessId) return;
    setDayLoading(true);
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    const { data } = await supabase
      .from("appointments")
      .select(
        `id, start_at, end_at, status, is_dual_booking, notes,
        client:clients(id, name, phone, avatar_url),
        service:services(id, name, color, duration_min, price),
        assigned_user:users(id, name)`,
      )
      .eq("business_id", businessId)
      .gte("start_at", `${dateStr}T00:00:00`)
      .lte("start_at", `${dateStr}T23:59:59`)
      .order("start_at");
    setDayApts((data as Apt[]) ?? []);
    setDayLoading(false);
  }, [businessId, selectedDate]);

  // ── Fetch stats ───────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    if (!businessId) return;
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const monthStart = format(
      new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      "yyyy-MM-dd",
    );
    const [a, b, c, d] = await Promise.all([
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .gte("start_at", `${todayStr}T00:00:00`)
        .lte("start_at", `${todayStr}T23:59:59`),
      supabase
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .is("deleted_at", null),
      supabase
        .from("transactions")
        .select("net_amount")
        .eq("business_id", businessId)
        .gte("paid_at", `${monthStart}T00:00:00`),
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("status", "pending"),
    ]);
    setStats({
      todayCount: a.count ?? 0,
      totalClients: b.count ?? 0,
      monthRevenue: (c.data ?? []).reduce(
        (s: number, t: any) => s + (t.net_amount ?? 0),
        0,
      ),
      pending: d.count ?? 0,
    });
  }, [businessId]);

  useEffect(() => {
    fetchMonthApts();
  }, [fetchMonthApts]);
  useEffect(() => {
    if (dayPanelOpen) fetchDayApts();
  }, [fetchDayApts, dayPanelOpen]);
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // ── Helpers ───────────────────────────────────────────────────
  const getAptsForDay = (day: Date) =>
    monthApts.filter((a) => isSameDay(parseISO(a.start_at), day));

  const handleDayClick = (day: Date) => {
    setSelectedDate(day);
    setDayPanelOpen(true);
    setSelectedApt(null);
    setPanelOpen(false);
  };

  const openAptPanel = (apt: Apt) => {
    setSelectedApt(apt);
    setPanelOpen(true);
  };
  const closeAptPanel = () => {
    setPanelOpen(false);
    setTimeout(() => setSelectedApt(null), 300);
  };
  const closeDayPanel = () => {
    setDayPanelOpen(false);
    setPanelOpen(false);
  };

  const updateStatus = async (status: AppointmentStatus) => {
    if (!selectedApt) return;
    setUpdatingStatus(true);
    await supabase
      .from("appointments")
      .update({ status })
      .eq("id", selectedApt.id);
    setUpdatingStatus(false);
    setSelectedApt((prev) => (prev ? { ...prev, status } : null));
    fetchMonthApts();
    fetchDayApts();
    fetchStats();
  };

  const deleteAppointment = async (id: string) => {
    setDeletingId(id);
    await supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", id);
    setDeletingId(null);
    setConfirmDelete(null);
    if (selectedApt?.id === id) {
      setPanelOpen(false);
      setSelectedApt(null);
    }
    fetchMonthApts();
    fetchDayApts();
    fetchStats();
  };

  // ── Build calendar grid ───────────────────────────────────────
  const calendarDays: Date[] = (() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    const days: Date[] = [];
    let cur = start;
    while (cur <= end) {
      days.push(cur);
      cur = addDays(cur, 1);
    }
    return days;
  })();

  const today = new Date();
  const WEEK_HEADERS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

  // ── No business ───────────────────────────────────────────────
  if (!loading && !businessId) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md p-8 card-base">
          <div
            className="h-16 w-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: "rgba(0,98,255,0.1)", color: "#0062FF" }}
          >
            <Users size={32} />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: "#F5F5F5" }}>
            ¡Bienvenido a Cronix!
          </h2>
          <p className="mb-6" style={{ color: "#8A8A90" }}>
            Configura tu negocio para comenzar.
          </p>
          <Link href="/dashboard/setup">
            <Button className="w-full btn-primary">
              Configurar mi negocio
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full relative overflow-hidden">
      {/* ── MAIN CONTENT ─────────────────────────────────────── */}
      <div
        className={`flex-1 min-w-0 space-y-5 animate-fade-in transition-all duration-300 overflow-y-auto
        ${dayPanelOpen || panelOpen ? "lg:mr-80 xl:mr-96" : ""}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1
              className="text-xl sm:text-2xl font-black"
              style={{ color: "#F5F5F5", letterSpacing: "-0.03em" }}
            >
              Buenos días, {userName} 👋
            </h1>
            <p
              className="text-xs sm:text-sm capitalize mt-0.5"
              style={{ color: "#8A8A90" }}
            >
              {format(today, "EEEE d 'de' MMMM yyyy", { locale: es })}
            </p>
          </div>
          <Link href="/dashboard/appointments/new">
            <button className="btn-primary flex items-center gap-2 text-sm px-4 py-2 sm:px-5 sm:py-2.5">
              <Plus size={15} />{" "}
              <span className="hidden xs:inline sm:inline">Nueva Cita</span>
              <span className="sm:hidden">Nueva</span>
            </button>
          </Link>
        </div>

        <ServicesOnboardingBanner businessId={businessId ?? ""} />

        {/* Tabs */}
        <div
          className="flex items-center gap-1 p-1 rounded-xl w-fit"
          style={{ background: "#1E1E21" }}
        >
          {(["agenda", "resumen"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 flex items-center gap-2"
              style={
                tab === t
                  ? { background: "#0062FF", color: "#fff" }
                  : { color: "#8A8A90" }
              }
            >
              {t === "agenda" ? (
                <>
                  <CalendarDays size={15} /> Agenda
                </>
              ) : (
                <>
                  <BarChart3 size={15} /> Resumen
                </>
              )}
            </button>
          ))}
        </div>

        {/* ── AGENDA TAB ── */}
        {tab === "agenda" && (
          <div className="space-y-4">
            {/* Month navigator */}
            <div
              className="flex items-center justify-between px-5 py-4 rounded-2xl"
              style={{
                background: "linear-gradient(135deg, #1A1A22 0%, #16161E 100%)",
                border: "1px solid #2E2E3E",
                boxShadow:
                  "0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
            >
              <button
                onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
                className="p-2.5 rounded-xl transition-all duration-150 hover:scale-105 active:scale-95"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  color: "#8A8A90",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <ChevronLeft size={18} />
              </button>
              <div className="text-center">
                <p
                  className="text-base sm:text-lg font-black capitalize"
                  style={{ color: "#F0F0F5", letterSpacing: "-0.03em" }}
                >
                  {format(currentMonth, "MMMM", { locale: es })}
                </p>
                <p
                  className="text-xs font-bold tracking-widest"
                  style={{ color: "#3884FF", opacity: 0.9 }}
                >
                  {format(currentMonth, "yyyy")}
                </p>
              </div>
              <button
                onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
                className="p-2.5 rounded-xl transition-all duration-150 hover:scale-105 active:scale-95"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  color: "#8A8A90",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Legend */}
            <div
              className="flex flex-wrap items-center gap-3 sm:gap-5 px-4 py-2.5 rounded-xl"
              style={{
                background: "rgba(255,255,255,0.025)",
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              {[
                { color: "#FFD60A", label: "Pendiente" },
                { color: "#3884FF", label: "Confirmada" },
                { color: "#30D158", label: "Completada" },
                { color: "#FF3B30", label: "Cancelada" },
              ].map((l) => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full flex-shrink-0"
                    style={{
                      background: l.color,
                      boxShadow: `0 0 5px ${l.color}80`,
                    }}
                  />
                  <span
                    className="text-[11px] font-semibold"
                    style={{ color: "#9A9AAA" }}
                  >
                    {l.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: "#18181F",
                border: "1px solid #2A2A38",
                boxShadow:
                  "0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(56,132,255,0.05), inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
            >
              {/* Week headers */}
              <div
                className="grid grid-cols-7"
                style={{
                  borderBottom: "1px solid #2A2A38",
                  background:
                    "linear-gradient(180deg, #22222E 0%, #1C1C28 100%)",
                }}
              >
                {WEEK_HEADERS.map((d) => (
                  <div key={d} className="py-3.5 text-center">
                    <span
                      className="text-[11px] font-black uppercase tracking-widest"
                      style={{ color: "#5A5A72" }}
                    >
                      {d}
                    </span>
                  </div>
                ))}
              </div>

              {loading ? (
                <div className="flex justify-center items-center h-64">
                  <Loader2
                    size={28}
                    className="animate-spin"
                    style={{ color: "#0062FF" }}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-7">
                  {calendarDays.map((day, idx) => {
                    const apts = getAptsForDay(day);
                    const isToday = isSameDay(day, today);
                    const isSelected =
                      isSameDay(day, selectedDate) && dayPanelOpen;
                    const isThisMonth = isSameMonth(day, currentMonth);
                    const hasApts = apts.length > 0;
                    const isLast = idx === calendarDays.length - 1;
                    const colIdx = idx % 7;

                    return (
                      <button
                        key={day.toISOString()}
                        onClick={() => handleDayClick(day)}
                        className="relative min-h-[64px] sm:min-h-[80px] md:min-h-[88px] p-1.5 sm:p-2 text-left transition-all duration-150 group"
                        style={{
                          borderRight:
                            colIdx < 6 ? "1px solid #242430" : "none",
                          borderBottom:
                            idx < calendarDays.length - 7
                              ? "1px solid #242430"
                              : "none",
                          background: isSelected
                            ? "rgba(56,132,255,0.14)"
                            : isToday
                              ? "rgba(56,132,255,0.07)"
                              : isThisMonth
                                ? "#1E1E28"
                                : "#16161C",
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected)
                            (e.currentTarget as HTMLElement).style.background =
                              isToday
                                ? "rgba(56,132,255,0.14)"
                                : isThisMonth
                                  ? "#262634"
                                  : "#1C1C24";
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected)
                            (e.currentTarget as HTMLElement).style.background =
                              isToday
                                ? "rgba(56,132,255,0.07)"
                                : isThisMonth
                                  ? "#1E1E28"
                                  : "#16161C";
                        }}
                      >
                        {/* Day number */}
                        <div
                          className="h-7 w-7 rounded-full flex items-center justify-center text-sm font-bold mb-1.5"
                          style={
                            isToday
                              ? {
                                  background: "#3884FF",
                                  color: "#fff",
                                  boxShadow: "0 0 12px rgba(56,132,255,0.6)",
                                }
                              : isSelected
                                ? {
                                    color: "#63B3FF",
                                    background: "rgba(56,132,255,0.18)",
                                  }
                                : { color: isThisMonth ? "#D8D8E8" : "#3A3A4A" }
                          }
                        >
                          {format(day, "d")}
                        </div>

                        {/* Appointment chips */}
                        {hasApts && (
                          <div className="space-y-0.5">
                            {apts.slice(0, 3).map((apt) => (
                              <div
                                key={apt.id}
                                className="w-full rounded-md px-1.5 py-1 text-[10px] font-bold truncate leading-tight"
                                style={{
                                  background: `${STATUS_COLORS[apt.status] ?? "#3884FF"}28`,
                                  color: STATUS_COLORS[apt.status] ?? "#63B3FF",
                                  border: `1px solid ${STATUS_COLORS[apt.status] ?? "#3884FF"}50`,
                                  borderLeftWidth: "2px",
                                  borderLeftColor:
                                    STATUS_COLORS[apt.status] ?? "#3884FF",
                                }}
                              >
                                {apt.client?.name?.split(" ")[0]}
                              </div>
                            ))}
                            {apts.length > 3 && (
                              <div
                                className="text-[9px] font-bold px-1 mt-0.5"
                                style={{ color: "#6A6A72" }}
                              >
                                +{apts.length - 3} más
                              </div>
                            )}
                          </div>
                        )}

                        {/* Selected indicator dot */}
                        {isSelected && (
                          <div
                            className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full"
                            style={{
                              background: "#0062FF",
                              boxShadow: "0 0 6px rgba(0,98,255,0.8)",
                            }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Monthly summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {
                  value: monthApts.filter((a) => a.status !== "cancelled")
                    .length,
                  label: "Citas activas",
                  color: "#F0F0F5",
                  glow: "rgba(255,255,255,0.05)",
                  border: "#2A2A38",
                  icon: "📅",
                },
                {
                  value: monthApts.filter((a) => a.status === "pending").length,
                  label: "Pendientes",
                  color: "#FFD60A",
                  glow: "rgba(255,214,10,0.08)",
                  border: "rgba(255,214,10,0.2)",
                  icon: "⏳",
                },
                {
                  value: monthApts.filter((a) => a.status === "completed")
                    .length,
                  label: "Completadas",
                  color: "#30D158",
                  glow: "rgba(48,209,88,0.08)",
                  border: "rgba(48,209,88,0.2)",
                  icon: "✅",
                },
                {
                  value: monthApts.filter((a) => a.status === "confirmed")
                    .length,
                  label: "Confirmadas",
                  color: "#3884FF",
                  glow: "rgba(56,132,255,0.08)",
                  border: "rgba(56,132,255,0.2)",
                  icon: "🔵",
                },
              ].map((s) => (
                <div
                  key={s.label}
                  className="flex flex-col items-center justify-center py-4 px-3 rounded-2xl"
                  style={{
                    background: `linear-gradient(135deg, #1A1A22 0%, #16161E 100%)`,
                    border: `1px solid ${s.border}`,
                    boxShadow: `0 4px 20px ${s.glow}, inset 0 1px 0 rgba(255,255,255,0.03)`,
                  }}
                >
                  <p
                    className="text-2xl font-black"
                    style={{
                      color: s.color,
                      letterSpacing: "-0.03em",
                      lineHeight: 1,
                    }}
                  >
                    {s.value}
                  </p>
                  <p
                    className="text-[10px] font-bold uppercase tracking-widest mt-1.5"
                    style={{ color: "#5A5A6A" }}
                  >
                    {s.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── RESUMEN TAB ── */}
        {tab === "resumen" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <StatCard
                title="Citas hoy"
                value={stats.todayCount}
                subtitle={`${stats.pending} pendientes`}
                icon={<CalendarDays size={22} />}
                accent
              />
              <StatCard
                title="Clientes totales"
                value={stats.totalClients}
                icon={<Users size={22} />}
              />
              <StatCard
                title="Ingresos del mes"
                value={formatCurrency(stats.monthRevenue)}
                icon={<DollarSign size={22} />}
              />
              <StatCard
                title="Por confirmar"
                value={stats.pending}
                subtitle="citas pendientes"
                icon={<TrendingUp size={22} />}
              />
            </div>
            <div className="card-base">
              <h2
                className="text-base font-bold mb-4"
                style={{ color: "#F5F5F5" }}
              >
                Acciones rápidas
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  {
                    href: "/dashboard/appointments/new",
                    label: "Nueva cita",
                    icon: CalendarDays,
                    primary: true,
                  },
                  {
                    href: "/dashboard/clients/new",
                    label: "Nuevo cliente",
                    icon: Users,
                  },
                  {
                    href: "/dashboard/finances/new",
                    label: "Registrar cobro",
                    icon: DollarSign,
                  },
                ].map((action) => {
                  const Icon = action.icon;
                  return (
                    <Link
                      key={action.href}
                      href={action.href}
                      className="flex items-center gap-3 p-3 rounded-xl text-sm font-semibold transition-all duration-200"
                      style={
                        action.primary
                          ? {
                              background: "#0062FF",
                              color: "#fff",
                              border: "1px solid #0062FF",
                            }
                          : {
                              background: "#1E1E21",
                              color: "#F5F5F5",
                              border: "1px solid #262629",
                            }
                      }
                    >
                      <Icon size={16} /> {action.label}
                      <ArrowRight size={14} className="ml-auto opacity-50" />
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── DAY PANEL (list of all appointments for selected day) ── */}
      <div
        className={`fixed top-0 right-0 h-full flex flex-col z-40 transition-transform duration-300
        ${dayPanelOpen ? "translate-x-0" : "translate-x-full"}
        ${panelOpen ? "w-0 overflow-hidden" : "w-full sm:w-80 md:w-96"}`}
        style={{ background: "#0C0C0F", borderLeft: "1px solid #262629" }}
      >
        {!panelOpen && (
          <>
            {/* Day panel header */}
            <div
              className="flex items-center justify-between px-5 py-4 flex-shrink-0"
              style={{ borderBottom: "1px solid #262629" }}
            >
              <div>
                <p
                  className="text-xs font-bold uppercase tracking-widest"
                  style={{ color: "#0062FF" }}
                >
                  Citas del día
                </p>
                <p
                  className="text-lg font-black mt-0.5 capitalize"
                  style={{ color: "#F5F5F5", letterSpacing: "-0.02em" }}
                >
                  {format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/dashboard/appointments/new"
                  className="p-2 rounded-xl transition-colors"
                  style={{ background: "rgba(0,98,255,0.1)", color: "#0062FF" }}
                  title="Nueva cita"
                >
                  <Plus size={18} />
                </Link>
                <button
                  onClick={closeDayPanel}
                  className="p-2 rounded-xl transition-colors hover:bg-white/5"
                  style={{ color: "#8A8A90" }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Day appointments list */}
            <div className="flex-1 overflow-y-auto">
              {dayLoading ? (
                <div className="flex justify-center items-center h-40">
                  <Loader2
                    size={24}
                    className="animate-spin"
                    style={{ color: "#0062FF" }}
                  />
                </div>
              ) : dayApts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 px-6">
                  <div
                    className="h-14 w-14 rounded-2xl flex items-center justify-center mb-4"
                    style={{
                      background: "rgba(0,98,255,0.08)",
                      border: "1px solid rgba(0,98,255,0.15)",
                    }}
                  >
                    <CalendarDays size={24} style={{ color: "#0062FF" }} />
                  </div>
                  <p
                    className="text-sm font-bold mb-1"
                    style={{ color: "#F5F5F5" }}
                  >
                    Sin citas
                  </p>
                  <p
                    className="text-xs text-center mb-4"
                    style={{ color: "#8A8A90" }}
                  >
                    No hay citas agendadas para este día
                  </p>
                  <Link
                    href="/dashboard/appointments/new"
                    className="btn-primary text-xs px-4 py-2 rounded-xl flex items-center gap-2"
                  >
                    <Plus size={14} /> Agendar cita
                  </Link>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {dayApts.map((apt) => (
                    <div
                      key={apt.id}
                      className="rounded-2xl overflow-hidden transition-all duration-200"
                      style={{
                        background: "#141417",
                        border: `1px solid ${STATUS_COLORS[apt.status] ?? "#262629"}40`,
                        borderLeft: `3px solid ${STATUS_COLORS[apt.status] ?? "#0062FF"}`,
                      }}
                    >
                      {/* Confirm delete overlay */}
                      {confirmDelete === apt.id ? (
                        <div className="p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <AlertCircle
                              size={16}
                              style={{ color: "#FF3B30" }}
                            />
                            <p
                              className="text-sm font-bold"
                              style={{ color: "#F5F5F5" }}
                            >
                              ¿Cancelar esta cita?
                            </p>
                          </div>
                          <p
                            className="text-xs mb-4"
                            style={{ color: "#8A8A90" }}
                          >
                            Esta acción marcará la cita como cancelada.
                          </p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="flex-1 py-2 rounded-xl text-xs font-bold transition-colors"
                              style={{
                                background: "#1E1E21",
                                color: "#F5F5F5",
                                border: "1px solid #262629",
                              }}
                            >
                              No, volver
                            </button>
                            <button
                              onClick={() => deleteAppointment(apt.id)}
                              disabled={deletingId === apt.id}
                              className="flex-1 py-2 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1"
                              style={{
                                background: "rgba(255,59,48,0.1)",
                                color: "#FF3B30",
                                border: "1px solid rgba(255,59,48,0.2)",
                              }}
                            >
                              {deletingId === apt.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <>
                                  <Trash2 size={12} /> Cancelar cita
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <button
                            className="w-full p-4 text-left"
                            onClick={() => openAptPanel(apt)}
                          >
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex-1 min-w-0">
                                <p
                                  className="text-sm font-bold truncate"
                                  style={{ color: "#F5F5F5" }}
                                >
                                  {apt.client?.name}
                                </p>
                                <p
                                  className="text-xs truncate"
                                  style={{ color: "#8A8A90" }}
                                >
                                  {apt.service?.name}
                                </p>
                              </div>
                              <span
                                className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                                style={{
                                  background: `${STATUS_COLORS[apt.status]}22`,
                                  color: STATUS_COLORS[apt.status],
                                }}
                              >
                                {apt.status === "pending"
                                  ? "Pendiente"
                                  : apt.status === "confirmed"
                                    ? "Confirmada"
                                    : apt.status === "completed"
                                      ? "Completada"
                                      : apt.status === "cancelled"
                                        ? "Cancelada"
                                        : "No show"}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span
                                className="flex items-center gap-1 text-[11px]"
                                style={{ color: "#8A8A90" }}
                              >
                                <Clock size={11} />
                                {formatTime(apt.start_at)} –{" "}
                                {formatTime(apt.end_at)}
                              </span>
                              {apt.client?.phone && (
                                <span
                                  className="flex items-center gap-1 text-[11px]"
                                  style={{ color: "#8A8A90" }}
                                >
                                  <Phone size={11} /> {apt.client.phone}
                                </span>
                              )}
                            </div>
                          </button>

                          {/* Quick actions row */}
                          <div className="flex items-center gap-1 px-3 pb-3">
                            <Link
                              href={`/dashboard/appointments/${apt.id}/edit`}
                              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors"
                              style={{
                                background: "rgba(0,98,255,0.08)",
                                color: "#4D83FF",
                                border: "1px solid rgba(0,98,255,0.15)",
                              }}
                            >
                              <Pencil size={11} /> Editar
                            </Link>
                            {apt.status !== "completed" &&
                              apt.status !== "cancelled" && (
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    setUpdatingStatus(true);
                                    await supabase
                                      .from("appointments")
                                      .update({ status: "confirmed" })
                                      .eq("id", apt.id);
                                    setUpdatingStatus(false);
                                    fetchMonthApts();
                                    fetchDayApts();
                                  }}
                                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors"
                                  style={{
                                    background: "rgba(48,209,88,0.08)",
                                    color: "#30D158",
                                    border: "1px solid rgba(48,209,88,0.15)",
                                  }}
                                >
                                  <Check size={11} /> Confirmar
                                </button>
                              )}
                            {apt.status !== "cancelled" && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDelete(apt.id);
                                }}
                                className="p-1.5 rounded-lg transition-colors"
                                style={{
                                  background: "rgba(255,59,48,0.08)",
                                  color: "#FF3B30",
                                  border: "1px solid rgba(255,59,48,0.15)",
                                }}
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── APT DETAIL PANEL ── */}
      <div
        className={`fixed top-0 right-0 h-full w-full sm:w-80 md:w-96 flex flex-col z-50 transition-transform duration-300
        ${panelOpen ? "translate-x-0" : "translate-x-full"}`}
        style={{ background: "#0C0C0F", borderLeft: "1px solid #262629" }}
      >
        {selectedApt && (
          <>
            <div
              className="flex items-center justify-between px-5 py-4 flex-shrink-0"
              style={{
                borderBottom: "1px solid #262629",
                borderTop: `3px solid ${STATUS_COLORS[selectedApt.status] ?? "#0062FF"}`,
              }}
            >
              <div>
                <p
                  className="text-xs font-bold uppercase tracking-widest"
                  style={{ color: "#8A8A90" }}
                >
                  Detalle de cita
                </p>
                <p
                  className="text-base font-black mt-0.5"
                  style={{ color: "#F5F5F5" }}
                >
                  {selectedApt.client?.name}
                </p>
              </div>
              <button
                onClick={closeAptPanel}
                className="p-2 rounded-xl hover:bg-white/5 transition-colors"
                style={{ color: "#8A8A90" }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Status + price */}
              <div className="flex items-center justify-between">
                <span
                  className="badge"
                  style={{
                    background: `${STATUS_COLORS[selectedApt.status]}20`,
                    color: STATUS_COLORS[selectedApt.status],
                    border: `1px solid ${STATUS_COLORS[selectedApt.status]}30`,
                  }}
                >
                  {selectedApt.status === "pending"
                    ? "● Pendiente"
                    : selectedApt.status === "confirmed"
                      ? "● Confirmada"
                      : selectedApt.status === "completed"
                        ? "● Completada"
                        : selectedApt.status === "cancelled"
                          ? "● Cancelada"
                          : "● No show"}
                </span>
                <span
                  className="text-base font-black"
                  style={{ color: "#F5F5F5" }}
                >
                  {formatCurrency(selectedApt.service?.price ?? 0)}
                </span>
              </div>

              {/* Details */}
              <div className="space-y-0">
                {[
                  {
                    label: "Servicio",
                    value: selectedApt.service?.name,
                    icon: <User size={13} />,
                  },
                  {
                    label: "Hora",
                    value: `${formatTime(selectedApt.start_at)} – ${formatTime(selectedApt.end_at)}`,
                    icon: <Clock size={13} />,
                  },
                  {
                    label: "Duración",
                    value: `${selectedApt.service?.duration_min} min`,
                    icon: <Clock size={13} />,
                  },
                  {
                    label: "Empleado",
                    value: selectedApt.assigned_user?.name ?? "Sin asignar",
                    icon: <User size={13} />,
                  },
                  {
                    label: "Teléfono",
                    value: selectedApt.client?.phone ?? "—",
                    icon: <Phone size={13} />,
                  },
                ].map(({ label, value, icon }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between py-3"
                    style={{ borderBottom: "1px solid #262629" }}
                  >
                    <span
                      className="flex items-center gap-2 text-xs font-medium"
                      style={{ color: "#8A8A90" }}
                    >
                      {icon} {label}
                    </span>
                    <span
                      className="text-sm font-semibold"
                      style={{ color: "#F5F5F5" }}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>

              {selectedApt.notes && (
                <div
                  className="p-3 rounded-xl"
                  style={{ background: "#1E1E21", border: "1px solid #262629" }}
                >
                  <p
                    className="text-xs font-bold mb-1"
                    style={{ color: "#8A8A90" }}
                  >
                    Notas
                  </p>
                  <p className="text-sm" style={{ color: "#F5F5F5" }}>
                    {selectedApt.notes}
                  </p>
                </div>
              )}

              {/* Status actions */}
              {selectedApt.status !== "completed" &&
                selectedApt.status !== "cancelled" && (
                  <div className="space-y-2">
                    <p
                      className="text-[10px] font-bold uppercase tracking-widest"
                      style={{ color: "#8A8A90" }}
                    >
                      Cambiar estado
                    </p>
                    <div className="space-y-2">
                      {selectedApt.status !== "confirmed" && (
                        <button
                          onClick={() => updateStatus("confirmed")}
                          disabled={updatingStatus}
                          className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                          style={{
                            background: "rgba(0,98,255,0.1)",
                            color: "#4D83FF",
                            border: "1px solid rgba(0,98,255,0.2)",
                          }}
                        >
                          <Check size={15} /> Confirmar cita
                        </button>
                      )}
                      <button
                        onClick={() => updateStatus("completed")}
                        disabled={updatingStatus}
                        className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                        style={{
                          background: "rgba(48,209,88,0.1)",
                          color: "#30D158",
                          border: "1px solid rgba(48,209,88,0.2)",
                        }}
                      >
                        <Check size={15} /> Marcar completada
                      </button>
                      <button
                        onClick={() => updateStatus("cancelled")}
                        disabled={updatingStatus}
                        className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                        style={{
                          background: "rgba(255,59,48,0.1)",
                          color: "#FF3B30",
                          border: "1px solid rgba(255,59,48,0.2)",
                        }}
                      >
                        <Ban size={15} /> Cancelar cita
                      </button>
                    </div>
                  </div>
                )}
            </div>

            <div
              className="p-4 space-y-2 flex-shrink-0"
              style={{ borderTop: "1px solid #262629" }}
            >
              <Link
                href={`/dashboard/appointments/${selectedApt.id}/edit`}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-colors"
                style={{ background: "#0062FF", color: "#fff" }}
              >
                <Pencil size={15} /> Editar cita completa
              </Link>
              <button
                onClick={closeAptPanel}
                className="w-full py-2 text-xs font-bold transition-colors rounded-xl"
                style={{ color: "#8A8A90" }}
              >
                ← Volver al día
              </button>
            </div>
          </>
        )}
      </div>

      {/* Backdrop mobile */}
      {(dayPanelOpen || panelOpen) && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => {
            closeDayPanel();
            closeAptPanel();
          }}
        />
      )}
    </div>
  );
}
