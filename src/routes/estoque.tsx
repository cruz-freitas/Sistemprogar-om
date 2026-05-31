import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Package, Plus, Minus, Send, AlertTriangle, CheckCircle2,
  X, ChevronDown, ChevronUp, ClipboardCheck, ShoppingCart,
  History, Search, Settings2, MessageCircle,
} from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

export const Route = createFileRoute("/estoque")({
  component: Estoque,
});

// ─── Tipos ───────────────────────────────────────────────────────────────────

type ItemEstoque = {
  id: string;
  produto_id: string;
  produto_nome: string;
  produto_preco: number;
  categoria_nome: string | null;
  quantidade_atual: number;
  quantidade_minima: number;
  unidade: string;
  status_estoque: "ok" | "baixo" | "zerado";
  updated_at: string;
};

type Movimento = {
  id: string;
  tipo: string;
  quantidade: number;
  quantidade_anterior: number | null;
  observacao: string | null;
  created_at: string;
  funcionarios?: { nome: string } | null;
};

type ItemConferencia = {
  estoque_id: string;
  produto_nome: string;
  unidade: string;
  quantidade_atual: number;
  quantidade_minima: number;
  status_estoque: string;
  novaQtd: string; // digitado pelo usuário
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  if (status === "zerado")
    return <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-[10px]">Zerado</Badge>;
  if (status === "baixo")
    return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]">Baixo</Badge>;
  return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">OK</Badge>;
}

function getFuncionarioId(): string | null {
  try {
    const raw = sessionStorage.getItem("funcionario");
    return raw ? JSON.parse(raw)?.id ?? null : null;
  } catch { return null; }
}

