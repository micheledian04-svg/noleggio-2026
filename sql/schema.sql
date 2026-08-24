-- =============================================
-- NOLEGGIO 2026 - Supabase Schema
-- Eseguire nel SQL Editor di Supabase
-- =============================================

-- TABELLA: prezzi (tariffe imbarcazioni)
CREATE TABLE IF NOT EXISTS prezzi (
  id SERIAL PRIMARY KEY,
  tipo_imbarcazione TEXT NOT NULL UNIQUE,
  prezzo_studenti NUMERIC(10,2) NOT NULL DEFAULT 0,
  prezzo_esterni NUMERIC(10,2) NOT NULL DEFAULT 0
);

-- TABELLA: giornate (giornate di noleggio)
CREATE TABLE IF NOT EXISTS giornate (
  id SERIAL PRIMARY KEY,
  data TEXT NOT NULL UNIQUE,
  note TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_giornate_data ON giornate(data);

-- TABELLA: noleggi (noleggi - tabella centrale)
CREATE TABLE IF NOT EXISTS noleggi (
  id SERIAL PRIMARY KEY,
  giornata_id INTEGER NOT NULL REFERENCES giornate(id) ON DELETE CASCADE,
  nome_cognome TEXT NOT NULL DEFAULT '',
  staff TEXT DEFAULT '',
  tipologia TEXT DEFAULT 'NOLEGGIO',
  tessera TEXT DEFAULT 'TESSERATO',
  tipo_imbarcazione TEXT NOT NULL,
  imbarcazione TEXT DEFAULT '',
  quantita INTEGER DEFAULT 1,
  ora_uscita TIME,
  ora_rientro TIME,
  tempo NUMERIC(10,2),
  tempo_decine NUMERIC(10,2),
  costo NUMERIC(10,2) DEFAULT 0,
  attrezzatura BOOLEAN DEFAULT FALSE,
  pagato BOOLEAN DEFAULT FALSE,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_noleggi_giornata ON noleggi(giornata_id);

-- TABELLA: clienti (registry persone)
CREATE TABLE IF NOT EXISTS clienti (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  cognome TEXT NOT NULL DEFAULT '',
  telefono TEXT DEFAULT '',
  email TEXT DEFAULT '',
  tessera TEXT DEFAULT 'NON TESSERATO',
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- TABELLA: utenti (autenticazione)
CREATE TABLE IF NOT EXISTS utenti (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- FUNZIONE: calcola_costo
-- Calcola il costo del noleggio in base al tipo, tessera e durata
-- =============================================
CREATE OR REPLACE FUNCTION calcola_costo(
  p_tipo TEXT,
  p_tessera TEXT,
  p_tempo_decine NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
  v_prezzo NUMERIC;
  v_blocco NUMERIC;
BEGIN
  IF p_tempo_decine IS NULL OR p_tempo_decine <= 0 THEN
    RETURN 0;
  END IF;

  -- Prezzo in base alla tessera
  IF p_tessera = 'UNIVERSITARIO' THEN
    SELECT prezzo_studenti INTO v_prezzo FROM prezzi WHERE tipo_imbarcazione = p_tipo;
  ELSE
    SELECT prezzo_esterni INTO v_prezzo FROM prezzi WHERE tipo_imbarcazione = p_tipo;
  END IF;

  IF v_prezzo IS NULL THEN
    RETURN 0;
  END IF;

  -- Arrotonda per eccesso al blocco da 10 minuti
  v_blocco := CEIL(p_tempo_decine);

  -- Costo = prezzo * (blocchi * 10 min / 60 min)
  RETURN ROUND(v_prezzo * (v_blocco * 10.0 / 60.0), 2);
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- TRIGGER: calcolo automatico tempo e costo
-- =============================================
CREATE OR REPLACE FUNCTION trigger_calcola_noleggio()
RETURNS TRIGGER AS $$
DECLARE
  v_minuti_uscita INTEGER;
  v_minuti_rientro INTEGER;
  v_minuti_diff INTEGER;
BEGIN
  -- Calcola tempo se entambi gli orari sono presenti
  IF NEW.ora_uscita IS NOT NULL AND NEW.ora_rientro IS NOT NULL THEN
    v_minuti_uscita := EXTRACT(HOUR FROM NEW.ora_uscita) * 60 + EXTRACT(MINUTE FROM NEW.ora_uscita);
    v_minuti_rientro := EXTRACT(HOUR FROM NEW.ora_rientro) * 60 + EXTRACT(MINUTE FROM NEW.ora_rientro);
    v_minuti_diff := v_minuti_rientro - v_minuti_uscita;

    IF v_minuti_diff >= 0 THEN
      NEW.tempo := v_minuti_diff / 60.0;
      NEW.tempo_decine := v_minuti_diff / 10.0;
    ELSE
      NEW.tempo := 0;
      NEW.tempo_decine := 0;
    END IF;
  ELSE
    NEW.tempo := NULL;
    NEW.tempo_decine := NULL;
  END IF;

  -- Calcola costo (tranne per ABBONATO)
  IF NEW.tipologia = 'ABBONATO' THEN
    NEW.costo := 0;
  ELSIF NEW.ora_uscita IS NOT NULL AND NEW.ora_rientro IS NOT NULL THEN
    NEW.costo := calcola_costo(NEW.tipo_imbarcazione, NEW.tessera, NEW.tempo_decine);
  ELSE
    NEW.costo := 0;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_noleggio ON noleggi;
CREATE TRIGGER trigger_noleggio
  BEFORE INSERT OR UPDATE ON noleggi
  FOR EACH ROW
  EXECUTE FUNCTION trigger_calcola_noleggio();

-- =============================================
-- RLS (Row Level Security)
-- Permetti tutto con anon key (l'app gestisce l'auth lato client)
-- =============================================
ALTER TABLE prezzi ENABLE ROW LEVEL SECURITY;
ALTER TABLE giornate ENABLE ROW LEVEL SECURITY;
ALTER TABLE noleggi ENABLE ROW LEVEL SECURITY;
ALTER TABLE clienti ENABLE ROW LEVEL SECURITY;
ALTER TABLE utenti ENABLE ROW LEVEL SECURITY;

-- Policy: permetti tutto per utenti autenticati
CREATE POLICY "Allow all for authenticated" ON prezzi FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON giornate FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON noleggi FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON clienti FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON utenti FOR ALL USING (true);

-- =============================================
-- SEED: prezzi iniziali (17 imbarcazioni)
-- =============================================
INSERT INTO prezzi (tipo_imbarcazione, prezzo_studenti, prezzo_esterni) VALUES
  ('CANOA SINGOLA', 5, 10),
  ('CANOA DOPPIA', 10, 20),
  ('SUP', 5, 10),
  ('WINDSURF', 10, 20),
  ('DERIVA SINGOLA', 10, 20),
  ('DERIVA DOPPIA', 15, 30),
  ('DERIVA MULTIPLA', 20, 35),
  ('CANOTAGGIO', 10, 25),
  ('CANOTAGGIO DOPPIO', 15, 30),
  ('CABINATO', 35, 40),
  ('LASER', 10, 20),
  ('LASER 2', 15, 30),
  ('SNIPE', 15, 30),
  ('470', 15, 30),
  ('420', 15, 30),
  ('555', 20, 35),
  ('OMEGA', 20, 35)
ON CONFLICT (tipo_imbarcazione) DO NOTHING;

-- =============================================
-- SEED: utente admin (password: admin)
-- SHA-256 hash di "admin": 8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918
-- =============================================
INSERT INTO utenti (username, password_hash, role) VALUES
  ('admin', '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', 'admin')
ON CONFLICT (username) DO NOTHING;
