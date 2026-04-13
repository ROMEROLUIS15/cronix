"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, RefreshCw, CheckCircle2, XCircle, Clock, ShieldOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

type UserStatus = "active" | "pending" | "rejected";

interface AdminUser {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  status: UserStatus | null;
  created_at: string | null;
  business_id: string | null;
  business_name: string | null;
}

const STATUS_CONFIG: Record<
  UserStatus,
  { label: string; icon: typeof CheckCircle2; color: string; bg: string }
> = {
  active:   { label: "Active",   icon: CheckCircle2, color: "text-green-400", bg: "bg-green-400/10" },
  pending:  { label: "Pending",  icon: Clock,        color: "text-yellow-400", bg: "bg-yellow-400/10" },
  rejected: { label: "Blocked",  icon: ShieldOff,    color: "text-red-400",   bg: "bg-red-400/10" },
};

/**
 * 🛡️ ADMIN USERS — Platform user management
 * Security: UID-Locked to platform_admin.
 */
export default function AdminUsersPage() {
  const router = useRouter();
  const t = useTranslations("adminUsers");
  const [authUser, setAuthUser] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<UserStatus | "all">("all");
  const supabase = createClient();

  useEffect(() => {
    async function checkAdmin() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const { data: dbUser, error } = await supabase
        .from("users")
        .select("name, role")
        .eq("id", user.id)
        .single();

      const typed = dbUser as { name: string; role: string } | null;
      if (error || !typed || typed.role !== "platform_admin") {
        router.push("/dashboard");
        return;
      }
      setAuthUser({ id: user.id, name: typed.name });
      setLoading(false);
    }
    checkAdmin();
  }, [router, supabase]);

  const fetchUsers = useCallback(async () => {
    if (!authUser) return;
    setIsRefreshing(true);
    try {
      const { data, error } = await supabase
        .from("users")
        .select(`
          id, name, email, role, status, created_at, business_id,
          businesses ( name )
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const mapped: AdminUser[] = (data ?? []).map((u: any) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        created_at: u.created_at,
        business_id: u.business_id,
        business_name: u.businesses?.name ?? null,
      }));
      setUsers(mapped);
    } catch {
      // silent — data remains as-is
    } finally {
      setIsRefreshing(false);
    }
  }, [authUser, supabase]);

  useEffect(() => {
    if (authUser) fetchUsers();
  }, [authUser, fetchUsers]);

  const changeStatus = useCallback(
    async (userId: string, newStatus: UserStatus) => {
      setUpdatingId(userId);
      try {
        const res = await fetch(`/api/admin/users/${userId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) throw new Error("Failed");
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, status: newStatus } : u))
        );
      } catch {
        // silent
      } finally {
        setUpdatingId(null);
      }
    },
    []
  );

  const filtered = filter === "all" ? users : users.filter((u) => u.status === filter);

  const counts = {
    all: users.length,
    active: users.filter((u) => u.status === "active").length,
    pending: users.filter((u) => u.status === "pending").length,
    rejected: users.filter((u) => u.status === "rejected").length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="w-8 h-8 animate-spin text-primary/50" />
      </div>
    );
  }

  return (
    <div className="p-1 sm:p-2 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Users className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-muted-foreground italic">
              {t("subtitle")} • {authUser?.name}
            </p>
          </div>
        </div>
        <button
          onClick={fetchUsers}
          disabled={isRefreshing}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm font-medium transition-colors border border-white/10 disabled:opacity-50"
        >
          <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
          {isRefreshing ? t("refreshing") : t("refresh")}
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(["all", "active", "pending", "rejected"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              "p-4 rounded-xl border text-left transition-all",
              filter === key
                ? "bg-primary/10 border-primary/30"
                : "bg-black/20 border-white/5 hover:border-white/10"
            )}
          >
            <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold">
              {t(`filter_${key}`)}
            </p>
            <p className="text-2xl font-bold mt-1">{counts[key]}</p>
          </button>
        ))}
      </div>

      {/* Users table */}
      <Card className="bg-black/20 border-white/5 overflow-hidden">
        <CardHeader className="border-b border-white/5 bg-white/[0.02]">
          <CardTitle className="text-base">{t("tableTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 opacity-50 space-y-2">
              <Users className="w-8 h-8" />
              <p className="text-sm">{t("noUsers")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                    <th className="px-5 py-3">{t("thUser")}</th>
                    <th className="px-5 py-3">{t("thBusiness")}</th>
                    <th className="px-5 py-3">{t("thRole")}</th>
                    <th className="px-5 py-3">{t("thStatus")}</th>
                    <th className="px-5 py-3">{t("thJoined")}</th>
                    <th className="px-5 py-3 text-right">{t("thActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => {
                    const statusCfg = STATUS_CONFIG[u.status ?? "pending"];
                    const StatusIcon = statusCfg.icon;
                    const isUpdating = updatingId === u.id;
                    const isSelf = u.id === authUser?.id;

                    return (
                      <tr
                        key={u.id}
                        className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                      >
                        {/* User */}
                        <td className="px-5 py-4">
                          <p className="text-sm font-semibold">{u.name}</p>
                          <p className="text-[11px] text-muted-foreground">{u.email ?? "—"}</p>
                        </td>

                        {/* Business */}
                        <td className="px-5 py-4">
                          <p className="text-xs text-muted-foreground">
                            {u.business_name ?? "—"}
                          </p>
                        </td>

                        {/* Role */}
                        <td className="px-5 py-4">
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-white/5 rounded">
                            {u.role ?? "—"}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-5 py-4">
                          <div className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", statusCfg.bg, statusCfg.color)}>
                            <StatusIcon className="w-3 h-3" />
                            {statusCfg.label}
                          </div>
                        </td>

                        {/* Joined */}
                        <td className="px-5 py-4 text-xs text-muted-foreground tabular-nums">
                          {u.created_at
                            ? formatDistanceToNow(new Date(u.created_at), { addSuffix: true, locale: es })
                            : "—"}
                        </td>

                        {/* Actions */}
                        <td className="px-5 py-4 text-right">
                          {isSelf ? (
                            <span className="text-[10px] text-muted-foreground italic">{t("youLabel")}</span>
                          ) : isUpdating ? (
                            <RefreshCw className="w-4 h-4 animate-spin inline text-primary" />
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              {u.status !== "active" && (
                                <button
                                  onClick={() => changeStatus(u.id, "active")}
                                  className="inline-flex items-center gap-1 text-[10px] font-bold text-green-400 hover:text-green-300 uppercase transition-colors"
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  {t("activateBtn")}
                                </button>
                              )}
                              {u.status !== "rejected" && (
                                <button
                                  onClick={() => changeStatus(u.id, "rejected")}
                                  className="inline-flex items-center gap-1 text-[10px] font-bold text-red-400 hover:text-red-300 uppercase transition-colors"
                                >
                                  <XCircle className="w-3 h-3" />
                                  {t("blockBtn")}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
