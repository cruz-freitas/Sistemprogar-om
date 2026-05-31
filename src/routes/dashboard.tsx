import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, ClipboardList, Armchair, TrendingUp, Users, Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ChamadaGarcomPainel } from "@/components/ChamadaGarcomAlert";
import { useChamadasGarcom } from "@/hooks/use-chamadas-garcom";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const [stats, setStats] = useState({ vendas: 0, comandasAbertas: 0, mesasOcupadas: 0, totalMesas: 0, ticketMedio: 0 });
  const [topProdutos, setTopProdutos] = useState<{ nome: string; qtd: number; total: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const { chamadas, novasChamadas, atender, atenderTodas } = useChamadasGarcom();

  useEffect(() => {
    async function load() {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const hojeISO = hoje.toISOString();

      const [
        { data: comandasFechadas },
        { data: comandasAbertas },
        { data: mesasData },
        { data: itensData },
      ] = await Promise.all([
        supabase.from("comandas").select("total").eq("status", "fechada").gte("fechada_em", hojeISO),
        supabase.from("comandas").select("id").eq("status", "aberta"),
        supabase.from("mesas").select("status"),
        supabase.from("comanda_itens").select("nome_produto, quantidade, total").eq("cancelado", false).gte("created_at", hojeISO),
      ]);

      const vendas = (comandasFechadas ?? []).reduce((s, c) => s + Number(c.total), 0);
      const abertas = (comandasAbertas ?? []).length;
      const ocupadas = (mesasData ?? []).filter(m => m.status !== "livre").length;
      const totalMesas = (mesasData ?? []).length;
      const ticketMedio = (comandasFechadas ?? []).length > 0 ? vendas / (comandasFechadas ?? []).length : 0;

      const mapaItens: Record<string, { qtd: number; total: number }> = {};
      (itensData ?? []).forEach(i => {
        if (!mapaItens[i.nome_produto]) mapaItens[i.nome_produto] = { qtd: 0, total: 0 };
        mapaItens[i.nome_produto].qtd += i.quantidade;
        mapaItens[i.nome_produto].total += Number(i.total);
      });
      const top = Object.entries(mapaItens)
        .map(([nome, v]) => ({ nome, ...v }))
        .sort((a, b) => b.qtd - a.qtd)
        .slice(0, 5);

      setStats({ vendas, comandasAbertas: abertas, mesasOcupadas: ocupadas, totalMesas, ticketMedio });
      setTopProdutos(top);
      setLoading(false);
    }
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-4 space-y-5">
      <PageHeader title="Dashboard" subtitle="Resumo do dia" />

      {/* Chamadas pendentes em destaque */}
      {chamadas.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold flex items-center gap-2">
              <Bell className={"h-4 w-4 " + (novasChamadas.length > 0 ? "text-amber-500 animate-bounce" : "text-amber-500")} />
              Mesas chamando ({chamadas.length})
            </h3>
            {chamadas.length > 1 && (
              <button onClick={atenderTodas} className="text-xs text-primary underline">Atender todas</button>
            )}
          </div>
          <Card className="overflow-hidden border-amber-500/30">
            <ChamadaGarcomPainel modo="inline" />
          </Card>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Vendas hoje", value: `R$ ${stats.vendas.toFixed(2).replace(".", ",")}`, icon: DollarSign, color: "text-green-500" },
          { label: "Comandas abertas", value: stats.comandasAbertas, icon: ClipboardList, color: "text-blue-500" },
          { label: "Mesas ocupadas", value: `${stats.mesasOcupadas}/${stats.totalMesas}`, icon: Armchair, color: "text-orange-500" },
          { label: "Ticket médio", value: `R$ ${stats.ticketMedio.toFixed(2).replace(".", ",")}`, icon: TrendingUp, color: "text-purple-500" },
        ].map(s => (
          <Card key={s.label} className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon className={"h-4 w-4 " + s.color} />
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
            <p className="text-xl font-bold">{loading ? <span className="opacity-30">—</span> : s.value}</p>
          </Card>
        ))}
      </div>

      {/* Top produtos */}
      {topProdutos.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3 text-sm">Top produtos hoje</h3>
          <div className="space-y-2">
            {topProdutos.map((p, i) => (
              <div key={p.nome} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                <span className="flex-1 text-sm truncate">{p.nome}</span>
                <Badge variant="secondary">{p.qtd}x</Badge>
                <span className="text-sm font-semibold text-primary">R$ {p.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
