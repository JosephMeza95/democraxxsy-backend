import express from 'express';
import {
  cabecerasSeguras,
  cors,
  manejarErrores,
  noEncontrado,
} from './middleware/http.js';
import { crearRutasPartidas } from './routes/partidas.js';

export function crearApp(db) {
  const app = express();
  app.disable('x-powered-by');

  app.use(cors);
  app.use(cabecerasSeguras);
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/salud', (req, res) => res.json({ estado: 'ok' }));
  app.use('/api/partidas', crearRutasPartidas(db));

  app.use(noEncontrado);
  app.use(manejarErrores);
  return app;
}
