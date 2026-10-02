const multer = require("multer");
const { MAX_FILE_SIZE } = require("../services/documentValidator");

const upload = multer({
  storage: multer.memoryStorage(),
  defParamCharset: "utf8",
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

// Chuẩn hóa lỗi Multer thành response JSON nhất quán với API.
function handleMulterUpload(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();

    const [status, message] = MULTER_ERRORS[err.code] || [
      400,
      "Dữ liệu tải lên không hợp lệ (yêu cầu multipart/form-data)!",
    ];
    return res.status(status).json({
      success: false,
      message,
      error: message,
    });
  });
}

module.exports = { handleMulterUpload };
