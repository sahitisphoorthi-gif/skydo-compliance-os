require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { authenticate, requireRole, login } = require('./auth');
const audit = require('./audit');
const { configs, request: integrationRequest } = require('./integrations');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: corsOrigin, credentials: corsOrigin !== '*' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 50 }));

app.get('/api/health', async (req, res) => {
  try {
    await db.ping();
    res.json({ ok: true, database: 'mysql', service: 'Skydo Compliance OS API', time: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ ok: false, database: 'unavailable', error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const result = await login(email, password);
    if (!result) return res.status(401).json({ error: 'Invalid credentials' });
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Login failed', details: e.message }); }
});
app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: req.user }));

app.get('/api/users', authenticate, requireRole('admin'), async (req, res) => {
  const rows = await db.all('SELECT id,name,email,role,active,created_at,updated_at FROM users ORDER BY id DESC');
  res.json({ users: rows });
});
app.post('/api/users', authenticate, requireRole('admin'), async (req, res) => {
  const { name, email, password, role = 'analyst' } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });
  if (!['admin', 'analyst', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const info = await db.run('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)', [name, email, hash, role]);
    await audit(req, 'user.create', 'user', info.insertId, { email, role });
    res.status(201).json({ id: info.insertId });
  } catch (e) { res.status(409).json({ error: e.code === 'ER_DUP_ENTRY' ? 'Email already exists' : e.message }); }
});

app.get('/api/tickets', authenticate, async (req, res) => {
  const { status, exporterId, q } = req.query;
  let sql = `SELECT t.*, u.name assigned_name, c.name created_by_name FROM tickets t LEFT JOIN users u ON u.id=t.assigned_to LEFT JOIN users c ON c.id=t.created_by WHERE 1=1`;
  const args = [];
  if (status) { sql += ' AND t.status=?'; args.push(status); }
  if (exporterId) { sql += ' AND t.exporter_id=?'; args.push(exporterId); }
  if (q) { sql += ' AND (t.title LIKE ? OR t.description LIKE ? OR t.exporter_id LIKE ?)'; const x = `%${q}%`; args.push(x, x, x); }
  sql += ' ORDER BY t.created_at DESC';
  res.json({ tickets: await db.all(sql, args) });
});
app.post('/api/tickets', authenticate, async (req, res) => {
  const { exporterId, title, description = '', status = 'open', priority = 'medium', assignedTo = null, externalSystem = null, externalId = null } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });
  const info = await db.run(`INSERT INTO tickets(exporter_id,title,description,status,priority,assigned_to,external_system,external_id,created_by) VALUES(?,?,?,?,?,?,?,?,?)`, [exporterId || null, title, description, status, priority, assignedTo, externalSystem, externalId, req.user.id]);
  await audit(req, 'ticket.create', 'ticket', info.insertId, { title, exporterId });
  res.status(201).json({ ticket: await db.get('SELECT * FROM tickets WHERE id=?', [info.insertId]) });
});
app.patch('/api/tickets/:id', authenticate, async (req, res) => {
  const id = Number(req.params.id);
  const old = await db.get('SELECT * FROM tickets WHERE id=?', [id]);
  if (!old) return res.status(404).json({ error: 'Ticket not found' });
  const allowed = ['exporter_id', 'title', 'description', 'status', 'priority', 'assigned_to', 'external_system', 'external_id'];
  const fields = [], args = [];
  for (const key of allowed) if (Object.prototype.hasOwnProperty.call(req.body, key)) { fields.push(`${key}=?`); args.push(req.body[key]); }
  if (!fields.length) return res.json({ ticket: old });
  args.push(id);
  await db.run(`UPDATE tickets SET ${fields.join(',')} WHERE id=?`, args);
  await audit(req, 'ticket.update', 'ticket', id, { changes: req.body });
  res.json({ ticket: await db.get('SELECT * FROM tickets WHERE id=?', [id]) });
});

