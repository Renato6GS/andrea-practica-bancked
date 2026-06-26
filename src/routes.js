import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Router } from 'express';
import { requireAuth } from './auth.js';
import {
  emailExists,
  usernameExists,
  createUser,
  getProgress,
  setProgressFlag,
  claimReward,
} from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const reto1 = JSON.parse(readFileSync(join(__dirname, 'data', 'reto1-tabs.json'), 'utf8'));
const reto2 = JSON.parse(readFileSync(join(__dirname, 'data', 'reto2-dropdown.json'), 'utf8'));

const LATENCY = Number(process.env.SIMULATED_LATENCY_MS ?? 800);
const RANDOM_500_RATE = Number(process.env.RANDOM_500_RATE ?? 0.15);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Middleware que simula latencia, para que el estado de "loading" sea real.
function simulateLatency(req, res, next) {
  if (LATENCY > 0) sleep(LATENCY).then(next);
  else next();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const router = Router();

// ── Retos 1 y 2: datos estáticos servidos tras autenticación ──
// Pedirlos marca el reto como "visto". No es verificación real de que
// construyó el componente (imposible desde el server), solo un nudge de
// secuencia para que la recompensa exija haber pasado por aquí.

router.get('/challenges/reto1', requireAuth, simulateLatency, async (req, res) => {
  await setProgressFlag(req.user.id, 'reto1_done');
  res.json(reto1);
});

router.get('/challenges/reto2', requireAuth, simulateLatency, async (req, res) => {
  await setProgressFlag(req.user.id, 'reto2_done');
  res.json(reto2);
});

// ── Reto 3: el formulario de registro (el "gauntlet") ─────────
// El usuario autenticado (Andrea) registra usuarios de prueba. Cada rama
// del contrato marca una fase de su progreso.

router.post('/register', requireAuth, simulateLatency, async (req, res) => {
  const { username, email, password } = req.body || {};
  // Nota: confirmPassword NO se lee aquí. Es validación de cliente (UX).

  // 1) Error de servidor determinista para pruebas.
  if (email === 'error@example.com') {
    await setProgressFlag(req.user.id, 'reto3_server_error');
    return res.status(500).json({ message: 'Error interno del servidor. Intenta de nuevo.' });
  }

  // 2) Validación de formato (el servidor revalida todo).
  const errors = {};
  if (!username || username.length < 3) {
    errors.username = 'El usuario debe tener al menos 3 caracteres';
  }
  if (!email || !EMAIL_RE.test(email)) {
    errors.email = 'Introduce un email válido';
  }
  if (!password || password.length < 8) {
    errors.password = 'La contraseña debe tener al menos 8 caracteres';
  }

  // 3) Unicidad (incluye valores reservados deterministas).
  if (!errors.email) {
    if (email === 'taken@example.com' || (await emailExists(email))) {
      errors.email = 'Este correo ya está registrado';
    }
  }
  if (!errors.username) {
    if (username.toLowerCase() === 'admin' || (await usernameExists(username))) {
      errors.username = 'Este usuario ya está en uso';
    }
  }

  if (Object.keys(errors).length > 0) {
    await setProgressFlag(req.user.id, 'reto3_field_error');
    return res.status(400).json({ errors });
  }

  // 4) 500 aleatorio (~15%) en el camino de éxito, para que el manejo de
  //    error no sea solo teórico.
  if (Math.random() < RANDOM_500_RATE) {
    await setProgressFlag(req.user.id, 'reto3_server_error');
    return res.status(500).json({ message: 'Error interno del servidor. Intenta de nuevo.' });
  }

  // 5) Éxito.
  const user = await createUser({ username, email, password });
  await setProgressFlag(req.user.id, 'reto3_success');
  return res.status(201).json({ id: user.id, username: user.username, email: user.email });
});

// ── Progreso: para que ella pueda construir una UI de avance ──

function summarize(p) {
  return {
    reto1: p.reto1_done,
    reto2: p.reto2_done,
    reto3: {
      errorDeCampo: p.reto3_field_error,
      errorDeServidor: p.reto3_server_error,
      exito: p.reto3_success,
    },
    desbloqueado:
      p.reto1_done && p.reto2_done &&
      p.reto3_field_error && p.reto3_server_error && p.reto3_success,
  };
}

router.get('/progress', requireAuth, async (req, res) => {
  const p = await getProgress(req.user.id);
  if (!p) return res.status(404).json({ message: 'Sin progreso.' });
  res.json(summarize(p));
});

// ── Recompensa: solo si completó todo. Uso único, persistente. ─

router.get('/reward', requireAuth, async (req, res) => {
  const p = await getProgress(req.user.id);
  if (!p) return res.status(404).json({ message: 'Sin progreso.' });

  const missing = [];
  if (!p.reto1_done) missing.push('reto1');
  if (!p.reto2_done) missing.push('reto2');
  if (!p.reto3_field_error) missing.push('reto3:error-de-campo');
  if (!p.reto3_server_error) missing.push('reto3:error-de-servidor');
  if (!p.reto3_success) missing.push('reto3:registro-exitoso');

  if (missing.length > 0) {
    return res.status(403).json({
      message: 'Aún no has desbloqueado la recompensa.',
      missing,
    });
  }

  const result = await claimReward(req.user.id);
  if (result === 'already_other') {
    return res.status(409).json({ message: 'La recompensa ya fue reclamada por otra cuenta.' });
  }
  // 'claimed' o 'already_self' → entregamos el código (idempotente para ella).
  return res.json({
    message: '¡Felicidades! Completaste los tres retos.',
    code: process.env.REWARD_CODE,
  });
});
