/**
 * sync-engine.ts — Motor de sincronização offline → Supabase
 *
 * REGRAS FUNDAMENTAIS:
 * 1. NUNCA apaga dado local antes de confirmar que chegou no banco
 * 2. NUNCA sobrescreve dados locais com IDs temporários durante rehydrate
 * 3. Processa a fila em ordem de prioridade (mesas → comandas → itens)
 * 4. Ao resolver ID temporário → atualiza TODAS as referências na fila e no IndexedDB
 */

import { supabase } from "./supabase";
import {
  getPendentes, removerDaFila, marcarErro, substituirIdNaFila,
  dbPut, dbPutMany, dbGetAll, dbDelete, STORES, contarPendentes,
  salvarHistoricoSync, isTempId, type ItemFila,
} from "./offline-queue";

export type StatusSync = {
  online:        boolean;
  pendentes:     number;
  sincronizando: boolean;
  ultimaSync:    Date | null;
  erros:         number;
};

type Listener = (s: StatusSync) => void;
let _status: StatusSync = { online: navigator.onLine, pendentes: 0, sincronizando: false, ultimaSync: null, erros: 0 };
let _listeners: Listener[] = [];
let _iniciado  = false;
let _rodando   = false;

function notificar() { _listeners.forEach(fn => fn({ ..._status })); }
function set(p: Partial<StatusSync>) { _status = { ..._status, ...p }; notificar(); }

// ─── Inicialização ────────────────────────────────────────────────────────────

export function iniciarSync() {
  if (_iniciado) return;
  _iniciado = true;

  window.addEventListener("online", async () => {
    set({ online: true });
    await processarFila();
    // Só rehydrata DEPOIS que a fila estiver vazia
    const p = await contarPendentes();
    if (p === 0) await rehydratar();
  });

  window.addEventListener("offline", () => set({ online: false }));

  // Atualiza contador a cada 2s
  setInterval(async () => {
    const p = await contarPendentes();
    if (p !== _status.pendentes) set({ pendentes: p });
  }, 2000);

  if (navigator.onLine) {
    setTimeout(async () => {
      await processarFila();
      const p = await contarPendentes();
      if (p === 0) await rehydratar();
    }, 1500);
  }
}

export function onStatusSync(cb: Listener): () => void {
  _listeners.push(cb);
  cb({ ..._status });
  return () => { _listeners = _listeners.filter(l => l !== cb); };
}

export function getStatusSync(): StatusSync { return { ..._status }; }

// ─── Processar fila ───────────────────────────────────────────────────────────

const ERROS_PERMANENTES = ["23505","42703","42P01","23502"];
// NOTA: 23503 (foreign_key) NÃO é permanente — pode ser que a comanda ainda não chegou ao banco

export async function processarFila(): Promise<{ sucesso: number; falha: number }> {
  if (_rodando || !navigator.onLine) return { sucesso: 0, falha: 0 };
  _rodando = true;
  set({ sincronizando: true });

  let sucesso = 0;
  let falha   = 0;

  try {
    // Busca pendentes a cada iteração porque os IDs podem ter mudado
    let pendentes = await getPendentes();

    while (pendentes.length > 0) {
      const op = pendentes[0];
      try {
        await executarOperacao(op);
        await removerDaFila(op.id!);
        sucesso++;
      } catch (err: any) {
        const msg       = String(err?.code ?? err?.message ?? err ?? "");
        const permanente = ERROS_PERMANENTES.some(c => msg.includes(c));

        if (permanente) {
          console.warn("[Sync] Descartando erro permanente:", op.tabela, op.record_id, msg);
          await removerDaFila(op.id!);
        } else {
          console.error("[Sync] Erro temporário:", op.tabela, op.record_id, msg);
          await marcarErro(op.id!, msg);
          falha++;
          // Para de processar se der erro de rede — tenta de novo depois
          break;
        }
      }
      // Rebusca porque os IDs na fila podem ter sido atualizados
      pendentes = await getPendentes();
    }
  } finally {
    _rodando = false;
    const restantes = await contarPendentes();
    set({ sincronizando: false, ultimaSync: new Date(), pendentes: restantes, erros: falha });
    salvarHistoricoSync({ ts: new Date().toISOString(), sucesso, falha, pendentes: restantes });
  }

  return { sucesso, falha };
}

