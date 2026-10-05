const assert = require("node:assert/strict");
const db = require("../db");
const { HttpError } = require("../errors");
const { confirmForIntern } = require("../services/contracts.service");

let passed = 0;
let failed = 0;

async function check(name, action) {
  try {
    await action();
    passed += 1;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

async function expectHttpError(action, status) {
  await assert.rejects(
    action,
    (err) => err instanceof HttpError && err.status === status,
  );
}

async function run() {
  const originalFindIntern = db.findInternProfileByEmail;
  const originalConfirm = db.confirmContractAtomic;
  try {
    db.findInternProfileByEmail = async () => ({
      id: 21,
      email: "intern@test.local",
    });
    db.confirmContractAtomic = async (internId, contractId, userId) => {
      assert.equal(internId, 21);
      assert.equal(contractId, 8);
      assert.equal(userId, 4);
      return {
        outcome: "CONFIRMED",
        contract: {
          id: 8,
          internId: 21,
          title: "Thực tập",
          originalName: "hopdong.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          confirmationStatus: "CONFIRMED",
          confirmedAt: "2026-10-02 10:00:00",
          confirmedBy: 4,
        },
      };
    };
    await check("Xác nhận hợp đồng chờ thành công", async () => {
      const result = await confirmForIntern(
        { id: 4, email: "intern@test.local" },
        "8",
      );
      assert.equal(result.confirmation_status, "CONFIRMED");
      assert.equal(result.confirmed_by, 4);
    });

    db.confirmContractAtomic = async () => ({ outcome: "NOT_PENDING" });
    await check("Không xác nhận hợp đồng không còn chờ", () =>
      expectHttpError(
        () => confirmForIntern({ id: 4, email: "intern@test.local" }, "8"),
        409,
      ),
    );

    db.confirmContractAtomic = async () => ({ outcome: "ALREADY_CONFIRMED" });
    await check("Từ chối xác nhận lặp với lỗi rõ ràng", async () => {
      await assert.rejects(
        () => confirmForIntern({ id: 4, email: "intern@test.local" }, "8"),
        (err) =>
          err instanceof HttpError &&
          err.status === 409 &&
          /đã được bạn xác nhận/.test(err.message),
      );
    });

    let dbCalled = false;
    db.confirmContractAtomic = async () => {
      dbCalled = true;
      return {};
    };
    await check("ID hợp đồng sai định dạng trả 400", async () => {
      await expectHttpError(
        () => confirmForIntern({ id: 4, email: "intern@test.local" }, "x"),
        400,
      );
      assert.equal(dbCalled, false);
    });

    db.findInternProfileByEmail = async () => null;
    await check("Tài khoản không có hồ sơ intern trả 404", () =>
      expectHttpError(
        () => confirmForIntern({ id: 4, email: "none@test.local" }, "8"),
        404,
      ),
    );

    db.findInternProfileByEmail = async () => ({
      id: 21,
      email: "intern@test.local",
    });
    db.confirmContractAtomic = async () => ({ outcome: "NOT_FOUND" });
    await check("Hợp đồng không thuộc hoặc không tồn tại trả 404", () =>
      expectHttpError(
        () => confirmForIntern({ id: 4, email: "intern@test.local" }, "8"),
        404,
      ),
    );
  } finally {
    db.findInternProfileByEmail = originalFindIntern;
    db.confirmContractAtomic = originalConfirm;
  }

  console.log(`\n${passed} PASS / ${failed} FAIL`);
  if (failed) process.exit(1);
}

run().catch((err) => {
  console.error("[FAIL] Lỗi không mong đợi:", err);
  process.exit(1);
});
