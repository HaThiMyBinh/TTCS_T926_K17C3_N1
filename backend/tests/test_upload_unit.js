// test_upload_unit.js - Unit test kiểm tra file, magic bytes, sanitize filename & UUID
// Không cần kết nối mạng hoặc MySQL
const fs = require("fs");
const path = require("path");
const {
  validateFileBuffer,
  sanitizeFileName,
  MAX_FILE_SIZE,
} = require("../services/documentValidator");
const { HttpError } = require("../errors");
const storage = require("../services/fileStorage");
const { calculateProgress } = require("../services/documents.service");

function runUnitTests() {
  console.log("\n====================================================");
  console.log(" BẮT ĐẦU UNIT TEST XỬ LÝ & BẢO MẬT FILE UPLOAD");
  console.log("====================================================\n");

  let passCount = 0;
  let failCount = 0;

  function report(id, description, ok, detail = "") {
    if (ok) {
      console.log(` [PASS] ${id}: ${description}`);
      passCount++;
    } else {
      console.log(
        ` [FAIL] ${id}: ${description} ${detail ? `(${detail})` : ""}`,
      );
      failCount++;
    }
  }

  // Chuẩn bị dữ liệu mẫu (magic bytes chuẩn)
  const validPdfBuffer = Buffer.from(
    "%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF",
  );
  const validDocBuffer = Buffer.from([
    0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00,
  ]);
  const validDocxBuffer = Buffer.from([
    0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x21, 0x00,
  ]);
  const fakeExeBuffer = Buffer.from([
    0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00,
  ]);
  const fakePngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
  const fakeTextBuffer = Buffer.from(
    "Day la file text binh thuong, khong phai binary!",
  );

  // TC_UNIT_01: Chấp nhận file PDF hợp lệ với magic bytes %PDF-
  try {
    const res = validateFileBuffer({
      buffer: validPdfBuffer,
      originalname: "my_cv.pdf",
      size: validPdfBuffer.length,
      mimetype: "application/pdf",
    });
    report(
      "TC_UNIT_01",
      "Chấp nhận file PDF hợp lệ có chữ ký magic bytes %PDF-",
      res.ext === ".pdf" && res.cleanName === "my_cv.pdf",
    );
  } catch (err) {
    report("TC_UNIT_01", "Chấp nhận file PDF hợp lệ", false, err.message);
  }

  // TC_UNIT_02: Chấp nhận file Word DOC hợp lệ với magic bytes D0CF11E0
  try {
    const res = validateFileBuffer({
      buffer: validDocBuffer,
      originalname: "don_xin_viec.doc",
      size: validDocBuffer.length,
      mimetype: "application/msword",
    });
    report(
      "TC_UNIT_02",
      "Chấp nhận file Word DOC hợp lệ có chữ ký magic bytes D0CF11E0",
      res.ext === ".doc" && res.cleanName === "don_xin_viec.doc",
    );
  } catch (err) {
    report("TC_UNIT_02", "Chấp nhận file Word DOC hợp lệ", false, err.message);
  }

  // TC_UNIT_03: Chấp nhận file Word DOCX hợp lệ với magic bytes PK..
  try {
    const res = validateFileBuffer({
      buffer: validDocxBuffer,
      originalname: "internship_letter.docx",
      size: validDocxBuffer.length,
      mimetype:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    report(
      "TC_UNIT_03",
      "Chấp nhận file Word DOCX hợp lệ có chữ ký magic bytes PK..",
      res.ext === ".docx" && res.cleanName === "internship_letter.docx",
    );
  } catch (err) {
    report("TC_UNIT_03", "Chấp nhận file Word DOCX hợp lệ", false, err.message);
  }

  // TC_UNIT_04: Từ chối file có đuôi cấm .exe (mã lỗi 400)
  try {
    validateFileBuffer({
      buffer: fakeExeBuffer,
      originalname: "malware.exe",
      size: fakeExeBuffer.length,
      mimetype: "application/x-msdownload",
    });
    report("TC_UNIT_04", "Từ chối file đuôi .exe", false, "Không ném lỗi");
  } catch (err) {
    report(
      "TC_UNIT_04",
      "Từ chối file đuôi .exe với HTTP 400",
      err instanceof HttpError && err.status === 400,
    );
  }

  // TC_UNIT_05: Từ chối file có đuôi ảnh .png (mã lỗi 400)
  try {
    validateFileBuffer({
      buffer: fakePngBuffer,
      originalname: "photo.png",
      size: fakePngBuffer.length,
      mimetype: "image/png",
    });
    report("TC_UNIT_05", "Từ chối file đuôi .png", false, "Không ném lỗi");
  } catch (err) {
    report(
      "TC_UNIT_05",
      "Từ chối file đuôi .png với HTTP 400",
      err instanceof HttpError && err.status === 400,
    );
  }

  // TC_UNIT_06: Từ chối file rỗng 0 bytes (mã lỗi 400)
  try {
    validateFileBuffer({
      buffer: Buffer.alloc(0),
      originalname: "empty.pdf",
      size: 0,
      mimetype: "application/pdf",
    });
    report("TC_UNIT_06", "Từ chối file rỗng 0 bytes", false, "Không ném lỗi");
  } catch (err) {
    report(
      "TC_UNIT_06",
      "Từ chối file rỗng 0 bytes với HTTP 400",
      err instanceof HttpError && err.status === 400,
    );
  }

  // TC_UNIT_07: Từ chối file quá dung lượng 5MB (mã lỗi 413)
  try {
    const oversize = MAX_FILE_SIZE + 1024;
    validateFileBuffer({
      buffer: validPdfBuffer,
      originalname: "large_cv.pdf",
      size: oversize,
      mimetype: "application/pdf",
    });
    report("TC_UNIT_07", "Từ chối file vượt quá 5MB", false, "Không ném lỗi");
  } catch (err) {
    report(
      "TC_UNIT_07",
      "Từ chối file vượt quá 5MB với HTTP 413 (Payload Too Large)",
      err instanceof HttpError && err.status === 413,
    );
  }

  // TC_UNIT_08: Chặn file thực thi .exe đổi đuôi thành .pdf (chữ ký MZ)
  try {
    validateFileBuffer({
      buffer: fakeExeBuffer,
      originalname: "trojan_disguised.pdf",
      size: fakeExeBuffer.length,
      mimetype: "application/pdf",
    });
    report(
      "TC_UNIT_08",
      "Chặn file exe đổi đuôi thành .pdf",
      false,
      "Không phát hiện giả mạo",
    );
  } catch (err) {
    report(
      "TC_UNIT_08",
      "Chặn file exe đổi đuôi thành .pdf (phát hiện magic bytes MZ)",
      err instanceof HttpError && err.status === 400,
    );
  }

  // TC_UNIT_09: Chặn file ảnh PNG đổi đuôi thành .docx
  try {
    validateFileBuffer({
      buffer: fakePngBuffer,
      originalname: "avatar_fake.docx",
      size: fakePngBuffer.length,
      mimetype:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    report(
      "TC_UNIT_09",
      "Chặn file ảnh PNG đổi đuôi thành .docx",
      false,
      "Không phát hiện giả mạo",
    );
  } catch (err) {
    report(
      "TC_UNIT_09",
      "Chặn file ảnh PNG đổi đuôi thành .docx (phát hiện magic bytes PNG)",
      err instanceof HttpError && err.status === 400,
    );
  }

  // TC_UNIT_10: Chặn file văn bản thường đổi đuôi thành .pdf (không có %PDF)
  try {
    validateFileBuffer({
      buffer: fakeTextBuffer,
      originalname: "plain_text.pdf",
      size: fakeTextBuffer.length,
      mimetype: "application/pdf",
    });
    report(
      "TC_UNIT_10",
      "Chặn file text đổi đuôi thành .pdf",
      false,
      "Không phát hiện giả mạo",
    );
  } catch (err) {
    report(
      "TC_UNIT_10",
      "Chặn file text đổi đuôi thành .pdf (magic bytes không khớp)",
      err instanceof HttpError && err.status === 400,
    );
  }

  // TC_UNIT_11: Làm sạch tên file có chứa path traversal (chống ../ và ..\)
  const traversed = sanitizeFileName("../../../etc/passwd.pdf");
  const winTraversed = sanitizeFileName("..\\..\\Windows\\System32\\cmd.docx");
  report(
    "TC_UNIT_11",
    "Làm sạch tên file chứa path traversal (../ và ..\\)",
    !traversed.includes("..") &&
      !traversed.includes("/") &&
      !winTraversed.includes("..") &&
      !winTraversed.includes("\\"),
  );

  // TC_UNIT_12: Làm sạch tên file chứa ký tự đặc biệt nguy hiểm (: * ? \" < > |)
  const specialChars = sanitizeFileName(
    'my:cv*test?version<1>"latest"|run.pdf',
  );
  report(
    "TC_UNIT_12",
    'Làm sạch tên file chứa ký tự đặc biệt nguy hiểm (: * ? " < > |)',
    !/[<>:"/\\|?*]/.test(specialChars) && specialChars.endsWith(".pdf"),
  );

  // TC_UNIT_13: Khử dấu tiếng Việt chuẩn sang ký tự ASCII an toàn cho HTTP Header
  const vietnameseName = sanitizeFileName(
    "Đơn xin thực tập_Hà Thị Mỹ Bình.docx",
  );
  report(
    "TC_UNIT_13",
    "Khử dấu tiếng Việt có dấu thành ký tự an toàn không dấu",
    vietnameseName === "Don_xin_thuc_tap_Ha_Thi_My_Binh.docx",
  );

  // TC_UNIT_14: Tên lưu trên đĩa luôn là chuỗi UUID ngẫu nhiên v4 hợp lệ
  var uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let storedName;
  try {
    storedName = storage.saveBuffer(validPdfBuffer);
    report(
      "TC_UNIT_14",
      "Tên lưu trên đĩa luôn là chuỗi UUID ngẫu nhiên hợp lệ",
      uuidRegex.test(storedName),
    );
  } finally {
    if (storedName) storage.removeFile(storedName);
  }

  // TC_UNIT_15: resolveStoredPath chặn path traversal, chỉ nhận UUID nằm trong uploads/
  const uuid = storedName;
  let traversalBlocked = true;
  for (const evil of [
    "../server.js",
    "..\\..\\x",
    "/etc/passwd",
    `${uuid}/../../x`,
    "a.pdf",
    "",
  ]) {
    try {
      storage.resolveStoredPath(evil);
      traversalBlocked = false;
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 400))
        traversalBlocked = false;
    }
  }
  const resolved = storage.resolveStoredPath(uuid);
  report(
    "TC_UNIT_15",
    "resolveStoredPath chặn path traversal/tên không phải UUID, chấp nhận UUID nằm trong uploads/",
    traversalBlocked && path.dirname(resolved) === storage.UPLOADS_DIR,
  );

  // TC_UNIT_16: saveBuffer ghi file đúng nội dung với tên UUID; removeFile xóa được; xóa lần 2 an toàn
  const savedName = storage.saveBuffer(validPdfBuffer);
  const savedPath = path.join(storage.UPLOADS_DIR, savedName);
  const savedOk =
    uuidRegex.test(savedName) &&
    fs.existsSync(savedPath) &&
    fs.readFileSync(savedPath).equals(validPdfBuffer);
  const removed = storage.removeFile(savedName);
  const removedAgain = storage.removeFile(savedName);
  report(
    "TC_UNIT_16",
    "saveBuffer ghi file tên UUID đúng nội dung; removeFile xóa được và gọi lại không lỗi",
    savedOk &&
      removed === true &&
      removedAgain === false &&
      !fs.existsSync(savedPath),
  );

  // TC_UNIT_17: removeFile với tên traversal KHÔNG xóa file ngoài uploads/
  const outsideFile = path.join(storage.UPLOADS_DIR, "..", "package.json");
  storage.removeFile("../package.json");
  report(
    "TC_UNIT_17",
    "removeFile với tên chứa ../ không xóa được file ngoài thư mục uploads",
    fs.existsSync(outsideFile),
  );

  // TC_UNIT_18: PDF phải đủ 5 byte '%PDF-' (thiếu dấu '-' bị từ chối)
  try {
    validateFileBuffer({
      buffer: Buffer.from("%PDFx-not-a-real-pdf"),
      originalname: "gan_giong_pdf.pdf",
      size: 20,
    });
    report(
      "TC_UNIT_18",
      "PDF phải đủ chữ ký %PDF-",
      false,
      "Không chặn chữ ký thiếu '-'",
    );
  } catch (err) {
    report(
      "TC_UNIT_18",
      "Từ chối file .pdf có chữ ký gần giống nhưng thiếu '-' (%PDFx)",
      err instanceof HttpError && err.status === 400,
    );
  }

  // TC_UNIT_19: MIME lưu DB suy ra từ đuôi file, không tin Content-Type client khai báo
  const spoofMime = validateFileBuffer({
    buffer: validPdfBuffer,
    originalname: "cv.pdf",
    size: validPdfBuffer.length,
    mimetype: "text/html",
  });
  report(
    "TC_UNIT_19",
    "MIME lưu DB lấy theo đuôi đã xác thực (application/pdf), bỏ qua MIME client khai báo",
    spoofMime.mimeType === "application/pdf",
  );

  // TC_UNIT_20: Tính tiến độ hồ sơ 0/2, 1/2, 2/2 và không đếm trùng cùng loại
  const p0 = calculateProgress([]);
  const p1 = calculateProgress([{ doc_type: "CV" }, { doc_type: "CV" }]);
  const p2 = calculateProgress([
    { doc_type: "CV" },
    { doc_type: "APPLICATION_LETTER" },
  ]);
  report(
    "TC_UNIT_20",
    "calculateProgress: 0/2 'Chưa đủ', 1/2 (không đếm trùng), 2/2 'Đã đủ hồ sơ'",
    p0.totalUploaded === 0 &&
      p0.isComplete === false &&
      p1.totalUploaded === 1 &&
      p1.percent === 50 &&
      p2.totalUploaded === 2 &&
      p2.isComplete === true &&
      p2.statusLabel === "Đã đủ hồ sơ",
  );

  console.log("\n----------------------------------------------------");
  console.log(
    ` KẾT QUẢ UNIT TEST UPLOAD: ${passCount}/${passCount + failCount} TEST CASES PASS (${Math.round((passCount / (passCount + failCount)) * 100)}%)`,
  );
  console.log("----------------------------------------------------\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runUnitTests();
}

module.exports = { runUnitTests };
