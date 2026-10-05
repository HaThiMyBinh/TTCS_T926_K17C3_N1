// test_documents_api.js - Integration test API Upload, Quản lý & Tải xuống tài liệu
// Yêu cầu: MySQL đang chạy và backend đang mở ở cổng 5000 (node server.js / run.bat)
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const {
  BASE_URL,
  loginAs,
  cleanupTestData,
  readDbConfig,
} = require("./test_helpers");

const REGISTER_URL = `${BASE_URL}/auth/register`;
const LOGIN_URL = `${BASE_URL}/auth/login`;
const ME_DOCUMENTS_URL = `${BASE_URL}/applications/me/documents`;
const APPLICATIONS_URL = `${BASE_URL}/applications`;
const PASSWORD = "password123";
const UPLOADS_DIR = path.join(__dirname, "..", "uploads");

// Dữ liệu nhị phân mẫu cho các định dạng file (có chữ ký magic bytes chuẩn)
const PDF_CONTENT = Buffer.from(
  "%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF",
);
const DOCX_CONTENT = Buffer.from([
  0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00, 0x00, 0x00, 0x21,
  0x00, 0x63, 0x76,
]);
const FAKE_EXE_CONTENT = Buffer.from([
  0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00,
]);
const PNG_CONTENT = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

// Đăng ký ứng viên mới và lấy JWT token đăng nhập của Intern đó
async function registerAndLoginIntern(label) {
  const email = `us9_intern_${label}_${Date.now()}_${Math.floor(Math.random() * 1000)}@ictu.edu.vn`;
  const regRes = await fetch(REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Thực tập sinh  ${label}`,
      email,
      password: PASSWORD,
      phone: "0912345678",
      university: "ĐH CNTT & Truyền Thông",
      major: "Công nghệ thông tin",
    }),
  });

  const regData = await regRes.json();
  if (regRes.status !== 201) {
    throw new Error(`Đăng ký ứng viên thất bại: ${JSON.stringify(regData)}`);
  }

  const loginRes = await fetch(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: email, password: PASSWORD }),
  });
  const loginData = await loginRes.json();
  if (loginRes.status !== 200 || !loginData.token) {
    throw new Error(
      `Đăng nhập ứng viên thất bại: ${JSON.stringify(loginData)}`,
    );
  }

  return {
    id: regData.candidate.id,
    userId: loginData.user.id,
    email,
    token: loginData.token,
  };
}

// Hàm gửi request upload tài liệu multipart/form-data bằng FormData chuẩn của Node
async function uploadDocRequest(
  token,
  { fileBuffer, fileName, fileMime, docType } = {},
) {
  const formData = new FormData();
  if (fileBuffer !== undefined) {
    const blob = new Blob([fileBuffer], {
      type: fileMime || "application/octet-stream",
    });
    formData.append("file", blob, fileName || "file.bin");
  }
  if (docType !== undefined) {
    formData.append("doc_type", docType);
  }

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(ME_DOCUMENTS_URL, {
    method: "POST",
    headers,
    body: formData,
  });

  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function runDocumentsApiTests() {
  console.log("\n====================================================");
  console.log(" BẮT ĐẦU INTEGRATION TEST TÀI LIỆU ỨNG TUYỂN ");
  console.log("====================================================\n");

  let passCount = 0;
  let totalCount = 0;
  const createdEmails = [];

  const report = (id, description, ok, detail = "") => {
    totalCount++;
    if (ok) {
      console.log(` [PASS] ${id}: ${description}`);
      passCount++;
    } else {
      console.log(
        ` [FAIL] ${id}: ${description} ${detail ? `(${detail})` : ""}`,
      );
    }
  };

  let hrToken, adminToken, mentorToken;

  try {
    hrToken = await loginAs("HR");
    adminToken = await loginAs("Admin");
    mentorToken = await loginAs("Mentor");
  } catch (err) {
    console.error("Lỗi đăng nhập các tài khoản mẫu:", err.message);
    process.exit(1);
  }

  try {
    // --- LUỒNG 1: INTERN UPLOAD THÀNH CÔNG VÀ TIẾN ĐỘ HOÀN THIỆN ---
    const intern1 = await registerAndLoginIntern("flow1");
    createdEmails.push(intern1.email);

    // TC_API_01: Intern upload CV (PDF) thành công -> 200, file có trên đĩa, tiến độ 1/2
    let cvDocId = null;
    let cvStoredName = null;
    try {
      const res = await uploadDocRequest(intern1.token, {
        fileBuffer: PDF_CONTENT,
        fileName: "Nguyen_Van_A_CV.pdf",
        fileMime: "application/pdf",
        docType: "CV",
      });

      // Kiểm tra file có trên đĩa bằng cách đọc từ DB
      let filePhysicallyExists = false;
      if (res.body.data && res.body.data.id) {
        cvDocId = res.body.data.id;
        const conn = await mysql.createConnection(readDbConfig());
        const [rows] = await conn.query(
          "SELECT stored_name FROM application_documents WHERE id = ?",
          [cvDocId],
        );
        await conn.end();
        if (rows.length > 0) {
          cvStoredName = rows[0].stored_name;
          filePhysicallyExists = fs.existsSync(
            path.join(UPLOADS_DIR, cvStoredName),
          );
        }
      }

      report(
        "TC_API_01",
        "Intern upload CV PDF thành công (200), file thật có trên đĩa, tiến độ = 1/2",
        res.status === 200 &&
          res.body.success === true &&
          res.body.progress.totalUploaded === 1 &&
          res.body.progress.isComplete === false &&
          filePhysicallyExists,
      );
    } catch (e) {
      report("TC_API_01", "Intern upload CV PDF thành công", false, e.message);
    }

    // TC_API_02: Intern upload Đơn xin thực tập (DOCX) -> 200, tiến độ 2/2 "Đã đủ hồ sơ"
    try {
      const res = await uploadDocRequest(intern1.token, {
        fileBuffer: DOCX_CONTENT,
        fileName: "Don_Xin_Thuc_Tap.docx",
        fileMime:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        docType: "APPLICATION_LETTER",
      });

      report(
        "TC_API_02",
        "Intern upload Đơn xin thực tập DOCX thành công -> tiến độ 2/2 'Đã đủ hồ sơ'",
        res.status === 200 &&
          res.body.success === true &&
          res.body.progress.totalUploaded === 2 &&
          res.body.progress.isComplete === true &&
          res.body.progress.statusLabel === "Đã đủ hồ sơ",
      );
    } catch (e) {
      report("TC_API_02", "Intern upload Đơn xin thực tập", false, e.message);
    }

    // TC_API_03: GET /api/applications/me/documents trả về danh sách 2 tài liệu và tiến độ
    try {
      const res = await fetch(ME_DOCUMENTS_URL, {
        headers: { Authorization: `Bearer ${intern1.token}` },
      });
      const data = await res.json();
      report(
        "TC_API_03",
        "GET /me/documents trả về đầy đủ 2 tài liệu và tiến độ hoàn thiện",
        res.status === 200 &&
          data.data.documents.length === 2 &&
          data.data.progress.isComplete === true,
      );
    } catch (e) {
      report("TC_API_03", "GET /me/documents", false, e.message);
    }

    // --- LUỒNG 2: KIỂM THỬ CÁC CA THẤT BẠI & KHÔNG ĐỂ FILE RÁC TRÊN ĐĨA ---
    const filesBeforeFailed = fs.readdirSync(UPLOADS_DIR);

    // TC_API_04: Thất bại khi thiếu file (400)
    try {
      const res = await uploadDocRequest(intern1.token, {
        docType: "CV",
      });
      const filesAfter = fs.readdirSync(UPLOADS_DIR);
      report(
        "TC_API_04",
        "Từ chối khi thiếu file đính kèm (400) & không sinh file rác",
        res.status === 400 && filesAfter.length === filesBeforeFailed.length,
      );
    } catch (e) {
      report("TC_API_04", "Thiếu file đính kèm", false, e.message);
    }

    // TC_API_05: Thất bại khi doc_type sai (400)
    try {
      const res = await uploadDocRequest(intern1.token, {
        fileBuffer: PDF_CONTENT,
        fileName: "test.pdf",
        docType: "INVALID_DOC_TYPE",
      });
      const filesAfter = fs.readdirSync(UPLOADS_DIR);
      report(
        "TC_API_05",
        "Từ chối khi doc_type không hợp lệ (400) & xóa file tạm",
        res.status === 400 && filesAfter.length === filesBeforeFailed.length,
      );
    } catch (e) {
      report("TC_API_05", "Sai doc_type", false, e.message);
    }

    // TC_API_06: Thất bại khi định dạng file sai (.png) (400)
    try {
      const res = await uploadDocRequest(intern1.token, {
        fileBuffer: PNG_CONTENT,
        fileName: "photo.png",
        docType: "CV",
      });
      const filesAfter = fs.readdirSync(UPLOADS_DIR);
      report(
        "TC_API_06",
        "Từ chối file định dạng không hỗ trợ .png (400) & xóa file tạm",
        res.status === 400 && filesAfter.length === filesBeforeFailed.length,
      );
    } catch (e) {
      report("TC_API_06", "Sai định dạng đuôi file", false, e.message);
    }

    // TC_API_07: Thất bại khi exe đổi đuôi .pdf (chữ ký magic bytes MZ) (400)
    try {
      const res = await uploadDocRequest(intern1.token, {
        fileBuffer: FAKE_EXE_CONTENT,
        fileName: "trojan.pdf",
        docType: "CV",
      });
      const filesAfter = fs.readdirSync(UPLOADS_DIR);
      report(
        "TC_API_07",
        "Chặn file exe đổi đuôi .pdf qua magic bytes (400) & không để file mồ côi",
        res.status === 400 && filesAfter.length === filesBeforeFailed.length,
      );
    } catch (e) {
      report("TC_API_07", "Exe đổi đuôi .pdf", false, e.message);
    }

    // TC_API_08: Thất bại khi file quá dung lượng 5MB (413)
    try {
      const bigBuffer = Buffer.alloc(5 * 1024 * 1024 + 1024);
      PDF_CONTENT.copy(bigBuffer, 0, 0, PDF_CONTENT.length);
      const res = await uploadDocRequest(intern1.token, {
        fileBuffer: bigBuffer,
        fileName: "huge_cv.pdf",
        docType: "CV",
      });
      const filesAfter = fs.readdirSync(UPLOADS_DIR);
      report(
        "TC_API_08",
        "Từ chối file vượt quá 5MB với HTTP 413 & không để file mồ côi",
        res.status === 413 && filesAfter.length === filesBeforeFailed.length,
      );
    } catch (e) {
      report("TC_API_08", "Quá 5MB", false, e.message);
    }

    // --- LUỒNG 3: THAY FILE (REPLACE) ---
    // TC_API_09: Upload lần 2 cùng doc_type -> file cũ bị xóa khỏi đĩa, DB vẫn 1 bản ghi
    try {
      const newPdfContent = Buffer.from(
        "%PDF-1.4\n%Bản CV mới cập nhật 2026\n%%EOF",
      );
      const oldFilePath = path.join(UPLOADS_DIR, cvStoredName);
      const oldFileExistedBefore = fs.existsSync(oldFilePath);

      const res = await uploadDocRequest(intern1.token, {
        fileBuffer: newPdfContent,
        fileName: "CV_Moi_Cap_Nhat.pdf",
        fileMime: "application/pdf",
        docType: "CV",
      });

      const oldFileGone = !fs.existsSync(oldFilePath);

      // Kiểm tra DB vẫn chỉ có đúng 1 bản ghi CV
      const conn = await mysql.createConnection(readDbConfig());
      const [rows] = await conn.query(
        "SELECT id, stored_name FROM application_documents WHERE application_id = ? AND doc_type = 'CV'",
        [intern1.id],
      );
      await conn.end();

      const newStoredName = rows[0].stored_name;
      const newFileExists = fs.existsSync(
        path.join(UPLOADS_DIR, newStoredName),
      );

      report(
        "TC_API_09",
        "Thay file: upload lại CV -> xóa file cũ trên đĩa, lưu file mới, DB vẫn đúng 1 bản ghi",
        res.status === 200 &&
          oldFileExistedBefore &&
          oldFileGone &&
          rows.length === 1 &&
          newFileExists,
      );
      cvDocId = rows[0].id;
    } catch (e) {
      report("TC_API_09", "Thay file upload lại CV", false, e.message);
    }

    // --- LUỒNG 4: TẢI XUỐNG VÀ PHÂN QUYỀN TRUY CẬP (DOWNLOAD) ---
    // TC_API_10: Chủ hồ sơ (Intern) tải xuống thành công -> 200, nội dung khớp
    try {
      const dlRes = await fetch(
        `${APPLICATIONS_URL}/${intern1.id}/documents/${cvDocId}/download`,
        { headers: { Authorization: `Bearer ${intern1.token}` } },
      );
      const dlBuf = Buffer.from(await dlRes.arrayBuffer());
      report(
        "TC_API_10",
        "Chủ hồ sơ Intern tải xuống tài liệu thành công (200) & nội dung khớp file đã upload",
        dlRes.status === 200 &&
          dlBuf.includes(Buffer.from("Bản CV mới cập nhật 2026")),
      );
    } catch (e) {
      report("TC_API_10", "Chủ hồ sơ tải xuống", false, e.message);
    }

    // TC_API_11: HR tải xuống tài liệu của ứng viên thành công -> 200
    try {
      const dlRes = await fetch(
        `${APPLICATIONS_URL}/${intern1.id}/documents/${cvDocId}/download`,
        { headers: { Authorization: `Bearer ${hrToken}` } },
      );
      report(
        "TC_API_11",
        "HR có quyền tải xuống tài liệu của bất kỳ ứng viên nào (200)",
        dlRes.status === 200,
      );
    } catch (e) {
      report("TC_API_11", "HR tải xuống", false, e.message);
    }

    // TC_API_12: Intern khác tải trộm tài liệu của người khác -> 403
    const intern2 = await registerAndLoginIntern("flow2_attacker");
    createdEmails.push(intern2.email);
    try {
      const dlRes = await fetch(
        `${APPLICATIONS_URL}/${intern1.id}/documents/${cvDocId}/download`,
        { headers: { Authorization: `Bearer ${intern2.token}` } },
      );
      report(
        "TC_API_12",
        "Chặn Intern khác tải trộm tài liệu của người khác với HTTP 403",
        dlRes.status === 403,
      );
    } catch (e) {
      report("TC_API_12", "Intern khác tải trộm tài liệu", false, e.message);
    }

    // TC_API_13: Mentor truy cập tài liệu -> 403
    try {
      const dlRes = await fetch(
        `${APPLICATIONS_URL}/${intern1.id}/documents/${cvDocId}/download`,
        { headers: { Authorization: `Bearer ${mentorToken}` } },
      );
      report(
        "TC_API_13",
        "Từ chối vai trò Mentor truy cập tài liệu mật với HTTP 403",
        dlRes.status === 403,
      );
    } catch (e) {
      report("TC_API_13", "Mentor tải tài liệu", false, e.message);
    }

    // TC_API_14: Admin truy cập tài liệu -> 403
    try {
      const dlRes = await fetch(
        `${APPLICATIONS_URL}/${intern1.id}/documents/${cvDocId}/download`,
        { headers: { Authorization: `Bearer ${adminToken}` } },
      );
      report(
        "TC_API_14",
        "Từ chối vai trò Admin truy cập tài liệu ứng tuyển với HTTP 403",
        dlRes.status === 403,
      );
    } catch (e) {
      report("TC_API_14", "Admin tải tài liệu", false, e.message);
    }

    // TC_API_15: Chưa đăng nhập tải tài liệu -> 401
    try {
      const dlRes = await fetch(
        `${APPLICATIONS_URL}/${intern1.id}/documents/${cvDocId}/download`,
      );
      report(
        "TC_API_15",
        "Từ chối yêu cầu chưa xác thực token với HTTP 401",
        dlRes.status === 401,
      );
    } catch (e) {
      report("TC_API_15", "Chưa đăng nhập tải tài liệu", false, e.message);
    }

    // TC_API_16: Mã hồ sơ hoặc tài liệu không tồn tại -> 404
    try {
      const dlRes = await fetch(
        `${APPLICATIONS_URL}/${intern1.id}/documents/999999/download`,
        { headers: { Authorization: `Bearer ${hrToken}` } },
      );
      report(
        "TC_API_16",
        "Yêu cầu mã tài liệu không tồn tại trả về HTTP 404",
        dlRes.status === 404,
      );
    } catch (e) {
      report("TC_API_16", "Tài liệu không tồn tại", false, e.message);
    }

    // --- LUỒNG 4B: PHÂN QUYỀN UPLOAD / XÓA / XEM DANH SÁCH (hồ sơ intern1 còn 'Chờ duyệt') ---
    // TC_API_19: Chưa đăng nhập -> 401; HR/Admin/Mentor upload -> 403 (chỉ Intern được upload)
    try {
      const probe = {
        fileBuffer: PDF_CONTENT,
        fileName: "x.pdf",
        fileMime: "application/pdf",
        docType: "CV",
      };
      const noAuth = await uploadDocRequest(null, probe);
      const asHr = await uploadDocRequest(hrToken, probe);
      const asAdmin = await uploadDocRequest(adminToken, probe);
      const asMentor = await uploadDocRequest(mentorToken, probe);
      report(
        "TC_API_19",
        "Upload: không token -> 401; HR / Admin / Mentor -> 403 (chỉ Intern được upload)",
        noAuth.status === 401 &&
          asHr.status === 403 &&
          asAdmin.status === 403 &&
          asMentor.status === 403,
        `${noAuth.status}/${asHr.status}/${asAdmin.status}/${asMentor.status}`,
      );
    } catch (e) {
      report("TC_API_19", "Phân quyền upload", false, e.message);
    }

    // TC_API_20: HR/Admin/Mentor xóa -> 403; Intern khác xóa tài liệu người khác -> 404 và tài liệu còn nguyên
    try {
      const del = (token) =>
        fetch(`${ME_DOCUMENTS_URL}/${cvDocId}`, {
          method: "DELETE",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      const [dNoAuth, dHr, dAdmin, dMentor, dOther] = await Promise.all([
        del(null),
        del(hrToken),
        del(adminToken),
        del(mentorToken),
        del(intern2.token),
      ]);
      const stillThere = await fetch(
        `${APPLICATIONS_URL}/${intern1.id}/documents/${cvDocId}/download`,
        { headers: { Authorization: `Bearer ${intern1.token}` } },
      );
      report(
        "TC_API_20",
        "Xóa: không token 401; HR/Admin/Mentor 403; Intern khác 404; tài liệu của chủ vẫn còn",
        dNoAuth.status === 401 &&
          dHr.status === 403 &&
          dAdmin.status === 403 &&
          dMentor.status === 403 &&
          dOther.status === 404 &&
          stillThere.status === 200,
        `${dNoAuth.status}/${dHr.status}/${dAdmin.status}/${dMentor.status}/${dOther.status}/${stillThere.status}`,
      );
    } catch (e) {
      report("TC_API_20", "Phân quyền xóa", false, e.message);
    }

    // TC_API_21: HR thấy tài liệu từng ứng viên trong danh sách (không lộ stored_name); Admin thì không
    try {
      const listAs = async (token) => {
        const r = await fetch(APPLICATIONS_URL, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const b = await r.json();
        return {
          status: r.status,
          row: (b.data || []).find((x) => x.id === intern1.id),
        };
      };
      const hrList = await listAs(hrToken);
      const adminList = await listAs(adminToken);
      const hrDocs = (hrList.row && hrList.row.documents) || [];
      report(
        "TC_API_21",
        "HR thấy đủ 2 tài liệu (CV + Đơn) của ứng viên, không lộ stored_name; Admin không thấy tài liệu",
        hrList.status === 200 &&
          hrDocs.length === 2 &&
          hrDocs.every(
            (d) =>
              d.id &&
              d.original_name &&
              d.size_bytes > 0 &&
              !("stored_name" in d),
          ) &&
          adminList.status === 200 &&
          ((adminList.row && adminList.row.documents) || []).length === 0,
      );
    } catch (e) {
      report("TC_API_21", "HR xem tài liệu ứng viên", false, e.message);
    }

    // --- LUỒNG 5: SAU KHI HR DUYỆT / TỪ CHỐI HỒ SƠ -> KHÓA UPLOAD/THAY/XÓA (409) ---
    // HR duyệt hồ sơ của intern1
    await fetch(`${APPLICATIONS_URL}/${intern1.id}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hrToken}`,
      },
      body: JSON.stringify({ status: "APPROVED" }),
    });

    // TC_API_17: Sau khi duyệt, Intern VẪN upload/thay thế được; hồ sơ quay lại 'Chờ duyệt' để HR duyệt lại
    try {
      const uploadAfterApprove = await uploadDocRequest(intern1.token, {
        fileBuffer: PDF_CONTENT,
        fileName: "cv_after_approval.pdf",
        fileMime: "application/pdf",
        docType: "CV",
      });

      const meAfter = await (
        await fetch(ME_DOCUMENTS_URL, {
          headers: { Authorization: `Bearer ${intern1.token}` },
        })
      ).json();

      // Tải xuống vẫn hoạt động bình thường
      const dlAfterApprove = await fetch(
        `${APPLICATIONS_URL}/${intern1.id}/documents/${cvDocId}/download`,
        { headers: { Authorization: `Bearer ${intern1.token}` } },
      );

      report(
        "TC_API_17",
        "Sau khi HR duyệt: Intern vẫn upload được (200), hồ sơ về 'Chờ duyệt' & không khóa; tải xuống vẫn 200",
        uploadAfterApprove.status === 200 &&
          meAfter.data.application.is_locked === false &&
          meAfter.data.application.status === "Chờ duyệt" &&
          dlAfterApprove.status === 200,
      );
    } catch (e) {
      report("TC_API_17", "Lỗi upload sau khi duyệt", false, e.message);
    }

    // --- LUỒNG 6: XÓA TÀI LIỆU KHI HỒ SƠ CÒN CHỜ DUYỆT ---
    // TC_API_18: Xóa tài liệu -> file trên đĩa và bản ghi DB cùng biến mất
    const intern3 = await registerAndLoginIntern("flow3_delete");
    createdEmails.push(intern3.email);

    try {
      const upRes = await uploadDocRequest(intern3.token, {
        fileBuffer: PDF_CONTENT,
        fileName: "cv_to_delete.pdf",
        fileMime: "application/pdf",
        docType: "CV",
      });

      const docToDeleteId = upRes.body.data.id;
      const conn = await mysql.createConnection(readDbConfig());
      const [rows] = await conn.query(
        "SELECT stored_name FROM application_documents WHERE id = ?",
        [docToDeleteId],
      );
      await conn.end();

      const storedNameToDelete = rows[0].stored_name;
      const existedBefore = fs.existsSync(
        path.join(UPLOADS_DIR, storedNameToDelete),
      );

      const delRes = await fetch(`${ME_DOCUMENTS_URL}/${docToDeleteId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${intern3.token}` },
      });

      const fileGone = !fs.existsSync(
        path.join(UPLOADS_DIR, storedNameToDelete),
      );

      const conn2 = await mysql.createConnection(readDbConfig());
      const [rowsAfter] = await conn2.query(
        "SELECT id FROM application_documents WHERE id = ?",
        [docToDeleteId],
      );
      await conn2.end();

      report(
        "TC_API_18",
        "Xóa tài liệu hợp lệ -> file trên đĩa và bản ghi DB cùng biến mất hoàn toàn",
        delRes.status === 200 &&
          existedBefore &&
          fileGone &&
          rowsAfter.length === 0,
      );
    } catch (e) {
      report("TC_API_18", "Xóa tài liệu", false, e.message);
    }

    // --- LUỒNG 7: HỒ SƠ BỊ TỪ CHỐI CŨNG BỊ KHÓA ---
    // TC_API_22: Sau khi HR từ chối -> upload/xóa 409, GET me báo is_locked + lý do
    const intern4 = await registerAndLoginIntern("flow4_rejected");
    createdEmails.push(intern4.email);
    try {
      const upRes = await uploadDocRequest(intern4.token, {
        fileBuffer: PDF_CONTENT,
        fileName: "cv_rejected.pdf",
        fileMime: "application/pdf",
        docType: "CV",
      });
      const rejectRes = await fetch(
        `${APPLICATIONS_URL}/${intern4.id}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${hrToken}`,
          },
          body: JSON.stringify({
            status: "REJECTED",
            rejection_reason: "Chưa phù hợp vị trí",
          }),
        },
      );
      const upAfter = await uploadDocRequest(intern4.token, {
        fileBuffer: PDF_CONTENT,
        fileName: "cv_again.pdf",
        fileMime: "application/pdf",
        docType: "CV",
      });
      const delAfter = await fetch(
        `${ME_DOCUMENTS_URL}/${upRes.body.data.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${intern4.token}` },
        },
      );
      const meRes = await fetch(ME_DOCUMENTS_URL, {
        headers: { Authorization: `Bearer ${intern4.token}` },
      });
      const me = await meRes.json();
      report(
        "TC_API_22",
        "Hồ sơ bị Từ chối: upload/xóa trả 409; GET /me/documents báo is_locked=true kèm lý do",
        rejectRes.status === 200 &&
          upAfter.status === 409 &&
          delAfter.status === 409 &&
          me.data.application.is_locked === true &&
          typeof me.data.application.lock_reason === "string" &&
          me.data.application.lock_reason.length > 0,
        `${rejectRes.status}/${upAfter.status}/${delAfter.status}`,
      );
    } catch (e) {
      report("TC_API_22", "Hồ sơ bị từ chối bị khóa", false, e.message);
    }
  } finally {
    // Dọn dẹp dữ liệu test trong database và trên đĩa
    console.log("\n Đang dọn dẹp dữ liệu kiểm thử...");
    try {
      await cleanupTestData(createdEmails);
      console.log(" Đã dọn dẹp dữ liệu kiểm thử thành công!");
    } catch (cleanErr) {
      console.warn(" Lỗi khi dọn dẹp dữ liệu test:", cleanErr.message);
    }
  }

  console.log("\n----------------------------------------------------");
  console.log(
    ` KẾT QUẢ INTEGRATION TEST DOCUMENTS API: ${passCount}/${totalCount} TEST CASES PASS`,
  );
  console.log("----------------------------------------------------\n");

  if (passCount < totalCount) {
    process.exit(1);
  }
}

if (require.main === module) {
  runDocumentsApiTests();
}

module.exports = { runDocumentsApiTests };
