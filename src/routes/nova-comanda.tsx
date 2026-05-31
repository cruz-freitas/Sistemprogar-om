import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Minus, Trash2, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase, type Produto, type Mesa, type Funcionario, type Categoria } from "@/lib/supabase";
import { toast } from "sonner";

export const Route = createFileRoute("/nova-comanda")({
  component: NovaComanda,
});

type ItemComanda = { produto: Produto; quantidade: number };

function NovaComanda() {
  const navigate = useNavigate();
  const [cats, setCats] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [catSelecionada, setCatSelecionada] = useState("Favoritos");
  const [busca, setBusca] = useState("");
  const [itens, setItens] = useState<ItemComanda[]>([]);
  const [form, setForm] = useState({ mesa_id: "", funcionario_id: "", cliente_nome: "", codigo: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const [{ data: ps }, { data: ms }, { data: fs }, { data: cs }] = await Promise.all([
        supabase.from("produtos").select("*, categorias(nome)").eq("ativo", true).order("nome"),
        supabase.from("mesas").select("*").eq("status", "livre").order("numero"),
        supabase.from("funcionarios").select("*").eq("ativo", true).order("nome"),
        supabase.from("categorias").select("*").eq("ativo", true).order("nome"),
      ]);
      if (ps) setProdutos(ps);
      if (ms) setMesas(ms);
      if (fs) { setFuncionarios(fs); if (fs.length > 0) setForm((f) => ({ ...f, funcionario_id: fs[0].id })); }
      if (cs) setCats(cs);
    }
    load();
  }, []);

  const produtosFiltrados = (() => {
    let lista = produtos;
    if (catSelecionada === "Favoritos") lista = lista.filter((p) => p.favorito);
    else lista = lista.filter((p) => p.categorias?.nome === catSelecionada);
    if (busca) lista = lista.filter((p) => p.nome.toLowerCase().includes(busca.toLowerCase()));
    return lista;
  })();

  function adicionarItem(p: Produto) {
    setItens((prev) => {
      const idx = prev.findIndex((i) => i.produto.id === p.id);
      if (idx >= 0) {
        const novo = [...prev];
        novo[idx] = { ...novo[idx], quantidade: novo[idx].quantidade + 1 };
        return novo;
      }
      return [...prev, { produto: p, quantidade: 1 }];
    });
  }

  function ajustarQtd(prodId: string, delta: number) {
    setItens((prev) =>
      prev.map((i) => i.produto.id === prodId ? { ...i, quantidade: Math.max(1, i.quantidade + delta) } : i)
    );
  }

  function removerItem(prodId: string) {
    setItens((prev) => prev.filter((i) => i.produto.id !== prodId));
  }

  const subtotal = itens.reduce((s, i) => s + Number(i.produto.preco) * i.quantidade, 0);

  async function enviar() {
    if (itens.length === 0) return toast.error("Adicione pelo menos um item");
    setSaving(true);
    const codigo = form.codigo || `CMD-${Date.now().toString().slice(-6)}`;
    const { data: comanda, error } = await supabase
      .from("comandas")
      .insert({
        codigo,
        mesa_id: form.mesa_id || null,
        funcionario_id: form.funcionario_id || null,
        cliente_nome: form.cliente_nome || null,
        subtotal,
        taxa_servico: subtotal * 0.1,
        total: subtotal * 1.1,
        status: "aberta",
      })
      .select()
      .single();

    if (error || !comanda) { toast.error("Erro ao criar comanda"); setSaving(false); return; }

    const itensPay = itens.map((i) => ({
      comanda_id: comanda.id,
      produto_id: i.produto.id,
      nome_produto: i.produto.nome,
      preco_unit: Number(i.produto.preco),
      quantidade: i.quantidade,
    }));
    await supabase.from("comanda_itens").insert(itensPay);

    if (form.mesa_id) {
      await supabase.from("mesas").update({ status: "ocupada" }).eq("id", form.mesa_id);
    }

    toast.success(`Comanda ${codigo} aberta!`);
    navigate({ to: "/comandas" });
    setSaving(false);
  }

  return (
    <>
      <PageHeader title="Nova Comanda" description="Lance pedidos rapidamente" />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Mesa</label>
                <select className="w-full h-10 rounded-md border border-input bg-input px-3 text-sm" value={form.mesa_id} onChange={(e) => setForm({ ...form, mesa_id: e.target.value })}>
                  <option value="">Balcão / Avulso</option>
                  {mesas.map((m) => <option key={m.id} value={m.id}>Mesa {m.numero}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Garçom</label>
                <select className="w-full h-10 rounded-md border border-input bg-input px-3 text-sm" value={form.funcionario_id} onChange={(e) => setForm({ ...form, funcionario_id: e.target.value })}>
                  {funcionarios.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Cliente</label>
                <Input placeholder="Nome do cliente" value={form.cliente_nome} onChange={(e) => setForm({ ...form, cliente_nome: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Código (opcional)</label>
                <Input placeholder="A-012" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <Input placeholder="🔍 Buscar produto..." className="mb-3" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <div className="flex flex-wrap gap-2 mb-4">
              <button onClick={() => setCatSelecionada("Favoritos")}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${catSelecionada === "Favoritos" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground hover:bg-accent/70"}`}>
                <Star className="h-3 w-3 inline mr-1 -mt-0.5" />Favoritos
              </button>
              {cats.map((c) => (
                <button key={c.id} onClick={() => setCatSelecionada(c.nome)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${catSelecionada === c.nome ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground hover:bg-accent/70"}`}>
                  {c.nome}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {produtosFiltrados.map((p) => (
                <button key={p.id} onClick={() => adicionarItem(p)}
                  className="text-left rounded-lg border border-border p-3 hover:border-primary hover:bg-primary/5 transition">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="font-medium text-sm leading-tight">{p.nome}</span>
                    {p.favorito && <Star className="h-3.5 w-3.5 text-warning flex-shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{p.categorias?.nome}</p>
                  <p className="font-bold text-primary">R$ {Number(p.preco).toFixed(2).replace(".", ",")}</p>
                </button>
              ))}
            </div>
          </Card>
        </div>

        <Card className="p-4 lg:sticky lg:top-20 h-fit">
          <h3 className="font-semibold mb-3">Comanda atual</h3>
          {itens.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Clique em um produto para adicionar</p>
          ) : (
            <div className="space-y-2 mb-4 max-h-[40vh] overflow-y-auto pr-1">
              {itens.map((i) => (
                <div key={i.produto.id} className="rounded-md bg-accent/40 p-2">
                  <div className="flex items-start justify-between mb-1">
                    <span className="text-sm font-medium">{i.produto.nome}</span>
                    <button className="text-destructive" onClick={() => removerItem(i.produto.id)}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => ajustarQtd(i.produto.id, -1)}><Minus className="h-3 w-3" /></Button>
                      <span className="text-sm w-6 text-center">{i.quantidade}</span>
                      <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => ajustarQtd(i.produto.id, 1)}><Plus className="h-3 w-3" /></Button>
                    </div>
                    <span className="text-sm font-semibold">R$ {(Number(i.produto.preco) * i.quantidade).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-1 text-sm border-t border-border pt-3 mb-3">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>R$ {subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Serviço (10%)</span><span>R$ {(subtotal * 0.1).toFixed(2)}</span></div>
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span><span className="text-primary">R$ {(subtotal * 1.1).toFixed(2)}</span>
            </div>
          </div>
          <Button className="w-full h-11 font-semibold" disabled={saving || itens.length === 0} onClick={enviar}>
            {saving ? "Enviando..." : "Enviar para preparo"}
          </Button>
        </Card>
      </div>
    </>
  );
}
