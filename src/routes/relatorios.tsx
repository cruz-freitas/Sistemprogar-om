import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3, DollarSign, Users, Package, Clock, XCircle, TrendingUp, FileText,
} from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/relatorios")({
  component: Relatorios,
});

type ResumoVendas = {
  totalDia: number;
  totalSemana: number;
  totalMes: number;
  comandasFechadasDia: number;
  cancelamentosDia: number;
  tempoMedioMin: number;
};

type VendasGarcom = { nome: string; total: number; comandas: number };
type TopProduto = { nome: string; qtd: number; total: number };

function Relatorios() {
  const [resumo, setResumo] = useState<ResumoVendas | null>(null);
  const [garcons, setGarcons] = useState<VendasGarcom[]>([]);
  const [topProdutos, setTopProdutos] = useState<TopProduto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const agora = new Date();
      const inicioDia = new Date(agora); inicioDia.setHours(0, 0, 0, 0);
      const inicioSemana = new Date(agora); inicioSemana.setDate(agora.getDate() - 7);
      const inicioMes = new Date(agora); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);

      const [
        { data: fechadasDia },
        { data: fechadasSemana },
        { data: fechadasMes },
        { data: canceladas },
        { data: itensDia },
        { data: funcionariosData },
      ] = await Promise.all([
        supabase.from("comandas").select("total, aberta_em, fechada_em").eq("status", "fechada").gte("fechada_em", inicioDia.toISOString()),
        supabase.from("comandas").select("total").eq("status", "fechada").gte("fechada_em", inicioSemana.toISOString()),
        supabase.from("comandas").select("total").eq("status", "fechada").gte("fechada_em", inicioMes.toISOString()),
        supabase.from("comanda_itens").select("id").eq("cancelado", true).gte("created_at", inicioDia.toISOString()),
        supabase.from("comanda_itens")
          .select("nome_produto, quantidade, total")
          .eq("cancelado", false)
          .gte("created_at", inicioMes.toISOString()),
        supabase.from("funcionarios").select("nome, comandas(total, status)").eq("ativo", true),
      ]);

      const totalDia = (fechadasDia ?? []).reduce((s, c) => s + Number(c.total), 0);
      const totalSemana = (fechadasSemana ?? []).reduce((s, c) => s + Number(c.total), 0);
      const totalMes = (fechadasMes ?? []).reduce((s, c) => s + Number(c.total), 0);

      // Tempo médio (em minutos)
      const tempos = (fechadasDia ?? [])
        .filter((c) => c.aberta_em && c.fechada_em)
        .map((c) => (new Date(c.fechada_em!).getTime() - new Date(c.aberta_em).getTime()) / 60000);
      const tempoMedio = tempos.length > 0 ? tempos.reduce((s, t) => s + t, 0) / tempos.length : 0;

      // Top produtos do mês
      const mapa: Record<string, { qtd: number; total: number }> = {};
      (itensDia ?? []).forEach((i) => {
        if (!mapa[i.nome_produto]) mapa[i.nome_produto] = { qtd: 0, total: 0 };
        mapa[i.nome_produto].qtd += i.quantidade;
        mapa[i.nome_produto].total += Number(i.total);
      });
      const top = Object.entries(mapa)
        .map(([nome, v]) => ({ nome, ...v }))
        .sort((a, b) => b.qtd - a.qtd)
        .slice(0, 8);

      // Garçons
      const gData = (funcionariosData ?? []).map((f: any) => ({
        nome: f.nome,
        total: (f.comandas ?? []).filter((c: any) => c.status === "fechada").reduce((s: number, c: any) => s + Number(c.total), 0),
        comandas: (f.comandas ?? []).filter((c: any) => c.status === "fechada").length,
      })).filter((g) => g.comandas > 0).sort((a, b) => b.total - a.total);

      setResumo({ totalDia, totalSemana, totalMes, comandasFechadasDia: (fechadasDia ?? []).length, cancelamentosDia: (canceladas ?? []).length, tempoMedioMin: Math.round(tempoMedio) });
      setTopProdutos(top);
      setGarcons(gData);
      setLoading(false);
    }
    load();
  }, []);

  const cards = resumo ? [
    { label: "Faturamento hoje", value: `R$ ${resumo.totalDia.toFixed(2).replace(".", ",")}`, icon: DollarSign, cor: "text-success" },
    { label: "Faturamento semana", value: `R$ ${resumo.totalSemana.toFixed(2).replace(".", ",")}`, icon: TrendingUp, cor: "text-primary" },
    { label: "Faturamento mês", value: `R$ ${resumo.totalMes.toFixed(2).replace(".", ",")}`, icon: BarChart3, cor: "text-primary" },
    { label: "Comandas fechadas hoje", value: String(resumo.comandasFechadasDia), icon: FileText, cor: "text-primary" },
    { label: "Itens cancelados hoje", value: String(resumo.cancelamentosDia), icon: XCircle, cor: "text-destructive" },
    { label: "Tempo médio por comanda", value: resumo.tempoMedioMin > 0 ? `${resumo.tempoMedioMin} min` : "—", icon: Clock, cor: "text-muted-foreground" },
  ] : [];

  return (
    <>
      <PageHeader title="Relatórios" description="Análises e indicadores do negócio" />

      {/* Cards resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {loading
          ? [...Array(6)].map((_, i) => <Card key={i} className="p-4 h-20 animate-pulse bg-accent/30" />)
          : cards.map((c) => (
            <Card key={c.label} className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">{c.label}</span>
                <c.icon className={`h-4 w-4 ${c.cor}`} />
              </div>
              <p className="text-xl font-bold">{c.value}</p>
            </Card>
          ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Top produtos do mês */}
        <Card className="p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Package className="h-4 w-4" />Produtos mais vendidos (mês)
          </h3>
          {loading ? (
            <div className="space-y-3">{[...Array(6)].map((_, i) => <div key={i} className="h-6 bg-accent/30 rounded animate-pulse" />)}</div>
          ) : topProdutos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dados ainda</p>
          ) : (
            <div className="space-y-3">
              {topProdutos.map((p, i) => (
                <div key={p.nome} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-primary/15 text-primary text-xs font-bold">{i + 1}</span>
                  <span className="flex-1 text-sm truncate">{p.nome}</span>
                  <Badge variant="secondary" className="text-xs">{p.qtd} un</Badge>
                  <span className="text-sm font-semibold w-24 text-right">R$ {p.total.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Ranking garçons */}
        <Card className="p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Users className="h-4 w-4" />Ranking de garçons (total)
          </h3>
          {loading ? (
            <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-accent/30 rounded animate-pulse" />)}</div>
          ) : garcons.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dados ainda</p>
          ) : (
            <div className="space-y-3">
              {garcons.map((g, i) => (
                <div key={g.nome} className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">{i + 1}</div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{g.nome}</p>
                    <p className="text-xs text-muted-foreground">{g.comandas} comandas fechadas</p>
                  </div>
                  <span className="text-sm font-bold text-primary">R$ {g.total.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
