import { contarVotos } from './gameService.js';

export function construirVista(db, partidaId, actor) {
  const partida = db.prepare('SELECT * FROM partidas WHERE id = ?').get(partidaId);
  if (!partida) return null;

  const jugadores = db
    .prepare('SELECT * FROM jugadores WHERE partida_id = ? ORDER BY orden')
    .all(partidaId);

  const ronda =
    partida.ronda_actual > 0
      ? db
          .prepare(
            `SELECT r.*, cn.texto AS texto_negra, cn.elegir
               FROM rondas r JOIN cartas_negras cn ON cn.id = r.carta_negra_id
              WHERE r.partida_id = ? AND r.numero = ?`,
          )
          .get(partidaId, partida.ronda_actual)
      : null;

  const respuestas = ronda
    ? db.prepare('SELECT * FROM respuestas WHERE ronda_id = ? ORDER BY posicion, creada_en').all(ronda.id)
    : [];
  const votos = ronda ? db.prepare('SELECT * FROM votos WHERE ronda_id = ?').all(ronda.id) : [];
  const quienRespondio = new Set(respuestas.map((r) => r.jugador_id));
  const quienVoto = new Set(votos.map((v) => v.jugador_id));

  return {
    id: partida.id,
    fase: partida.fase,
    anfitrion_id: partida.anfitrion_id,
    puntos_para_ganar: partida.puntos_para_ganar,
    jugadores: jugadores.map((j) => ({
      id: j.id,
      nombre: j.nombre,
      puntos: j.puntos,
      es_anfitrion: j.id === partida.anfitrion_id,
      es_soberano: ronda ? j.id === ronda.soberano_id : false,
      ya_respondio: quienRespondio.has(j.id),
      ya_voto: quienVoto.has(j.id),
    })),
    ronda: ronda ? vistaRonda(db, partida, ronda, respuestas, votos, actor) : null,
    yo: actor ? vistaJugador(db, partida, ronda, actor, votos) : null,
    historial: db
      .prepare(
        `SELECT numero, frase_ganadora AS frase, ganador_id, respeto_al_pueblo
           FROM rondas WHERE partida_id = ? AND ganador_id IS NOT NULL ORDER BY numero`,
      )
      .all(partidaId)
      .map((h) => ({
        numero: h.numero,
        frase: h.frase,
        ganador_id: h.ganador_id,
        respeto_al_pueblo: h.respeto_al_pueblo === 1,
      })),
    ganador_id: partida.ganador_id,
  };
}

function vistaRonda(db, partida, ronda, respuestas, votos, actor) {
  const fase = partida.fase;
  const mostrarRespuestas = fase !== 'respuestas'; // antes de votar nadie ve las respuestas
  const mostrarVotos = ['decision', 'resultado', 'terminada'].includes(fase);
  const revelarAutores = ['resultado', 'terminada'].includes(fase);
  const { porRespuesta, favoritas } = mostrarVotos
    ? contarVotos(db, ronda.id)
    : { porRespuesta: new Map(), favoritas: [] };

  return {
    numero: ronda.numero,
    soberano_id: ronda.soberano_id,
    carta_negra: { texto: ronda.texto_negra, elegir: ronda.elegir },
    respuestas_recibidas: respuestas.length,
    votos_emitidos: votos.length,
    respuestas: mostrarRespuestas
      ? respuestas.map((r) => ({
          id: r.id,
          cartas: JSON.parse(r.textos),
          frase: r.frase,
          es_mia: actor ? r.jugador_id === actor.id : false,
          ...(mostrarVotos ? { votos: porRespuesta.get(r.id) ?? 0 } : {}),
          ...(revelarAutores ? { autor_id: r.jugador_id } : {}),
        }))
      : [],
    favoritas_del_pueblo: favoritas,
    ganadora: ronda.respuesta_ganadora_id ?? null,
  };
}

function vistaJugador(db, partida, ronda, actor, votos) {
  const mano = db
    .prepare(
      `SELECT c.id, c.texto FROM partida_cartas_blancas pc
         JOIN cartas_blancas c ON c.id = pc.carta_id
        WHERE pc.partida_id = ? AND pc.jugador_id = ? AND pc.estado = 'mano'
        ORDER BY pc.orden`,
    )
    .all(partida.id, actor.id);
  const miVoto = votos.find((v) => v.jugador_id === actor.id);

  const esAnfitrion = actor.id === partida.anfitrion_id;
  const esSoberano = ronda ? actor.id === ronda.soberano_id : false;
  const puedeAvanzar =
    (esAnfitrion || esSoberano) && ['respuestas', 'votacion', 'resultado'].includes(partida.fase);

  return {
    id: actor.id,
    nombre: actor.nombre,
    mano,
    mi_voto: miVoto ? miVoto.respuesta_id : null,
    puede_avanzar: puedeAvanzar,
  };
}
