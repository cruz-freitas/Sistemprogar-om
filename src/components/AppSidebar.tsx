import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, ClipboardList, Armchair, Package, Tag,
  Users, Printer, Settings, LogOut, DollarSign, BarChart3,
  Bell, BookOpen, Warehouse, ShieldCheck
} from "lucide-react";
import { limparSessao, carregarSessao } from "@/lib/db";
import { useChamadasGarcom } from "@/hooks/use-chamadas-garcom";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/comandas", label: "Comandas", icon: ClipboardList },
  { to: "/mesas", label: "Mesas", icon: Armchair },
  { to: "/caixa", label: "Caixa", icon: DollarSign },
  { to: "/cardapio", label: "Cardápio", icon: BookOpen, target: "_blank" },
  { to: "/produtos", label: "Produtos", icon: Package },
  { to: "/categorias", label: "Categorias", icon: Tag },
  { to: "/estoque", label: "Estoque", icon: Warehouse },
  { to: "/garcons", label: "Garçons", icon: Users },
  { to: "/impressoras", label: "Impressoras", icon: Printer },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { to: "/auditoria", label: "Auditoria", icon: ShieldCheck },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

export function AppSidebar() {
  const navigate = useNavigate();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const sessao = carregarSessao();
  const { totalPendentes, novasChamadas } = useChamadasGarcom();

  function sair() {
    limparSessao();
    navigate({ to: "/" });
  }

  return (
    <aside className="flex flex-col h-full bg-sidebar border-r border-sidebar-border w-64 shrink-0">
      {/* Logo */}
      <div className="p-4 border-b border-sidebar-border flex items-center gap-3">
        <img src="/logo.jpg" alt="Logo" className="h-9 w-9 rounded-xl object-cover"
          onError={e => (e.currentTarget.style.display = "none")} />
        <div>
          <p className="font-bold text-sm">Sistema PDV</p>
          <p className="text-xs text-sidebar-foreground/60">{sessao?.nome}</p>
        </div>
      </div>

      {/* Chamadas pendentes */}
      {totalPendentes > 0 && (
        <Link to="/dashboard"
          className={"mx-3 mt-3 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold " + (novasChamadas.length > 0 ? "bg-amber-500 text-white animate-pulse" : "bg-amber-500/20 text-amber-500 border border-amber-500/30")}>
          <Bell className="h-4 w-4" />
          {totalPendentes} mesa{totalPendentes > 1 ? "s" : ""} chamando
        </Link>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {navItems.map(({ to, label, icon: Icon, target }) => {
          const ativo = currentPath === to;
          return (
            <Link
              key={to}
              to={to as any}
              target={target}
              className={"flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition " +
                (ativo ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-sidebar-border">
        <button onClick={sair}
          className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent transition">
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </aside>
  );
}
