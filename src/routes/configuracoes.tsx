import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useState } from "react";
import { supabase, type Configuracao } from "@/lib/supabase";
import { toast } from "sonner";

export const Route = createFileRoute("/configuracoes")({
  component: Configuracoes,
});

function Configuracoes() {
  const [config, setConfig] = useState<Configuracao | null>(null);
  const [form, setForm] = useState({ nome_estabelecimento: "", cnpj: "", endereco: "", taxa_servico_pct: "10", tempo_limite_min: "180" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from("configuracoes").select("*").limit(1).single();
      if (data) {
        setConfig(data);
        setForm({
          nome_estabelecimento: data.nome_estabelecimento,
          cnpj: data.cnpj ?? "",
          endereco: data.endereco ?? "",
          taxa_servico_pct: String(data.taxa_servico_pct),
          tempo_limite_min: String(data.tempo_limite_min),
        });
      }
      setLoading(false);
    }
    load();
  }, []);

  async function salvar() {
    setSaving(true);
    const payload = {
      nome_estabelecimento: form.nome_estabelecimento,
      cnpj: form.cnpj || null,
      endereco: form.endereco || null,
      taxa_servico_pct: parseFloat(form.taxa_servico_pct),
      tempo_limite_min: parseInt(form.tempo_limite_min),
      updated_at: new Date().toISOString(),
    };
    const { error } = config
      ? await supabase.from("configuracoes").update(payload).eq("id", config.id)
      : await supabase.from("configuracoes").insert(payload);
    if (error) toast.error("Erro ao salvar"); else toast.success("Configurações salvas!");
    setSaving(false);
  }

  return (
    <>
      <PageHeader title="Configurações" description="Ajustes gerais do sistema" />

      {loading ? (
        <div className="grid lg:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => <Card key={i} className="p-5 h-48 animate-pulse bg-accent/30" />)}
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="p-5">
            <h3 className="font-semibold mb-4">Estabelecimento</h3>
            <div className="space-y-3">
              <div><Label>Nome</Label><Input value={form.nome_estabelecimento} onChange={(e) => setForm({ ...form, nome_estabelecimento: e.target.value })} /></div>
              <div><Label>CNPJ</Label><Input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} /></div>
              <div><Label>Endereço</Label><Input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} /></div>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold mb-4">Operação</h3>
            <div className="space-y-3">
              <div><Label>Taxa de serviço (%)</Label><Input type="number" value={form.taxa_servico_pct} onChange={(e) => setForm({ ...form, taxa_servico_pct: e.target.value })} /></div>
              <div><Label>Tempo limite por comanda (min)</Label><Input type="number" value={form.tempo_limite_min} onChange={(e) => setForm({ ...form, tempo_limite_min: e.target.value })} /></div>
            </div>
          </Card>

          <Card className="p-5 lg:col-span-2">
            <h3 className="font-semibold mb-2">Sobre o sistema</h3>
            <p className="text-sm text-muted-foreground">
              Pesqueiro Bambuí · Sistema de Gestão v1.0 · Banco de dados Supabase conectado.
            </p>
          </Card>

          <div className="lg:col-span-2 flex justify-end">
            <Button className="font-semibold" onClick={salvar} disabled={saving}>
              {saving ? "Salvando..." : "Salvar configurações"}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
