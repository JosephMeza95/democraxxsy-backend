import { crearApp } from './app.js';
import { config } from './config.js';
import { abrirBaseDeDatos } from './db/index.js';
import { limpiarPartidasInactivas } from './services/gameService.js';

const db = abrirBaseDeDatos(config.dbPath);
const app = crearApp(db);

const servidor = app.listen(config.port, config.host, () => {
  console.log(`DemocraXSSy escuchando en http://${config.host}:${config.port}`);
});

const ttlMs = config.partidaTtlHoras * 60 * 60 * 1000;
const limpieza = setInterval(() => {
  const borradas = limpiarPartidasInactivas(db, ttlMs);
  if (borradas > 0) console.log(`Se eliminaron ${borradas} partida(s) inactiva(s).`);
}, 10 * 60 * 1000);
limpieza.unref();

function apagar() {
  clearInterval(limpieza);
  servidor.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', apagar);
process.on('SIGTERM', apagar);
