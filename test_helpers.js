const BASE_URL = "http://127.0.0.1:5000/api";

// Tài khoản mẫu mặc định do backend/db.js tự seed lúc khởi động (mật khẩu password123)
const DEMO_ACCOUNTS = {
  Admin: "admin@gmail.com",
  HR: "hr@company.com",
  Mentor: "mentor@gmail.com",
  Intern: "intern@gmail.com",
};

async function loginAs(role, password = "password123") {
  const account = DEMO_ACCOUNTS[role];
  if (!account) {
    throw new Error(`Không có tài khoản mẫu cho vai trò: ${role}`);
  }

  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account, password }),
  });

  const data = await res.json();
  if (res.status !== 200 || !data.token) {
    throw new Error(
      `Đăng nhập thất bại cho vai trò ${role}: ${JSON.stringify(data)}`,
    );
  }
  return data.token;
}

// Trả về headers có kèm Authorization Bearer token cho một vai trò cụ thể.
async function authHeadersFor(role, extra = {}) {
  const token = await loginAs(role);
  return { Authorization: `Bearer ${token}`, ...extra };
}

module.exports = { BASE_URL, DEMO_ACCOUNTS, loginAs, authHeadersFor };
