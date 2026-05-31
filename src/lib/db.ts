/**
 * db.ts — Camada de dados offline-first
 * 
 * FLUXO:
 * 1. Toda operação salva LOCAL (IndexedDB) imediatamente → UI responde na hora
 * 2. Se online → tenta enviar ao Supabase em paralelo
 * 3. Se offline → enfileira para sync posterior
 * 4. Ao reconectar → processa fila em ordem de prioridade
 */

import { supabase } from "./supabase";
import type { Mesa, Comanda, ComandaItem, Produto, Categoria } from "./supabase";
import {
  dbGet, dbGetAll, dbGetByIndex, dbPut, dbPutMany, dbDelete,
  enfileirar, isTempId, STORES,
} from "./offline-queue";

const online = () => navigator.onLine;
const tempId = () => "temp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);

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

// ─── Login ────────────────────────────────────────────────────────────────────

export async function fazerLogin(usuario: string, senha: string): Promise<Sessao | null> {
  const encoder = new TextEncoder();
  const data = encoder.encode(senha);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const senhaHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

  // Tenta online primeiro
  if (online()) {
    const { data: func } = await supabase
      .from("funcionarios")
      .select("id, nome, usuario, funcao")
      .eq("usuario", usuario)
      .eq("senha_hash", senhaHash)
      .eq("ativo", true)
      .single();

    if (func) {
      // Salva no IndexedDB para login offline futuro
      await dbPut(STORES.funcionarios, { ...func, senha_hash: senhaHash });
      const sessao = { id: func.id, nome: func.nome, usuario: func.usuario, funcao: func.funcao as Sessao["funcao"] };
      salvarSessao(sessao);
      return sessao;
    }
    return null;
  }

  // Offline: busca no IndexedDB
  const funcionarios = await dbGetAll<any>(STORES.funcionarios);
  const func = funcionarios.find(f => f.usuario === usuario && f.senha_hash === senhaHash && f.ativo !== false);
  if (!func) return null;

  const sessao = { id: func.id, nome: func.nome, usuario: func.usuario, funcao: func.funcao as Sessao["funcao"] };
  salvarSessao(sessao);
  return sessao;
}

// ─── Mesas ────────────────────────────────────────────────────────────────────

export async function getMesasComComandas(): Promise<Array<Mesa & { comandas: Comanda[] }>> {
  if (online()) {
    try {
      const { data: mesas, error } = await supabase.from("mesas").select("*").order("numero");
      if (!error && mesas) {
        await dbPutMany(STORES.mesas, mesas);
        const ocupadas = mesas.filter(m => m.status !== "livre").map(m => m.id);
        if (ocupadas.length > 0) {
          const { data: comandas } = await supabase
            .from("comandas")
            .select("id, codigo, cliente_nome, total, solicitou_fechamento, mesa_id, status, subtotal, taxa_servico, aberta_em, funcionario_id, fechada_em, created_at")
            .in("mesa_id", ocupadas)
            .eq("status", "aberta");
          if (comandas) await dbPutMany(STORES.comandas, comandas);
          const cmdMap: Record<string, Comanda[]> = {};
          (comandas ?? []).forEach((c: any) => {
            if (c.mesa_id) { if (!cmdMap[c.mesa_id]) cmdMap[c.mesa_id] = []; cmdMap[c.mesa_id].push(c); }
          });
          return mesas.map(m => ({ ...m, comandas: cmdMap[m.id] ?? [] }));
        }
        return mesas.map(m => ({ ...m, comandas: [] }));
      }
    } catch {}
  }

  // Offline: usa IndexedDB
  const mesas = await dbGetAll<Mesa>(STORES.mesas);
  const comandas = await dbGetAll<Comanda>(STORES.comandas);
  const abertas = comandas.filter(c => c.status === "aberta");
  const cmdMap: Record<string, Comanda[]> = {};
  abertas.forEach(c => { if (c.mesa_id) { if (!cmdMap[c.mesa_id]) cmdMap[c.mesa_id] = []; cmdMap[c.mesa_id].push(c); } });
  return mesas.sort((a, b) => a.numero - b.numero).map(m => ({ ...m, comandas: cmdMap[m.id] ?? [] }));
}

