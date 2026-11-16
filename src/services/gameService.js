// Lógica del juego. Cada función pública corre en UNA transacción de SQLite
// (better-sqlite3 es síncrono), así que dos peticiones nunca se mezclan a medias.
import { config, reglas } from '../config.js';
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from '../utils/errors.js';
import {
  elegirUno,
  hashToken,
  mezclar,
  nuevoIdJugador,
  nuevoIdPartida,
  nuevoIdRespuesta,
  nuevoToken,
} from '../utils/ids.js';
import { validarNombre, validarPuntos, validarCartas } from '../utils/validate.js';

const ahora = () => Date.now();
const HUECO = /_{3,}/g;

// ───────────────────────── Consultas auxiliares ─────────────────────────

function obtenerPartida(db, partidaId) {
  const partida = db.prepare('SELECT * FROM partidas WHERE id = ?').get(partidaId);
  if (!partida) throw notFound();
  return partida;
}

const jugadoresDe = (db, partidaId) =>
  db.prepare('SELECT * FROM jugadores WHERE partida_id = ? ORDER BY orden').all(partidaId);

function rondaActual(db, partida) {
  const ronda = db
    .prepare(
      `SELECT r.*, cn.texto AS texto_negra, cn.elegir
         FROM rondas r JOIN cartas_negras cn ON cn.id = r.carta_negra_id
        WHERE r.partida_id = ? AND r.numero = ?`,
    )
    .get(partida.id, partida.ronda_actual);
  if (!ronda) throw conflict('Todavía no hay una ronda activa.');
  return ronda;
}

const tocarPartida = (db, partidaId) =>
  db.prepare('UPDATE partidas SET actualizada_en = ? WHERE id = ?').run(ahora(), partidaId);

/** Rellena los huecos "____" de la carta negra con las cartas elegidas, en orden. */
export function armarFrase(textoNegra, textosBlancos) {
  const restantes = [...textosBlancos];
  let frase = textoNegra.replace(HUECO, () => restantes.shift() ?? '____');
  if (restantes.length > 0) {
    // Pregunta sin huecos: la respuesta va a continuación.
    frase = `${frase} ${restantes.join(' / ')}`;
  }
  return frase;
}

// ───────────────────────── Crear y unirse ─────────────────────────

