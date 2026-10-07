// Kiểm tra tệp đính kèm của cập nhật tiến độ: đuôi file, dung lượng, magic bytes.
// Cho phép nhiều loại hơn tài liệu hồ sơ (ảnh chụp màn hình, bảng tính, slide...)
// nhưng vẫn chặn file thực thi giả mạo đổi đuôi.
const { HttpError } = require("../errors");
const { MAX_FILE_SIZE, sanitizeFileName } = require("./documentValidator");
const path = require("path");

const MAX_ATTACHMENTS_PER_TASK = 5;

const OLE = [0xd0, 0xcf, 0x11, 0xe0]; // doc, xls, ppt (định dạng cũ)
const ZIP = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
]; // docx, xlsx, pptx

// MIME suy ra từ đuôi file đã qua kiểm tra, không tin Content-Type do client gửi.
const RULES = {
  ".pdf": {
    mime: "application/pdf",
    signatures: [[0x25, 0x50, 0x44, 0x46, 0x2d]],
  },
  ".doc": { mime: "application/msword", signatures: [OLE] },
  ".docx": {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    signatures: ZIP,
  },
  ".xls": { mime: "application/vnd.ms-excel", signatures: [OLE] },
  ".xlsx": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    signatures: ZIP,
  },
  ".ppt": { mime: "application/vnd.ms-powerpoint", signatures: [OLE] },
  ".pptx": {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    signatures: ZIP,
  },
  ".png": {
    mime: "image/png",
    signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  },
  ".jpg": { mime: "image/jpeg", signatures: [[0xff, 0xd8, 0xff]] },
  ".jpeg": { mime: "image/jpeg", signatures: [[0xff, 0xd8, 0xff]] },
  ".txt": { mime: "text/plain", text: true },
};

const ALLOWED_EXTENSIONS = Object.keys(RULES);
// Ảnh và PDF có thể xem trực tiếp trên trình duyệt; còn lại luôn tải về.
const INLINE_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"];

const BLOCKED_SIGNATURES = [
  [0x4d, 0x5a], // MZ (exe, dll)
  [0x7f, 0x45, 0x4c, 0x46], // ELF
];

const startsWith = (buffer, signature) =>
  buffer.length >= signature.length &&
  signature.every((b, i) => buffer[i] === b);

function validateAttachment({ buffer, originalname }) {
  if (!originalname || typeof originalname !== "string") {
    throw new HttpError(400, "Vui lòng chọn file để đính kèm!");
  }
  if (!buffer || buffer.length === 0) {
    throw new HttpError(
      400,
      "File rỗng (dung lượng 0 byte)! Vui lòng chọn file có nội dung.",
    );
  }
  if (buffer.length > MAX_FILE_SIZE) {
    throw new HttpError(
      413,
      "Dung lượng file vượt quá giới hạn tối đa cho phép là 5MB!",
    );
  }

  const ext = path.extname(originalname).toLowerCase();
  const rule = RULES[ext];
  if (!rule) {
    throw new HttpError(
      400,
      `Định dạng file '${ext}' không được hỗ trợ! Chỉ chấp nhận: ${ALLOWED_EXTENSIONS.join(", ")}.`,
    );
  }

  if (BLOCKED_SIGNATURES.some((sig) => startsWith(buffer, sig))) {
    throw new HttpError(
      400,
      "Phát hiện file thực thi giả mạo được đổi đuôi! Hệ thống từ chối lưu trữ.",
    );
  }

  if (rule.text) {
    // .txt: không được chứa byte NUL (dấu hiệu file nhị phân)
    if (buffer.includes(0x00)) {
      throw new HttpError(
        400,
        "Nội dung file không đúng định dạng văn bản (.txt)!",
      );
    }
  } else if (!rule.signatures.some((sig) => startsWith(buffer, sig))) {
    throw new HttpError(
      400,
      `Nội dung file không đúng định dạng '${ext}' (chữ ký magic bytes không khớp)!`,
    );
  }

  return { ext, cleanName: sanitizeFileName(originalname), mimeType: rule.mime };
}

module.exports = {
  MAX_ATTACHMENTS_PER_TASK,
  ALLOWED_EXTENSIONS,
  INLINE_MIME_TYPES,
  validateAttachment,
};
