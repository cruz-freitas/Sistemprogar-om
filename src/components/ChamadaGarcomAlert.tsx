/**
 * ChamadaGarcomAlert.tsx
 * Painel de chamadas de garçom — aparece no app do garçom e no painel ADM.
 */

import { Bell, BellRing, Check, CheckCheck, X, Clock } from "lucide-react";
import { useState } from "react";
import { useChamadasGarcom, type ChamadaPendente } from "@/hooks/use-chamadas-garcom";

// ─── Badge no header ──────────────────────────────────────────────────────────
export function ChamadaBadge({ onClick }: { onClick?: () => void }) {
  const { totalPendentes, novasChamadas } = useChamadasGarcom();
  if (totalPendentes === 0) return null;
  const animando = novasChamadas.length > 0;
  return (
    <button
      onClick={onClick}
      className={
        "relative flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold transition " +
        (animando
          ? "bg-amber-500 text-white animate-pulse shadow-lg shadow-amber-500/40"
          : "bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500/30")
      }
    >
      {animando ? <BellRing className="h-4 w-4 animate-bounce" /> : <Bell className="h-4 w-4" />}
      {totalPendentes}
    </button>
  );
}

// ─── Toast flutuante para o garçom ────────────────────────────────────────────
export function ChamadaToast() {
  const { novasChamadas, atender } = useChamadasGarcom();
  if (novasChamadas.length === 0) return null;

  const c = novasChamadas[0];
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] w-[calc(100vw-2rem)] max-w-sm">
      <div className="bg-amber-500 text-white rounded-2xl shadow-2xl p-4 flex items-center gap-3 animate-bounce">
        <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <span className="text-2xl font-black">{c.mesa_numero}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-lg leading-none">Mesa {c.mesa_numero} chamando!</p>
          {c.cliente_nome && <p className="text-sm text-white/80 truncate">{c.cliente_nome}</p>}
          {c.codigo_comanda && <p className="text-xs text-white/70 font-mono">#{c.codigo_comanda}</p>}
        </div>
        <button
          onClick={() => atender(c.id)}
          className="shrink-0 bg-white text-amber-600 rounded-xl px-3 py-2 font-bold text-sm"
        >
          OK
        </button>
      </div>
    </div>
  );
}

// ─── Painel completo de chamadas (ADM + garçom) ───────────────────────────────
export function ChamadaGarcomPainel({ modo = "flutuante" }: { modo?: "flutuante" | "inline" }) {
  const { chamadas, novasChamadas, totalPendentes, atender, atenderTodas, pedirPermissao } = useChamadasGarcom();
  const [aberto, setAberto] = useState(false);

  if (modo === "inline") {
    return <PainelInline chamadas={chamadas} novasChamadas={novasChamadas} atender={atender} atenderTodas={atenderTodas} pedirPermissao={pedirPermissao} />;
  }

  return (
    <>
      {/* Botão flutuante */}
      {totalPendentes > 0 && (
        <button
          onClick={() => setAberto(true)}
          className={
            "fixed bottom-24 right-4 z-50 flex items-center gap-2 rounded-full px-4 py-3 font-bold shadow-2xl transition " +
            (novasChamadas.length > 0
              ? "bg-amber-500 text-white animate-bounce"
              : "bg-amber-500 text-white")
          }
        >
          <BellRing className="h-5 w-5" />
          <span>{totalPendentes} mesa{totalPendentes > 1 ? "s" : ""}</span>
        </button>
      )}

      {/* Modal */}
      {aberto && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-end" onClick={() => setAberto(false)}>
          <div className="w-full bg-background rounded-t-2xl max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-center pt-3"><div className="h-1 w-12 rounded-full bg-muted" /></div>
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-amber-500" />
                <p className="font-bold">Chamadas ({totalPendentes})</p>
              </div>
              <div className="flex items-center gap-2">
                {totalPendentes > 1 && (
                  <button onClick={atenderTodas} className="text-xs bg-amber-500 text-white rounded-lg px-3 py-1.5 font-semibold flex items-center gap-1">
                    <CheckCheck className="h-3.5 w-3.5" /> Atender todas
                  </button>
                )}
                <button onClick={() => setAberto(false)} className="p-1.5 text-muted-foreground">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              <PainelInline chamadas={chamadas} novasChamadas={novasChamadas} atender={atender} atenderTodas={atenderTodas} pedirPermissao={pedirPermissao} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PainelInline({ chamadas, novasChamadas, atender, atenderTodas, pedirPermissao }: {
  chamadas: ChamadaPendente[];
  novasChamadas: ChamadaPendente[];
  atender: (id: string) => void;
  atenderTodas: () => void;
  pedirPermissao: () => void;
}) {
  if (chamadas.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">Nenhuma chamada pendente</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {chamadas.map(c => {
        const isNova = novasChamadas.some(n => n.id === c.id);
        const minutos = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 60000);
        return (
          <div key={c.id} className={"flex items-center gap-3 px-4 py-3 " + (isNova ? "bg-amber-500/10" : "")}>
            <div className={"h-12 w-12 rounded-full flex items-center justify-center shrink-0 font-black text-xl " + (isNova ? "bg-amber-500 text-white" : "bg-accent text-foreground")}>
              {c.mesa_numero}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">Mesa {c.mesa_numero}</p>
              {c.cliente_nome && <p className="text-sm text-muted-foreground truncate">{c.cliente_nome}</p>}
              {c.codigo_comanda && <p className="text-xs text-muted-foreground font-mono">#{c.codigo_comanda}</p>}
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Clock className="h-3 w-3" />
                {minutos === 0 ? "Agora" : `${minutos}min atrás`}
              </p>
            </div>
            <button
              onClick={() => atender(c.id)}
              className="shrink-0 bg-primary text-primary-foreground rounded-xl px-4 py-2 font-semibold text-sm flex items-center gap-1.5"
            >
              <Check className="h-4 w-4" /> Atendido
            </button>
          </div>
        );
      })}
    </div>
  );
}
