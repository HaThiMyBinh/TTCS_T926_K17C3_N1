const fs = require("fs");
const path = require("path");

const API_URL = "http://127.0.0.1:5000/api/mentors";

async function runAutoMentorTests() {
  console.log("\n");
  console.log(" BẮT ĐẦU CHẠY TEST CHỨC NĂNG THÊM MỚI MENTOR (USE STORY 6)");
  console.log("\n");

  let passCount = 0;
  const totalCount = 4;
  const timeId = Date.now();

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Mentor ICTU ${timeId}`,
        department: "Trung tâm Phần mềm",
        title: "Senior Developer",
        position: "Senior Developer",
      }),
    });
    const data = await res.json();
    if (res.status === 201 || res.status === 200) {
      console.log(" [PASS] TC_01: Thêm mới Mentor thành công (Mã 201/200)");
      passCount++;
    } else {
      console.log(
        ` [FAIL] TC_01: Thêm Mentor thất bại (${data.error || res.status})`,
      );
    }
  } catch (e) {
    console.log(
      " [FAIL] TC_01: Lỗi kết nối API (Chưa bật server hoặc sai cổng)",
    );
  }

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "",
        department: "Trung tâm Phần mềm",
        title: "Senior Developer",
      }),
    });
    if (res.status === 400) {
      console.log(
        " [PASS] TC_02: Chặn thành công khi bỏ trống Họ tên (Mã 400)",
      );
      passCount++;
    } else {
      console.log(" [FAIL] TC_02: Backend không chặn khi thiếu Họ tên");
    }
  } catch (e) {
    console.log(" [FAIL] TC_02: Lỗi kết nối API");
  }

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Lê Văn Hướng Dẫn",
        department: "",
        title: "",
        position: "",
      }),
    });
    if (res.status === 400) {
      console.log(
        " [PASS] TC_03: Chặn thành công khi thiếu Phòng ban / Chức danh (Mã 400)",
      );
      passCount++;
    } else {
      console.log(" [FAIL] TC_03: Backend không chặn khi thiếu dữ liệu");
    }
  } catch (e) {
    console.log(" [FAIL] TC_03: Lỗi kết nối API");
  }

  try {
    let dbPath = path.join(__dirname, "mentors.json");
    if (!fs.existsSync(dbPath)) {
      dbPath = path.join(__dirname, "users.json");
    }

    const records = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
    const isSaved = records.some((m) => m.name === `Mentor ICTU ${timeId}`);

    if (isSaved) {
      console.log(
        " [PASS] TC_04: Dữ liệu Mentor đã được lưu chính xác vào file CSDL",
      );
      passCount++;
    } else {
      console.log(" [FAIL] TC_04: Không tìm thấy Mentor vừa thêm trong CSDL");
    }
  } catch (e) {
    console.log(" [FAIL] TC_04: Không đọc được file Database để kiểm tra");
  }

  console.log("\n");
  console.log(
    ` KẾT QUẢ TEST MENTOR: ${passCount}/${totalCount} TEST CASES PASS!`,
  );
  console.log("\n");
}

runAutoMentorTests();