export async function atualizarStatusMesa(id: string, status: Mesa["status"]) {
  // Local imediato
  const mesa = await dbGet<Mesa>(STORES.mesas, id);
  if (mesa) await dbPut(STORES.mesas, { ...mesa, status });

  if (online()) {
    const { error } = await supabase.from("mesas").update({ status }).eq("id", id);
    if (error) await enfileirar({ tabela: "mesas", operacao: "update", record_id: id, payload: { status } });
  } else {
    await enfileirar({ tabela: "mesas", operacao: "update", record_id: id, payload: { status } });
  }
}

// ─── Produtos e Categorias ────────────────────────────────────────────────────

export async function getProdutos(): Promise<Produto[]> {
  if (online()) {
    try {
      const { data, error } = await supabase
        .from("produtos").select("*, categorias(nome)").eq("ativo", true).order("nome");
      if (!error && data) { await dbPutMany(STORES.produtos, data); return data as Produto[]; }
    } catch {}
  }
  const local = await dbGetAll<Produto>(STORES.produtos);
  return local.filter(p => p.ativo !== false);
}

export async function getCategorias(): Promise<Categoria[]> {
  if (online()) {
    try {
      const { data, error } = await supabase.from("categorias").select("*").eq("ativo", true).order("nome");
      if (!error && data) { await dbPutMany(STORES.categorias, data); return data as Categoria[]; }
    } catch {}
  }
  const local = await dbGetAll<Categoria>(STORES.categorias);
  return local.filter(c => c.ativo !== false);
}

// ─── Comandas ─────────────────────────────────────────────────────────────────

export async function verificarFicha(codigo: string): Promise<"disponivel" | "ocupada"> {
  // Verifica local primeiro (inclui comandas abertas offline)
  const local = await dbGetAll<Comanda>(STORES.comandas);
  const existeLocal = local.some(c => c.codigo === codigo && c.status === "aberta");
  if (existeLocal) return "ocupada";

  // Se online, confirma no banco
  if (online()) {
    const { data } = await supabase
      .from("comandas").select("id").eq("codigo", codigo).eq("status", "aberta").limit(1);
    return (data && data.length > 0) ? "ocupada" : "disponivel";
  }
  return "disponivel";
}

export async function abrirComanda(params: {
  codigo: string;
  mesa_id: string;
  cliente_nome: string;
  funcionario_id: string;
}): Promise<Comanda> {
  const id = tempId();
  const agora = new Date().toISOString();

  const comanda: Comanda = {
    id,
    codigo: params.codigo,
    mesa_id: params.mesa_id,
    cliente_nome: params.cliente_nome,
    funcionario_id: params.funcionario_id,
    status: "aberta",
    subtotal: 0,
    taxa_servico: 0,
    total: 0,
    solicitou_fechamento: false,
    aberta_em: agora,
    fechada_em: null,
    created_at: agora,
    forma_pagamento: null,
  };

  // Salva local imediatamente
  await dbPut(STORES.comandas, comanda);
  await atualizarStatusMesa(params.mesa_id, "ocupada");

  const payload = {
    codigo: params.codigo,
    mesa_id: params.mesa_id,
    cliente_nome: params.cliente_nome,
    funcionario_id: params.funcionario_id,
    status: "aberta",
    aberta_em: agora,
  };

  if (online()) {
    try {
      const { data, error } = await supabase
        .from("comandas").insert(payload).select().single();
      if (!error && data) {
        // Substitui ID temporário pelo real
        await dbDelete(STORES.comandas, id);
        await dbPut(STORES.comandas, data);
        return data as Comanda;
      }
    } catch {}
  }

  // Offline: enfileira
  await enfileirar({ tabela: "comandas", operacao: "insert", record_id: id, payload });
  return comanda;
}

