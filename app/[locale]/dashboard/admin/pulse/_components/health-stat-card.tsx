"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, ShieldAlert, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface HealthStatCardProps {
  stat: {
    service: string;
    status: 'healthy' | 'degraded' | 'down';
    error?: string;
    last_check: string;
  };
}

export function HealthStatCard({ stat }: HealthStatCardProps) {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'healthy':
        return { icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-400/10', label: 'Healthy' };
      case 'degraded':
        return { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Degraded' };
      case 'down':
        return { icon: ShieldAlert, color: 'text-red-400', bg: 'bg-red-400/10', label: 'Down' };
      default:
        return { icon: Activity, color: 'text-gray-400', bg: 'bg-gray-400/10', label: 'Unknown' };
    }
  };

  const config = getStatusConfig(stat.status);
  const Icon = config.icon;

  return (
    <Card className="bg-black/40 border-white/5 hover:border-white/10 transition-all group overflow-hidden relative">
      {/* Background Glow */}
      <div className={`absolute top-0 right-0 w-24 h-24 ${config.bg} blur-3xl -mr-12 -mt-12 group-hover:opacity-100 opacity-50 transition-opacity`} />
      
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          {stat.service}
        </CardTitle>
        <Icon className={`h-4 w-4 ${config.color}`} />
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <div className={`text-2xl font-bold ${config.color} capitalize`}>{config.label}</div>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>Checked {formatDistanceToNow(new Date(stat.last_check), { addSuffix: true, locale: es })}</span>
        </div>
        {stat.error && (
            <p className="mt-2 text-[11px] text-red-400/70 truncate border-t border-white/5 pt-2 italic">
                &quot;{stat.error}&quot;
            </p>
        )}
      </CardContent>
    </Card>
  );
}
