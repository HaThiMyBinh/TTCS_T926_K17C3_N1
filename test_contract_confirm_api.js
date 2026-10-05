const fs = require("fs");
const path = require("path");
const { BASE_URL, loginAs, cleanupByPattern } = require("./test_helpers");

const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
const PREFIX = `contract_confirm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const PDF = Buffer.from("%PDF-1.4\ncontract confirmation test\n%%EOF");
let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`[PASS] ${name}`);
  } else {
    failed += 1;
    console.error(`[FAIL] ${name}${detail ? `: ${detail}` : ""}`);
  }
}

async function request(url, token, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${BASE_URL}${url}`, { ...options, headers });
}

async function createIntern(hrToken, email) {
  const response = await request("/interns", hrToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "Intern Contract Confirm Test",
      email,
      university: "Test University",
    }),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(`Tạo hồ sơ intern thất bại: ${JSON.stringify(body)}`);
  return Number((body.intern || body.student).id);
}

async function loginIntern(email) {
  const response = await request("/auth/login", null, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: email, password: "password123" }),
  });
  const body = await response.json();
  if (!response.ok || !body.token)
    throw new Error(`Đăng nhập intern thất bại: ${JSON.stringify(body)}`);
  return body.token;
}

async function uploadContract(hrToken, internId) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([PDF], { type: "application/pdf" }),
    "confirmation.pdf",
  );
  form.append("title", "Hợp đồng cần xác nhận");
  const response = await request(`/interns/${internId}/contracts`, hrToken, {
    method: "POST",
    body: form,
  });
  const body = await response.json();
  if (response.status !== 201 || !body.data?.id)
    throw new Error(`Upload thất bại: ${JSON.stringify(body)}`);
  return body.data.id;
}

