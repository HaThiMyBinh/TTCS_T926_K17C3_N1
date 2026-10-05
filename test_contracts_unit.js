const assert = require("node:assert/strict");
const {
  validateFileBuffer,
  MAX_FILE_SIZE,
} = require("../services/documentValidator");
const { HttpError } = require("../errors");
const {
  sendError: sendContractError,
} = require("../controllers/contracts.controller");
const {
  sendError: sendDocumentError,
} = require("../controllers/documents.controller");
const {
  parseId,
  validateDates,
  validateContractText,
  toDto,
} = require("../services/contracts.service");

let passed = 0;
let failed = 0;

function check(name, assertion) {
  try {
    assertion();
    passed += 1;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

function expectHttpError(action, status) {
  assert.throws(
    action,
    (err) => err instanceof HttpError && err.status === status,
  );
}

const validFiles = {
  pdf: Buffer.from("%PDF-1.4\\n"),
  doc: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1]),
  docx: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]),
};

for (const [extension, buffer] of Object.entries(validFiles)) {
  check(`Nhận dạng ${extension.toUpperCase()}`, () => {
    const result = validateFileBuffer({
      buffer,
      originalname: `contract.${extension}`,
      size: buffer.length,
    });
    assert.equal(result.ext, `.${extension}`);
  });
}

check("Từ chối đuôi không hỗ trợ", () => {
  expectHttpError(
    () =>
      validateFileBuffer({
        buffer: validFiles.pdf,
        originalname: "contract.exe",
        size: validFiles.pdf.length,
      }),
    400,
  );
});

check("Từ chối magic bytes giả mạo", () => {
  const fakeExecutable = Buffer.from("MZbad");
  expectHttpError(
    () =>
      validateFileBuffer({
        buffer: fakeExecutable,
        originalname: "contract.pdf",
        size: fakeExecutable.length,
      }),
    400,
  );
});

check("Từ chối file rỗng", () => {
  expectHttpError(
    () =>
      validateFileBuffer({
        buffer: Buffer.alloc(0),
        originalname: "empty.pdf",
        size: 0,
      }),
    400,
  );
});

check("Giới hạn kích thước là 5MB", () => {
  assert.equal(MAX_FILE_SIZE, 5 * 1024 * 1024);
});

check("ID không hợp lệ trả HTTP 400", () => {
  expectHttpError(() => parseId("abc", "Mã hợp đồng"), 400);
});

check("Từ chối ngày kết thúc trước ngày bắt đầu", () => {
  expectHttpError(() => validateDates("2026-05-01", "2026-04-30"), 400);
});

check("Từ chối ngày lịch không tồn tại", () => {
  expectHttpError(() => validateDates("2026-02-31", null), 400);
});

check("Từ chối title vượt quá 255 ký tự", () => {
  expectHttpError(() => validateContractText("A".repeat(256), "ghi chú"), 400);
});

check("Từ chối note vượt quá 1000 ký tự", () => {
  expectHttpError(
    () => validateContractText("Hợp đồng", "N".repeat(1001)),
    400,
  );
});

check("Cho phép title và note đúng giới hạn", () => {
  const text = validateContractText("H".repeat(255), "N".repeat(1000));
  assert.equal(Array.from(text.title).length, 255);
  assert.equal(Array.from(text.note).length, 1000);
});

check("500 không trả message nội bộ trong response", () => {
  let responseBody;
  const response = {
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    sendContractError(response, new Error("SQL secret details"));
    assert.equal(response.statusCode, 500);
    assert.equal(responseBody.error, "Lỗi server, vui lòng thử lại sau!");
    assert.equal(
      JSON.stringify(responseBody).includes("SQL secret details"),
      false,
    );

    responseBody = null;
    sendDocumentError(response, new Error("Document DB secret"));
    assert.equal(response.statusCode, 500);
    assert.equal(responseBody.error, "Lỗi server, vui lòng thử lại sau!");
    assert.equal(
      JSON.stringify(responseBody).includes("Document DB secret"),
      false,
    );
  } finally {
    console.error = originalError;
  }
});

check("DTO không để lộ stored_name", () => {
  const contract = toDto({
    id: 1,
    internId: 2,
    storedName: "private-uuid",
    originalName: "contract.pdf",
    mimeType: "application/pdf",
    sizeBytes: 3,
  });

  assert.equal(Object.hasOwn(contract, "stored_name"), false);
  assert.equal(Object.hasOwn(contract, "storedName"), false);
});

console.log(`\n${passed} PASS / ${failed} FAIL`);
if (failed > 0) process.exit(1);