app.get('/api/ubos', authenticate, async (req, res) => {
  const exporterId = req.query.exporterId || null;
  const rows = exporterId
    ? await db.all('SELECT * FROM ubos WHERE exporter_id=? ORDER BY created_at DESC', [exporterId])
    : await db.all('SELECT * FROM ubos ORDER BY created_at DESC');
  res.json({ ubos: rows });
});
app.post('/api/ubos', authenticate, async (req, res) => {
  const { exporterId, fullName, designation = '', pan = '', ownershipPercentage = null } = req.body || {};
  if (!exporterId || !fullName) return res.status(400).json({ error: 'exporterId and fullName are required' });
  const info = await db.run('INSERT INTO ubos(exporter_id,full_name,designation,pan,ownership_percentage) VALUES(?,?,?,?,?)', [exporterId, fullName, designation, pan, ownershipPercentage]);
  await audit(req, 'ubo.create', 'ubo', info.insertId, { exporterId, fullName });
  res.status(201).json({ ubo: await db.get('SELECT * FROM ubos WHERE id=?', [info.insertId]) });
});
app.patch('/api/ubos/:id', authenticate, async (req, res) => {
  const id = Number(req.params.id);
  const allowed = { exporterId: 'exporter_id', fullName: 'full_name', designation: 'designation', pan: 'pan', ownershipPercentage: 'ownership_percentage' };
  const fields = [], args = [];
  for (const [k, col] of Object.entries(allowed)) if (k in req.body) { fields.push(`${col}=?`); args.push(req.body[k]); }
  if (!fields.length) return res.status(400).json({ error: 'No changes' });
  args.push(id);
  const info = await db.run(`UPDATE ubos SET ${fields.join(',')} WHERE id=?`, args);
  if (!info.affectedRows) return res.status(404).json({ error: 'UBO not found' });
  await audit(req, 'ubo.update', 'ubo', id, { changes: req.body });
  res.json({ ubo: await db.get('SELECT * FROM ubos WHERE id=?', [id]) });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safe}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });
app.post('/api/documents', authenticate, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  try {
    const { exporterId = null, ticketId = null, documentType = 'other' } = req.body || {};
    const info = await db.run(`INSERT INTO documents(exporter_id,ticket_id,document_type,original_name,stored_name,path,mime_type,size,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?)`, [exporterId, ticketId || null, documentType, req.file.originalname, req.file.filename, req.file.path, req.file.mimetype, req.file.size, req.user.id]);
    await audit(req, 'document.upload', 'document', info.insertId, { exporterId, ticketId, documentType, originalName: req.file.originalname });
    res.status(201).json({ document: await db.get('SELECT id,exporter_id,ticket_id,document_type,original_name,mime_type,size,uploaded_by,created_at FROM documents WHERE id=?', [info.insertId]) });
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/documents', authenticate, async (req, res) => {
  const { exporterId, ticketId } = req.query;
  let sql = 'SELECT id,exporter_id,ticket_id,document_type,original_name,mime_type,size,uploaded_by,created_at FROM documents WHERE 1=1';
  const args = [];
  if (exporterId) { sql += ' AND exporter_id=?'; args.push(exporterId); }
  if (ticketId) { sql += ' AND ticket_id=?'; args.push(ticketId); }
  sql += ' ORDER BY created_at DESC';
  res.json({ documents: await db.all(sql, args) });
});
app.get('/api/documents/:id/download', authenticate, async (req, res) => {
  const row = await db.get('SELECT * FROM documents WHERE id=?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'Document not found' });
  if (!fs.existsSync(row.path)) return res.status(404).json({ error: 'Stored file not found' });
  res.download(row.path, row.original_name);
});

app.get('/api/saved-items', authenticate, async (req, res) => res.json({ items: await db.all('SELECT * FROM saved_items WHERE user_id=? ORDER BY updated_at DESC', [req.user.id]) }));
app.post('/api/saved-items', authenticate, async (req, res) => {
  const { title, content, source = 'Compliance OS' } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: 'title and content are required' });
  await db.run(`INSERT INTO saved_items(user_id,title,content,source) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE content=VALUES(content),source=VALUES(source),updated_at=CURRENT_TIMESTAMP`, [req.user.id, title, content, source]);
  await audit(req, 'saved-item.upsert', 'saved_item', title);
  res.json({ item: await db.get('SELECT * FROM saved_items WHERE user_id=? AND title=?', [req.user.id, title]) });
});
app.delete('/api/saved-items/:id', authenticate, async (req, res) => {
  const info = await db.run('DELETE FROM saved_items WHERE id=? AND user_id=?', [Number(req.params.id), req.user.id]);
  if (!info.affectedRows) return res.status(404).json({ error: 'Item not found' });
  await audit(req, 'saved-item.delete', 'saved_item', req.params.id);
  res.status(204).end();
});

