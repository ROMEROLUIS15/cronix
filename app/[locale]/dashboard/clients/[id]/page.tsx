import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Phone,
  Mail,
  Star,
  Calendar,
  DollarSign,
  Tag,
} from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge, AppointmentStatusBadge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/get-session";
import { formatCurrency, formatDate, formatRelative } from "@/lib/utils";
import * as clientsRepo from "@/lib/repositories/clients.repo";
import type { AppointmentStatus, ClientAppointmentWithDetails } from "@/types";
import { isPast } from "date-fns";
import { DebtActionDialog } from "./DebtActionDialog";

interface Props {
  params: { id: string };
}

export default async function ClientDetailPage({ params }: Props) {
  const session = await getSession();
  if (!session?.business_id) return notFound();

  const supabase = await createClient();

  const client = await clientsRepo.getClientById(supabase, params.id, session.business_id);
  if (!client) return notFound();

  const clientAppointments: ClientAppointmentWithDetails[] =
    await clientsRepo.getClientAppointments(supabase, client.id, session.business_id);

  // Calcular deudas (SÓLO CITAS PASADAS Y NO PAGADAS)
  let totalDebt = 0;
  clientAppointments.forEach((apt) => {
    if (apt.status !== "cancelled" && apt.status !== "no_show") {
      const isAptPast = isPast(new Date(apt.start_at));
      if (isAptPast) {
        const price = apt.service?.price ?? 0;
        const paid = apt.transactions?.reduce(
          (sum, t) => sum + (t.net_amount ?? 0),
          0,
        ) ?? 0;
        const owes = price - paid;
        if (owes > 0) totalDebt += owes;
      }
    }
  });

  // Para mostrar, limitamos a 20 en la UI
  const displayAppointments = clientAppointments.slice(0, 20);
  const isVIP = (client.tags ?? []).includes("VIP");

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <Link
        href="/dashboard/clients"
        className="btn-ghost inline-flex text-sm gap-2 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={16} /> Volver a Clientes
      </Link>

      <Card>
        <div className="flex items-start gap-4">
          <Avatar name={client.name} size="xl" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-foreground">
                {client.name}
              </h1>
              {isVIP && (
                <span className="text-brand-600" title="Cliente VIP">
                  <Star size={18} fill="currentColor" />
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
              {client.phone && (
                <a
                  href={`tel:${client.phone}`}
                  className="flex items-center gap-1.5 hover:text-brand-600"
                >
                  <Phone size={14} /> {client.phone}
                </a>
              )}
              {client.email && (
                <a
                  href={`mailto:${client.email}`}
                  className="flex items-center gap-1.5 hover:text-brand-600"
                >
                  <Mail size={14} /> {client.email}
                </a>
              )}
            </div>
            {(client.tags ?? []).length > 0 && (
              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                <Tag size={12} className="text-muted-foreground" />
                {(client.tags ?? []).map((tag) => (
                  <Badge key={tag} variant="brand">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <Link href={`/dashboard/clients/${client.id}/edit`}>
            <Button variant="secondary" size="sm">
              Editar
            </Button>
          </Link>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="text-center p-4">
          <Calendar size={20} className="text-brand-600 mx-auto mb-2" />
          <p className="text-2xl font-bold text-foreground">
            {client.total_appointments ?? 0}
          </p>
          <p className="text-xs text-muted-foreground">Visitas totales</p>
        </Card>
        <Card className="text-center p-4">
          <DollarSign size={20} className="text-brand-600 mx-auto mb-2" />
          <p className="text-2xl font-bold text-foreground">
            {formatCurrency(client.total_spent ?? 0)}
          </p>
          <p className="text-xs text-muted-foreground">Gasto total</p>
        </Card>
        <Card className="text-center p-4">
          <DollarSign size={20} className="text-brand-600 mx-auto mb-2" />
          <p className="text-2xl font-bold text-foreground">
            {formatCurrency(
              (client.total_appointments ?? 0) > 0
                ? (client.total_spent ?? 0) / (client.total_appointments ?? 1)
                : 0,
            )}
          </p>
          <p className="text-xs text-muted-foreground">Ticket promedio</p>
        </Card>
      </div>

      <DebtActionDialog
        businessId={session.business_id}
        clientId={client.id}
        totalDebt={totalDebt}
      />

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-foreground">
            Historial de Citas
          </h2>
          {client.last_visit_at && (
            <span className="text-xs text-muted-foreground">
              Última: {formatRelative(client.last_visit_at)}
            </span>
          )}
        </div>
        {displayAppointments.length === 0 ? (
          <div className="text-center py-8">
            <Calendar
              size={36}
              className="text-muted-foreground mx-auto mb-2 opacity-40"
            />
            <p className="text-sm text-muted-foreground">
              Sin historial de citas
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayAppointments.map((apt) => {
              const price = apt.service?.price ?? 0;
              const paid = apt.transactions?.reduce(
                (sum, t) => sum + (t.net_amount ?? 0),
                0,
              ) ?? 0;
              const isAptPast = isPast(new Date(apt.start_at));
              const owes =
                apt.status !== "cancelled" && apt.status !== "no_show" && isAptPast
                  ? price - paid
                  : 0;

              return (
                <div
                  key={apt.id}
                  className="flex items-center gap-4 p-3 rounded-xl bg-surface"
                >
                  <div
                    className="w-1 h-10 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: apt.service?.color ?? "#ccc",
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {apt.service?.name ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(apt.start_at, "d MMM yyyy, HH:mm")}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <AppointmentStatusBadge
                      status={(apt.status ?? "pending") as AppointmentStatus}
                    />
                    {owes > 0 && paid > 0 && (
                      <Badge
                        variant="warning"
                        className="text-[10px] text-orange-500 border-orange-500/30"
                      >
                        Abono: {formatCurrency(paid)}
                      </Badge>
                    )}
                  </div>
                  <div className="text-right w-24">
                    <p className="text-sm font-semibold text-foreground">
                      {formatCurrency(price)}
                    </p>
                    {owes > 0 ? (
                      <p className="text-xs font-bold text-red-500">
                        Debe {formatCurrency(owes)}
                      </p>
                    ) : paid >= price && price > 0 ? (
                      <p className="text-xs font-bold text-green-500">Pagado</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {client.notes && (
        <Card>
          <h2 className="text-base font-semibold text-foreground mb-3">
            Notas internas
          </h2>
          <p className="text-sm text-muted-foreground bg-surface rounded-xl p-4">
            {client.notes}
          </p>
        </Card>
      )}
    </div>
  );
}
