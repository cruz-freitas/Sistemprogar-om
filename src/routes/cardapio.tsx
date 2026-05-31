/**
 * cardapio.tsx — Cardápio online para o cliente
 * 
 * - Mostra produtos disponíveis, promoções do dia
 * - Permite chamar o garçom informando número da mesa
 * - Dispara notificação em todos os garçons e no painel ADM via Realtime
 */

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { chamarGarcom } from "@/lib/db";
import { Bell, CheckCircle, X, ShoppingBag, Tag, ChevronDown, ChevronUp } from "lucide-react";

export const Route = createFileRoute("/cardapio")({
  component: Cardapio,
  validateSearch: (search: Record<string, unknown>) => ({
    mesa: search.mesa ? Number(search.mesa) : undefined,
    mesa_id: search.mesa_id ? String(search.mesa_id) : undefined,
  }),
});

type Categoria = { id: string; nome: string; cor: string };
type Produto = {
  id: string;
  nome: string;
  descricao?: string | null;
  preco: number;
  preco_promocao?: number | null;
  categoria_id: string | null;
  favorito: boolean;
  disponivel: boolean;
  promocao: boolean;
  categorias?: { nome: string };
};

function Cardapio() {
  const { mesa: mesaUrl, mesa_id: mesaIdUrl } = Route.useSearch();

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [catAtiva, setCatAtiva] = useState("promocoes");
  const [loading, setLoading] = useState(true);

  // Chamada de garçom
  const [modalChamada, setModalChamada] = useState(false);
  const [mesaNumero, setMesaNumero] = useState<string>(mesaUrl ? String(mesaUrl) : "");
  const [clienteNomeInput, setClienteNomeInput] = useState("");
  const [chamando, setChamando] = useState(false);
  const [chamadaOk, setChamadaOk] = useState(false);
  const [erroChamada, setErroChamada] = useState("");
  const [mesaIdResolvido, setMesaIdResolvido] = useState<string>(mesaIdUrl ?? "");

  useEffect(() => {
    async function load() {
      const [{ data: prods }, { data: cats }] = await Promise.all([
        supabase.from("produtos").select("*, categorias(nome)").eq("ativo", true).order("nome"),
        supabase.from("categorias").select("*").eq("ativo", true).order("nome"),
      ]);
      if (prods) setProdutos(prods as Produto[]);
      if (cats) setCategorias(cats as Categoria[]);
      setLoading(false);

      // Define aba inicial
      const temPromo = (prods ?? []).some((p: any) => p.promocao && p.disponivel);
      setCatAtiva(temPromo ? "promocoes" : "todos");
    }
    load();
  }, []);

  async function resolverMesa(numero: string) {
    if (!numero) return null;
    const { data } = await supabase
      .from("mesas")
      .select("id, numero")
      .eq("numero", parseInt(numero))
      .single();
    return data;
  }

  async function enviarChamada() {
    if (!mesaNumero.trim()) {
      setErroChamada("Informe o número da mesa");
      return;
    }
    setChamando(true);
    setErroChamada("");
    try {
      let mesaId = mesaIdResolvido;

      if (!mesaId) {
        const mesa = await resolverMesa(mesaNumero);
        if (!mesa) {
          setErroChamada("Mesa não encontrada. Verifique o número.");
          setChamando(false);
          return;
        }
        mesaId = mesa.id;
        setMesaIdResolvido(mesa.id);
      }

      await chamarGarcom({
        mesa_id: mesaId,
        mesa_numero: parseInt(mesaNumero),
        cliente_nome: clienteNomeInput.trim() || null,
      });

      setChamadaOk(true);
      setModalChamada(false);
    } catch {
      setErroChamada("Erro ao chamar garçom. Tente novamente.");
    } finally {
      setChamando(false);
    }
  }

  const temPromocoes = produtos.some(p => p.promocao && p.disponivel);
  const prodsFiltrados = (() => {
    if (catAtiva === "promocoes") return produtos.filter(p => p.promocao && p.disponivel);
    if (catAtiva === "todos") return produtos.filter(p => p.disponivel);
    return produtos.filter(p => (p as any).categorias?.nome === categorias.find(c => c.id === catAtiva)?.nome && p.disponivel);
  })();
  const indisponiveis = produtos.filter(p => !p.disponivel);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-28">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-4">
        <div className="flex items-center gap-3">
          <img src="/logo.jpg" alt="Logo" className="h-8 w-8 rounded-full object-cover" onError={e => (e.currentTarget.style.display = "none")} />
          <div>
            <h1 className="font-bold text-lg leading-none">Cardápio</h1>
            <p className="text-xs text-muted-foreground">Itens disponíveis hoje</p>
          </div>
        </div>
      </div>

      {/* Sucesso chamada */}
      {chamadaOk && (
        <div className="mx-4 mt-4 bg-success/10 border border-success/30 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle className="h-5 w-5 text-success shrink-0" />
          <div>
            <p className="font-semibold text-sm">Garçom chamado!</p>
            <p className="text-xs text-muted-foreground">Já estamos indo até você 🙂</p>
          </div>
          <button onClick={() => setChamadaOk(false)} className="ml-auto text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Abas de categorias */}
      <div className="flex gap-2 px-4 mt-4 overflow-x-auto pb-1">
        {temPromocoes && (
          <button onClick={() => setCatAtiva("promocoes")}
            className={"shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition flex items-center gap-1 " + (catAtiva === "promocoes" ? "bg-amber-500 text-white" : "bg-accent text-accent-foreground")}>
            <Tag className="h-3 w-3" /> Promoções
          </button>
        )}
        <button onClick={() => setCatAtiva("todos")}
          className={"shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition " + (catAtiva === "todos" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}>
          Todos
        </button>
        {categorias.map(c => (
          <button key={c.id} onClick={() => setCatAtiva(c.id)}
            className={"shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition " + (catAtiva === c.id ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}>
            {c.nome}
          </button>
        ))}
      </div>

      {/* Grid de produtos */}
      <div className="px-4 mt-4 space-y-3">
        {prodsFiltrados.length === 0 && (
          <div className="text-center py-10 text-muted-foreground">
            <ShoppingBag className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Nenhum item nesta categoria no momento</p>
          </div>
        )}

        {prodsFiltrados.map(p => (
          <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
            <div className="flex-1 min-w-0">
              {p.promocao && (
                <span className="text-[10px] bg-amber-500 text-white rounded px-1.5 py-0.5 font-bold mr-1">PROMO</span>
              )}
              <p className="font-semibold text-sm inline">{p.nome}</p>
              {p.descricao && <p className="text-xs text-muted-foreground mt-0.5">{p.descricao}</p>}
              <p className="text-xs text-muted-foreground mt-0.5">{(p as any).categorias?.nome}</p>
            </div>
            <div className="text-right shrink-0">
              {p.promocao && p.preco_promocao ? (
                <>
                  <p className="text-xs line-through text-muted-foreground">R$ {Number(p.preco).toFixed(2).replace(".", ",")}</p>
                  <p className="font-bold text-amber-500">R$ {Number(p.preco_promocao).toFixed(2).replace(".", ",")}</p>
                </>
              ) : (
                <p className="font-bold text-primary">R$ {Number(p.preco).toFixed(2).replace(".", ",")}</p>
              )}
            </div>
          </div>
        ))}

        {/* Indisponíveis no final */}
        {indisponiveis.length > 0 && (
          <IndisponiveisSection itens={indisponiveis} />
        )}
      </div>

      {/* Botão fixo de chamar garçom */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t border-border">
        <button
          onClick={() => { setModalChamada(true); setErroChamada(""); setChamadaOk(false); }}
          className="w-full bg-primary text-primary-foreground rounded-2xl p-4 font-bold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition shadow-lg"
        >
          <Bell className="h-5 w-5" /> Chamar Garçom
        </button>
      </div>

      {/* Modal de chamar garçom */}
      {modalChamada && (
        <div className="fixed inset-0 bg-black/60 flex items-end z-50" onClick={() => setModalChamada(false)}>
          <div className="w-full bg-background rounded-t-2xl p-5" onClick={e => e.stopPropagation()}>
            <div className="flex justify-center mb-4"><div className="h-1 w-12 rounded-full bg-muted" /></div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-bold text-lg">Chamar Garçom</p>
                <p className="text-xs text-muted-foreground">Informe sua mesa para chamarmos</p>
              </div>
              <button onClick={() => setModalChamada(false)}><X className="h-5 w-5 text-muted-foreground" /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Número da mesa *</label>
                <input
                  type="number"
                  placeholder="Ex: 5"
                  value={mesaNumero}
                  onChange={e => setMesaNumero(e.target.value)}
                  className="w-full border border-border rounded-xl px-4 py-3 text-2xl font-bold text-center bg-background focus:outline-none focus:border-primary"
                  inputMode="numeric"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Seu nome (opcional)</label>
                <input
                  type="text"
                  placeholder="Ex: João"
                  value={clienteNomeInput}
                  onChange={e => setClienteNomeInput(e.target.value)}
                  className="w-full border border-border rounded-xl px-4 py-3 bg-background focus:outline-none focus:border-primary"
                  onKeyDown={e => e.key === "Enter" && enviarChamada()}
                />
              </div>

              {erroChamada && (
                <p className="text-sm text-destructive">{erroChamada}</p>
              )}

              <button
                onClick={enviarChamada}
                disabled={chamando || !mesaNumero.trim()}
                className="w-full bg-primary text-primary-foreground rounded-2xl p-4 font-bold text-base flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition"
              >
                <Bell className="h-5 w-5" />
                {chamando ? "Chamando..." : "Chamar Garçom"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IndisponiveisSection({ itens }: { itens: Produto[] }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div>
      <button
        onClick={() => setAberto(v => !v)}
        className="w-full flex items-center justify-between text-muted-foreground text-sm py-3 border-t border-border"
      >
        <span>Temporariamente indisponíveis ({itens.length})</span>
        {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {aberto && itens.map(p => (
        <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/50 p-3 mb-2 opacity-50">
          <div className="flex-1">
            <p className="font-semibold text-sm line-through">{p.nome}</p>
            <p className="text-xs text-muted-foreground">Indisponível hoje</p>
          </div>
          <p className="font-bold text-muted-foreground text-sm">R$ {Number(p.preco).toFixed(2).replace(".", ",")}</p>
        </div>
      ))}
    </div>
  );
}