// ─── Modal: configurar item de estoque ───────────────────────────────────────
function ModalConfigurar({
  item,
  onClose,
  onSalvo,
}: {
  item: ItemEstoque | null; // null = novo
  produtos: { id: string; nome: string; categorias?: { nome: string } }[];
  onClose: () => void;
  onSalvo: () => void;
}) {
  const [produtoId, setProdutoId] = useState(item?.produto_id ?? "");
  const [qtdMinima, setQtdMinima] = useState(String(item?.quantidade_minima ?? 5));
  const [unidade, setUnidade] = useState(item?.unidade ?? "un");
  const [salvando, setSalvando] = useState(false);

  const unidades = ["un", "kg", "g", "L", "ml", "cx", "fardo", "pct", "dz"];

  async function salvar() {
    setSalvando(true);
    if (item) {
      const { error } = await supabase
        .from("estoque")
        .update({ quantidade_minima: Number(qtdMinima), unidade })
        .eq("id", item.id);
      if (error) toast.error("Erro: " + error.message);
      else { toast.success("Configuração salva"); onSalvo(); onClose(); }
    } else {
      if (!produtoId) { toast.error("Selecione o produto"); setSalvando(false); return; }
      const { error } = await supabase
        .from("estoque")
        .insert({ produto_id: produtoId, quantidade_minima: Number(qtdMinima), unidade, quantidade_atual: 0 });
      if (error) toast.error("Erro: " + error.message);
      else { toast.success("Item de estoque criado"); onSalvo(); onClose(); }
    }
    setSalvando(false);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <Card className="w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg">{item ? "Configurar item" : "Adicionar ao estoque"}</h2>
          <button onClick={onClose} className="text-muted-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          {!item && (
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Produto</label>
              <select
                className="w-full h-10 rounded-md border border-input bg-input px-3 text-sm"
                value={produtoId}
                onChange={e => setProdutoId(e.target.value)}
              >
                <option value="">Selecione...</option>
                {(window as any).__produtosSemEstoque?.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
            </div>
          )}
          {item && (
            <div className="rounded-lg bg-accent/30 px-3 py-2 text-sm font-medium">
              {item.produto_nome}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Estoque mínimo</label>
              <Input
                type="number"
                min={0}
                value={qtdMinima}
                onChange={e => setQtdMinima(e.target.value)}
                className="h-10"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Unidade</label>
              <select
                className="w-full h-10 rounded-md border border-input bg-input px-3 text-sm"
                value={unidade}
                onChange={e => setUnidade(e.target.value)}
              >
                {unidades.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <Button className="w-full h-10 font-semibold" onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ─── Modal: histórico de movimentos ──────────────────────────────────────────
function ModalHistorico({ item, onClose }: { item: ItemEstoque; onClose: () => void }) {
  const [movimentos, setMovimentos] = useState<Movimento[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("estoque_movimentos")
      .select("*, funcionarios(nome)")
      .eq("estoque_id", item.id)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => {
        setMovimentos(data ?? []);
        setLoading(false);
      });
  }, [item.id]);

  const tipoLabel: Record<string, string> = {
    conferencia: "Conferência",
    entrada: "Entrada",
    ajuste: "Ajuste",
    saida: "Saída",
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-5 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-bold text-lg">Histórico</h2>
            <p className="text-xs text-muted-foreground">{item.produto_nome}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-2">
          {loading ? (
            [...Array(4)].map((_, i) => <div key={i} className="h-14 rounded-lg bg-accent/30 animate-pulse" />)
          ) : movimentos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum movimento registrado</p>
          ) : movimentos.map(m => (
            <div key={m.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
              <div className={
                "h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold " +
                (m.quantidade >= 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-destructive/20 text-destructive")
              }>
                {m.quantidade >= 0 ? "+" : ""}
                {m.tipo === "conferencia" ? "C" : m.quantidade > 0 ? "↑" : "↓"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{tipoLabel[m.tipo] ?? m.tipo}</span>
                  <span className={
                    "text-sm font-bold " +
                    (m.quantidade >= 0 ? "text-emerald-400" : "text-destructive")
                  }>
                    {m.tipo === "conferencia"
                      ? `→ ${m.quantidade} ${item.unidade}`
                      : `${m.quantidade >= 0 ? "+" : ""}${m.quantidade} ${item.unidade}`}
                  </span>
                </div>
                {m.observacao && <p className="text-xs text-muted-foreground truncate">{m.observacao}</p>}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(m.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  {m.funcionarios?.nome && ` · ${m.funcionarios.nome.split(" ")[0]}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
function Estoque() {
  const [estoque, setEstoque] = useState<ItemEstoque[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState<"geral" | "conferencia">("geral");
  const [modalConfig, setModalConfig] = useState<ItemEstoque | null | "novo">(null);
  const [modalHist, setModalHist] = useState<ItemEstoque | null>(null);
  const [todosProdutos, setTodosProdutos] = useState<any[]>([]);

  // Conferência
  const [conferencia, setConferencia] = useState<ItemConferencia[]>([]);
  const [salvandoConf, setSalvandoConf] = useState(false);
  const [filtroConf, setFiltroConf] = useState<"todos" | "baixo">("todos");
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function load() {
    setLoading(true);
    const [{ data: estoqueData }, { data: prodsData }] = await Promise.all([
      supabase.from("estoque_view").select("*"),
      supabase.from("produtos").select("id, nome, categorias(nome)").eq("ativo", true).order("nome"),
    ]);
    const itens = estoqueData ?? [];
    setEstoque(itens as ItemEstoque[]);
    setTodosProdutos(prodsData ?? []);

    // Produtos que ainda não têm estoque
    const idsComEstoque = new Set(itens.map((e: any) => e.produto_id));
    (window as any).__produtosSemEstoque = (prodsData ?? []).filter((p: any) => !idsComEstoque.has(p.id));

    // Inicializa conferência com todos os itens
    setConferencia(
      itens.map((e: any) => ({
        estoque_id: e.id,
        produto_nome: e.produto_nome,
        unidade: e.unidade,
        quantidade_atual: e.quantidade_atual,
        quantidade_minima: e.quantidade_minima,
        status_estoque: e.status_estoque,
        novaQtd: "",
      }))
    );
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // ─── Ajuste rápido (entrada/saída) na aba Geral ────────────────────────────
  async function ajustar(item: ItemEstoque, delta: number) {
    const nova = Math.max(0, item.quantidade_atual + delta);
    const { error } = await supabase
      .from("estoque")
      .update({ quantidade_atual: nova })
      .eq("id", item.id);
    if (error) { toast.error("Erro ao ajustar"); return; }
    await supabase.from("estoque_movimentos").insert({
      estoque_id: item.id,
      tipo: "ajuste",
      quantidade: delta,
      quantidade_anterior: item.quantidade_atual,
      funcionario_id: getFuncionarioId(),
    });
    setEstoque(prev => prev.map(e => e.id === item.id ? { ...e, quantidade_atual: nova, status_estoque: nova <= 0 ? "zerado" : nova <= e.quantidade_minima ? "baixo" : "ok" } : e));
    toast.success(`${item.produto_nome}: ${nova} ${item.unidade}`);
  }

  // ─── Salvar conferência ────────────────────────────────────────────────────
  async function salvarConferencia() {
    const alterados = conferencia.filter(i => i.novaQtd.trim() !== "");
    if (alterados.length === 0) return toast.error("Preencha ao menos uma quantidade");
    setSalvandoConf(true);

    const funcId = getFuncionarioId();
    let erros = 0;

    for (const item of alterados) {
      const nova = parseFloat(item.novaQtd.replace(",", "."));
      if (isNaN(nova) || nova < 0) { erros++; continue; }

      const { error } = await supabase
        .from("estoque")
        .update({ quantidade_atual: nova })
        .eq("id", item.estoque_id);

      if (!error) {
        await supabase.from("estoque_movimentos").insert({
          estoque_id: item.estoque_id,
          tipo: "conferencia",
          quantidade: nova,
          quantidade_anterior: item.quantidade_atual,
          observacao: `Conferência ${new Date().toLocaleDateString("pt-BR")}`,
          funcionario_id: funcId,
        });
      } else {
        erros++;
      }
    }

    if (erros > 0) toast.error(`${erros} item(s) com erro`);
    else toast.success(`${alterados.length} item(s) atualizados!`);

    await load();
    setSalvandoConf(false);
  }

  // ─── Gerar lista de compras e enviar via WhatsApp ──────────────────────────
  function gerarWhatsApp() {
    const baixos = estoque.filter(e => e.status_estoque === "baixo" || e.status_estoque === "zerado");
    const conferidos = conferencia.filter(i => i.novaQtd.trim() !== "");

    // Usa conferência atual se tiver dados, senão usa estoque salvo
    const lista = baixos.map(e => {
      const conf = conferidos.find(c => c.estoque_id === e.id);
      const qtdAtual = conf ? parseFloat(conf.novaQtd || "0") : e.quantidade_atual;
      const precisaComprar = Math.max(0, e.quantidade_minima * 2 - qtdAtual);
      return { nome: e.produto_nome, qtdAtual, minimo: e.quantidade_minima, unidade: e.unidade, comprar: precisaComprar };
    });

    if (lista.length === 0) {
      toast.info("Nenhum item com estoque baixo ou zerado");
      return;
    }

    const data = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    let msg = `🛒 *LISTA DE COMPRAS — ${data} ${hora}*\n`;
    msg += `_Bambui Bar_\n\n`;

    const zerados = lista.filter(i => i.qtdAtual <= 0);
    const baixos2 = lista.filter(i => i.qtdAtual > 0);

    if (zerados.length > 0) {
      msg += `🔴 *ZERADOS (urgente):*\n`;
      zerados.forEach(i => {
        msg += `• ${i.nome}: *comprar ${i.comprar} ${i.unidade}*\n`;
      });
      msg += `\n`;
    }
    if (baixos2.length > 0) {
      msg += `🟡 *ESTOQUE BAIXO:*\n`;
      baixos2.forEach(i => {
        msg += `• ${i.nome}: tem ${i.qtdAtual} ${i.unidade} → *comprar ${i.comprar} ${i.unidade}*\n`;
      });
    }

    msg += `\n_Gerado automaticamente pelo sistema_`;

    const encoded = encodeURIComponent(msg);
    window.open(`https://wa.me/?text=${encoded}`, "_blank");
  }

  // ─── Filtros ───────────────────────────────────────────────────────────────
  const estoqueFiltrado = estoque.filter(e =>
    e.produto_nome.toLowerCase().includes(busca.toLowerCase()) ||
    (e.categoria_nome ?? "").toLowerCase().includes(busca.toLowerCase())
  );

  const confFiltrada = conferencia.filter(i => {
    const matchBusca = i.produto_nome.toLowerCase().includes(busca.toLowerCase());
    const matchStatus = filtroConf === "todos" || i.status_estoque !== "ok";
    return matchBusca && matchStatus;
  });

  const totalBaixo = estoque.filter(e => e.status_estoque !== "ok").length;
  const totalConferidos = conferencia.filter(i => i.novaQtd.trim() !== "").length;

  // ─── Navegação por Enter na conferência ───────────────────────────────────
  function handleEnterConf(idx: number) {
    const visiveis = confFiltrada;
    const proximo = visiveis[idx + 1];
    if (proximo) {
      inputRefs.current[proximo.estoque_id]?.focus();
    }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-1 gap-3">
        <PageHeader title="Estoque" description="Controle, conferência e lista de compras" />
        <div className="flex items-center gap-2 shrink-0">
          {totalBaixo > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
              onClick={gerarWhatsApp}
            >
              <MessageCircle className="h-4 w-4" />
              WhatsApp ({totalBaixo})
            </Button>
          )}
          <Button size="sm" className="gap-1.5" onClick={() => setModalConfig("novo")}>
            <Plus className="h-4 w-4" /> Adicionar
          </Button>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-4 bg-accent/30 p-1 rounded-xl w-fit">
        <button
          onClick={() => setAba("geral")}
          className={"px-4 py-2 rounded-lg text-sm font-medium transition " +
            (aba === "geral" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          <Package className="h-4 w-4 inline mr-1.5 -mt-0.5" />
          Estoque geral
          {totalBaixo > 0 && (
            <span className="ml-1.5 bg-amber-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
              {totalBaixo}
            </span>
          )}
        </button>
        <button
          onClick={() => setAba("conferencia")}
          className={"px-4 py-2 rounded-lg text-sm font-medium transition " +
            (aba === "conferencia" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          <ClipboardCheck className="h-4 w-4 inline mr-1.5 -mt-0.5" />
          Conferência
          {totalConferidos > 0 && (
            <span className="ml-1.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
              {totalConferidos}
            </span>
          )}
        </button>
      </div>

      {/* Barra de busca */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar produto ou categoria..."
          className="pl-9"
          value={busca}
          onChange={e => setBusca(e.target.value)}
        />
      </div>

      {/* ── ABA ESTOQUE GERAL ── */}
      {aba === "geral" && (
        <div className="space-y-2">
          {loading ? (
            [...Array(6)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-accent/30 animate-pulse" />)
          ) : estoqueFiltrado.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm mb-3">Nenhum item no estoque</p>
              <Button onClick={() => setModalConfig("novo")} className="gap-1.5">
                <Plus className="h-4 w-4" /> Adicionar primeiro item
              </Button>
            </div>
          ) : (
            estoqueFiltrado.map(item => (
              <div
                key={item.id}
                className={
                  "rounded-xl border p-3 flex items-center gap-3 transition " +
                  (item.status_estoque === "zerado"
                    ? "border-destructive/40 bg-destructive/5"
                    : item.status_estoque === "baixo"
                    ? "border-amber-500/40 bg-amber-500/5"
                    : "border-border bg-card")
                }
              >
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm">{item.produto_nome}</p>
                    {statusBadge(item.status_estoque)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {item.categoria_nome ?? "Sem categoria"} · mín. {item.quantidade_minima} {item.unidade}
                  </p>
                </div>

                {/* Quantidade + controles */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => ajustar(item, -1)}
                    className="h-8 w-8 rounded-lg border border-border flex items-center justify-center hover:bg-destructive/10 hover:border-destructive/40 transition active:scale-95"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <div className="text-center min-w-[52px]">
                    <p className="text-xl font-bold leading-none">{item.quantidade_atual}</p>
                    <p className="text-[10px] text-muted-foreground">{item.unidade}</p>
                  </div>
                  <button
                    onClick={() => ajustar(item, 1)}
                    className="h-8 w-8 rounded-lg border border-border flex items-center justify-center hover:bg-emerald-500/10 hover:border-emerald-500/40 transition active:scale-95"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Ações secundárias */}
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    onClick={() => setModalHist(item)}
                    className="h-7 w-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary transition"
                    title="Histórico"
                  >
                    <History className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setModalConfig(item)}
                    className="h-7 w-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary transition"
                    title="Configurar"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── ABA CONFERÊNCIA ── */}
      {aba === "conferencia" && (
        <div className="space-y-4">
          {/* Filtro e resumo */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-1 bg-accent/30 p-1 rounded-lg">
              <button
                onClick={() => setFiltroConf("todos")}
                className={"px-3 py-1.5 rounded-md text-xs font-medium transition " +
                  (filtroConf === "todos" ? "bg-background shadow text-foreground" : "text-muted-foreground")}
              >
                Todos ({conferencia.length})
              </button>
              <button
                onClick={() => setFiltroConf("baixo")}
                className={"px-3 py-1.5 rounded-md text-xs font-medium transition " +
                  (filtroConf === "baixo" ? "bg-background shadow text-foreground" : "text-muted-foreground")}
              >
                Críticos ({conferencia.filter(i => i.status_estoque !== "ok").length})
              </button>
            </div>
            {totalConferidos > 0 && (
              <p className="text-xs text-primary font-medium">
                <CheckCircle2 className="h-3 w-3 inline mr-1" />
                {totalConferidos} de {confFiltrada.length} conferidos
              </p>
            )}
          </div>

          {/* Instrução */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-0.5">Como usar a conferência:</p>
            <p>Digite a quantidade contada para cada item. Deixe em branco para não alterar. Use Enter para avançar para o próximo.</p>
          </div>

          {/* Lista de conferência */}
          {loading ? (
            [...Array(6)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-accent/30 animate-pulse" />)
          ) : confFiltrada.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum item encontrado</p>
          ) : (
            <div className="space-y-2">
              {confFiltrada.map((item, idx) => {
                const preenchido = item.novaQtd.trim() !== "";
                const qtdNova = preenchido ? parseFloat(item.novaQtd.replace(",", ".")) : null;
                const ficouBaixo = qtdNova !== null && qtdNova <= item.quantidade_minima;

                return (
                  <div
                    key={item.estoque_id}
                    className={
                      "rounded-xl border p-3 flex items-center gap-3 transition " +
                      (preenchido
                        ? ficouBaixo
                          ? "border-amber-500/50 bg-amber-500/8"
                          : "border-emerald-500/40 bg-emerald-500/5"
                        : item.status_estoque !== "ok"
                        ? "border-amber-500/30 bg-amber-500/5"
                        : "border-border bg-card")
                    }
                  >
                    {/* Indicador de status */}
                    <div className={
                      "h-2 w-2 rounded-full shrink-0 " +
                      (preenchido
                        ? ficouBaixo ? "bg-amber-500" : "bg-emerald-500"
                        : item.status_estoque === "zerado" ? "bg-destructive"
                        : item.status_estoque === "baixo" ? "bg-amber-500"
                        : "bg-border")
                    } />

                    {/* Nome e info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm leading-tight">{item.produto_nome}</p>
                      <p className="text-xs text-muted-foreground">
                        Antes: <span className="font-medium text-foreground">{item.quantidade_atual} {item.unidade}</span>
                        <span className="mx-1">·</span>
                        mín: {item.quantidade_minima} {item.unidade}
                      </p>
                    </div>

                    {/* Input de quantidade */}
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <div className="flex items-center gap-1">
                        <Input
                          ref={el => { inputRefs.current[item.estoque_id] = el; }}
                          type="number"
                          min={0}
                          placeholder={String(item.quantidade_atual)}
                          value={item.novaQtd}
                          onChange={e => setConferencia(prev =>
                            prev.map(i => i.estoque_id === item.estoque_id ? { ...i, novaQtd: e.target.value } : i)
                          )}
                          onKeyDown={e => {
                            if (e.key === "Enter") { e.preventDefault(); handleEnterConf(idx); }
                          }}
                          className={
                            "w-20 h-9 text-center font-bold text-base " +
                            (preenchido
                              ? ficouBaixo
                                ? "border-amber-500/60 focus-visible:ring-amber-500"
                                : "border-emerald-500/60 focus-visible:ring-emerald-500"
                              : "")
                          }
                        />
                        <span className="text-xs text-muted-foreground w-6">{item.unidade}</span>
                      </div>
                      {preenchido && qtdNova !== null && (
                        <p className={
                          "text-[10px] font-medium " +
                          (ficouBaixo ? "text-amber-400" : "text-emerald-400")
                        }>
                          {ficouBaixo ? "⚠ baixo" : "✓ ok"}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Barra inferior fixa */}
          {totalConferidos > 0 && (
            <div className="sticky bottom-0 left-0 right-0 bg-background border-t border-border pt-3 pb-2 flex gap-2">
              <Button
                className="flex-1 h-11 font-semibold gap-1.5"
                onClick={salvarConferencia}
                disabled={salvandoConf}
              >
                <ClipboardCheck className="h-4 w-4" />
                {salvandoConf ? "Salvando..." : `Salvar conferência (${totalConferidos})`}
              </Button>
              <Button
                variant="outline"
                className="h-11 gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                onClick={gerarWhatsApp}
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </Button>
            </div>
          )}

          {/* Botão WhatsApp mesmo sem conferência */}
          {totalConferidos === 0 && totalBaixo > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold text-sm">{totalBaixo} item(s) com estoque baixo ou zerado</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Conclua a conferência ou envie a lista atual para o time de compras.
                  </p>
                </div>
              </div>
              <Button
                className="w-full mt-3 h-10 gap-1.5 bg-green-600 hover:bg-green-700 text-white font-semibold"
                onClick={gerarWhatsApp}
              >
                <MessageCircle className="h-4 w-4" />
                Enviar lista de compras pelo WhatsApp
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Modais */}
      {modalConfig !== null && (
        <ModalConfigurar
          item={modalConfig === "novo" ? null : modalConfig}
          produtos={todosProdutos}
          onClose={() => setModalConfig(null)}
          onSalvo={load}
        />
      )}
      {modalHist && (
        <ModalHistorico item={modalHist} onClose={() => setModalHist(null)} />
      )}
    </>
  );
}
