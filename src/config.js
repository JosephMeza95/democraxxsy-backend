const entero = (valor, porDefecto) => {
  const n = Number.parseInt(valor ?? '', 10);
  return Number.isFinite(n) ? n : porDefecto;
};

export const config = {
  port: entero(process.env.PORT, 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? './data/democraxssy.db',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  partidaTtlHoras: entero(process.env.PARTIDA_TTL_HORAS, 24),
  tamManoMax: entero(process.env.TAM_MANO, 7),
};

export const reglas = {
  nombreMax: 24,
  puntosMin: 1,
  puntosMax: 20,
  jugadoresMin: 4,
  jugadoresMax: 22,
  respuestasMinParaCerrar: 2,
};