function insertarJugador(db, partidaId, nombre, orden) {
  const id = nuevoIdJugador();
  const token = nuevoToken();
  db.prepare(
    `INSERT INTO jugadores (id, partida_id, nombre, token_hash, orden, creado_en)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, partidaId, nombre, hashToken(token), orden, ahora());
  return { jugadorId: id, token };
}

export function crearPartida(db, { nombre, puntos_para_ganar }) {
  const nombreValido = validarNombre(nombre);
  const puntos = validarPuntos(puntos_para_ganar);

  return db.transaction(() => {
    const partidaId = nuevoIdPartida();
    const t = ahora();
    db.prepare(
      `INSERT INTO partidas (id, puntos_para_ganar, creada_en, actualizada_en)
       VALUES (?, ?, ?, ?)`,
    ).run(partidaId, puntos, t, t);
    const { jugadorId, token } = insertarJugador(db, partidaId, nombreValido, 1);
    db.prepare('UPDATE partidas SET anfitrion_id = ? WHERE id = ?').run(jugadorId, partidaId);
    return { partidaId, jugadorId, token };
  })();
}

export function unirse(db, partidaId, { nombre }) {
  const nombreValido = validarNombre(nombre);

  return db.transaction(() => {
    const partida = obtenerPartida(db, partidaId);
    if (partida.fase !== 'sala') {
      throw conflict('La partida ya comenzó; no se puede entrar.');
    }
    const jugadores = jugadoresDe(db, partidaId);
    if (jugadores.length >= reglas.jugadoresMax) {
      throw conflict(`La partida está llena (máximo ${reglas.jugadoresMax} jugadores).`);
    }
    const repetido = jugadores.some(
      (j) => j.nombre.toLocaleLowerCase('es') === nombreValido.toLocaleLowerCase('es'),
    );
    if (repetido) {
      throw conflict('Ya hay un jugador con ese nombre en la partida. Elegí otro.');
    }
    const orden = Math.max(...jugadores.map((j) => j.orden)) + 1;
    const { jugadorId, token } = insertarJugador(db, partidaId, nombreValido, orden);
    tocarPartida(db, partidaId);
    return { partidaId, jugadorId, token };
  })();
}

// ───────────────────────── Mazo y manos ─────────────────────────

function reciclarDescarte(db, partidaId) {
  const descarte = db
    .prepare(`SELECT carta_id FROM partida_cartas_blancas WHERE partida_id = ? AND estado = 'descarte'`)
    .all(partidaId)
    .map((f) => f.carta_id);
  if (descarte.length === 0) return;
  const { maximo } = db
    .prepare('SELECT COALESCE(MAX(orden), 0) AS maximo FROM partida_cartas_blancas WHERE partida_id = ?')
    .get(partidaId);
  const volver = db.prepare(
    `UPDATE partida_cartas_blancas
        SET estado = 'mazo', jugador_id = NULL, orden = ?
      WHERE partida_id = ? AND carta_id = ?`,
  );
  mezclar(descarte).forEach((cartaId, i) => volver.run(maximo + 1 + i, partidaId, cartaId));
}

function robarCartas(db, partidaId, jugadorId, cantidad) {
  if (cantidad <= 0) return;
  const tomarDelMazo = () =>
    db
      .prepare(
        `SELECT carta_id FROM partida_cartas_blancas
          WHERE partida_id = ? AND estado = 'mazo' ORDER BY orden LIMIT ?`,
      )
      .all(partidaId, cantidad);

  let cartas = tomarDelMazo();
  if (cartas.length < cantidad) {
    reciclarDescarte(db, partidaId);
    cartas = tomarDelMazo();
  }
  const asignar = db.prepare(
    `UPDATE partida_cartas_blancas SET estado = 'mano', jugador_id = ?
      WHERE partida_id = ? AND carta_id = ?`,
  );
  for (const { carta_id } of cartas) asignar.run(jugadorId, partidaId, carta_id);
}

function repartirManos(db, partida, jugadores) {
  const contar = db.prepare(
    `SELECT COUNT(*) AS n FROM partida_cartas_blancas
      WHERE partida_id = ? AND jugador_id = ? AND estado = 'mano'`,
  );
  for (const jugador of jugadores) {
    const { n } = contar.get(partida.id, jugador.id);
    robarCartas(db, partida.id, jugador.id, partida.tam_mano - n);
  }
}

function armarMazo(db, partidaId) {
  const ids = db.prepare('SELECT id FROM cartas_blancas').all().map((f) => f.id);
  const insertar = db.prepare(
    `INSERT INTO partida_cartas_blancas (partida_id, carta_id, estado, orden)
     VALUES (?, ?, 'mazo', ?)`,
  );
  mezclar(ids).forEach((id, i) => insertar.run(partidaId, id, i));
  return ids.length;
}

function elegirCartaNegra(db, partidaId) {
  const sinUsar = () =>
    db
      .prepare(
        `SELECT id FROM cartas_negras
          WHERE id NOT IN (SELECT carta_id FROM partida_cartas_negras_usadas WHERE partida_id = ?)`,
      )
      .all(partidaId)
      .map((f) => f.id);

  let candidatas = sinUsar();
  if (candidatas.length === 0) {
    db.prepare('DELETE FROM partida_cartas_negras_usadas WHERE partida_id = ?').run(partidaId);
    candidatas = sinUsar();
  }
  const id = elegirUno(candidatas);
  db.prepare('INSERT INTO partida_cartas_negras_usadas (partida_id, carta_id) VALUES (?, ?)').run(
    partidaId,
    id,
  );
  return id;
}

// ───────────────────────── Rondas ─────────────────────────

function comenzarRonda(db, partida, numero) {
  const jugadores = jugadoresDe(db, partida.id);

  // Las cartas jugadas en la ronda anterior se descartan y todos recuperan su mano.
  db.prepare(
    `UPDATE partida_cartas_blancas SET estado = 'descarte', jugador_id = NULL
      WHERE partida_id = ? AND estado = 'jugada'`,
  ).run(partida.id);

  let soberano;
  if (numero === 1) {
    // En la primera ronda el soberano es el anfitrión; después rota en orden de ingreso.
    soberano = jugadores.find((j) => j.id === partida.anfitrion_id);
  } else {
    const anterior = db
      .prepare('SELECT soberano_id FROM rondas WHERE partida_id = ? AND numero = ?')
      .get(partida.id, numero - 1);
    const indice = jugadores.findIndex((j) => j.id === anterior.soberano_id);
    soberano = jugadores[(indice + 1) % jugadores.length];
  }

  db.prepare(
    `INSERT INTO rondas (partida_id, numero, soberano_id, carta_negra_id) VALUES (?, ?, ?, ?)`,
  ).run(partida.id, numero, soberano.id, elegirCartaNegra(db, partida.id));

  repartirManos(db, partida, jugadores);
  db.prepare(`UPDATE partidas SET fase = 'respuestas', ronda_actual = ? WHERE id = ?`).run(
    numero,
    partida.id,
  );
}

function abrirVotacion(db, partida, ronda) {
  const respuestas = db.prepare('SELECT id FROM respuestas WHERE ronda_id = ?').all(ronda.id);
  const asignar = db.prepare('UPDATE respuestas SET posicion = ? WHERE id = ?');
  mezclar(respuestas).forEach((r, i) => asignar.run(i, r.id));
  db.prepare(`UPDATE partidas SET fase = 'votacion' WHERE id = ?`).run(partida.id);
}

/** Votos por respuesta de la ronda y favoritas (las de más votos; vacío si nadie votó). */
export function contarVotos(db, rondaId) {
  const filas = db
    .prepare('SELECT respuesta_id, COUNT(*) AS votos FROM votos WHERE ronda_id = ? GROUP BY respuesta_id')
    .all(rondaId);
  const porRespuesta = new Map(filas.map((f) => [f.respuesta_id, f.votos]));
  const maximo = Math.max(0, ...porRespuesta.values());
  const favoritas = maximo > 0 ? filas.filter((f) => f.votos === maximo).map((f) => f.respuesta_id) : [];
  return { porRespuesta, favoritas };
}

// ───────────────────────── Acciones ─────────────────────────

export function iniciar(db, partidaId, actor) {
  return db.transaction(() => {
    const partida = obtenerPartida(db, partidaId);
    if (partida.fase !== 'sala') throw conflict('Esta partida ya salió de la sala de espera.');
    if (actor.id !== partida.anfitrion_id) {
      throw forbidden('Solo el anfitrión puede iniciar la partida.');
    }
    const jugadores = jugadoresDe(db, partidaId);
    const n = jugadores.length;
    if (n < reglas.jugadoresMin || n > reglas.jugadoresMax || n % 2 !== 0) {
      throw conflict(
        `Para iniciar se necesitan entre ${reglas.jugadoresMin} y ${reglas.jugadoresMax} jugadores, en cantidad par.`,
      );
    }

    const totalBlancas = armarMazo(db, partidaId);
    // Debe alcanzar para las manos y para las respuestas en mesa (hasta 2 cartas c/u).
    const posible = Math.floor((totalBlancas - (n - 1) * 2) / n);
    const tamMano = Math.max(2, Math.min(config.tamManoMax, posible));
    db.prepare('UPDATE partidas SET tam_mano = ? WHERE id = ?').run(tamMano, partidaId);

    comenzarRonda(db, { ...partida, tam_mano: tamMano }, 1);
    tocarPartida(db, partidaId);
  })();
}

export function responder(db, partidaId, actor, { cartas }) {
  const ids = validarCartas(cartas);
  return db.transaction(() => {
    const partida = obtenerPartida(db, partidaId);
    if (partida.fase !== 'respuestas') throw conflict('La ronda ya no está recibiendo respuestas.');
    const ronda = rondaActual(db, partida);
    if (actor.id === ronda.soberano_id) throw forbidden('El soberano espera las respuestas de los demás.');

    const yaRespondio = db
      .prepare('SELECT 1 FROM respuestas WHERE ronda_id = ? AND jugador_id = ?')
      .get(ronda.id, actor.id);
    if (yaRespondio) throw conflict('Tu respuesta ya fue enviada. Esperá a los demás.');

    if (ids.length !== ronda.elegir) {
      throw badRequest(`Seleccioná exactamente ${ronda.elegir} ${ronda.elegir === 1 ? 'carta' : 'cartas'}.`);
    }
    if (new Set(ids).size !== ids.length) throw badRequest('No podés usar la misma carta dos veces.');

    const enMano = db
      .prepare(
        `SELECT c.id, c.texto FROM partida_cartas_blancas pc
           JOIN cartas_blancas c ON c.id = pc.carta_id
          WHERE pc.partida_id = ? AND pc.jugador_id = ? AND pc.estado = 'mano'`,
      )
      .all(partidaId, actor.id);
    const porId = new Map(enMano.map((c) => [c.id, c.texto]));
    if (!ids.every((id) => porId.has(id))) {
      throw badRequest('Elegí únicamente cartas disponibles en tu mano.');
    }

    const textos = ids.map((id) => porId.get(id)); // el orden elegido se conserva
    db.prepare(
      `INSERT INTO respuestas (id, ronda_id, jugador_id, cartas, textos, frase, creada_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      nuevoIdRespuesta(),
      ronda.id,
      actor.id,
      JSON.stringify(ids),
      JSON.stringify(textos),
      armarFrase(ronda.texto_negra, textos),
      ahora(),
    );
    const marcar = db.prepare(
      `UPDATE partida_cartas_blancas SET estado = 'jugada'
        WHERE partida_id = ? AND carta_id = ? AND jugador_id = ?`,
    );
    for (const id of ids) marcar.run(partidaId, id, actor.id);

    // Si ya respondieron todos menos el soberano, la votación se abre sola.
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM respuestas WHERE ronda_id = ?').get(ronda.id);
    if (n >= jugadoresDe(db, partidaId).length - 1) abrirVotacion(db, partida, ronda);
    tocarPartida(db, partidaId);
  })();
}

