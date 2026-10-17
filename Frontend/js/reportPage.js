
const $ = (id) => document.getElementById(id);

let currentPage = 1;
const pageSize = 10;

function showStatus(name, message = "") {
    $("report-loading").hidden = name !== "loading";
    $("report-error").hidden = name !== "error";
    $("report-empty").hidden = name !== "empty";

    $("report-error").textContent = message;
}

function getFilters() {
    return {
        school: $("filter-school").value.trim(),
        major: $("filter-major").value.trim(),
        status: $("filter-status").value,
        period: $("filter-period").value.trim(),
        page: currentPage,
        limit: pageSize
    };
}

function renderRows(rows) {
    const tbody = $("report-body");
    tbody.replaceChildren();

    rows.forEach((item) => {
        const tr = document.createElement("tr");

        // Đổi các tên thuộc tính này nếu backend trả về
        // schema khác.
        const values = [
            item.school ?? item.school_name ?? "",
            item.major ?? item.major_name ?? "",
            item.studying ?? item.in_progress ?? 0,
            item.completed ?? 0,
            item.dropped ?? item.dropouts ?? 0
        ];

        values.forEach((value) => {
            const td = document.createElement("td");
            td.textContent = String(value);
            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });
}

async function loadInternReport() {
    showStatus("loading");
    $("report-body").replaceChildren();

    try {
        const result = await window.fetchInternReport(getFilters());

        // Hỗ trợ cả dạng mảng và dạng { data: [...] }.
        const rows = Array.isArray(result)
            ? result
            : result.data ?? result.items ?? result.rows ?? [];

        if (!Array.isArray(rows)) {
            throw new Error("Dữ liệu API không đúng định dạng");
        }

        if (rows.length === 0) {
            showStatus("empty");
        } else {
            showStatus("success");
            renderRows(rows);
        }

        const totalPages = Number(
            result.totalPages ??
            result.pagination?.totalPages ??
            0
        );

        $("report-page").textContent = totalPages
            ? `Trang ${currentPage}/${totalPages}`
            : `Trang ${currentPage}`;

        $("btn-prev").disabled = currentPage <= 1;

        $("btn-next").disabled = totalPages
            ? currentPage >= totalPages
            : rows.length < pageSize;

    } catch (error) {
        $("report-body").replaceChildren();

        const messages = {
            "401": "401 - Bạn chưa đăng nhập hoặc phiên đăng nhập hết hạn.",
            "403": "403 - Bạn không có quyền VIEW_REPORTS.",
            "500": "500 - Máy chủ gặp lỗi, vui lòng thử lại."
        };

        showStatus(
            "error",
            messages[error.message] ??
            error.message ??
            "Không thể tải báo cáo."
        );
    }
}

$("btn-filter").addEventListener("click", () => {
    currentPage = 1;
    loadInternReport();
});

$("btn-prev").addEventListener("click", () => {
    if (currentPage > 1) {
        currentPage--;
        loadInternReport();
    }
});

$("btn-next").addEventListener("click", () => {
    if (!$("btn-next").disabled) {
        currentPage++;
        loadInternReport();
    }
});

loadInternReport();
