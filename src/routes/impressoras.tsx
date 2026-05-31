import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Printer, CheckCircle2, AlertCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase, type Impressora } from "@/lib/supabase";
import { toast } from "sonner";

export const Route = createFileRoute("/impressoras")({
  component: Impressoras,
});

function Impressoras() {
  const [impressoras, setImpressoras] = useState<Impressora[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editando, setEditando] = useState<Impressora | null>(null);
  const [form, setForm] = useState({ nome: "", modelo: "Bematech MP-4200", setoresStr: "", status: "online" as Impressora["status"] });
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data } = await supabase.from("impressoras").select("*").order("nome");
    if (data) setImpressoras(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function abrirModal(i?: Impressora) {
    if (i) {
      setEditando(i);
      setForm({ nome: i.nome, modelo: i.modelo, setoresStr: i.setores.join(", "), status: i.status });
    } else {
      setEditando(null);
      setForm({ nome: "", modelo: "Bematech MP-4200", setoresStr: "", status: "online" });
    }
    setModal(true);
  }

  async function toggleStatus(imp: Impressora) {
    const novoStatus = imp.status === "online" ? "offline" : "online";
    const { error } = await supabase.from("impressoras").update({ status: novoStatus }).eq("id", imp.id);
    if (error) toast.error("Erro"); else { toast.success(`${imp.nome} agora ${novoStatus}`); load(); }
  }

  async function salvar() {
    if (!form.nome.trim()) return toast.error("Nome obrigatório");
    setSaving(true);
    const payload = {
      nome: form.nome,
      modelo: form.modelo,
      setores: form.setoresStr.split(",").map((s) => s.trim()).filter(Boolean),
      status: form.status,
    };
    const { error } = editando
      ? await supabase.from("impressoras").update(payload).eq("id", editando.id)
      : await supabase.from("impressoras").insert(payload);
    if (error) toast.error(error.message.includes("unique") ? "Nome já existe" : "Erro ao salvar");
    else { toast.success("Salvo"); setModal(false); load(); }
    setSaving(false);
  }

  return (
    <>
      <PageHeader
        title="Impressoras"
        description="Roteamento de impressão por setor"
        actions={<Button onClick={() => abrirModal()}><Plus className="h-4 w-4 mr-1" />Nova impressora</Button>}
      />

      {loading ? (
        <div className="grid sm:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Card key={i} className="p-5 h-40 animate-pulse bg-accent/30" />)}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {impressoras.map((p) => (
            <Card key={p.id} className="p-5">
              <div className="flex items-start gap-4 mb-4">
                <div className="h-12 w-12 rounded-lg bg-accent flex items-center justify-center">
                  <Printer className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{p.nome}</h3>
                    {p.status === "online" ? (
                      <Badge className="bg-success text-success-foreground gap-1"><CheckCircle2 className="h-3 w-3" />Online</Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" />Offline</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.modelo}</p>
                </div>
              </div>
              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-2">Setores vinculados:</p>
                <div className="flex flex-wrap gap-1.5">
                  {p.setores.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => toggleStatus(p)}>
                  {p.status === "online" ? "Desativar" : "Ativar"}
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={() => abrirModal(p)}>Configurar</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">{editando ? "Editar impressora" : "Nova impressora"}</h2>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setModal(false)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="space-y-3">
              <div><Label>Nome</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
              <div><Label>Modelo</Label><Input value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })} /></div>
              <div>
                <Label>Setores (separados por vírgula)</Label>
                <Input value={form.setoresStr} onChange={(e) => setForm({ ...form, setoresStr: e.target.value })} placeholder="Cozinha, Frituras, Porções" />
              </div>
              <div>
                <Label>Status</Label>
                <select className="w-full h-10 rounded-md border border-input bg-input px-3 text-sm" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Impressora["status"] })}>
                  <option value="online">Online</option>
                  <option value="offline">Offline</option>
                </select>
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