async function executarOperacao(op: ItemFila) {
  switch (op.operacao) {

    case "insert": {
      // Limpa campos calculados pelo banco antes de enviar
      const payload = { ...op.payload } as any;
      delete payload.id;
      delete payload.total;
      delete payload.subtotal;
      delete payload.taxa_servico;
      delete payload.solicitou_fechamento;

      // ── Se comanda_id ainda é temporário, a comanda não foi sincronizada ainda ──
      // Isso significa que o sync da comanda falhou ou ainda não rodou.
      // Lança erro TEMPORÁRIO para tentar de novo depois (não descarta).
      if (op.tabela === "comanda_itens" && isTempId(payload.comanda_id ?? "")) {
        throw new Error(`TEMP_DEP: comanda_id temporário ${payload.comanda_id} — sync da comanda pendente`);
      }

      const { data, error } = await supabase
        .from(op.tabela as any)
        .insert(payload)
        .select()
        .single();

      if (error) throw error;
      if (!data)  throw new Error("Banco não retornou dados após insert");

      // ── Atualiza IndexedDB com o ID real ──────────────────────────────────
      const storeMap: Record<string, string> = {
        comandas:      STORES.comandas,
        comanda_itens: STORES.comanda_itens,
        mesas:         STORES.mesas,
      };
      const store = storeMap[op.tabela];
      if (store) {
        await dbPut(store, data);                      // salva real
        if (isTempId(op.record_id)) {
          await dbDelete(store, op.record_id);         // remove temp só depois
        }
      }

      // ── Propaga o novo ID para o restante da fila ─────────────────────────
      if (isTempId(op.record_id) && data.id !== op.record_id) {
        await substituirIdNaFila(op.record_id, data.id, op.tabela);

        // Atualiza comanda_itens locais que tinham comanda_id temporário
        if (op.tabela === "comandas") {
          const itens = await dbGetAll<any>(STORES.comanda_itens);
          const velhos = itens.filter(i => i.comanda_id === op.record_id);
          if (velhos.length > 0) {
            await dbPutMany(STORES.comanda_itens, velhos.map(i => ({ ...i, comanda_id: data.id })));
          }
        }
      }
      break;
    }

    case "update": {
      // Se o record_id ainda é temporário, a entidade não chegou ao banco ainda
      // Isso não deveria acontecer devido à ordenação, mas defendemos
      if (isTempId(op.record_id)) {
        throw new Error(`record_id temporário em update: ${op.record_id}`);
      }
      const { error } = await supabase
        .from(op.tabela as any)
        .update(op.payload)
        .eq("id", op.record_id);
      if (error) throw error;
      break;
    }

    case "delete": {
      if (isTempId(op.record_id)) {
        // Nunca chegou ao banco — só apaga local
        const storeMap: Record<string, string> = {
          comandas: STORES.comandas, comanda_itens: STORES.comanda_itens,
        };
        const store = storeMap[op.tabela];
        if (store) await dbDelete(store, op.record_id);
        return;
      }
      const { error } = await supabase
        .from(op.tabela as any)
        .delete()
        .eq("id", op.record_id);
      if (error) throw error;
      break;
    }
  }
}

// ─── Rehydrate — NUNCA sobrescreve dados com IDs temporários ─────────────────

export async function rehydratar(): Promise<void> {
  if (!navigator.onLine) return;

  // Verifica se há pendentes com IDs temporários — nesse caso não rehydrata
  // para não sobrescrever dados locais que ainda não foram para o banco
  const pendentes = await getPendentes();
  if (pendentes.some(p => isTempId(p.record_id))) {
    console.log("[Sync] Rehydrate adiado — há IDs temporários na fila");
    return;
  }

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
      supabase.from("funcionarios").select("id,nome,usuario,funcao,ativo,senha_hash").eq("ativo", true),
    ]);

    if (mesas)        await dbPutMany(STORES.mesas, mesas);
    if (produtos)     await dbPutMany(STORES.produtos, produtos);
    if (categorias)   await dbPutMany(STORES.categorias, categorias);
    if (funcionarios) await dbPutMany(STORES.funcionarios, funcionarios);

    // Comandas abertas — busca os IDs reais do banco
    const { data: comandas } = await supabase
      .from("comandas")
      .select("*")
      .in("status", ["aberta", "fechando"]);

    if (comandas && comandas.length > 0) {
      await dbPutMany(STORES.comandas, comandas);

      const ids = comandas.map((c: any) => c.id);
      const { data: itens } = await supabase
        .from("comanda_itens")
        .select("*")
        .in("comanda_id", ids)
        .eq("cancelado", false);

      if (itens) await dbPutMany(STORES.comanda_itens, itens);
    }

    set({ ultimaSync: new Date() });
    console.log("[Sync] Rehydrate concluído");
  } catch (err) {
    console.error("[Sync] Erro no rehydrate:", err);
  }
}
