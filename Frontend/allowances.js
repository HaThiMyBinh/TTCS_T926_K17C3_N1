const form = document.getElementById("allowanceForm");
const internInput = document.getElementById("intern");
const typeInput = document.getElementById("type");
const amountInput = document.getElementById("amount");
const periodInput = document.getElementById("period");
const noteInput = document.getElementById("note");

const list = document.getElementById("allowanceList");
const searchInput = document.getElementById("search");
const filterPeriod = document.getElementById("filterPeriod");
const message = document.getElementById("message");
const emptyMessage = document.getElementById("emptyMessage");

// Sử dụng dữ liệu giả từ mockData.js
const allowances = window.mockAllowances || [];

const moneyFormatter = new Intl.NumberFormat("vi-VN");

function showMessage(text, type) {
    message.textContent = text;
    message.className = type;
}

function formatMoney(amount) {
    return moneyFormatter.format(amount) + " VND";
}

function today() {
    return new Date().toLocaleDateString("vi-VN");
}

function createCell(value) {
    const td = document.createElement("td");
    td.textContent = value ?? "";
    return td;
}

function renderAllowances() {
    list.replaceChildren();

    const keyword = searchInput.value.trim().toLowerCase();
    const selectedPeriod = filterPeriod.value;

    const filtered = allowances.filter(item => {
        const matchName = item.intern
            .toLowerCase()
            .includes(keyword);

        const matchPeriod = !selectedPeriod ||
            item.period === selectedPeriod;

        return matchName && matchPeriod;
    });

    filtered.forEach((item, index) => {
        const tr = document.createElement("tr");

        [
            index + 1,
            item.intern,
            item.type,
            formatMoney(item.amount),
            item.period,
            item.note,
            item.createdBy,
            item.createdAt
        ].forEach(value => {
            tr.appendChild(createCell(value));
        });

        const actionCell = document.createElement("td");
        const deleteButton = document.createElement("button");

        deleteButton.type = "button";
        deleteButton.className = "delete-btn";
        deleteButton.textContent = "Xóa";

        deleteButton.addEventListener("click", () => {
            const position = allowances.findIndex(
                allowance => allowance.id === item.id
            );

            if (position !== -1) {
                allowances.splice(position, 1);
                renderAllowances();
                showMessage("Đã xóa phụ cấp mẫu.", "success");
            }
        });

        actionCell.appendChild(deleteButton);
        tr.appendChild(actionCell);
        list.appendChild(tr);
    });

    emptyMessage.hidden = filtered.length !== 0;
}

form.addEventListener("submit", event => {
    event.preventDefault();

    const intern = internInput.value;
    const type = typeInput.value;
    const amount = Number(amountInput.value);
    const period = periodInput.value;
    const note = noteInput.value.trim();

    if (!intern || !type || !period || !Number.isFinite(amount)
        || !Number.isSafeInteger(amount) || amount <= 0) {
        showMessage(
            "Vui lòng nhập đầy đủ thông tin và số tiền hợp lệ.",
            "error"
        );
        return;
    }

    const duplicate = allowances.some(item =>
        item.intern === intern &&
        item.type === type &&
        item.period === period
    );

    if (duplicate) {
        showMessage(
            "Thực tập sinh đã có loại phụ cấp này trong kỳ đã chọn.",
            "error"
        );
        return;
    }

    const newAllowance = {
        id: Date.now(),
        intern,
        type,
        amount,
        period,
        note,
        createdBy: "HR",
        createdAt: today()
    };

    allowances.unshift(newAllowance);

    form.reset();
    renderAllowances();

    showMessage("Thêm phụ cấp thành công!", "success");
});

form.addEventListener("reset", () => {
    message.textContent = "";
    message.className = "";
});

searchInput.addEventListener("input", renderAllowances);
filterPeriod.addEventListener("change", renderAllowances);

// Hiển thị dữ liệu mẫu ban đầu
renderAllowances();