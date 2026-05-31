import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, X, Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase, type Funcionario } from "@/lib/supabase";
import { toast } from "sonner";

export const Route = createFileRoute("/garcons")({
  component: Garcons,
});

const FORM_VAZIO = {
  nome: "",
  usuario: "",
  senha: "",
  funcao: "garcom" as Funcionario["funcao"],
  ativo: true,
};

const FUNCAO_LABEL: Record<Funcionario["funcao"], string> = {
  admin: "Administrador",
  caixa: "Caixa",
  garcom: "Garçom",
};

const FUNCAO_COR: Record<Funcionario["funcao"], string> = {
  admin: "bg-destructive/15 text-destructive",
  caixa: "bg-primary/15 text-primary",
  garcom: "bg-accent text-accent-foreground",
};

function Garcons() {
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [modalExcluir, setModalExcluir] = useState<Funcionario | null>(null);
  const [editando, setEditando] = useState<Funcionario | null>(null);
  const [form, setForm] = useState(FORM_VAZIO);
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [saving, setSaving] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  async function load() {
    const { data } = await supabase.from("funcionarios").select("*").order("nome");
    if (data) setFuncionarios(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function abrirModal(f?: Funcionario) {
    if (f) {
      setEditando(f);
      setForm({ nome: f.nome, usuario: f.usuario, senha: "", funcao: f.funcao, ativo: f.ativo });
    } else {
      setEditando(null);
      setForm(FORM_VAZIO);
    }
    setMostrarSenha(false);
    setModal(true);
  }

  async function salvar() {
    if (!form.nome.trim() || !form.usuario.trim()) return toast.error("Nome e usuário obrigatórios");
    if (!editando && !form.senha.trim()) return toast.error("Senha obrigatória para novo funcionário");
    setSaving(true);

    const payload: Record<string, unknown> = {
      nome: form.nome.trim(),
      usuario: form.usuario.trim().toLowerCase(),
      funcao: form.funcao,
      ativo: form.ativo,
    };

    // Gera hash SHA-256 da senha antes de salvar
    if (form.senha.trim()) {
      const encoder = new TextEncoder();
      const data = encoder.encode(form.senha.trim());
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      payload.senha_hash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    }

    const { error } = editando
      ? await supabase.from("funcionarios").update(payload).eq("id", editando.id)
      : await supabase.from("funcionarios").insert(payload);

    if (error) toast.error(error.message.includes("unique") ? "Usuário já existe" : "Erro ao salvar");
    else { toast.success(editando ? "Funcionário atualizado" : "Funcionário criado"); setModal(false); load(); }
    setSaving(false);
  }

  async function excluir() {
    if (!modalExcluir) return;
    setExcluindo(true);
    const { error } = await supabase.from("funcionarios").delete().eq("id", modalExcluir.id);
    if (error) toast.error("Erro ao excluir. Verifique se há comandas vinculadas.");
    else { toast.success("Funcionário removido"); setModalExcluir(null); load(); }
    setExcluindo(false);
  }

  // Usuário logado (para não deixar excluir a si mesmo)
  const sessao = (() => {
    try { return JSON.parse(localStorage.getItem("sp_session_v2") || sessionStorage.getItem("sp_session_v2") || "{}"); } catch { return {}; }
  })();

  return (
    <>
      <PageHeader
        title="Garçons & Funcionários"
        description="Gestão de equipe e níveis de acesso"
        actions={<Button onClick={() => abrirModal()}><Plus className="h-4 w-4 mr-1" />Novo usuário</Button>}
      />

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(5)].map((_, i) => <Card key={i} className="p-5 h-32 animate-pulse bg-accent/30" />)}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {funcionarios.map((g) => (
            <Card key={g.id} className="p-5">
              <div className="flex items-start gap-3 mb-3">
                <div className="h-12 w-12 rounded-full bg-primary/15 text-primary flex items-center justify-center font-semibold text-sm">
                  {g.nome.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{g.nome}</p>
                  <p className="text-xs text-muted-foreground">@{g.usuario}</p>
                  <span className={`inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${FUNCAO_COR[g.funcao]}`}>
                    {FUNCAO_LABEL[g.funcao]}
                  </span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => abrirModal(g)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    disabled={g.id === sessao.id}
                    onClick={() => setModalExcluir(g)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="pt-3 border-t border-border flex items-center justify-between">
                <Badge variant={g.ativo ? "default" : "outline"}>{g.ativo ? "Ativo" : "Inativo"}</Badge>
                {g.id === sessao.id && (
                  <span className="text-xs text-muted-foreground">você</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal criar / editar */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">{editando ? "Editar funcionário" : "Novo funcionário"}</h2>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setModal(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-3">
              <div>
                <Label>Nome completo</Label>
                <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Carlos Silva" />
              </div>
              <div>
                <Label>Usuário (login)</Label>
                <Input value={form.usuario} onChange={(e) => setForm({ ...form, usuario: e.target.value })} placeholder="Ex: carlos" />
              </div>
              <div>
                <Label>{editando ? "Nova senha (deixe em branco para manter)" : "Senha"}</Label>
                <div className="relative">
                  <Input
                    type={mostrarSenha ? "text" : "password"}
                    value={form.senha}
                    onChange={(e) => setForm({ ...form, senha: e.target.value })}
                    placeholder={editando ? "••••••••" : "Mínimo 4 caracteres"}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarSenha(!mostrarSenha)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {mostrarSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label>Função</Label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-input px-3 text-sm"
                  value={form.funcao}
                  onChange={(e) => setForm({ ...form, funcao: e.target.value as Funcionario["funcao"] })}
                >
                  <option value="garcom">Garçom</option>
                  <option value="caixa">Caixa</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
                <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
                Funcionário ativo
              </label>
            </div>

            <div className="flex gap-2 mt-5 justify-end">
              <Button variant="outline" onClick={() => setModal(false)}>Cancelar</Button>
              <Button onClick={salvar} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Modal confirmar exclusão */}
      {modalExcluir && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-sm p-6">
            <h2 className="font-semibold mb-2">Excluir funcionário</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Tem certeza que deseja excluir <strong>{modalExcluir.nome}</strong>? Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setModalExcluir(null)}>Cancelar</Button>
              <Button variant="destructive" onClick={excluir} disabled={excluindo}>
                {excluindo ? "Excluindo..." : "Excluir"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
