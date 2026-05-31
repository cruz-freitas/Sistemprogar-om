import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { AppSidebar } from "@/components/AppSidebar";
import { useRouterState } from "@tanstack/react-router";
import { ChamadaToast } from "@/components/ChamadaGarcomAlert";

export const Route = createRootRoute({
  component: Root,
});

const ROUTES_SEM_SIDEBAR = ["/", "/garcom", "/cardapio"];

function Root() {
  const routerState = useRouterState();
  const path = routerState.location.pathname;
  const semSidebar = ROUTES_SEM_SIDEBAR.includes(path);

  if (semSidebar) {
    return (
      <>
        <Outlet />
        <Toaster richColors position="top-center" />
      </>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto bg-background">
        <ChamadaToast />
        <Outlet />
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
