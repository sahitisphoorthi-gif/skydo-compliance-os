const db = require('./db');
async function audit(req, action, entityType, entityId, metadata = {}) {
  return db.run(
    `INSERT INTO audit_logs(user_id,action,entity_type,entity_id,metadata_json,ip) VALUES(?,?,?,?,?,?)`,
    [req.user?.id || null, action, entityType || null, entityId == null ? null : String(entityId), JSON.stringify(metadata), req.ip || null]
  );
}
module.exports = audit;
