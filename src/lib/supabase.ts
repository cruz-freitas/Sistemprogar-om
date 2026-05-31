import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://wzpgpbtuosujtkgplrfn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6cGdwYnR1b3N1anRrZ3BscmZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MDYxNDIsImV4cCI6MjA5NTM4MjE0Mn0.nulvSv109tknFtk3XW5NDg3ujy-MVdzHBYbuakK5U6Y";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } },
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type Categoria = {
  id: string;
  nome: string;
  cor: string;
  ativo: boolean;
  created_at: string;
};

export type Produto = {
  id: string;
  nome: string;
  descricao?: string | null;
  categoria_id: string | null;
  preco: number;
  impressora: string;
  favorito: boolean;
  ativo: boolean;
  disponivel: boolean;
  promocao: boolean;
  preco_promocao?: number | null;
  created_at: string;
  categorias?: { nome: string };
};

export type Mesa = {
  id: string;
  numero: number;
  status: "livre" | "ocupada" | "atendimento" | "fechando";
  created_at: string;
};

export type Funcionario = {
  id: string;
  nome: string;
  usuario: string;
  funcao: "admin" | "caixa" | "garcom";
  ativo: boolean;
  created_at: string;
};

export type Comanda = {
  id: string;
  codigo: string;
  mesa_id: string | null;
  funcionario_id: string | null;
  cliente_nome: string | null;
  status: "aberta" | "fechando" | "fechada" | "cancelada";
  forma_pagamento?: string | null;
  subtotal: number;
  taxa_servico: number;
  total: number;
  solicitou_fechamento: boolean;
  aberta_em: string;
  fechada_em: string | null;
  created_at: string;
  mesas?: { numero: number };
  funcionarios?: { nome: string };
};

export type ComandaItem = {
  id: string;
  comanda_id: string;
  produto_id: string | null;
  nome_produto: string;
  preco_unit: number;
  quantidade: number;
  total: number;
  cancelado: boolean;
  observacao?: string | null;
  created_at: string;
};

export type Impressora = {
  id: string;
  nome: string;
  modelo: string;
  setores: string[];
  status: "online" | "offline";
  ip?: string | null;
  created_at: string;
};

export type Configuracao = {
  id: string;
  nome_estabelecimento: string;
  cnpj: string | null;
  endereco: string | null;
  taxa_servico_pct: number;
  tempo_limite_min: number;
  modo_escuro: boolean;
  impressao_automatica: boolean;
  updated_at: string;
};

export type ChamadaGarcom = {
  id: string;
  mesa_id: string | null;
  mesa_numero: number;
  cliente_nome: string | null;
  codigo_comanda: string | null;
  motivo: string;
  status: "pendente" | "atendida" | "ignorada";
  atendida_por: string | null;
  atendida_em: string | null;
  created_at: string;
};