export async function inserirItens(comandaId: string, itens: Array<{
  produto_id: string;
  nome_produto: string;
  preco_unit: number;
  quantidade: number;
}>): Promise<void> {
  const agora = new Date().toISOString();

  const rows = itens.map(i => ({
    id: tempId(),
    comanda_id: comandaId,
    produto_id: i.produto_id,
    nome_produto: i.nome_produto,
    preco_unit: i.preco_unit,
    quantidade: i.quantidade,
    total: +(i.preco_unit * i.quantidade).toFixed(2),
    cancelado: false,
    created_at: agora,
  }));

  // Salva local imediatamente
  await dbPutMany(STORES.comanda_itens, rows);

  // Atualiza total local da comanda
  const todosItens = await dbGetByIndex<ComandaItem>(STORES.comanda_itens, "comanda_id", comandaId);
  const subtotal = todosItens.filter(i => !i.cancelado).reduce((s, i) => s + Number(i.total), 0);
  const comanda = await dbGet<Comanda>(STORES.comandas, comandaId);
  if (comanda) {
    await dbPut(STORES.comandas, {
      ...comanda,
      subtotal,
      taxa_servico: +(subtotal * 0.1).toFixed(2),
      total: +(subtotal * 1.1).toFixed(2),
    });
  }

  // Se a comanda ainda tem ID temporário (foi criada offline e ainda não sincronizou),
  // NÃO tenta inserir online — vai direto para a fila.
  // O sync vai resolver o ID da comanda primeiro, depois os itens.
  const comandaEhTemp = isTempId(comandaId);

  if (online() && !comandaEhTemp) {
    try {
      // Insere um por um para pegar o ID real de cada um
      for (const row of rows) {
        const { id: _id, ...payload } = row;
        const { data, error } = await supabase
          .from("comanda_itens")
          .insert(payload)
          .select()
          .single();

        if (error) throw error;

        // Salva real ANTES de apagar temp
        await dbPut(STORES.comanda_itens, data);
        await dbDelete(STORES.comanda_itens, row.id);
      }

      // Atualiza total da comanda com os dados reais do banco
      const todosReais = await dbGetByIndex<ComandaItem>(STORES.comanda_itens, "comanda_id", comandaId);
      const subReal = todosReais.filter(i => !i.cancelado).reduce((s, i) => s + Number(i.total), 0);
      const cmdReal = await dbGet<Comanda>(STORES.comandas, comandaId);
      if (cmdReal) {
        await dbPut(STORES.comandas, {
          ...cmdReal,
          subtotal: subReal,
          taxa_servico: +(subReal * 0.1).toFixed(2),
          total: +(subReal * 1.1).toFixed(2),
        });
      }
      return;
    } catch (err) {
      console.error("[db] Erro ao inserir itens online, enfileirando:", err);
      // NÃO apaga os locais — caem para a fila abaixo
    }
  }

  // Offline OU comanda tem ID temporário OU falhou online → enfileira
  // Os itens ficam salvos no IndexedDB e serão enviados quando o sync rodar
  for (const row of rows) {
    await enfileirar({
      tabela: "comanda_itens",
      operacao: "insert",
      record_id: row.id,
      payload: {
        comanda_id: row.comanda_id,
        produto_id: row.produto_id,
        nome_produto: row.nome_produto,
        preco_unit: row.preco_unit,
        quantidade: row.quantidade,
        total: row.total,
        cancelado: false,
      },
    });
  }
}

