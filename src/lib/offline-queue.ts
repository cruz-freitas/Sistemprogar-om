/**
 * offline-queue.ts
 * 
 * Fila offline robusta usando IndexedDB.
 * 
 * Estratégia:
 * - Cada operação é salva imediatamente no IndexedDB (local)
 * - A UI responde instantaneamente com dados locais
 * - Quando online, processa a fila em ordem, com prioridade e retry
 * - IDs temporários são substituídos pelos IDs reais do banco após sync
 * 
 * Prioridades de sync:
 *   1. mesas (atualizar status)
 *   2. comandas (abrir/fechar — outros itens dependem)
 *   3. comanda_itens (dependem da comanda existir no banco)
 *   4. chamadas_garcom
 */

const DB_NAME = "bambui_bar_v1";
const DB_VERSION = 2;

export const STORES = {
  mesas:          "mesas",
  comandas:       "comandas",
  comanda_itens:  "comanda_itens",
  produtos:       "produtos",
  categorias:     "categorias",
  funcionarios:   "funcionarios",
  fila:           "fila_sync",
  session:        "session",
} as const;

const PRIORIDADE: Record<string, number> = {
  mesas:          1,
  comandas:       2,
  comanda_itens:  3,
  chamadas_garcom: 4,
};

let _db: IDBDatabase | null = null;

export function abrirDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;

      const stores: Array<{ name: string; opts?: IDBObjectStoreParameters; indices?: Array<{ name: string; key: string }> }> = [
        { name: STORES.mesas,         opts: { keyPath: "id" } },
        { name: STORES.comandas,      opts: { keyPath: "id" }, indices: [{ name: "status", key: "status" }, { name: "mesa_id", key: "mesa_id" }] },
        { name: STORES.comanda_itens, opts: { keyPath: "id" }, indices: [{ name: "comanda_id", key: "comanda_id" }] },
        { name: STORES.produtos,      opts: { keyPath: "id" } },
        { name: STORES.categorias,    opts: { keyPath: "id" } },
        { name: STORES.funcionarios,  opts: { keyPath: "id" } },
        { name: STORES.session,       opts: { keyPath: "key" } },
        {
          name: STORES.fila,
          opts: { keyPath: "id", autoIncrement: true },
          indices: [
            { name: "tabela", key: "tabela" },
            { name: "status", key: "status" },
            { name: "prioridade", key: "prioridade" },
          ],
        },
      ];

      stores.forEach(({ name, opts, indices }) => {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, opts ?? { keyPath: "id" });
          indices?.forEach(({ name: iName, key }) => store.createIndex(iName, key));
        }
      });
    };

    req.onsuccess = (e) => { _db = (e.target as IDBOpenDBRequest).result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

// ─── CRUD genérico ────────────────────────────────────────────────────────────

export async function dbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetAll<T>(store: string): Promise<T[]> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetByIndex<T>(store: string, index: string, value: IDBValidKey): Promise<T[]> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).index(index).getAll(value);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function dbPut<T>(store: string, record: T): Promise<void> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readwrite").objectStore(store).put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function dbPutMany<T>(store: string, records: T[]): Promise<void> {
  if (records.length === 0) return;
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const s = tx.objectStore(store);
    records.forEach(r => s.put(r));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbDelete(store: string, key: IDBValidKey): Promise<void> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readwrite").objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ─── Fila de sincronização ────────────────────────────────────────────────────

export type OperacaoFila = {
  id?: number;
  tabela: string;
  operacao: "insert" | "update" | "delete";
  record_id: string;        // ID local (pode ser temp_xxx)
  payload: Record<string, unknown>;
  prioridade: number;
  tentativas: number;
  status: "pendente" | "processando" | "erro";
  criado_em: string;
  erro?: string;
};

export async function enfileirar(op: Omit<OperacaoFila, "id" | "tentativas" | "status" | "criado_em" | "prioridade">): Promise<void> {
  const db = await abrirDB();
  const item: Omit<OperacaoFila, "id"> = {
    ...op,
    prioridade: PRIORIDADE[op.tabela] ?? 9,
    tentativas: 0,
    status: "pendente",
    criado_em: new Date().toISOString(),
  };
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORES.fila, "readwrite").objectStore(STORES.fila).add(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getPendentes(): Promise<OperacaoFila[]> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORES.fila, "readonly").objectStore(STORES.fila).getAll();
    req.onsuccess = () => {
      const todos = (req.result ?? []) as OperacaoFila[];
      const pendentes = todos
        .filter(o => o.status === "pendente")
        .sort((a, b) => {
          if (a.prioridade !== b.prioridade) return a.prioridade - b.prioridade;
          return (a.id ?? 0) - (b.id ?? 0); // ordem de inserção dentro da mesma prioridade
        });
      resolve(pendentes);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function contarPendentes(): Promise<number> {
  const p = await getPendentes();
  return p.length;
}

export async function removerDaFila(id: number): Promise<void> {
  await dbDelete(STORES.fila, id);
}

export async function marcarErro(id: number, erro: string): Promise<void> {
  const db = await abrirDB();
  const tx = db.transaction(STORES.fila, "readwrite");
  const store = tx.objectStore(STORES.fila);
  const req = store.get(id);
  req.onsuccess = () => {
    const item = req.result as OperacaoFila;
    if (item) {
      item.tentativas += 1;
      item.erro = erro;
      item.status = item.tentativas >= 5 ? "erro" : "pendente";
      store.put(item);
    }
  };
  return new Promise((resolve) => { tx.oncomplete = () => resolve(); });
}

export async function atualizarIdNaFila(idTemp: string, idReal: string, tabela: string): Promise<void> {
  const db = await abrirDB();
  const tx = db.transaction(STORES.fila, "readwrite");
  const store = tx.objectStore(STORES.fila);
  const req = store.getAll();
  req.onsuccess = () => {
    const todos = req.result as OperacaoFila[];
    todos.forEach(item => {
      let alterado = false;
      // Se for item de comanda_itens que usava o ID temp da comanda
      if (tabela === "comandas" && item.tabela === "comanda_itens") {
        if ((item.payload as any).comanda_id === idTemp) {
          (item.payload as any).comanda_id = idReal;
          alterado = true;
        }
      }
      // Se o próprio record_id era o ID temp
      if (item.record_id === idTemp) {
        item.record_id = idReal;
        alterado = true;
      }
      if (alterado) store.put(item);
    });
  };
  return new Promise((resolve) => { tx.oncomplete = () => resolve(); });
}

// ─── Histórico de sincronização (últimas 50 operações) ────────────────────────

const HIST_KEY = "bb_sync_history";

export type SyncEvent = {
  ts: string;
  sucesso: number;
  falha: number;
  pendentes: number;
};

export function salvarHistoricoSync(ev: SyncEvent) {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    const hist: SyncEvent[] = raw ? JSON.parse(raw) : [];
    hist.unshift(ev);
    localStorage.setItem(HIST_KEY, JSON.stringify(hist.slice(0, 50)));
  } catch {}
}

export function carregarHistoricoSync(): SyncEvent[] {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
