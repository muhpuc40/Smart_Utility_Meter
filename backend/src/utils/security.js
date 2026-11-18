import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// ------------------------------------------------------------
// Passwords
// ------------------------------------------------------------

export function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// ------------------------------------------------------------
// JWT (role = admin | consumer)
// ------------------------------------------------------------

export function signToken(id, role) {
  return jwt.sign({ sub: id, role }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

export function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

// ------------------------------------------------------------
// ESP32 device key
// The plain key is shown once to the admin and flashed into the
// ESP32. Only its sha256 hash is stored.
// ------------------------------------------------------------

export function generateDeviceKey() {
  return crypto.randomBytes(16).toString('hex');
}

export function hashDeviceKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function deviceKeyMatches(key, storedHash) {
  const given = Buffer.from(hashDeviceKey(key), 'hex');
  const stored = Buffer.from(storedHash, 'hex');

  return given.length === stored.length && crypto.timingSafeEqual(given, stored);
}
