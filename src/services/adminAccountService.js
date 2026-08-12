import bcrypt from 'bcryptjs';
import AdminAccount from '../models/AdminAccount.js';

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;

/**
 * Ensure at least one admin exists (seeded from env on first boot).
 */
export const ensureAdminBootstrap = async () => {
  const count = await AdminAccount.count();
  if (count > 0) return;

  const login = process.env.ADMIN_LOGIN;
  const password = process.env.ADMIN_PASSWORD;
  if (!login || !password) {
    console.warn(
      '⚠️ No admin_accounts row and ADMIN_LOGIN/ADMIN_PASSWORD unset — admin login will fail'
    );
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await AdminAccount.create({ login, passwordHash });
  console.log('🔐 Seeded admin_accounts from ADMIN_LOGIN / ADMIN_PASSWORD');
};

/**
 * @param {string} login
 * @param {string} password
 * @returns {Promise<{ ok: true, login: string } | { ok: false, message: string }>}
 */
export const verifyAdminCredentials = async (login, password) => {
  if (!login || !password) {
    return { ok: false, message: 'Admin login and password are required' };
  }

  await ensureAdminBootstrap();

  let account = await AdminAccount.findOne({ where: { login } });

  // Legacy fallback: env credentials if no matching DB row yet
  if (!account) {
    if (
      login === process.env.ADMIN_LOGIN &&
      password === process.env.ADMIN_PASSWORD
    ) {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      account = await AdminAccount.create({ login, passwordHash });
      return { ok: true, login: account.login };
    }
    return { ok: false, message: 'Invalid admin credentials' };
  }

  const match = await bcrypt.compare(password, account.passwordHash);
  if (!match) {
    return { ok: false, message: 'Invalid admin credentials' };
  }
  return { ok: true, login: account.login };
};

/**
 * Change password for an authenticated admin login.
 */
export const changeAdminPassword = async ({
  login,
  currentPassword,
  newPassword,
}) => {
  if (!login) return { ok: false, message: 'Not authenticated' };
  if (!currentPassword || !newPassword) {
    return { ok: false, message: 'Current and new password are required' };
  }
  if (String(newPassword).length < 8) {
    return { ok: false, message: 'New password must be at least 8 characters' };
  }
  if (currentPassword === newPassword) {
    return { ok: false, message: 'New password must differ from current password' };
  }

  const verified = await verifyAdminCredentials(login, currentPassword);
  if (!verified.ok) {
    return { ok: false, message: 'Current password is incorrect' };
  }

  const account = await AdminAccount.findOne({ where: { login } });
  if (!account) {
    return { ok: false, message: 'Admin account not found' };
  }

  const passwordHash = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
  await account.update({ passwordHash });
  return { ok: true, message: 'Password updated' };
};
