// test_review_documents_api.js - Integration test US10: HR xem & duyệt tài liệu thực tập sinh
// Yêu cầu: MySQL đang chạy và backend mở ở cổng 5000. Tự tạo & tự dọn dữ liệu; có FAIL thì thoát mã 1.
const mysql = require("mysql2/promise");
const {
  BASE_URL,
  loginAs,
  cleanupTestData,
  readDbConfig,
} = require("./test_helpers");

const APPS = `${BASE_URL}/applications`;
const PASSWORD = "password123";
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF",
);
const DOCX = Buffer.from([
  0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00, 0x00, 0x00, 0x21,
  0x00,
]);
const MSG_0 = "Hồ sơ chưa đủ tài liệu (0/2), không thể duyệt!";
const MSG_1 = "Hồ sơ chưa đủ tài liệu (1/2), không thể duyệt!";

const json = async (res) => ({
  status: res.status,
  body: await res.json().catch(() => ({})),
  headers: res.headers,
});
const bearer = (t) => (t ? { Authorization: `Bearer ${t}` } : {});

async function newCandidate(label) {
  const email = `us10_${label}_${Date.now()}_${Math.floor(Math.random() * 1000)}@ictu.edu.vn`;
  const reg = await json(
    await fetch(`${BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `US10 ${label}`,
        email,
        password: PASSWORD,
        phone: "0912345678",
        university: "ĐH CNTT",
        major: "KTPM",
      }),
    }),
  );
  if (reg.status !== 201)
    throw new Error(`Đăng ký thất bại: ${JSON.stringify(reg.body)}`);
  const login = await json(
    await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: email, password: PASSWORD }),
    }),
  );
  if (!login.body.token)
    throw new Error(`Đăng nhập thất bại: ${JSON.stringify(login.body)}`);
  return { id: reg.body.candidate.id, email, token: login.body.token };
}

async function upload(cand, docType, buffer, fileName, mime) {
  const form = new FormData();
  form.append("doc_type", docType);
  form.append("file", new Blob([buffer], { type: mime }), fileName);
  const r = await json(
    await fetch(`${APPS}/me/documents`, {
      method: "POST",
      headers: bearer(cand.token),
      body: form,
    }),
  );
  if (r.status !== 200)
    throw new Error(`Upload ${docType} thất bại: ${JSON.stringify(r.body)}`);
  return r.body.data; // { id, ... }
}

// Hồ sơ thực tập sinh (intern_profiles) cùng email với hồ sơ ứng tuyển -> HR xem tài liệu ở tab Hồ sơ thực tập sinh
async function seedInternProfile(cand) {
  const conn = await mysql.createConnection(readDbConfig());
  try {
    await conn.query(
      `INSERT INTO intern_profiles (student_code, full_name, email, phone, university, major, mentor_name, status)
       VALUES ('', ?, ?, '0912345678', 'ĐH CNTT', 'KTPM', '', 'Đang thực tập')
       ON DUPLICATE KEY UPDATE id = id`,
      [`US10 ${cand.email}`, cand.email],
    );
  } finally {
    await conn.end();
  }
}
const getStudents = (token) =>
  fetch(`${BASE_URL}/students`, { headers: bearer(token) }).then(json);

const patch = (id, body, token) =>
  fetch(`${APPS}/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...bearer(token) },
    body: JSON.stringify(body),
  }).then(json);
const getDocs = (id, token) =>
  fetch(`${APPS}/${id}/documents`, { headers: bearer(token) }).then(json);
const download = (id, docId, token, qs = "") =>
  fetch(`${APPS}/${id}/documents/${docId}/download${qs}`, {
    headers: bearer(token),
  });

