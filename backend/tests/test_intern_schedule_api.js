// Integration API test cho Lịch thực tập cá nhân (Internship Schedule API)
const mysql = require("mysql2/promise");
const {
  BASE_URL,
  loginAs,
  cleanupByPattern,
  readDbConfig,
} = require("./test_helpers");

const PREFIX = `sched_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(` [PASS] ${name}`);
  } else {
    failed += 1;
    console.error(` [FAIL] ${name}${detail ? `: ${detail}` : ""}`);
  }
}

async function request(url, token, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${BASE_URL}${url}`, { ...options, headers });
}

async function createInternProfile(
  hrToken,
  email,
  fullName = "Intern Schedule Test",
) {
  const response = await request("/interns", hrToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName,
      email,
      studentCode: `SV_${Date.now().toString().slice(-6)}`,
      university: "ICTU University",
      major: "Kỹ thuật phần mềm",
    }),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(`Tạo hồ sơ intern thất bại: ${JSON.stringify(body)}`);
  return Number((body.intern || body.student).id);
}

async function loginUser(email, password = "password123") {
  const response = await request("/auth/login", null, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: email, password }),
  });
  const body = await response.json();
  if (!response.ok || !body.token)
    throw new Error(`Đăng nhập thất bại: ${JSON.stringify(body)}`);
  return body.token;
}

