import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { supabase, type Mesa } from "@/lib/supabase";
import { toast } from "sonner";
import { Plus, X, ArrowLeftRight, Trash2, Hash } from "lucide-react";

export const Route = createFileRoute("/mesas")({
  component: Mesas,
});

type Status = Mesa["status"];

type ComandaMesa = {
  id: string;
  codigo: string;
  cliente_nome: string | null;
  total: number;
  solicitou_fechamento: boolean;
  funcionarios: { nome: string } | null;
};

type MesaComComandas = Mesa & { comandas: ComandaMesa[] };

const statusMap: Record<Status, { label: string; cls: string }> = {
  livre:       { label: "Livre",       cls: "border-border bg-card" },
  ocupada:     { label: "Ocupada",     cls: "border-primary/40 bg-primary/10" },
  atendimento: { label: "Atendimento", cls: "border-warning/40 bg-warning/10" },
  fechando:    { label: "Fechando",    cls: "border-destructive/40 bg-destructive/10" },
};

// ─── Modal: criar mesa(s) ────────────────────────────────────────────────────
function ModalNovaMesa({
  proximoNumero,
  onClose,
  onSalvo,
}: {
  proximoNumero: number;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const [quantidade, setQuantidade] = useState(1);
  const [inicio, setInicio] = useState(proximoNumero);
  const [salvando, setSalvando] = useState(false);

  const preview = Array.from({ length: quantidade }, (_, i) => inicio + i);
  const numerosInvalidos = preview.filter((n) => n < 1 || n > 999);

  async function salvar() {
    if (numerosInvalidos.length > 0) return toast.error("Numero de mesa invalido (1-999)");
    setSalvando(true);

    // Verifica duplicatas
    const { data: existentes } = await supabase
      .from("mesas")
      .select("numero")
      .in("numero", preview);

    if (existentes && existentes.length > 0) {
      const nums = existentes.map((m: any) => m.numero).join(", ");
      toast.error(`Mesa(s) ${nums} ja existem`);
      setSalvando(false);
      return;
    }

    const { error } = await supabase.from("mesas").insert(
      preview.map((n) => ({ numero: n, status: "livre" }))
    );

    if (error) {
      toast.error("Erro ao criar mesas: " + error.message);
    } else {
      toast.success(
        quantidade === 1
          ? `Mesa ${preview[0]} criada!`
          : `${quantidade} mesas criadas (${preview[0]}–${preview[preview.length - 1]})!`
      );
      onSalvo();
      onClose();
    }
    setSalvando(false);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <Card className="w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-lg">Nova(s) Mesa(s)</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Número inicial
              </label>
              <Input
                type="number"
                min={1}
                max={999}
                value={inicio}
                onChange={(e) => setInicio(Number(e.target.value))}
                className="h-11 text-lg font-bold"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Quantidade
              </label>
              <Input
                type="number"
                min={1}
                max={50}
                value={quantidade}
                onChange={(e) => setQuantidade(Math.max(1, Math.min(50, Number(e.target.value))))}
                className="h-11 text-lg font-bold"
              />
            </div>
          </div>

          {/* Preview */}
          {preview.length > 0 && (
            <div className="rounded-xl border border-border bg-accent/30 p-3">
              <p className="text-xs text-muted-foreground mb-2 font-medium">
                {quantidade === 1 ? "Mesa que será criada:" : `${quantidade} mesas que serão criadas:`}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {preview.slice(0, 20).map((n) => (
                  <span
                    key={n}
                    className={
                      "px-2 py-0.5 rounded-full text-xs font-bold " +
                      (numerosInvalidos.includes(n)
                        ? "bg-destructive/20 text-destructive"
                        : "bg-primary/20 text-primary")
                    }
                  >
                    {n}
                  </span>
                ))}
                {preview.length > 20 && (
                  <span className="text-xs text-muted-foreground self-center">
                    +{preview.length - 20} mais...
                  </span>
                )}
              </div>
            </div>
          )}

          <Button
            className="w-full h-11 font-semibold"
            onClick={salvar}
            disabled={salvando || numerosInvalidos.length > 0}
          >
            {salvando ? "Criando..." : quantidade === 1 ? "Criar Mesa" : `Criar ${quantidade} Mesas`}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ─── Modal: trocar mesa da comanda ───────────────────────────────────────────
function ModalTrocarMesa({
  comanda,
  mesaAtual,
  todasMesas,
  onClose,
  onTrocado,
}: {
  comanda: ComandaMesa;
  mesaAtual: MesaComComandas;
  todasMesas: MesaComComandas[];
  onClose: () => void;
  onTrocado: () => void;
}) {
  const [mesaDestino, setMesaDestino] = useState<string>("");
  const [trocando, setTrocando] = useState(false);

  const mesasDisponiveis = todasMesas.filter(
    (m) => m.id !== mesaAtual.id && (m.status === "livre" || m.status === "atendimento")
  );

  async function confirmarTroca() {
    if (!mesaDestino) return toast.error("Selecione a mesa de destino");
    setTrocando(true);

    const destino = todasMesas.find((m) => m.id === mesaDestino)!;

    try {
      // 1. Atualiza o mesa_id da comanda
      const { error: errCmd } = await supabase
        .from("comandas")
        .update({ mesa_id: mesaDestino })
        .eq("id", comanda.id);

      if (errCmd) throw errCmd;

      // 2. Marca a mesa destino como ocupada
      await supabase.from("mesas").update({ status: "ocupada" }).eq("id", mesaDestino);

      // 3. Verifica se a mesa de origem ainda tem outras comandas
      const { data: restantes } = await supabase
        .from("comandas")
        .select("id")
        .eq("mesa_id", mesaAtual.id)
        .in("status", ["aberta", "fechando"])
        .neq("id", comanda.id);

      // Se não tem mais ninguém, libera a mesa de origem
      if (!restantes || restantes.length === 0) {
        await supabase.from("mesas").update({ status: "livre" }).eq("id", mesaAtual.id);
      }

      toast.success(
        `Comanda ${comanda.codigo} movida: Mesa ${mesaAtual.numero} → Mesa ${destino.numero}`
      );
      onTrocado();
      onClose();
    } catch (err: any) {
      toast.error("Erro ao trocar mesa: " + (err.message ?? err));
    }

    setTrocando(false);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <Card className="w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-lg">Trocar Mesa</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="rounded-lg border border-border bg-accent/30 p-3 mb-4">
          <p className="text-xs text-muted-foreground mb-0.5">Comanda sendo movida</p>
          <p className="font-bold font-mono">{comanda.codigo}</p>
          <p className="text-sm text-muted-foreground">{comanda.cliente_nome ?? "Avulso"}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Mesa atual: <span className="font-semibold text-foreground">Mesa {mesaAtual.numero}</span>
          </p>
        </div>

        <p className="text-sm font-medium mb-2">Selecione a mesa de destino:</p>

        {mesasDisponiveis.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4 bg-accent/20 rounded-lg">
            Nenhuma mesa livre disponível
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-1.5 max-h-52 overflow-y-auto mb-4">
            {mesasDisponiveis.map((m) => (
              <button
                key={m.id}
                onClick={() => setMesaDestino(m.id)}
                className={
                  "rounded-xl border py-3 text-sm font-bold transition active:scale-95 " +
                  (mesaDestino === m.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:border-primary")
                }
              >
                {m.numero}
              </button>
            ))}
          </div>
        )}

        <Button
          className="w-full h-11 font-semibold gap-2"
          onClick={confirmarTroca}
          disabled={trocando || !mesaDestino}
        >
          <ArrowLeftRight className="h-4 w-4" />
          {trocando ? "Trocando..." : "Confirmar troca"}
        </Button>
      </Card>
    </div>
  );
}

// ─── Modal: detalhes da mesa ─────────────────────────────────────────────────
function ModalMesaDetalhe({
  mesa,
  todasMesas,
  onClose,
  onReload,
}: {
  mesa: MesaComComandas;
  todasMesas: MesaComComandas[];
  onClose: () => void;
  onReload: () => void;
}) {
  const [trocando, setTrocando] = useState<ComandaMesa | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  async function excluirMesa() {
    if (!confirm(`Excluir Mesa ${mesa.numero}? Só é possível excluir mesas livres.`)) return;
    if (mesa.status !== "livre") {
      toast.error("Só é possível excluir mesas livres");
      return;
    }
    setExcluindo(true);
    const { error } = await supabase.from("mesas").delete().eq("id", mesa.id);
    if (error) {
      toast.error("Erro ao excluir: " + error.message);
    } else {
      toast.success(`Mesa ${mesa.numero} excluída`);
      onReload();
      onClose();
    }
    setExcluindo(false);
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
        onClick={onClose}
      >
        <Card
          className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-center sm:hidden mb-3">
            <div className="h-1 w-12 rounded-full bg-muted" />
          </div>

          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-bold text-xl">Mesa {mesa.numero}</h2>
              <Badge variant="secondary" className="mt-0.5 text-xs">
                {statusMap[mesa.status].label}
              </Badge>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
              <X className="h-5 w-5" />
            </button>
          </div>

          {mesa.status === "livre" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Mesa disponível, sem comandas abertas.</p>
              <button
                onClick={excluirMesa}
                disabled={excluindo}
                className="w-full flex items-center gap-2 justify-center rounded-xl border border-destructive/30 bg-destructive/10 text-destructive p-3 text-sm font-medium hover:bg-destructive/20 transition"
              >
                <Trash2 className="h-4 w-4" />
                {excluindo ? "Excluindo..." : "Excluir esta mesa"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground uppercase font-semibold mb-1">
                Comandas abertas ({mesa.comandas.length})
              </p>
              {mesa.comandas.map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-border p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold font-mono">{c.codigo}</p>
                      <p className="text-sm">{c.cliente_nome ?? "Avulso"}</p>
                      {c.funcionarios?.nome && (
                        <p className="text-xs text-muted-foreground">
                          Garçom: {c.funcionarios.nome.split(" ")[0]}
                        </p>
                      )}
                    </div>
                    <p className="font-bold text-primary shrink-0">
                      R$ {Number(c.total).toFixed(2).replace(".", ",")}
                    </p>
                  </div>
                  <button
                    onClick={() => setTrocando(c)}
                    className="w-full flex items-center gap-2 justify-center rounded-lg border border-border bg-accent/40 p-2 text-sm font-medium hover:border-primary transition"
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                    Trocar de mesa
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {trocando && (
        <ModalTrocarMesa
          comanda={trocando}
          mesaAtual={mesa}
          todasMesas={todasMesas}
          onClose={() => setTrocando(null)}
          onTrocado={() => { onReload(); onClose(); }}
        />
      )}
    </>
  );
}

// ─── Página principal ────────────────────────────────────────────────────────
function Mesas() {
  const [mesas, setMesas] = useState<MesaComComandas[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalNova, setModalNova] = useState(false);
  const [mesaSelecionada, setMesaSelecionada] = useState<MesaComComandas | null>(null);
  const [busca, setBusca] = useState("");

  async function load() {
    const { data: mesasData } = await supabase.from("mesas").select("*").order("numero");
    if (!mesasData) { setLoading(false); return; }

    const ocupadas = mesasData.filter((m) => m.status !== "livre").map((m) => m.id);
    const cmdPorMesa: Record<string, ComandaMesa[]> = {};

    if (ocupadas.length > 0) {
      const { data: cmds } = await supabase
        .from("comandas")
        .select("id, mesa_id, codigo, cliente_nome, total, solicitou_fechamento, funcionarios(nome)")
        .in("mesa_id", ocupadas)
        .eq("status", "aberta");

      if (cmds) {
        cmds.forEach((c: any) => {
          if (!cmdPorMesa[c.mesa_id]) cmdPorMesa[c.mesa_id] = [];
          cmdPorMesa[c.mesa_id].push({
            id: c.id,
            codigo: c.codigo,
            cliente_nome: c.cliente_nome,
            total: c.total,
            solicitou_fechamento: c.solicitou_fechamento,
            funcionarios: c.funcionarios,
          });
        });
      }
    }

    setMesas(mesasData.map((m) => ({ ...m, comandas: cmdPorMesa[m.id] ?? [] })));
    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("mesas-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "mesas" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "comandas" }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const mesasFiltradas = busca
    ? mesas.filter(
        (m) =>
          String(m.numero).includes(busca) ||
          m.comandas.some(
            (c) =>
              c.codigo.toLowerCase().includes(busca.toLowerCase()) ||
              (c.cliente_nome ?? "").toLowerCase().includes(busca.toLowerCase())
          )
      )
    : mesas;

  const proximoNumero = mesas.length > 0 ? Math.max(...mesas.map((m) => m.numero)) + 1 : 1;

  const resumo = {
    total: mesas.length,
    livres: mesas.filter((m) => m.status === "livre").length,
    ocupadas: mesas.filter((m) => m.status !== "livre").length,
  };

  return (
    <>
      <div className="flex items-center justify-between mb-1">
        <PageHeader title="Mesas" description="Gerencie mesas e comandas em tempo real" />
        <Button
          onClick={() => setModalNova(true)}
          className="gap-1.5 shrink-0"
          size="sm"
        >
          <Plus className="h-4 w-4" />
          Nova mesa
        </Button>
      </div>

      {/* Resumo */}
      <div className="flex gap-3 mb-4 text-sm flex-wrap">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-border border border-border" />
          {resumo.livres} livres
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-primary/60" />
          {resumo.ocupadas} ocupadas
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span className="font-semibold text-foreground">{resumo.total}</span> no total
        </div>
      </div>

      {/* Busca */}
      <div className="relative mb-4">
        <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por número, ficha ou cliente..."
          className="pl-9"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap gap-3 mb-4 text-xs">
        {(Object.keys(statusMap) as Status[]).map((k) => (
          <div key={k} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full border ${statusMap[k].cls}`} />
            <span className="text-muted-foreground">{statusMap[k].label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <ArrowLeftRight className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Clique para gerenciar / trocar mesa</span>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {[...Array(12)].map((_, i) => (
            <Card key={i} className="p-4 h-28 animate-pulse bg-accent/30" />
          ))}
        </div>
      ) : mesasFiltradas.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">
            {busca ? `Nenhuma mesa encontrada para "${busca}"` : "Nenhuma mesa cadastrada"}
          </p>
          {!busca && (
            <Button className="mt-4 gap-1.5" onClick={() => setModalNova(true)}>
              <Plus className="h-4 w-4" /> Criar primeira mesa
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {mesasFiltradas.map((m) => {
            const temFechamento = m.comandas.some((c) => c.solicitou_fechamento);
            const cls = temFechamento
              ? "border-destructive/50 bg-destructive/10"
              : statusMap[m.status].cls;

            return (
              <Card
                key={m.id}
                className={`p-3 transition cursor-pointer hover:scale-[1.02] hover:shadow-md ${cls}`}
                onClick={() => setMesaSelecionada(m)}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground font-medium">Mesa</span>
                    <span className="text-2xl font-bold leading-none">{m.numero}</span>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {temFechamento ? "Fechar" : statusMap[m.status].label}
                  </Badge>
                </div>

                {m.status === "livre" ? (
                  <p className="text-xs text-muted-foreground">Disponível</p>
                ) : m.comandas.length === 0 ? (
                  <p className="text-xs text-muted-foreground capitalize">{m.status}</p>
                ) : (
                  <div className="space-y-1.5 mt-1">
                    {m.comandas.slice(0, 2).map((c, idx) => (
                      <div key={c.id} className={`text-xs ${idx > 0 ? "pt-1.5 border-t border-border/50" : ""}`}>
                        <p className="font-mono font-bold text-sm leading-tight">{c.codigo}</p>
                        <p className="font-semibold text-sm truncate">{c.cliente_nome ?? "Avulso"}</p>
                        <p className="text-primary font-bold mt-0.5">
                          R$ {Number(c.total).toFixed(2).replace(".", ",")}
                        </p>
                      </div>
                    ))}
                    {m.comandas.length > 2 && (
                      <p className="text-[10px] text-warning-foreground bg-warning/20 px-1.5 py-0.5 rounded-full text-center font-semibold">
                        +{m.comandas.length - 2} comandas
                      </p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal nova mesa */}
      {modalNova && (
        <ModalNovaMesa
          proximoNumero={proximoNumero}
          onClose={() => setModalNova(false)}
          onSalvo={load}
        />
      )}

      {/* Modal detalhes/troca */}
      {mesaSelecionada && (
        <ModalMesaDetalhe
          mesa={mesaSelecionada}
          todasMesas={mesas}
          onClose={() => setMesaSelecionada(null)}
          onReload={load}
        />
      )}
    </>
  );
}
