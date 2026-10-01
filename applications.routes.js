const express = require("express");
const multer = require("multer");
const { requireRole } = require("../auth");
const controller = require("../controllers/applications.controller");
const documentsController = require("../controllers/documents.controller");
const { MAX_FILE_SIZE } = require("../services/documentValidator");

const router = express.Router();

// Multer giữ file trong RAM: validate xong mới ghi đĩa (fileStorage), file không hợp lệ không chạm vào đĩa
const upload = multer({
  storage: multer.memoryStorage(),
  defParamCharset: "utf8", // tên file tiếng Việt
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    fields: 5,
    fieldSize: 1024,
  },
});

const MULTER_ERRORS = {
  LIMIT_FILE_SIZE: [
    413,
    "Dung lượng file vượt quá giới hạn tối đa cho phép là 5MB!",
  ],
  LIMIT_UNEXPECTED_FILE: [
    400,
    "Sai tên trường file! Vui lòng gửi file ở trường 'file' và chỉ gửi 1 file.",
  ],
  LIMIT_FILE_COUNT: [400, "Mỗi lần chỉ được tải lên 1 file!"],
  LIMIT_FIELD_COUNT: [400, "Dữ liệu gửi lên có quá nhiều trường!"],
  LIMIT_FIELD_VALUE: [400, "Giá trị trường gửi lên quá dài!"],
};

// Bọc multer để lỗi trả JSON đúng mã (413 khi quá 5MB, 400 với lỗi multipart khác)
function handleMulterUpload(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    const [status, message] = MULTER_ERRORS[err.code] || [
      400,
      "Dữ liệu tải lên không hợp lệ (yêu cầu multipart/form-data)!",
    ];
    return res.status(status).json({ success: false, message, error: message });
  });
}

// Tài liệu của Intern
router.post(
  "/me/documents",
  requireRole("Intern"),
  handleMulterUpload,
  documentsController.uploadMyDocument,
);

router.get(
  "/me/documents",
  requireRole("Intern"),
  documentsController.getMyDocuments,
);

router.delete(
  "/me/documents/:docId",
  requireRole("Intern"),
  documentsController.deleteMyDocument,
);

// Duyệt / từ chối hồ sơ
router.get("/", requireRole("Admin", "HR"), controller.list);
router.patch("/:id/status", requireRole("HR"), controller.updateStatus);

// Tải xuống tài liệu: chủ hồ sơ hoặc HR
router.get(
  "/:id/documents/:docId/download",
  requireRole("HR", "Intern"),
  documentsController.downloadDocument,
);

module.exports = router;
