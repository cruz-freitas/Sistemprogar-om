/**
 * offline-queue.ts — IndexedDB para operações offline
 */

const DB_NAME = "bambui_bar_v2";
const DB_VERSION = 1;

export const STORES = {
  mesas:         "mesas",
  comandas:      "comandas",
  comanda_itens: "comanda_itens",
  produtos:      "produtos",
  categorias:    "categorias",
  funcionarios:  "funcionarios",
  fila:          "fila_sync",
  session:       "session",
} as const;

// Prioridade de sync: menor número = processa primeiro
const PRIORIDADE: Record<string, number> = {
  mesas:           1,
  comandas:        2,
  comanda_itens:   3,
  chamadas_garcom: 4,
};

let _db: IDBDatabase | null = null;

export function abrirDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      const criar = (name: string, opts?: IDBObjectStoreParameters, indices?: [string, string][]) => {
        if (db.objectStoreNames.contains(name)) return;
        const s = db.createObjectStore(name, opts ?? { keyPath: "id" });
        indices?.forEach(([n, k]) => s.createIndex(n, k));
      };
      criar(STORES.mesas);
      criar(STORES.comandas,      { keyPath: "id" }, [["status","status"],["mesa_id","mesa_id"]]);
      criar(STORES.comanda_itens, { keyPath: "id" }, [["comanda_id","comanda_id"]]);
      criar(STORES.produtos);
      criar(STORES.categorias);
      criar(STORES.funcionarios);
      criar(STORES.session,       { keyPath: "key" });
      criar(STORES.fila,          { keyPath: "id", autoIncrement: true }, [
        ["tabela","tabela"], ["status","status"],
      ]);
    };
    req.onsuccess = (e) => { _db = (e.target as IDBOpenDBRequest).result; resolve(_db); };
    req.onerror  = () => reject(req.error);
  });
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function dbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await abrirDB();
  return new Promise((res, rej) => {
    const r = db.transaction(store,"readonly").objectStore(store).get(key);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}

export async function dbGetAll<T>(store: string): Promise<T[]> {
  const db = await abrirDB();
  return new Promise((res, rej) => {
    const r = db.transaction(store,"readonly").objectStore(store).getAll();
    r.onsuccess = () => res(r.result ?? []); r.onerror = () => rej(r.error);
  });
}

export async function dbGetByIndex<T>(store: string, index: string, value: IDBValidKey): Promise<T[]> {
  const db = await abrirDB();
  return new Promise((res, rej) => {
    const r = db.transaction(store,"readonly").objectStore(store).index(index).getAll(value);
    r.onsuccess = () => res(r.result ?? []); r.onerror = () => rej(r.error);
  });
}

export async function dbPut<T>(store: string, record: T): Promise<void> {
  const db = await abrirDB();
  return new Promise((res, rej) => {
    const r = db.transaction(store,"readwrite").objectStore(store).put(record);
    r.onsuccess = () => res(); r.onerror = () => rej(r.error);
  });
}

export async function dbPutMany<T>(store: string, records: T[]): Promise<void> {
  if (!records.length) return;
  const db = await abrirDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store,"readwrite");
    const s  = tx.objectStore(store);
    records.forEach(r => s.put(r));
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

export async function dbDelete(store: string, key: IDBValidKey): Promise<void> {
  const db = await abrirDB();
  return new Promise((res, rej) => {
    const r = db.transaction(store,"readwrite").objectStore(store).delete(key);
    r.onsuccess = () => res(); r.onerror = () => rej(r.error);
  });
}

// ─── Fila ─────────────────────────────────────────────────────────────────────

export type ItemFila = {
  id?:        number;
  tabela:     string;
  operacao:   "insert" | "update" | "delete";
  record_id:  string;
  payload:    Record<string, unknown>;
  prioridade: number;
  tentativas: number;
  status:     "pendente" | "erro";
  criado_em:  string;
  erro?:      string;
};

export function isTempId(id: string) {
  return id.startsWith("temp_");
}

export async function enfileirar(
  op: Pick<ItemFila, "tabela"|"operacao"|"record_id"|"payload">
): Promise<void> {
  const db = await abrirDB();
  const item: Omit<ItemFila,"id"> = {
    ...op,
    prioridade: PRIORIDADE[op.tabela] ?? 9,
    tentativas: 0,
    status:     "pendente",
    criado_em:  new Date().toISOString(),
  };
  return new Promise((res, rej) => {
    const r = db.transaction(STORES.fila,"readwrite").objectStore(STORES.fila).add(item);
    r.onsuccess = () => res(); r.onerror = () => rej(r.error);
  });
}

export async function getPendentes(): Promise<ItemFila[]> {
  const todos = await dbGetAll<ItemFila>(STORES.fila);
  return todos
    .filter(o => o.status === "pendente")
    .sort((a, b) => {
      if (a.prioridade !== b.prioridade) return a.prioridade - b.prioridade;
      return (a.id ?? 0) - (b.id ?? 0);
    });
}

export async function contarPendentes(): Promise<number> {
  const todos = await dbGetAll<ItemFila>(STORES.fila);
  return todos.filter(o => o.status === "pendente").length;
}

export async function removerDaFila(id: number): Promise<void> {
  await dbDelete(STORES.fila, id);
}

export async function marcarErro(id: number, erro: string): Promise<void> {
  const db = await abrirDB();
  const tx = db.transaction(STORES.fila,"readwrite");
  const s  = tx.objectStore(STORES.fila);
  const r  = s.get(id);
  r.onsuccess = () => {
    const item = r.result as ItemFila;
    if (!item) return;
    item.tentativas += 1;
    item.erro = erro;
    item.status = item.tentativas >= 5 ? "erro" : "pendente";
    s.put(item);
  };
  return new Promise(res => { tx.oncomplete = () => res(); });
}

/**
 * Quando uma comanda com ID temporário é salva no banco e recebe ID real,
 * precisamos atualizar TODAS as referências na fila que usavam o ID temp.
 */
export async function substituirIdNaFila(idTemp: string, idReal: string, tabela: string): Promise<void> {
  const db = await abrirDB();
  const tx = db.transaction(STORES.fila,"readwrite");
  const s  = tx.objectStore(STORES.fila);
  const r  = s.getAll();
  r.onsuccess = () => {
    (r.result as ItemFila[]).forEach(item => {
      let dirty = false;
      // O próprio record_id era o ID temp
      if (item.record_id === idTemp) {
        item.record_id = idReal;
        dirty = true;
      }
      // comanda_itens que referenciam o ID temp da comanda
      if (tabela === "comandas" && (item.payload as any).comanda_id === idTemp) {
        (item.payload as any).comanda_id = idReal;
        dirty = true;
      }
      if (dirty) s.put(item);
    });
  };
  return new Promise(res => { tx.oncomplete = () => res(); });
}

// ─── Histórico de sync ────────────────────────────────────────────────────────

export type SyncEvento = { ts: string; sucesso: number; falha: number; pendentes: number };
const HIST_KEY = "bb_sync_hist_v2";

export function salvarHistoricoSync(ev: SyncEvento) {
  try {
    const raw  = localStorage.getItem(HIST_KEY);
    const hist = raw ? JSON.parse(raw) : [];
    hist.unshift(ev);
    localStorage.setItem(HIST_KEY, JSON.stringify(hist.slice(0, 50)));
  } catch {}
}

export function carregarHistoricoSync(): SyncEvento[] {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) ?? "[]"); } catch { return []; }
}
