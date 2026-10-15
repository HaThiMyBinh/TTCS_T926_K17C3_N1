// Tạo / cập nhật gói demo trong thư mục demo/ từ dữ liệu hiện có trên máy bạn.
// Chạy:  npm run demo:export   (MySQL phải đang bật)
const db = require("../db");
const { exportDemo, DEMO_DIR } = require("../services/demoData");

(async () => {
  try {
    await db.initDatabase();
    const r = await exportDemo(db.getPool());
    console.log("\n=== ĐÃ XUẤT GÓI DEMO ===");
    console.log("Thư mục :", DEMO_DIR);
    console.log("Bản ghi :", JSON.stringify(r.counts));
    console.log("File    :", r.copiedFiles, "file đã copy vào demo/uploads");
    if (r.missingFiles.length > 0) {
      console.warn(
        `CẢNH BÁO: ${r.missingFiles.length} file có trong DB nhưng KHÔNG còn trên đĩa (người nhận cũng sẽ không mở được):`,
      );
      r.missingFiles.forEach((f) => console.warn("  -", f));
    }
    console.log(
      "\nBây giờ chỉ cần nén cả dự án (nhớ kèm thư mục demo/) rồi gửi đi.",
    );
    process.exit(0);
  } catch (err) {
    console.error("[DEMO] Xuất demo thất bại:", err.message);
    process.exit(1);
  }
})();
