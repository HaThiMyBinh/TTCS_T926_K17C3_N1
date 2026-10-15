const db = require("../db");
const { HttpError } = require("../errors");
const STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "RESOLVED",
  "REJECTED",
  "CLOSED",
];
async function mine(user, query = {}) {
  const allowed = ["status", "page", "limit"];
  if (Object.keys(query).some((key) => !allowed.includes(key))) {
    throw new HttpError(400, "Tham so loc khong hop le!");
  }
  const status = query.status
    ? String(query.status).trim().toUpperCase()
    : null;
  if (status && !STATUSES.includes(status)) {
    throw new HttpError(400, "Trang thai khong hop le!");
  }
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 10 : Number(query.limit);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new HttpError(400, "page phai >= 1; limit tu 1 den 100!");
  }
  const intern = await db.findInternProfileByEmail(user.email);
  if (!intern) {
    throw new HttpError(404, "Tai khoan chua co ho so Intern!");
  }
  const pool = db.getPool();
  // Bang du phong cho moi truong chua co bang yeu cau ho tro.
  // Neu du an da co bang nay voi schema khac, can doi truy van cho khop.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      intern_id BIGINT UNSIGNED NOT NULL,
      subject VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
      response TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT PULL DEFAULT CURRENT_TIMESTAMP
ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_support_intern_created (intern_id, created_at),
      INDEX idx_support_intern_status (intern_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const where = ["intern_id = ?"];
  const params = [intern.id];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  const whereSql = where.join(" AND ");
  const offset = (page - 1) * limit;
  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM support_requests
     WHERE ${whereSql}`,
    params
  );
  const [items] = await pool.query(
    `SELECT
       id,
       subject,
       description,
       status,
       response,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM support_requests
     WHERE ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const total = Number(countRow.total);
  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
module.exports = { mine };
