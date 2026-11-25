import { Router } from 'express';
import { exigirJugador, jugadorOpcional } from '../middleware/http.js';
import * as juego from '../services/gameService.js';
import { construirVista } from '../services/gameView.js';
import { badRequest, notFound } from '../utils/errors.js';
import { GAME_ID_RE } from '../utils/ids.js';
import { validarRespuestaId } from '../utils/validate.js';

function cuerpo(req) {
  const body = req.body ?? {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('El cuerpo de la petición debe ser un objeto JSON.');
  }
  return body;
}

export function crearRutasPartidas(db) {
  const router = Router();
  const jugador = exigirJugador(db);
  const vista = (partidaId, actor) => construirVista(db, partidaId, actor);

  router.param('id', (req, res, next, id) => {
    if (!GAME_ID_RE.test(id)) throw notFound();
    next();
  });

  router.post('/', (req, res) => {
    const { partidaId, jugadorId, token } = juego.crearPartida(db, cuerpo(req));
    res.status(201).json(respuestaDeSesion(db, partidaId, jugadorId, token));
  });


  router.post('/:id/jugadores', (req, res) => {
    const { partidaId, jugadorId, token } = juego.unirse(db, req.params.id, cuerpo(req));
    res.status(201).json(respuestaDeSesion(db, partidaId, jugadorId, token));
  });

  router.get('/:id', jugadorOpcional(db), (req, res) => {
    const partida = vista(req.params.id, req.actor);
    if (!partida) throw notFound();
    res.json(partida);
  });

  router.post('/:id/iniciar', jugador, (req, res) => {
    juego.iniciar(db, req.params.id, req.actor);
    res.json(vista(req.params.id, req.actor));
  });

  router.put('/:id/respuestas', jugador, (req, res) => {
    juego.responder(db, req.params.id, req.actor, cuerpo(req));
    res.json(vista(req.params.id, req.actor));
  });

  router.put('/:id/votos', jugador, (req, res) => {
    const { respuesta_id } = cuerpo(req);
    validarRespuestaId(respuesta_id);
    juego.votar(db, req.params.id, req.actor, { respuesta_id });
    res.json(vista(req.params.id, req.actor));
  });

  router.post('/:id/decision', jugador, (req, res) => {
    const { respuesta_id } = cuerpo(req);
    validarRespuestaId(respuesta_id);
    juego.decidir(db, req.params.id, req.actor, { respuesta_id });
    res.json(vista(req.params.id, req.actor));
  });

  router.post('/:id/avanzar', jugador, (req, res) => {
    juego.avanzar(db, req.params.id, req.actor);
    res.json(vista(req.params.id, req.actor));
  });

  router.delete('/:id', jugador, (req, res) => {
    juego.eliminar(db, req.params.id, req.actor);
    res.status(204).end();
  });

  return router;
}

function respuestaDeSesion(db, partidaId, jugadorId, token) {
  const actor = db.prepare('SELECT * FROM jugadores WHERE id = ?').get(jugadorId);
  return {
    partida_id: partidaId,
    jugador_id: jugadorId,
    token,
    partida: construirVista(db, partidaId, actor),
  };
}