export function votar(db, partidaId, actor, { respuesta_id }) {
  return db.transaction(() => {
    const partida = obtenerPartida(db, partidaId);
    if (partida.fase !== 'votacion') throw conflict('La votación no está abierta.');
    const ronda = rondaActual(db, partida);
    if (actor.id === ronda.soberano_id) throw forbidden('El soberano no vota; elige la ganadora después.');

    const yaVoto = db
      .prepare('SELECT 1 FROM votos WHERE ronda_id = ? AND jugador_id = ?')
      .get(ronda.id, actor.id);
    if (yaVoto) throw conflict('Tu voto ya fue registrado. Esperá a los demás.');

    const existe = db
      .prepare('SELECT 1 FROM respuestas WHERE id = ? AND ronda_id = ?')
      .get(respuesta_id, ronda.id);
    if (!existe) throw badRequest('Seleccioná una de las respuestas de esta ronda.');

    // Se puede votar por la respuesta propia (lo permite la API).
    db.prepare(
      'INSERT INTO votos (ronda_id, jugador_id, respuesta_id, creado_en) VALUES (?, ?, ?, ?)',
    ).run(ronda.id, actor.id, respuesta_id, ahora());

    const { n } = db.prepare('SELECT COUNT(*) AS n FROM votos WHERE ronda_id = ?').get(ronda.id);
    if (n >= jugadoresDe(db, partidaId).length - 1) {
      db.prepare(`UPDATE partidas SET fase = 'decision' WHERE id = ?`).run(partidaId);
    }
    tocarPartida(db, partidaId);
  })();
}

