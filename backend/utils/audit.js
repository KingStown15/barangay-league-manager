function logAction(db, { userId, action, entityType, entityId, details }) {
  try {
    db.prepare(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details_json)
       VALUES (?, ?, ?, ?, ?)`
    ).run(userId || null, action, entityType || null, entityId || null, details ? JSON.stringify(details) : null);
  } catch (err) {
    // Audit logging should never break the primary request.
    console.error('Audit log failed:', err.message);
  }
}

module.exports = { logAction };
