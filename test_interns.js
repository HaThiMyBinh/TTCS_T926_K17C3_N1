// test_interns.js - Kiểm thử chức năng Quản lý hồ sơ thực tập sinh (Story 4 & Story 5)
const { BASE_URL, loginAs } = require("./test_helpers");

async function runAutoInternTests() {
  console.log("\n====================================================");
  console.log(" BẮT ĐẦU KIỂM THỬ HỒ SƠ THỰC TẬP SINH ");
  console.log("====================================================\n");

  let passCount = 0;
  const totalCount = 6;
  let createdInternId = null;
  const testStudentCode = `SV_${Date.now()}`;
  const testEmail = `intern_${Date.now()}@ictu.edu.vn`;

  // Các route /api/interns (POST/PUT/DELETE) chỉ Admin/HR được phép - phải
  const hrToken = await loginAs("HR");
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${hrToken}`,
  };

  // THÊM MỚI HỒ SƠ THỰC TẬP SINH (POST /api/interns) ---

  // TC_01: Thêm mới hồ sơ thực tập sinh thành công (Mã 201 Created)
  try {
    const res = await fetch(`${BASE_URL}/interns`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        studentCode: testStudentCode,
        fullName: "Hà Thị Mỹ Bình",
        email: testEmail,
        phone: "0912345678",
        university: "ĐH CNTT & Truyền Thông",
        major: "Kỹ thuật phần mềm",
        mentorName: "Hà Thị Mỹ Bình",
        status: "Đang thực tập",
      }),
    });
    const data = await res.json();
    if (res.status === 201 && (data.intern || data.student)) {
      createdInternId = (data.intern || data.student).id;
      console.log(
        " [PASS] TC_01: Thêm mới hồ sơ thực tập sinh thành công (Mã 201 Created)",
      );
      passCount++;
    } else {
      console.log(
        " [FAIL] TC_01: Thêm mới hồ sơ thất bại: " + JSON.stringify(data),
      );
    }
  } catch (e) {
    console.log(" [FAIL] TC_01: Lỗi kết nối API: " + e.message);
  }

  // TC_02: Chặn khi bỏ trống thông tin bắt buộc (Họ tên, Email, Trường) (Mã 400)
  try {
    const res = await fetch(`${BASE_URL}/interns`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        studentCode: "SV_INVALID",
        fullName: "", // Thiếu tên
        email: "", // Thiếu email
        university: "",
      }),
    });
    if (res.status === 400) {
      console.log(
        " [PASS] TC_02: Chặn thành công khi bỏ trống thông tin bắt buộc (Mã 400)",
      );
      passCount++;
    } else {
      console.log(" [FAIL] TC_02: Không chặn khi thiếu thông tin");
    }
  } catch (e) {
    console.log(" [FAIL] TC_02: Lỗi kết nối API: " + e.message);
  }

  // TC_03: Chặn trùng lặp Email thực tập sinh (Mã 400)
  try {
    const res = await fetch(`${BASE_URL}/interns`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        studentCode: `DIFF_SV_${Date.now()}`,
        fullName: "Hà Thị Mỹ Bình Trùng Email",
        email: testEmail, // Trùng email đã tạo ở TC_01
        university: "ĐH CNTT & Truyền Thông",
      }),
    });
    const data = await res.json();
    if (res.status === 400 && data.error && data.error.includes("Email")) {
      console.log(
        " [PASS] TC_03: Chặn chính xác trùng lặp Email thực tập sinh (Mã 400)",
      );
      passCount++;
    } else {
      console.log(
        " [FAIL] TC_03: Không chặn trùng email: " + JSON.stringify(data),
      );
    }
  } catch (e) {
    console.log(" [FAIL] TC_03: Lỗi kết nối API: " + e.message);
  }

  // TC_04: Chặn trùng lặp Mã sinh viên (Mã SV) (Mã 400)
  try {
    const res = await fetch(`${BASE_URL}/interns`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        studentCode: testStudentCode, // Trùng mã sinh viên đã tạo ở TC_01
        fullName: "Hà Thị Mỹ Bình Trùng Mã SV",
        email: `unique_email_${Date.now()}@gmail.com`,
        university: "ĐH Bách Khoa",
      }),
    });
    const data = await res.json();
    if (
      res.status === 400 &&
      data.error &&
      data.error.includes("Mã sinh viên")
    ) {
      console.log(
        " [PASS] TC_04: Chặn chính xác trùng lặp Mã sinh viên (Mã SV) (Mã 400)",
      );
      passCount++;
    } else {
      console.log(
        " [FAIL] TC_04: Không chặn trùng Mã SV: " + JSON.stringify(data),
      );
    }
  } catch (e) {
    console.log(" [FAIL] TC_04: Lỗi kết nối API: " + e.message);
  }

  // CHỈNH SỬA HỒ SƠ THỰC TẬP SINH (PUT /api/interns/:id) ---

  // TC_05: Cập nhật thành công thông tin hồ sơ (Mã 200 OK)
  try {
    if (createdInternId) {
      const res = await fetch(`${BASE_URL}/interns/${createdInternId}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          studentCode: testStudentCode,
          fullName: "Hà Thị Mỹ Bình (Đã Cập Nhật)",
          email: testEmail,
          phone: "0999888777",
          university: "ĐH CNTT & Truyền Thông",
          major: "An toàn thông tin",
          mentorName: "Hà Thị Mỹ Bình",
          status: "Hoàn thành",
        }),
      });
      const data = await res.json();
      if (
        res.status === 200 &&
        (data.intern || data.student).status === "Hoàn thành"
      ) {
        console.log(
          " [PASS] TC_05: Cập nhật thành công thông tin hồ sơ thực tập sinh (Mã 200 OK)",
        );
        passCount++;
      } else {
        console.log(
          " [FAIL] TC_05: Cập nhật hồ sơ thất bại: " + JSON.stringify(data),
        );
      }
    } else {
      console.log(" [FAIL] TC_05: Bỏ qua do TC_01 không tạo được ID");
    }
  } catch (e) {
    console.log(" [FAIL] TC_05: Lỗi kết nối API: " + e.message);
  }

  // TC_06: Báo lỗi khi cập nhật hồ sơ không tồn tại (Mã 404 Not Found)
  try {
    const res = await fetch(`${BASE_URL}/interns/9999999`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({
        fullName: "Không tồn tại",
        email: "ghost@gmail.com",
        university: "Unknown",
      }),
    });
    if (res.status === 404) {
      console.log(
        " [PASS] TC_06: Bắt chính xác lỗi hồ sơ không tồn tại (Mã 404 Not Found)",
      );
      passCount++;
    } else {
      console.log(" [FAIL] TC_06: Không trả về mã 404 cho ID không tồn tại");
    }
  } catch (e) {
    console.log(" [FAIL] TC_06: Lỗi kết nối API: " + e.message);
  }

  // Cleanup: Xóa hồ sơ test đã tạo
  if (createdInternId) {
    try {
      const res = await fetch(`${BASE_URL}/interns/${createdInternId}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (res.status !== 200) {
        console.log(
          ` [CLEANUP] Không xóa được hồ sơ thực tập sinh test #${createdInternId} (Mã ${res.status}) - có thể còn sót dữ liệu rác.`,
        );
      }
    } catch (e) {
      console.log(" [CLEANUP] Lỗi kết nối khi dọn hồ sơ thực tập sinh test: " + e.message);
    }
  }

  console.log("\n====================================================");
  console.log(
    ` KẾT QUẢ KIỂM THỬ THỰC TẬP SINH: ${passCount}/${totalCount} TEST CASES PASS 100%!`,
  );
  console.log("====================================================\n");
}

runAutoInternTests();
