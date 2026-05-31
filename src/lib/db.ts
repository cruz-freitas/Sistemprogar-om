/**
 * db.ts — Camada de dados simplificada e robusta
 * 
 * Princípios:
 * - Direto ao Supabase (sem fila offline complexa que causava problemas)
 * - Retry automático em caso de falha de rede
 * - Cache local no localStorage apenas para dados estáticos (produtos, categorias)
 * - Realtime do Supabase para mesas, comandas e chamadas
 */

import { supabase } from "./supabase";
import type { Mesa, Comanda, ComandaItem, Produto, Categoria, Funcionario } from "./supabase";

// ─── Sessão ───────────────────────────────────────────────────────────────────

const SESSION_KEY = "sp_session_v2";

export type Sessao = {
  id: string;
  nome: string;
  usuario: string;
  funcao: "admin" | "caixa" | "garcom";
};

export function salvarSessao(s: Sessao) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function carregarSessao(): Sessao | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function limparSessao() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

// ─── Login ───────────────────────────────────────────────────────────────────

export async function fazerLogin(usuario: string, senha: string): Promise<Sessao | null> {
  // Hash SHA-256 da senha
  const encoder = new TextEncoder();
  const data = encoder.encode(senha);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const senhaHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

  const { data: func, error } = await supabase
    .from("funcionarios")
    .select("id, nome, usuario, funcao")
    .eq("usuario", usuario)
    .eq("senha_hash", senhaHash)
    .eq("ativo", true)
    .single();

  if (error || !func) return null;

  const sessao: Sessao = {
    id: func.id,
    nome: func.nome,
    usuario: func.usuario,
    funcao: func.funcao as Sessao["funcao"],
  };
  salvarSessao(sessao);
  return sessao;
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

async function comRetry<T>(fn: () => Promise<T>, tentativas = 3): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimo = err;
      if (i < tentativas - 1) await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw ultimo;
}

// ─── Mesas ────────────────────────────────────────────────────────────────────

export async function getMesasComComandas(): Promise<Array<Mesa & { comandas: Comanda[] }>> {
  return comRetry(async () => {
    const { data: mesas, error: e1 } = await supabase
      .from("mesas")
      .select("*")
      .order("numero");
    if (e1) throw e1;
    if (!mesas) return [];

    const ocupadas = mesas.filter(m => m.status !== "livre").map(m => m.id);

    if (ocupadas.length === 0) {
      return mesas.map(m => ({ ...m, comandas: [] }));
    }

    const { data: comandas } = await supabase
      .from("comandas")
      .select("id, codigo, cliente_nome, total, solicitou_fechamento, mesa_id, status, subtotal, taxa_servico, aberta_em, funcionario_id, fechada_em, created_at")
      .in("mesa_id", ocupadas)
      .eq("status", "aberta");

    const cmdMap: Record<string, Comanda[]> = {};
    (comandas ?? []).forEach((c: Comanda) => {
      if (c.mesa_id) {
        if (!cmdMap[c.mesa_id]) cmdMap[c.mesa_id] = [];
        cmdMap[c.mesa_id].push(c);
      }
    });

    return mesas.map(m => ({ ...m, comandas: cmdMap[m.id] ?? [] }));
  });
}

export async function atualizarStatusMesa(id: string, status: Mesa["status"]) {
  return comRetry(async () => {
    const { error } = await supabase.from("mesas").update({ status }).eq("id", id);
    if (error) throw error;
  });
}

// ─── Comandas ─────────────────────────────────────────────────────────────────

export async function verificarFicha(codigo: string): Promise<"disponivel" | "ocupada"> {
  const { data } = await supabase
    .from("comandas")
    .select("id")
    .eq("codigo", codigo)
    .eq("status", "aberta")
    .limit(1);
  return (data && data.length > 0) ? "ocupada" : "disponivel";
}

export async function abrirComanda(params: {
  codigo: string;
  mesa_id: string;
  cliente_nome: string;
  funcionario_id: string;
}): Promise<Comanda> {
  return comRetry(async () => {
    // Abre a comanda
    const { data, error } = await supabase
      .from("comandas")
      .insert({
        codigo: params.codigo,
        mesa_id: params.mesa_id,
        cliente_nome: params.cliente_nome,
        funcionario_id: params.funcionario_id,
        status: "aberta",
        subtotal: 0,
        taxa_servico: 0,
        total: 0,
      })
      .select()
      .single();
    if (error) throw error;

    // Marca mesa como ocupada
    await supabase.from("mesas").update({ status: "ocupada" }).eq("id", params.mesa_id);

    return data as Comanda;
  });
}

export async function inserirItens(comandaId: string, itens: Array<{
  produto_id: string;
  nome_produto: string;
  preco_unit: number;
  quantidade: number;
}>): Promise<void> {
  return comRetry(async () => {
    const rows = itens.map(i => ({
      comanda_id: comandaId,
      produto_id: i.produto_id,
      nome_produto: i.nome_produto,
      preco_unit: i.preco_unit,
      quantidade: i.quantidade,
      total: +(i.preco_unit * i.quantidade).toFixed(2),
      cancelado: false,
    }));

    const { error } = await supabase.from("comanda_itens").insert(rows);
    if (error) throw error;
    // O trigger do banco já atualiza o total da comanda automaticamente
  });
}

