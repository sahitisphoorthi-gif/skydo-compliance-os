const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
require('dotenv').config();

const secret = process.env.JWT_SECRET || 'development-only-secret-change-me';

function sign(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, secret, { expiresIn: process.env.JWT_EXPIRES_IN || '12h' });
}

async function authenticate(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, secret);
    const user = await db.get('SELECT id,name,email,role,active FROM users WHERE id=?', [decoded.id]);
    if (!user || !user.active) return res.status(401).json({ error: 'User inactive or not found' });
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' });
}

async function login(email, password) {
  const user = await db.get('SELECT * FROM users WHERE LOWER(email)=LOWER(?)', [email]);
  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) return null;
  return { token: sign(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } };
}

module.exports = { authenticate, requireRole, login, sign };
