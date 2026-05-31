/**
 * ChamadaGarcomAlert.tsx
 * 
 * Estratégia para volume alto (40+ mesas):
 * - Toast compacto mostra apenas as 3 mais antigas (quem espera mais é prioridade)
 * - Painel completo com abas: Pendentes | Histórico do dia
 * - Botão "Atender todas" para limpar rápido
 * - Agrupamento visual por urgência (tempo de espera)
 * - Histórico do dia com horário de atendimento
 */

import { Bell, BellRing, Check, CheckCheck, X, Clock, History } from "lucide-react";
import { useState, useEffect } from "react";
import { useChamadasGarcom, type ChamadaPendente, type ChamadaHistorico } from "@/hooks/use-chamadas-garcom";

function tempoEspera(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  return `${Math.floor(min / 60)}h${min % 60 > 0 ? ` ${min % 60}min` : ""}`;
}

function urgencia(iso: string): "alta" | "media" | "normal" {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min >= 5) return "alta";
  if (min >= 2) return "media";
  return "normal";
}

const COR_URGENCIA = {
  alta:   "border-destructive/60 bg-destructive/10",
  media:  "border-amber-500/60 bg-amber-500/10",
  normal: "border-border bg-card",
};

const COR_NUMERO = {
  alta:   "bg-destructive text-white",
  media:  "bg-amber-500 text-white",
  normal: "bg-accent text-foreground",
};

// ─── Badge no header ──────────────────────────────────────────────────────────
export function ChamadaBadge({ onClick }: { onClick?: () => void }) {
  const { totalPendentes, novasChamadas } = useChamadasGarcom();
  if (totalPendentes === 0) return null;
  const animando = novasChamadas.length > 0;
  return (
    <button onClick={onClick}
      className={"relative flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold transition " +
        (animando ? "bg-amber-500 text-white animate-pulse shadow-lg" : "bg-amber-500/20 text-amber-400 border border-amber-500/40")}>
      {animando ? <BellRing className="h-4 w-4 animate-bounce" /> : <Bell className="h-4 w-4" />}
      {totalPendentes}
    </button>
  );
}

// ─── Toast com countdown de 20s ──────────────────────────────────────────────
export function ChamadaToast() {
  const { novasChamadas, atender } = useChamadasGarcom();
  const [visivel, setVisivel] = useState(true);
  const [countdown, setCountdown] = useState(20);
  const idAtual = novasChamadas[novasChamadas.length - 1]?.id;

  // Reseta quando muda a chamada exibida
  useEffect(() => {
    if (novasChamadas.length === 0) return;
    setVisivel(true);
    setCountdown(20);
  }, [idAtual]);

  // Countdown de 20s
  useEffect(() => {
    if (novasChamadas.length === 0 || !visivel) return;
    if (countdown <= 0) { setVisivel(false); return; }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, visivel, novasChamadas.length]);

  if (novasChamadas.length === 0 || !visivel) return null;

  const c = novasChamadas[novasChamadas.length - 1];
  const extras = novasChamadas.length - 1;
  const pct = (countdown / 20) * 100;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] w-[calc(100vw-2rem)] max-w-sm">
      <div className="bg-amber-500 text-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Barra de progresso */}
        <div className="h-1 bg-white/20">
          <div className="h-full bg-white/60 transition-all duration-1000 ease-linear" style={{ width: pct + "%" }} />
        </div>
        <div className="p-4 flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center shrink-0 font-black text-2xl">
            {c.mesa_numero}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-lg leading-none">Mesa {c.mesa_numero} chamando!</p>
            {c.cliente_nome && <p className="text-sm text-white/80 truncate">{c.cliente_nome}</p>}
            {extras > 0 && <p className="text-xs text-white/70 mt-0.5">+{extras} outra{extras > 1 ? "s" : ""} aguardando</p>}
            <p className="text-xs text-white/60 mt-0.5">Fecha em {countdown}s · continua nos alertas</p>
          </div>
          <button onClick={() => atender(c.id)}
            className="shrink-0 bg-white text-amber-600 rounded-xl px-3 py-2 font-bold text-sm">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Painel completo ──────────────────────────────────────────────────────────
