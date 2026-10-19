// Test API (cần MySQL + backend): Thống kê thực tập sinh theo trường / ngành của HR (US5).
// Dữ liệu tạo riêng cho từng lần chạy với tiền tố riêng và dọn sạch khi kết thúc.
const mysql = require("mysql2/promise");
const {
  BASE_URL,
  loginAs,
  readDbConfig,
  cleanupTestData,
} = require("./test_helpers");
const { getVietnamToday } = require("../utils/date");

const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const PREFIX = `orig_test_${RUN_ID}`;
const UNI_MAIN = `Uni_${RUN_ID}`;
const UNI_LOWER = `  uni_${RUN_ID.toLowerCase()}  `;

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`[PASS] ${name}`);
  } else {
    failed++;
    console.error(`[FAIL] ${name}${detail ? ": " + detail : ""}`);
  }
}

async function call(method, url, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE_URL + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, body: json, text };
}

async function main() {
  const conn = await mysql.createConnection(readDbConfig());
  const emails = [];
  const candidateIds = [];
  const internIds = [];

  try {
    const hr = await loginAs("HR");
    const admin = await loginAs("Admin");
    const mentor = await loginAs("Mentor");

    // Tạo các thực tập sinh test
    async function createTestIntern(
      label,
      uni,
      major,
      status = "Đang thực tập",
    ) {
      const email = `${PREFIX}_${label}@test.edu.vn`;
      emails.push(email);
      const res = await call("POST", "/interns", hr, {
        fullName: `Intern ${label} ${RUN_ID}`,
        email,
        studentCode: `SV_${label}_${Date.now()}`,
        university: uni,
        major,
      });
      const intern = res.body?.intern || res.body?.student;
      if (![200, 201].includes(res.status) || !intern) {
        throw new Error(
          `Tạo intern ${label} thất bại: ${JSON.stringify(res.body)}`,
        );
      }
      internIds.push(Number(intern.id));
      if (status !== "Đang thực tập") {
        await conn.query("UPDATE intern_profiles SET status = ? WHERE id = ?", [
          status,
          intern.id,
        ]);
      }
      return Number(intern.id);
    }

    await createTestIntern("A", UNI_MAIN, "Kỹ thuật phần mềm", "Đang thực tập");
    await createTestIntern(
      "B",
      UNI_LOWER,
      "Kỹ thuật phần mềm",
      "Đang thực tập",
    );
    const id3 = await createTestIntern(
      "C",
      "Chưa cập nhật",
      "Chưa cập nhật",
      "Đang thực tập",
    );
    await createTestIntern("D", UNI_MAIN, "Công nghệ thông tin", "Hoàn thành");

    // Tạo ứng viên test cho phễu tuyển dụng
    const candEmail1 = `${PREFIX}_cand1@test.edu.vn`;
    const candEmail2 = `${PREFIX}_cand2@test.edu.vn`;
    emails.push(candEmail1, candEmail2);

    const [c1] = await conn.query(
      `INSERT INTO candidate_profiles (full_name, email, phone, university, major, password_hash, status)
       VALUES (?, ?, '0912345671', ?, 'Kỹ thuật phần mềm', 'hash', 'Đã duyệt')`,
      [`Ứng viên 1 ${RUN_ID}`, candEmail1, UNI_MAIN],
    );
    candidateIds.push(c1.insertId);

    const [c2] = await conn.query(
      `INSERT INTO candidate_profiles (full_name, email, phone, university, major, password_hash, status)
       VALUES (?, ?, '0912345672', ?, 'Kỹ thuật phần mềm', 'hash', 'Từ chối')`,
      [`Ứng viên 2 ${RUN_ID}`, candEmail2, UNI_MAIN],
    );
    candidateIds.push(c2.insertId);

    const base = "/reports/interns-by-origin";

    // 1. Phân quyền
    check(
      "Không có token bị chặn (401)",
      (await call("GET", base)).status === 401,
    );
    check(
      "Mentor bị chặn (403)",
      (await call("GET", base, mentor)).status === 403,
    );
    check(
      "Admin bị chặn (403)",
      (await call("GET", base, admin)).status === 403,
    );
    check(
      "CSV bị chặn người không phải HR (403)",
      (await call("GET", `${base}/export.csv`, admin)).status === 403,
    );
    check(
      "Danh sách chi tiết bị chặn người không phải HR (403)",
      (await call("GET", `${base}/interns`, mentor)).status === 403,
    );

    // 2. HR truy vấn thành công & Cache-Control
    const resHr = await call("GET", `${base}?q=${UNI_MAIN}`, hr);
    check("HR xem thống kê thành công (200)", resHr.status === 200);
    check(
      "Header Cache-Control: private, no-store",
      /no-store/.test(resHr.headers.get("cache-control") || ""),
    );

    const data = resHr.body?.data;
    check(
      "Tổng số lượng thực tập sinh khớp filter q",
      data?.total === 3,
      `total=${data?.total}`,
    );

    // Kiểm tra gom nhóm tên trường khác hoa/thường/khoảng trắng
    const uniGroup = data?.byUniversity?.find((u) => u.name === UNI_MAIN);
    check(
      "Uni_xxx và uni_xxx viết thường có khoảng trắng được gom vào 1 nhóm",
      uniGroup?.count === 3,
      JSON.stringify(data?.byUniversity),
    );

    // Kiểm tra nhóm ngành
    const ktpmMajor = data?.byMajor?.find(
      (m) => m.name === "Kỹ thuật phần mềm",
    );
    const cnttMajor = data?.byMajor?.find(
      (m) => m.name === "Công nghệ thông tin",
    );
    check(
      "Ngành Kỹ thuật phần mềm có 2 hồ sơ",
      ktpmMajor?.count === 2,
      JSON.stringify(ktpmMajor),
    );
    check(
      "Ngành Công nghệ thông tin có 1 hồ sơ",
      cnttMajor?.count === 1,
      JSON.stringify(cnttMajor),
    );

    // 3. Lọc theo trạng thái hồ sơ
    const resActive = await call(
      "GET",
      `${base}?q=${UNI_MAIN}&status=Đang thực tập`,
      hr,
    );
    check(
      "Lọc status=Đang thực tập trả đúng 2 hồ sơ",
      resActive.body?.data?.total === 2,
      `total=${resActive.body?.data?.total}`,
    );

    const resEnded = await call(
      "GET",
      `${base}?q=${UNI_MAIN}&status=Hoàn thành`,
      hr,
    );
    check(
      "Lọc status=Hoàn thành trả đúng 1 hồ sơ",
      resEnded.body?.data?.total === 1,
      `total=${resEnded.body?.data?.total}`,
    );

    // 4. Lọc theo ngày
    const today = getVietnamToday();
    const resDate = await call(
      "GET",
      `${base}?q=${UNI_MAIN}&from=${today}&to=${today}`,
      hr,
    );
    check(
      "Lọc từ ngày hôm nay trả về đúng dữ liệu",
      resDate.body?.data?.total === 3,
    );

    const resPast = await call(
      "GET",
      `${base}?q=${UNI_MAIN}&from=2020-01-01&to=2020-01-02`,
      hr,
    );
    check(
      "Khoảng ngày không có dữ liệu trả về total = 0 và danh sách rỗng (200)",
      resPast.status === 200 &&
        resPast.body?.data?.total === 0 &&
        resPast.body?.data?.byUniversity?.length === 0,
    );

    // 5. Phễu tuyển dụng theo trường (funnel)
    const funnelItem = data?.funnel?.find((f) => f.name === UNI_MAIN);
    check(
      "Phễu tuyển dụng hiển thị đúng số nộp, đã duyệt, từ chối và tỷ lệ duyệt",
      funnelItem &&
        funnelItem.applied === 2 &&
        funnelItem.approved === 1 &&
        funnelItem.rejected === 1 &&
        funnelItem.approvalRate === 50,
      JSON.stringify(funnelItem),
    );

    // 6. Chi tiết thực tập sinh (phân trang & không lộ email/phone)
    const resDetail = await call(
      "GET",
      `${base}/interns?university=${encodeURIComponent(UNI_MAIN)}&page=1&pageSize=2`,
      hr,
    );
    check("Lấy danh sách chi tiết thành công (200)", resDetail.status === 200);
    const detailData = resDetail.body?.data;
    check(
      "Phân trang đúng pageSize=2, total=3, totalPages=2",
      detailData?.pagination?.pageSize === 2 &&
        detailData?.pagination?.total === 3 &&
        detailData?.pagination?.totalPages === 2,
      JSON.stringify(detailData?.pagination),
    );
    check("Danh sách trả về 2 phần tử", detailData?.items?.length === 2);

    const firstItem = detailData?.items?.[0];
    check(
      "Không lộ email hoặc số điện thoại trong API thống kê",
      firstItem &&
        !("email" in firstItem) &&
        !("phone" in firstItem) &&
        "fullName" in firstItem &&
        "studentCode" in firstItem,
      JSON.stringify(firstItem),
    );

    // Chi tiết nhóm Chưa cập nhật
    const resUnkDetail = await call(
      "GET",
      `${base}/interns?university=${encodeURIComponent("Chưa cập nhật")}`,
      hr,
    );
    check(
      "Nhóm Chưa cập nhật tìm thấy hồ sơ test C",
      resUnkDetail.body?.data?.items?.some((x) => x.id === id3),
    );

    // 7. Xuất CSV
    const resCsv = await fetch(`${BASE_URL}${base}/export.csv?q=${UNI_MAIN}`, {
      headers: { Authorization: `Bearer ${hr}` },
    });
    const csvBytes = Buffer.from(await resCsv.arrayBuffer());
    const csvText = csvBytes.toString("utf8");
    check("Tải CSV thành công (200)", resCsv.status === 200);
    check(
      "Header Content-Type là CSV UTF-8",
      /text\/csv/.test(resCsv.headers.get("content-type") || ""),
    );
    check(
      "Header Content-Disposition đúng tên file",
      /attachment; filename="thuc-tap-sinh-theo-truong-nganh_.*\.csv"/.test(
        resCsv.headers.get("content-disposition") || "",
      ),
    );
    check(
      "Nội dung CSV bắt đầu bằng UTF-8 BOM",
      csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
    );
    check("Nội dung CSV chứa tên trường test", csvText.includes(UNI_MAIN));

    check(
      "Thiếu nhóm chi tiết trả 400",
      (await call("GET", `${base}/interns`, hr)).status === 400,
    );
    for (const endpoint of [
      base,
      `${base}/interns?university=${encodeURIComponent(UNI_MAIN)}`,
    ]) {
      const separator = endpoint.includes("?") ? "&" : "?";
      check(
        "status=Foo trả 400",
        (await call("GET", `${endpoint}${separator}status=Foo`, hr)).status ===
          400,
      );
    }
    const majorOnly = await call("GET", `${base}?groupBy=major`, hr);
    check(
      "groupBy=major không trả nhóm trường",
      majorOnly.status === 200 &&
        majorOnly.body?.data?.byUniversity?.length === 0,
    );

    // 8. Validation sai trả 400
    const badParam = await call("GET", `${base}?bad=1`, hr);
    check("Tham số lạ trả 400", badParam.status === 400);

    const badDate = await call(
      "GET",
      `${base}?from=2026-10-10&to=2026-01-01`,
      hr,
    );
    check("from > to trả 400", badDate.status === 400);

    const badLimit = await call("GET", `${base}?limit=999`, hr);
    check("limit > 100 trả 400", badLimit.status === 400);
  } finally {
    // Dọn dẹp dữ liệu test
    try {
      if (candidateIds.length > 0) {
        await conn.query("DELETE FROM candidate_profiles WHERE id IN (?)", [
          candidateIds,
        ]);
      }
      if (internIds.length > 0) {
        await conn.query("DELETE FROM intern_profiles WHERE id IN (?)", [
          internIds,
        ]);
      }
      await cleanupTestData(emails);
    } catch (e) {
      console.error("Lỗi khi dọn dữ liệu test:", e.message);
    }
    await conn.end();
  }

  console.log("\n------------------------------------------------------------");
  console.log(
    `KẾT QUẢ API TEST INTERN ORIGIN: ${passed} PASS / ${failed} FAIL`,
  );
  console.log("------------------------------------------------------------");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Lỗi test API:", err);
  process.exit(1);
});
