import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Columnas de progreso que se pueden marcar. Whitelist para evitar
// inyección por nombre de columna dinámico.
const PROGRESS_COLUMNS = new Set([
  'reto1_done',
  'reto2_done',
  'reto3_field_error',
  'reto3_server_error',
  'reto3_success',
]);

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      email         TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      is_seed       BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS progress (
      user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      reto1_done           BOOLEAN NOT NULL DEFAULT FALSE,
      reto2_done           BOOLEAN NOT NULL DEFAULT FALSE,
      reto3_field_error    BOOLEAN NOT NULL DEFAULT FALSE,
      reto3_server_error   BOOLEAN NOT NULL DEFAULT FALSE,
      reto3_success        BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Tabla de una sola fila que registra si la recompensa ya fue reclamada.
    CREATE TABLE IF NOT EXISTS reward_claim (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      claimed_by  TEXT REFERENCES users(id),
      claimed_at  TIMESTAMPTZ,
      CONSTRAINT single_row CHECK (id = 1)
    );

    INSERT INTO reward_claim (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  `);
}

export async function seedApprentice() {
  const username = process.env.SEED_USERNAME || 'Andrea';
  const password = process.env.SEED_PASSWORD;
  if (!password) {
    console.warn('[seed] SEED_PASSWORD no definido; se omite el sembrado de la cuenta.');
    return;
  }

  const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.rowCount > 0) {
    console.log(`[seed] La cuenta "${username}" ya existe. OK.`);
    return;
  }

  const id = 'u_' + crypto.randomBytes(5).toString('hex');
  const hash = await bcrypt.hash(password, 10);
  const email = `${username.toLowerCase()}@practice.local`;

  await pool.query(
    `INSERT INTO users (id, username, email, password_hash, is_seed)
     VALUES ($1, $2, $3, $4, TRUE)`,
    [id, username, email, hash]
  );
  await pool.query('INSERT INTO progress (user_id) VALUES ($1)', [id]);
  console.log(`[seed] Cuenta "${username}" creada.`);
}

// ── Helpers de usuarios ───────────────────────────────────────

export async function findUserByLogin(login) {
  // Permite iniciar sesión por username o por email.
  const res = await pool.query(
    'SELECT * FROM users WHERE username = $1 OR email = $1 LIMIT 1',
    [login]
  );
  return res.rows[0] || null;
}

export async function findUserByUsername(username) {
  const res = await pool.query('SELECT * FROM users WHERE username = $1 LIMIT 1', [username]);
  return res.rows[0] || null;
}

export async function emailExists(email) {
  const res = await pool.query('SELECT 1 FROM users WHERE email = $1 LIMIT 1', [email]);
  return res.rowCount > 0;
}

export async function usernameExists(username) {
  const res = await pool.query('SELECT 1 FROM users WHERE username = $1 LIMIT 1', [username]);
  return res.rowCount > 0;
}

export async function createUser({ username, email, password }) {
  const id = 'u_' + crypto.randomBytes(5).toString('hex');
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (id, username, email, password_hash, is_seed)
     VALUES ($1, $2, $3, $4, FALSE)`,
    [id, username, email, hash]
  );
  await pool.query('INSERT INTO progress (user_id) VALUES ($1)', [id]);
  return { id, username, email };
}

// ── Helpers de progreso ──────────────────────────────────────

export async function getProgress(userId) {
  const res = await pool.query('SELECT * FROM progress WHERE user_id = $1', [userId]);
  return res.rows[0] || null;
}

export async function setProgressFlag(userId, column) {
  if (!PROGRESS_COLUMNS.has(column)) {
    throw new Error(`Columna de progreso no permitida: ${column}`);
  }
  await pool.query(
    `UPDATE progress SET ${column} = TRUE, updated_at = now() WHERE user_id = $1`,
    [userId]
  );
}

// Intenta reclamar la recompensa de forma atómica.
// Devuelve: 'claimed' (la acaba de reclamar este usuario),
//           'already_self' (ya la tenía este usuario),
//           'already_other' (otra cuenta la reclamó antes).
export async function claimReward(userId) {
  const current = await pool.query('SELECT claimed_by FROM reward_claim WHERE id = 1');
  const claimedBy = current.rows[0]?.claimed_by;
  if (claimedBy) {
    return claimedBy === userId ? 'already_self' : 'already_other';
  }
  const res = await pool.query(
    `UPDATE reward_claim
        SET claimed_by = $1, claimed_at = now()
      WHERE id = 1 AND claimed_by IS NULL
      RETURNING claimed_by`,
    [userId]
  );
  if (res.rowCount === 1) return 'claimed';
  // Carrera: alguien reclamó entre el SELECT y el UPDATE.
  const recheck = await pool.query('SELECT claimed_by FROM reward_claim WHERE id = 1');
  return recheck.rows[0]?.claimed_by === userId ? 'already_self' : 'already_other';
}
