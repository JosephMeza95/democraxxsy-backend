import { config } from '../config.js';
import { ApiError, notFound, unauthorized } from '../utils/errors.js';
import { hashToken } from '../utils/ids.js';

// El frontend se abre desde otro origen (localhost:5173), así que hace falta CORS.
// Se autentica con "Authorization: Bearer", no con cookies, por eso "*" es seguro.
export function cors(req, res, next) {
  res.set({
    'Access-Control-Allow-Origin': config.corsOrigin,
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
}

export function cabecerasSeguras(req, res, next) {
  res.set({
    'Cache-Control': 'no-store', // el estado cambia cada pocos segundos
    'X-Content-Type-Options': 'nosniff',
  });
  next();
}

/** Lee el token Bearer. Devuelve null si no vino la cabecera. Lanza 401 si está mal formada. */
function leerToken(req) {
  const cabecera = req.get('Authorization');
  if (!cabecera) return null;
  const [esquema, token, ...resto] = cabecera.trim().split(/\s+/);
  if (esquema?.toLowerCase() !== 'bearer' || !token || resto.length > 0) {
    throw unauthorized('La cabecera Authorization debe ser "Bearer <token>".');
  }
  return token;
}

// Si la partida ya no existe (p. ej. el anfitrión la finalizó) corresponde 404, no 401:
// el frontend muestra mensajes distintos para cada caso.
function exigirPartida(db, partidaId) {
  if (!db.prepare('SELECT 1 FROM partidas WHERE id = ?').get(partidaId)) throw notFound();
}

function jugadorDelToken(db, partidaId, token) {
  return (
    db
      .prepare('SELECT * FROM jugadores WHERE token_hash = ? AND partida_id = ?')
      .get(hashToken(token), partidaId) ?? null
  );
}

/** Exige un token válido de ESTA partida. Deja el jugador en req.actor. */
export const exigirJugador = (db) => (req, res, next) => {
  exigirPartida(db, req.params.id);
  const token = leerToken(req);
  if (!token) throw unauthorized();
  const jugador = jugadorDelToken(db, req.params.id, token);
  if (!jugador) throw unauthorized('Tu sesión no es válida para esta partida.');
  req.actor = jugador;
  next();
};

/** Token opcional: sin token se ve la partida pública (yo = null); con token inválido, 401. */
export const jugadorOpcional = (db) => (req, res, next) => {
  exigirPartida(db, req.params.id);
  const token = leerToken(req);
  if (token) {
    const jugador = jugadorDelToken(db, req.params.id, token);
    if (!jugador) throw unauthorized('Tu sesión no es válida para esta partida.');
    req.actor = jugador;
  } else {
    req.actor = null;
  }
  next();
};

export function noEncontrado(req, res) {
  res.status(404).json({ error: 'Ruta no encontrada.' });
}

// Todos los errores salen como { "error": "mensaje" }, que es lo que lee el frontend.
// eslint-disable-next-line no-unused-vars
export function manejarErrores(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la petición debe ser JSON válido.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'El cuerpo de la petición es demasiado grande.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
}
