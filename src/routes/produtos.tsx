import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, X, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase, type Produto, type Categoria, type Impressora } from "@/lib/supabase";
import { toast } from "sonner";

export const Route = createFileRoute("/produtos")({
  component: Produtos,
});

const FORM_VAZIO = { nome: "", categoria_id: "", preco: "", impressora: "Cozinha", favorito: false, ativo: true };

function Produtos() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [cats, setCats] = useState<Categoria[]>([]);
  const [impressoras, setImpressoras] = useState<Impressora[]>([]);
  const [busca, setBusca] = useState("");
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editando, setEditando] = useState<Produto | null>(null);
  const [form, setForm] = useState(FORM_VAZIO);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: prods }, { data: catData }, { data: impData }] = await Promise.all([
      supabase.from("produtos").select("*, categorias(nome)").order("nome"),
      supabase.from("categorias").select("*").eq("ativo", true).order("nome"),
      supabase.from("impressoras").select("*").order("nome"),
    ]);
    if (prods) setProdutos(prods);
    if (catData) setCats(catData);
    if (impData) setImpressoras(impData);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtrados = produtos.filter((p) =>
    p.nome.toLowerCase().includes(busca.toLowerCase())
  );

  function abrirModal(p?: Produto) {
    if (p) {
      setEditando(p);
      setForm({ nome: p.nome, categoria_id: p.categoria_id ?? "", preco: String(p.preco), impressora: p.impressora, favorito: p.favorito, ativo: p.ativo });
    } else {
      setEditando(null);
      setForm(FORM_VAZIO);
    }
    setModal(true);
  }

  async function salvar() {
    if (!form.nome.trim() || !form.preco) return toast.error("Nome e preço obrigatórios");
    setSaving(true);
    const payload = {
      nome: form.nome,
      categoria_id: form.categoria_id || null,
      preco: parseFloat(form.preco),
      impressora: form.impressora,
      favorito: form.favorito,
      ativo: form.ativo,
    };
    const { error } = editando
      ? await supabase.from("produtos").update(payload).eq("id", editando.id)
      : await supabase.from("produtos").insert(payload);
    if (error) toast.error("Erro ao salvar");
    else { toast.success(editando ? "Produto atualizado" : "Produto criado"); setModal(false); load(); }
    setSaving(false);
  }

  return (
    <>
      <PageHeader
        title="Produtos"
        description="Cadastro e gestão do cardápio"
        actions={<Button onClick={() => abrirModal()}><Plus className="h-4 w-4 mr-1" />Novo produto</Button>}
      />

      <Card className="p-4 mb-4">
        <Input placeholder="🔍 Buscar produto..." className="max-w-md" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="p-3">Produto</th>
                <th className="p-3">Categoria</th>
                <th className="p-3 text-right">Preço</th>
                <th className="p-3">Impressora</th>
                <th className="p-3">Status</th>
                <th className="p-3 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-t border-border">
                    <td colSpan={6} className="p-3"><div className="h-4 bg-accent/40 rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : filtrados.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-accent/20">
                  <td className="p-3 font-medium flex items-center gap-1">
                    {p.favorito && <Star className="h-3 w-3 text-warning" />}
                    {p.nome}
                  </td>
                  <td className="p-3 text-muted-foreground">{p.categorias?.nome ?? "—"}</td>
                  <td className="p-3 text-right font-semibold">R$ {Number(p.preco).toFixed(2)}</td>
                  <td className="p-3"><Badge variant="secondary">{p.impressora}</Badge></td>
                  <td className="p-3">
                    {p.ativo
                      ? <Badge className="bg-success text-success-foreground">Ativo</Badge>
                      : <Badge variant="outline">Inativo</Badge>}
                  </td>
                  <td className="p-3">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => abrirModal(p)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">{editando ? "Editar produto" : "Novo produto"}</h2>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setModal(false)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="space-y-3">
              <div><Label>Nome</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
              <div>
                <Label>Categoria</Label>
                <select className="w-full h-10 rounded-md border border-input bg-input px-3 text-sm" value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: e.target.value })}>
                  <option value="">Sem categoria</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
              <div><Label>Preço (R$)</Label><Input type="number" step="0.01" value={form.preco} onChange={(e) => setForm({ ...form, preco: e.target.value })} /></div>
              <div>
                <Label>Impressora</Label>
                <select className="w-full h-10 rounded-md border border-input bg-input px-3 text-sm" value={form.impressora} onChange={(e) => setForm({ ...form, impressora: e.target.value })}>
                  {impressoras.map((i) => <option key={i.id} value={i.nome}>{i.nome}</option>)}
                </select>
              </div>
              <div className="flex gap-4 pt-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.favorito} onChange={(e) => setForm({ ...form, favorito: e.target.checked })} />
                  Favorito
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
                  Ativo
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <Button variant="outline" onClick={() => setModal(false)}>Cancelar</Button>
              <Button onClick={salvar} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
