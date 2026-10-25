import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { findUserByLogin, findUserByUsername } from './db.js';

const COOKIE_NAME = 'session';
const isProd = process.env.NODE_ENV === 'production';

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function cookieOptions() {
  // httpOnly: false a propósito → el aprendiz puede leer/copiar/pegar la
  // cookie manualmente (esa es la lección). En un sistema real iría en true.
  // sameSite 'none' + secure permite que la cookie viaje cross-site (Railway HTTPS).
  return {
    httpOnly: false,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

// Lee el token de la cookie y, opcionalmente, de cabecera (si ALLOW_HEADER_AUTH).
function extractToken(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  if (process.env.ALLOW_HEADER_AUTH === 'true') {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
    if (req.headers['x-session-token']) return req.headers['x-session-token'];
  }
  return null;
}

// Auth abierta: ya no se exige cookie ni key. Si llega una sesión válida se
// usa esa; si no, la petición se atribuye a la cuenta sembrada (Andrea), así
// cualquiera puede consultar los endpoints libremente.
export async function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = { id: payload.sub, username: payload.username };
      return next();
    } catch {
      // Sesión inválida o expirada: se ignora y se usa la cuenta por defecto.
    }
  }
  try {
    const user = await findUserByUsername(process.env.SEED_USERNAME || 'Andrea');
    if (!user) {
      return res.status(500).json({ message: 'No existe la cuenta por defecto.' });
    }
    req.user = { id: user.id, username: user.username };
    return next();
  } catch (err) {
    return next(err);
  }
}

export async function login(req, res) {
  const { username, email, password } = req.body || {};
  const login = username || email;
  if (!login || !password) {
    return res.status(400).json({ message: 'Faltan credenciales.' });
  }
  const user = await findUserByLogin(login);
  if (!user) {
    return res.status(401).json({ message: 'Credenciales inválidas.' });
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ message: 'Credenciales inválidas.' });
  }
  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  return res.json({ id: user.id, username: user.username });
}

export function logout(req, res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  return res.json({ message: 'Sesión cerrada.' });
}

export function me(req, res) {
  return res.json({ id: req.user.id, username: req.user.username });
}
