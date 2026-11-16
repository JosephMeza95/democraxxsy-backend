import { reglas } from '../config.js';
import { badRequest } from './errors.js';

const CARACTERES_DE_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function validarNombre(valor) {
  if (typeof valor !== 'string') {
    throw badRequest('El nombre es obligatorio.');
  }
  if (CARACTERES_DE_CONTROL.test(valor)) {
    throw badRequest('El nombre no puede contener saltos de línea ni caracteres de control.');
  }
  const nombre = valor.trim();
  const largo = Array.from(nombre).length;
  if (largo < 1 || largo > reglas.nombreMax) {
    throw badRequest(`El nombre debe tener entre 1 y ${reglas.nombreMax} caracteres.`);
  }
  return nombre;
}

export function validarPuntos(valor) {
  if (valor === undefined || valor === null) {
    return 5; // valor por defecto si el cliente no lo envía
  }
  if (
    typeof valor !== 'number' ||
    !Number.isInteger(valor) ||
    valor < reglas.puntosMin ||
    valor > reglas.puntosMax
  ) {
    throw badRequest(
      `Los puntos para ganar deben ser un número entero entre ${reglas.puntosMin} y ${reglas.puntosMax}.`,
    );
  }
  return valor;
}

export function validarCartas(valor) {
  if (
    !Array.isArray(valor) ||
    valor.length === 0 ||
    valor.length > 2 ||
    !valor.every((id) => Number.isInteger(id) && id >= 0)
  ) {
    throw badRequest('"cartas" debe ser un arreglo con los ids de las cartas elegidas.');
  }
  return valor;
}

export function validarRespuestaId(valor) {
  if (typeof valor !== 'string' || !/^[0-9a-f]{12}$/.test(valor)) {
    throw badRequest('"respuesta_id" debe ser el id de una respuesta de esta ronda.');
  }
  return valor;
}