async function main() {
  let pass = 0;
  let total = 0;
  const emails = [];
  const report = (id, desc, ok, detail = "") => {
    total++;
    if (ok) pass++;
    console.log(
      ` [${ok ? "PASS" : "FAIL"}] ${id}: ${desc}${ok || !detail ? "" : ` (${detail})`}`,
    );
  };
  // Mỗi test case độc lập: lỗi bất ngờ chỉ làm FAIL case đó
  const tc = async (id, desc, fn) => {
    try {
      const r = await fn();
      report(id, desc, r === true || (r && r.ok), r && r.detail);
    } catch (e) {
      report(id, desc, false, e.message);
    }
  };

  console.log("\n BẮT ĐẦU TEST US10: HR XEM & DUYỆT TÀI LIỆU THỰC TẬP SINH\n");
  try {
    const hr = await loginAs("HR");
    const admin = await loginAs("Admin");
    const mentor = await loginAs("Mentor");
    const demoIntern = await loginAs("Intern");

    const full = await newCandidate("full");
    const partial = await newCandidate("partial");
    const empty = await newCandidate("empty");
    const online = await newCandidate("online"); // hồ sơ online, chưa có tài liệu
    emails.push(full.email, partial.email, empty.email, online.email);

    const fullCv = await upload(
      full,
      "CV",
      PDF,
      "cv_full.pdf",
      "application/pdf",
    );
    const fullLetter = await upload(
      full,
      "APPLICATION_LETTER",
      DOCX,
      "don_full.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    await upload(partial, "CV", PDF, "cv_partial.pdf", "application/pdf");

    await seedInternProfile(full);
    await seedInternProfile(partial);

    // ---- GET /:id/documents ----
    await tc(
      "R01",
      "GET documents không token -> 401",
      async () => (await getDocs(full.id, null)).status === 401,
    );
    await tc(
      "R02",
      "Admin / Mentor / Intern (mẫu) / Intern chủ hồ sơ gọi API HR-only -> 403",
      async () => {
        const rs = await Promise.all(
          [admin, mentor, demoIntern, full.token].map((t) =>
            getDocs(full.id, t),
          ),
        );
        return {
          ok: rs.every((r) => r.status === 403 && r.body.success === false),
          detail: rs.map((r) => r.status).join("/"),
        };
      },
    );
    await tc("R03", "id sai định dạng (abc, -1, 1.5) -> 400", async () => {
      const rs = await Promise.all(
        ["abc", "-1", "1.5"].map((i) => getDocs(i, hr)),
      );
      return {
        ok: rs.every((r) => r.status === 400),
        detail: rs.map((r) => r.status).join("/"),
      };
    });
    await tc(
      "R04",
      "Hồ sơ không tồn tại -> 404",
      async () => (await getDocs(999999999, hr)).status === 404,
    );
    await tc(
      "R05",
      "HR xem hồ sơ đủ tài liệu: 2 file, tiến độ 2/2, không lộ stored_name",
      async () => {
        const r = await getDocs(full.id, hr);
        const b = r.body;
        return {
          ok:
            r.status === 200 &&
            b.documents.length === 2 &&
            b.progress.totalUploaded === 2 &&
            b.progress.requiredTotal === 2 &&
            b.progress.isComplete === true &&
            b.documents.every(
              (d) => d.id && d.original_name && !("stored_name" in d),
            ),
          detail: JSON.stringify(b.progress),
        };
      },
    );
    await tc(
      "R06",
      "HR xem hồ sơ thiếu tài liệu: tiến độ 1/2; hồ sơ trống: 0/2",
      async () => {
        const p = await getDocs(partial.id, hr);
        const e = await getDocs(empty.id, hr);
        return (
          p.status === 200 &&
          p.body.progress.progressText === "1/2 tài liệu" &&
          !p.body.progress.isComplete &&
          e.status === 200 &&
          e.body.progress.totalUploaded === 0 &&
          e.body.documents.length === 0
        );
      },
    );

    // ---- Duyệt / từ chối ----
    await tc(
      "R07",
      "Duyệt thiếu doc (1/2) -> 400 đúng thông báo, hồ sơ vẫn PENDING",
      async () => {
        const r = await patch(partial.id, { status: "APPROVED" }, hr);
        const list = await json(await fetch(APPS, { headers: bearer(hr) }));
        const row = (list.body.data || []).find((x) => x.id === partial.id);
        return {
          ok:
            r.status === 400 &&
            r.body.message === MSG_1 &&
            row &&
            row.status === "PENDING",
          detail: `${r.status} ${r.body.message}`,
        };
      },
    );
    await tc("R08", "Duyệt hồ sơ chưa có tài liệu (0/2) -> 400", async () => {
      const r = await patch(empty.id, { status: "APPROVED" }, hr);
      return {
        ok: r.status === 400 && r.body.message === MSG_0,
        detail: `${r.status} ${r.body.message}`,
      };
    });
    await tc(
      "R08b",
      "Hồ sơ online 0 doc: require_documents:false KHÔNG bỏ qua được điều kiện -> 400",
      async () => {
        const r = await patch(
          online.id,
          { status: "APPROVED", require_documents: false },
          hr,
        );
        return {
          ok: r.status === 400 && r.body.message === MSG_0,
          detail: `${r.status} ${r.body.message}`,
        };
      },
    );
    await tc(
      "R08c",
      "Sau đó hồ sơ online vẫn ở trạng thái chờ duyệt (PENDING)",
      async () => {
        const list = await json(await fetch(APPS, { headers: bearer(hr) }));
        const row = (list.body.data || []).find((x) => x.id === online.id);
        return {
          ok: row && row.status === "PENDING",
          detail: `status=${row?.status}`,
        };
      },
    );
    await tc(
      "R09",
      "PATCH status: không token 401; Admin/Mentor/Intern 403",
      async () => {
        const a = await patch(full.id, { status: "APPROVED" }, null);
        const rs = await Promise.all(
          [admin, mentor, demoIntern].map((t) =>
            patch(full.id, { status: "APPROVED" }, t),
          ),
        );
        return a.status === 401 && rs.every((r) => r.status === 403);
      },
    );
    await tc(
      "R10",
      "id sai -> 400; không tồn tại -> 404 (cả duyệt lẫn từ chối)",
      async () => {
        const a = await patch("abc", { status: "APPROVED" }, hr);
        const b = await patch(999999999, { status: "APPROVED" }, hr);
        const c = await patch(
          999999999,
          { status: "REJECTED", rejection_reason: "x" },
          hr,
        );
        return {
          ok: a.status === 400 && b.status === 404 && c.status === 404,
          detail: `${a.status}/${b.status}/${c.status}`,
        };
      },
    );
    await tc(
      "R11",
      "Từ chối KHÔNG cần đủ tài liệu: hồ sơ 1/2 và 0/2 đều -> 200 REJECTED",
      async () => {
        const a = await patch(
          partial.id,
          { status: "REJECTED", rejection_reason: "Thiếu đơn xin thực tập" },
          hr,
        );
        const b = await patch(
          empty.id,
          { status: "REJECTED", rejection_reason: "Không nộp tài liệu" },
          hr,
        );
        return {
          ok:
            a.status === 200 &&
            a.body.data.status === "REJECTED" &&
            b.status === 200 &&
            b.body.data.status === "REJECTED",
          detail: `${a.status}/${b.status}`,
        };
      },
    );
    await tc(
      "R12",
      "Duyệt hồ sơ đủ doc -> 200 APPROVED, ghi người duyệt",
      async () => {
        const r = await patch(full.id, { status: "APPROVED" }, hr);
        const d = r.body.data || {};
        return {
          ok:
            r.status === 200 &&
            d.status === "APPROVED" &&
            d.reviewed_by &&
            d.reviewed_at,
          detail: JSON.stringify(r.body),
        };
      },
    );
    await tc(
      "R13",
      "Xử lý lại hồ sơ đã duyệt / đã từ chối -> 409 (kể cả hồ sơ thiếu doc)",
      async () => {
        const a = await patch(full.id, { status: "APPROVED" }, hr);
        const b = await patch(
          full.id,
          { status: "REJECTED", rejection_reason: "đổi ý" },
          hr,
        );
        const c = await patch(partial.id, { status: "APPROVED" }, hr);
        return {
          ok: [a, b, c].every((r) => r.status === 409),
          detail: `${a.status}/${b.status}/${c.status}`,
        };
      },
    );

    // ---- Xem / tải file ----
    await tc("R14", "HR tải PDF: 200, attachment, đúng nội dung", async () => {
      const res = await download(full.id, fullCv.id, hr);
      const buf = Buffer.from(await res.arrayBuffer());
      const cd = res.headers.get("content-disposition") || "";
      return {
        ok: res.status === 200 && /^attachment/i.test(cd) && buf.equals(PDF),
        detail: `${res.status} ${cd}`,
      };
    });
    await tc(
      "R15",
      "Nút Xem với PDF (?disposition=inline): Content-Disposition inline + application/pdf",
      async () => {
        const res = await download(
          full.id,
          fullCv.id,
          hr,
          "?disposition=inline",
        );
        const buf = Buffer.from(await res.arrayBuffer());
        const cd = res.headers.get("content-disposition") || "";
        return {
          ok:
            res.status === 200 &&
            /^inline/i.test(cd) &&
            (res.headers.get("content-type") || "").startsWith(
              "application/pdf",
            ) &&
            res.headers.get("x-content-type-options") === "nosniff" &&
            buf.equals(PDF),
          detail: `${res.status} ${cd}`,
        };
      },
    );
    await tc(
      "R16",
      "Xem DOCX (?disposition=inline) vẫn là attachment (tải về)",
      async () => {
        const res = await download(
          full.id,
          fullLetter.id,
          hr,
          "?disposition=inline",
        );
        await res.arrayBuffer();
        const cd = res.headers.get("content-disposition") || "";
        return {
          ok: res.status === 200 && /^attachment/i.test(cd),
          detail: `${res.status} ${cd}`,
        };
      },
    );
    await tc(
      "R17",
      "Tải file: không token 401; Admin/Mentor 403; Intern khác 403; chủ hồ sơ 200",
      async () => {
        const [a, b, c, d, e] = await Promise.all([
          download(full.id, fullCv.id, null),
          download(full.id, fullCv.id, admin),
          download(full.id, fullCv.id, mentor),
          download(full.id, fullCv.id, partial.token),
          download(full.id, fullCv.id, full.token),
        ]);
        const st = [a, b, c, d, e].map((r) => r.status);
        return {
          ok: st.join() === "401,403,403,403,200",
          detail: st.join("/"),
        };
      },
    );
    await tc(
      "R18",
      "docId sai -> 400; docId không thuộc hồ sơ -> 404",
      async () => {
        const a = await download(full.id, "abc", hr);
        const b = await download(partial.id, fullCv.id, hr); // tài liệu của hồ sơ khác
        return {
          ok: a.status === 400 && b.status === 404,
          detail: `${a.status}/${b.status}`,
        };
      },
    );

    // ---- Tab Hồ sơ thực tập sinh: GET /students kèm hồ sơ + tài liệu (chỉ HR) ----
    await tc(
      "R19",
      "HR: /students trả hồ sơ duyệt + tài liệu của thực tập sinh (đã duyệt 2 file; bị từ chối 1 file kèm lý do)",
      async () => {
        const r = await getStudents(hr);
        const rows = Array.isArray(r.body) ? r.body : [];
        const f = rows.find((x) => x.email === full.email);
        const p = rows.find((x) => x.email === partial.email);
        return {
          ok:
            r.status === 200 &&
            f &&
            p &&
            f.application.id === full.id &&
            f.application.status === "APPROVED" &&
            f.documents.length === 2 &&
            f.documents.every(
              (d) => d.id && d.original_name && !("stored_name" in d),
            ) &&
            p.application.status === "REJECTED" &&
            p.application.rejection_reason &&
            p.documents.length === 1,
          detail: JSON.stringify([f && f.application, p && p.application]),
        };
      },
    );
    await tc(
      "R20",
      "Admin / Mentor: /students KHÔNG có application & documents; không token 401; Intern 403",
      async () => {
        const [a, m, none, i] = await Promise.all([
          getStudents(admin),
          getStudents(mentor),
          getStudents(null),
          getStudents(demoIntern),
        ]);
        const clean = (r) =>
          r.status === 200 &&
          Array.isArray(r.body) &&
          r.body.every((x) => !("application" in x) && !("documents" in x));
        return {
          ok: clean(a) && clean(m) && none.status === 401 && i.status === 403,
          detail: `${a.status}/${m.status}/${none.status}/${i.status}`,
        };
      },
    );
  } catch (e) {
    console.log(` [FAIL] SETUP: ${e.message}`);
    total++;
  } finally {
    try {
      const n = await cleanupTestData(emails);
      console.log(`\n Đã dọn ${n} bản ghi test.`);
    } catch (e) {
      console.log(` [WARN] Dọn dữ liệu thất bại: ${e.message}`);
    }
  }

  console.log(
    `\n KẾT QUẢ INTEGRATION TEST US10: ${pass}/${total} TEST CASES PASS\n`,
  );
  process.exit(pass === total && total > 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(" Lỗi không mong đợi:", e);
  process.exit(1);
});