async function run() {
  const emails = [`${PREFIX}_one@ictu.edu.vn`, `${PREFIX}_two@ictu.edu.vn`];
  let hrToken;
  let firstInternId;
  let secondInternId;
  let contractId;
  let storedFilesBefore = new Set();
  try {
    hrToken = await loginAs("HR");
    const [adminToken, mentorToken, otherHrToken] = await Promise.all([
      loginAs("Admin"),
      loginAs("Mentor"),
      loginAs("HR"),
    ]);
    firstInternId = await createIntern(hrToken, emails[0]);
    secondInternId = await createIntern(hrToken, emails[1]);
    const internToken = await loginIntern(emails[0]);
    const otherInternToken = await loginIntern(emails[1]);
    storedFilesBefore = new Set(fs.readdirSync(UPLOADS_DIR));
    contractId = await uploadContract(hrToken, firstInternId);

    // 1. Intern xem đúng danh sách của mình, tải đúng nội dung và xác nhận hợp đồng.
    const listResponse = await request("/me/contracts", internToken);
    const listBody = await listResponse.json();
    const ownContract = listBody.data?.find(
      (item) => Number(item.id) === Number(contractId),
    );
    const downloadResponse = await request(
      `/me/contracts/${contractId}/download`,
      internToken,
    );
    const downloaded = Buffer.from(await downloadResponse.arrayBuffer());
    const confirmResponse = await request(
      `/me/contracts/${contractId}/confirm`,
      internToken,
      { method: "POST" },
    );
    const confirmBody = await confirmResponse.json();
    const hrListResponse = await request(
      `/interns/${firstInternId}/contracts`,
      otherHrToken,
    );
    const hrListBody = await hrListResponse.json();
    const hrContract = hrListBody.data?.find(
      (item) => Number(item.id) === Number(contractId),
    );
    check(
      "Intern xem, tải và xác nhận hợp đồng của mình",
      listResponse.ok &&
        ownContract &&
        ownContract.confirmation_status === "PENDING" &&
        downloadResponse.ok &&
        downloaded.equals(PDF) &&
        confirmResponse.ok &&
        confirmBody.data?.confirmation_status === "CONFIRMED" &&
        confirmBody.data?.confirmed_at &&
        hrContract?.confirmation_status === "CONFIRMED" &&
        hrContract?.confirmed_at,
    );

    // 2. Xác nhận lần hai có phản hồi xung đột rõ ràng.
    const repeatResponse = await request(
      `/me/contracts/${contractId}/confirm`,
      internToken,
      { method: "POST" },
    );
    const repeatBody = await repeatResponse.json();
    check(
      "Từ chối xác nhận lặp",
      repeatResponse.status === 409 &&
        /đã được bạn xác nhận/.test(
          repeatBody.message || repeatBody.error || "",
        ),
    );

    // 3. Tài khoản Intern khác không thể truy cập hợp đồng này.
    const idorResponse = await request(
      `/me/contracts/${contractId}/confirm`,
      otherInternToken,
      { method: "POST" },
    );
    check(
      "Intern khác bị chặn bởi kiểm tra quyền sở hữu",
      idorResponse.status === 404,
    );

    // 4. Mọi route Intern đều cần đúng role và token.
    const protectedPaths = [
      { url: "/me/contracts", method: "GET" },
      { url: `/me/contracts/${contractId}/download`, method: "GET" },
      { url: `/me/contracts/${contractId}/confirm`, method: "POST" },
    ];
    let permissionsCorrect = true;
    for (const roleToken of [adminToken, otherHrToken, mentorToken]) {
      for (const endpoint of protectedPaths) {
        const response = await request(endpoint.url, roleToken, {
          method: endpoint.method,
        });
        permissionsCorrect = permissionsCorrect && response.status === 403;
      }
    }
    for (const endpoint of protectedPaths) {
      const response = await request(endpoint.url, null, {
        method: endpoint.method,
      });
      permissionsCorrect = permissionsCorrect && response.status === 401;
    }
    check(
      "Các endpoint Intern từ chối role khác (403) và thiếu token (401)",
      permissionsCorrect,
    );

    // 5. Hợp đồng đã xác nhận chặn cả xóa hợp đồng, hồ sơ và tài khoản Intern.
    const deleteResponse = await request(
      `/interns/${firstInternId}/contracts/${contractId}`,
      hrToken,
      { method: "DELETE" },
    );
    const deleteProfileResponse = await request(
      `/interns/${firstInternId}`,
      hrToken,
      { method: "DELETE" },
    );
    const userListResponse = await request("/users", adminToken);
    const userListBody = await userListResponse.json();
    const testUser = Array.isArray(userListBody)
      ? userListBody.find(
          (user) => user.email.toLowerCase() === emails[0].toLowerCase(),
        )
      : null;
    const deleteAccountResponse = testUser
      ? await request(`/users/${testUser.id}`, adminToken, { method: "DELETE" })
      : null;
    const remainsResponse = await request(
      `/interns/${firstInternId}/contracts`,
      hrToken,
    );
    const remainsBody = await remainsResponse.json();
    const remaining = remainsBody.data?.find(
      (item) => Number(item.id) === Number(contractId),
    );
    const newFiles = fs
      .readdirSync(UPLOADS_DIR)
      .filter((name) => !storedFilesBefore.has(name));
    check(
      "Không thể xóa hợp đồng, hồ sơ hoặc tài khoản đang giữ hợp đồng đã xác nhận",
      deleteResponse.status === 409 &&
        deleteProfileResponse.status === 409 &&
        deleteAccountResponse?.status === 409 &&
        remaining?.confirmation_status === "CONFIRMED" &&
        newFiles.length > 0 &&
        newFiles.some((name) => fs.existsSync(path.join(UPLOADS_DIR, name))),
    );
  } catch (err) {
    failed += 1;
    console.error(`[FAIL] Lỗi trong API test: ${err.message}`);
  } finally {
    // Luôn dọn hồ sơ, tài khoản và file test kể cả khi assertion hoặc request lỗi.
    try {
      await cleanupByPattern([PREFIX]);
    } catch (err) {
      failed += 1;
      console.error(`[FAIL] Dọn dữ liệu test: ${err.message}`);
    }
  }

  console.log(`\n${passed} PASS / ${failed} FAIL`);
  if (failed) process.exitCode = 1;
}

run();
