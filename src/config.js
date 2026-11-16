// Configuración centralizada. Todo se puede cambiar con variables de entorno (ver .env.example).
const entero = (valor, porDefecto) => {
  const n = Number.parseInt(valor ?? '', 10);
  return Number.isFinite(n) ? n : porDefecto;
};

export const config = {
  port: entero(process.env.PORT, 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? './data/democraxssy.db',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  // Una partida sin actividad durante este tiempo se borra automáticamente.
  partidaTtlHoras: entero(process.env.PARTIDA_TTL_HORAS, 24),
  // Cartas por jugador (se reduce sola si el catálogo no alcanza para 22 jugadores).
  tamManoMax: entero(process.env.TAM_MANO, 7),
};

// Reglas del juego (coinciden con src/gameRules.ts del frontend).
export const reglas = {
  nombreMax: 24,
  puntosMin: 1,
  puntosMax: 20,
  jugadoresMin: 4,
  jugadoresMax: 22,
  respuestasMinParaCerrar: 2,
};