export async function getItensDaComanda(comandaId: string): Promise<ComandaItem[]> {
  if (online()) {
    try {
      const { data, error } = await supabase
        .from("comanda_itens").select("*").eq("comanda_id", comandaId).order("created_at");
      if (!error && data) { await dbPutMany(STORES.comanda_itens, data); return data as ComandaItem[]; }
    } catch {}
  }
  const local = await dbGetByIndex<ComandaItem>(STORES.comanda_itens, "comanda_id", comandaId);
  return local.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export async function solicitarFechamento(comandaId: string): Promise<void> {
  const comanda = await dbGet<Comanda>(STORES.comandas, comandaId);
  if (comanda) await dbPut(STORES.comandas, { ...comanda, solicitou_fechamento: true, status: "fechando" });

  if (online()) {
    const { error } = await supabase.from("comandas")
      .update({ solicitou_fechamento: true, status: "fechando" }).eq("id", comandaId);
    if (error) await enfileirar({ tabela: "comandas", operacao: "update", record_id: comandaId, payload: { solicitou_fechamento: true, status: "fechando" } });
  } else {
    await enfileirar({ tabela: "comandas", operacao: "update", record_id: comandaId, payload: { solicitou_fechamento: true, status: "fechando" } });
  }
}

export async function fecharComanda(comandaId: string, formaPagamento: string): Promise<void> {
  const comanda = await dbGet<Comanda>(STORES.comandas, comandaId);
  const mesaId = comanda?.mesa_id;

  if (comanda) await dbPut(STORES.comandas, { ...comanda, status: "fechada", forma_pagamento: formaPagamento, fechada_em: new Date().toISOString() });

  const payload = { status: "fechada", forma_pagamento: formaPagamento, fechada_em: new Date().toISOString() };

  if (online()) {
    const { error } = await supabase.from("comandas").update(payload).eq("id", comandaId);
    if (error) await enfileirar({ tabela: "comandas", operacao: "update", record_id: comandaId, payload });
    // Libera mesa se não há mais abertas
    if (mesaId) {
      const { data: outras } = await supabase.from("comandas")
        .select("id").eq("mesa_id", mesaId).in("status", ["aberta", "fechando"]).neq("id", comandaId);
      if (!outras || outras.length === 0) await atualizarStatusMesa(mesaId, "livre");
    }
  } else {
    await enfileirar({ tabela: "comandas", operacao: "update", record_id: comandaId, payload });
    if (mesaId) {
      const local = await dbGetAll<Comanda>(STORES.comandas);
      const outras = local.filter(c => c.mesa_id === mesaId && ["aberta", "fechando"].includes(c.status) && c.id !== comandaId);
      if (outras.length === 0) await atualizarStatusMesa(mesaId, "livre");
    }
  }
}

export async function cancelarComanda(comandaId: string): Promise<void> {
  const comanda = await dbGet<Comanda>(STORES.comandas, comandaId);
  const mesaId = comanda?.mesa_id;
  if (comanda) await dbPut(STORES.comandas, { ...comanda, status: "cancelada" });

  if (online()) {
    await supabase.from("comandas").update({ status: "cancelada" }).eq("id", comandaId);
    if (mesaId) {
      const { data: outras } = await supabase.from("comandas")
        .select("id").eq("mesa_id", mesaId).in("status", ["aberta", "fechando"]).neq("id", comandaId);
      if (!outras || outras.length === 0) await atualizarStatusMesa(mesaId, "livre");
    }
  } else {
    await enfileirar({ tabela: "comandas", operacao: "update", record_id: comandaId, payload: { status: "cancelada" } });
    if (mesaId) {
      const local = await dbGetAll<Comanda>(STORES.comandas);
      const outras = local.filter(c => c.mesa_id === mesaId && ["aberta", "fechando"].includes(c.status) && c.id !== comandaId);
      if (outras.length === 0) await atualizarStatusMesa(mesaId, "livre");
    }
  }
}

// ─── Chamadas de garçom ────────────────────────────────────────────────────────

export async function chamarGarcom(params: {
  mesa_id: string;
  mesa_numero: number;
  cliente_nome?: string | null;
  codigo_comanda?: string | null;
}): Promise<void> {
  const payload = {
    mesa_id: params.mesa_id,
    mesa_numero: params.mesa_numero,
    cliente_nome: params.cliente_nome ?? null,
    codigo_comanda: params.codigo_comanda ?? null,
    status: "pendente",
  };

  if (online()) {
    const { error } = await supabase.from("chamadas_garcom").insert(payload);
    if (error) throw error;
  } else {
    await enfileirar({ tabela: "chamadas_garcom", operacao: "insert", record_id: tempId(), payload });
  }
}

export async function atenderChamada(id: string, funcionarioId?: string | null): Promise<void> {
  if (online()) {
    await supabase.from("chamadas_garcom").update({
      status: "atendida", atendida_por: funcionarioId ?? null, atendida_em: new Date().toISOString(),
    }).eq("id", id);
  } else {
    await enfileirar({ tabela: "chamadas_garcom", operacao: "update", record_id: id, payload: { status: "atendida", atendida_em: new Date().toISOString() } });
  }
}

export async function atenderTodasChamadas(funcionarioId?: string | null): Promise<void> {
  if (online()) {
    await supabase.from("chamadas_garcom").update({
      status: "atendida", atendida_por: funcionarioId ?? null, atendida_em: new Date().toISOString(),
    }).eq("status", "pendente");
  }
}

export async function getChamadasPendentes() {
  if (online()) {
    const { data } = await supabase.from("chamadas_garcom")
      .select("*").eq("status", "pendente").order("created_at", { ascending: true });
    return data ?? [];
  }
  return [];
}

export function invalidarCacheProdutos() {
  // Não há mais cache local — produtos são buscados do IndexedDB
}
