
const API_BASE_URL = "http://localhost:3000/api";

function getAuthToken() {
    // Nếu dự án dùng tên khác, hãy đổi "token"
    // thành đúng tên key đang lưu sau khi đăng nhập.
    return localStorage.getItem("token");
}

async function fetchInternReport(filters = {}) {
    const token = getAuthToken();

    if (!token) {
        throw new Error("401");
    }

    const params = new URLSearchParams();

    if (filters.school) params.set("school", filters.school);
    if (filters.major) params.set("major", filters.major);
    if (filters.status) params.set("status", filters.status);
    if (filters.period) params.set("period", filters.period);

    params.set("page", String(filters.page || 1));
    params.set("limit", String(filters.limit || 10));

    const response = await fetch(
        `${API_BASE_URL}/reports/interns-by-school?${params}`,
        {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/json"
            }
        }
    );

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error("401");
        }

        if (response.status === 403) {
            throw new Error("403");
        }

        if (response.status >= 500) {
            throw new Error("500");
        }

        throw new Error(`HTTP_${response.status}`);
    }

    return response.json();
}

window.fetchInternReport = fetchInternReport;
