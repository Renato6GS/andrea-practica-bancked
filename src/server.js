import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { initSchema, seedApprentice } from './db.js';
import { requireAuth, login, logout, me } from './auth.js';
import { router } from './routes.js';

const app = express();

// CORS con credenciales: el origin debe ser específico (no "*").
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // Permite peticiones sin origin (Postman, curl) y las del frontend.
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`Origen no permitido por CORS: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// Healthcheck público (Railway).
app.get('/health', (req, res) => res.json({ ok: true }));

// Auth.
app.post('/login', login);
app.post('/logout', logout);
app.get('/me', requireAuth, me);

// Retos + recompensa.
app.use('/', router);

// Manejador de errores final.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Error interno del servidor. Intenta de nuevo.' });
});

const PORT = process.env.PORT || 3000;

async function start() {
  if (!process.env.DATABASE_URL) {
    console.error('Falta DATABASE_URL. Define la variable de entorno.');
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    console.error('Falta JWT_SECRET. Define la variable de entorno.');
    process.exit(1);
  }
  await initSchema();
  await seedApprentice();
  app.listen(PORT, () => {
    console.log(`Backend escuchando en el puerto ${PORT}`);
    console.log(`Orígenes CORS permitidos: ${allowedOrigins.join(', ')}`);
  });
}

start().catch((err) => {
  console.error('No se pudo iniciar el servidor:', err);
  process.exit(1);
});