app.post('/api/quiz/attempts', authenticate, async (req, res) => {
  const { participantName, weekKey, score, maxScore, answers = [] } = req.body || {};
  if (!participantName || !weekKey || maxScore == null || score == null) return res.status(400).json({ error: 'participantName, weekKey, score and maxScore are required' });
  if (Number(maxScore) <= 0) return res.status(400).json({ error: 'maxScore must be greater than zero' });
  const percentage = Number(((Number(score) / Number(maxScore)) * 100).toFixed(2));
  try {
    const info = await db.run(`INSERT INTO quiz_attempts(user_id,participant_name,week_key,score,max_score,percentage,answers_json) VALUES(?,?,?,?,?,?,?)`, [req.user.id, participantName, weekKey, score, maxScore, percentage, JSON.stringify(answers)]);
    await audit(req, 'quiz.submit', 'quiz_attempt', info.insertId, { participantName, weekKey, score, maxScore });
    res.status(201).json({ attempt: await db.get('SELECT * FROM quiz_attempts WHERE id=?', [info.insertId]) });
  } catch (e) {
    res.status(409).json({ error: 'This participant has already attempted this week', details: e.message });
  }
});
app.get('/api/quiz/attempts', authenticate, requireRole('admin'), async (req, res) => res.json({ attempts: await db.all('SELECT * FROM quiz_attempts ORDER BY created_at DESC') }));


// Compatibility API for the original Compliance OS modules that previously used the embedded app storage.
app.get('/api/users/profiles', authenticate, async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(x => Number(x)).filter(Boolean);
  if (!ids.length) return res.json({});
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.all(`SELECT id,name,email,role FROM users WHERE id IN (${placeholders})`, ids);
  const profiles = Object.fromEntries(rows.map(r => [String(r.id), { id: r.id, name: r.name, email: r.email, role: r.role }]));
  res.json(profiles);
});

const assetStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `asset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safe}`);
  }
});
const assetUpload = multer({ storage: assetStorage, limits: { fileSize: 20 * 1024 * 1024 } });

app.post('/api/assets', authenticate, assetUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  try {
    await db.run('INSERT INTO assets(id,original_name,path,mime_type,size,created_by) VALUES(?,?,?,?,?,?)', [id, req.file.originalname, req.file.path, req.file.mimetype, req.file.size, req.user.id]);
    await audit(req, 'asset.upload', 'asset', id, { originalName: req.file.originalname });
    res.status(201).json({ id, name: req.file.originalname, size: req.file.size, mimeType: req.file.mimetype });
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: e.message });
  }
});
app.delete('/api/assets/:id', authenticate, async (req, res) => {
  const row = await db.get('SELECT * FROM assets WHERE id=?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Asset not found' });
  await db.run('DELETE FROM assets WHERE id=?', [req.params.id]);
  try { fs.unlinkSync(row.path); } catch {}
  await audit(req, 'asset.delete', 'asset', req.params.id);
  res.status(204).end();
});
app.get('/api/assets/:id/raw', authenticate, async (req, res) => {
  const row = await db.get('SELECT * FROM assets WHERE id=?', [req.params.id]);
  if (!row || !fs.existsSync(row.path)) return res.status(404).json({ error: 'Asset not found' });
  res.type(row.mime_type || 'application/octet-stream');
  res.download(row.path, row.original_name);
});

