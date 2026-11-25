import { config } from '../config.js';
import { ApiError, notFound, unauthorized } from '../utils/errors.js';

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
    'Cache-Control': 'no-store', 
    'X-Content-Type-Options': 'nosniff',
  });
  next();
}

function leerToken(req) {
  const cabecera = req.get('Authorization');
  if (!cabecera) return null;
  const [esquema, token, ...resto] = cabecera.trim().split(/\s+/);
  if (esquema?.toLowerCase() !== 'bearer' || !token || resto.length > 0) {
    throw unauthorized('La cabecera Authorization debe ser "Bearer <token>".');
  }
  return token;
}

function exigirPartida(db, partidaId) {
  if (!db.prepare('SELECT 1 FROM partidas WHERE id = ?').get(partidaId)) throw notFound();
}

function jugadorDelToken(db, partidaId, token) {
  return (
    db
      .prepare('SELECT * FROM jugadores WHERE token = ? AND partida_id = ?')
      .get(token, partidaId) ?? null
  );
}

export const exigirJugador = (db) => (req, res, next) => {
  exigirPartida(db, req.params.id);
  const token = leerToken(req);
  if (!token) throw unauthorized();
  const jugador = jugadorDelToken(db, req.params.id, token);
  if (!jugador) throw unauthorized('Tu sesión no es válida para esta partida.');
  req.actor = jugador;
  next();
};

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
