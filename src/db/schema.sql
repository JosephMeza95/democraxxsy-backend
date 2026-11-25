
CREATE TABLE IF NOT EXISTS cartas_negras (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  texto  TEXT    NOT NULL UNIQUE,
  elegir INTEGER NOT NULL CHECK (elegir IN (1, 2))   
);

CREATE TABLE IF NOT EXISTS cartas_blancas (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  texto TEXT NOT NULL UNIQUE
);

-- ───────────── Partidas y jugadores ─────────────
CREATE TABLE IF NOT EXISTS partidas (
  id                TEXT    PRIMARY KEY,              
  fase              TEXT    NOT NULL DEFAULT 'sala'
                    CHECK (fase IN ('sala','respuestas','votacion','decision','resultado','terminada')),
  puntos_para_ganar INTEGER NOT NULL CHECK (puntos_para_ganar BETWEEN 1 AND 20),
  anfitrion_id      TEXT,                             
  ganador_id        TEXT,                             
  ronda_actual      INTEGER NOT NULL DEFAULT 0,
  tam_mano          INTEGER NOT NULL DEFAULT 0,       
  creada_en         INTEGER NOT NULL,                 
  actualizada_en    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jugadores (
  id          TEXT    PRIMARY KEY,
  partida_id  TEXT    NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
  nombre      TEXT    NOT NULL,
  token       TEXT    NOT NULL UNIQUE,                
  puntos      INTEGER NOT NULL DEFAULT 0,
  orden       INTEGER NOT NULL,                       
  creado_en   INTEGER NOT NULL,
  UNIQUE (partida_id, orden)
);
CREATE INDEX IF NOT EXISTS idx_jugadores_partida ON jugadores(partida_id);

-- ───────────── Mazo y manos de cada partida ─────────────
-- Una fila por carta blanca y partida. 'orden' es la posición en el mazo.
CREATE TABLE IF NOT EXISTS partida_cartas_blancas (
  partida_id TEXT    NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
  carta_id   INTEGER NOT NULL REFERENCES cartas_blancas(id),
  estado     TEXT    NOT NULL CHECK (estado IN ('mazo','mano','jugada','descarte')),
  jugador_id TEXT    REFERENCES jugadores(id) ON DELETE CASCADE,   -- dueño si está en 'mano'
  orden      INTEGER NOT NULL,
  PRIMARY KEY (partida_id, carta_id)
);
CREATE INDEX IF NOT EXISTS idx_pcb_mazo  ON partida_cartas_blancas(partida_id, estado, orden);
CREATE INDEX IF NOT EXISTS idx_pcb_mano  ON partida_cartas_blancas(partida_id, jugador_id, estado);

-- Cartas negras ya usadas en la partida (para no repetirlas)
CREATE TABLE IF NOT EXISTS partida_cartas_negras_usadas (
  partida_id TEXT    NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
  carta_id   INTEGER NOT NULL REFERENCES cartas_negras(id),
  PRIMARY KEY (partida_id, carta_id)
);

CREATE TABLE IF NOT EXISTS rondas (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  partida_id            TEXT    NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
  numero                INTEGER NOT NULL,
  soberano_id           TEXT    NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  carta_negra_id        INTEGER NOT NULL REFERENCES cartas_negras(id),
  respuesta_ganadora_id TEXT,                         
  ganador_id            TEXT,                         
  frase_ganadora        TEXT,
  respeto_al_pueblo     INTEGER,                     
  UNIQUE (partida_id, numero)
);

CREATE TABLE IF NOT EXISTS respuestas (
  id         TEXT    PRIMARY KEY,                    
  ronda_id   INTEGER NOT NULL REFERENCES rondas(id) ON DELETE CASCADE,
  jugador_id TEXT    NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  cartas     TEXT    NOT NULL,                        
  textos     TEXT    NOT NULL,                        
  frase      TEXT    NOT NULL,                        
  posicion   INTEGER,                                 
  creada_en  INTEGER NOT NULL,
  UNIQUE (ronda_id, jugador_id)
);

CREATE TABLE IF NOT EXISTS votos (
  ronda_id     INTEGER NOT NULL REFERENCES rondas(id) ON DELETE CASCADE,
  jugador_id   TEXT    NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  respuesta_id TEXT    NOT NULL REFERENCES respuestas(id) ON DELETE CASCADE,
  creado_en    INTEGER NOT NULL,
  PRIMARY KEY (ronda_id, jugador_id)
);
CREATE INDEX IF NOT EXISTS idx_votos_respuesta ON votos(respuesta_id);
