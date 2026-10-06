const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { BASE_URL, loginAs, readDbConfig } = require("./test_helpers");

const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
const TEST_PREFIX = `contract_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const FILES = {
  "contract.pdf": Buffer.from("%PDF-1.4\\ncontract sample"),
  "contract.doc": Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2]),
  "contract.docx": Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]),
};

let passed = 0;
let failed = 0;

function check(name, condition, details = "") {
  if (condition) {
    passed += 1;
    console.log(`[PASS] ${name}`);
    return;
  }

  failed += 1;
  console.error(`[FAIL] ${name}${details ? `: ${details}` : ""}`);
}

async function request(url, token, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  return fetch(`${BASE_URL}${url}`, { ...options, headers });
}

function makeUploadForm(buffer, filename, metadata = {}) {
  const form = new FormData();
  if (buffer !== undefined) {
    form.append("file", new Blob([buffer]), filename);
  }
  for (const [key, value] of Object.entries(metadata)) {
    form.append(key, value);
  }
  return form;
}

async function uploadContract(
  internId,
  token,
  buffer,
  filename,
  metadata = {},
) {
  return request(`/interns/${internId}/contracts`, token, {
    method: "POST",
    body: makeUploadForm(buffer, filename, metadata),
  });
}

async function createIntern(hrToken, email) {
  const response = await request("/interns", hrToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "Contract Test",
      email,
      university: "Test University",
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Tạo intern thất bại: ${JSON.stringify(body)}`);
  }

  return Number((body.intern || body.student).id);
}

function getNewFiles(previousFiles) {
  return fs.readdirSync(UPLOADS_DIR).filter((name) => !previousFiles.has(name));
}

