import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aquí = dirname(fileURLToPath(import.meta.url));
const leerJson = (archivo) =>
  JSON.parse(readFileSync(resolve(aquí, '../data', archivo), 'utf8'));

export function abrirBaseDeDatos(ruta) {
  if (ruta !== ':memory:') {
    mkdirSync(dirname(resolve(ruta)), { recursive: true });
  }
  const db = new Database(ruta);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(readFileSync(resolve(aquí, 'schema.sql'), 'utf8'));
  cargarCartas(db);
  return db;
}

function cargarCartas(db) {
  const insertarBlanca = db.prepare('INSERT OR IGNORE INTO cartas_blancas (texto) VALUES (?)');
  const insertarNegra = db.prepare(
    'INSERT OR IGNORE INTO cartas_negras (texto, elegir) VALUES (?, ?)',
  );
  db.transaction(() => {
    for (const texto of leerJson('cartas_blancas.json')) insertarBlanca.run(texto);
    for (const { texto, elegir } of leerJson('cartas_negras.json')) {
      insertarNegra.run(texto, elegir);
    }
  })();
}
