const express = require("express");
const db = require("../db");
const { requireRole } = require("../auth");
const router = express.Router();
router.get("/support-requests", requireRole("HR"), async (req, res) => {
  try {
    const allowed = ["status", "type", "internId", "page", "limit"];
    const unknown = Object.keys(req.query).filter(
      (key) => !allowed.includes(key)
    );
    if (unknown.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Tham số không hợp lệ: " + unknown.join(", "),
      });
    }
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const limit = req.query.limit === undefined ? 10 : Number(req.query.limit);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "page phải >= 1 và limit phải từ 1 đến 100.",
      });
    }
    const conditions = [];
    const params = [];
    for (const key of ["status", "type"]) {
      const value = req.query[key];
      if (value !== undefined) {
        if (typeof value !== "string" || !value.trim() || value.length > 100) {
          return res.status(400).json({
            success: false,
            message: "Giá trị bộ lọc " + key + " không hợp lệ.",
          });
        }
        conditions.push("sr." + key + " = ?");
        params.push(value.trim());
      }
    }
    if (req.query.internId !== undefined) {
      const rawId = req.query.internId;
      if (
        typeof rawId !== "string" ||
        !/^[1-9]\d*$/.test(rawId) ||
        !Number.isSafeInteger(Number(rawId))
      ) {
        return res.status(400).json({
          success: false,
          message: "internId phải là số nguyên dương.",
        });
      }
      conditions.push("sr.user_id = ?");
      params.push(Number(rawId));
    }
    const where = conditions.length
      ? " WHERE " + conditions.join(" AND ")
      : "";
    const pool = db.getPool();
    const [countRows] = await pool.query(
      "SELECT COUNT(*) AS total FROM support_requests sr" + where,
      params
    );
    const total = Number(countRows[0].total);
    const offset = (page - 1) * limit;
    const [items] = await pool.query(
      "SELECT sr.id, sr.user_id AS internId, sr.type, sr.content, " +
        "sr.status, sr.created_at AS createdAt " +
        "FROM support_requests sr" + where +
        " ORDER BY sr.created_at DESC, sr.id DESC LIMIT ? OFFSET ?",
      [...params, limit, offset]
    );
    res.set("Cache-Control", "private, no-store");
    return res.status(200).json({
success: true,
      message: "Lấy danh sách yêu cầu hỗ trợ thành công!",
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("[SUPPORT_REQUESTS_LIST]", err);
    return res.status(500).json({
      success: false,
      message: "Không thể lấy danh sách yêu cầu hỗ trợ.",
    });
  }
});
module.exports = router;