function mapKbFile(row) {
  return {
    id: row.id, kind: row.kind, assetId: row.asset_id || undefined,
    sheets: row.sheets_json ? JSON.parse(row.sheets_json) : undefined,
    size: Number(row.size || 0), name: row.name, title: row.title, cat: row.cat,
    mod: row.mod, desc: row.description, by: row.by_user, ts: Number(row.ts)
  };
}
app.get('/api/kb/files', authenticate, async (req, res) => {
  const rows = await db.all('SELECT * FROM kb_files ORDER BY ts DESC');
  res.json({ docs: rows.map(mapKbFile) });
});
app.put('/api/kb/files/:id', authenticate, requireRole('admin', 'analyst'), async (req, res) => {
  const v = req.body || {};
  await db.run(`INSERT INTO kb_files(id,kind,asset_id,sheets_json,size,name,title,cat,mod,description,by_user,ts)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE kind=VALUES(kind),asset_id=VALUES(asset_id),sheets_json=VALUES(sheets_json),size=VALUES(size),name=VALUES(name),title=VALUES(title),cat=VALUES(cat),mod=VALUES(mod),description=VALUES(description),by_user=VALUES(by_user),ts=VALUES(ts)`,
    [req.params.id, v.kind || null, v.assetId || null, v.sheets ? JSON.stringify(v.sheets) : null, v.size || 0, v.name || null, v.title || req.params.id, v.cat || 'Other', v.mod || 'library', v.desc || null, req.user.id, Number(v.ts || Date.now())]);
  await audit(req, 'kb-file.upsert', 'kb_file', req.params.id, { title: v.title });
  res.json({ id: req.params.id });
});
app.delete('/api/kb/files/:id', authenticate, requireRole('admin', 'analyst'), async (req, res) => {
  const row = await db.get('SELECT * FROM kb_files WHERE id=?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'File not found' });
  await db.run('DELETE FROM kb_files WHERE id=?', [req.params.id]);
  await audit(req, 'kb-file.delete', 'kb_file', req.params.id);
  res.status(204).end();
});
app.get('/api/kb/overrides', authenticate, async (req, res) => {
  const rows = await db.all('SELECT * FROM kb_overrides');
  res.json({ docs: rows.map(r => ({ id: r.id, assetId: r.asset_id, by: r.by_user, ts: Number(r.ts) })) });
});
app.put('/api/kb/overrides/:id', authenticate, requireRole('admin', 'analyst'), async (req, res) => {
  const v = req.body || {};
  await db.run(`INSERT INTO kb_overrides(id,asset_id,by_user,ts) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE asset_id=VALUES(asset_id),by_user=VALUES(by_user),ts=VALUES(ts)`, [req.params.id, v.assetId || null, req.user.id, Number(v.ts || Date.now())]);
  res.json({ id: req.params.id });
});
app.delete('/api/kb/overrides/:id', authenticate, requireRole('admin', 'analyst'), async (req, res) => {
  await db.run('DELETE FROM kb_overrides WHERE id=?', [req.params.id]);
  res.status(204).end();
});

function mapQuery(row) {
  return { id: row.id, title: row.title, body: row.body, cat: row.cat, by: row.by_name, uid: row.uid, ts: Number(row.ts), status: row.status, solText: row.sol_text || '', solBy: row.sol_by || '', solId: row.sol_id || '', solTs: row.sol_ts ? Number(row.sol_ts) : undefined };
}
app.get('/api/kb/queries', authenticate, async (req, res) => {
  const rows = await db.all('SELECT * FROM kb_queries ORDER BY ts DESC');
  res.json({ docs: rows.map(mapQuery) });
});
app.put('/api/kb/queries/:id', authenticate, async (req, res) => {
  const v = req.body || {};
  await db.run(`INSERT INTO kb_queries(id,title,body,cat,by_name,uid,ts,status,sol_text,sol_by,sol_id,sol_ts)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE title=VALUES(title),body=VALUES(body),cat=VALUES(cat),by_name=VALUES(by_name),uid=VALUES(uid),ts=VALUES(ts),status=VALUES(status),sol_text=VALUES(sol_text),sol_by=VALUES(sol_by),sol_id=VALUES(sol_id),sol_ts=VALUES(sol_ts)`,
    [req.params.id, v.title || '', v.body || '', v.cat || 'General', v.by || req.user.name, v.uid || req.user.id, Number(v.ts || Date.now()), v.status || 'open', v.solText || '', v.solBy || '', v.solId || '', v.solTs ? Number(v.solTs) : null]);
  await audit(req, 'query.upsert', 'kb_query', req.params.id, { title: v.title });
  res.json({ id: req.params.id });
});
app.delete('/api/kb/queries/:id', authenticate, async (req, res) => {
  await db.run('DELETE FROM kb_queries WHERE id=?', [req.params.id]);
  res.status(204).end();
});
app.get('/api/kb/queries/:id/answers', authenticate, async (req, res) => {
  const rows = await db.all('SELECT id,by_name AS by,uid,text,ts FROM kb_query_answers WHERE query_id=? ORDER BY ts ASC', [req.params.id]);
  res.json({ docs: rows.map(r => ({ id: r.id, by: r.by, uid: r.uid, text: r.text, ts: Number(r.ts) })) });
});
app.post('/api/kb/queries/:id/answers', authenticate, async (req, res) => {
  const v = req.body || {};
  const id = `ans${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;
  await db.run('INSERT INTO kb_query_answers(id,query_id,by_name,uid,text,ts) VALUES(?,?,?,?,?,?)', [id, req.params.id, v.by || req.user.name, v.uid || req.user.id, v.text || '', Number(v.ts || Date.now())]);
  await audit(req, 'query.answer', 'kb_query_answer', id, { queryId: req.params.id });
  res.status(201).json({ id });
});
app.get('/api/kb/queries/:id/answers/:answerId', authenticate, async (req, res) => {
  const row = await db.get('SELECT id,by_name AS by,uid,text,ts FROM kb_query_answers WHERE id=? AND query_id=?', [req.params.answerId, req.params.id]);
  if (!row) return res.status(404).json({ error: 'Answer not found' });
  res.json({ id: row.id, by: row.by, uid: row.uid, text: row.text, ts: Number(row.ts) });
});
app.delete('/api/kb/queries/:id/answers/:answerId', authenticate, async (req, res) => {
  await db.run('DELETE FROM kb_query_answers WHERE id=? AND query_id=?', [req.params.answerId, req.params.id]);
  res.status(204).end();
});

app.get('/api/legacy/quiz-scores', authenticate, async (req, res) => {
  const rows = await db.all('SELECT id,participant_name,week_key,score,max_score,percentage,answers_json,created_at FROM quiz_attempts ORDER BY created_at DESC');
  res.json({ docs: rows.map(r => ({ id: String(r.id), name: r.participant_name, week: r.week_key, score: r.score, max: r.max_score, pct: Number(r.percentage), correct: r.answers_json ? JSON.parse(r.answers_json).filter(a => a && a.correct).length : 0, total: r.max_score, secs: 0, viol: 0, ts: new Date(r.created_at).getTime() })) });
});
app.put('/api/legacy/quiz-scores/:id', authenticate, async (req, res) => {
  const v = req.body || {};
  const score = Number(v.score || 0), max = Number(v.max || v.maxScore || 0);
  if (!v.name || !v.week || !max) return res.status(400).json({ error: 'name, week and max are required' });
  try {
    await db.run(`INSERT INTO quiz_attempts(user_id,participant_name,week_key,score,max_score,percentage,answers_json) VALUES(?,?,?,?,?,?,?)`, [req.user.id, v.name, v.week, score, max, Number(v.pct != null ? v.pct : (score / max) * 100), JSON.stringify(v.answers || [])]);
    res.json({ id: req.params.id });
  } catch (e) { res.status(409).json({ error: 'This participant has already attempted this week' }); }
});

app.get('/api/integrations', authenticate, requireRole('admin'), (req, res) => res.json({ integrations: Object.fromEntries(Object.entries(configs).map(([k, v]) => [k, { configured: Boolean(v.baseUrl), baseUrl: v.baseUrl || null }])) }));
app.all('/api/integrations/:name/*path', authenticate, requireRole('admin'), async (req, res) => {
  const name = req.params.name;
  if (!configs[name]) return res.status(404).json({ error: 'Unknown integration' });
  try {
    const result = await integrationRequest(name, req.method, '/' + req.params.path, req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body);
    res.json(result);
  } catch (e) { res.status(e.status || 502).json({ error: e.message, details: e.data || null }); }
});

app.get('/api/audit', authenticate, requireRole('admin'), async (req, res) => {
  const logs = await db.all(`SELECT a.*,u.name user_name,u.email user_email FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 500`);
  res.json({ logs });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));
app.use(express.static(path.join(__dirname, '../public')));
app.get('/*splat', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

const server = app.listen(PORT, '0.0.0.0', () => console.log(`Skydo Compliance OS API running on port ${PORT}`));

async function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  server.close(async () => {
    try { await db.close(); } finally { process.exit(0); }
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
