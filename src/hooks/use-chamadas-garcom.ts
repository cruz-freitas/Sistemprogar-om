/**
 * use-chamadas-garcom.ts
 * Canal Realtime singleton — evita erro de múltiplos subscribe()
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { atenderChamada, atenderTodasChamadas, getChamadasPendentes } from "@/lib/db";

export type ChamadaPendente = {
  id: string;
  mesa_numero: number;
  mesa_id: string | null;
  cliente_nome: string | null;
  codigo_comanda: string | null;
  created_at: string;
  status: string;
};

// ─── Singleton global ─────────────────────────────────────────────────────────
type Listener = (chamadas: ChamadaPendente[], novas: ChamadaPendente[]) => void;

let _chamadas: ChamadaPendente[] = [];
let _novas: ChamadaPendente[] = [];
let _listeners: Listener[] = [];
let _canal: ReturnType<typeof supabase.channel> | null = null;
let _iniciado = false;

function notificar() {
  _listeners.forEach(fn => fn([..._chamadas], [..._novas]));
}

function tocarAlerta() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    let t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.start(t);
      osc.stop(t + 0.3);
      t += 0.4;
    }
  } catch {}
}

function iniciarCanal() {
  if (_iniciado) return;
  _iniciado = true;

  // Carrega pendentes iniciais
  getChamadasPendentes().then(data => {
    _chamadas = data as ChamadaPendente[];
    notificar();
  });

  // Cria canal com listeners ANTES do subscribe
  _canal = supabase.channel("chamadas-garcom-realtime");

  _canal.on(
    "postgres_changes" as any,
    { event: "INSERT", schema: "public", table: "chamadas_garcom" },
    (payload: any) => {
      const nova = payload.new as ChamadaPendente;
      if (nova.status !== "pendente") return;

      if (!_chamadas.find(c => c.id === nova.id)) {
        _chamadas = [..._chamadas, nova];
      }
      if (!_novas.find(c => c.id === nova.id)) {
        _novas = [..._novas, nova];
      }
      notificar();
      tocarAlerta();

      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(`🔔 Mesa ${nova.mesa_numero} chamando!`, {
          body: nova.cliente_nome ?? "Toque para atender",
          icon: "/icon-192x192.png",
        });
      }

      setTimeout(() => {
        _novas = _novas.filter(c => c.id !== nova.id);
        notificar();
      }, 25000);
    }
  );

  _canal.on(
    "postgres_changes" as any,
    { event: "UPDATE", schema: "public", table: "chamadas_garcom" },
    (payload: any) => {
      const u = payload.new as { id: string; status: string };
      if (u.status !== "pendente") {
        _chamadas = _chamadas.filter(c => c.id !== u.id);
        _novas = _novas.filter(c => c.id !== u.id);
        notificar();
      }
    }
  );

  _canal.subscribe();
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useChamadasGarcom() {
  const [chamadas, setChamadas] = useState<ChamadaPendente[]>(_chamadas);
  const [novasChamadas, setNovasChamadas] = useState<ChamadaPendente[]>(_novas);

  useEffect(() => {
    iniciarCanal();

    const listener: Listener = (c, n) => {
      setChamadas(c);
      setNovasChamadas(n);
    };
    _listeners.push(listener);

    // Sincroniza estado atual
    setChamadas([..._chamadas]);
    setNovasChamadas([..._novas]);

    return () => {
      _listeners = _listeners.filter(l => l !== listener);
    };
  }, []);

  const atender = useCallback(async (id: string) => {
    const sessaoRaw = localStorage.getItem("sp_session_v2") || sessionStorage.getItem("sp_session_v2");
    const sessaoId = sessaoRaw ? JSON.parse(sessaoRaw)?.id : null;
    await atenderChamada(id, sessaoId);
    _chamadas = _chamadas.filter(c => c.id !== id);
    _novas = _novas.filter(c => c.id !== id);
    notificar();
  }, []);

  const atenderTodas = useCallback(async () => {
    const sessaoRaw = localStorage.getItem("sp_session_v2") || sessionStorage.getItem("sp_session_v2");
    const sessaoId = sessaoRaw ? JSON.parse(sessaoRaw)?.id : null;
    await atenderTodasChamadas(sessaoId);
    _chamadas = [];
    _novas = [];
    notificar();
  }, []);

  const pedirPermissao = useCallback(async () => {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    return (await Notification.requestPermission()) === "granted";
  }, []);

  const recarregar = useCallback(async () => {
    const data = await getChamadasPendentes();
    _chamadas = data as ChamadaPendente[];
    notificar();
  }, []);

  return {
    chamadas,
    novasChamadas,
    totalPendentes: chamadas.length,
    temChamada: chamadas.length > 0,
    atender,
    atenderTodas,
    pedirPermissao,
    recarregar,
  };
}
