import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Eye } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase, type Comanda } from "@/lib/supabase";

export const Route = createFileRoute("/comandas")({
  component: Comandas,
});

function Comandas() {
  const navigate = useNavigate();
  const [comandas, setComanadas] = useState<Comanda[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data } = await supabase
      .from("comandas")
      .select("*, mesas(numero), funcionarios(nome)")
      .eq("status", "aberta")
      .order("aberta_em", { ascending: false });
    if (data) setComanadas(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("comandas-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "comandas" }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  function formatHora(iso: string) {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function abrirNoCaixa(c: Comanda) {
    // Salva a comanda selecionada no sessionStorage para o caixa recuperar
    sessionStorage.setItem("caixa_comanda_id", c.id);
    navigate({ to: "/caixa" });
  }

  return (
    <>
      <PageHeader
        title="Comandas Abertas"
        description="Acompanhe os atendimentos em andamento"
        actions={
          <Button asChild>
            <Link to="/nova-comanda"><Plus className="h-4 w-4 mr-1" />Nova comanda</Link>
          </Button>
        }
      />

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Card key={i} className="p-4 h-36 animate-pulse bg-accent/30" />)}
        </div>
      ) : comandas.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <p className="text-lg font-semibold mb-1">Nenhuma comanda aberta</p>
          <p className="text-sm">Clique em "Nova comanda" para iniciar um atendimento.</p>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {comandas.map((c) => (
            <Card key={c.id} className="p-4 hover:border-primary transition cursor-pointer" onClick={() => abrirNoCaixa(c)}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-xs text-muted-foreground">Comanda</p>
                  <p className="text-2xl font-bold">{c.codigo}</p>
                </div>
                <Badge variant="secondary">Mesa {(c as any).mesas?.numero ?? "Balcao"}</Badge>
              </div>
              <p className="font-semibold">{c.cliente_nome ?? "Avulso"}</p>
              <p className="text-xs text-muted-foreground mb-3">
                {(c as any).funcionarios?.nome ?? "—"} · aberta {formatHora(c.aberta_em)}
              </p>
              <div className="flex items-end justify-between pt-3 border-t border-border">
                <p className="text-lg font-bold text-primary">
                  R$ {Number(c.total).toFixed(2).replace(".", ",")}
                </p>
                <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); abrirNoCaixa(c); }}>
                  <Eye className="h-3.5 w-3.5 mr-1" />Abrir
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
