export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const badRequest = (m) => new ApiError(400, m);
export const unauthorized = (m = 'Falta un token válido para esta partida.') =>
  new ApiError(401, m);
export const forbidden = (m) => new ApiError(403, m);
export const notFound = (m = 'La partida no existe o ya fue eliminada.') =>
  new ApiError(404, m);
export const conflict = (m) => new ApiError(409, m);
