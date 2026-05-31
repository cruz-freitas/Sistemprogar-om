import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { RefreshCw, Clock, User, Bell, CheckCheck, BellRing } from "lucide-react";
import { useChamadasGarcom } from "@/hooks/use-chamadas-garcom";

export const Route = createFileRoute("/auditoria")({
  component: Auditoria,
});

type MesaAtiva = {
  id: string;
  numero: number;
  status: string;
  comandas: {
    id: string;
    codigo: string;
    cliente_nome: string | null;
    aberta_em: string;
    total: number;
    solicitou_fechamento: boolean;
    funcionarios: { nome: string } | null;
    comanda_itens: {
      id: string;
      nome_produto: string;
      quantidade: number;
      preco_unit: number;
      total: number;
      cancelado: boolean;
      created_at: string;
    }[];
  }[];
};

function Auditoria() {
  const [mesas, setMesas] = useState<MesaAtiva[]>([]);
  const [loading, setLoading] = useState(true);
  const [ultimaAtt, setUltimaAtt] = useState<Date>(new Date());

  // Usa o hook centralizado — já tem som, notificação e realtime
  const {
    chamadas,
    novasChamadas,
    totalPendentes,
    atender,
    atenderTodas,
    permissao,
    pedirPermissao,
  } = useChamadasGarcom();

  function getFuncId() {
    try {
      const raw = localStorage.getItem("sp_session_v2") || sessionStorage.getItem("sp_session_v2");
      return raw ? JSON.parse(raw)?.id ?? null : null;
    } catch { return null; }
  }

  async function load() {
    setLoading(true);

    // Busca mesas ocupadas
    const { data: mesasData } = await supabase
      .from("mesas")
      .select("id, numero, status")
      .neq("status", "livre")
      .order("numero");

    if (!mesasData || mesasData.length === 0) {
      setMesas([]);
      setUltimaAtt(new Date());
      setLoading(false);
      return;
    }

    const mesaIds = mesasData.map(m => m.id);

    // Busca comandas abertas dessas mesas
    const { data: comandasData } = await supabase
      .from("comandas")
      .select(`
        id, codigo, cliente_nome, aberta_em, total, solicitou_fechamento, mesa_id,
        funcionarios(nome),
        comanda_itens(id, nome_produto, quantidade, preco_unit, total, cancelado, created_at)
      `)
      .in("mesa_id", mesaIds)
      .eq("status", "aberta");

    // Monta estrutura
    const cmdMap: Record<string, any[]> = {};
    (comandasData ?? []).forEach((c: any) => {
      if (!cmdMap[c.mesa_id]) cmdMap[c.mesa_id] = [];
      cmdMap[c.mesa_id].push(c);
    });

    const resultado = mesasData
      .filter(m => cmdMap[m.id]?.length > 0)
      .map(m => ({ ...m, comandas: cmdMap[m.id] ?? [] }));

    setMesas(resultado as MesaAtiva[]);
    setUltimaAtt(new Date());
    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("auditoria-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "comanda_itens" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "comandas" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "mesas" }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  function formatHora(iso: string) {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function formatTempo(iso: string) {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (diff < 60) return diff + "min";
    return Math.floor(diff / 60) + "h" + (diff % 60 > 0 ? " " + (diff % 60) + "min" : "");
  }

  const mesasFechamento = mesas.filter(m => m.comandas[0]?.solicitou_fechamento);
  const mesasNormais = mesas.filter(m => !m.comandas[0]?.solicitou_fechamento);

  const totalItens = mesas.flatMap(m => m.comandas).flatMap(c => c.comanda_itens).filter(i => !i.cancelado).length;

  return (
    <>
      <PageHeader
        title="Auditoria em Tempo Real"
        description="Mesas ativas, garcons e itens lancados"
        actions={
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={"h-4 w-4 mr-1 " + (loading ? "animate-spin" : "")} />
            Atualizar
          </Button>
        }
      />

      {/* Alertas de chamada de garcom */}
      {totalPendentes > 0 && (
        <div className="mb-4 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <BellRing className={"h-4 w-4 text-amber-400 " + (novasChamadas.length > 0 ? "animate-bounce" : "")} />
              <p className="text-sm font-semibold text-amber-400">Chamadas de garçom</p>
              <span className={"text-xs font-bold px-2 py-0.5 rounded-full " + (novasChamadas.length > 0 ? "bg-amber-500 text-white animate-pulse" : "bg-amber-500/20 text-amber-400")}>
                {totalPendentes}
              </span>
            </div>
            {totalPendentes > 1 && (
              <button
                onClick={() => atenderTodas(getFuncId())}
                className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-accent transition"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Atender todas
              </button>
            )}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {chamadas.map(c => {
              const isNova = novasChamadas.some(n => n.id === c.id);
              return (
                <div key={c.id} className={"flex items-center justify-between rounded-xl border px-4 py-3 transition " + (isNova ? "border-amber-500/60 bg-amber-500/15" : "border-amber-500/30 bg-amber-500/8")}>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-lg leading-none">Mesa {c.mesa_numero}</p>
                      {isNova && <span className="text-[9px] bg-amber-500 text-white font-bold px-1.5 py-0.5 rounded-full uppercase">Nova</span>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(c.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <button
                    onClick={() => atender(c.id, getFuncId())}
                    className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-2 text-xs font-semibold active:scale-95 transition"
                  >
                    <CheckCheck className="h-4 w-4" />
                    Atender
                  </button>
                </div>
              );
            })}
          </div>

          {/* Botão de permissão se ainda não concedida */}
          {("Notification" in window && Notification.permission !== "granted") && (
            <button
              onClick={pedirPermissao}
              className="w-full text-xs text-center text-muted-foreground border border-dashed border-border rounded-xl py-2 hover:border-primary hover:text-primary transition"
            >
              🔔 Ativar notificações no dispositivo para alertas sonoros
            </button>
          )}
        </div>
      )}

      {/* Resumo */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-primary">{mesas.length}</p>
          <p className="text-xs text-muted-foreground">Mesas ativas</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold">{totalItens}</p>
          <p className="text-xs text-muted-foreground">Itens</p>
        </Card>
<Card className={"p-3 text-center " + (mesasFechamento.length > 0 ? "border-destructive bg-destructive/10" : "")}>
          <p className={"text-2xl font-bold " + (mesasFechamento.length > 0 ? "text-destructive" : "")}>{mesasFechamento.length}</p>
          <p className="text-xs text-muted-foreground">Fechamento</p>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        Ultima atualizacao: {ultimaAtt.toLocaleTimeString("pt-BR")} · tempo real via Supabase
      </p>

      {/* Alertas de fechamento */}
      {mesasFechamento.length > 0 && (
        <div className="mb-5 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <Bell className="h-4 w-4 text-destructive animate-bounce" />
            <p className="text-sm font-semibold text-destructive">Solicitacoes de fechamento</p>
          </div>
          {mesasFechamento.map(mesa => {
            const comanda = mesa.comandas[0];
            if (!comanda) return null;
            const itensAtivos = comanda.comanda_itens.filter(i => !i.cancelado);
            return (
              <Card key={mesa.id} className="p-4 border-destructive bg-destructive/5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold">Mesa {mesa.numero}</span>
                      <Badge variant="destructive" className="animate-pulse">Fechar</Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><User className="h-3 w-3" />{comanda.funcionarios?.nome ?? "—"}</span>
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatTempo(comanda.aberta_em)}</span>
                    </div>
                    {comanda.cliente_nome && <p className="text-sm font-medium mt-1">{comanda.cliente_nome}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-primary">R$ {Number(comanda.total).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">{comanda.codigo}</p>
                    <p className="text-xs text-muted-foreground">aberta {formatHora(comanda.aberta_em)}</p>
                  </div>
                </div>

                {/* Itens resumidos */}
                <div className="bg-background/60 rounded-lg p-3 mb-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">{itensAtivos.length} itens</p>
                  <div className="space-y-1 max-h-36 overflow-y-auto">
                    {itensAtivos
                      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                      .map(item => (
                      <div key={item.id} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground w-14 shrink-0">{formatHora(item.created_at)}</span>
                        <span className="flex-1 truncate">{item.quantidade}x {item.nome_produto}</span>
                        <span className="font-semibold shrink-0">R$ {Number(item.total).toFixed(2)}</span>

                      </div>
                    ))}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground text-center">
                  Va para <strong>Frente de Caixa</strong> para receber o pagamento e finalizar esta mesa
                </p>
              </Card>
            );
          })}
        </div>
      )}

      {/* Mesas normais */}
      {loading && mesas.length === 0 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(4)].map((_, i) => <Card key={i} className="p-5 h-48 animate-pulse bg-accent/30" />)}
        </div>
      ) : mesasNormais.length === 0 && mesasFechamento.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <p className="font-medium">Nenhuma mesa ativa no momento</p>
        </Card>
      ) : mesasNormais.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {mesasNormais.map(mesa => {
            const comanda = mesa.comandas[0];
            if (!comanda) return null;
            const itensAtivos = comanda.comanda_itens.filter(i => !i.cancelado);
            return (
              <Card key={mesa.id} className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold">Mesa {mesa.numero}</span>
                      <Badge variant="secondary" className="text-[10px]">{comanda.codigo}</Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><User className="h-3 w-3" />{comanda.funcionarios?.nome ?? "—"}</span>
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatTempo(comanda.aberta_em)}</span>
                    </div>
                    {comanda.cliente_nome && <p className="text-sm font-medium mt-1">{comanda.cliente_nome}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-primary">R$ {Number(comanda.total).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">aberta {formatHora(comanda.aberta_em)}</p>
                  </div>
                </div>

                <div className="border-t border-border pt-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">{itensAtivos.length} itens</p>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {itensAtivos.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhum item ainda</p>
                    ) : itensAtivos
                        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                        .map(item => (
                      <div key={item.id} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground w-14 shrink-0">{formatHora(item.created_at)}</span>
                        <span className="flex-1 truncate">{item.quantidade}x {item.nome_produto}</span>
                        <span className="font-semibold shrink-0">R$ {Number(item.total).toFixed(2)}</span>

                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
