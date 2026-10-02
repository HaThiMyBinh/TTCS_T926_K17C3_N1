const express = require("express");
const db = require("../db");
const { hashPassword, verifyPassword, generateToken } = require("../auth");
const { trimOrDefault } = require("../utils/request");
const router = express.Router();
router.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", time: new Date().toISOString() });
});

// POST /api/auth/login
router.post("/auth/login", async (req, res) => {
  try {
    const { account, email, password } = req.body;
    const loginUser = trimOrDefault(account || email);

    if (!loginUser || !password) {
      return res.status(400).json({
        error: "Vui lòng nhập đầy đủ mã tài khoản/email và mật khẩu!",
      });
    }

    const user = await db.findUserForLogin(loginUser);
    const passwordOk =
      user && (await verifyPassword(password, user.password_hash));

    if (!user || !passwordOk) {
      return res
        .status(401)
        .json({ error: "Mã tài khoản hoặc mật khẩu không chính xác!" });
    }

    if (user.status === "LOCKED") {
      return res.status(403).json({
        error: "Tài khoản của bạn đã bị khóa! Vui lòng liên hệ Admin.",
      });
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role || "Intern",
    });

    res.json({
      message: "Đăng nhập thành công!",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role || "Intern",
        status: user.status || "ACTIVE",
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi server khi xử lý đăng nhập!" });
  }
});

// POST /api/auth/register
router.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password, phone, university, major, cvLink } =
      req.body;

    if (!name || !email || !password || !phone || !university) {
      return res
        .status(400)
        .json({ error: "Vui lòng điền đầy đủ các thông tin bắt buộc (*)" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Mật khẩu phải từ 6 ký tự trở lên!" });
    }

    const existing = await db.findUserByEmail(email);
    if (existing) {
      return res.status(400).json({
        error: "Email này đã được sử dụng! Vui lòng nhập email khác.",
      });
    }

    const newCandidate = await db.insertCandidate({
      name: trimOrDefault(name),
      email: trimOrDefault(email).toLowerCase(),
      phone: trimOrDefault(phone),
      university: trimOrDefault(university),
      major: trimOrDefault(major, "Chưa cập nhật"),
      cvLink: trimOrDefault(cvLink),
      password_hash: await hashPassword(password),
      status: "Chờ duyệt",
    });

    res.status(201).json({
      message:
        "Nộp hồ sơ ứng tuyển thành công! Nhà tuyển dụng sẽ sớm liên hệ với bạn.",
      candidate: {
        id: newCandidate.id,
        name: newCandidate.name,
        email: newCandidate.email,
        status: newCandidate.status,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi server xử lý hồ sơ ứng tuyển!" });
  }
});


module.exports = router;


