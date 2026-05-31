-- ============================================================
-- SISTEMPROGAR - BANCO DE DADOS COMPLETO
-- Execute este SQL no Supabase SQL Editor para recriar tudo
-- ============================================================

-- 1. LIMPAR TUDO (ordem inversa de dependências)
DROP TABLE IF EXISTS chamadas_garcom CASCADE;
DROP TABLE IF EXISTS comanda_itens CASCADE;
DROP TABLE IF EXISTS comandas CASCADE;
DROP TABLE IF EXISTS mesas CASCADE;
DROP TABLE IF EXISTS produtos CASCADE;
DROP TABLE IF EXISTS categorias CASCADE;
DROP TABLE IF EXISTS funcionarios CASCADE;
DROP TABLE IF EXISTS impressoras CASCADE;
DROP TABLE IF EXISTS configuracoes CASCADE;

-- 2. CATEGORIAS
CREATE TABLE categorias (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  cor TEXT NOT NULL DEFAULT '#6366f1',
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. PRODUTOS
CREATE TABLE produtos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT,
  categoria_id UUID REFERENCES categorias(id) ON DELETE SET NULL,
  preco NUMERIC(10,2) NOT NULL DEFAULT 0,
  impressora TEXT NOT NULL DEFAULT 'cozinha',
  favorito BOOLEAN NOT NULL DEFAULT false,
  ativo BOOLEAN NOT NULL DEFAULT true,
  disponivel BOOLEAN NOT NULL DEFAULT true,
  promocao BOOLEAN NOT NULL DEFAULT false,
  preco_promocao NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. FUNCIONÁRIOS
CREATE TABLE funcionarios (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  funcao TEXT NOT NULL CHECK (funcao IN ('admin', 'caixa', 'garcom')),
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. MESAS
CREATE TABLE mesas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  numero INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'livre' CHECK (status IN ('livre', 'ocupada', 'atendimento', 'fechando')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. IMPRESSORAS
CREATE TABLE impressoras (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  modelo TEXT NOT NULL DEFAULT 'Genérica',
  setores TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'offline')),
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. CONFIGURAÇÕES
CREATE TABLE configuracoes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome_estabelecimento TEXT NOT NULL DEFAULT 'Meu Estabelecimento',
  cnpj TEXT,
  endereco TEXT,
  taxa_servico_pct NUMERIC(5,2) NOT NULL DEFAULT 10,
  tempo_limite_min INTEGER NOT NULL DEFAULT 180,
  modo_escuro BOOLEAN NOT NULL DEFAULT false,
  impressao_automatica BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 8. COMANDAS
CREATE TABLE comandas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo TEXT NOT NULL,
  mesa_id UUID REFERENCES mesas(id) ON DELETE SET NULL,
  funcionario_id UUID REFERENCES funcionarios(id) ON DELETE SET NULL,
  cliente_nome TEXT,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'fechando', 'fechada', 'cancelada')),
  forma_pagamento TEXT CHECK (forma_pagamento IN ('dinheiro', 'cartao', 'pix', 'dividido')),
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  taxa_servico NUMERIC(10,2) NOT NULL DEFAULT 0,
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  solicitou_fechamento BOOLEAN NOT NULL DEFAULT false,
  aberta_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  fechada_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para comandas
CREATE INDEX idx_comandas_status ON comandas(status);
CREATE INDEX idx_comandas_mesa_id ON comandas(mesa_id);
CREATE INDEX idx_comandas_codigo ON comandas(codigo);

-- 9. ITENS DA COMANDA
CREATE TABLE comanda_itens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  comanda_id UUID NOT NULL REFERENCES comandas(id) ON DELETE CASCADE,
  produto_id UUID REFERENCES produtos(id) ON DELETE SET NULL,
  nome_produto TEXT NOT NULL,
  preco_unit NUMERIC(10,2) NOT NULL,
  quantidade INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  total NUMERIC(10,2) NOT NULL,
  cancelado BOOLEAN NOT NULL DEFAULT false,
  observacao TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_comanda_itens_comanda_id ON comanda_itens(comanda_id);

-- 10. CHAMADAS DE GARÇOM
CREATE TABLE chamadas_garcom (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mesa_id UUID REFERENCES mesas(id) ON DELETE CASCADE,
  mesa_numero INTEGER NOT NULL,
  cliente_nome TEXT,
  codigo_comanda TEXT,
  motivo TEXT DEFAULT 'chamada',
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'atendida', 'ignorada')),
  atendida_por UUID REFERENCES funcionarios(id) ON DELETE SET NULL,
  atendida_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chamadas_garcom_status ON chamadas_garcom(status);
