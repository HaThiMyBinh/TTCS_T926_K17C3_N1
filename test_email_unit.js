// tests/test_email_unit.js - Unit tests cho Email Service, Templates & Error Handling (US8)
// Chạy độc lập trong bộ nhớ, không cần kết nối mạng hay MySQL.
const assert = require("assert");
const templates = require("../services/email/templates");
const emailSender = require("../services/email/emailSender");
const smtpConfig = require("../services/email/smtpConfig");
const {
  EmailQueue,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
} = require("../services/email/emailQueue");

let passed = 0;
let total = 0;

function report(tcId, name, condition) {
  total++;
  if (condition) {
    passed++;
    console.log(` [PASS] ${tcId}: ${name}`);
  } else {
    console.error(` [FAIL] ${tcId}: ${name}`);
  }
}

async function runUnitTests() {
  console.log("\n====================================================");
  console.log(" BẮT ĐẦU UNIT TEST EMAIL SERVICE & TEMPLATES ");
  console.log("====================================================\n");

  // 1. Kiểm thử escapeHtml chống XSS / HTML Injection
  try {
    const raw = `<script>alert("xss")</script> & 'hello'`;
    const escaped = templates.escapeHtml(raw);
    report(
      "TC_UNIT_01",
      "escapeHtml() mã hóa an toàn các ký tự nhạy cảm (<, >, &, \", ')",
      escaped.includes("&lt;script&gt;") &&
        escaped.includes("&amp;") &&
        escaped.includes("&quot;") &&
        escaped.includes("&#39;") &&
        !escaped.includes("<script>"),
    );
  } catch (e) {
    report("TC_UNIT_01", "escapeHtml() lỗi: " + e.message, false);
  }

  // 2. Kiểm thử nội dung Template Approved (Chúc mừng trúng tuyển)
  try {
    const app = { name: "Nguyễn Văn An", email: "an@example.com" };
    const rendered = templates.renderApprovedEmail(app);
    const hasName =
      rendered.subject.includes("Nguyễn Văn An") &&
      rendered.html.includes("Nguyễn Văn An");
    const hasApprovedKeyword =
      rendered.html.includes("DUYỆT") || rendered.html.includes("CHẤP THUẬN");
    const hasHtmlStructure =
      rendered.html.includes("<!DOCTYPE html>") &&
      rendered.html.includes("</html>");
    const hasTextFallback =
      typeof rendered.text === "string" &&
      rendered.text.includes("Nguyễn Văn An");

    report(
      "TC_UNIT_02",
      "renderApprovedEmail() chèn biến động họ tên, hiển thị HTML chuẩn & có bản text fallback",
      hasName && hasApprovedKeyword && hasHtmlStructure && hasTextFallback,
    );
  } catch (e) {
    report("TC_UNIT_02", "renderApprovedEmail() lỗi: " + e.message, false);
  }

  // 3. Kiểm thử nội dung Template Rejected (Từ chối kèm lý do)
  try {
    const app = {
      name: "Trần Thị Bích",
      email: "bich@example.com",
      rejection_reason: "Chưa đủ điểm TOEIC yêu cầu (tối thiểu 650)",
    };
    const rendered = templates.renderRejectedEmail(app);
    const hasName = rendered.html.includes("Trần Thị Bích");
    const hasReason = rendered.html.includes(
      "Chưa đủ điểm TOEIC yêu cầu (tối thiểu 650)",
    );
    const hasHtmlStructure =
      rendered.html.includes("<!DOCTYPE html>") &&
      rendered.html.includes("table");
    const textHasReason = rendered.text.includes("Chưa đủ điểm TOEIC yêu cầu");

    report(
      "TC_UNIT_03",
      "renderRejectedEmail() hiển thị lý do từ chối chính xác, HTML chuẩn & text fallback",
      hasName && hasReason && hasHtmlStructure && textHasReason,
    );
  } catch (e) {
    report("TC_UNIT_03", "renderRejectedEmail() lỗi: " + e.message, false);
  }

  // 4. Kiểm thử chống chèn mã độc vào lý do từ chối (XSS Injection Prevention)
  try {
    const app = {
      name: "<b>Hacker</b>",
      email: "hacker@example.com",
      rejection_reason: `<img src=x onerror=alert('hack')> <script>evil()</script>`,
    };
    const rendered = templates.renderRejectedEmail(app);
    const safeHtml =
      !rendered.html.includes("<script>") &&
      !rendered.html.includes("<img src=x");
    report(
      "TC_UNIT_04",
      "Template email tự động escape các thẻ độc hại trong tên & lý do từ chối",
      safeHtml,
    );
  } catch (e) {
    report("TC_UNIT_04", "Kiểm thử XSS lỗi: " + e.message, false);
  }

  // 5. Kiểm thử Template Test Email (Admin gửi thử)
  try {
    const rendered = templates.renderTestEmail();
    report(
      "TC_UNIT_05",
      "renderTestEmail() tạo template thử nghiệm hợp lệ với tiêu đề và nội dung kiểm tra",
      rendered.subject.includes("thử nghiệm") &&
        rendered.html.includes("SMTP") &&
        Boolean(rendered.text),
    );
  } catch (e) {
    report("TC_UNIT_05", "renderTestEmail() lỗi: " + e.message, false);
  }

  // 6. Phân loại lỗi vĩnh viễn (PERMANENT) - sai xác thực SMTP (EAUTH, EENVELOPE)
  try {
    const errAuth = new Error(
      "Invalid login: 535-5.7.8 Username and Password not accepted",
    );
    errAuth.code = "EAUTH";
    const errEnvelope = new Error("No recipients defined");
    errEnvelope.code = "EENVELOPE";

    report(
      "TC_UNIT_06",
      "classifyError() nhận diện lỗi EAUTH / EENVELOPE là PERMANENT (không thử lại vô ích)",
      emailSender.classifyError(errAuth) === "PERMANENT" &&
        emailSender.classifyError(errEnvelope) === "PERMANENT",
    );
  } catch (e) {
    report("TC_UNIT_06", "classifyError EAUTH lỗi: " + e.message, false);
  }

  // 7. Phân loại lỗi vĩnh viễn (PERMANENT) - SMTP Status 5xx (550 Mailbox not found, 553)
  try {
    const err550 = new Error(
      "550 Requested action not taken: mailbox unavailable",
    );
    err550.responseCode = 550;
    const err553 = new Error("553 Mailbox name not allowed");
    err553.responseCode = 553;

    report(
      "TC_UNIT_07",
      "classifyError() nhận diện mã phản hồi SMTP 5xx là PERMANENT (dừng gửi ngay)",
      emailSender.classifyError(err550) === "PERMANENT" &&
        emailSender.classifyError(err553) === "PERMANENT",
    );
  } catch (e) {
    report("TC_UNIT_07", "classifyError 5xx lỗi: " + e.message, false);
  }

  // 8. Phân loại lỗi tạm thời (TEMPORARY) - Mất mạng, Timeout, DNS, Server nghẽn
  try {
    const errTimeout = new Error("Connection timed out");
    errTimeout.code = "ETIMEDOUT";
    const errConnRefused = new Error("connect ECONNREFUSED 127.0.0.1:587");
    errConnRefused.code = "ECONNREFUSED";
    const errReset = new Error("read ECONNRESET");
    errReset.code = "ECONNRESET";
    const err421 = new Error(
      "421 Service not available, closing transmission channel",
    );
    err421.responseCode = 421;

    report(
      "TC_UNIT_08",
      "classifyError() nhận diện mất mạng (ETIMEDOUT, ECONNREFUSED, ECONNRESET) & 4xx là TEMPORARY",
      emailSender.classifyError(errTimeout) === "TEMPORARY" &&
        emailSender.classifyError(errConnRefused) === "TEMPORARY" &&
        emailSender.classifyError(errReset) === "TEMPORARY" &&
        emailSender.classifyError(err421) === "TEMPORARY",
    );
  } catch (e) {
    report("TC_UNIT_08", "classifyError TEMPORARY lỗi: " + e.message, false);
  }

  // 9. Kiểm tra tính hợp lệ của cấu hình SMTP (isConfigured)
  try {
    const emptyConfig = { host: "", port: 587, user: "", pass: "" };
    const partialConfig = {
      host: "smtp.gmail.com",
      port: 587,
      user: "a@gmail.com",
      pass: "",
    };
    const fullConfig = {
      host: "smtp.gmail.com",
      port: 587,
      user: "a@gmail.com",
      pass: "secret123",
    };

    report(
      "TC_UNIT_09",
      "isConfigured() xác định chính xác cấu hình đầy đủ (host, port, user, pass)",
      !smtpConfig.isConfigured(emptyConfig) &&
        !smtpConfig.isConfigured(partialConfig) &&
        smtpConfig.isConfigured(fullConfig),
    );
  } catch (e) {
    report("TC_UNIT_09", "isConfigured lỗi: " + e.message, false);
  }

  // 10. Che dấu mật khẩu SMTP khi trả về client (toPublicView)
  try {
    const fullConfig = {
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      user: "admin@gmail.com",
      pass: "mySuperSecretPassword123",
      fromName: "Hệ thống",
      fromEmail: "admin@gmail.com",
    };
    const publicView = smtpConfig.toPublicView(fullConfig);

    report(
      "TC_UNIT_10",
      "toPublicView() KHÔNG bao giờ để lộ trường pass, chỉ trả hasPassword: true/false",
      publicView.pass === undefined &&
        publicView.hasPassword === true &&
        publicView.host === "smtp.gmail.com" &&
        publicView.configured === true,
    );
  } catch (e) {
    report("TC_UNIT_10", "toPublicView lỗi: " + e.message, false);
  }

  // 11. Tham số Retry Backoff chuẩn theo đề bài
  try {
    report(
      "TC_UNIT_11",
      "Cơ chế Retry cấu hình đúng 3 lần thử lại (5s, 15s, 45s) với MAX_ATTEMPTS = 4",
      MAX_ATTEMPTS === 4 &&
        RETRY_DELAYS_MS.length === 3 &&
        RETRY_DELAYS_MS[0] === 5000 &&
        RETRY_DELAYS_MS[1] === 15000 &&
        RETRY_DELAYS_MS[2] === 45000,
    );
  } catch (e) {
    report("TC_UNIT_11", "Retry config lỗi: " + e.message, false);
  }

  // 12. Xử lý cắt gọt thông báo lỗi an toàn (getSafeErrorMessage)
  try {
    const longMsg = "x".repeat(1000);
    const safeMsg = emailSender.getSafeErrorMessage(new Error(longMsg));
    report(
      "TC_UNIT_12",
      "getSafeErrorMessage() giới hạn độ dài lỗi (<= 500 ký tự) để lưu vào database an toàn",
      safeMsg.length <= 500 && safeMsg.length > 0,
    );
  } catch (e) {
    report("TC_UNIT_12", "getSafeErrorMessage lỗi: " + e.message, false);
  }

  console.log("\n----------------------------------------------------");
  console.log(
    ` KẾT QUẢ UNIT TEST EMAIL: ${passed}/${total} TEST CASES PASS (${Math.round((passed / total) * 100)}%)`,
  );
  console.log("----------------------------------------------------\n");

  if (passed < total) {
    process.exit(1);
  }
}

runUnitTests();
