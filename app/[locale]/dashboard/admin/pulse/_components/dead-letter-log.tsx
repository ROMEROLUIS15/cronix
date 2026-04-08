"use client";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { AlertCircle, RotateCw, FileCode, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";

interface DeadLetterLogProps {
  logs: any[];
  onRetry: () => void;
}

export function DeadLetterLog({ logs, onRetry }: DeadLetterLogProps) {
  const t = useTranslations("adminPulse");
  
  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center space-y-3 opacity-50">
        <div className="p-3 bg-white/5 rounded-full">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <p className="text-sm font-medium">{t('noDlqTitle')}</p>
        <p className="text-[12px]">{t('noDlqSub')}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-white/5 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
            <th className="px-5 py-3">{t('thTimestamp')}</th>
            <th className="px-5 py-3">{t('thReason')}</th>
            <th className="px-5 py-3">{t('thPayload')}</th>
            <th className="px-5 py-3 text-right">{t('thAction')}</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
              <td className="px-5 py-3 text-xs tabular-nums text-muted-foreground">
                {format(new Date(log.created_at), "yyyy-MM-dd HH:mm:ss", { locale: es })}
              </td>
              <td className="px-5 py-4">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse shrink-0" />
                  <span className="text-xs font-semibold text-red-200 uppercase tracking-tight">
                    {log.error_reason || t('unknownFail')}
                  </span>
                </div>
              </td>
              <td className="px-5 py-4 min-w-[200px]">
                <button 
                  onClick={() => console.log(log.payload)}
                  className="flex items-center gap-2 px-3 py-1 bg-white/5 hover:bg-white/10 rounded border border-white/5 text-[10px] transition-all"
                >
                  <FileCode className="w-3 h-3 text-gray-400" />
                  {t('viewPayload')}
                </button>
              </td>
              <td className="px-5 py-4 text-right">
                <button 
                  onClick={() => onRetry()}
                  className="inline-flex items-center gap-2 text-[10px] font-bold text-primary hover:text-primary/80 transition-colors uppercase"
                >
                  <RotateCw className="w-3 h-3" />
                  {t('retryBtn')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
