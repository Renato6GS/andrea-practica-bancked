# Backend de práctica (mentor)

Backend Node.js + Express + Postgres para que un aprendiz de frontend practique
`fetch`, autenticación por **cookie**, y manejo de estados de carga y error.
Sirve **3 retos** y entrega una **recompensa** (un código) al completarlos.

Solo el mentor toca este backend, la DB y Railway. El aprendiz solo recibe los
endpoints y trabaja en un frontend aparte.

---

## Qué hace

- **Cuenta sembrada** (`Andrea`) lista para que el aprendiz inicie sesión.
- **Auth por cookie firmada (JWT).** Todos los retos y la recompensa van detrás
  de auth. La cookie **no** es `httpOnly` a propósito: así el aprendiz puede
  copiarla de Postman y pegarla a mano en el navegador (la lección que querías).
- **Reto 1 y 2**: datos servidos en `GET /challenges/reto1` y `/reto2`.
- **Reto 3**: `POST /register`, con errores de campo (400), error de servidor
  (500 determinista y aleatorio ~15%), latencia ~800 ms y casos de prueba
  deterministas, tal como el contrato.
- **Recompensa de un solo uso**, persistida en Postgres. El código vive en una
  variable de entorno, nunca en el código.

---

## Variables de entorno

Copia `.env.example` a `.env` para local. En Railway, define las mismas en
**Variables**. Las importantes:

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Postgres. En Railway se inyecta sola al añadir el plugin. |
| `PGSSL` | `true` solo si tu conexión exige SSL (URL pública de Railway). |
| `JWT_SECRET` | Secreto para firmar sesiones. Genera uno largo y aleatorio. |
| `REWARD_CODE` | El código de recompensa. **Solo aquí, nunca en el repo.** |
| `SEED_USERNAME` / `SEED_PASSWORD` | La cuenta del aprendiz (esto sí se lo das tú). |
| `FRONTEND_ORIGIN` | Origen(es) del frontend para CORS. Específico, no `*`. |
| `SIMULATED_LATENCY_MS` | Latencia de los retos (por defecto 800). |
| `RANDOM_500_RATE` | Probabilidad de 500 aleatorio en `/register` (0.15). |
| `ALLOW_HEADER_AUTH` | `false` fuerza el flujo de cookie. `true` permite `Bearer` como salida de emergencia. |

Generar un `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Desplegar en Railway

1. Sube este proyecto a un repo de GitHub.
2. En Railway: **New Project → Deploy from GitHub repo**.
3. En el proyecto: **New → Database → Add PostgreSQL**. Esto inyecta
   `DATABASE_URL` automáticamente en tu servicio.
4. En tu servicio web → **Variables**, añade: `JWT_SECRET`, `REWARD_CODE`,
   `SEED_PASSWORD` (= `byWMqbj9xYJja0H7CjoU`), `FRONTEND_ORIGIN` (la URL de su
   frontend) y `NODE_ENV=production`.
5. Railway corre `npm start` solo. Al arrancar, el backend crea las tablas y
   siembra la cuenta `Andrea`.
6. Si ves errores de SSL al conectar a Postgres, pon `PGSSL=true`.

El esquema y el sembrado se ejecutan en cada arranque de forma idempotente
(no duplican nada).

---

## El flujo de cookie (lo que le explicas al aprendiz)

1. En **Postman**: `POST {URL}/login` con JSON
   `{ "username": "Andrea", "password": "..." }`.
   La respuesta trae un header `Set-Cookie: session=...`.
2. Copia el **valor** de `session`.
3. En el **navegador**, con su frontend abierto: DevTools → Application →
   Cookies → añade una cookie `session` con ese valor para el dominio del
   **backend**. (O por consola si es mismo origen.)
4. Sus `fetch` deben llevar `credentials: 'include'` para que la cookie viaje.

> **Cross-site (frontend y backend en dominios distintos):** para que el
> navegador envíe la cookie, ya está configurada como `SameSite=None; Secure`
> en producción (Railway es HTTPS). El CORS está fijado a `FRONTEND_ORIGIN`
> con `credentials: true`. Si durante el desarrollo local el baile de cookies
> cross-site te bloquea, pon `ALLOW_HEADER_AUTH=true` y deja que mande el token
> por `Authorization: Bearer <token>` mientras tanto. Para la experiencia que
> diseñaste, déjalo en `false`.

---

## Endpoints

Todos menos `/health` y `/login` exigen sesión.

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/health` | Healthcheck público. |
| `POST` | `/login` | Inicia sesión (username o email + password). Setea cookie. |
| `POST` | `/logout` | Borra la cookie. |
| `GET` | `/me` | Devuelve la identidad actual. Útil para depurar la cookie. |
| `GET` | `/challenges/reto1` | Datos de las tabs. Marca reto 1 visto. |
| `GET` | `/challenges/reto2` | Datos del dropdown. Marca reto 2 visto. |
| `POST` | `/register` | Reto 3. Mismo contrato que diste al aprendiz. |
| `GET` | `/progress` | Progreso del usuario (para una UI de avance). |
| `GET` | `/reward` | Entrega el código si completó todo. Un solo uso. |

### Casos deterministas de `/register` (del contrato)

- `email = taken@example.com` → 400 (email ya registrado)
- `username = admin` → 400 (usuario ya en uso)
- `email = error@example.com` → 500 (error de servidor)
- cualquier otro válido → 201 (más un 500 aleatorio ~15%)

`confirmPassword` no se lee en el servidor (validación de cliente, como pediste).
La respuesta 201 nunca incluye `password`.

---

## Cómo se desbloquea la recompensa

`/reward` entrega el código solo cuando el usuario, **estando autenticado**, ha:

- pedido los datos del reto 1 y del reto 2, y
- en el reto 3, provocado las **tres ramas**: un error de campo (400), un error
  de servidor (500) y un registro exitoso (201).

Esto fuerza al aprendiz a recorrer cada caso del contrato (justo lo que hace al
probar su UI). El código se entrega una sola vez: queda marcado en Postgres como
reclamado y ninguna otra cuenta puede obtenerlo después (devuelve 409).

### Lo que esto protege y lo que no

- **Protege** contra un extraño sin credenciales: el código no está en ningún
  sitio que el navegador pueda leer antes de tiempo, vive en variable de entorno,
  y `/reward` lo niega con 403 si no completó los retos.
- **No** impide que alguien con la sesión de Andrea dispare el gauntlet desde
  Postman sin construir la UI. Eso es inevitable desde el backend, y tu aprendiz
  no es la amenaza. Si quisieras cero superficie, la alternativa es que `/reward`
  te **notifique a ti** y tú entregues el regalo a mano.

---

## Local

```bash
cp .env.example .env      # ajusta DATABASE_URL a tu Postgres local
npm install
npm run dev               # node --watch
```