export function decidir(db, partidaId, actor, { respuesta_id }) {
  return db.transaction(() => {
    const partida = obtenerPartida(db, partidaId);
    if (partida.fase !== 'decision') throw conflict('Todavía no es el momento de elegir la ganadora.');
    const ronda = rondaActual(db, partida);
    if (actor.id !== ronda.soberano_id) throw forbidden('Solo el soberano puede elegir la ganadora.');

    const elegida = db
      .prepare('SELECT * FROM respuestas WHERE id = ? AND ronda_id = ?')
      .get(respuesta_id, ronda.id);
    if (!elegida) throw badRequest('Seleccioná una de las respuestas de esta ronda.');

    // El soberano puede elegir cualquiera; solo se anota si respetó al pueblo.
    const { favoritas } = contarVotos(db, ronda.id);
    const respeto = favoritas.length === 0 || favoritas.includes(elegida.id) ? 1 : 0;

    db.prepare(
      `UPDATE rondas SET respuesta_ganadora_id = ?, ganador_id = ?, frase_ganadora = ?, respeto_al_pueblo = ?
        WHERE id = ?`,
    ).run(elegida.id, elegida.jugador_id, elegida.frase, respeto, ronda.id);
    db.prepare('UPDATE jugadores SET puntos = puntos + 1 WHERE id = ?').run(elegida.jugador_id);

    const { puntos } = db.prepare('SELECT puntos FROM jugadores WHERE id = ?').get(elegida.jugador_id);
    if (puntos >= partida.puntos_para_ganar) {
      db.prepare(`UPDATE partidas SET fase = 'terminada', ganador_id = ? WHERE id = ?`).run(
        elegida.jugador_id,
        partidaId,
      );
    } else {
      db.prepare(`UPDATE partidas SET fase = 'resultado' WHERE id = ?`).run(partidaId);
    }
    tocarPartida(db, partidaId);
  })();
}

