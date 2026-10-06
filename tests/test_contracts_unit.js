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
  updateContract,
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

async function expectUpdateContractError(name, args, status) {
  try {
    await updateContract(...args);
    check(`updateContract: ${name}`, () => assert.fail("không ném lỗi"));
  } catch (err) {
    check(`updateContract: ${name}`, () =>
      assert.ok(
        err instanceof HttpError && err.status === status,
        `${err.status ?? ""} ${err.message}`,
      ),
    );
  }
}

async function checkUpdateContract() {
  // Lỗi đầu vào: phát sinh trước khi chạm DB.
  const badInput = [
    ["thiếu mọi trường cần sửa", ["1", "2", {}]],
    ["body rỗng", ["1", "2", undefined]],
    ["program_id không phải số", ["1", "2", { program_id: "abc" }]],
    ["mã thực tập sinh sai", ["x", "2", { program_id: null }]],
    ["mã hợp đồng sai", ["1", "y", { program_id: null }]],
    ["ngày bắt đầu sai định dạng", ["1", "2", { start_date: "01/05/2026" }]],
    ["ngày kết thúc không tồn tại", ["1", "2", { end_date: "2026-02-30" }]],
    ["không cho xóa trắng ngày bắt đầu", ["1", "2", { start_date: null }]],
    ["không cho xóa trắng ngày kết thúc", ["1", "2", { end_date: "" }]],
  ];
  for (const [name, args] of badInput) {
    await expectUpdateContractError(`${name} trả 400`, args, 400);
  }

  // Phần còn lại dùng DB giả để kiểm tra logic gộp ngày và lưu.
  const db = require("../db");
  const original = {
    findProgramById: db.findProgramById,
    findContractById: db.findContractById,
    updateContractFields: db.updateContractFields,
  };
  let saved = null;
  const stored = {
    id: 2,
    internId: 1,
    startDate: "2026-05-10",
    endDate: "2027-05-10",
    programId: null,
    confirmationStatus: "CONFIRMED",
    storedName: "private-uuid",
  };
  db.findProgramById = async (id) => (id === 7 ? { id: 7 } : null);
  db.findContractById = async (internId, contractId) =>
    contractId === 2 ? { ...stored } : null;
  db.updateContractFields = async (internId, contractId, changes) => {
    saved = { internId, contractId, changes };
    return { ...stored, ...changes };
  };

  try {
    const dates = await updateContract("1", "2", {
      start_date: "2026-06-01",
      end_date: "2027-06-01",
    });
    check("updateContract: đổi cả hai ngày", () => {
      assert.equal(dates.start_date, "2026-06-01");
      assert.equal(dates.end_date, "2027-06-01");
      assert.deepEqual(saved.changes, {
        startDate: "2026-06-01",
        endDate: "2027-06-01",
      });
      assert.equal(Object.hasOwn(dates, "stored_name"), false);
    });

    await updateContract("1", "2", { end_date: "2027-12-31" });
    check("updateContract: chỉ đổi một đầu thì không đụng đầu còn lại", () =>
      assert.deepEqual(saved.changes, { endDate: "2027-12-31" }),
    );

    await expectUpdateContractError(
      "ngày kết thúc mới trước ngày bắt đầu đang lưu trả 400",
      ["1", "2", { end_date: "2026-01-01" }],
      400,
    );
    await expectUpdateContractError(
      "ngày bắt đầu mới sau ngày kết thúc đang lưu trả 400",
      ["1", "2", { start_date: "2028-01-01" }],
      400,
    );

    const linked = await updateContract("1", "2", { program_id: "7" });
    check("updateContract: gắn chương trình", () => {
      assert.equal(linked.program_id, 7);
      assert.deepEqual(saved.changes, { programId: 7 });
    });
    const unlinked = await updateContract("1", "2", { program_id: null });
    check("updateContract: gỡ chương trình bằng null", () => {
      assert.equal(unlinked.program_id, null);
      assert.deepEqual(saved.changes, { programId: null });
    });

    await expectUpdateContractError(
      "chương trình không tồn tại trả 404",
      ["1", "2", { program_id: 99 }],
      404,
    );
    await expectUpdateContractError(
      "hợp đồng không tồn tại trả 404",
      ["1", "3", { start_date: "2026-06-01" }],
      404,
    );
  } finally {
    Object.assign(db, original);
  }
}

checkUpdateContract().then(() => {
  console.log(`\n${passed} PASS / ${failed} FAIL`);
  if (failed > 0) process.exit(1);
});
