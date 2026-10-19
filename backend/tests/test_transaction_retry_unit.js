// Kết nối giả: không cần MySQL và không chờ thật giữa các lần retry.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const filename = path.join(__dirname, "../db.js");
const source = fs.readFileSync(filename, "utf8");
let passed = 0;
const deadlock = () =>
  Object.assign(new Error("private SQL must not be logged"), {
    code: "ER_LOCK_DEADLOCK",
    errno: 1213,
    sqlMessage: "original SQL deadlock message",
  });

function fixture({ failAt, error, rollbackError, acquireError } = {}) {
  const log = [];
  const waits = [];
  const warnings = [];
  const connections = [];
  const fakePool = {
    async getConnection() {
      if (acquireError) throw acquireError;
      const id = connections.length + 1;
      const conn = { id };
      for (const op of ["beginTransaction", "commit", "rollback"]) {
        conn[op] = async () => {
          log.push(`${id}:${op}`);
          if (op === "rollback" && rollbackError) throw rollbackError;
          if (op === failAt) throw error;
        };
      }
      conn.release = () => log.push(`${id}:release`);
      connections.push(conn);
      log.push(`${id}:getConnection`);
      return conn;
    },
  };
  const context = {
    require: createRequire(filename),
    __dirname: path.dirname(filename),
    module: { exports: {} },
    console: { warn: (message) => warnings.push(message) },
    // Nếu code vô tình chờ thật, test phải thất bại.
    setTimeout() {
      throw new Error("unexpected real timer");
    },
    fakePool,
    process: { env: process.env },
  };
  vm.runInNewContext(
    `${source}\npool = fakePool; isMysqlConnected = true;
     module.exports.retryLimit = MAX_DEADLOCK_ATTEMPTS;`,
    context,
    { filename },
  );
  return {
    ...context.module.exports,
    log,
    waits,
    warnings,
    connections,
    sleep: async (ms) => {
      assert.equal(log.at(-1), `${connections.length}:release`);
      waits.push(ms);
      log.push("sleep");
    },
  };
}

async function test(name, work) {
  await work();
  passed += 1;
  console.log(`[PASS] ${name}`);
}
function released(f) {
  for (const { id } of f.connections) {
    assert.equal(f.log.filter((v) => v === `${id}:release`).length, 1);
  }
}

