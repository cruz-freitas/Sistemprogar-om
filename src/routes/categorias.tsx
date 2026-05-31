import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase, type Categoria } from "@/lib/supabase";
import { toast } from "sonner";

export const Route = createFileRoute("/categorias")({
  component: Categorias,
});

const COR_OPTIONS = [
  "oklch(0.62 0.16 250)",
  "oklch(0.72 0.18 50)",
  "oklch(0.80 0.16 85)",
  "oklch(0.62 0.22 25)",
  "oklch(0.68 0.16 150)",
  "oklch(0.65 0.20 310)",
];

function Categorias() {
  const [cats, setCats] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editando, setEditando] = useState<Categoria | null>(null);
  const [form, setForm] = useState({ nome: "", cor: COR_OPTIONS[0] });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("categorias")
      .select("*")
      .eq("ativo", true)
      .order("nome");
    if (!error && data) setCats(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function abrirModal(cat?: Categoria) {
    if (cat) {
      setEditando(cat);
      setForm({ nome: cat.nome, cor: cat.cor });
    } else {
      setEditando(null);
      setForm({ nome: "", cor: COR_OPTIONS[0] });
    }
    setModal(true);
  }

  async function salvar() {
    if (!form.nome.trim()) return toast.error("Nome obrigatório");
    setSaving(true);
    if (editando) {
      const { error } = await supabase.from("categorias").update({ nome: form.nome, cor: form.cor }).eq("id", editando.id);
      if (error) toast.error("Erro ao salvar"); else { toast.success("Categoria atualizada"); setModal(false); load(); }
    } else {
      const { error } = await supabase.from("categorias").insert({ nome: form.nome, cor: form.cor });
      if (error) toast.error("Erro ao criar"); else { toast.success("Categoria criada"); setModal(false); load(); }
    }
    setSaving(false);
  }

  async function excluir(cat: Categoria) {
    if (!confirm(`Excluir "${cat.nome}"?`)) return;
    const { error } = await supabase.from("categorias").update({ ativo: false }).eq("id", cat.id);
    if (error) toast.error("Erro ao excluir"); else { toast.success("Categoria removida"); load(); }
  }

  return (
    <>
      <PageHeader
        title="Categorias"
        description="Organize os produtos do cardápio"
        actions={<Button onClick={() => abrirModal()}><Plus className="h-4 w-4 mr-1" />Nova categoria</Button>}
      />

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(5)].map((_, i) => <Card key={i} className="p-5 h-24 animate-pulse bg-accent/30" />)}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cats.map((c) => (
            <Card key={c.id} className="p-5 hover:border-primary transition">
              <div className="h-2 w-12 rounded-full mb-3" style={{ background: c.cor }} />
              <div className="flex items-start justify-between">
                <h3 className="text-lg font-semibold">{c.nome}</h3>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => abrirModal(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => excluir(c)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">{editando ? "Editar categoria" : "Nova categoria"}</h2>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setModal(false)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="space-y-4">
              <div>
                <Label>Nome</Label>
                <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Bebidas" />
              </div>
              <div>
                <Label className="mb-2 block">Cor</Label>
                <div className="flex gap-2 flex-wrap">
                  {COR_OPTIONS.map((cor) => (
                    <button
                      key={cor}
                      onClick={() => setForm({ ...form, cor })}
                      className={`h-8 w-8 rounded-full border-2 transition ${form.cor === cor ? "border-primary scale-110" : "border-transparent"}`}
                      style={{ background: cor }}
                    />
                  ))}
                </div>
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
