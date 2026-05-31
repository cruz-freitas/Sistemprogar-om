import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Save, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/configuracoes")({
  component: Configuracoes,
});

const FORM_PADRAO = {
  nome_estabelecimento: "Bambui Bar",
  cnpj: "",
  endereco: "",
  taxa_servico_pct: "10",
  tempo_limite_min: "180",
};

function Configuracoes() {
  const [configId, setConfigId] = useState<string | null>(null);
  const [form, setForm] = useState(FORM_PADRAO);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("configuracoes")
      .select("*")
      .limit(1);

    if (error) {
      toast.error("Erro ao carregar configurações: " + error.message);
      setLoading(false);
      return;
    }

    const cfg = data?.[0];
    if (cfg) {
      setConfigId(cfg.id);
      setForm({
        nome_estabelecimento: cfg.nome_estabelecimento ?? "Bambui Bar",
        cnpj: cfg.cnpj ?? "",
        endereco: cfg.endereco ?? "",
        taxa_servico_pct: String(cfg.taxa_servico_pct ?? 10),
        tempo_limite_min: String(cfg.tempo_limite_min ?? 180),
      });
    } else {
      // Nenhum registro — cria um automaticamente
      await criar();
    }
    setLoading(false);
  }

  async function criar() {
    const { data } = await supabase
      .from("configuracoes")
      .insert({
        nome_estabelecimento: "Bambui Bar",
        taxa_servico_pct: 10,
        tempo_limite_min: 180,
        impressao_automatica: true,
      })
      .select()
      .single();
    if (data) setConfigId(data.id);
  }

  useEffect(() => { load(); }, []);

  async function salvar() {
    if (!form.nome_estabelecimento.trim()) {
      toast.error("Nome do estabelecimento é obrigatório");
      return;
    }
    setSaving(true);

    const payload = {
      nome_estabelecimento: form.nome_estabelecimento.trim(),
      cnpj: form.cnpj.trim() || null,
      endereco: form.endereco.trim() || null,
      taxa_servico_pct: parseFloat(form.taxa_servico_pct) || 10,
      tempo_limite_min: parseInt(form.tempo_limite_min) || 180,
      updated_at: new Date().toISOString(),
    };

    let error;

    if (configId) {
      ({ error } = await supabase
        .from("configuracoes")
        .update(payload)
        .eq("id", configId));
    } else {
      const res = await supabase
        .from("configuracoes")
        .insert(payload)
        .select()
        .single();
      error = res.error;
      if (res.data) setConfigId(res.data.id);
    }

    if (error) {
      toast.error("Erro ao salvar: " + error.message);
    } else {
      toast.success("Configurações salvas!");
    }
    setSaving(false);
  }

  function campo(label: string, key: keyof typeof form, tipo: string = "text", placeholder?: string) {
    return (
      <div>
        <Label className="mb-1 block">{label}</Label>
        <Input
          type={tipo}
          placeholder={placeholder}
          value={form[key]}
          onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
        />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <PageHeader
        title="Configurações"
        subtitle="Ajustes gerais do sistema"
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={"h-4 w-4 mr-1 " + (loading ? "animate-spin" : "")} />
            Recarregar
          </Button>
        }
      />

      {loading ? (
        <div className="grid lg:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <Card key={i} className="p-5 h-52 animate-pulse bg-accent/30" />
          ))}
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">

          <Card className="p-5">
            <h3 className="font-semibold mb-4">Estabelecimento</h3>
            <div className="space-y-3">
              {campo("Nome do estabelecimento", "nome_estabelecimento", "text", "Ex: Bambui Bar")}
              {campo("CNPJ", "cnpj", "text", "00.000.000/0000-00")}
              {campo("Endereço", "endereco", "text", "Rua, número, bairro")}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold mb-4">Operação</h3>
            <div className="space-y-3">
              {campo("Taxa de serviço (%)", "taxa_servico_pct", "number")}
              {campo("Tempo limite por comanda (min)", "tempo_limite_min", "number")}
              <div className="pt-2 text-xs text-muted-foreground bg-accent/30 rounded-lg p-3">
                A taxa de serviço é aplicada automaticamente sobre o subtotal de cada comanda.
              </div>
            </div>
          </Card>

          <Card className="p-5 lg:col-span-2">
            <h3 className="font-semibold mb-2">Sobre</h3>
            <p className="text-sm text-muted-foreground">
              Bambui Bar · Sistema de Gestão PDV · Banco de dados Supabase.
            </p>
            {configId && (
              <p className="text-xs text-muted-foreground/50 mt-1 font-mono">ID: {configId}</p>
            )}
          </Card>

          <div className="lg:col-span-2 flex justify-end">
            <Button className="font-semibold gap-2 h-11 px-6" onClick={salvar} disabled={saving}>
              {saving ? (
                <><RefreshCw className="h-4 w-4 animate-spin" /> Salvando...</>
              ) : (
                <><Save className="h-4 w-4" /> Salvar configurações</>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