export function avanzar(db, partidaId, actor) {
  return db.transaction(() => {
    const partida = obtenerPartida(db, partidaId);
    if (partida.fase === 'sala' || partida.ronda_actual === 0) {
      throw conflict('Todavía no hay una ronda activa.');
    }
    const ronda = rondaActual(db, partida);
    if (actor.id !== partida.anfitrion_id && actor.id !== ronda.soberano_id) {
      throw forbidden('Solo el anfitrión o el soberano puede avanzar la ronda.');
    }

    switch (partida.fase) {
      case 'respuestas': {
        const { n } = db.prepare('SELECT COUNT(*) AS n FROM respuestas WHERE ronda_id = ?').get(ronda.id);
        if (n < reglas.respuestasMinParaCerrar) {
          throw conflict('Esperá al menos dos respuestas antes de abrir la votación.');
        }
        abrirVotacion(db, partida, ronda);
        break;
      }
      case 'votacion':
        db.prepare(`UPDATE partidas SET fase = 'decision' WHERE id = ?`).run(partidaId);
        break;
      case 'resultado':
        comenzarRonda(db, partida, partida.ronda_actual + 1);
        break;
      default:
        throw conflict('No se puede avanzar desde esta fase de la partida.');
    }
    tocarPartida(db, partidaId);
  })();
}

export function eliminar(db, partidaId, actor) {
  return db.transaction(() => {
    const partida = obtenerPartida(db, partidaId);
    if (actor.id !== partida.anfitrion_id) {
      throw forbidden('Solo el anfitrión puede finalizar la partida.');
    }
    if (partida.fase !== 'terminada') throw conflict('La partida todavía no ha terminado.');
    db.prepare('DELETE FROM partidas WHERE id = ?').run(partidaId); // el resto cae en cascada
  })();
}

/** Borra las partidas sin actividad. Devuelve cuántas eliminó. */
export function limpiarPartidasInactivas(db, ttlMs) {
  return db.prepare('DELETE FROM partidas WHERE actualizada_en < ?').run(ahora() - ttlMs).changes;
}
