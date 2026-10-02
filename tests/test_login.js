const API_URL = `${process.env.TEST_BASE_URL || `http://127.0.0.1:${process.env.TEST_PORT || 5000}/api`}/auth/login`;

async function runAutoLoginTests() {
  console.log("\n");
  console.log("====================================================");
  console.log(" BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG CHỨC NĂNG ĐĂNG NHẬP (LOGIN)");
  console.log("====================================================");
  console.log("\n");

  let passCount = 0;
  const totalCount = 5;

  // TC_01: Đăng nhập thành công với tài khoản Admin
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: "admin@gmail.com",
        password: "password123",
      }),
    });
    const data = await res.json();
    if (
      res.status === 200 &&
      data.user &&
      data.user.role === "Admin" &&
      typeof data.token === "string" &&
      data.token.length > 0
    ) {
      console.log(" [PASS] TC_01: Đăng nhập thành công tài khoản Admin & nhận được JWT (Mã 200 OK)");
      passCount++;
    } else {
      console.log(" [FAIL] TC_01: Đăng nhập Admin thất bại hoặc thiếu token: " + JSON.stringify(data));
    }
  } catch (e) {
    console.log(" [FAIL] TC_01: Lỗi kết nối API: " + e.message);
  }

  // TC_02: Đăng nhập thành công với tài khoản HR
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: "hr@company.com",
        password: "password123",
      }),
    });
    const data = await res.json();
    if (res.status === 200 && data.user && data.user.role === "HR") {
      console.log(" [PASS] TC_02: Đăng nhập thành công tài khoản HR (Mã 200 OK)");
      passCount++;
    } else {
      console.log(" [FAIL] TC_02: Đăng nhập HR thất bại");
    }
  } catch (e) {
    console.log(" [FAIL] TC_02: Lỗi kết nối API: " + e.message);
  }

  // TC_03: Chặn đăng nhập khi sai mật khẩu
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: "admin@gmail.com",
        password: "sai_mat_khau_123",
      }),
    });
    if (res.status === 401) {
      console.log(" [PASS] TC_03: Chặn chính xác khi nhập sai mật khẩu (Báo lỗi 401)");
      passCount++;
    } else {
      console.log(" [FAIL] TC_03: Hệ thống không chặn mật khẩu sai");
    }
  } catch (e) {
    console.log(" [FAIL] TC_03: Lỗi kết nối API: " + e.message);
  }

  // TC_04: Chặn khi tài khoản không tồn tại
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: `non_existent_${Date.now()}@gmail.com`,
        password: "password123",
      }),
    });
    if (res.status === 401) {
      console.log(" [PASS] TC_04: Bắt chính xác lỗi tài khoản không tồn tại (Mã 401)");
      passCount++;
    } else {
      console.log(" [FAIL] TC_04: Không bắt được tài khoản không tồn tại");
    }
  } catch (e) {
    console.log(" [FAIL] TC_04: Lỗi kết nối API: " + e.message);
  }

  // TC_05: Chặn khi gửi dữ liệu rỗng
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: "",
        password: "",
      }),
    });
    if (res.status === 400) {
      console.log(" [PASS] TC_05: Chặn thành công khi để trống thông tin (Mã 400)");
      passCount++;
    } else {
      console.log(" [FAIL] TC_05: Không chặn dữ liệu rỗng");
    }
  } catch (e) {
    console.log(" [FAIL] TC_05: Lỗi kết nối API: " + e.message);
  }

  console.log("\n");
  console.log(` KẾT QUẢ TEST ĐĂNG NHẬP: ${passCount}/${totalCount} TEST CASES PASS`);
  console.log("====================================================\n");

  // Trả mã thoát khác 0 khi có test FAIL để `npm test` / CI nhận biết được
  if (passCount < totalCount) process.exitCode = 1;
}

runAutoLoginTests();
