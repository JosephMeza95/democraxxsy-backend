# DemocraXSSy · Backend

API en **Node.js (Express 5) + SQLite** para el [frontend de DemocraXSSy](../democraxssy-frontend-main).
Reproduce el contrato que usa `src/api/gameApi.ts`, con los mismos nombres de campos JSON.

## Empezar

Requisito: Node.js 22.12 o superior.

```sh
npm install
cp .env.example .env     # opcional
npm start                # http://localhost:3000
npm test                 # 14 pruebas, incluyen una partida completa
```

En la pantalla inicial del frontend, cambien el servidor a `http://localhost:3000`.
(`better-sqlite3` es un módulo nativo; en Linux/macOS/Windows con Node LTS baja un binario ya compilado.)

## Endpoints

| Método y ruta                       | Auth   | Cuerpo                        | Respuesta |
| ----------------------------------- | ------ | ----------------------------- | --------- |
| `HEAD/GET /api/salud`               | no     | —                             | 200       |
| `POST /api/partidas`                | no     | `nombre`, `puntos_para_ganar` | 201 `{partida_id, jugador_id, token, partida}` |
| `POST /api/partidas/{id}/jugadores` | no     | `nombre`                      | 201 igual que arriba |
| `GET /api/partidas/{id}`            | opcional | —                           | 200 `GameView` (con token incluye `yo` y la mano) |
| `POST /api/partidas/{id}/iniciar`   | Bearer | —                             | 200 `GameView` |
| `PUT /api/partidas/{id}/respuestas` | Bearer | `cartas: number[]` (en orden) | 200 `GameView` |
| `PUT /api/partidas/{id}/votos`      | Bearer | `respuesta_id`                | 200 `GameView` |
| `POST /api/partidas/{id}/decision`  | Bearer | `respuesta_id`                | 200 `GameView` |
| `POST /api/partidas/{id}/avanzar`   | Bearer | —                             | 200 `GameView` |
| `DELETE /api/partidas/{id}`         | Bearer | —                             | 204 |

Errores: siempre `{ "error": "mensaje" }` con 400 (datos inválidos), 401 (token), 403 (rol), 404 (partida inexistente), 409 (fase/estado incorrecto).

## Reglas implementadas (deducidas del frontend)

- Nombre 1–24 caracteres sin caracteres de control, único dentro de la partida (sin distinguir mayúsculas). Puntos 1–20.
- Solo se entra en la sala; 4 a 22 jugadores, cantidad par. Solo el anfitrión inicia.
- Fases: `sala → respuestas → votacion → decision → resultado → (siguiente ronda | terminada)`.
- El soberano rota en el orden de ingreso (el de la primera ronda es aleatorio). No responde ni vota.
- **Respuestas**: se envían `elegir` cartas (1 o 2) de la propia mano, en orden; la frase rellena los `____` de la carta negra. Una sola vez por ronda. Cuando responden todos, la votación se abre sola; antes, el anfitrión o el soberano pueden cerrarla con ≥ 2 respuestas.
- **Votación**: un voto por jugador (se permite votar la propia). Las respuestas salen en orden aleatorio, sin autor ni votos. Se pasa sola a `decision` cuando votan todos; antes, el anfitrión o soberano pueden cerrarla.
- **Decisión**: el soberano elige cualquiera; la autora suma 1 punto. `favoritas_del_pueblo` = las más votadas (vacío si nadie votó). `respeto_al_pueblo` es `true` si eligió una favorita (o si no hubo votos).
- **Resultado**: se revelan autores y votos. Al llegar a `puntos_para_ganar` la fase es `terminada` y `ganador_id` se llena; si no, anfitrión o soberano avanzan a la siguiente ronda (se descartan las cartas jugadas y todos reponen su mano).
- `DELETE` solo lo hace el anfitrión con la partida `terminada`; después el `GET` da 404.
- Partidas sin actividad se borran tras `PARTIDA_TTL_HORAS` (24 h).

## Base de datos (`src/db/schema.sql`)

`cartas_blancas`, `cartas_negras` (catálogo, cargado desde `src/data/*.json`), `partidas`, `jugadores` (guarda solo el **hash SHA-256** del token), `partida_cartas_blancas` (mazo/mano/jugada/descarte de cada partida), `partida_cartas_negras_usadas`, `rondas`, `respuestas`, `votos`. Todo cuelga de `partidas` con `ON DELETE CASCADE`.

## Estructura

```
src/server.js            arranque, limpieza periódica, cierre ordenado
src/app.js               Express, CORS, rutas
src/routes/partidas.js   un handler por endpoint
src/services/gameService.js   reglas y transiciones (una transacción por acción)
src/services/gameView.js      arma el JSON GameView (qué se oculta en cada fase)
src/middleware/http.js   CORS, token Bearer, manejo de errores
src/db/                  esquema y apertura de SQLite
src/data/                cartas (agregar cartas = editar los JSON y reiniciar)
tests/api.test.js        pruebas con node:test
```

## Supuestos a contrastar con el OpenAPI del profesor

No pude descargar `openapi.yaml` (el servidor no está accesible desde mi entorno), así que todo sale del frontend. Si algo difiere, los puntos más probables están aquí:

1. Códigos HTTP exactos (se usa 201 al crear/unirse y 204 al eliminar).
2. Tamaño de la mano (7) y el contenido de las cartas.
3. Puntaje: 1 punto por ronda ganada, sin bonificación ni penalización por `respeto_al_pueblo`.
4. Nombres duplicados rechazados con 409.
5. `GET` sin token devuelve la vista pública con `yo: null`.
