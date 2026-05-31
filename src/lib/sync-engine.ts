/**
 * sync-engine.ts
 * 
 * Motor de sincronização offline → Supabase.
 * 
 * - Processa a fila em ordem de prioridade quando online
 * - Substitui IDs temporários pelos IDs reais do banco
 * - Notifica todos os listeners sobre o status
 * - Recarrega dados frescos após sync bem-sucedido
 */

import { supabase } from "./supabase";
import {
  getPendentes, removerDaFila, marcarErro, atualizarIdNaFila,
  dbDelete, dbPut, dbPutMany, dbGetAll, STORES, contarPendentes,
  salvarHistoricoSync, type OperacaoFila,
} from "./offline-queue";

export type StatusSync = {
  online: boolean;
  pendentes: number;
  sincronizando: boolean;
  ultimaSync: Date | null;
  erros: number;
};

type Listener = (s: StatusSync) => void;

let _status: StatusSync = {
  online: navigator.onLine,
  pendentes: 0,
  sincronizando: false,
  ultimaSync: null,
  erros: 0,
};
let _listeners: Listener[] = [];
let _iniciado = false;
let _processando = false;

function notificar() {
  _listeners.forEach(fn => fn({ ..._status }));
}

function set(patch: Partial<StatusSync>) {
  _status = { ..._status, ...patch };
  notificar();
}

// ─── Inicialização ────────────────────────────────────────────────────────────

export function iniciarSync() {
  if (_iniciado) return;
  _iniciado = true;

  window.addEventListener("online", async () => {
    set({ online: true });
    await processarFila();
    // Recarrega dados frescos
    window.dispatchEvent(new CustomEvent("bb:rehydrate"));
  });

  window.addEventListener("offline", () => {
    set({ online: false });
  });

  set({ online: navigator.onLine });

  // Atualiza contagem de pendentes a cada 3s
  setInterval(async () => {
    const p = await contarPendentes();
    if (p !== _status.pendentes) set({ pendentes: p });
  }, 3000);

  // Tenta processar ao iniciar se online
  if (navigator.onLine) {
    setTimeout(() => processarFila(), 1500);
  }
}

export function onStatusSync(cb: Listener): () => void {
  _listeners.push(cb);
  cb({ ..._status }); // estado atual imediatamente
  return () => { _listeners = _listeners.filter(l => l !== cb); };
}

export function getStatusSync(): StatusSync {
  return { ..._status };
}

// ─── Processar fila ───────────────────────────────────────────────────────────

const ERROS_PERMANENTES = [
  "23505", // unique_violation
  "23503", // foreign_key_violation  
  "42703", // undefined_column
  "42P01", // undefined_table
  "23502", // not_null_violation
];

export async function processarFila(): Promise<{ sucesso: number; falha: number }> {
  if (_processando || !navigator.onLine) return { sucesso: 0, falha: 0 };
  _processando = true;
  set({ sincronizando: true });

  const pendentes = await getPendentes();
  if (pendentes.length === 0) {
    _processando = false;
    set({ sincronizando: false });
    return { sucesso: 0, falha: 0 };
  }

  let sucesso = 0;
  let falha = 0;

  for (const op of pendentes) {
    try {
      await executarOperacao(op);
      await removerDaFila(op.id!);
      sucesso++;
    } catch (err: any) {
      const msg = String(err?.code ?? err?.message ?? err ?? "");
      const permanente = ERROS_PERMANENTES.some(c => msg.includes(c));

      if (permanente) {
        console.warn("[Sync] Erro permanente, descartando:", op.tabela, op.record_id, msg);
        await removerDaFila(op.id!);
      } else {
        console.error("[Sync] Erro temporário:", op.tabela, op.record_id, msg);
        await marcarErro(op.id!, msg);
        falha++;
      }
    }
  }

  const pendentesRestantes = await contarPendentes();
  _processando = false;
  set({ sincronizando: false, ultimaSync: new Date(), pendentes: pendentesRestantes, erros: falha });

  salvarHistoricoSync({
    ts: new Date().toISOString(),
    sucesso,
    falha,
    pendentes: pendentesRestantes,
  });

  return { sucesso, falha };
}

async function executarOperacao(op: OperacaoFila) {
  switch (op.operacao) {
    case "insert": {
      // Remove campos calculados pelo banco
      const { id: _id, total: _t, subtotal: _s, taxa_servico: _ts, ...payload } = op.payload as any;

      const { data, error } = await supabase
        .from(op.tabela as any)
        .insert(payload)
        .select()
        .single();

      if (error) throw error;

      // Se o ID real é diferente do ID temporário, atualiza tudo
      if (data && data.id !== op.record_id) {
        const storeMap: Record<string, string> = {
          comandas:      STORES.comandas,
          comanda_itens: STORES.comanda_itens,
          mesas:         STORES.mesas,
        };
        const store = storeMap[op.tabela];
        if (store) {
          await dbDelete(store, op.record_id);
          await dbPut(store, data);
        }

        // Atualiza referências na fila (ex: comanda_itens que usavam ID temp da comanda)
        await atualizarIdNaFila(op.record_id, data.id, op.tabela);

        // Atualiza comanda_itens locais que usavam o ID temp
        if (op.tabela === "comandas") {
          const itens = await dbGetAll<any>(STORES.comanda_itens);
          const desatualizados = itens.filter(i => i.comanda_id === op.record_id);
          if (desatualizados.length > 0) {
            await dbPutMany(STORES.comanda_itens, desatualizados.map(i => ({ ...i, comanda_id: data.id })));
          }
        }
      }
      break;
    }

    case "update": {
      const { error } = await supabase
        .from(op.tabela as any)
        .update(op.payload)
        .eq("id", op.record_id);
      if (error) throw error;
      break;
    }

    case "delete": {
      const { error } = await supabase
        .from(op.tabela as any)
        .delete()
        .eq("id", op.record_id);
      if (error) throw error;
      break;
    }
  }
}

// ─── Re-hidratação após sync ──────────────────────────────────────────────────

export async function rehydratar(): Promise<void> {
  if (!navigator.onLine) return;
  try {
    const [
      { data: mesas },
      { data: produtos },
      { data: categorias },
      { data: funcionarios },
    ] = await Promise.all([
      supabase.from("mesas").select("*").order("numero"),
      supabase.from("produtos").select("*, categorias(nome)").eq("ativo", true).order("nome"),
      supabase.from("categorias").select("*").eq("ativo", true).order("nome"),
      supabase.from("funcionarios").select("id, nome, usuario, funcao, ativo, senha_hash").eq("ativo", true),
    ]);

    if (mesas)       await dbPutMany(STORES.mesas, mesas);
    if (produtos)    await dbPutMany(STORES.produtos, produtos);
    if (categorias)  await dbPutMany(STORES.categorias, categorias);
    if (funcionarios) await dbPutMany(STORES.funcionarios, funcionarios);

    // Comandas abertas
    const { data: comandas } = await supabase
      .from("comandas")
      .select("*")
      .in("status", ["aberta", "fechando"]);
    if (comandas) {
      await dbPutMany(STORES.comandas, comandas);
      if (comandas.length > 0) {
        const ids = comandas.map((c: any) => c.id);
        const { data: itens } = await supabase
          .from("comanda_itens")
          .select("*")
          .in("comanda_id", ids)
          .eq("cancelado", false);
        if (itens) await dbPutMany(STORES.comanda_itens, itens);
      }
    }

    set({ ultimaSync: new Date() });
  } catch (err) {
    console.error("[Sync] Erro ao re-hidratar:", err);
  }
}
