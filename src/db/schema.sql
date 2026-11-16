-- DemocraXSSy · esquema de la base de datos (SQLite)
-- Convención: nombres en español, igual que el JSON de la API.

-- ───────────── Catálogo de cartas (se carga una vez desde src/data/*.json) ─────────────
CREATE TABLE IF NOT EXISTS cartas_negras (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  texto  TEXT    NOT NULL UNIQUE,
  elegir INTEGER NOT NULL CHECK (elegir IN (1, 2))   -- cuántas cartas blancas pide
);

CREATE TABLE IF NOT EXISTS cartas_blancas (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  texto TEXT NOT NULL UNIQUE
);

-- ───────────── Partidas y jugadores ─────────────
CREATE TABLE IF NOT EXISTS partidas (
  id                TEXT    PRIMARY KEY,              -- 32 caracteres hex en minúscula
  fase              TEXT    NOT NULL DEFAULT 'sala'
                    CHECK (fase IN ('sala','respuestas','votacion','decision','resultado','terminada')),
  puntos_para_ganar INTEGER NOT NULL CHECK (puntos_para_ganar BETWEEN 1 AND 20),
  anfitrion_id      TEXT,                             -- jugadores.id del anfitrión
  ganador_id        TEXT,                             -- se llena al llegar a 'terminada'
  ronda_actual      INTEGER NOT NULL DEFAULT 0,
  tam_mano          INTEGER NOT NULL DEFAULT 0,       -- cartas por jugador (se fija al iniciar)
  creada_en         INTEGER NOT NULL,                 -- epoch en ms
  actualizada_en    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jugadores (
  id          TEXT    PRIMARY KEY,
  partida_id  TEXT    NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
  nombre      TEXT    NOT NULL,
  token_hash  TEXT    NOT NULL UNIQUE,                -- sha256 del token; el token nunca se guarda
  puntos      INTEGER NOT NULL DEFAULT 0,
  orden       INTEGER NOT NULL,                       -- orden de ingreso (define la rotación del soberano)
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

-- ───────────── Rondas, respuestas y votos ─────────────
CREATE TABLE IF NOT EXISTS rondas (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  partida_id            TEXT    NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
  numero                INTEGER NOT NULL,
  soberano_id           TEXT    NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  carta_negra_id        INTEGER NOT NULL REFERENCES cartas_negras(id),
  respuesta_ganadora_id TEXT,                         -- respuestas.id elegida por el soberano
  ganador_id            TEXT,                         -- jugador autor de la respuesta ganadora
  frase_ganadora        TEXT,
  respeto_al_pueblo     INTEGER,                      -- 1 si el soberano eligió una favorita del pueblo
  UNIQUE (partida_id, numero)
);

CREATE TABLE IF NOT EXISTS respuestas (
  id         TEXT    PRIMARY KEY,                     -- 12 caracteres hex
  ronda_id   INTEGER NOT NULL REFERENCES rondas(id) ON DELETE CASCADE,
  jugador_id TEXT    NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  cartas     TEXT    NOT NULL,                        -- JSON: ids de cartas blancas, en el orden elegido
  textos     TEXT    NOT NULL,                        -- JSON: textos de esas cartas (foto del momento)
  frase      TEXT    NOT NULL,                        -- carta negra con los huecos ya rellenados
  posicion   INTEGER,                                 -- orden aleatorio visible al abrir la votación
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
