const express = require("express");
const db = require("../db");
const { hashPassword, verifyPassword, generateToken } = require("../auth");
const { trimOrDefault } = require("../utils/request");
const { HttpError, sendRouteError } = require("../errors");
const router = express.Router();

// POST /api/auth/login
router.post("/auth/login", async (req, res) => {
  try {
    const { account, email, password } = req.body;
    const loginUser = trimOrDefault(account || email);

    if (!loginUser || !password) {
      return sendRouteError(
        res,
        new HttpError(
          400,
          "Vui lòng nhập đầy đủ mã tài khoản/email và mật khẩu!",
        ),
      );
    }

    const user = await db.findUserForLogin(loginUser);
    const passwordOk =
      user && (await verifyPassword(password, user.password_hash));

    if (!user || !passwordOk) {
      return sendRouteError(
        res,
        new HttpError(401, "Mã tài khoản hoặc mật khẩu không chính xác!"),
      );
    }

    if (user.status === "LOCKED") {
      return sendRouteError(
        res,
        new HttpError(
          403,
          "Tài khoản của bạn đã bị khóa! Vui lòng liên hệ Admin.",
        ),
      );
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
    return sendRouteError(res, err, "Lỗi server khi xử lý đăng nhập!");
  }
});

// POST /api/auth/register
router.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password, phone, university, major, cvLink } =
      req.body;

    if (!name || !email || !password || !phone || !university) {
      return sendRouteError(
        res,
        new HttpError(400, "Vui lòng điền đầy đủ các thông tin bắt buộc (*)"),
      );
    }

    if (password.length < 6) {
      return sendRouteError(
        res,
        new HttpError(400, "Mật khẩu phải từ 6 ký tự trở lên!"),
      );
    }

    const applicant = {
      name: trimOrDefault(name),
      email: trimOrDefault(email).toLowerCase(),
      phone: trimOrDefault(phone),
      university: trimOrDefault(university),
      major: trimOrDefault(major, "Chưa cập nhật"),
      cvLink: trimOrDefault(cvLink),
      password_hash: await hashPassword(password),
    };

    let newCandidate;
    let resubmitted = false;
    const existing = await db.findUserByEmail(email);
    if (existing) {
      // Email đã có: chỉ cho nộp lại khi hồ sơ trước đó bị TỪ CHỐI (dùng lại tài khoản + hồ sơ cũ).
      newCandidate = await db.reapplyRejectedCandidate(applicant);
      if (!newCandidate) {
        return sendRouteError(
          res,
          new HttpError(
            400,
            "Email này đã được sử dụng! Vui lòng nhập email khác.",
          ),
        );
      }
      resubmitted = true;
    } else {
      newCandidate = await db.insertCandidate({
        ...applicant,
        status: "Chờ duyệt",
      });
    }

    res.status(201).json({
      message: resubmitted
        ? "Đã nộp lại hồ sơ ứng tuyển! Hồ sơ của bạn đang chờ được xét duyệt lại."
        : "Nộp hồ sơ ứng tuyển thành công! Nhà tuyển dụng sẽ sớm liên hệ với bạn.",
      candidate: {
        id: newCandidate.id,
        name: newCandidate.name,
        email: newCandidate.email,
        status: newCandidate.status,
      },
    });
  } catch (err) {
    return sendRouteError(res, err, "Lỗi server xử lý hồ sơ ứng tuyển!");
  }
});

module.exports = router;
