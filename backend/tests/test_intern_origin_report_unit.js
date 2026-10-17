// Unit test dịch vụ Thống kê thực tập sinh theo trường / ngành (HR - US5)
// Không cần kết nối MySQL.
const assert = require("assert");
const service = require("../services/internOriginReport.service");
const db = require("../db");

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

async function main() {
  console.log("============================================================");
  console.log(" UNIT TEST: BÁO CÁO THỰC TẬP SINH THEO TRƯỜNG / NGÀNH (US5)");
  console.log("============================================================\n");

  // 1. Chuẩn hóa tên (khoảng trắng, hoa/thường, dấu, NULL/rỗng/"Chưa cập nhật")
  check("Chuẩn hóa khoảng trắng đầu cuối và gộp khoảng trắng liên tiếp", () => {
    assert.equal(service.cleanText("   Đại   học    CNTT   "), "Đại học CNTT");
    assert.equal(service.cleanText(null), "");
    assert.equal(service.cleanText(""), "");
  });

  check("Chuẩn hóa khóa so sánh không phân biệt hoa thường và dấu", () => {
    assert.equal(service.normalizeKey("ICTU"), "ictu");
    assert.equal(service.normalizeKey("  ictu  "), "ictu");
    assert.equal(service.normalizeKey("Đại học CNTT"), "dai hoc cntt");
    assert.equal(service.normalizeKey("đại   học   cntt"), "dai hoc cntt");
    assert.equal(service.normalizeKey("ĐH BÁCH KHOA"), "dh bach khoa");
  });

  check(
    "Nhận diện NULL, rỗng, khoảng trắng, 'Chưa cập nhật' là unknown",
    () => {
      assert.strictEqual(service.isUnknown(null), true);
      assert.strictEqual(service.isUnknown(undefined), true);
      assert.strictEqual(service.isUnknown(""), true);
      assert.strictEqual(service.isUnknown("    "), true);
      assert.strictEqual(service.isUnknown("Chưa cập nhật"), true);
      assert.strictEqual(service.isUnknown("chưa  cập  nhật"), true);
      assert.strictEqual(service.isUnknown("CHƯA CẬP NHẬT"), true);
      assert.strictEqual(service.isUnknown("Chua cap nhat"), true);
      assert.strictEqual(service.isUnknown("Đại học Quốc Gia"), false);
    },
  );

  // 2. Gom nhóm và chọn nhãn phổ biến nhất, sắp xếp hòa thì theo tên
  check(
    "Gom nhóm cùng trường khác hoa/thường/khoảng trắng, nhãn lấy dạng phổ biến nhất",
    () => {
      const items = [
        { rawName: "ictu", count: 2 },
        { rawName: "  ICTU  ", count: 10 },
        { rawName: "Ictu", count: 3 },
      ];
      const grouped = service.groupItems(items, 15, 10);
      assert.equal(grouped.length, 1);
      assert.equal(grouped[0].name, "ICTU");
      assert.equal(grouped[0].count, 15);
      assert.equal(grouped[0].percent, 100);
    },
  );

  check(
    "Sắp xếp giảm dần theo count, hòa thì theo tên (alphabetical tiếng Việt)",
    () => {
      const items = [
        { rawName: "Trường B", count: 5 },
        { rawName: "Trường A", count: 5 },
        { rawName: "Trường C", count: 10 },
      ];
      const grouped = service.groupItems(items, 20, 10);
      assert.equal(grouped[0].name, "Trường C");
      assert.equal(grouped[0].count, 10);
      assert.equal(grouped[1].name, "Trường A");
      assert.equal(grouped[2].name, "Trường B");
    },
  );

  // 3. Tính percent: tổng 0, làm tròn, tổng ≈ 100%
  check("Tính percent khi tổng = 0 trả 0, không bị chia cho 0 hay NaN", () => {
    const grouped = service.groupItems([], 0, 10);
    assert.deepStrictEqual(grouped, []);

    const res = service.buildOriginReport([], { limit: 10 });
    assert.equal(res.total, 0);
    assert.equal(res.unknown, 0);
    assert.deepStrictEqual(res.byUniversity, []);
    assert.deepStrictEqual(res.byMajor, []);
  });

  check("Tính percent làm tròn 1 chữ số thập phân và tổng tỷ lệ ≈ 100%", () => {
    const items = [
      { rawName: "Trường 1", count: 1 },
      { rawName: "Trường 2", count: 1 },
      { rawName: "Trường 3", count: 1 },
    ];
    const grouped = service.groupItems(items, 3, 10);
    assert.equal(grouped[0].percent, 33.3);
    assert.equal(grouped[1].percent, 33.3);
    assert.equal(grouped[2].percent, 33.3);
    const sum = grouped.reduce((s, x) => s + x.percent, 0);
    assert.ok(Math.abs(sum - 99.9) < 0.2);
  });

  // 4. Top N + gộp "Khác" và bảo toàn "Chưa cập nhật"
  check("Top N nhóm được giữ lại, các nhóm còn lại gộp vào 'Khác'", () => {
    const items = [
      { rawName: "Uni 1", count: 50 },
      { rawName: "Uni 2", count: 30 },
      { rawName: "Uni 3", count: 20 },
      { rawName: "Uni 4", count: 10 },
      { rawName: "Uni 5", count: 5 },
    ];
    const grouped = service.groupItems(items, 115, 3);
    assert.equal(grouped.length, 4); // 3 top + "Khác"
    assert.equal(grouped[0].name, "Uni 1");
    assert.equal(grouped[1].name, "Uni 2");
    assert.equal(grouped[2].name, "Uni 3");
    assert.equal(grouped[3].name, "Khác");
    assert.equal(grouped[3].count, 15);
    assert.equal(grouped[3].percent, 13.0);
  });

  check(
    "Nhóm 'Chưa cập nhật' luôn hiển thị riêng, không bị giấu vào 'Khác' ngay cả khi vượt limit",
    () => {
      const items = [
        { rawName: "Uni 1", count: 50 },
        { rawName: "Uni 2", count: 40 },
        { rawName: "Uni 3", count: 30 },
        { rawName: "Uni 4", count: 20 },
        { rawName: "Chưa cập nhật", count: 1 },
      ];
      // limit = 2
      const grouped = service.groupItems(items, 141, 2);
      const hasUnknown = grouped.some((x) => x.name === "Chưa cập nhật");
      assert.ok(hasUnknown, "'Chưa cập nhật' phải tồn tại riêng biệt");
    },
  );

  check(
    "Ma trận Trường x Ngành gom nhóm chính xác cả trường, ngành, và phần tử Chưa cập nhật",
    () => {
      const rows = [
        { university: "ĐH A", major: "CNTT", count: 10 },
        { university: "ĐH A", major: "KTPM", count: 5 },
        { university: "ĐH B", major: "CNTT", count: 8 },
        { university: null, major: "CNTT", count: 2 },
        { university: "ĐH A", major: null, count: 1 },
      ];
      const res = service.buildOriginReport(rows, { limit: 10 });
      assert.equal(res.total, 26);
      assert.equal(res.unknown, 3); // 2 rows có uni null hoặc major null
      assert.equal(res.matrix.data["ĐH A"]["CNTT"], 10);
      assert.equal(res.matrix.data["ĐH A"]["KTPM"], 5);
      assert.equal(res.matrix.totals.byUniversity["ĐH A"], 16);
      assert.equal(res.matrix.totals.grandTotal, 26);
    },
  );

  check("Trạng thái không hỗ trợ bị trả 400 ở cả hai API", () => {
    for (const status of ["Foo", "Đã kết thúc"]) {
      assert.throws(
        () => service.validateReportQuery({ status }),
        (err) => err.status === 400,
      );
      assert.throws(
        () => service.validateInternsQuery({ status }),
        (err) => err.status === 400,
      );
    }
    for (const status of ["Đang thực tập", "Hoàn thành", "Tạm dừng"]) {
      assert.equal(service.validateReportQuery({ status }).status, status);
    }
  });

  check("groupBy=major chỉ trả nhóm ngành", () => {
    const result = service.buildOriginReport(
      [{ university: "Đại học Y", major: "Y khoa", count: 3 }],
      { groupBy: "major" },
    );
    assert.equal(result.byUniversity.length, 0);
    assert.equal(result.byMajor[0].count, 3);
    assert.equal(result.matrix, null);
  });

  check("Gom tên Unicode, khoảng trắng và chọn tên phổ biến nhất", () => {
    const rows = [
      { university: "Trường Alpha", major: "Y", count: 1 },
      { university: "trường alpha", major: "Y", count: 2 },
      { university: "Dai  hoc Y", major: "Y", count: 1 },
      { university: "Đại học Y", major: "Y", count: 2 },
    ];
    const result = service.buildOriginReport(rows);
    assert.equal(
      result.byUniversity.find((x) => x.name === "trường alpha").count,
      3,
    );
    assert.equal(
      result.byUniversity.find((x) => x.name === "Đại học Y").count,
      3,
    );
  });

  check("Ma trận không lỗi với tên prototype của JavaScript", () => {
    const result = service.buildOriginReport([
      { university: "__proto__", major: "constructor", count: 2 },
    ]);
    assert.equal(result.matrix.data["__proto__"]["constructor"], 2);
  });

  // 5. Validation tham số
  check("Validate query từ chối tham số lạ (400)", () => {
    assert.throws(
      () => service.validateReportQuery({ unknown_param: "123" }),
      (err) => {
        assert.equal(err.status, 400);
        assert.ok(err.message.includes("không hợp lệ"));
        return true;
      },
    );
  });

  check("Validate query từ chối tham số bị lặp lại (mảng) (400)", () => {
    assert.throws(
      () => service.validateReportQuery({ groupBy: ["university", "major"] }),
      (err) => {
        assert.equal(err.status, 400);
        assert.ok(err.message.includes("không được lặp lại"));
        return true;
      },
    );
  });

  check("Validate query từ chối groupBy không hợp lệ (400)", () => {
    assert.throws(
      () => service.validateReportQuery({ groupBy: "invalid_option" }),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      },
    );
  });

  check(
    "Validate query từ chối ngày sai định dạng hoặc from > to (400)",
    () => {
      assert.throws(
        () => service.validateReportQuery({ from: "2026/01/01" }),
        (err) => err.status === 400,
      );
      assert.throws(
        () =>
          service.validateReportQuery({ from: "2026-05-10", to: "2026-05-01" }),
        (err) => {
          assert.equal(err.status, 400);
          assert.ok(err.message.includes("không được sau ngày kết thúc"));
          return true;
        },
      );
    },
  );

  check(
    "Validate query từ chối limit không phải số nguyên dương hoặc > 100 (400)",
    () => {
      assert.throws(
        () => service.validateReportQuery({ limit: "0" }),
        (err) => err.status === 400,
      );
      assert.throws(
        () => service.validateReportQuery({ limit: "-5" }),
        (err) => err.status === 400,
      );
      assert.throws(
        () => service.validateReportQuery({ limit: "abc" }),
        (err) => err.status === 400,
      );
      assert.throws(
        () => service.validateReportQuery({ limit: "101" }),
        (err) => err.status === 400,
      );
    },
  );

  check("Validate query từ chối từ khóa q quá 100 ký tự (400)", () => {
    const longQ = "a".repeat(101);
    assert.throws(
      () => service.validateReportQuery({ q: longQ }),
      (err) => err.status === 400,
    );
  });

  check("Validate interns query từ chối page / pageSize sai (400)", () => {
    assert.throws(
      () => service.validateInternsQuery({ page: "0" }),
      (err) => err.status === 400,
    );
    assert.throws(
      () => service.validateInternsQuery({ pageSize: "150" }),
      (err) => err.status === 400,
    );
  });

  check("Danh sách yêu cầu trường hoặc ngành", () => {
    for (const query of [{}, { university: "  ", major: "" }, { q: "Y" }]) {
      assert.throws(
        () => service.validateInternsQuery(query),
        (err) => err.status === 400,
      );
    }
    assert.equal(
      service.validateInternsQuery({ university: "Đại học Y" }).university,
      "Đại học Y",
    );
    assert.equal(service.validateInternsQuery({ major: "Y" }).major, "Y");
  });

  // 6. Escape LIKE (% và _)
  check(
    "Escape ký tự % và _ để không bị SQL injection ký tự đại diện LIKE",
    () => {
      assert.equal(service.escapeLike("100%_ICTU"), "100\\%\\_ICTU");
      assert.equal(service.escapeLike("normal text"), "normal text");
      assert.equal(service.escapeLike("abc\\def"), "abc\\\\def");
    },
  );

  // 7. CSV Export: UTF-8 BOM và chống CSV injection
  await checkAsync(
    "CSV export tạo file có cấu trúc, UTF-8 BOM và chống CSV injection",
    async () => {
      const origGetIntern = db.getInternOriginCounts;
      const origGetFunnel = db.getCandidateFunnelByUniversity;

      db.getInternOriginCounts = async () => [
        { university: "=cmd|' /C calc'!A0", major: "+SUM(1,2)", count: 3 },
        { university: "ĐH CNTT", major: "-123", count: 5 },
        { university: "@admin", major: "KTPM", count: 2 },
      ];
      db.getCandidateFunnelByUniversity = async () => [
        { university: "ĐH CNTT", status: "Đã duyệt", count: 4 },
        { university: "ĐH CNTT", status: "Từ chối", count: 1 },
      ];

      try {
        const csv = await service.exportCsv({});
        assert.ok(csv.filename.startsWith("thuc-tap-sinh-theo-truong-nganh_"));
        assert.ok(csv.filename.endsWith(".csv"));

        const content = csv.content;
        // Kiểm tra các ô bắt đầu bằng =, +, -, @ được prefix dấu nháy đơn '
        assert.ok(
          content.includes("\"'=cmd|' /C calc'!A0\""),
          "Chống CSV injection cho dấu =",
        );
        assert.ok(
          content.includes('"\'+SUM(1,2)"'),
          "Chống CSV injection cho dấu +",
        );
        assert.ok(
          content.includes('"\'-123"'),
          "Chống CSV injection cho dấu -",
        );
        assert.ok(
          content.includes('"\'@admin"'),
          "Chống CSV injection cho dấu @",
        );

        // Có các phần tiêu đề
        assert.ok(
          content.includes(
            "BÁO CÁO THỐNG KÊ THỰC TẬP SINH THEO TRƯỜNG / NGÀNH",
          ),
        );
        assert.ok(content.includes("1. THỐNG KÊ THEO TRƯỜNG"));
        assert.ok(content.includes("2. THỐNG KÊ THEO NGÀNH"));
        assert.ok(content.includes("3. MA TRẬN TRƯỜNG × NGÀNH"));
        assert.ok(
          content.includes("4. PHỄU TUYỂN DỤNG THEO TRƯỜNG (ỨNG VIÊN)"),
        );
      } finally {
        db.getInternOriginCounts = origGetIntern;
        db.getCandidateFunnelByUniversity = origGetFunnel;
      }
    },
  );

  console.log("\n------------------------------------------------------------");
  console.log(
    `KẾT QUẢ UNIT TEST INTERN ORIGIN: ${passed} PASS / ${failed} FAIL`,
  );
  console.log("------------------------------------------------------------");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Lỗi thực thi test:", err);
  process.exit(1);
});