export async function getItensDaComanda(comandaId: string): Promise<ComandaItem[]> {
  const { data, error } = await supabase
    .from("comanda_itens")
    .select("*")
    .eq("comanda_id", comandaId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as ComandaItem[];
}

export async function solicitarFechamento(comandaId: string): Promise<void> {
  return comRetry(async () => {
    const { error } = await supabase
      .from("comandas")
      .update({ solicitou_fechamento: true, status: "fechando" })
      .eq("id", comandaId);
    if (error) throw error;
  });
}

export async function fecharComanda(comandaId: string, formaPagamento: string): Promise<void> {
  return comRetry(async () => {
    // Pega o total atual
    const { data: cmd } = await supabase
      .from("comandas")
      .select("total, mesa_id")
      .eq("id", comandaId)
      .single();

    const { error } = await supabase
      .from("comandas")
      .update({
        status: "fechada",
        forma_pagamento: formaPagamento,
        fechada_em: new Date().toISOString(),
      })
      .eq("id", comandaId);
    if (error) throw error;

    // Libera a mesa se não há mais comandas abertas
    if (cmd?.mesa_id) {
      const { data: outras } = await supabase
        .from("comandas")
        .select("id")
        .eq("mesa_id", cmd.mesa_id)
        .in("status", ["aberta", "fechando"])
        .neq("id", comandaId);
      if (!outras || outras.length === 0) {
        await supabase.from("mesas").update({ status: "livre" }).eq("id", cmd.mesa_id);
      }
    }
  });
}

export async function cancelarComanda(comandaId: string): Promise<void> {
  return comRetry(async () => {
    const { data: cmd } = await supabase
      .from("comandas")
      .select("mesa_id")
      .eq("id", comandaId)
      .single();

    const { error } = await supabase
      .from("comandas")
      .update({ status: "cancelada" })
      .eq("id", comandaId);
    if (error) throw error;

    if (cmd?.mesa_id) {
      const { data: outras } = await supabase
        .from("comandas")
        .select("id")
        .eq("mesa_id", cmd.mesa_id)
        .in("status", ["aberta", "fechando"])
        .neq("id", comandaId);
      if (!outras || outras.length === 0) {
        await supabase.from("mesas").update({ status: "livre" }).eq("id", cmd.mesa_id);
      }
    }
  });
}

// ─── Produtos e Categorias ────────────────────────────────────────────────────

const CACHE_PRODUTOS_KEY = "sp_cache_produtos";
const CACHE_CAT_KEY = "sp_cache_categorias";
const CACHE_TTL = 5 * 60 * 1000; // 5 min

export async function getProdutos(): Promise<Produto[]> {
  // Tenta cache
  try {
    const cached = localStorage.getItem(CACHE_PRODUTOS_KEY);
    if (cached) {
      const { ts, data } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL) return data;
    }
  } catch {}

  const { data, error } = await supabase
    .from("produtos")
    .select("*, categorias(nome)")
    .eq("ativo", true)
    .order("nome");

  if (error) {
    // Retorna cache antigo se houver
    try {
      const cached = localStorage.getItem(CACHE_PRODUTOS_KEY);
      if (cached) return JSON.parse(cached).data;
    } catch {}
    return [];
  }

  try {
    localStorage.setItem(CACHE_PRODUTOS_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
  return (data ?? []) as Produto[];
}

export async function getCategorias(): Promise<Categoria[]> {
  try {
    const cached = localStorage.getItem(CACHE_CAT_KEY);
    if (cached) {
      const { ts, data } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL) return data;
    }
  } catch {}

  const { data, error } = await supabase
    .from("categorias")
    .select("*")
    .eq("ativo", true)
    .order("nome");

  if (error) {
    try {
      const cached = localStorage.getItem(CACHE_CAT_KEY);
      if (cached) return JSON.parse(cached).data;
    } catch {}
    return [];
  }

  try {
    localStorage.setItem(CACHE_CAT_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
  return (data ?? []) as Categoria[];
}

export function invalidarCacheProdutos() {
  localStorage.removeItem(CACHE_PRODUTOS_KEY);
  localStorage.removeItem(CACHE_CAT_KEY);
}

// ─── Chamadas de garçom ───────────────────────────────────────────────────────

export async function chamarGarcom(params: {
  mesa_id: string;
  mesa_numero: number;
  cliente_nome?: string;
  codigo_comanda?: string;
}): Promise<void> {
  return comRetry(async () => {
    const { error } = await supabase.from("chamadas_garcom").insert({
      mesa_id: params.mesa_id,
      mesa_numero: params.mesa_numero,
      cliente_nome: params.cliente_nome ?? null,
      codigo_comanda: params.codigo_comanda ?? null,
      status: "pendente",
    });
    if (error) throw error;
  });
}

export async function atenderChamada(id: string, funcionarioId?: string | null): Promise<void> {
  const { error } = await supabase
    .from("chamadas_garcom")
    .update({
      status: "atendida",
      atendida_por: funcionarioId ?? null,
      atendida_em: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function atenderTodasChamadas(funcionarioId?: string | null): Promise<void> {
  const { error } = await supabase
    .from("chamadas_garcom")
    .update({
      status: "atendida",
      atendida_por: funcionarioId ?? null,
      atendida_em: new Date().toISOString(),
    })
    .eq("status", "pendente");
  if (error) throw error;
}

export async function getChamadasPendentes() {
  const { data } = await supabase
    .from("chamadas_garcom")
    .select("*")
    .eq("status", "pendente")
    .order("created_at", { ascending: true });
  return data ?? [];
}
