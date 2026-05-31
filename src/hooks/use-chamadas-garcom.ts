/**
 * use-chamadas-garcom.ts
 * Hook robusto para chamadas de garçom via Realtime do Supabase.
 * Toca alerta sonoro e mostra notificação em todos os dispositivos conectados.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { atenderChamada, atenderTodasChamadas, getChamadasPendentes } from "@/lib/db";

export type ChamadaPendente = {
  id: string;
  mesa_numero: number;
  mesa_id: string | null;
  cliente_nome: string | null;
  codigo_comanda: string | null;
  created_at: string;
};

// Toca som de alerta
function tocarAlerta(vezes = 3) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    let t = ctx.currentTime;
    for (let i = 0; i < vezes; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.start(t);
      osc.stop(t + 0.3);
      t += 0.4;
    }
  } catch {}
}

export function useChamadasGarcom() {
  const [chamadas, setChamadas] = useState<ChamadaPendente[]>([]);
  const [novasChamadas, setNovasChamadas] = useState<ChamadaPendente[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const sessaoId = useRef<string | null>(null);

  // Carrega sessão
  useEffect(() => {
    try {
      const raw = localStorage.getItem("sp_session_v2") || sessionStorage.getItem("sp_session_v2");
      if (raw) sessaoId.current = JSON.parse(raw)?.id ?? null;
    } catch {}
  }, []);

  const carregar = useCallback(async () => {
    const data = await getChamadasPendentes();
    setChamadas(data as ChamadaPendente[]);
  }, []);

  useEffect(() => {
    carregar();

    // Realtime: escuta novas chamadas
    const channel = supabase
      .channel("chamadas-garcom-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chamadas_garcom" },
        (payload) => {
          const nova = payload.new as ChamadaPendente;
          if (nova.status !== "pendente") return; // já nasceu atendida
          
          setChamadas(prev => prev.find(c => c.id === nova.id) ? prev : [...prev, nova]);
          setNovasChamadas(prev => [...prev, nova]);
          tocarAlerta(3);

          // Notificação do browser
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification(`🔔 Mesa ${nova.mesa_numero} está chamando!`, {
              body: nova.cliente_nome ? `Cliente: ${nova.cliente_nome}` : "Toque para atender",
              icon: "/icon-192x192.png",
            });
          }

          // Remove da lista de "novas" após 25s
          setTimeout(() => {
            setNovasChamadas(prev => prev.filter(c => c.id !== nova.id));
          }, 25000);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chamadas_garcom" },
        (payload) => {
          const updated = payload.new as { id: string; status: string };
          if (updated.status !== "pendente") {
            setChamadas(prev => prev.filter(c => c.id !== updated.id));
            setNovasChamadas(prev => prev.filter(c => c.id !== updated.id));
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
    };
  }, [carregar]);

  const atender = useCallback(async (id: string) => {
    await atenderChamada(id, sessaoId.current);
    setChamadas(prev => prev.filter(c => c.id !== id));
    setNovasChamadas(prev => prev.filter(c => c.id !== id));
  }, []);

  const atenderTodas = useCallback(async () => {
    await atenderTodasChamadas(sessaoId.current);
    setChamadas([]);
    setNovasChamadas([]);
  }, []);

  const pedirPermissao = useCallback(async () => {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    const result = await Notification.requestPermission();
    return result === "granted";
  }, []);

  return {
    chamadas,
    novasChamadas,
    totalPendentes: chamadas.length,
    temChamada: chamadas.length > 0,
    atender,
    atenderTodas,
    pedirPermissao,
    recarregar: carregar,
  };
}
