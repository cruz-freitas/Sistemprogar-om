import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { iniciarSync, rehydratar } from "./lib/sync-engine";
import "./styles.css";

// Inicia motor de sync ao carregar o app
iniciarSync();

// Recarrega dados frescos ao iniciar se online
window.addEventListener("bb:rehydrate", () => rehydratar());
if (navigator.onLine) rehydratar();

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router; }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
