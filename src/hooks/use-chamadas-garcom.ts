/**
 * use-chamadas-garcom.ts — Singleton global com histórico
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

export type ChamadaHistorico = ChamadaPendente & {
  atendida_em: string | null;
};

// ─── Singleton global ─────────────────────────────────────────────────────────
type Listener = (chamadas: ChamadaPendente[], novas: ChamadaPendente[], historico: ChamadaHistorico[]) => void;

let _chamadas: ChamadaPendente[] = [];
let _novas: ChamadaPendente[] = [];
let _historico: ChamadaHistorico[] = [];
let _listeners: Listener[] = [];
let _canal: ReturnType<typeof supabase.channel> | null = null;
let _iniciado = false;

function notificar() {
  _listeners.forEach(fn => fn([..._chamadas], [..._novas], [..._historico]));
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

async function carregarHistorico() {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const { data } = await supabase
    .from("chamadas_garcom")
    .select("*")
    .gte("created_at", hoje.toISOString())
    .order("created_at", { ascending: false })
    .limit(100);
  _historico = (data ?? []) as ChamadaHistorico[];
}

function iniciarCanal() {
  if (_iniciado) return;
  _iniciado = true;

  getChamadasPendentes().then(data => {
    _chamadas = data as ChamadaPendente[];
    notificar();
  });

  carregarHistorico().then(notificar);

  _canal = supabase.channel("chamadas-garcom-realtime");

  _canal.on("postgres_changes" as any, { event: "INSERT", schema: "public", table: "chamadas_garcom" }, (payload: any) => {
    const nova = payload.new as ChamadaPendente;
    if (nova.status !== "pendente") return;

    if (!_chamadas.find(c => c.id === nova.id)) _chamadas = [..._chamadas, nova];
    if (!_novas.find(c => c.id === nova.id)) _novas = [..._novas, nova];

    // Adiciona ao histórico do dia
    if (!_historico.find(c => c.id === nova.id)) {
      _historico = [{ ...nova, atendida_em: null }, ..._historico];
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
  });

  _canal.on("postgres_changes" as any, { event: "UPDATE", schema: "public", table: "chamadas_garcom" }, (payload: any) => {
    const u = payload.new as ChamadaHistorico;
    if (u.status !== "pendente") {
      _chamadas = _chamadas.filter(c => c.id !== u.id);
      _novas = _novas.filter(c => c.id !== u.id);
      // Atualiza histórico com horário de atendimento
      _historico = _historico.map(c => c.id === u.id ? { ...c, status: u.status, atendida_em: u.atendida_em } : c);
      notificar();
    }
  });

  _canal.subscribe();
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useChamadasGarcom() {
  const [chamadas, setChamadas] = useState<ChamadaPendente[]>(_chamadas);
  const [novasChamadas, setNovasChamadas] = useState<ChamadaPendente[]>(_novas);
  const [historico, setHistorico] = useState<ChamadaHistorico[]>(_historico);

  useEffect(() => {
    iniciarCanal();

    const listener: Listener = (c, n, h) => {
      setChamadas(c);
      setNovasChamadas(n);
      setHistorico(h);
    };
    _listeners.push(listener);
    setChamadas([..._chamadas]);
    setNovasChamadas([..._novas]);
    setHistorico([..._historico]);

    return () => { _listeners = _listeners.filter(l => l !== listener); };
  }, []);

  const getSessaoId = () => {
    try {
      const raw = localStorage.getItem("sp_session_v2") || sessionStorage.getItem("sp_session_v2");
      return raw ? JSON.parse(raw)?.id : null;
    } catch { return null; }
  };

  const atender = useCallback(async (id: string) => {
    await atenderChamada(id, getSessaoId());
    _chamadas = _chamadas.filter(c => c.id !== id);
    _novas = _novas.filter(c => c.id !== id);
    _historico = _historico.map(c => c.id === id ? { ...c, status: "atendida", atendida_em: new Date().toISOString() } : c);
    notificar();
  }, []);

  const atenderTodas = useCallback(async () => {
    await atenderTodasChamadas(getSessaoId());
    const agora = new Date().toISOString();
    _historico = _historico.map(c => c.status === "pendente" ? { ...c, status: "atendida", atendida_em: agora } : c);
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
    await carregarHistorico();
    notificar();
  }, []);

  return {
    chamadas,
    novasChamadas,
    historico,
    totalPendentes: chamadas.length,
    temChamada: chamadas.length > 0,
    atender,
    atenderTodas,
    pedirPermissao,
    recarregar,
  };
}
