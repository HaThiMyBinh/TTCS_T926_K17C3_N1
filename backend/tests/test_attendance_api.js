const mysql = require("mysql2/promise");
const {
  BASE_URL,
  loginAs,
  readDbConfig,
  cleanupTestData,
  confirmContractDirect,
} = require("./test_helpers");
const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  PREFIX = `attx_${RUN_ID}`;
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
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function main() {
  const conn = await mysql.createConnection(readDbConfig());
  const emails = [];
  try {
    const hr = await loginAs("HR"),
      admin = await loginAs("Admin"),
      mentor = await loginAs("Mentor");
    const today = (
      await conn.query("SELECT DATE_FORMAT(NOW(),'%Y-%m-%d') AS today")
    )[0][0].today;
    const email = `${PREFIX}_intern@ictu.edu.vn`;
    emails.push(email);
    const made = await call("POST", "/interns", hr, {
      fullName: "Attendance Test",
      email,
      studentCode: `AT${Date.now()}`,
      university: "ICTU",
      major: "Software",
    });
    const intern = made.body?.intern || made.body?.student;
    if (![200, 201].includes(made.status) || !intern)
      throw Error(`Tạo intern: ${JSON.stringify(made.body)}`);
    const id = Number(intern.id);
    await confirmContractDirect(conn, id, { startDate: today, endDate: today });
    const it = await call("POST", "/auth/login", null, {
      account: email,
      password: "password123",
    });
    const token = it.body?.token;
    if (!token) throw Error("Không đăng nhập được intern test");
    const noContractEmail = `${PREFIX}_no_contract@ictu.edu.vn`;
    emails.push(noContractEmail);
    const nc = await call("POST", "/interns", hr, {
      fullName: "Attendance No Contract",
      email: noContractEmail,
      studentCode: `NC${Date.now()}`,
      university: "ICTU",
      major: "Software",
    });
    const noContractIntern = nc.body?.intern || nc.body?.student;
    if (!noContractIntern)
      throw Error(`Tạo intern chưa có hợp đồng: ${JSON.stringify(nc.body)}`);
    const noContractToken = (
      await call("POST", "/auth/login", null, {
        account: noContractEmail,
        password: "password123",
      })
    ).body?.token;
    const outsideEmail = `${PREFIX}_outside@ictu.edu.vn`;
    emails.push(outsideEmail);
    const oc = await call("POST", "/interns", hr, {
      fullName: "Attendance Outside Period",
      email: outsideEmail,
      studentCode: `OP${Date.now()}`,
      university: "ICTU",
      major: "Software",
    });
    const outsideIntern = oc.body?.intern || oc.body?.student;
    if (!outsideIntern)
      throw Error(`Tạo intern ngoài kỳ: ${JSON.stringify(oc.body)}`);
    const tomorrow = (
      await conn.query(
        "SELECT DATE_FORMAT(DATE_ADD(NOW(),INTERVAL 1 DAY),'%Y-%m-%d') AS day",
      )
    )[0][0].day;
    await confirmContractDirect(conn, Number(outsideIntern.id), {
      startDate: tomorrow,
      endDate: null,
    });
    const outsideToken = (
      await call("POST", "/auth/login", null, {
        account: outsideEmail,
        password: "password123",
      })
    ).body?.token;
    check(
      "Không token bị chặn",
      (await call("GET", "/me/attendance/today")).status === 401,
    );
    const noContractToday = await call(
      "GET",
      "/me/attendance/today",
      noContractToken,
    );
    check(
      "Chưa có hợp đồng thấy lý do trước check-in",
      noContractToday.status === 200 &&
        !!noContractToday.body?.data?.reason &&
        noContractToday.body.data.canCheckIn === false,
    );
    check(
      "Chưa có hợp đồng check-in trả 409",
      (await call("POST", "/me/attendance/check-in", noContractToken, {}))
        .status === 409,
    );
    const outsideToday = await call(
      "GET",
      "/me/attendance/today",
      outsideToken,
    );
    check(
      "Ngoài kỳ thấy lý do trước check-in",
      outsideToday.status === 200 &&
        !!outsideToday.body?.data?.reason &&
        outsideToday.body.data.canCheckIn === false,
    );
    check(
      "Ngoài kỳ check-in trả 409",
      (await call("POST", "/me/attendance/check-in", outsideToken, {}))
        .status === 409,
    );
    for (const [role, token2] of [
      ["HR", hr],
      ["Mentor", mentor],
      ["Admin", admin],
    ])
      check(
        `${role} không gọi được API intern`,
        (await call("GET", "/me/attendance/today", token2)).status === 403,
      );
    check(
      "Check-out trước check-in trả 409",
      (await call("POST", "/me/attendance/check-out", token, {})).status ===
        409,
    );
    const parallel = await Promise.all([
      call("POST", "/me/attendance/check-in", token, { note: "Ca sáng" }),
      call("POST", "/me/attendance/check-in", token, { note: "Ca sáng" }),
    ]);
    check(
      "Hai check-in song song chỉ tạo một lượt",
      parallel.filter((r) => r.status === 200).length === 1 &&
        parallel.filter((r) => r.status === 409).length === 1,
    );
    check(
      "Check-out thành công",
      (await call("POST", "/me/attendance/check-out", token, {})).status ===
        200,
    );
    check(
      "Lần hai check-out trả 409",
      (await call("POST", "/me/attendance/check-out", token, {})).status ===
        409,
    );
    const history = await call(
      "GET",
      `/me/attendance?from=${today}&to=${today}`,
      token,
    );
    check(
      "Lịch sử có summary và một ngày hoàn tất",
      history.status === 200 &&
        history.body?.data?.summary?.daysWorked === 1 &&
        history.body.data.records.length === 1,
    );
    check(
      "Body từ chối intern_id",
      (await call("POST", "/me/attendance/check-in", token, { intern_id: id }))
        .status === 400,
    );
    const d3 = (
      await conn.query(
        "SELECT DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 3 DAY),'%Y-%m-%d') AS d",
      )
    )[0][0].d;
    const [ins] = await conn.query(
      "INSERT INTO attendance_records (intern_id,work_date,check_in_at) VALUES (?,?,CONCAT(?,' 09:00:00'))",
      [id, d3, d3],
    );
    const missingId = ins.insertId;
    const missHistory = await call(
      "GET",
      `/me/attendance?from=${d3}&to=${today}`,
      token,
    );
    const missRow = missHistory.body?.data?.records?.find(
      (r) => r.id === missingId,
    );
    check(
      "Ngày quên check-out có thể đề nghị bổ sung",
      missRow?.status === "MISSING_CHECKOUT" &&
        missRow.canRequestCorrection === true,
    );
    check(
      "Giờ bổ sung trước giờ check-in bị từ chối",
      (
        await call("POST", `/me/attendance/${missingId}/correction`, token, {
          check_out_at: `${d3} 08:00`,
          reason: "Quên",
        })
      ).status === 400,
    );
    check(
      "Đề nghị thiếu lý do bị từ chối",
      (
        await call("POST", `/me/attendance/${missingId}/correction`, token, {
          check_out_at: `${d3} 17:00`,
        })
      ).status === 400,
    );
    const requested = await call(
      "POST",
      `/me/attendance/${missingId}/correction`,
      token,
      { check_out_at: `${d3} 17:00`, reason: "Quên check-out" },
    );
    check(
      "Gửi đề nghị bổ sung check-out",
      requested.status === 200 &&
        requested.body?.data?.correctionStatus === "PENDING",
    );
    check(
      "Đề nghị đang chờ duyệt không gửi lại được",
      (
        await call("POST", `/me/attendance/${missingId}/correction`, token, {
          check_out_at: `${d3} 17:00`,
          reason: "Quên check-out",
        })
      ).status === 409,
    );
    check(
      "Chưa duyệt thì chưa tính giờ",
      (await call("GET", `/me/attendance?from=${d3}&to=${d3}`, token)).body
        ?.data?.summary?.totalMinutes === 0,
    );
    check(
      "Admin không xem được chấm công",
      (await call("GET", `/interns/${id}/attendance`, admin)).status === 403,
    );
    const hrView = await call(
      "GET",
      `/interns/${id}/attendance?from=${d3}&to=${today}`,
      hr,
    );
    check(
      "HR xem được chấm công của thực tập sinh",
      hrView.status === 200 && hrView.body?.data?.records?.length >= 2,
    );
    const pending = await call("GET", "/attendance/corrections/pending", hr);
    check(
      "HR thấy đề nghị chờ duyệt",
      pending.status === 200 &&
        pending.body?.data?.some((r) => r.id === missingId),
    );
    check(
      "Intern không duyệt được đề nghị",
      (
        await call(
          "POST",
          `/attendance/${missingId}/correction/review`,
          token,
          { decision: "APPROVED" },
        )
      ).status === 403,
    );
    check(
      "Mentor không phụ trách không duyệt được",
      (
        await call(
          "POST",
          `/attendance/${missingId}/correction/review`,
          mentor,
          { decision: "APPROVED" },
        )
      ).status === 403,
    );
    check(
      "Từ chối phải có lý do",
      (
        await call("POST", `/attendance/${missingId}/correction/review`, hr, {
          decision: "REJECTED",
        })
      ).status === 400,
    );
    const approved = await call(
      "POST",
      `/attendance/${missingId}/correction/review`,
      hr,
      { decision: "APPROVED" },
    );
    check(
      "HR duyệt: bản ghi hoàn tất 8 giờ và đánh dấu đã điều chỉnh",
      approved.status === 200 &&
        approved.body?.data?.status === "COMPLETED" &&
        approved.body.data.durationMinutes === 480 &&
        approved.body.data.isAdjusted === true,
    );
    check(
      "Duyệt lần hai trả 409",
      (
        await call("POST", `/attendance/${missingId}/correction/review`, hr, {
          decision: "APPROVED",
        })
      ).status === 409,
    );
    check(
      "Giờ đã duyệt được tính vào lịch sử",
      (await call("GET", `/me/attendance?from=${d3}&to=${d3}`, token)).body
        ?.data?.summary?.totalMinutes === 480,
    );
  } catch (e) {
    failed++;
    console.error("[FAIL] attendance API setup/flow:", e.message);
  } finally {
    try {
      await cleanupTestData(emails);
    } catch (e) {
      failed++;
      console.error("[FAIL] attendance cleanup:", e.message);
    }
    await conn.end();
    console.log(`Attendance API: ${passed} PASS / ${failed} FAIL`);
    if (failed) process.exitCode = 1;
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
