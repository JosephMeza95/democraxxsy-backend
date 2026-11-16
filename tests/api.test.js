import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { crearApp } from '../src/app.js';
import { abrirBaseDeDatos } from '../src/db/index.js';
import { armarFrase } from '../src/services/gameService.js';

let servidor;
let base;

before(async () => {
  const db = abrirBaseDeDatos(':memory:');
  servidor = crearApp(db).listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

async function api(metodo, ruta, { token, cuerpo } = {}) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await res.text();
  return { status: res.status, datos: texto ? JSON.parse(texto) : null };
}

async function crearSala(cantidad, puntos = 2) {
  const anfitrion = await api('POST', '/api/partidas', {
    cuerpo: { nombre: 'Jugador1', puntos_para_ganar: puntos },
  });
  assert.equal(anfitrion.status, 201);
  const sesiones = [{ ...anfitrion.datos, nombre: 'Jugador1' }];
  for (let i = 2; i <= cantidad; i++) {
    const r = await api('POST', `/api/partidas/${anfitrion.datos.partida_id}/jugadores`, {
      cuerpo: { nombre: `Jugador${i}` },
    });
    assert.equal(r.status, 201);
    sesiones.push({ ...r.datos, nombre: `Jugador${i}` });
  }
  return { id: anfitrion.datos.partida_id, sesiones };
}

const ver = async (id, s) => (await api('GET', `/api/partidas/${id}`, { token: s.token })).datos;

describe('salud y CORS', () => {
  it('HEAD /api/salud responde 200', async () => {
    assert.equal((await fetch(`${base}/api/salud`, { method: 'HEAD' })).status, 200);
  });
  it('responde el preflight de CORS', async () => {
    const res = await fetch(`${base}/api/partidas`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.match(res.headers.get('access-control-allow-headers'), /Authorization/);
    assert.match(res.headers.get('access-control-allow-methods'), /PUT/);
  });
});

describe('crear y unirse', () => {
  it('crea la partida con el formato esperado por el frontend', async () => {
    const r = await api('POST', '/api/partidas', { cuerpo: { nombre: ' Ana ', puntos_para_ganar: 5 } });
    assert.equal(r.status, 201);
    const { partida_id, jugador_id, token, partida } = r.datos;
    assert.match(partida_id, /^[0-9a-f]{32}$/);
    assert.ok(token.length > 20);
    assert.equal(partida.fase, 'sala');
    assert.equal(partida.anfitrion_id, jugador_id);
    assert.equal(partida.jugadores[0].nombre, 'Ana');
    assert.equal(partida.yo.id, jugador_id);
    assert.equal(partida.ronda, null);
    assert.equal(partida.ganador_id, null);
  });

  it('valida nombre y puntos', async () => {
    for (const cuerpo of [
      { nombre: '', puntos_para_ganar: 5 },
      { nombre: 'x'.repeat(25), puntos_para_ganar: 5 },
      { nombre: 'Ana\nB', puntos_para_ganar: 5 },
      { nombre: 'Ana', puntos_para_ganar: 0 },
      { nombre: 'Ana', puntos_para_ganar: 21 },
      { nombre: 'Ana', puntos_para_ganar: 2.5 },
      { nombre: 'Ana', puntos_para_ganar: '5' },
    ]) {
      const r = await api('POST', '/api/partidas', { cuerpo });
      assert.equal(r.status, 400, JSON.stringify(cuerpo));
      assert.equal(typeof r.datos.error, 'string');
    }
  });

  it('rechaza JSON roto con 400', async () => {
    const res = await fetch(`${base}/api/partidas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{no es json',
    });
    assert.equal(res.status, 400);
    assert.equal(typeof (await res.json()).error, 'string');
  });

  it('404 si la partida no existe y 409 si el nombre se repite', async () => {
    const inexistente = '0'.repeat(32);
    assert.equal((await api('POST', `/api/partidas/${inexistente}/jugadores`, { cuerpo: { nombre: 'A' } })).status, 404);
    assert.equal((await api('GET', `/api/partidas/${inexistente}`)).status, 404);
    assert.equal((await api('GET', '/api/partidas/malformado')).status, 404);

    const { id } = await crearSala(1);
    const r = await api('POST', `/api/partidas/${id}/jugadores`, { cuerpo: { nombre: 'jugador1' } });
    assert.equal(r.status, 409);
  });

  it('GET sin token da la vista pública (yo = null); token ajeno da 401', async () => {
    const a = await crearSala(1);
    const b = await crearSala(1);
    const publico = await api('GET', `/api/partidas/${a.id}`);
    assert.equal(publico.status, 200);
    assert.equal(publico.datos.yo, null);
    assert.equal((await api('GET', `/api/partidas/${a.id}`, { token: b.sesiones[0].token })).status, 401);
    assert.equal((await api('GET', `/api/partidas/${a.id}`, { token: 'basura' })).status, 401);
  });
});

describe('iniciar', () => {
  it('exige anfitrión y cantidad par entre 4 y 22', async () => {
    const sala3 = await crearSala(3);
    const a = await api('POST', `/api/partidas/${sala3.id}/iniciar`, { token: sala3.sesiones[0].token });
    assert.equal(a.status, 409);

    const sala5 = await crearSala(5);
    assert.equal((await api('POST', `/api/partidas/${sala5.id}/iniciar`, { token: sala5.sesiones[0].token })).status, 409);

    const sala4 = await crearSala(4);
    const noHost = await api('POST', `/api/partidas/${sala4.id}/iniciar`, { token: sala4.sesiones[1].token });
    assert.equal(noHost.status, 403);
    assert.equal((await api('POST', `/api/partidas/${sala4.id}/iniciar`)).status, 401);

    const ok = await api('POST', `/api/partidas/${sala4.id}/iniciar`, { token: sala4.sesiones[0].token });
    assert.equal(ok.status, 200);
    assert.equal(ok.datos.fase, 'respuestas');
    assert.equal(ok.datos.ronda.numero, 1);
    assert.equal(ok.datos.yo.mano.length, 7);

    const tarde = await api('POST', `/api/partidas/${sala4.id}/jugadores`, { cuerpo: { nombre: 'Tarde' } });
    assert.equal(tarde.status, 409);
  });

  it('admite 22 jugadores y rechaza el 23', async () => {
    const sala = await crearSala(22);
    const extra = await api('POST', `/api/partidas/${sala.id}/jugadores`, { cuerpo: { nombre: 'Extra' } });
    assert.equal(extra.status, 409);
    const ok = await api('POST', `/api/partidas/${sala.id}/iniciar`, { token: sala.sesiones[0].token });
    assert.equal(ok.status, 200);
    // Las manos nunca se repiten entre jugadores.
    const cartas = new Set();
    for (const s of sala.sesiones) {
      for (const c of (await ver(sala.id, s)).yo.mano) {
        assert.ok(!cartas.has(c.id), 'carta repetida entre manos');
        cartas.add(c.id);
      }
    }
  });
});

describe('partida completa de 4 jugadores', () => {
  it('recorre todas las fases hasta terminar y eliminar', async () => {
    const { id, sesiones } = await crearSala(4, 2);
    const host = sesiones[0];
    const por = new Map(sesiones.map((s) => [s.jugador_id, s]));
    await api('POST', `/api/partidas/${id}/iniciar`, { token: host.token });

    const soberanos = [];
    let vista = await ver(id, host);
    let rondas = 0;

    while (vista.fase !== 'terminada') {
      assert.ok(++rondas <= 10, 'la partida no termina');
      const soberano = por.get(vista.ronda.soberano_id);
      const pueblo = sesiones.filter((s) => s !== soberano);
      soberanos.push(soberano.jugador_id);
      const elegir = vista.ronda.carta_negra.elegir;

      // — Respuestas —
      assert.equal(vista.fase, 'respuestas');
      assert.deepEqual(vista.ronda.respuestas, []);
      const rSob = await api('PUT', `/api/partidas/${id}/respuestas`, { token: soberano.token, cuerpo: { cartas: [0] } });
      assert.equal(rSob.status, 403);

      for (const [i, jugador] of pueblo.entries()) {
        const mio = await ver(id, jugador);
        assert.equal(mio.yo.mano.length, 7);
        const cartas = mio.yo.mano.slice(0, elegir).map((c) => c.id);

        if (i === 0) {
          // Errores de validación
          const ajena = (await ver(id, soberano)).yo.mano[0].id;
          assert.equal((await api('PUT', `/api/partidas/${id}/respuestas`, { token: jugador.token, cuerpo: { cartas: [ajena, ...cartas.slice(1)] } })).status, 400);
          assert.equal((await api('PUT', `/api/partidas/${id}/respuestas`, { token: jugador.token, cuerpo: { cartas: [...cartas, cartas[0]] } })).status, 400);
          assert.equal((await api('PUT', `/api/partidas/${id}/respuestas`, { token: jugador.token, cuerpo: { cartas: 'x' } })).status, 400);
        }

        const r = await api('PUT', `/api/partidas/${id}/respuestas`, { token: jugador.token, cuerpo: { cartas } });
        assert.equal(r.status, 200);
        const yo = r.datos.jugadores.find((j) => j.id === jugador.jugador_id);
        assert.equal(yo.ya_respondio, true);
        assert.equal(r.datos.yo.mano.length, 7 - elegir); // las jugadas salen de la mano
        const repetida = await api('PUT', `/api/partidas/${id}/respuestas`, { token: jugador.token, cuerpo: { cartas } });
        assert.ok([409].includes(repetida.status) || r.datos.fase === 'votacion');
        if (i < 2) assert.equal(r.datos.fase, 'respuestas');
      }

      // — Votación (se abrió sola al responder todos) —
      vista = await ver(id, soberano);
      assert.equal(vista.fase, 'votacion');
      assert.equal(vista.ronda.respuestas.length, 3);
      assert.equal(vista.ronda.respuestas_recibidas, 3);
      for (const r of vista.ronda.respuestas) {
        assert.match(r.id, /^[0-9a-f]{12}$/);
        assert.equal(r.autor_id, undefined, 'el autor no se revela votando');
        assert.equal(r.votos, undefined, 'los votos no se ven votando');
        assert.equal(typeof r.frase, 'string');
      }
      assert.equal((await api('PUT', `/api/partidas/${id}/votos`, { token: soberano.token, cuerpo: { respuesta_id: vista.ronda.respuestas[0].id } })).status, 403);
      assert.equal((await api('PUT', `/api/partidas/${id}/votos`, { token: pueblo[0].token, cuerpo: { respuesta_id: 'abcdefabcdef' } })).status, 400);

      const verPueblo = await ver(id, pueblo[0]);
      assert.equal(verPueblo.ronda.respuestas.filter((r) => r.es_mia).length, 1);

      // todos votan por la misma respuesta (la de pueblo[1]) → es la favorita
      const favorita = (await ver(id, pueblo[1])).ronda.respuestas.find((r) => r.es_mia).id;
      for (const jugador of pueblo) {
        const r = await api('PUT', `/api/partidas/${id}/votos`, { token: jugador.token, cuerpo: { respuesta_id: favorita } });
        assert.equal(r.status, 200);
        assert.equal(r.datos.yo.mi_voto, favorita);
        assert.equal((await api('PUT', `/api/partidas/${id}/votos`, { token: jugador.token, cuerpo: { respuesta_id: favorita } })).status, 409);
      }

      // — Decisión —
      vista = await ver(id, soberano);
      assert.equal(vista.fase, 'decision');
      assert.deepEqual(vista.ronda.favoritas_del_pueblo, [favorita]);
      assert.equal(vista.ronda.respuestas.find((r) => r.id === favorita).votos, 3);
      assert.equal((await api('POST', `/api/partidas/${id}/decision`, { token: pueblo[0].token, cuerpo: { respuesta_id: favorita } })).status, 403);

      const decidida = await api('POST', `/api/partidas/${id}/decision`, { token: soberano.token, cuerpo: { respuesta_id: favorita } });
      assert.equal(decidida.status, 200);
      vista = decidida.datos;
      assert.equal(vista.ronda.ganadora, favorita);
      assert.equal(vista.historial.at(-1).respeto_al_pueblo, true);
      assert.ok(vista.ronda.respuestas.every((r) => r.autor_id), 'se revelan los autores');

      if (vista.fase === 'resultado') {
        assert.equal(vista.yo.puede_avanzar, true);
        const ni = pueblo.find((s) => s !== host); // ni anfitrión ni soberano
        assert.equal((await api('POST', `/api/partidas/${id}/avanzar`, { token: ni.token })).status, 403);
        const sig = await api('POST', `/api/partidas/${id}/avanzar`, { token: host.token });
        assert.equal(sig.status, 200);
        vista = sig.datos;
        assert.equal(vista.ronda.numero, rondas + 1);
        assert.notEqual(vista.ronda.soberano_id, soberano.jugador_id, 'el soberano rota');
      }
    }

    // — Final —
    assert.equal(vista.fase, 'terminada');
    const ganador = vista.jugadores.find((j) => j.id === vista.ganador_id);
    assert.equal(ganador.puntos, 2);
    assert.equal(vista.historial.length, rondas);
    assert.equal((await api('POST', `/api/partidas/${id}/avanzar`, { token: host.token })).status, 409);

    // Solo el anfitrión elimina, y solo una partida terminada.
    assert.equal((await api('DELETE', `/api/partidas/${id}`, { token: sesiones[1].token })).status, 403);
    assert.equal((await api('DELETE', `/api/partidas/${id}`, { token: host.token })).status, 204);
    assert.equal((await api('GET', `/api/partidas/${id}`, { token: host.token })).status, 404);
  });

  it('no deja eliminar una partida en curso', async () => {
    const { id, sesiones } = await crearSala(4);
    await api('POST', `/api/partidas/${id}/iniciar`, { token: sesiones[0].token });
    assert.equal((await api('DELETE', `/api/partidas/${id}`, { token: sesiones[0].token })).status, 409);
  });

  it('el anfitrión o soberano cierra etapas con al menos 2 respuestas / sin esperar a todos', async () => {
    const { id, sesiones } = await crearSala(4);
    const host = sesiones[0];
    await api('POST', `/api/partidas/${id}/iniciar`, { token: host.token });
    let v = await ver(id, host);
    const pueblo = sesiones.filter((s) => s.jugador_id !== v.ronda.soberano_id);
    const elegir = v.ronda.carta_negra.elegir;
    const responder = async (s) => {
      const cartas = (await ver(id, s)).yo.mano.slice(0, elegir).map((c) => c.id);
      return api('PUT', `/api/partidas/${id}/respuestas`, { token: s.token, cuerpo: { cartas } });
    };

    await responder(pueblo[0]);
    assert.equal((await api('POST', `/api/partidas/${id}/avanzar`, { token: host.token })).status, 409); // solo 1
    await responder(pueblo[1]);
    const cerrada = await api('POST', `/api/partidas/${id}/avanzar`, { token: host.token });
    assert.equal(cerrada.status, 200);
    assert.equal(cerrada.datos.fase, 'votacion');
    assert.equal(cerrada.datos.ronda.respuestas.length, 2);

    // Cerrar votación sin votos → decisión sin favoritas; el soberano elige libremente.
    const sob = sesiones.find((s) => s.jugador_id === v.ronda.soberano_id);
    const dec = await api('POST', `/api/partidas/${id}/avanzar`, { token: sob.token });
    assert.equal(dec.datos.fase, 'decision');
    assert.deepEqual(dec.datos.ronda.favoritas_del_pueblo, []);
  });
});

describe('armarFrase', () => {
  it('rellena huecos en orden', () => {
    assert.equal(armarFrase('Mi plan: primero ____, después ____.', ['dormir', 'huir']), 'Mi plan: primero dormir, después huir.');
  });
  it('agrega la respuesta al final si no hay huecos', () => {
    assert.equal(armarFrase('¿Qué nos salva?', ['la lotería']), '¿Qué nos salva? la lotería');
  });
});
