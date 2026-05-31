import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, CreditCard, Banknote, Smartphone, Plus, Trash2, Bell, X, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase, type Comanda, type ComandaItem, type Produto } from "@/lib/supabase";
import { toast } from "sonner";
import { getItensDaComanda, fecharComanda, getProdutos } from "@/lib/db";

export const Route = createFileRoute("/caixa")({
  component: Caixa,
});

type TipoPagamento = "dinheiro" | "debito" | "credito" | "pix";
const TIPOS: { id: TipoPagamento; label: string; icon: any }[] = [
  { id: "dinheiro", label: "Dinheiro",  icon: Banknote },
  { id: "debito",   label: "Débito",    icon: CreditCard },
  { id: "credito",  label: "Crédito",   icon: CreditCard },
  { id: "pix",      label: "Pix",       icon: Smartphone },
];

type Parcela = { id: string; tipo: TipoPagamento; valor: string };

function corTipo(tipo: TipoPagamento) {
  const m: Record<TipoPagamento, string> = {
    dinheiro: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
    debito:   "text-blue-400 bg-blue-500/15 border-blue-500/30",
    credito:  "text-purple-400 bg-purple-500/15 border-purple-500/30",
    pix:      "text-cyan-400 bg-cyan-500/15 border-cyan-500/30",
  };
  return m[tipo];
}

