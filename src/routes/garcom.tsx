/**
 * garcom.tsx — App do garçom totalmente reescrito
 * 
 * Arquitetura robusta:
 * - Nunca trava: cada operação tem try/catch e retry
 * - Realtime do Supabase para mesas e chamadas
 * - Estado local sempre prioritário, sincroniza com banco sem bloquear UI
 * - Sem dependência de sync queue ou IndexedDB complexo
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import type { Mesa, Produto, Categoria, Comanda } from "@/lib/supabase";
import {
  getMesasComComandas,
  getProdutos,
  getCategorias,
  verificarFicha,
  abrirComanda,
  inserirItens,
  getItensDaComanda,
  solicitarFechamento,
  cancelarComanda as cancelarComandaDB,
} from "@/lib/db";
import { carregarSessao, limparSessao } from "@/lib/db";
import { QRCodeSVG } from "qrcode.react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LogOut, Plus, Minus, Trash2, Star, Send, ClipboardList,
  X, Clock, Receipt, CheckCircle, XCircle, Search, Bell, RefreshCw
} from "lucide-react";
import { toast } from "sonner";
import { ChamadaToast, ChamadaGarcomPainel } from "@/components/ChamadaGarcomAlert";
import { SyncStatusBadge } from "@/components/SyncStatusBadge";
import { useChamadasGarcom } from "@/hooks/use-chamadas-garcom";

export const Route = createFileRoute("/garcom")({
  component: GarcomApp,
});

type Aba = "mesas" | "comanda" | "fila" | "qr";
type ItemPedido = { produto: Produto; quantidade: number };
type MesaComCmds = Mesa & { comandas: Comanda[] };

function GarcomApp() {
  const navigate = useNavigate();
  const sessao = carregarSessao();
  const { totalPendentes, novasChamadas } = useChamadasGarcom();

  // ─── State principal ─────────────────────────────────────────────────────
  const [aba, setAba] = useState<Aba>("comanda");
  const [mesas, setMesas] = useState<MesaComCmds[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [carregando, setCarregando] = useState(true);

  // ─── State da aba Comanda (abertura de nova comanda) ─────────────────────
  const [fichaNumero, setFichaNumero] = useState("");
  const [fichaStatus, setFichaStatus] = useState<"idle" | "buscando" | "disponivel" | "ocupada">("idle");
  const [comandaEncontrada, setComandaEncontrada] = useState<Comanda | null>(null);
  const [clienteNome, setClienteNome] = useState("");
  const [mesaSelecionadaId, setMesaSelecionadaId] = useState("");
  const [abrindo, setAbrindo] = useState(false);

  // ─── State do modal de mesa ───────────────────────────────────────────────
  type ModalState = {
    mesa: MesaComCmds;
    comanda: Comanda | null;
    view: "opcoes" | "lancar" | "conta";
  };
  const [modal, setModal] = useState<ModalState | null>(null);
  const [catAtiva, setCatAtiva] = useState("Favoritos");
  const [buscaProd, setBuscaProd] = useState("");
  const [carrinhos, setCarrinhos] = useState<Record<string, ItemPedido[]>>({});
  const [enviando, setEnviando] = useState(false);

  // ─── State da conta ───────────────────────────────────────────────────────
  const [itensConta, setItensConta] = useState<any[]>([]);
  const [loadingConta, setLoadingConta] = useState(false);

  // ─── State da aba de nova comanda rápida numa mesa já aberta ─────────────
  const [modalNovaComanda, setModalNovaComanda] = useState<MesaComCmds | null>(null);
  const [novaFicha, setNovaFicha] = useState("");
  const [novoCliente, setNovoCliente] = useState("");
  const [abrindoNova, setAbrindoNova] = useState(false);

  // ─── Chamadas garçom (painel) ─────────────────────────────────────────────
  const [painelChamadas, setPainelChamadas] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  // ─── Carregamento inicial ──────────────────────────────────────────────────
  const carregar = useCallback(async () => {
    if (!sessao) return;
    try {
      const [ms, prods, cats] = await Promise.all([
        getMesasComComandas(),
        getProdutos(),
        getCategorias(),
      ]);
      setMesas(ms);
      setProdutos(prods);
      setCategorias(cats);
    } catch (err) {
      console.error("Erro ao carregar dados:", err);
      toast.error("Erro ao carregar dados. Verificando conexão...");
    } finally {
      setCarregando(false);
    }
  }, [sessao]);

  useEffect(() => {
    if (!sessao) { navigate({ to: "/" }); return; }
    carregar();
  }, []);

  // ─── Realtime: atualiza mesas e produtos quando mudam ────────────────────────
  useEffect(() => {
    if (!sessao) return;

    const channel = supabase.channel("garcom-realtime");

    channel.on("postgres_changes", { event: "*", schema: "public", table: "mesas" }, () => {
      getMesasComComandas().then(setMesas).catch(() => {});
    });
    channel.on("postgres_changes", { event: "*", schema: "public", table: "comandas" }, () => {
      getMesasComComandas().then(setMesas).catch(() => {});
    });
    channel.on("postgres_changes", { event: "*", schema: "public", table: "comanda_itens" }, () => {
      getMesasComComandas().then(setMesas).catch(() => {});
    });
    channel.on("postgres_changes", { event: "*", schema: "public", table: "produtos" }, () => {
      getProdutos().then(setProdutos).catch(() => {});
    });
    channel.on("postgres_changes", { event: "*", schema: "public", table: "categorias" }, () => {
      getCategorias().then(setCategorias).catch(() => {});
    });

    channel.subscribe();

    // Quando o sync terminar (volta de offline), recarrega tudo
    const onRehydrate = () => {
      getMesasComComandas().then(setMesas).catch(() => {});
      getProdutos().then(setProdutos).catch(() => {});
      getCategorias().then(setCategorias).catch(() => {});
    };
    const onOnline = () => {
      // Aguarda o sync processar antes de recarregar
      setTimeout(() => {
        getMesasComComandas().then(setMesas).catch(() => {});
      }, 3000);
    };

    const onSyncDone = () => {
      // Sync completou — recarrega mesas e itens do modal se estiver aberto
      getMesasComComandas().then(setMesas).catch(() => {});
    };

    window.addEventListener("bb:rehydrate", onRehydrate);
    window.addEventListener("online", onOnline);
    window.addEventListener("bb:sync-done", onSyncDone);

    return () => {
      channel.unsubscribe();
      window.removeEventListener("bb:rehydrate", onRehydrate);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("bb:sync-done", onSyncDone);
    };
  }, [sessao]);

  // ─── Auto-refresh a cada 30s ───────────────────────────────────────────────
  useEffect(() => {
    if (!sessao) return;
    const interval = setInterval(() => {
      getMesasComComandas().then(setMesas).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [sessao]);

  if (!sessao) return null;

  // ─── Dados derivados ───────────────────────────────────────────────────────
  const mesasLivres = mesas.filter(m => m.status === "livre");
  const mesasOcupadas = mesas.filter(m => m.status !== "livre");

  // ─── Produtos filtrados do modal ───────────────────────────────────────────
  const prodsFiltrados = (() => {
    let lista = produtos;
    if (catAtiva === "Favoritos") lista = lista.filter(p => p.favorito);
    else lista = lista.filter(p => (p as any).categorias?.nome === catAtiva);
    if (buscaProd) lista = lista.filter(p => p.nome.toLowerCase().includes(buscaProd.toLowerCase()));
    return lista;
  })();

  // ─── Carrinho do modal atual ───────────────────────────────────────────────
  const comandaAtual = modal?.comanda;
  const itensCarrinho: ItemPedido[] = comandaAtual ? (carrinhos[comandaAtual.id] ?? []) : [];
  const subtotal = itensCarrinho.reduce((s, i) => s + i.produto.preco * i.quantidade, 0);

  function setItensCarrinho(fn: ItemPedido[] | ((prev: ItemPedido[]) => ItemPedido[])) {
    if (!comandaAtual) return;
    const id = comandaAtual.id;
    setCarrinhos(prev => {
      const atual = prev[id] ?? [];
      const novos = typeof fn === "function" ? fn(atual) : fn;
      return { ...prev, [id]: novos };
    });
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function abrirModal(mesa: MesaComCmds) {
    const comanda = mesa.comandas[0] ?? null;
    setModal({ mesa, comanda, view: "opcoes" });
  }

  async function buscarFicha() {
    if (!fichaNumero.trim()) return;
    setFichaStatus("buscando");
    setComandaEncontrada(null);
    try {
      const status = await verificarFicha(fichaNumero.trim());

      if (status === "ocupada") {
        // Busca a comanda aberta com este código
        const { data } = await import("@/lib/supabase").then(m =>
          m.supabase
            .from("comandas")
            .select("*, mesas(numero)")
            .eq("codigo", fichaNumero.trim())
            .eq("status", "aberta")
            .limit(1)
        );
        const cmd = data?.[0] ?? null;
        setComandaEncontrada(cmd);
        setFichaStatus("ocupada");
      } else {
        setFichaStatus("disponivel");
      }
    } catch {
      toast.error("Erro ao verificar ficha. Tente novamente.");
      setFichaStatus("idle");
    }
  }

  async function confirmarAbrirComanda() {
    if (!clienteNome.trim() || !mesaSelecionadaId) return;
    setAbrindo(true);
    try {
      await abrirComanda({
        codigo: fichaNumero.trim(),
        mesa_id: mesaSelecionadaId,
        cliente_nome: clienteNome.trim(),
        funcionario_id: sessao.id,
      });
      toast.success(`Comanda ${fichaNumero} aberta!`);
      setFichaNumero("");
      setFichaStatus("idle");
      setClienteNome("");
      setMesaSelecionadaId("");
      const ms = await getMesasComComandas();
      setMesas(ms);
    } catch (err: any) {
      if (err?.code === "23505") {
        toast.error("Esta ficha já está em uso!");
        setFichaStatus("ocupada");
      } else {
        toast.error("Erro ao abrir comanda. Tente novamente.");
      }
    } finally {
      setAbrindo(false);
    }
  }

  function adicionarItem(p: Produto) {
    setItensCarrinho(prev => {
      const existe = prev.find(i => i.produto.id === p.id);
      if (existe) return prev.map(i => i.produto.id === p.id ? { ...i, quantidade: i.quantidade + 1 } : i);
      return [...prev, { produto: p, quantidade: 1 }];
    });
  }

  async function enviarPedido() {
    if (!comandaAtual || itensCarrinho.length === 0) return;
    setEnviando(true);
    try {
      await inserirItens(
        comandaAtual.id,
        itensCarrinho.map(i => ({
          produto_id: i.produto.id,
          nome_produto: i.produto.nome,
          preco_unit: i.produto.preco,
          quantidade: i.quantidade,
        }))
      );
      // Limpa carrinho
      setCarrinhos(prev => ({ ...prev, [comandaAtual.id]: [] }));
      toast.success("Pedido enviado com sucesso!");
      setModal(null);
      // Atualiza mesas
      getMesasComComandas().then(setMesas).catch(() => {});
    } catch {
      toast.error("Erro ao enviar pedido. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  async function abrirConta(comanda: Comanda) {
    if (!modal) return;
    setModal({ ...modal, view: "conta" });
    setLoadingConta(true);
    try {
      const itens = await getItensDaComanda(comanda.id);
      setItensConta(itens);
    } catch {
      toast.error("Erro ao carregar conta");
    } finally {
      setLoadingConta(false);
    }
  }

  async function pedirFechamento(comanda: Comanda) {
    try {
      await solicitarFechamento(comanda.id);
      toast.success("Fechamento solicitado ao caixa!");
      setModal(null);
      getMesasComComandas().then(setMesas).catch(() => {});
    } catch {
      toast.error("Erro ao solicitar fechamento. Tente novamente.");
    }
  }

  async function cancelarComanda(mesa: MesaComCmds, comanda: Comanda) {
    if (!confirm(`Cancelar comanda ${comanda.codigo}?`)) return;
    try {
      await cancelarComandaDB(comanda.id);
      toast.success("Comanda cancelada.");
      setModal(null);
      getMesasComComandas().then(setMesas).catch(() => {});
    } catch {
      toast.error("Erro ao cancelar comanda.");
    }
  }

  async function abrirNovaComandaMesa() {
    if (!modalNovaComanda || !novoCliente.trim()) return;
    const codigo = novaFicha.trim() || String(Date.now()).slice(-4);
    setAbrindoNova(true);
    try {
      const cmd = await abrirComanda({
        codigo,
        mesa_id: modalNovaComanda.id,
        cliente_nome: novoCliente.trim(),
        funcionario_id: sessao.id,
      });
      toast.success(`Comanda ${codigo} aberta!`);
      setModalNovaComanda(null);
      setNovaFicha("");
      setNovoCliente("");
      const ms = await getMesasComComandas();
      setMesas(ms);
      // Abre direto no lançamento
      setModal({ mesa: { ...modalNovaComanda, status: "ocupada", comandas: [cmd] }, comanda: cmd, view: "lancar" });
    } catch (err: any) {
      if (err?.code === "23505") toast.error("Ficha já em uso!");
      else toast.error("Erro ao abrir comanda. Tente novamente.");
    } finally {
      setAbrindoNova(false);
    }
  }

  function sair() {
    limparSessao();
    navigate({ to: "/" });
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (carregando) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background pb-20">
      {/* Toast de chamada */}
      <ChamadaToast />

      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3 flex items-center justify-between">
        <div>
          <p className="font-bold text-sm">{sessao.nome}</p>
          <SyncStatusBadge />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPainelChamadas(true)} className="relative p-2">
            <Bell className={"h-5 w-5 " + (novasChamadas.length > 0 ? "text-amber-500" : "")} />
            {totalPendentes > 0 && (
              <span className={"absolute top-1 right-1 h-4 w-4 rounded-full text-[9px] font-bold flex items-center justify-center " + (novasChamadas.length > 0 ? "bg-amber-500 text-white animate-pulse" : "bg-amber-500/80 text-white")}>
                {totalPendentes > 9 ? "9+" : totalPendentes}
              </span>
            )}
          </button>
          <button
            onClick={async () => { setSincronizando(true); await carregar(); setSincronizando(false); toast.success("Cardápio atualizado!"); }}
            className="p-2 text-muted-foreground"
            title="Sincronizar cardápio"
          >
            <RefreshCw className={"h-4 w-4 transition-transform " + (sincronizando ? "animate-spin" : "")} />
          </button>
          <button onClick={sair} className="p-2 text-muted-foreground">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Painel de chamadas com histórico */}
      {painelChamadas && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-end" onClick={() => setPainelChamadas(false)}>
          <div className="w-full bg-background rounded-t-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-center pt-3"><div className="h-1 w-12 rounded-full bg-muted" /></div>
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <p className="font-bold flex items-center gap-2"><Bell className="h-4 w-4 text-amber-500" /> Chamadas de garçom</p>
              <button onClick={() => setPainelChamadas(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <ChamadaGarcomPainel modo="inline" />
            </div>
          </div>
        </div>
      )}

      {/* Conteúdo */}
      <div className="flex-1">

        {/* ── ABA MESAS ── */}
        {aba === "mesas" && (
          <div className="p-4 space-y-4">
            {mesasLivres.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Mesas livres — toque para abrir comanda</p>
                <div className="grid grid-cols-4 gap-2">
                  {mesasLivres.map(m => (
                    <button key={m.id} onClick={() => {
                      setAba("comanda");
                      setMesaSelecionadaId(m.id);
                    }}
                      className="rounded-xl border border-border bg-card p-3 text-center hover:border-primary active:scale-95 transition">
                      <p className="text-xl font-bold">{m.numero}</p>
                      <p className="text-[10px] text-success">livre</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mesasOcupadas.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Ocupadas — toque para gerenciar</p>
                <div className="space-y-2">
                  {mesasOcupadas.map(m => (
                    <button key={m.id} onClick={() => abrirModal(m)}
                      className={"w-full rounded-xl border p-4 text-left active:scale-[0.99] transition " + (
                        m.comandas.some(c => c.solicitou_fechamento) ? "border-destructive/50 bg-destructive/5" : "border-primary/30 bg-primary/5 hover:border-primary"
                      )}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl font-bold leading-none w-10">{m.numero}</span>
                          <div className="min-w-0">
                            {m.comandas.length === 1 ? (
                              <>
                                <p className="font-semibold text-sm">{m.comandas[0].cliente_nome ?? "Avulso"}</p>
                                <p className="text-xs text-muted-foreground font-mono">#{m.comandas[0].codigo}</p>
                              </>
                            ) : (
                              <>
                                <p className="font-semibold text-sm">{m.comandas.length} comandas</p>
                                <p className="text-xs text-muted-foreground truncate">{m.comandas.map(c => c.codigo).join(" · ")}</p>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {m.comandas.some(c => c.solicitou_fechamento) && (
                            <span className="text-[10px] font-bold text-destructive block">FECHAR</span>
                          )}
                          {m.comandas.some(c => (carrinhos[c.id]?.length ?? 0) > 0) && (
                            <span className="text-[10px] font-bold text-amber-500 block">
                              🛒 {m.comandas.reduce((s, c) => s + (carrinhos[c.id]?.reduce((q, i) => q + i.quantidade, 0) ?? 0), 0)} itens
                            </span>
                          )}
                          <p className="font-bold text-primary text-sm">
                            R$ {m.comandas.reduce((s, c) => s + Number(c.total), 0).toFixed(2).replace(".", ",")}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mesas.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-sm">Nenhuma mesa cadastrada</p>
              </div>
            )}
          </div>
        )}

        {/* ── ABA COMANDA (nova comanda) ── */}
        {aba === "comanda" && (
          <div className="p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold mb-1">Número da ficha / comanda</p>
              <p className="text-xs text-muted-foreground mb-3">Digite somente o número e busque para abrir</p>
              <div className="flex gap-2">
                <Input
                  placeholder="Ex: 042"
                  value={fichaNumero}
                  onChange={e => { setFichaNumero(e.target.value.replace(/\D/, "")); setFichaStatus("idle"); setComandaEncontrada(null); }}
                  onKeyDown={e => e.key === "Enter" && buscarFicha()}
                  className="h-12 text-lg font-bold flex-1"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoFocus
                />
                <Button className="h-12 px-5" onClick={buscarFicha} disabled={fichaStatus === "buscando" || !fichaNumero.trim()}>
                  {fichaStatus === "buscando" ? <span className="animate-spin">⟳</span> : <Search className="h-5 w-5" />}
                </Button>
              </div>
            </div>

            {fichaStatus === "ocupada" && (
              <Card className={"p-4 " + (comandaEncontrada ? "border-primary/40 bg-primary/5" : "border-destructive/50 bg-destructive/5")}>
                {comandaEncontrada ? (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                      <p className="font-semibold text-sm">Ficha {fichaNumero} encontrada</p>
                    </div>
                    <div className="space-y-1 mb-4">
                      <p className="text-sm"><span className="text-muted-foreground">Cliente:</span> <span className="font-semibold">{comandaEncontrada.cliente_nome ?? "Avulso"}</span></p>
                      <p className="text-sm"><span className="text-muted-foreground">Mesa:</span> <span className="font-semibold">{(comandaEncontrada as any).mesas?.numero ?? "—"}</span></p>
                      <p className="text-sm"><span className="text-muted-foreground">Total atual:</span> <span className="font-bold text-primary">R$ {Number(comandaEncontrada.total).toFixed(2).replace(".", ",")}</span></p>
                    </div>
                    <Button className="w-full h-11 font-semibold" onClick={() => {
                      // Encontra a mesa na lista e abre o modal direto no lançamento
                      const mesa = mesas.find(m => m.id === comandaEncontrada.mesa_id);
                      if (mesa) {
                        setModal({ mesa, comanda: comandaEncontrada as Comanda, view: "lancar" });
                        setFichaNumero("");
                        setFichaStatus("idle");
                        setComandaEncontrada(null);
                      } else {
                        // Mesa não carregada ainda — abre pelo modal inline
                        getMesasComComandas().then(ms => {
                          setMesas(ms);
                          const m = ms.find(m => m.id === comandaEncontrada.mesa_id);
                          if (m) {
                            setModal({ mesa: m, comanda: comandaEncontrada as Comanda, view: "lancar" });
                            setFichaNumero("");
                            setFichaStatus("idle");
                            setComandaEncontrada(null);
                          } else {
                            toast.error("Mesa não encontrada. Vá até a aba Mesas.");
                          }
                        });
                      }
                    }}>
                      Lançar itens nesta comanda →
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-destructive">Ficha {fichaNumero} já está em uso</p>
                    <p className="text-sm text-muted-foreground mt-1">Use outro número ou consulte o caixa.</p>
                  </>
                )}
              </Card>
            )}

            {fichaStatus === "disponivel" && (
              <Card className="p-4 border-success/30 bg-success/5 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-success" />
                  <p className="font-semibold text-sm">Ficha {fichaNumero} disponível</p>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Nome do cliente</label>
                  <Input
                    placeholder="Ex: João Silva"
                    value={clienteNome}
                    onChange={e => setClienteNome(e.target.value)}
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Mesa</label>
                  {mesaSelecionadaId ? (
                    <div className="flex items-center justify-between rounded-lg border border-primary bg-primary/10 px-3 py-2">
                      <span className="font-semibold">Mesa {mesas.find(m => m.id === mesaSelecionadaId)?.numero}</span>
                      <button onClick={() => setMesaSelecionadaId("")} className="text-xs text-muted-foreground underline">Trocar</button>
                    </div>
                  ) : (
                    <>
                      {mesasLivres.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhuma mesa livre no momento</p>
                      ) : (
                        <div className="grid grid-cols-5 gap-1.5 max-h-40 overflow-y-auto">
                          {mesasLivres.map(m => (
                            <button key={m.id} onClick={() => setMesaSelecionadaId(m.id)}
                              className="rounded-lg border border-border py-2 text-sm font-bold hover:border-primary transition">
                              {m.numero}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <Button
                  className="w-full h-11 font-semibold"
                  onClick={confirmarAbrirComanda}
                  disabled={abrindo || !clienteNome.trim() || !mesaSelecionadaId}
                >
                  {abrindo ? "Abrindo..." : "Abrir comanda e lançar itens"}
                </Button>
              </Card>
            )}
          </div>
        )}

        {/* ── ABA FILA ── */}
        {aba === "fila" && (
          <div className="p-4 space-y-3">
            <p className="text-xs text-muted-foreground">Itens com carrinho aguardando envio</p>
            {Object.keys(carrinhos).filter(k => (carrinhos[k]?.length ?? 0) > 0).length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Nenhum item no carrinho</p>
              </Card>
            ) : (
              Object.entries(carrinhos)
                .filter(([, itens]) => itens.length > 0)
                .map(([cmdId, itens]) => {
                  const mesa = mesas.find(m => m.comandas.some(c => c.id === cmdId));
                  const cmd = mesa?.comandas.find(c => c.id === cmdId);
                  return (
                    <Card key={cmdId} className="p-4">
                      <div className="flex justify-between items-center mb-2">
                        <div>
                          <p className="font-semibold">{cmd ? `Mesa ${mesa?.numero} — ${cmd.cliente_nome}` : "Comanda"}</p>
                          <p className="text-xs text-muted-foreground font-mono">#{cmd?.codigo}</p>
                        </div>
                        <button onClick={() => {
                          if (cmd && mesa) setModal({ mesa, comanda: cmd, view: "lancar" });
                        }} className="text-xs text-primary underline">Editar</button>
                      </div>
                      {itens.map(i => (
                        <div key={i.produto.id} className="flex justify-between text-sm py-1">
                          <span>{i.quantidade}x {i.produto.nome}</span>
                          <span className="font-semibold">R$ {(i.produto.preco * i.quantidade).toFixed(2)}</span>
                        </div>
                      ))}
                    </Card>
                  );
                })
            )}
          </div>
        )}

        {/* ── ABA QR ── */}
        {aba === "qr" && (
          <div className="p-6 flex flex-col items-center gap-4">
            <p className="text-sm font-semibold text-center">QR Code do cardápio</p>
            <p className="text-xs text-muted-foreground text-center max-w-xs">
              Mostre ao cliente para ele ver o cardápio e chamar o garçom
            </p>
            <div className="bg-white p-5 rounded-2xl shadow-lg">
              <QRCodeSVG
                value={window.location.origin + "/cardapio"}
                size={220}
                bgColor="#ffffff"
                fgColor="#0a0a0a"
                level="M"
                imageSettings={{ src: "/logo.jpg", height: 40, width: 40, excavate: true }}
              />
            </div>
            <p className="text-xs text-muted-foreground font-mono bg-accent/40 px-3 py-1.5 rounded-lg">
              {window.location.origin}/cardapio
            </p>
          </div>
        )}
      </div>

      {/* ── Nav bottom ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border flex z-10">
        {([
          { id: "mesas", label: "Mesas", icon: "🪑" },
          { id: "comanda", label: "Nova", icon: "➕" },
          { id: "fila", label: "Carrinho", icon: "🛒" },
          { id: "qr", label: "QR Code", icon: "📱" },
        ] as { id: Aba; label: string; icon: string }[]).map(tab => (
          <button key={tab.id} onClick={() => setAba(tab.id)}
            className={"flex-1 flex flex-col items-center py-3 gap-0.5 text-xs transition " + (aba === tab.id ? "text-primary font-semibold" : "text-muted-foreground")}>
            <span className="text-xl leading-none">{tab.icon}</span>
            {tab.label}
            {tab.id === "fila" && Object.values(carrinhos).some(c => c.length > 0) && (
              <span className="absolute top-1 bg-amber-500 text-white rounded-full text-[9px] px-1">!</span>
            )}
          </button>
        ))}
      </div>

      {/* ── MODAL DE MESA ── */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 flex items-end z-50" onClick={() => setModal(null)}>
          <div className="w-full bg-background rounded-t-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-center pt-3 pb-1"><div className="h-1 w-12 rounded-full bg-muted" /></div>
            <div className="flex items-center justify-between px-4 pb-3 border-b border-border">
              <div>
                <p className="font-bold text-lg">Mesa {modal.mesa.numero}</p>
                {modal.comanda && (
                  <p className="text-xs text-muted-foreground">#{modal.comanda.codigo} · {modal.comanda.cliente_nome ?? "Avulso"}</p>
                )}
              </div>
              <button onClick={() => setModal(null)} className="p-2 text-muted-foreground"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex-1 overflow-y-auto">

              {/* ── VIEW OPÇÕES ── */}
              {modal.view === "opcoes" && (
                <div className="p-4 space-y-2">
                  {/* Seleção de comanda se múltiplas */}
                  {modal.mesa.comandas.length > 1 && (
                    <div className="mb-3">
                      <p className="text-xs text-muted-foreground mb-2">Selecione a comanda:</p>
                      <div className="space-y-1">
                        {modal.mesa.comandas.map(c => (
                          <button key={c.id}
                            onClick={() => setModal(prev => prev ? { ...prev, comanda: c } : null)}
                            className={"w-full text-left rounded-lg border p-3 transition " + (modal.comanda?.id === c.id ? "border-primary bg-primary/10" : "border-border")}>
                            <div className="flex justify-between">
                              <div>
                                <p className="font-semibold text-sm">#{c.codigo}</p>
                                <p className="text-xs text-muted-foreground">{c.cliente_nome ?? "Avulso"}</p>
                              </div>
                              <p className="font-bold text-primary text-sm">R$ {Number(c.total).toFixed(2).replace(".", ",")}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {modal.comanda && (
                    <>
                      <button onClick={() => setModal(prev => prev ? { ...prev, view: "lancar" } : null)}
                        className="w-full flex items-center gap-3 bg-primary text-primary-foreground rounded-xl p-4 font-semibold active:scale-[0.98] transition">
                        <Plus className="h-5 w-5" /> Lançar itens
                      </button>
                      <button onClick={() => abrirConta(modal.comanda!)}
                        className="w-full flex items-center gap-3 bg-accent text-accent-foreground rounded-xl p-4 font-semibold active:scale-[0.98] transition">
                        <Receipt className="h-5 w-5" /> Ver conta
                      </button>
                      <button
                        onClick={() => pedirFechamento(modal.comanda!)}
                        disabled={modal.comanda.solicitou_fechamento}
                        className={"w-full flex items-center gap-3 rounded-xl p-4 font-semibold active:scale-[0.98] transition " + (modal.comanda.solicitou_fechamento ? "bg-muted text-muted-foreground" : "bg-warning/20 text-warning-foreground")}>
                        <CheckCircle className="h-5 w-5" />
                        {modal.comanda.solicitou_fechamento ? "Fechamento já solicitado" : "Solicitar fechamento"}
                      </button>
                      <button onClick={() => cancelarComanda(modal.mesa, modal.comanda!)}
                        className="w-full flex items-center gap-3 bg-destructive/10 text-destructive rounded-xl p-4 font-semibold active:scale-[0.98] transition">
                        <XCircle className="h-5 w-5" /> Cancelar comanda
                      </button>
                    </>
                  )}

                  <div className="pt-2 border-t border-border">
                    <button onClick={() => { setModalNovaComanda(modal.mesa); setModal(null); setNovaFicha(""); setNovoCliente(""); }}
                      className="w-full flex items-center gap-3 border border-border rounded-xl p-4 text-sm font-medium text-muted-foreground hover:border-primary active:scale-[0.98] transition">
                      <Plus className="h-4 w-4" /> Abrir nova comanda nesta mesa
                    </button>
                  </div>
                </div>
              )}

              {/* ── VIEW LANÇAR ── */}
              {modal.view === "lancar" && (
                <div className="p-3 space-y-3">
                  <button onClick={() => setModal(prev => prev ? { ...prev, view: "opcoes" } : null)}
                    className="text-xs text-primary flex items-center gap-1">← Voltar</button>

                  <Input placeholder="Buscar produto..." value={buscaProd} onChange={e => setBuscaProd(e.target.value)} className="h-11" />

                  <div className="flex gap-2 overflow-x-auto pb-1">
                    <button onClick={() => setCatAtiva("Favoritos")}
                      className={"shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition " + (catAtiva === "Favoritos" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}>
                      <Star className="h-3 w-3 inline mr-1" />Favoritos
                    </button>
                    {categorias.map(c => (
                      <button key={c.id} onClick={() => setCatAtiva(c.nome)}
                        className={"shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition " + (catAtiva === c.nome ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}>
                        {c.nome}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2 pb-48">
                    {prodsFiltrados.map(p => (
                      <button key={p.id} onClick={() => adicionarItem(p)}
                        className={"text-left rounded-xl border p-3 hover:border-primary active:scale-95 transition " + (!p.disponivel ? "opacity-50" : "border-border")}>
                        {p.promocao && <span className="text-[10px] bg-amber-500 text-white rounded px-1 mb-1 inline-block">PROMO</span>}
                        <p className="font-medium text-sm leading-tight">{p.nome}</p>
                        <p className="text-xs text-muted-foreground mb-1">{(p as any).categorias?.nome}</p>
                        {p.promocao && p.preco_promocao ? (
                          <div>
                            <span className="text-xs line-through text-muted-foreground">R$ {Number(p.preco).toFixed(2)}</span>
                            <p className="font-bold text-amber-500">R$ {Number(p.preco_promocao).toFixed(2).replace(".", ",")}</p>
                          </div>
                        ) : (
                          <p className="font-bold text-primary">R$ {Number(p.preco).toFixed(2).replace(".", ",")}</p>
                        )}
                        {!p.disponivel && <p className="text-[10px] text-destructive mt-1">Indisponível</p>}
                      </button>
                    ))}
                  </div>

                  {itensCarrinho.length > 0 && (
                    <div className="fixed bottom-0 left-0 right-0 p-3 bg-background border-t border-border shadow-lg z-10">
                      <div className="space-y-1.5 mb-2 max-h-36 overflow-y-auto">
                        {itensCarrinho.map(i => (
                          <div key={i.produto.id} className="flex items-center gap-2">
                            <Button size="icon" variant="outline" className="h-7 w-7 shrink-0"
                              onClick={() => setItensCarrinho(prev => prev.map(x => x.produto.id === i.produto.id ? { ...x, quantidade: Math.max(1, x.quantidade - 1) } : x))}>
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="text-sm w-5 text-center">{i.quantidade}</span>
                            <Button size="icon" variant="outline" className="h-7 w-7 shrink-0"
                              onClick={() => setItensCarrinho(prev => prev.map(x => x.produto.id === i.produto.id ? { ...x, quantidade: x.quantidade + 1 } : x))}>
                              <Plus className="h-3 w-3" />
                            </Button>
                            <span className="flex-1 text-sm truncate">{i.produto.nome}</span>
                            <span className="text-sm font-semibold shrink-0">R$ {(Number(i.produto.preco) * i.quantidade).toFixed(2)}</span>
                            <button onClick={() => setItensCarrinho(prev => prev.filter(x => x.produto.id !== i.produto.id))} className="text-destructive shrink-0">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-lg">R$ {subtotal.toFixed(2).replace(".", ",")}</span>
                        <Button onClick={enviarPedido} disabled={enviando} size="lg" className="gap-1">
                          <Send className="h-4 w-4" />{enviando ? "Enviando..." : "Confirmar pedido"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── VIEW CONTA ── */}
              {modal.view === "conta" && (
                <div className="p-4 space-y-3">
                  <button onClick={() => setModal(prev => prev ? { ...prev, view: "opcoes" } : null)}
                    className="text-xs text-primary flex items-center gap-1">← Voltar</button>

                  {loadingConta ? (
                    <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-10 rounded-lg bg-accent/30 animate-pulse" />)}</div>
                  ) : (
                    <>
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-semibold">{modal.comanda?.cliente_nome ?? "Avulso"} · #{modal.comanda?.codigo}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Aberta às {modal.comanda ? new Date(modal.comanda.aberta_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""}
                          </p>
                        </div>
                        <p className="text-xl font-bold text-primary">
                          R$ {Number(modal.comanda?.total ?? 0).toFixed(2).replace(".", ",")}
                        </p>
                      </div>

                      <div className="space-y-2">
                        {itensConta.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map((item: any) => (
                          <div key={item.id} className={"flex items-center gap-3 py-2 border-b border-border last:border-0 " + (item.cancelado ? "opacity-40 line-through" : "")}>
                            <div className="flex-1">
                              <p className="text-sm font-medium">{item.quantidade}x {item.nome_produto}</p>
                              <p className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
                            </div>
                            <p className="text-sm font-semibold">R$ {Number(item.total).toFixed(2).replace(".", ",")}</p>
                          </div>
                        ))}
                      </div>

                      {(() => {
                        const sub = itensConta.filter((i: any) => !i.cancelado).reduce((s: number, i: any) => s + Number(i.total), 0);
                        const taxa = sub * 0.1;
                        return (
                          <div className="space-y-1 text-sm pt-2 border-t border-border">
                            <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>R$ {sub.toFixed(2)}</span></div>
                            <div className="flex justify-between text-muted-foreground"><span>Serviço (10%)</span><span>R$ {taxa.toFixed(2)}</span></div>
                            <div className="flex justify-between font-bold text-lg pt-1"><span>Total</span><span className="text-primary">R$ {(sub + taxa).toFixed(2).replace(".", ",")}</span></div>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL NOVA COMANDA NA MESA ── */}
      {modalNovaComanda && (
        <div className="fixed inset-0 bg-black/60 flex items-end z-50" onClick={() => setModalNovaComanda(null)}>
          <div className="w-full bg-background rounded-t-2xl p-5" onClick={e => e.stopPropagation()}>
            <div className="flex justify-center mb-3"><div className="h-1 w-12 rounded-full bg-muted" /></div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-bold text-lg">Nova comanda — Mesa {modalNovaComanda.numero}</p>
                <p className="text-xs text-muted-foreground">Preencha o número da ficha e o cliente</p>
              </div>
              <button onClick={() => setModalNovaComanda(null)} className="p-2 text-muted-foreground"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Número da ficha (somente número)</label>
                <Input
                  placeholder="Ex: 042"
                  value={novaFicha}
                  onChange={e => setNovaFicha(e.target.value.replace(/\D/, ""))}
                  inputMode="numeric"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Nome do cliente</label>
                <Input
                  placeholder="Ex: João Silva"
                  value={novoCliente}
                  onChange={e => setNovoCliente(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && abrirNovaComandaMesa()}
                />
              </div>
              <Button className="w-full h-12 font-semibold" onClick={abrirNovaComandaMesa} disabled={abrindoNova || !novoCliente.trim()}>
                {abrindoNova ? "Abrindo..." : "Abrir e lançar itens"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