CREATE INDEX idx_chamadas_garcom_mesa_id ON chamadas_garcom(mesa_id);

-- ============================================================
-- FUNÇÕES E TRIGGERS
-- ============================================================

-- Função para atualizar totais da comanda automaticamente
CREATE OR REPLACE FUNCTION atualizar_totais_comanda()
RETURNS TRIGGER AS $$
DECLARE
  v_subtotal NUMERIC;
  v_taxa_pct NUMERIC;
  v_taxa NUMERIC;
BEGIN
  -- Pega configuração de taxa
  SELECT taxa_servico_pct INTO v_taxa_pct FROM configuracoes LIMIT 1;
  IF v_taxa_pct IS NULL THEN v_taxa_pct := 10; END IF;

  -- Recalcula subtotal (apenas itens não cancelados)
  SELECT COALESCE(SUM(total), 0) INTO v_subtotal
  FROM comanda_itens
  WHERE comanda_id = COALESCE(NEW.comanda_id, OLD.comanda_id)
    AND cancelado = false;

  v_taxa := ROUND(v_subtotal * v_taxa_pct / 100, 2);

  -- Atualiza a comanda
  UPDATE comandas
  SET subtotal = v_subtotal,
      taxa_servico = v_taxa,
      total = v_subtotal + v_taxa
  WHERE id = COALESCE(NEW.comanda_id, OLD.comanda_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_atualizar_totais
AFTER INSERT OR UPDATE OR DELETE ON comanda_itens
FOR EACH ROW EXECUTE FUNCTION atualizar_totais_comanda();

-- ============================================================
-- ROW LEVEL SECURITY - Habilitar acesso público (app usa anon key)
-- ============================================================
ALTER TABLE categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE funcionarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE mesas ENABLE ROW LEVEL SECURITY;
ALTER TABLE impressoras ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE comandas ENABLE ROW LEVEL SECURITY;
ALTER TABLE comanda_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE chamadas_garcom ENABLE ROW LEVEL SECURITY;

-- Políticas liberadas para anon (o app controla auth via senha hash)
CREATE POLICY "acesso_total" ON categorias FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total" ON produtos FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total" ON funcionarios FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total" ON mesas FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total" ON impressoras FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total" ON configuracoes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total" ON comandas FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total" ON comanda_itens FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acesso_total" ON chamadas_garcom FOR ALL TO anon USING (true) WITH CHECK (true);

-- ============================================================
-- HABILITAR REALTIME (necessário para notificações ao vivo)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE chamadas_garcom;
ALTER PUBLICATION supabase_realtime ADD TABLE comandas;
ALTER PUBLICATION supabase_realtime ADD TABLE mesas;
ALTER PUBLICATION supabase_realtime ADD TABLE comanda_itens;

-- ============================================================
-- DADOS INICIAIS
-- ============================================================

-- Configuração padrão
INSERT INTO configuracoes (nome_estabelecimento, taxa_servico_pct, impressao_automatica)
VALUES ('Meu Estabelecimento', 10, true);

-- Admin padrão (senha: admin123 - SHA256)
INSERT INTO funcionarios (nome, usuario, senha_hash, funcao)
VALUES ('Administrador', 'admin', encode(digest('admin123', 'sha256'), 'hex'), 'admin');

-- Garçom de exemplo
INSERT INTO funcionarios (nome, usuario, senha_hash, funcao)
VALUES ('Garçom 1', 'garcom1', encode(digest('garcom123', 'sha256'), 'hex'), 'garcom');

-- Categorias padrão
INSERT INTO categorias (nome, cor) VALUES
  ('Bebidas', '#3b82f6'),
  ('Entradas', '#f59e0b'),
  ('Pratos', '#ef4444'),
  ('Sobremesas', '#8b5cf6'),
  ('Porções', '#10b981');

-- Mesas padrão (10 mesas)
INSERT INTO mesas (numero) VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10);

-- Impressora padrão
INSERT INTO impressoras (nome, modelo, setores, status)
VALUES ('Cozinha', 'Epson TM-T20', ARRAY['cozinha', 'bar'], 'online');