async function runApiTests() {
  const internIds = [];
  const createdFiles = new Map();
  let hrToken;

  try {
    const tokens = {
      HR: (hrToken = await loginAs("HR")),
      Admin: await loginAs("Admin"),
      Mentor: await loginAs("Mentor"),
      Intern: await loginAs("Intern"),
    };

    const internId = await createIntern(
      tokens.HR,
      `${TEST_PREFIX}_one@ictu.edu.vn`,
    );
    const secondInternId = await createIntern(
      tokens.HR,
      `${TEST_PREFIX}_two@ictu.edu.vn`,
    );
    const accountDeleteInternId = await createIntern(
      tokens.HR,
      `${TEST_PREFIX}_account_delete@ictu.edu.vn`,
    );
    internIds.push(internId, secondInternId, accountDeleteInternId);

    for (const [filename, buffer] of Object.entries(FILES)) {
      const beforeUpload = new Set(fs.readdirSync(UPLOADS_DIR));
      const response = await uploadContract(
        internId,
        tokens.HR,
        buffer,
        filename,
        {
          title: filename,
          start_date: "2026-01-01",
          end_date: "2026-12-31",
          note: "Ghi chú kiểm thử",
        },
      );
      const body = await response.json();
      check(
        `Upload ${filename} và trả ngày dạng YYYY-MM-DD`,
        response.status === 201 &&
          body.data &&
          body.data.start_date === "2026-01-01" &&
          body.data.end_date === "2026-12-31" &&
          !Object.hasOwn(body.data, "stored_name"),
      );
      if (response.ok) {
        createdFiles.set(filename, getNewFiles(beforeUpload)[0]);
      }
    }

    const listResponse = await request(
      `/interns/${internId}/contracts`,
      tokens.HR,
    );
    const listBody = await listResponse.json();
    check("Liệt kê đủ hợp đồng", listResponse.ok && listBody.data.length === 3);

    const docxContract = listBody.data.find(
      (contract) => contract.original_name === "contract.docx",
    );
    const downloadResponse = await request(
      `/interns/${internId}/contracts/${docxContract.id}/download`,
      tokens.HR,
    );
    const downloadedContent = Buffer.from(await downloadResponse.arrayBuffer());
    check(
      "Tải xuống đúng nội dung",
      downloadResponse.ok && downloadedContent.equals(FILES["contract.docx"]),
    );

    const pdfContract = listBody.data.find(
      (contract) => contract.original_name === "contract.pdf",
    );
    const deletedPdfFile = createdFiles.get("contract.pdf");
    const deleteResponse = await request(
      `/interns/${internId}/contracts/${pdfContract.id}`,
      tokens.HR,
      { method: "DELETE" },
    );
    check("Xóa hợp đồng", deleteResponse.ok);
    check(
      "Xóa hợp đồng cũng xóa file trên đĩa",
      deletedPdfFile && !fs.existsSync(path.join(UPLOADS_DIR, deletedPdfFile)),
    );

    // --- Sửa chương trình/ngày của hợp đồng đã tải lên ---
    const patchContract = (token, targetInternId, contractId, payload) =>
      request(`/interns/${targetInternId}/contracts/${contractId}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    check(
      "PATCH hợp đồng: Mentor/Intern bị chặn",
      (await patchContract(tokens.Mentor, internId, docxContract.id, {
        program_id: null,
      })).status === 403 &&
        (await patchContract(tokens.Intern, internId, docxContract.id, {
          program_id: null,
        })).status === 403,
    );
    check(
      "PATCH hợp đồng: thiếu mọi trường cần sửa trả 400",
      (await patchContract(tokens.HR, internId, docxContract.id, {})).status ===
        400,
    );
    check(
      "PATCH hợp đồng: program_id không hợp lệ trả 400",
      (await patchContract(tokens.HR, internId, docxContract.id, {
        program_id: "abc",
      })).status === 400,
    );
    check(
      "PATCH hợp đồng: chương trình không tồn tại trả 404",
      (await patchContract(tokens.HR, internId, docxContract.id, {
        program_id: 999999999,
      })).status === 404,
    );
    check(
      "PATCH hợp đồng: hợp đồng không thuộc thực tập sinh trả 404",
      (await patchContract(tokens.HR, secondInternId, docxContract.id, {
        program_id: null,
      })).status === 404,
    );
    const unlinkResponse = await patchContract(
      tokens.HR,
      internId,
      docxContract.id,
      { program_id: null },
    );
    const unlinkBody = await unlinkResponse.json();
    check(
      "PATCH hợp đồng: gỡ liên kết bằng null",
      unlinkResponse.ok &&
        unlinkBody.data?.program_id === null &&
        !Object.hasOwn(unlinkBody.data, "stored_name"),
    );
    check(
      "PATCH hợp đồng: ngày sai định dạng trả 400",
      (await patchContract(tokens.HR, internId, docxContract.id, {
        start_date: "31/12/2026",
      })).status === 400,
    );
    check(
      "PATCH hợp đồng: ngày kết thúc trước ngày bắt đầu trả 400",
      (await patchContract(tokens.HR, internId, docxContract.id, {
        start_date: "2026-06-01",
        end_date: "2026-05-01",
      })).status === 400,
    );
    const datesResponse = await patchContract(
      tokens.HR,
      internId,
      docxContract.id,
      { start_date: "2026-02-01", end_date: "2026-11-30" },
    );
    const datesBody = await datesResponse.json();
    check(
      "PATCH hợp đồng: đổi ngày bắt đầu và kết thúc",
      datesResponse.ok &&
        datesBody.data?.start_date === "2026-02-01" &&
        datesBody.data?.end_date === "2026-11-30",
    );
    const endOnlyResponse = await patchContract(
      tokens.HR,
      internId,
      docxContract.id,
      { end_date: "2026-12-15" },
    );
    const endOnlyBody = await endOnlyResponse.json();
    check(
      "PATCH hợp đồng: chỉ đổi ngày kết thúc, giữ ngày bắt đầu",
      endOnlyResponse.ok &&
        endOnlyBody.data?.start_date === "2026-02-01" &&
        endOnlyBody.data?.end_date === "2026-12-15",
    );
    const programsResponse = await request("/programs", tokens.HR);
    const programsBody = await programsResponse.json();
    const existingProgram = programsBody.data?.[0];
    if (existingProgram) {
      const linkResponse = await patchContract(
        tokens.HR,
        internId,
        docxContract.id,
        { program_id: existingProgram.id },
      );
      const linkBody = await linkResponse.json();
      check(
        "PATCH hợp đồng: gắn chương trình có sẵn",
        linkResponse.ok &&
          Number(linkBody.data?.program_id) === Number(existingProgram.id),
      );
    } else {
      console.log("[INFO] Không có chương trình sẵn để thử gắn liên kết");
    }

    const invalidUploads = [
      [FILES["contract.pdf"], "unsupported.exe", 400, "Sai đuôi file"],
      [Buffer.from("MZbad"), "spoofed.pdf", 400, "Magic bytes giả mạo"],
      [Buffer.alloc(0), "empty.pdf", 400, "File rỗng"],
      [Buffer.alloc(5 * 1024 * 1024 + 1, 65), "large.pdf", 413, "Quá 5MB"],
    ];
    for (const [buffer, filename, expectedStatus, label] of invalidUploads) {
      const response = await uploadContract(
        internId,
        tokens.HR,
        buffer,
        filename,
      );
      check(label, response.status === expectedStatus);
    }

    const missingFileResponse = await request(
      `/interns/${internId}/contracts`,
      tokens.HR,
      { method: "POST", body: makeUploadForm() },
    );
    check("Từ chối request thiếu file", missingFileResponse.status === 400);

    const missingInternResponse = await uploadContract(
      "999999999",
      tokens.HR,
      FILES["contract.pdf"],
      "not-found.pdf",
    );
    check("Intern không tồn tại trả 404", missingInternResponse.status === 404);

    const invalidInternIdResponse = await uploadContract(
      "invalid-id",
      tokens.HR,
      FILES["contract.pdf"],
      "invalid-id.pdf",
    );
    check(
      "ID intern không hợp lệ trả 400",
      invalidInternIdResponse.status === 400,
    );

    const longTitleResponse = await uploadContract(
      internId,
      tokens.HR,
      FILES["contract.pdf"],
      "long-title.pdf",
      { title: "T".repeat(256) },
    );
    check(
      "Tiêu đề dài hơn 255 ký tự trả 400",
      longTitleResponse.status === 400,
    );

    const longNoteResponse = await uploadContract(
      internId,
      tokens.HR,
      FILES["contract.pdf"],
      "long-note.pdf",
      { note: "N".repeat(1001) },
    );
    check(
      "Ghi chú dài hơn 1000 ký tự trả 400",
      longNoteResponse.status === 400,
    );

    const invalidDatesResponse = await uploadContract(
      internId,
      tokens.HR,
      FILES["contract.pdf"],
      "invalid-dates.pdf",
      { start_date: "2026-12-31", end_date: "2026-01-01" },
    );
    check(
      "Khoảng ngày không hợp lệ trả 400",
      invalidDatesResponse.status === 400,
    );

    const beforeOtherInternUpload = new Set(fs.readdirSync(UPLOADS_DIR));
    const otherInternUpload = await uploadContract(
      secondInternId,
      tokens.HR,
      FILES["contract.pdf"],
      "other-intern.pdf",
    );
    const otherInternBody = await otherInternUpload.json();
    if (otherInternUpload.ok) {
      createdFiles.set(
        "other-intern.pdf",
        getNewFiles(beforeOtherInternUpload)[0],
      );
    }
    const idorResponse = await request(
      `/interns/${internId}/contracts/${otherInternBody.data.id}/download`,
      tokens.HR,
    );
    check("IDOR trả 404", idorResponse.status === 404);

    const protectedEndpoints = [
      { method: "GET", url: `/interns/${internId}/contracts` },
      { method: "POST", url: `/interns/${internId}/contracts` },
      {
        method: "GET",
        url: `/interns/${internId}/contracts/1/download`,
      },
      { method: "DELETE", url: `/interns/${internId}/contracts/1` },
    ];

    for (const role of ["Admin", "Mentor", "Intern"]) {
      for (const endpoint of protectedEndpoints) {
        const options = { method: endpoint.method };
        if (endpoint.method === "POST") {
          options.body = makeUploadForm(
            FILES["contract.pdf"],
            "unauthorized.pdf",
          );
        }
        const response = await request(endpoint.url, tokens[role], options);
        check(
          `Từ chối ${role} qua ${endpoint.method}`,
          response.status === 403,
        );
      }
    }

    for (const endpoint of protectedEndpoints) {
      const options = { method: endpoint.method };
      if (endpoint.method === "POST") {
        options.body = makeUploadForm(FILES["contract.pdf"], "no-token.pdf");
      }
      const response = await request(endpoint.url, null, options);
      check(`Thiếu token qua ${endpoint.method}`, response.status === 401);
    }

    const beforeAccountUpload = new Set(fs.readdirSync(UPLOADS_DIR));
    const accountContractResponse = await uploadContract(
      accountDeleteInternId,
      tokens.HR,
      FILES["contract.pdf"],
      "account-delete.pdf",
    );
    check("Upload hợp đồng cho ca xóa tài khoản", accountContractResponse.ok);
    const accountContractFile = getNewFiles(beforeAccountUpload)[0];

    const mysqlConnection = await mysql.createConnection(readDbConfig());
    let internUserId;
    try {
      const [users] = await mysqlConnection.query(
        `SELECT u.id FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE LOWER(u.email) = LOWER(?) AND r.role_name = 'Intern'`,
        [`${TEST_PREFIX}_account_delete@ictu.edu.vn`],
      );
      internUserId = users[0]?.id;
    } finally {
      await mysqlConnection.end();
    }

    const deleteAccountResponse = await request(
      `/users/${internUserId}`,
      tokens.Admin,
      { method: "DELETE" },
    );
    check("Xóa tài khoản Intern", deleteAccountResponse.ok);
    internIds.splice(internIds.indexOf(accountDeleteInternId), 1);
    check(
      "Xóa tài khoản Intern cũng xóa file hợp đồng",
      accountContractFile &&
        !fs.existsSync(path.join(UPLOADS_DIR, accountContractFile)),
    );

    const fileForInternDelete = createdFiles.get("other-intern.pdf");
    const deleteInternResponse = await request(
      `/interns/${secondInternId}`,
      tokens.HR,
      { method: "DELETE" },
    );
    check("Xóa hồ sơ thực tập sinh", deleteInternResponse.ok);
    internIds.splice(internIds.indexOf(secondInternId), 1);
    check(
      "Xóa hồ sơ cũng dọn file hợp đồng",
      fileForInternDelete &&
        !fs.existsSync(path.join(UPLOADS_DIR, fileForInternDelete)),
    );
  } catch (err) {
    failed += 1;
    console.error("[FAIL] Lỗi trong test API:", err);
  } finally {
    if (hrToken) {
      for (const internId of internIds) {
        try {
          await request(`/interns/${internId}`, hrToken, { method: "DELETE" });
        } catch {
          // Best-effort cleanup; run_all.js also cleans test data by email prefix.
        }
      }
    }
  }

  console.log(`\n${passed} PASS / ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
}

runApiTests();