async function main() {
  await test("deadlock rồi thành công: connection mới, rollback/release trước sleep", async () => {
    const f = fixture();
    const expected = { value: 42 };
    let calls = 0;
    const result = await f.withTransaction(
      async (conn) => {
        calls += 1;
        f.log.push(`${conn.id}:work`);
        if (calls === 1) throw deadlock();
        return expected;
      },
      { sleep: f.sleep },
    );
    assert.equal(calls, 2);
    assert.strictEqual(result, expected);
    assert.notStrictEqual(f.connections[0], f.connections[1]);
    assert.deepEqual(f.log, [
      "1:getConnection",
      "1:beginTransaction",
      "1:work",
      "1:rollback",
      "1:release",
      "sleep",
      "2:getConnection",
      "2:beginTransaction",
      "2:work",
      "2:commit",
      "2:release",
    ]);
    assert.equal(f.waits.length, 1);
    assert.equal(f.warnings.length, 1);
    assert.match(f.warnings[0], /2\/3/);
    assert.ok(!f.warnings[0].includes("private SQL"));
    released(f);
  });

  await test("deadlock liên tục: đúng 3 lần, giữ nguyên lỗi cuối cùng", async () => {
    const f = fixture();
    const errors = [];
    assert.equal(f.retryLimit, 3);
    await assert.rejects(
      f.withTransaction(
        async () => {
          const err = deadlock();
          errors.push(err);
          throw err;
        },
        { sleep: f.sleep },
      ),
      (err) => {
        assert.strictEqual(err, errors[2]);
        assert.equal(err.code, "ER_LOCK_DEADLOCK");
        assert.equal(err.errno, 1213);
        assert.equal(err.sqlMessage, "original SQL deadlock message");
        return true;
      },
    );
    assert.equal(errors.length, f.retryLimit);
    assert.equal(f.waits.length, 2);
    assert.equal(f.warnings.length, 2);
    assert.match(f.warnings[1], /3\/3/);
    assert.ok(f.waits[0] >= 20 && f.waits[0] <= 80);
    assert.ok(f.waits[1] >= 40 && f.waits[1] <= 160);
    assert.equal(f.log.filter((s) => s.endsWith(":rollback")).length, 3);
    assert.ok(!f.log.some((s) => s.endsWith(":commit")));
    released(f);
  });

  for (const code of ["ER_DUP_ENTRY", "ER_LOCK_WAIT_TIMEOUT", undefined]) {
    await test(`không retry lỗi ${code || "thường"}`, async () => {
      const f = fixture();
      const err = Object.assign(new Error("failure"), { code });
      let calls = 0;
      await assert.rejects(
        f.withTransaction(
          async () => {
            calls += 1;
            throw err;
          },
          { sleep: f.sleep },
        ),
        (caught) => caught === err,
      );
      assert.equal(calls, 1);
      assert.ok(f.log.includes("1:rollback"));
      assert.equal(f.waits.length, 0);
      assert.equal(f.warnings.length, 0);
      released(f);
    });
  }

  await test("rollback thất bại không che lỗi gốc", async () => {
    const f = fixture({ rollbackError: new Error("rollback failed") });
    const err = new Error("original");
    await assert.rejects(
      f.withTransaction(async () => {
        throw err;
      }),
      (caught) => caught === err,
    );
    released(f);
  });

  await test("rollback thất bại vẫn retry deadlock", async () => {
    const f = fixture({ rollbackError: new Error("rollback failed") });
    let calls = 0;
    assert.equal(
      await f.withTransaction(
        async () => {
          if (++calls === 1) throw deadlock();
          return "ok";
        },
        { sleep: f.sleep },
      ),
      "ok",
    );
    assert.equal(calls, 2);
    assert.equal(f.waits.length, 1);
    released(f);
  });

  await test("retryDeadlock=false chỉ chạy một lần", async () => {
    const f = fixture();
    const err = deadlock();
    await assert.rejects(
      f.withTransaction(
        async () => {
          throw err;
        },
        { retryDeadlock: false, sleep: f.sleep },
      ),
      (caught) => caught === err,
    );
    assert.equal(f.connections.length, 1);
    assert.equal(f.waits.length, 0);
    assert.equal(f.warnings.length, 0);
    released(f);
  });

  await test("test có thể giảm maxAttempts", async () => {
    const f = fixture();
    await assert.rejects(
      f.withTransaction(
        async () => {
          throw deadlock();
        },
        { maxAttempts: 2, sleep: f.sleep },
      ),
      { code: "ER_LOCK_DEADLOCK" },
    );
    assert.equal(f.connections.length, 2);
    assert.equal(f.waits.length, 1);
    released(f);
  });

  await test("không cho vượt giới hạn 3 lần hoặc dùng giới hạn không hợp lệ", async () => {
    const f = fixture();
    for (const maxAttempts of [0, -1, 4, 1.5, NaN]) {
      await assert.rejects(
        f.withTransaction(async () => {}, { maxAttempts }),
        { name: "RangeError" },
      );
    }
    assert.equal(f.connections.length, 0);
  });

  await test("thành công lần đầu: không rollback, không sleep, trả đúng kết quả", async () => {
    const f = fixture();
    assert.equal(await f.withTransaction(async () => 7), 7);
    assert.deepEqual(f.log, [
      "1:getConnection",
      "1:beginTransaction",
      "1:commit",
      "1:release",
    ]);
    assert.equal(f.warnings.length, 0);
    released(f);
  });

  for (const failAt of ["beginTransaction", "commit"]) {
    await test(`deadlock tại ${failAt}: rollback và release mọi lần`, async () => {
      const err = deadlock();
      const f = fixture({ failAt, error: err });
      let calls = 0;
      await assert.rejects(
        f.withTransaction(
          async () => {
            calls += 1;
          },
          { sleep: f.sleep },
        ),
        (caught) => caught === err,
      );
      assert.equal(calls, failAt === "commit" ? 3 : 0);
      assert.equal(f.connections.length, 3);
      assert.equal(f.log.filter((s) => s.endsWith(":rollback")).length, 3);
      released(f);
    });
  }

  await test("không retry lỗi lấy connection và không chạy callback", async () => {
    const err = new Error("pool unavailable");
    const f = fixture({ acquireError: err });
    await assert.rejects(
      f.withTransaction(async () => assert.fail("work must not run")),
      (caught) => caught === err,
    );
    assert.equal(f.connections.length, 0);
    assert.equal(f.waits.length, 0);
  });

  await test("sleep mặc định dùng timer với jitter, sau khi release", async () => {
    const f = fixture();
    let calls = 0;
    await assert.rejects(
      f.withTransaction(async () => {
        if (++calls === 1) throw deadlock();
      }),
      /unexpected real timer/,
    );
    assert.equal(calls, 1);
    assert.equal(f.log.at(-1), "1:release");
    released(f);
  });

  console.log(`\nTRANSACTION RETRY UNIT: ${passed} PASS`);
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