async function run() {
  console.log("\n====================================================");
  console.log(" BẮT ĐẦU INTEGRATION TEST LỊCH THỰC TẬP CÁ NHÂN (API)");
  console.log("====================================================\n");

  const internEmail = `${PREFIX}_intern@ictu.edu.vn`;
  const orphanInternEmail = `${PREFIX}_orphan@ictu.edu.vn`;
  let hrToken, adminToken, mentorToken, internToken, orphanToken;
  let internId;

  try {
    // 1. Lấy token của các vai trò
    adminToken = await loginAs("Admin");
    hrToken = await loginAs("HR");
    mentorToken = await loginAs("Mentor");

    // Tạo hồ sơ intern và tài khoản tương ứng
    internId = await createInternProfile(hrToken, internEmail);
    const assignmentConn = await mysql.createConnection(readDbConfig());
    try {
      await assignmentConn.query(
        "UPDATE intern_profiles SET mentor_id = NULL WHERE id = ?",
        [internId],
      );
      await assignmentConn.query(
        `INSERT INTO internship_contracts (intern_id, title, start_date, end_date, original_name, stored_name, mime_type, size_bytes, confirmation_status)
         VALUES (?, 'Schedule test contract', '2026-10-01', '2026-10-31', 'schedule-test.pdf', ?, 'application/pdf', 1, 'CONFIRMED')`,
        [internId, `${PREFIX}_contract.pdf`],
      );
    } finally {
      await assignmentConn.end();
    }
    internToken = await loginUser(internEmail);

    // Tạo một tài khoản intern không có hồ sơ intern_profiles (orphan)
    const createRes = await request("/users", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Orphan Intern",
        email: orphanInternEmail,
        password: "password123",
        role: "Intern",
      }),
    });
    if (!createRes.ok) throw new Error("Không tạo được orphan intern");
    orphanToken = await loginUser(orphanInternEmail);

    // Vì insertUser tự động chèn 1 bản ghi vào intern_profiles cho role Intern,
    // ta xóa hồ sơ tương ứng trong DB để mô phỏng chính xác trường hợp orphan (tài khoản không có hồ sơ)
    const dbConn = await mysql.createConnection(readDbConfig());
    try {
      await dbConn.query(
        "DELETE FROM intern_profiles WHERE LOWER(email) = LOWER(?)",
        [orphanInternEmail],
      );
    } finally {
      await dbConn.end();
    }

    // TEST 1: Chưa đăng nhập bị từ chối 401
    const noAuthRes = await request("/me/schedule", null);
    check(
      "GET /api/me/schedule không có token trả về 401 Unauthorized",
      noAuthRes.status === 401,
    );

    // TEST 2: Vai trò không phải Intern bị từ chối 403
    const hrMeRes = await request("/me/schedule", hrToken);
    check(
      "GET /api/me/schedule với token HR trả về 403 Forbidden",
      hrMeRes.status === 403,
    );

    const mentorMeRes = await request("/me/schedule", mentorToken);
    check(
      "GET /api/me/schedule với token Mentor trả về 403 Forbidden",
      mentorMeRes.status === 403,
    );

    const adminMeRes = await request("/me/schedule", adminToken);
    check(
      "GET /api/me/schedule với token Admin trả về 403 Forbidden",
      adminMeRes.status === 403,
    );

    // TEST 3: Intern chưa có hồ sơ trả về 404
    const orphanRes = await request("/me/schedule", orphanToken);
    const orphanBody = await orphanRes.json();
    check(
      "GET /api/me/schedule khi tài khoản chưa có hồ sơ trả về 404",
      orphanRes.status === 404 &&
        (orphanBody.message || orphanBody.error || "").includes(
          "chưa có hồ sơ",
        ),
    );

    // TEST 4: Intern có hồ sơ lấy lịch thực tập thành công (200)
    const internRes = await request("/me/schedule", internToken);
    const internBody = await internRes.json();
    check("GET /api/me/schedule trả về HTTP 200 OK", internRes.status === 200);
    check("Phản hồi có success = true", internBody.success === true);
    check(
      "Dữ liệu chứa thông tin intern chính xác",
      internBody.data?.intern?.email === internEmail,
    );
    check(
      "Dữ liệu chứa timeline_summary",
      typeof internBody.data?.timeline_summary?.progress_percent === "number",
    );
    check(
      "GET không tự sinh mốc; lịch trống có trạng thái Chưa có lịch",
      Array.isArray(internBody.data?.milestones) &&
        internBody.data.milestones.length === 0 &&
        internBody.data.schedule_status_text === "Chưa có lịch",
    );

    const conn = await mysql.createConnection(readDbConfig());
    try {
      const [[before]] = await conn.query(
        "SELECT COUNT(*) AS total FROM intern_schedules WHERE intern_id = ?",
        [internId],
      );
      await request(`/me/schedule?today=2026-09-15`, internToken);
      const [[after]] = await conn.query(
        "SELECT COUNT(*) AS total FROM intern_schedules WHERE intern_id = ?",
        [internId],
      );
      check(
        "?today= không làm GET ghi dữ liệu vào DB",
        Number(before.total) === Number(after.total),
      );
      const [indexes] = await conn.query(
        "SELECT MAX(NON_UNIQUE) AS nonUnique, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'intern_schedules' AND INDEX_NAME = 'uq_schedule_intern_phase'",
      );
      check(
        "Migration tạo khóa unique (intern_id, phase_order)",
        indexes.length === 1 &&
          Number(indexes[0].nonUnique) === 0 &&
          indexes[0].cols === "intern_id,phase_order",
      );
    } finally {
      await conn.end();
    }

    // TEST 5: HR / Admin / Mentor tra cứu lịch thực tập theo ID
    const hrViewRes = await request(`/interns/${internId}/schedule`, hrToken);
    const hrViewBody = await hrViewRes.json();
    check(
      "HR tra cứu lịch thực tập của sinh viên (/interns/:id/schedule) trả về 200",
      hrViewRes.status === 200 && hrViewBody.data?.intern?.id === internId,
    );

    const adminViewRes = await request(
      `/interns/${internId}/schedule`,
      adminToken,
    );
    check(
      "Admin tra cứu lịch thực tập của sinh viên trả về 200",
      adminViewRes.status === 200,
    );

    const mentorViewRes = await request(
      `/interns/${internId}/schedule`,
      mentorToken,
    );
    check(
      "Mentor không được xem lịch Intern chưa được phân công (403)",
      mentorViewRes.status === 403,
    );

    const milestoneInput = {
      phase_order: 1,
      title: "Mốc đồng thời",
      start_date: "2026-10-01",
      end_date: "2026-10-07",
      description: "Test",
      status: "NOT_STARTED",
    };
    const createOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(milestoneInput),
    };
    const concurrent = await Promise.all([
      request(
        `/interns/${internId}/schedule/milestones`,
        hrToken,
        createOptions,
      ),
      request(
        `/interns/${internId}/schedule/milestones`,
        hrToken,
        createOptions,
      ),
    ]);
    const afterConcurrent = await request(
      `/interns/${internId}/schedule`,
      hrToken,
    );
    const concurrentBody = await afterConcurrent.json();
    check(
      "Hai request đồng thời: một tạo mốc, một nhận 409; không tạo trùng",
      concurrent
        .map((r) => r.status)
        .sort()
        .join(",") === "201,409" &&
        concurrentBody.data?.milestones?.filter(
          (m) => Number(m.phase_order) === 1,
        ).length === 1,
    );
    const phaseOneId = concurrentBody.data?.milestones?.find(
      (m) => Number(m.phase_order) === 1,
    )?.id;
    const rangeConn = await mysql.createConnection(readDbConfig());
    try {
      await rangeConn.query(
        "UPDATE internship_contracts SET start_date = '2026-10-03' WHERE intern_id = ? AND confirmation_status = 'CONFIRMED'",
        [internId],
      );
      const statusOnly = await request(
        `/interns/${internId}/schedule/milestones/${phaseOneId}`,
        hrToken,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "IN_PROGRESS" }),
        },
      );
      const titleOnly = await request(
        `/interns/${internId}/schedule/milestones/${phaseOneId}`,
        hrToken,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Mốc đã lệch ngày nhưng vẫn chỉnh được",
          }),
        },
      );
      const invalidDateEdit = await request(
        `/interns/${internId}/schedule/milestones/${phaseOneId}`,
        hrToken,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start_date: "2026-10-02" }),
        },
      );
      check(
        "Mốc cũ lệch khỏi hợp đồng vẫn sửa được trạng thái/tiêu đề; sửa ngày ngoài hạn bị từ chối",
        statusOnly.ok && titleOnly.ok && invalidDateEdit.status === 400,
      );
    } finally {
      await rangeConn.query(
        "UPDATE internship_contracts SET start_date = '2026-10-01' WHERE intern_id = ? AND confirmation_status = 'CONFIRMED'",
        [internId],
      );
      await rangeConn.end();
    }
    const duplicate = await request(
      `/interns/${internId}/schedule/milestones`,
      hrToken,
      createOptions,
    );
    check("Tạo phase_order đã có trả 409", duplicate.status === 409);

    const outOfContractDate = await request(
      `/interns/${internId}/schedule/milestones`,
      hrToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...milestoneInput,
          phase_order: 3,
          title: "Ngoài hạn hợp đồng",
          start_date: "2026-09-30",
          end_date: "2026-10-03",
        }),
      },
    );
    check(
      "Từ chối ngày mốc nằm ngoài hợp đồng CONFIRMED",
      outOfContractDate.status === 400,
    );

    const created = await request(
      `/interns/${internId}/schedule/milestones`,
      hrToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...milestoneInput,
          phase_order: 2,
          title: "Mốc CRUD",
        }),
      },
    );
    const createdBody = await created.json();
    const createdMilestone = createdBody.data?.find(
      (m) => m.phaseOrder === 2 || m.phase_order === 2,
    );
    const milestoneId = createdMilestone?.id;
    const phaseConflict = milestoneId
      ? await request(
          `/interns/${internId}/schedule/milestones/${milestoneId}`,
          hrToken,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phase_order: 1 }),
          },
        )
      : null;
    check("Sửa sang phase_order đã có trả 409", phaseConflict?.status === 409);
    const updated = milestoneId
      ? await request(
          `/interns/${internId}/schedule/milestones/${milestoneId}`,
          hrToken,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Mốc đã sửa" }),
          },
        )
      : null;
    const removed = milestoneId
      ? await request(
          `/interns/${internId}/schedule/milestones/${milestoneId}`,
          hrToken,
          { method: "DELETE" },
        )
      : null;
    check(
      "HR tạo, sửa và xóa được mốc",
      created.status === 201 && updated?.ok && removed?.ok,
    );

    const templateConflict = await request(
      `/interns/${internId}/schedule/template`,
      hrToken,
      { method: "POST" },
    );
    const [[milestoneCount]] = await (async () => {
      const c = await mysql.createConnection(readDbConfig());
      try {
        return await c.query(
          "SELECT COUNT(*) AS total FROM intern_schedules WHERE intern_id = ?",
          [internId],
        );
      } finally {
        await c.end();
      }
    })();
    check(
      "Tạo mẫu khi đã có mốc trả 409 và không chèn mẫu một phần",
      templateConflict.status === 409 && Number(milestoneCount.total) === 1,
    );

    // TEST 6: Tra cứu với ID sai định dạng hoặc không tồn tại
    const badIdRes = await request("/interns/abc/schedule", hrToken);
    check(
      "Tra cứu với ID không hợp lệ trả về 400 Bad Request",
      badIdRes.status === 400,
    );

    const notFoundRes = await request("/interns/99999999/schedule", hrToken);
    check(
      "Tra cứu với ID không tồn tại trả về 404 Not Found",
      notFoundRes.status === 404,
    );
  } finally {
    console.log("\n Dọn dẹp dữ liệu kiểm thử...");
    await cleanupByPattern([PREFIX]);
  }

  console.log("\n----------------------------------------------------");
  console.log(` KẾT QUẢ API TEST SCHEDULE: ${passed}/${passed + failed} PASS`);
  console.log("----------------------------------------------------\n");

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error("Lỗi thực thi test:", err);
    process.exit(1);
  });
}

module.exports = run;