export function ChamadaGarcomPainel({ modo = "flutuante" }: { modo?: "flutuante" | "inline" }) {
  const { chamadas, novasChamadas, historico, totalPendentes, atender, atenderTodas, pedirPermissao } = useChamadasGarcom();
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<"pendentes" | "historico">("pendentes");

  const conteudo = (
    <PainelConteudo
      chamadas={chamadas}
      novasChamadas={novasChamadas}
      historico={historico}
      aba={aba}
      setAba={setAba}
      atender={atender}
      atenderTodas={atenderTodas}
      pedirPermissao={pedirPermissao}
    />
  );

  if (modo === "inline") return conteudo;

  return (
    <>
      {totalPendentes > 0 && (
        <button onClick={() => setAberto(true)}
          className={"fixed bottom-24 right-4 z-50 flex items-center gap-2 rounded-full px-4 py-3 font-bold shadow-2xl bg-amber-500 text-white " +
            (novasChamadas.length > 0 ? "animate-bounce" : "")}>
          <BellRing className="h-5 w-5" />
          <span>{totalPendentes}</span>
        </button>
      )}

      {aberto && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-end" onClick={() => setAberto(false)}>
          <div className="w-full bg-background rounded-t-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-center pt-3"><div className="h-1 w-12 rounded-full bg-muted" /></div>
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <p className="font-bold flex items-center gap-2">
                <Bell className="h-4 w-4 text-amber-500" /> Chamadas
              </p>
              <button onClick={() => setAberto(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto">{conteudo}</div>
          </div>
        </div>
      )}
    </>
  );
}

function PainelConteudo({ chamadas, novasChamadas, historico, aba, setAba, atender, atenderTodas, pedirPermissao }: {
  chamadas: ChamadaPendente[];
  novasChamadas: ChamadaPendente[];
  historico: ChamadaHistorico[];
  aba: "pendentes" | "historico";
  setAba: (a: "pendentes" | "historico") => void;
  atender: (id: string) => void;
  atenderTodas: () => void;
  pedirPermissao: () => void;
}) {
  // Ordena pendentes: mais antigas primeiro (maior urgência)
  const pendentesOrdenadas = [...chamadas].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const atendidas = historico.filter(c => c.status !== "pendente");
  const totalHoje = historico.length;

  return (
    <div>
      {/* Abas */}
      <div className="flex border-b border-border">
        <button onClick={() => setAba("pendentes")}
          className={"flex-1 py-3 text-sm font-semibold border-b-2 transition " +
            (aba === "pendentes" ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>
          Pendentes {chamadas.length > 0 && <span className="ml-1 bg-amber-500 text-white text-xs rounded-full px-1.5">{chamadas.length}</span>}
        </button>
        <button onClick={() => setAba("historico")}
          className={"flex-1 py-3 text-sm font-semibold border-b-2 transition flex items-center justify-center gap-1 " +
            (aba === "historico" ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>
          <History className="h-3.5 w-3.5" /> Hoje ({totalHoje})
        </button>
      </div>

      {/* ABA PENDENTES */}
      {aba === "pendentes" && (
        <div>
          {/* Ações em massa */}
          {chamadas.length > 1 && (
            <div className="px-4 py-3 border-b border-border bg-amber-500/5 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {chamadas.length} mesas aguardando · ordenadas por tempo
              </p>
              <button onClick={atenderTodas}
                className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-bold">
                <CheckCheck className="h-3.5 w-3.5" /> Atender todas
              </button>
            </div>
          )}

          {chamadas.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <Bell className="h-10 w-10 mx-auto mb-2 opacity-20" />
              <p className="text-sm">Nenhuma chamada pendente</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {pendentesOrdenadas.map(c => {
                const urg = urgencia(c.created_at);
                const isNova = novasChamadas.some(n => n.id === c.id);
                return (
                  <div key={c.id} className={"flex items-center gap-3 px-4 py-3 border-l-4 " + COR_URGENCIA[urg] + (urg === "alta" ? " border-l-destructive" : urg === "media" ? " border-l-amber-500" : " border-l-transparent")}>
                    <div className={"h-12 w-12 rounded-full flex items-center justify-center shrink-0 font-black text-xl " + COR_NUMERO[urg]}>
                      {c.mesa_numero}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold">Mesa {c.mesa_numero}</p>
                        {isNova && <span className="text-[9px] bg-amber-500 text-white rounded-full px-1.5 py-0.5 font-bold">NOVA</span>}
                        {urg === "alta" && <span className="text-[9px] bg-destructive text-white rounded-full px-1.5 py-0.5 font-bold">URGENTE</span>}
                      </div>
                      {c.cliente_nome && <p className="text-sm text-muted-foreground truncate">{c.cliente_nome}</p>}
                      {c.codigo_comanda && <p className="text-xs text-muted-foreground font-mono">#{c.codigo_comanda}</p>}
                      <p className={"text-xs flex items-center gap-1 mt-0.5 font-medium " + (urg === "alta" ? "text-destructive" : urg === "media" ? "text-amber-500" : "text-muted-foreground")}>
                        <Clock className="h-3 w-3" /> {tempoEspera(c.created_at)}
                      </p>
                    </div>
                    <button onClick={() => atender(c.id)}
                      className="shrink-0 bg-primary text-primary-foreground rounded-xl px-4 py-2.5 font-bold text-sm flex items-center gap-1.5 active:scale-95 transition">
                      <Check className="h-4 w-4" /> Atendido
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Notificações */}
          {"Notification" in window && Notification.permission !== "granted" && (
            <div className="p-3 border-t border-border">
              <button onClick={pedirPermissao}
                className="w-full text-xs text-center text-muted-foreground border border-dashed border-border rounded-xl py-2.5 hover:border-primary hover:text-primary transition">
                🔔 Ativar notificações para alertas sonoros
              </button>
            </div>
          )}
        </div>
      )}

      {/* ABA HISTÓRICO */}
      {aba === "historico" && (
        <div>
          {historico.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <History className="h-10 w-10 mx-auto mb-2 opacity-20" />
              <p className="text-sm">Nenhuma chamada hoje</p>
            </div>
          ) : (
            <>
              {/* Resumo do dia */}
              <div className="px-4 py-3 border-b border-border bg-accent/30 flex items-center gap-4 text-sm">
                <div className="text-center">
                  <p className="font-bold text-lg">{totalHoje}</p>
                  <p className="text-xs text-muted-foreground">total</p>
                </div>
                <div className="text-center">
                  <p className="font-bold text-lg text-success">{atendidas.length}</p>
                  <p className="text-xs text-muted-foreground">atendidas</p>
                </div>
                <div className="text-center">
                  <p className="font-bold text-lg text-amber-500">{chamadas.length}</p>
                  <p className="text-xs text-muted-foreground">pendentes</p>
                </div>
              </div>

              <div className="divide-y divide-border">
                {historico.map(c => (
                  <div key={c.id} className={"flex items-center gap-3 px-4 py-3 " + (c.status === "pendente" ? "bg-amber-500/5" : "")}>
                    <div className={"h-10 w-10 rounded-full flex items-center justify-center shrink-0 font-bold " +
                      (c.status === "pendente" ? "bg-amber-500 text-white" : "bg-accent text-muted-foreground")}>
                      {c.mesa_numero}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">Mesa {c.mesa_numero}</p>
                      {c.cliente_nome && <p className="text-xs text-muted-foreground truncate">{c.cliente_nome}</p>}
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(c.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        {c.atendida_em && (
                          <span className="ml-1 text-success">
                            → atendida às {new Date(c.atendida_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </p>
                    </div>
                    <span className={"text-xs font-semibold px-2 py-1 rounded-full " +
                      (c.status === "pendente" ? "bg-amber-500/20 text-amber-500" : "bg-success/20 text-success")}>
                      {c.status === "pendente" ? "pendente" : "atendida"}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
