import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { fazerLogin, carregarSessao } from "@/lib/db";
import { RefreshCw, WifiOff } from "lucide-react";

export const Route = createFileRoute("/")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    // Verifica sessão salva
    const sessao = carregarSessao();
    if (sessao?.id) {
      if (sessao.funcao === "garcom") navigate({ to: "/garcom" });
      else navigate({ to: "/dashboard" });
    }

    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  async function login() {
    if (!usuario.trim() || !senha.trim()) {
      toast.error("Preencha usuário e senha");
      return;
    }
    setLoading(true);
    try {
      const sessao = await fazerLogin(usuario.trim(), senha.trim());
      if (!sessao) {
        toast.error("Usuário ou senha incorretos");
        return;
      }
      if (sessao.funcao === "garcom") navigate({ to: "/garcom" });
      else navigate({ to: "/dashboard" });
    } catch {
      toast.error("Erro de conexão. Verifique sua internet.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <img src="/logo.jpg" alt="Logo" className="h-20 w-20 rounded-2xl mx-auto mb-4 object-cover shadow-lg"
            onError={e => (e.currentTarget.style.display = "none")} />
          <h1 className="text-2xl font-bold">Sistema PDV</h1>
          <p className="text-sm text-muted-foreground mt-1">Faça login para continuar</p>
        </div>

        {offline && (
          <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 text-destructive rounded-xl px-4 py-3 text-sm">
            <WifiOff className="h-4 w-4 shrink-0" />
            Sem conexão com internet
          </div>
        )}

        <Card className="p-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="usuario">Usuário</Label>
            <Input
              id="usuario"
              placeholder="seu.usuario"
              value={usuario}
              onChange={e => setUsuario(e.target.value)}
              onKeyDown={e => e.key === "Enter" && login()}
              autoComplete="username"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="senha">Senha</Label>
            <Input
              id="senha"
              type="password"
              placeholder="••••••••"
              value={senha}
              onChange={e => setSenha(e.target.value)}
              onKeyDown={e => e.key === "Enter" && login()}
              autoComplete="current-password"
            />
          </div>
          <Button className="w-full h-11 font-semibold" onClick={login} disabled={loading}>
            {loading ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Entrando...</> : "Entrar"}
          </Button>
        </Card>

        <p className="text-xs text-center text-muted-foreground">
          Padrão: admin / admin123
        </p>
      </div>
    </div>
  );
}
