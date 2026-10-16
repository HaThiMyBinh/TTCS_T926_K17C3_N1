// API integration test: HR duyệt và phản hồi yêu cầu hỗ trợ.
const mysql = require("mysql2/promise");
const { BASE_URL, loginAs, readDbConfig, cleanupTestData, confirmContractDirect } = require("./test_helpers");
const { getVietnamToday } = require("../utils/date");
const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const PREFIX = `support_test_${RUN_ID}`;
let failed = 0;
function check(name, ok, detail = "") { if (ok) console.log(` [PASS] ${name}`); else { failed += 1; console.error(` [FAIL] ${name}: ${detail}`); } }
async function call(method, url, token, body) { const headers = token ? { Authorization: `Bearer ${token}` } : {}; if (body !== undefined) headers["Content-Type"] = "application/json"; const response = await fetch(`${BASE_URL}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); return { response, body: (response.headers.get("content-type") || "").includes("application/json") ? await response.json() : null }; }
async function createIntern(hrToken, suffix = "") { const email = `${PREFIX}${suffix}@ictu.edu.vn`; const result = await call("POST", "/interns", hrToken, { fullName: "Intern Support Test", email, studentCode: `SP${RUN_ID.slice(-5)}${suffix}`, university: "ICTU", major: "CNTT" }); if (result.response.status !== 201) throw new Error(JSON.stringify(result.body)); return { email, id: Number((result.body.intern || result.body.student).id) }; }
async function login(email) { const result = await call("POST", "/auth/login", null, { account: email, password: "password123" }); if (!result.body?.token) throw new Error("Không đăng nhập được intern test"); return result.body.token; }
async function upload(url, token, name, content) { const form = new FormData(); form.append("file", new Blob([content], { type: "application/pdf" }), name); const response = await fetch(`${BASE_URL}${url}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }); return { response, body: await response.json() }; }
(async () => {
  const emails = []; let conn;
  try {
    conn = await mysql.createConnection(readDbConfig());
    const hr = await loginAs("HR"), admin = await loginAs("Admin"), mentor = await loginAs("Mentor");
    const intern = await createIntern(hr); emails.push(intern.email); await confirmContractDirect(conn, intern.id, { startDate: getVietnamToday(), endDate: "2099-12-31" }); const internToken = await login(intern.email);
    check("401 khi chưa đăng nhập", (await call("GET", "/support-requests")).response.status === 401);
    for (const [name, token] of [["Intern", internToken], ["Mentor", mentor], ["Admin", admin]]) check(`${name} không truy cập API HR`, (await call("GET", "/support-requests", token)).response.status === 403);
    const created = await call("POST", "/me/support-requests", internToken, { request_type: "INTERNSHIP_CERTIFICATE", title: "Xin giấy xác nhận", description: "Dùng nộp trường" }); check("Intern tạo yêu cầu", created.response.status === 201, JSON.stringify(created.body)); const id = created.body?.data?.id;
    const listed = await call("GET", "/support-requests?page=1&pageSize=20&q=x%C3%A1c", hr); check("HR list có phân trang và no-store", listed.response.status === 200 && listed.body.data.total >= 1 && listed.response.headers.get("cache-control") === "private, no-store");
    check("Không upload RESULT khi PENDING", (await upload(`/support-requests/${id}/result-attachments`, hr, "x.pdf", "%PDF-1.4")).response.status === 409);
    check("START thành công", (await call("POST", `/support-requests/${id}/process`, hr, { decision: "START" })).response.status === 200);
    check("Hai HR không thể START lại", (await call("POST", `/support-requests/${id}/process`, hr, { decision: "START" })).response.status === 409);
    const file = await upload(`/support-requests/${id}/result-attachments`, hr, "result.pdf", "%PDF-1.4 result"); check("HR tải file RESULT", file.response.status === 201); const attachmentId = file.body?.data?.id;
    const download = await fetch(`${BASE_URL}/support-requests/${id}/attachments/${attachmentId}/download`, { headers: { Authorization: `Bearer ${hr}` } }); check("Tải RESULT có Content-Disposition", download.status === 200 && (download.headers.get("content-disposition") || "").includes("attachment"));
    check("Xóa RESULT khi IN_PROGRESS", (await call("DELETE", `/support-requests/${id}/result-attachments/${attachmentId}`, hr)).response.status === 200);
    check("RESOLVE cần note hoặc file", (await call("POST", `/support-requests/${id}/process`, hr, { decision: "RESOLVE" })).response.status === 400);
    check("RESOLVE với note", (await call("POST", `/support-requests/${id}/process`, hr, { decision: "RESOLVE", note: "Đã hoàn tất" })).response.status === 200);
    check("GET detail HR có handler", (await call("GET", `/support-requests/${id}`, hr)).body?.data?.handledByName);
    // Thực tập sinh xem được kết quả; không lộ người xử lý / tên file lưu trên đĩa.
    const mine = await call("GET", "/me/support-requests", internToken); const mineItem = mine.body?.data?.items?.find((item) => item.id === id);
    check("Intern thấy yêu cầu đã giải quyết kèm ghi chú", mineItem?.status === "RESOLVED" && mineItem.resolutionNote === "Đã hoàn tất", JSON.stringify(mineItem));
    check("Intern không nhận handledBy / storedName", mineItem && !("handledBy" in mineItem) && !("handledByName" in mineItem) && !JSON.stringify(mineItem).includes("storedName"));
    const notices = await call("GET", "/notifications", internToken);
    check("Intern nhận thông báo SUPPORT_REQUEST_UPDATED", (notices.body?.data?.items || notices.body?.items || []).some((n) => n.type === "SUPPORT_REQUEST_UPDATED" && n.targetTab === "tab-my-support"), JSON.stringify(notices.body).slice(0, 200));
    check("RESOLVED là trạng thái cuối (START lại → 409)", (await call("POST", `/support-requests/${id}/process`, hr, { decision: "START" })).response.status === 409);
    check("Trường lạ trong process → 400", (await call("POST", `/support-requests/${id}/process`, hr, { decision: "START", status: "RESOLVED" })).response.status === 400);
    check("Tìm kiếm ký tự % không khớp mọi dòng", (await call("GET", "/support-requests?q=%25", hr)).body?.data?.total === 0);
    check("Tham số lọc lạ → 400", (await call("GET", "/support-requests?foo=1", hr)).response.status === 400);

    // Luồng từ chối + giới hạn 3 file kết quả + hai HR xử lý song song.
    const second = await call("POST", "/me/support-requests", internToken, { request_type: "INTRODUCTION_LETTER", title: "Xin giấy giới thiệu", description: "" }); const id2 = second.body?.data?.id;
    check("Tạo yêu cầu thứ hai", second.response.status === 201, JSON.stringify(second.body));
    const [a, b] = await Promise.all([call("POST", `/support-requests/${id2}/process`, hr, { decision: "START" }), call("POST", `/support-requests/${id2}/process`, hr, { decision: "START" })]);
    check("Hai HR START song song: một thành công, một 409", [a.response.status, b.response.status].sort().join() === "200,409", `${a.response.status},${b.response.status}`);
    check("File giả mạo đuôi → 400", (await upload(`/support-requests/${id2}/result-attachments`, hr, "fake.pdf", "MZ-not-a-pdf")).response.status === 400);
    const ids = [];
    for (let i = 1; i <= 3; i += 1) { const up = await upload(`/support-requests/${id2}/result-attachments`, hr, `r${i}.pdf`, `%PDF-1.4 ${i}`); check(`Tải file kết quả ${i}/3`, up.response.status === 201); ids.push(up.body?.data?.id); }
    check("File kết quả thứ 4 → 409", (await upload(`/support-requests/${id2}/result-attachments`, hr, "r4.pdf", "%PDF-1.4 4")).response.status === 409);
    const internDownload = await fetch(`${BASE_URL}/support-requests/${id2}/attachments/${ids[0]}/download`, { headers: { Authorization: `Bearer ${internToken}` } });
    check("Intern chủ yêu cầu tải được file kết quả", internDownload.status === 200 && (await internDownload.text()).startsWith("%PDF"));
    const other = await createIntern(hr, "b"); emails.push(other.email); await confirmContractDirect(conn, other.id, { startDate: getVietnamToday(), endDate: "2099-12-31" }); const otherToken = await login(other.email);
    const stolen = await fetch(`${BASE_URL}/support-requests/${id2}/attachments/${ids[0]}/download`, { headers: { Authorization: `Bearer ${otherToken}` } });
    check("Intern khác không tải được file (404)", stolen.status === 404, String(stolen.status));
    check("Intern khác không thấy yêu cầu trong danh sách", !((await call("GET", "/me/support-requests", otherToken)).body?.data?.items || []).some((item) => item.id === id2));
    check("REJECT cần lý do → 400", (await call("POST", `/support-requests/${id2}/process`, hr, { decision: "REJECT" })).response.status === 400);
    check("REJECT với lý do", (await call("POST", `/support-requests/${id2}/process`, hr, { decision: "REJECT", note: "Thiếu thông tin" })).response.status === 200);
    const rejected = (await call("GET", "/me/support-requests?status=REJECTED", internToken)).body?.data?.items?.[0];
    check("Intern thấy lý do từ chối", rejected?.status === "REJECTED" && rejected.resolutionNote === "Thiếu thông tin", JSON.stringify(rejected));
    check("Không upload RESULT sau khi đã từ chối", (await upload(`/support-requests/${id2}/result-attachments`, hr, "late.pdf", "%PDF-1.4 late")).response.status === 409);
    check("Intern không hủy được yêu cầu đã xử lý", (await call("POST", `/me/support-requests/${id2}/cancel`, internToken)).response.status === 409);
  } catch (err) { failed += 1; console.error(err); } finally { if (conn) await conn.end(); await cleanupTestData(emails).catch(() => {}); }
  if (failed) process.exit(1); console.log("PASS test_support_requests_api");
})();
