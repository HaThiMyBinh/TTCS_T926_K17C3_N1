const mysql = require("mysql2/promise");
const {
  BASE_URL,
  loginAs,
  readDbConfig,
  cleanupTestData,
  confirmContractDirect,
} = require("./test_helpers");
const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  PREFIX = `frx_${RUN_ID}`,
  TEST_TITLE = `Báo cáo cuối kỳ ${PREFIX}`,
  TEST_UNIVERSITY = `ICTU ${PREFIX}`;
let passed = 0,
  failed = 0;
function check(n, c, d = "") {
  if (c) {
    passed++;
    console.log(`[PASS] ${n}`);
  } else {
    failed++;
    console.error(`[FAIL] ${n}${d ? ": " + d : ""}`);
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
  const ct = res.headers.get("content-type") || "";
  return {
    status: res.status,
    body: ct.includes("json") ? await res.json().catch(() => null) : null,
    res,
  };
}
async function main() {
  const conn = await mysql.createConnection(readDbConfig()),
    emails = [];
  try {
    const hr = await loginAs("HR"),
      admin = await loginAs("Admin"),
      mentor = await loginAs("Mentor"),
      internDemo = await loginAs("Intern");
    check(
      "Không token bị chặn",
      (await call("GET", "/final-reports", null)).status === 401,
    );
    for (const [role, t] of [
      ["Admin", admin],
      ["Mentor", mentor],
      ["Intern", internDemo],
    ])
      check(
        `${role} không truy cập báo cáo`,
        (await call("GET", "/final-reports", t)).status === 403,
      );
    const today = (
      await conn.query("SELECT DATE_FORMAT(NOW(),'%Y-%m-%d') AS today")
    )[0][0].today;
    const [mentorRows] = await conn.query(
      "SELECT id FROM mentors WHERE email='mentor@gmail.com' LIMIT 1",
    );
    const mentorId = Number(mentorRows[0]?.id);
    if (!mentorId) throw Error("Thiếu mentor demo");
    const created = [];
    for (let i = 0; i < 3; i++) {
      const email = `${PREFIX}_${i}@ictu.edu.vn`;
      emails.push(email);
      const r = await call("POST", "/interns", hr, {
        fullName: `Report Test ${i}`,
        email,
        studentCode: `FR${Date.now()}${i}`,
        university: TEST_UNIVERSITY,
        major: "Software",
      });
      const profile = r.body?.intern || r.body?.student;
      if (![200, 201].includes(r.status) || !profile)
        throw Error(`Tạo intern: ${JSON.stringify(r.body)}`);
      const id = Number(profile.id);
      created.push({ id, email });
      await call("PUT", `/interns/${id}/mentor`, hr, { mentor_id: mentorId });
      await confirmContractDirect(conn, id, {
        startDate: today,
        endDate: today,
      });
    }
    await conn.query(
      `INSERT INTO intern_evaluations (intern_id,mentor_id,skill_score,skill_comment,attitude_score,attitude_comment,overall_comment) VALUES (?,?,4,'Kỹ năng',5,'Thái độ','Nhận xét')`,
      [created[0].id, mentorId],
    );
    await conn.query(
      `INSERT INTO intern_evaluations (intern_id,mentor_id,skill_score,skill_comment,attitude_score,attitude_comment,overall_comment) VALUES (?,?,2,'Kỹ năng',3,'Thái độ','Nhận xét')`,
      [created[1].id, mentorId],
    );
    await conn.query(
      "UPDATE intern_profiles SET full_name='=SUM(A1:A2)' WHERE id=?",
      [created[0].id],
    );
    const body = {
      title: TEST_TITLE,
      scope_type: "UNIVERSITY",
      scope_value: TEST_UNIVERSITY,
      period_from: null,
      period_to: null,
      hr_note: "Kiểm thử",
    };
    const report = await call("POST", "/final-reports", hr, body);
    check(
      "HR tạo bản nháp",
      report.status === 200 && report.body?.data?.status === "DRAFT",
    );
    if (!report.body?.data?.id) throw Error("Không nhận id báo cáo");
    const id = report.body.data.id;
    const preview = await call(
      "GET",
      `/final-reports/preview?scope_type=UNIVERSITY&scope_value=${encodeURIComponent(body.scope_value)}`,
      hr,
    );
    check(
      "Preview gồm 2 đã đánh giá và 1 chưa",
      preview.status === 200 &&
        preview.body.data.summary.evaluated === 2 &&
        preview.body.data.summary.notEvaluated === 1,
    );
    const detail = await call("GET", `/final-reports/${id}`, hr);
    check(
      "Bản nháp tính dữ liệu sống",
      detail.status === 200 && detail.body.data.data.summary.totalInterns === 3,
    );
    const draft = await call("POST", "/final-reports", hr, {
      ...body,
      title: `Nháp ${TEST_TITLE}`,
    });
    const draftId = draft.body?.data?.id;
    check("HR tạo được bản nháp thứ hai", draft.status === 200 && !!draftId);
    if (draftId) {
      const updated = await call("PUT", `/final-reports/${draftId}`, hr, {
        ...body,
        title: `Đã sửa ${TEST_TITLE}`,
      });
      check(
        "HR sửa được bản nháp",
        updated.status === 200 &&
          updated.body.data.title === `Đã sửa ${TEST_TITLE}`,
      );
      check(
        "HR xóa được bản nháp",
        (await call("DELETE", `/final-reports/${draftId}`, hr)).status === 200,
      );
    }
    const periodOld = (
      await conn.query(
        "SELECT DATE_FORMAT(DATE_SUB(?, INTERVAL 10 DAY),'%Y-%m-%d') AS d",
        [today],
      )
    )[0][0].d;
    await conn.query(
      "INSERT INTO attendance_records (intern_id,work_date,check_in_at,check_out_at) VALUES (?,?,CONCAT(?,' 08:00:00'),CONCAT(?,' 09:00:00'))",
      [created[0].id, today, today, today],
    );
    await conn.query(
      "INSERT INTO attendance_records (intern_id,work_date,check_in_at,check_out_at) VALUES (?,?,CONCAT(?,' 08:00:00'),CONCAT(?,' 09:00:00'))",
      [created[0].id, periodOld, periodOld, periodOld],
    );
    const scopeQs = `scope_type=UNIVERSITY&scope_value=${encodeURIComponent(TEST_UNIVERSITY)}`;
    const allTime = await call("GET", `/final-reports/preview?${scopeQs}`, hr);
    const inPeriod = await call(
      "GET",
      `/final-reports/preview?${scopeQs}&from=${today}&to=${today}`,
      hr,
    );
    const minutesOf = (r) =>
      r.body?.data?.interns?.find((i) => i.internId === created[0].id)
        ?.totalWorkMinutes;
    check(
      "Giờ làm không lọc kỳ cộng toàn bộ chấm công",
      allTime.status === 200 && minutesOf(allTime) === 120,
    );
    check(
      "Giờ làm chỉ tính trong kỳ báo cáo",
      inPeriod.status === 200 && minutesOf(inPeriod) === 60,
    );
    const noContractEmail = `${PREFIX}_nocontract@ictu.edu.vn`;
    emails.push(noContractEmail);
    const noContract = await call("POST", "/interns", hr, {
      fullName: "No contract",
      email: noContractEmail,
      studentCode: `NK${Date.now()}`,
      university: TEST_UNIVERSITY,
      major: "Software",
    });
    const afterNoContract = await call(
      "GET",
      `/final-reports/preview?${scopeQs}`,
      hr,
    );
    check(
      "Thực tập sinh chưa có hợp đồng xác nhận không vào báo cáo",
      !!(noContract.body?.intern || noContract.body?.student) &&
        afterNoContract.body?.data?.summary?.totalInterns === 3,
    );
    const incomplete = await call(
      "POST",
      `/final-reports/${id}/finalize`,
      hr,
      {},
    );
    check(
      "Còn người chưa được đánh giá thì chốt bị chặn",
      incomplete.status === 409 &&
        incomplete.body?.code === "INCOMPLETE_EVALUATION" &&
        incomplete.body?.details?.notEvaluated === 1,
    );
    check(
      "Body chốt có trường lạ trả 400",
      (await call("POST", `/final-reports/${id}/finalize`, hr, { force: true }))
        .status === 400,
    );
    const finalized = await call("POST", `/final-reports/${id}/finalize`, hr, {
      confirm_incomplete: true,
    });
    check(
      "Chốt báo cáo lưu snapshot",
      finalized.status === 200 && finalized.body.data.status === "FINALIZED",
    );
    const before = finalized.body.data.data.summary.avgSkill;
    const mentorUpdate = await call(
      "PUT",
      `/interns/${created[0].id}/evaluation`,
      mentor,
      {
        skill_score: 1,
        attitude_score: 2,
        overall_comment: "Đã sửa sau khi chốt",
      },
    );
    check(
      "Mentor có thể cập nhật đánh giá sau khi chốt báo cáo",
      mentorUpdate.status === 200,
    );
    const after = await call("GET", `/final-reports/${id}`, hr);
    check(
      "Snapshot không đổi sau khi điểm mentor đổi",
      after.status === 200 && after.body.data.data.summary.avgSkill === before,
    );
    check(
      "Không thể sửa báo cáo đã chốt",
      (await call("PUT", `/final-reports/${id}`, hr, body)).status === 409,
    );
    check(
      "Không thể xóa báo cáo đã chốt",
      (await call("DELETE", `/final-reports/${id}`, hr)).status === 409,
    );
    const csv = await call("GET", `/final-reports/${id}/export.csv`, hr);
    // fetch().text() tự cắt BOM nên đọc byte thô để kiểm tra BOM thật sự
    const csvBytes = Buffer.from(await csv.res.arrayBuffer());
    const hasBom = csvBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
    const csvText = csvBytes.toString("utf8");
    check(
      "CSV có BOM, header và no-store",
      csv.status === 200 &&
        hasBom &&
        csvText.includes("Họ tên") &&
        csv.res.headers.get("cache-control") === "private, no-store",
    );
    check(
      "CSV vô hiệu hóa ô có công thức",
      csvText.includes('"\'=SUM(A1:A2)"'),
    );
    const noScoreEmail = `${PREFIX}_no_score@ictu.edu.vn`;
    emails.push(noScoreEmail);
    const noScore = await call("POST", "/interns", hr, {
      fullName: "No evaluation",
      email: noScoreEmail,
      studentCode: `NS${Date.now()}`,
      university: `NoScore ${PREFIX}`,
      major: "Software",
    });
    if (noScore.body?.intern || noScore.body?.student) {
      const emptyReport = await call("POST", "/final-reports", hr, {
        title: `No score ${TEST_TITLE}`,
        scope_type: "UNIVERSITY",
        scope_value: `NoScore ${PREFIX}`,
      });
      if (emptyReport.body?.data?.id) {
        check(
          "Chốt báo cáo chưa có đánh giá trả 409",
          (
            await call(
              "POST",
              `/final-reports/${emptyReport.body.data.id}/finalize`,
              hr,
              {},
            )
          ).status === 409,
        );
        await conn.query("DELETE FROM final_reports WHERE id=?", [
          emptyReport.body.data.id,
        ]);
      }
    }
    check(
      "Email người nhận sai bị từ chối",
      (
        await call("POST", `/final-reports/${id}/send`, hr, {
          recipients: ["khong-hop-le"],
        })
      ).status === 400,
    );
    const draftForSend = await call("POST", "/final-reports", hr, {
      ...body,
      title: `Gửi nháp ${TEST_TITLE}`,
    });
    if (draftForSend.body?.data?.id) {
      check(
        "Không gửi email báo cáo còn là bản nháp",
        (
          await call(
            "POST",
            `/final-reports/${draftForSend.body.data.id}/send`,
            hr,
            { recipients: ["ban.lanh.dao@ictu.edu.vn"] },
          )
        ).status === 409,
      );
      await conn.query("DELETE FROM final_reports WHERE id=?", [
        draftForSend.body.data.id,
      ]);
    }
    for (const [role, t] of [
      ["Admin", admin],
      ["Mentor", mentor],
      ["Intern", internDemo],
    ])
      check(
        `${role} không gửi được báo cáo`,
        (
          await call("POST", `/final-reports/${id}/send`, t, {
            recipients: ["a@b.vn"],
          })
        ).status === 403,
      );
    const mentorEval = await call(
      "GET",
      `/interns/${created[0].id}/evaluation`,
      hr,
    );
    check("HR vẫn bị chặn ở API đánh giá Mentor", mentorEval.status === 403);
    check(
      "ID sai định dạng trả 400",
      (await call("GET", "/final-reports/nope", hr)).status === 400,
    );
    check(
      "ID không tồn tại trả 404",
      (await call("GET", "/final-reports/987654321", hr)).status === 404,
    );
  } catch (e) {
    failed++;
    console.error("[FAIL] final reports API setup/flow:", e.message);
  } finally {
    try {
      await conn.query("DELETE FROM final_reports WHERE title=?", [TEST_TITLE]);
      await cleanupTestData(emails);
    } catch (e) {
      failed++;
      console.error("[FAIL] report cleanup:", e.message);
    }
    await conn.end();
    console.log(`Final reports API: ${passed} PASS / ${failed} FAIL`);
    if (failed) process.exitCode = 1;
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
