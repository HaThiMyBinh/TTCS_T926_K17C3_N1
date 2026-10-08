// Kiểm tra file tải lên: dung lượng, đuôi, magic bytes, làm sạch tên file
const path = require("path");
const { HttpError } = require("../errors");

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_DOC_TYPES = ["CV", "APPLICATION_LETTER"];

// MIME suy ra từ đuôi file đã qua kiểm tra, không tin Content-Type do client gửi
const CANONICAL_MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const startsWith = (buffer, signature) =>
  buffer.length >= signature.length &&
  signature.every((b, i) => buffer[i] === b);

// File giả mạo bị chặn bất kể đuôi file
const BLOCKED_SIGNATURES = [
  {
    signature: [0x4d, 0x5a], // 'MZ' (exe, dll)
    message:
      "Phát hiện file thực thi (.exe) giả mạo được đổi đuôi! Hệ thống từ chối lưu trữ file nguy hiểm.",
  },
  {
    signature: [0x7f, 0x45, 0x4c, 0x46], // ELF
    message:
      "Phát hiện file thực thi nhị phân giả mạo được đổi đuôi! Không được phép tải lên hệ thống.",
  },
  {
    signature: [0x89, 0x50, 0x4e, 0x47], // PNG
    message:
      "Phát hiện file ảnh PNG được đổi đuôi! Hệ thống chỉ chấp nhận file tài liệu PDF hoặc Word.",
  },
];

// Chữ ký hợp lệ theo đuôi: PDF '%PDF-', DOC (OLE) D0 CF 11 E0, DOCX/ZIP 'PK' + 4 biến thể
const VALID_SIGNATURES = {
  ".pdf": {
    signatures: [[0x25, 0x50, 0x44, 0x46, 0x2d]],
    message:
      "Nội dung file không đúng định dạng PDF hợp lệ (chữ ký magic bytes không khớp)!",
  },
  ".doc": {
    signatures: [[0xd0, 0xcf, 0x11, 0xe0]],
    message:
      "Nội dung file không đúng định dạng Word DOC hợp lệ (chữ ký magic bytes không khớp)!",
  },
  ".docx": {
    signatures: [
      [0x50, 0x4b, 0x03, 0x04],
      [0x50, 0x4b, 0x05, 0x06],
      [0x50, 0x4b, 0x07, 0x08],
    ],
    message:
      "Nội dung file không đúng định dạng Word DOCX hợp lệ (chữ ký magic bytes không khớp)!",
  },
};

// Kiểm tra magic bytes để phát hiện file giả mạo hoặc đổi đuôi
function verifyMagicBytes(buffer, ext) {
  if (!buffer || buffer.length === 0) {
    throw new HttpError(
      400,
      "File rỗng (dung lượng 0 byte)! Vui lòng chọn file có nội dung.",
    );
  }

  for (const { signature, message } of BLOCKED_SIGNATURES) {
    if (startsWith(buffer, signature)) throw new HttpError(400, message);
  }

  const rule = VALID_SIGNATURES[(ext || "").toLowerCase()];
  if (!rule) {
    throw new HttpError(
      400,
      `Định dạng file '${ext}' không được hỗ trợ! Chỉ chấp nhận file .pdf, .doc, .docx.`,
    );
  }
  if (!rule.signatures.some((sig) => startsWith(buffer, sig))) {
    throw new HttpError(400, rule.message);
  }
  return true;
}

// Làm sạch tên file: chống path traversal, bỏ ký tự lạ, khử dấu tiếng Việt
function sanitizeFileName(fileName) {
  if (!fileName || typeof fileName !== "string") return "document";
  let name = path.basename(fileName);
  name = name.replace(/\.\./g, "").replace(/[\/\\]/g, "");

  const ext = path.extname(name);
  let base = path.basename(name, ext);

  // Khử dấu tiếng Việt để an toàn cho tên file và HTTP header
  base = base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đ]/g, "d")
    .replace(/[Đ]/g, "D");

  base = base.replace(/[^a-zA-Z0-9_\-\s]/g, "_").trim();
  base = base.replace(/\s+/g, "_");

  if (!base) base = "document";
  const cleanExt = ext.toLowerCase().replace(/[^a-z0-9.]/g, "");
  return `${base}${cleanExt}`;
}

// Kiểm tra tên, dung lượng và đuôi file
function validateFileMetadata({ originalname, size } = {}) {
  if (!originalname) {
    throw new HttpError(400, "Vui lòng chọn file để tải lên!");
  }

  if (size === undefined || size === null || size <= 0) {
    throw new HttpError(
      400,
      "File rỗng (dung lượng 0 byte)! Vui lòng chọn file có nội dung.",
    );
  }

  if (size > MAX_FILE_SIZE) {
    throw new HttpError(
      413,
      `Dung lượng file (${(size / (1024 * 1024)).toFixed(2)}MB) vượt quá giới hạn tối đa cho phép là 5MB!`,
    );
  }

  const ext = path.extname(originalname).toLowerCase();
  if (!CANONICAL_MIME_BY_EXT[ext]) {
    throw new HttpError(
      400,
      `Định dạng file '${ext}' không được hỗ trợ! Hệ thống chỉ nhận file PDF (.pdf) hoặc Word (.doc, .docx).`,
    );
  }

  return {
    ext,
    cleanName: sanitizeFileName(originalname),
    mimeType: CANONICAL_MIME_BY_EXT[ext],
  };
}

// Kiểm tra cả metadata lẫn nội dung (buffer trong RAM)
function validateFileBuffer({ buffer, originalname, size }) {
  const meta = validateFileMetadata({ originalname, size });
  verifyMagicBytes(buffer, meta.ext);
  return meta;
}

module.exports = {
  MAX_FILE_SIZE,
  ALLOWED_DOC_TYPES,
  verifyMagicBytes,
  sanitizeFileName,
  validateFileMetadata,
  validateFileBuffer,
};
