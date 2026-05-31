/**
 * SyncStatusBadge — mostra status da fila offline em tempo real
 */
import { useEffect, useState } from "react";
import { Wifi, WifiOff, RefreshCw, CheckCircle, AlertTriangle } from "lucide-react";
import { onStatusSync, processarFila, type StatusSync } from "@/lib/sync-engine";

export function SyncStatusBadge() {
  const [status, setStatus] = useState<StatusSync>({
    online: navigator.onLine,
    pendentes: 0,
    sincronizando: false,
    ultimaSync: null,
    erros: 0,
  });

  useEffect(() => {
    const unsub = onStatusSync(setStatus);
    return unsub;
  }, []);

  if (status.sincronizando) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-primary font-medium">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        Sincronizando...
      </span>
    );
  }

  if (!status.online) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-amber-500 font-medium">
        <WifiOff className="h-3.5 w-3.5" />
        Offline {status.pendentes > 0 && `· ${status.pendentes} na fila`}
      </span>
    );
  }

  if (status.pendentes > 0) {
    return (
      <button onClick={() => processarFila()}
        className="flex items-center gap-1.5 text-xs text-primary font-medium hover:underline">
        <RefreshCw className="h-3.5 w-3.5" />
        {status.pendentes} pendente{status.pendentes > 1 ? "s" : ""} · sincronizar
      </button>
    );
  }

  if (status.erros > 0) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-destructive font-medium">
        <AlertTriangle className="h-3.5 w-3.5" />
        {status.erros} erro{status.erros > 1 ? "s" : ""} na fila
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Wifi className="h-3.5 w-3.5 text-success" />
      Online {status.ultimaSync && `· sync ${status.ultimaSync.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
    </span>
  );
}