function Caixa() {
  const [comandas, setComanadas] = useState<Comanda[]>([]);
  const [selecionada, setSelecionada] = useState<Comanda | null>(null);
  const [itens, setItens] = useState<ComandaItem[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [busca, setBusca] = useState("");
  const [buscaProduto, setBuscaProduto] = useState("");
  const [loading, setLoading] = useState(true);
  const [pagando, setPagando] = useState(false);
  const [aba, setAba] = useState<"itens" | "adicionar">("itens");
  const [parcelas, setParcelas] = useState<Parcela[]>([]);

  const totalItens = itens.filter(i => !i.cancelado).reduce((s, i) => s + Number(i.preco_unit) * Number(i.quantidade), 0);
  const subtotal = totalItens > 0.01 ? totalItens : Number(selecionada?.subtotal ?? 0);
  const total = subtotal * 1.1;
  const totalParcelas = parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const restante = total - totalParcelas;
  const troco = totalParcelas > total + 0.01 ? totalParcelas - total : 0;
  const podeFinalizar = parcelas.length > 0 && total > 0 && Math.abs(restante) < 0.01;

  async function loadComandas() {
    const { data } = await supabase
      .from("comandas")
      .select("*, mesas(numero), funcionarios(nome)")
      .in("status", ["aberta", "fechando"])
      .order("solicitou_fechamento", { ascending: false })
      .order("aberta_em", { ascending: false });
    setComanadas((data ?? []) as Comanda[]);
    setLoading(false);
  }

  async function selecionar(c: Comanda) {
    setSelecionada(c);
    setParcelas([]);
    setAba("itens");
    setBuscaProduto("");
    const data = await getItensDaComanda(c.id);
    setItens(data);
  }

  useEffect(() => {
    loadComandas();
    getProdutos().then(setProdutos);

    const preId = sessionStorage.getItem("caixa_comanda_id");
    if (preId) {
      sessionStorage.removeItem("caixa_comanda_id");
      setTimeout(async () => {
        const { data } = await supabase.from("comandas").select("*, mesas(numero), funcionarios(nome)").eq("id", preId).single();
        if (data) selecionar(data as any);
      }, 300);
    }

    const channel = supabase
      .channel("caixa-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "comandas" }, loadComandas)
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, []);

  const filtradas = comandas.filter(c =>
    c.codigo.toLowerCase().includes(busca.toLowerCase()) ||
    (c.cliente_nome ?? "").toLowerCase().includes(busca.toLowerCase()) ||
    String((c as any).mesas?.numero).includes(busca)
  );

  async function removerItem(item: ComandaItem) {
    if (!confirm("Remover " + item.nome_produto + "?")) return;
    const { error } = await supabase.from("comanda_itens").update({ cancelado: true }).eq("id", item.id);
    if (error) { toast.error("Erro ao remover item"); return; }
    setItens(prev => prev.filter(i => i.id !== item.id));
    toast.success("Item removido");
  }

  async function adicionarItem(p: Produto) {
    if (!selecionada) return;
    const { data, error } = await supabase.from("comanda_itens").insert({
      comanda_id: selecionada.id,
      produto_id: p.id,
      nome_produto: p.nome,
      preco_unit: p.preco,
      quantidade: 1,
      total: p.preco,
      cancelado: false,
    }).select().single();
    if (error) { toast.error("Erro ao adicionar item"); return; }
    setItens(prev => [...prev, data as ComandaItem]);
    toast.success(p.nome + " adicionado");
  }

  async function finalizar() {
    if (!selecionada || !podeFinalizar) return toast.error("Complete o pagamento");
    setPagando(true);
    try {
      const forma = parcelas.length === 1 ? parcelas[0].tipo : parcelas.map(p => `${p.tipo}:${Number(p.valor).toFixed(2)}`).join("|");
      await fecharComanda(selecionada.id, forma);
      toast.success("Comanda " + selecionada.codigo + " fechada!");
      setSelecionada(null);
      setItens([]);
      setParcelas([]);
      loadComandas();
    } catch { toast.error("Erro ao fechar comanda"); }
    finally { setPagando(false); }
  }

  const fechamentoPendente = filtradas.filter(c => (c as any).solicitou_fechamento);
  const normal = filtradas.filter(c => !(c as any).solicitou_fechamento);
  const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="Frente de Caixa" subtitle="Receba pagamentos e feche comandas" />
      <div className="grid lg:grid-cols-3 gap-4">

        {/* Lista */}
        <Card className="p-4 lg:col-span-1">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar comanda / mesa / cliente" className="pl-9" value={busca} onChange={e => setBusca(e.target.value)} />
          </div>
          {loading ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-lg bg-accent/30 animate-pulse" />)}</div>
          ) : (
            <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
              {fechamentoPendente.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-destructive flex items-center gap-1">
                    <Bell className="h-3 w-3 animate-bounce" /> Solicitaram fechamento
                  </p>
                  {fechamentoPendente.map(c => (
                    <button key={c.id} onClick={() => selecionar(c)}
                      className={"w-full text-left rounded-lg border p-3 transition " + (selecionada?.id === c.id ? "border-destructive bg-destructive/10" : "border-destructive/50 bg-destructive/5 hover:border-destructive")}>
                      <div className="flex justify-between mb-0.5">
                        <span className="font-semibold text-sm">{c.codigo}</span>
                        <Badge variant="destructive" className="text-[10px] animate-pulse">Fechar</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">Mesa {(c as any).mesas?.numero} · {c.cliente_nome}</p>
                      <p className="text-sm font-bold text-primary">R$ {Number(c.total).toFixed(2).replace(".", ",")}</p>
                    </button>
                  ))}
                </div>
              )}
              {normal.map(c => (
                <button key={c.id} onClick={() => selecionar(c)}
                  className={"w-full text-left rounded-lg border p-3 transition hover:border-primary " + (selecionada?.id === c.id ? "border-primary bg-primary/5" : "border-border")}>
                  <div className="flex justify-between mb-0.5">
                    <span className="font-semibold text-sm">{c.codigo}</span>
                    <Badge variant="secondary" className="text-[10px]">{hora(c.aberta_em)}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">Mesa {(c as any).mesas?.numero} · {c.cliente_nome}</p>
                  <p className="text-sm font-bold text-primary">R$ {Number(c.total).toFixed(2).replace(".", ",")}</p>
                </button>
              ))}
              {filtradas.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nenhuma comanda aberta</p>}
            </div>
          )}
        </Card>

        {/* Detalhe */}
        <Card className="p-5 lg:col-span-2">
          {!selecionada ? (
            <div className="flex items-center justify-center h-full min-h-[300px] text-muted-foreground">
              <p>Selecione uma comanda ao lado</p>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-xs text-muted-foreground">#{selecionada.codigo} · Mesa {(selecionada as any).mesas?.numero}</p>
                  <h2 className="text-xl font-bold">{selecionada.cliente_nome ?? "Avulso"}</h2>
                  <p className="text-xs text-muted-foreground">Aberta às {hora(selecionada.aberta_em)}</p>
                </div>
                {(selecionada as any).solicitou_fechamento
                  ? <Badge variant="destructive" className="animate-pulse">Fechar</Badge>
                  : <Badge>Em atendimento</Badge>}
              </div>

              <div className="flex gap-1 mb-3">
                <button onClick={() => setAba("itens")} className={"px-4 py-1.5 rounded-full text-sm font-medium transition " + (aba === "itens" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}>
                  Itens ({itens.filter(i => !i.cancelado).length})
                </button>
                <button onClick={() => setAba("adicionar")} className={"px-4 py-1.5 rounded-full text-sm font-medium transition " + (aba === "adicionar" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}>
                  + Adicionar item
                </button>
              </div>

              {aba === "itens" ? (
                <div className="border border-border rounded-lg overflow-hidden mb-4">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="p-3">Item</th>
                        <th className="p-3 w-16 text-center">Qtd</th>
                        <th className="p-3 w-24 text-right">Total</th>
                        <th className="p-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {itens.filter(i => !i.cancelado).map(i => (
                        <tr key={i.id} className="border-t border-border">
                          <td className="p-3">{i.nome_produto}</td>
                          <td className="p-3 text-center">{i.quantidade}</td>
                          <td className="p-3 text-right font-semibold">R$ {Number(i.total).toFixed(2)}</td>
                          <td className="p-3">
                            <button className="text-destructive" onClick={() => removerItem(i)}><Trash2 className="h-3.5 w-3.5" /></button>
                          </td>
                        </tr>
                      ))}
                      {itens.filter(i => !i.cancelado).length === 0 && (
                        <tr><td colSpan={4} className="p-4 text-center text-muted-foreground text-sm">Nenhum item</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mb-4">
                  <Input placeholder="Buscar produto..." className="mb-3" value={buscaProduto} onChange={e => setBuscaProduto(e.target.value)} />
                  <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto">
                    {produtos.filter(p => p.nome.toLowerCase().includes(buscaProduto.toLowerCase())).slice(0, 20).map(p => (
                      <button key={p.id} onClick={() => adicionarItem(p)}
                        className="text-left rounded-lg border border-border p-3 hover:border-primary hover:bg-primary/5 transition">
                        <p className="text-sm font-medium truncate">{p.nome}</p>
                        <p className="text-sm font-bold text-primary mt-1">R$ {Number(p.preco).toFixed(2)}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Totais */}
              <div className="space-y-1 text-sm mb-4">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>R$ {subtotal.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Serviço (10%)</span><span>R$ {(subtotal * 0.1).toFixed(2)}</span></div>
                <div className="flex justify-between text-xl font-bold pt-2 border-t border-border">
                  <span>Total</span><span className="text-primary">R$ {total.toFixed(2).replace(".", ",")}</span>
                </div>
              </div>

              {/* Pagamento */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Forma de pagamento</p>
                <div className="grid grid-cols-4 gap-2">
                  {TIPOS.map(t => (
                    <button key={t.id} onClick={() => {
                      const falta = Math.max(0, total - totalParcelas);
                      setParcelas(prev => [...prev, { id: crypto.randomUUID(), tipo: t.id, valor: falta > 0.01 ? falta.toFixed(2) : "" }]);
                    }}
                      className={"flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-semibold transition active:scale-95 " +
                        (parcelas.some(p => p.tipo === t.id) ? corTipo(t.id) + " border" : "border-border text-muted-foreground hover:border-primary bg-accent/30")}>
                      <t.icon className="h-4 w-4" />{t.label}
                    </button>
                  ))}
                </div>

                {parcelas.map(parcela => (
                  <div key={parcela.id} className={"rounded-xl border p-3 space-y-2 " + corTipo(parcela.tipo)}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">{TIPOS.find(t => t.id === parcela.tipo)?.label}</span>
                      <button onClick={() => setParcelas(prev => prev.filter(p => p.id !== parcela.id))}><X className="h-4 w-4 opacity-60" /></button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium shrink-0">R$</span>
                      <Input type="number" step="0.01" min="0" value={parcela.valor}
                        onChange={e => setParcelas(prev => prev.map(p => p.id === parcela.id ? { ...p, valor: e.target.value } : p))}
                        className="h-12 text-xl font-bold bg-background/50" />
                    </div>
                    {parcela.tipo === "dinheiro" && troco > 0.01 && (
                      <p className="text-sm font-bold text-emerald-400">Troco: R$ {troco.toFixed(2)}</p>
                    )}
                  </div>
                ))}

                {parcelas.length > 0 && (
                  <div className={"rounded-xl p-3 border " + (podeFinalizar ? "border-emerald-500/30 bg-emerald-500/8" : "border-border bg-accent/30")}>
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total</span><span className="font-bold">R$ {total.toFixed(2)}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Informado</span><span className="font-bold">R$ {totalParcelas.toFixed(2)}</span></div>
                    {podeFinalizar
                      ? <div className="flex items-center gap-1 text-emerald-400 font-bold text-sm pt-1"><CheckCircle2 className="h-4 w-4" /> Pagamento completo!</div>
                      : <div className={"flex justify-between font-bold text-sm pt-1 " + (restante > 0 ? "text-amber-400" : "text-destructive")}>
                          <span>{restante > 0 ? "Falta" : "Excede"}</span>
                          <span>R$ {Math.abs(restante).toFixed(2)}</span>
                        </div>}
                  </div>
                )}

                <Button className="w-full h-12 font-semibold text-base" disabled={pagando || !podeFinalizar} onClick={finalizar}>
                  {pagando ? "Processando..." : podeFinalizar ? "✓ Finalizar pagamento" : "Complete o pagamento"}
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
