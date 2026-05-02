"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard, RefreshCw, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { approveManualPayment, rejectManualPayment } from "./actions";

type InvoiceStatus = "waiting" | "confirming" | "finished" | "failed" | "partially_paid" | "expired" | "refunded";

interface ManualInvoice {
  id: string;
  business_id: string;
  business_name: string | null;
  business_owner: string | null;
  plan_purchased: string;
  amount_usd: number;
  payment_method: string;
  reference_number: string | null;
  status: InvoiceStatus;
  admin_notes: string | null;
  created_at: string;
}

const METHOD_LABEL: Record<string, { label: string; color: string }> = {
  pago_movil:     { label: "Pago Móvil",     color: "text-emerald-400" },
  binance_manual: { label: "Binance Manual", color: "text-yellow-400" },
  nowpayments:    { label: "NOWPayments",    color: "text-blue-400" },
};

const PLAN_COLOR: Record<string, string> = {
  pro:        "text-[#0062FF]",
  enterprise: "text-[#A855F7]",
};

/**
 * 💳 ADMIN PAYMENTS — Manual payment verification panel
 * Security: UID-Locked to platform_admin.
 */
export default function AdminPaymentsPage() {
  const router = useRouter();
  const [authUser, setAuthUser]   = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading]     = useState(true);
  const [invoices, setInvoices]   = useState<ManualInvoice[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const supabase = createClient();

  // ── Auth guard ────────────────────────────────────────────────────────────
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

  // ── Fetch invoices ────────────────────────────────────────────────────────
  const fetchInvoices = useCallback(async () => {
    if (!authUser) return;
    setIsRefreshing(true);
    try {
      const { data, error } = await supabase
        .from("saas_invoices")
        .select(`
          id, business_id, plan_purchased, amount_usd,
          payment_method, reference_number, status, admin_notes, created_at,
          businesses ( name, users ( name ) )
        `)
        .in("payment_method", ["pago_movil", "binance_manual"])
        .order("created_at", { ascending: false });

      if (error) throw error;

      const mapped: ManualInvoice[] = (data ?? []).map((inv: any) => ({
        id: inv.id,
        business_id: inv.business_id,
        business_name: inv.businesses?.name ?? null,
        business_owner: inv.businesses?.users?.[0]?.name ?? null,
        plan_purchased: inv.plan_purchased,
        amount_usd: inv.amount_usd,
        payment_method: inv.payment_method,
        reference_number: inv.reference_number,
        status: inv.status,
        admin_notes: inv.admin_notes,
        created_at: inv.created_at,
      }));
      setInvoices(mapped);
    } catch (err) {
      console.error("AdminPayments fetch error:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [authUser, supabase]);

  useEffect(() => {
    if (authUser) fetchInvoices();
  }, [authUser, fetchInvoices]);

  // ── Approve ───────────────────────────────────────────────────────────────
  const handleApprove = async (invoiceId: string) => {
    setProcessingId(invoiceId);
    const res = await approveManualPayment(invoiceId);
    if (!res.error) {
      setInvoices((prev) =>
        prev.map((inv) => inv.id === invoiceId ? { ...inv, status: "finished" } : inv)
      );
    }
    setProcessingId(null);
  };

  // ── Reject ────────────────────────────────────────────────────────────────
  const handleReject = async () => {
    if (!rejectTarget) return;
    setProcessingId(rejectTarget);
    const res = await rejectManualPayment(rejectTarget, rejectReason || "Referencia no encontrada.");
    if (!res.error) {
      setInvoices((prev) =>
        prev.map((inv) => inv.id === rejectTarget ? { ...inv, status: "failed" } : inv)
      );
    }
    setProcessingId(null);
    setRejectTarget(null);
    setRejectReason("");
  };

  const displayed = filter === "pending"
    ? invoices.filter((i) => i.status === "confirming")
    : invoices;

  const pendingCount = invoices.filter((i) => i.status === "confirming").length;

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
            <CreditCard className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pagos Manuales</h1>
            <p className="text-sm text-muted-foreground italic">
              Verificación de Pago Móvil y Binance • {authUser?.name}
            </p>
          </div>
        </div>
        <button
          onClick={fetchInvoices}
          disabled={isRefreshing}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm font-medium transition-colors border border-white/10 disabled:opacity-50"
        >
          <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
          {isRefreshing ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilter("pending")}
          className={cn(
            "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-colors",
            filter === "pending" ? "bg-amber-400/20 text-amber-400" : "bg-white/5 text-muted-foreground hover:bg-white/10"
          )}
        >
          Pendientes {pendingCount > 0 && <span className="ml-1 bg-amber-400 text-black px-1.5 py-0.5 rounded-full text-[9px]">{pendingCount}</span>}
        </button>
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-colors",
            filter === "all" ? "bg-primary/20 text-primary" : "bg-white/5 text-muted-foreground hover:bg-white/10"
          )}
        >
          Todos ({invoices.length})
        </button>
      </div>

      {/* Table */}
      <Card className="bg-black/20 border-white/5 overflow-hidden">
        <CardHeader className="border-b border-white/5 bg-white/[0.02]">
          <CardTitle className="text-base">
            {filter === "pending" ? "Pagos pendientes de verificación" : "Historial de pagos manuales"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 opacity-50 space-y-2">
              <CreditCard className="w-8 h-8" />
              <p className="text-sm">{filter === "pending" ? "No hay pagos pendientes 🎉" : "Sin registros aún"}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                    <th className="px-5 py-3">Negocio</th>
                    <th className="px-5 py-3">Plan</th>
                    <th className="px-5 py-3">Método</th>
                    <th className="px-5 py-3">Referencia</th>
                    <th className="px-5 py-3">Estado</th>
                    <th className="px-5 py-3">Hace</th>
                    <th className="px-5 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((inv) => {
                    const isProcessing = processingId === inv.id;
                    const methodCfg = METHOD_LABEL[inv.payment_method] ?? { label: inv.payment_method, color: "text-muted-foreground" };
                    const isPending = inv.status === "confirming";

                    return (
                      <tr
                        key={inv.id}
                        className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                      >
                        {/* Business */}
                        <td className="px-5 py-4">
                          <p className="text-sm font-semibold">{inv.business_name ?? "—"}</p>
                          <p className="text-[11px] text-muted-foreground">{inv.business_owner ?? "—"}</p>
                        </td>

                        {/* Plan */}
                        <td className="px-5 py-4">
                          <span className={cn("text-xs font-bold uppercase", PLAN_COLOR[inv.plan_purchased])}>
                            {inv.plan_purchased} — ${inv.amount_usd}
                          </span>
                        </td>

                        {/* Method */}
                        <td className="px-5 py-4">
                          <span className={cn("text-xs font-semibold", methodCfg.color)}>
                            {methodCfg.label}
                          </span>
                        </td>

                        {/* Reference */}
                        <td className="px-5 py-4">
                          <code className="text-xs bg-white/5 px-2 py-0.5 rounded font-mono">
                            {inv.reference_number ?? "—"}
                          </code>
                        </td>

                        {/* Status */}
                        <td className="px-5 py-4">
                          {inv.status === "confirming" && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-amber-400/10 text-amber-400 px-2 py-1 rounded-full">
                              <Clock className="w-3 h-3" /> Pendiente
                            </span>
                          )}
                          {inv.status === "finished" && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-green-400/10 text-green-400 px-2 py-1 rounded-full">
                              <CheckCircle2 className="w-3 h-3" /> Aprobado
                            </span>
                          )}
                          {inv.status === "failed" && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-red-400/10 text-red-400 px-2 py-1 rounded-full">
                              <XCircle className="w-3 h-3" /> Rechazado
                            </span>
                          )}
                        </td>

                        {/* Time */}
                        <td className="px-5 py-4 text-xs text-muted-foreground tabular-nums">
                          {inv.created_at
                            ? formatDistanceToNow(new Date(inv.created_at), { addSuffix: true, locale: es })
                            : "—"}
                        </td>

                        {/* Actions */}
                        <td className="px-5 py-4 text-right">
                          {isProcessing ? (
                            <Loader2 className="w-4 h-4 animate-spin inline text-primary" />
                          ) : isPending ? (
                            <div className="flex items-center justify-end gap-3">
                              <button
                                onClick={() => handleApprove(inv.id)}
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-green-400 hover:text-green-300 uppercase transition-colors"
                              >
                                <CheckCircle2 className="w-3 h-3" /> Aprobar
                              </button>
                              <button
                                onClick={() => { setRejectTarget(inv.id); setRejectReason(""); }}
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-red-400 hover:text-red-300 uppercase transition-colors"
                              >
                                <XCircle className="w-3 h-3" /> Rechazar
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic">
                              {inv.admin_notes ?? "—"}
                            </span>
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

      {/* Reject modal */}
      {rejectTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setRejectTarget(null)}
        >
          <div
            className="bg-[#1C1C21] border border-[#2E2E33] rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-white">Rechazar pago</h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Razón del rechazo (ej: Referencia no encontrada)"
              rows={3}
              className="w-full px-3 py-2 rounded-lg text-sm text-white bg-[#16161A] border border-[#3E3E44] focus:border-red-500 outline-none resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setRejectTarget(null)}
                className="flex-1 py-2 text-xs text-[#909098] bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleReject}
                disabled={processingId !== null}
                className="flex-1 py-2 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50"
              >
                {processingId ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Confirmar rechazo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
