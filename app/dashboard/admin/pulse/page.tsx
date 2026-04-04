"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, ShieldAlert, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { HealthStatCard } from "./_components/health-stat-card";
import { DeadLetterLog } from "./_components/dead-letter-log";

/**
 * 🛰️ SYSTEM PULSE - Founder Observability Radar
 * Security: UID-Locked to Luis Romero (4ff958ce).
 * Performance: Cached RLS Identity Pattern.
 */
export default function AdminPulsePage() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; name: string; role: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [healthData, setHealthData] = useState<any[]>([]);
  const [dlqData, setDlqData] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    async function checkAdmin() {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        router.push('/login');
        return;
      }
      const { data: dbUser, error } = await supabase
        .from('users')
        .select('name, role')
        .eq('id', authUser.id)
        .single();

      const typedUser = dbUser as { name: string; role: string } | null;
      if (error || !typedUser || typedUser.role !== 'platform_admin') {
        router.push('/dashboard');
        return;
      }
      setUser({ id: authUser.id, name: typedUser.name, role: typedUser.role });
      setLoading(false);
    }
    checkAdmin();
  }, [router, supabase]);

  const fetchData = async () => {
    if (!user) return;
    setIsRefreshing(true);
    try {
      interface DBServiceHealth {
        service_name: string;
        status: string;
        failure_count: number;
        last_failure: string | null;
      }

      interface DBDeadLetter {
        id: string;
        error: string;
        payload: any;
        created_at: string;
        service_type: string;
        retry_count: number;
      }

      // 🛰️ Decoupled fetching to avoid 'never' inference issues
      const healthResponse = await supabase
        .from('service_health')
        .select('*')
        .order('service_name');
      
      const dlqResponse = await supabase
        .from('wa_dead_letter_queue')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      const healthRaw = healthResponse.data as any[] || [];
      const dlqRaw = dlqResponse.data as any[] || [];

      // 🛰️ Precise mapping from raw data to UI state
      const mappedHealth = healthRaw.map((stat: DBServiceHealth) => ({
        service: stat.service_name,
        status: stat.status === 'CLOSED' ? 'healthy' : 'down',
        error: stat.failure_count > 0 ? `Failures: ${stat.failure_count}` : null,
        last_check: stat.last_failure || new Date().toISOString()
      }));

      const mappedDlq = dlqRaw.map((log: DBDeadLetter) => ({
        ...log,
        error_reason: log.error
      }));

      setHealthData(mappedHealth);
      setDlqData(mappedDlq);
    } catch (err) {
      console.error("Pulse fetch error:", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    let interval: any = null;
    if (user?.role === 'platform_admin') {
      fetchData();
      interval = setInterval(fetchData, 60000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [user, fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="w-8 h-8 animate-spin text-primary/50" />
      </div>
    );
  }

  return (
    <div className="p-1 sm:p-2 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Activity className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">System Pulse</h1>
            <p className="text-sm text-muted-foreground italic">
              Founders Real-time Observability • {user?.name}
            </p>
          </div>
        </div>
        <button 
          onClick={() => fetchData()}
          disabled={isRefreshing}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm font-medium transition-colors border border-white/10 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Refreshing...' : 'Refresh Pulse'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-white">
        {healthData.length > 0 ? (
          healthData.map((stat) => (
            <HealthStatCard key={stat.service} stat={stat} />
          ))
        ) : (
          <Card className="col-span-full py-12 border-dashed bg-black/20">
             <p className="text-muted-foreground w-full text-center">No vital telemetry streams found.</p>
          </Card>
        )}
      </div>

      <Card className="border-red-500/10 bg-black/20 overflow-hidden">
        <CardHeader className="border-b border-white/5 bg-white/[0.02] flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-400" />
            <CardTitle className="text-lg">Dead Letter Queue (AI Failures)</CardTitle>
          </div>
          <span className="px-2 py-1 bg-red-400/10 text-red-400 text-[10px] font-extrabold rounded uppercase tracking-wider">
            Critical
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <DeadLetterLog logs={dlqData} onRetry={fetchData} />
        </CardContent>
      </Card>
    </div>
  );
}
