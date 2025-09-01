const pool = require("./db");

// Save a payment transaction
async function saveTransaction(userId, methodId, amount, currency, status) {
  const result = await pool.query(
    `INSERT INTO transactions (user_id, method_id, amount, currency, status, created_at)
     VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
    [userId, methodId, amount, currency, status]
  );
  return result.rows[0];
}

// Refund a transaction
async function refundTransaction(transactionId) {
  const result = await pool.query(
    `UPDATE transactions SET status='REFUNDED' WHERE id=$1 RETURNING *`,
    [transactionId]
  );
  return result.rows[0];
}

// Add payment method
async function addPaymentMethod(userId, type, details) {
  const result = await pool.query(
    `INSERT INTO methods (user_id, type, details) VALUES ($1,$2,$3) RETURNING *`,
    [userId, type, details]
  );
  return result.rows[0];
}

// List payment methods
async function listPaymentMethods(userId) {
  const result = await pool.query(
    `SELECT * FROM methods WHERE user_id=$1`,
    [userId]
  );
  return result.rows;
}

module.exports = {
  saveTransaction,
  refundTransaction,
  addPaymentMethod,
  listPaymentMethods,
};
