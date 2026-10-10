// Nội dung email thông báo kết quả xét duyệt
const { formatVietnamDateTime } = require("../../utils/date");

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
}

const BRAND_NAME = "Hệ thống Quản lý Thực tập sinh";
const BRAND_COLOR = "#032ab8";
const BRAND_SECONDARY = "#08377e";

// Khung email dùng chung: bảng lồng bảng + CSS inline
function wrapHtml({ title, previewText, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; -webkit-text-size-adjust: 100%;">
    <!-- Preview Text (ẩn khỏi thân email nhưng hiển thị ở danh sách hộp thư đến) -->
    <div style="display: none; max-height: 0px; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: #fff; opacity: 0;">
      ${escapeHtml(previewText || title)}
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f1f5f9; padding: 32px 12px;">
      <tr>
        <td align="center">
          <!-- Hộp nội dung chính (max-width 600px chuẩn email) -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.08); border: 1px solid #e2e8f0;">

            <!-- HEADER -->
            <tr>
              <td style="background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${BRAND_SECONDARY} 100%); background-color: ${BRAND_COLOR}; padding: 28px 32px; text-align: left;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td>
                      <div style="display: inline-block; background: rgba(255, 255, 255, 0.2); border-radius: 8px; padding: 6px 12px; margin-bottom: 8px;">
                        <span style="color: #ffffff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Thông Báo Chính Thức</span>
                      </div>
                      <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 700; line-height: 1.3;">
                        ${escapeHtml(BRAND_NAME)}
                      </h1>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- BODY CONTENT -->
            <tr>
              <td style="padding: 32px; color: #1e293b; font-size: 14.5px; line-height: 1.65;">
                ${bodyHtml}
              </td>
            </tr>

            <!-- FOOTER -->
            <tr>
              <td style="padding: 24px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12.5px; line-height: 1.6; text-align: center;">
                <p style="margin: 0 0 6px; font-weight: 600; color: #475569;">
                  Ban Quản Trị & Bộ Phận Nhân Sự (HR)
                </p>
                <p style="margin: 0 0 10px;">
                  Hệ thống Quản lý & Tuyển dụng Thực tập sinh trực tuyến
                </p>
                <div style="height: 1px; background-color: #e2e8f0; margin: 12px auto; max-width: 320px;"></div>
                <p style="margin: 0; color: #94a3b8; font-size: 11.5px;">
                   Đây là email tự động được gửi từ hệ thống. Vui lòng không trả lời trực tiếp thư này.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// --- TEMPLATE EMAIL CHÚC MỪNG TRÚNG TUYỂN (APPROVED) ---
function renderApprovedEmail(application) {
  const rawName = application && application.name ? application.name : "Bạn";
  const name = escapeHtml(rawName);
  const subject = `[Tuyển Dụng] Chúc mừng ${rawName} đã trúng tuyển chương trình thực tập`;
  const previewText = `Chúc mừng ${rawName}! Hồ sơ ứng tuyển thực tập của bạn đã được duyệt thành công.`;

  const bodyHtml = `
    <!-- BANNER CHÚC MỪNG -->
    <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; padding: 18px 20px; margin-bottom: 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="36" valign="top">
            <div style="width: 28px; height: 28px; border-radius: 50%; background-color: #10b981; color: #ffffff; text-align: center; line-height: 28px; font-weight: bold; font-size: 15px;">✓</div>
          </td>
          <td valign="middle" style="padding-left: 10px;">
            <div style="color: #065f46; font-size: 16px; font-weight: 700;">HỒ SƠ ĐÃ ĐƯỢC DUYỆT THÀNH CÔNG</div>
            <div style="color: #047857; font-size: 13px; margin-top: 2px;">Chúc mừng bạn đã chính thức trở thành Thực tập sinh!</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- NỘI DUNG THƯ -->
    <p style="margin: 0 0 16px; font-size: 15px;">Xin chào <b>${name}</b>,</p>

    <p style="margin: 0 0 16px;">
      Hội đồng tuyển dụng và Bộ phận Nhân sự xin trân trọng thông báo: hồ sơ ứng tuyển của bạn vào chương trình thực tập đã được xem xét kỹ lưỡng và <b style="color: #16a34a; font-size: 15px;">CHẤP THUẬN (DUYỆT)</b>.
    </p>

    <!-- HỘP THÔNG TIN CÁC BƯỚC TIẾP THEO -->
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px 20px; margin: 20px 0;">
      <h3 style="margin: 0 0 12px; font-size: 14px; font-weight: 700; color: #1e293b; text-transform: uppercase; letter-spacing: 0.5px;">
        📌 Các bước tiếp theo dành cho bạn:
      </h3>
      <ol style="margin: 0; padding-left: 20px; color: #334155; line-height: 1.7; font-size: 13.5px;">
        <li style="margin-bottom: 6px;"><b>Kiểm tra điện thoại & email:</b> Bộ phận HR sẽ liên hệ trực tiếp trong vòng 1-2 ngày làm việc để hướng dẫn chi tiết về lịch tiếp nhận và onboarding.</li>
        <li style="margin-bottom: 6px;"><b>Chuẩn bị hồ sơ nhập thực tập:</b> Bản sao thẻ sinh viên, giấy giới thiệu của nhà trường (nếu có), và bảng điểm học tập gần nhất.</li>
        <li><b>Đăng nhập hệ thống:</b> Bạn có thể đăng nhập vào cổng thông tin nội bộ bằng tài khoản đã đăng ký để theo dõi tiến độ phân công Mentor.</li>
      </ol>
    </div>

    <p style="margin: 0 0 20px;">
      Chúng tôi rất vui mừng được chào đón bạn gia nhập đội ngũ thực tập sinh và hy vọng bạn sẽ có một kỳ thực tập bổ ích, tích lũy được nhiều kinh nghiệm thực tế quý báu.
    </p>

    <!-- NÚT CTA -->
    <div style="text-align: center; margin: 28px 0 16px;">
      <a href="http://localhost:5000/login.html" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #032ab8; color: #ffffff; font-weight: 600; font-size: 14px; text-decoration: none; padding: 12px 28px; border-radius: 8px; box-shadow: 0 3px 8px rgba(3, 42, 184, 0.3);">
        Đăng Nhập Cổng Thực Tập Sinh &rarr;
      </a>
    </div>

    <p style="margin: 24px 0 0; color: #475569;">
      Trân trọng,<br/>
      <b style="color: #1e293b;">${escapeHtml(BRAND_NAME)}</b>
    </p>
  `;

  const text = [
    `Xin chào ${rawName},`,
    "",
    "CHÚC MỪNG! HỒ SƠ ỨNG TUYỂN CỦA BẠN ĐÃ ĐƯỢC DUYỆT THÀNH CÔNG.",
    "",
    "Hội đồng tuyển dụng và Bộ phận Nhân sự xin trân trọng thông báo hồ sơ ứng tuyển của bạn đã được xem xét và CHẤP THUẬN (DUYỆT).",
    "",
    "CÁC BƯỚC TIẾP THEO:",
    "1. Kiểm tra điện thoại & email: HR sẽ liên hệ trong 1-2 ngày làm việc.",
    "2. Chuẩn bị hồ sơ: Bản sao thẻ sinh viên, giấy giới thiệu nhà trường, bảng điểm.",
    "3. Đăng nhập hệ thống theo dõi tiến độ: http://localhost:5000/login.html",
    "",
    "Chúc mừng bạn và hẹn gặp lại tại buổi tiếp nhận thực tập sinh!",
    "",
    "Trân trọng,",
    BRAND_NAME,
  ].join("\n");

  return {
    subject,
    html: wrapHtml({ title: subject, previewText, bodyHtml }),
    text,
  };
}

// --- TEMPLATE EMAIL TỪ CHỐI CÓ KÈM LÝ DO (REJECTED) ---
function renderRejectedEmail(application) {
  const rawName = application && application.name ? application.name : "Bạn";
  const rawReason =
    application && application.rejection_reason
      ? application.rejection_reason
      : "Hồ sơ chưa đáp ứng tiêu chí đợt tuyển này";
  const name = escapeHtml(rawName);
  const reason = escapeHtml(rawReason);
  const subject = `[Tuyển Dụng] Thông báo kết quả xét duyệt hồ sơ ứng tuyển - ${rawName}`;
  const previewText = `Thông báo kết quả xét duyệt hồ sơ thực tập sinh cho ứng viên ${rawName}.`;

  const bodyHtml = `
    <!-- BANNER KẾT QUẢ -->
    <div style="background-color: #fff1f2; border: 1px solid #fecdd3; border-radius: 10px; padding: 18px 20px; margin-bottom: 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="36" valign="top">
            <div style="width: 28px; height: 28px; border-radius: 50%; background-color: #e11d48; color: #ffffff; text-align: center; line-height: 28px; font-weight: bold; font-size: 15px;">i</div>
          </td>
          <td valign="middle" style="padding-left: 10px;">
            <div style="color: #9f1239; font-size: 16px; font-weight: 700;">KẾT QUẢ XÉT DUYỆT HỒ SƠ ỨNG TUYỂN</div>
            <div style="color: #be123c; font-size: 13px; margin-top: 2px;">Thông báo chính thức từ Hội đồng Tuyển dụng</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- NỘI DUNG THƯ -->
    <p style="margin: 0 0 16px; font-size: 15px;">Xin chào <b>${name}</b>,</p>

    <p style="margin: 0 0 16px;">
      Lời đầu tiên, Ban Tuyển dụng xin gửi lời cảm ơn chân thành vì bạn đã dành thời gian và sự quan tâm đến chương trình thực tập của <b>${escapeHtml(BRAND_NAME)}</b>.
    </p>

    <p style="margin: 0 0 16px;">
      Sau quá trình xem xét kỹ lưỡng các hồ sơ theo chỉ tiêu và yêu cầu chuyên môn của đợt này, chúng tôi rất tiếc phải thông báo hiện tại hồ sơ của bạn <b style="color: #dc2626;">chưa phù hợp</b> để tiếp nhận trong đợt thực tập này.
    </p>

    <!-- HỘP HIỂN THỊ LÝ DO TỪ CHỐI ĐÍNH KÈM -->
    <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; border-top: 1px solid #fee2e2; border-right: 1px solid #fee2e2; border-bottom: 1px solid #fee2e2; border-radius: 0 8px 8px 0; padding: 16px 20px; margin: 20px 0;">
      <div style="color: #991b1b; font-size: 13px; font-weight: 700; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">
        Lý do từ chối từ Ban Tuyển dụng:
      </div>
      <div style="color: #334155; font-size: 14px; line-height: 1.6; font-style: italic; background-color: #ffffff; padding: 10px 14px; border-radius: 6px; border: 1px dashed #fca5a5;">
        "${reason}"
      </div>
    </div>

    <p style="margin: 0 0 16px;">
      Số lượng chỉ tiêu cho mỗi đợt có giới hạn, do đó chúng tôi phải đưa ra những quyết định khó khăn. Dữ liệu hồ sơ của bạn vẫn được lưu trữ bảo mật trong cơ sở dữ liệu nhân tài của chúng tôi để ưu tiên liên hệ khi có vị trí mới phù hợp hơn.
    </p>

    <p style="margin: 0 0 20px;">
      Chúc bạn luôn giữ vững đam mê học hỏi và gặt hái được nhiều thành công trên con đường học tập cũng như sự nghiệp tương lai!
    </p>

    <p style="margin: 24px 0 0; color: #475569;">
      Trân trọng,<br/>
      <b style="color: #1e293b;">${escapeHtml(BRAND_NAME)}</b>
    </p>
  `;

  const text = [
    `Xin chào ${rawName},`,
    "",
    "Cảm ơn bạn đã quan tâm và nộp hồ sơ ứng tuyển chương trình thực tập của chúng tôi.",
    "",
    "Sau khi xem xét kỹ lưỡng, chúng tôi rất tiếc phải thông báo hồ sơ của bạn chưa phù hợp trong đợt tuyển dụng này.",
    "",
    `LÝ DO TỪ CHỐI: "${rawReason}"`,
    "",
    "Thông tin hồ sơ của bạn vẫn được lưu lại trong hệ thống nhân tài để xem xét cho các đợt tuyển dụng tiếp theo.",
    "Chúc bạn luôn gặt hái nhiều thành công trên con đường học tập và sự nghiệp!",
    "",
    "Trân trọng,",
    BRAND_NAME,
  ].join("\n");

  return {
    subject,
    html: wrapHtml({ title: subject, previewText, bodyHtml }),
    text,
  };
}

// --- TEMPLATE EMAIL THỬ NGHIỆM SMTP (TEST EMAIL) ---
function renderTestEmail() {
  const subject = `[Kiểm Tra] Email thử nghiệm kết nối SMTP hệ thống`;
  const previewText = "Cấu hình SMTP của hệ thống đã hoạt động chính xác.";

  const bodyHtml = `
    <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 18px 20px; margin-bottom: 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="36" valign="top">
            <div style="width: 28px; height: 28px; border-radius: 50%; background-color: #2563eb; color: #ffffff; text-align: center; line-height: 28px; font-weight: bold; font-size: 15px;">✓</div>
          </td>
          <td valign="middle" style="padding-left: 10px;">
            <div style="color: #1e40af; font-size: 16px; font-weight: 700;">KẾT NỐI SMTP THÀNH CÔNG</div>
            <div style="color: #1d4ed8; font-size: 13px; margin-top: 2px;">Email thử nghiệm cấu hình hệ thống</div>
          </td>
        </tr>
      </table>
    </div>

    <p style="margin: 0 0 16px; font-size: 15px;">Xin chào Quản trị viên,</p>

    <p style="margin: 0 0 16px;">
      Đây là email thử nghiệm được gửi từ tính năng <b>Cấu hình Email & SMTP</b> của Hệ thống Quản lý Thực tập sinh.
    </p>

    <p style="margin: 0 0 16px;">
      Nếu bạn nhận được email này, các thông số cấu hình SMTP (Máy chủ, Cổng, Giao thức mã hóa, Tài khoản gửi và Mật khẩu ứng dụng) đã hoạt động hoàn toàn chính xác và sẵn sàng gửi thông báo tự động cho ứng viên.
    </p>

    <p style="margin: 20px 0 0; color: #475569;">
      Thời gian kiểm tra: <b>${formatVietnamDateTime()}</b><br/>
      Hệ thống: <b>${escapeHtml(BRAND_NAME)}</b>
    </p>
  `;

  const text = [
    "Xin chào Quản trị viên,",
    "",
    "Đây là email thử nghiệm từ Hệ thống Quản lý Thực tập sinh.",
    "Nếu bạn nhận được email này, cấu hình SMTP của bạn đã hoạt động hoàn toàn chính xác!",
    "",
    `Thời gian kiểm tra: ${formatVietnamDateTime()}`,
  ].join("\n");

  return {
    subject,
    html: wrapHtml({ title: subject, previewText, bodyHtml }),
    text,
  };
}

// --- EMAIL GỬI BÁO CÁO CUỐI KỲ (kèm file CSV) ---
function renderFinalReportEmail({ report, message }) {
  const data = report.data || {};
  const summary = data.summary || {};
  const scope = data.scope || {};
  const scopeLabel = report.scopeLabel || (scope.type === "UNIVERSITY" ? `Trường: ${scope.value}` : scope.type === "PROGRAM" ? "Theo chương trình thực tập" : "Toàn bộ thực tập sinh");
  const period = scope.from || scope.to ? `${scope.from || "..."} – ${scope.to || "..."}` : "Toàn bộ thời gian";
  const hours = Math.round(((summary.totalWorkMinutes || 0) / 60) * 10) / 10;
  const num = (v) => (v == null ? "—" : String(v));
  const subject = `[Báo cáo cuối kỳ] ${report.title}`;
  const previewText = `Báo cáo cuối kỳ thực tập: ${summary.evaluated || 0}/${summary.totalInterns || 0} thực tập sinh đã được đánh giá.`;
  const row = (label, value) => `<tr><td style="padding: 6px 0; color: #475569;">${escapeHtml(label)}</td><td style="padding: 6px 0; text-align: right;"><b>${escapeHtml(value)}</b></td></tr>`;
  const bodyHtml = `
    <p style="margin: 0 0 16px; font-size: 15px;">Kính gửi Quý đơn vị,</p>
    <p style="margin: 0 0 16px;">Bộ phận Nhân sự gửi kèm báo cáo tổng hợp đánh giá thực tập sinh <b>${escapeHtml(report.title)}</b> (chi tiết trong file CSV đính kèm).</p>
    ${message ? `<p style="margin: 0 0 16px; padding: 12px 14px; background-color: #f8fafc; border-left: 3px solid ${BRAND_COLOR}; white-space: pre-line;">${escapeHtml(message)}</p>` : ""}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; margin: 8px 0 16px;">
      ${row("Phạm vi", scopeLabel)}
      ${row("Khoảng thời gian", period)}
      ${row("Số thực tập sinh", num(summary.totalInterns))}
      ${row("Đã được đánh giá", num(summary.evaluated))}
      ${row("Điểm kỹ năng trung bình", num(summary.avgSkill))}
      ${row("Điểm thái độ trung bình", num(summary.avgAttitude))}
      ${row("Điểm tổng trung bình", num(summary.avgOverall))}
      ${row("Tổng giờ làm việc ghi nhận", `${hours} giờ`)}
    </table>
    ${data.hrNote ? `<p style="margin: 0 0 16px; color: #334155; white-space: pre-line;"><b>Nhận xét của HR:</b><br/>${escapeHtml(data.hrNote)}</p>` : ""}
    <p style="margin: 20px 0 0; color: #475569;">Thời gian gửi: <b>${formatVietnamDateTime()}</b><br/>Hệ thống: <b>${escapeHtml(BRAND_NAME)}</b></p>
  `;
  const text = [
    "Kính gửi Quý đơn vị,", "",
    `Báo cáo cuối kỳ thực tập: ${report.title} (chi tiết trong file CSV đính kèm).`,
    message ? `\n${message}\n` : "",
    `Phạm vi: ${scopeLabel}`, `Khoảng thời gian: ${period}`,
    `Số thực tập sinh: ${num(summary.totalInterns)} (đã đánh giá: ${num(summary.evaluated)})`,
    `Điểm trung bình: kỹ năng ${num(summary.avgSkill)}, thái độ ${num(summary.avgAttitude)}, tổng ${num(summary.avgOverall)}`,
    `Tổng giờ làm việc ghi nhận: ${hours} giờ`,
    data.hrNote ? `\nNhận xét của HR: ${data.hrNote}` : "",
    "", `Thời gian gửi: ${formatVietnamDateTime()}`,
  ].join("\n");
  return { subject, html: wrapHtml({ title: subject, previewText, bodyHtml }), text };
}

module.exports = {
  escapeHtml,
  renderApprovedEmail,
  renderRejectedEmail,
  renderTestEmail,
  renderFinalReportEmail,
};
