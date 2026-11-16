import { createHash, randomBytes, randomInt } from 'node:crypto';

export const GAME_ID_RE = /^[0-9a-f]{32}$/;

export const nuevoIdPartida = () => randomBytes(16).toString('hex'); // 32 hex
export const nuevoIdJugador = () => randomBytes(8).toString('hex'); // 16 hex
export const nuevoIdRespuesta = () => randomBytes(6).toString('hex'); // 12 hex (el frontend lo exige)
export const nuevoToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

// Fisher-Yates con aleatoriedad criptográfica.
export function mezclar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

export const elegirUno = (lista) => lista[randomInt(lista.length)];
