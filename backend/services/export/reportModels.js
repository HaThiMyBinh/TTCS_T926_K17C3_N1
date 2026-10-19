// Public export projections only: no raw database rows, audit objects or credentials.
const { getVietnamToday, formatVietnamDateTime } = require("../../utils/date");
const col = (label, type = "text", width = type === "text" ? 28 : 18) => ({
  label,
  type,
  width,
});
const table = (name, columns, rows, totals = null) => ({
  name,
  columns,
  rows,
  totals,
});
const num = (value) => (value == null ? null : Number(value));
const fractionFromPercent = (value) =>
  value == null ? null : Number(value) / 100;
function base(title, fileBase, info, tables, now = new Date()) {
  return {
    title,
    fileBase,
    exportedDate: getVietnamToday(now),
    exportedAt: formatVietnamDateTime(now),
    info,
    tables,
  };
}
function filterInfo(filters, labels) {
  return Object.entries(labels).map(
    ([key, label]) =>
      `${label}: ${filters[key] == null || filters[key] === "" ? "Tất cả" : filters[key]}`,
  );
}
function completion(data, filters = {}, now) {
  const columns = [
    col("Nhóm"),
    col("Tổng lượt tham gia", "number"),
    col("Đã hoàn thành", "number"),
    col("Đang thực tập", "number"),
    col("Tạm dừng / không hoàn thành", "number"),
    col("Trạng thái thiếu / khác", "number"),
    col("Tỷ lệ hoàn thành", "percent"),
  ];
  const row = (name, s) => [
    name,
    s.total,
    s.completed,
    s.active,
    s.notCompleted,
    s.unknownStatus,
    fractionFromPercent(s.rate),
  ];
  return base(
    "Tỷ lệ hoàn thành chương trình",
    "ty-le-hoan-thanh-chuong-trinh",
    [
      "Kết quả theo từng lượt tham gia do HR xác nhận; không dùng trạng thái hồ sơ.",
      ...filterInfo(filters, {
        programId: "Chương trình (ID)",
        programStatus: "Trạng thái chương trình",
        status: "Kết quả",
        from: "Chương trình kết thúc từ",
        to: "Chương trình bắt đầu đến",
        q: "Từ khóa",
      }),
    ],
    [
      table("Tổng quan", columns, [
        row("Tất cả lượt tham gia trong phạm vi", data.summary),
      ]),
      ...[
        ["Theo chương trình", data.byProgram],
        ["Theo mentor", data.byMentor],
      ].map(([name, groups]) =>
        table(
          name,
          columns,
          groups.map((g) => row(g.name, g)),
        ),
      ),
    ],
    now,
  );
}
function origin(data, filters = {}, now) {
  const countColumns = [
    col("Tên"),
    col("Số lượng", "number"),
    col("Tỷ lệ", "percent"),
  ];
  const matrix = data.matrix;
  return base(
    "Thực tập sinh theo trường ngành",
    "thuc-tap-sinh-theo-truong-nganh",
    [
      ...filterInfo(filters, {
        status: "Trạng thái",
        from: "Hồ sơ tạo từ",
        to: "Hồ sơ tạo đến",
        q: "Từ khóa",
        groupBy: "Chiều trên màn hình",
        limit: "Số nhóm tối đa",
      }),
      "File xuất đầy đủ các chiều như CSV. Bộ lọc trạng thái thực tập sinh không áp dụng cho phễu ứng viên.",
    ],
    [
      table(
        "Tổng quan",
        [col("Chỉ tiêu"), col("Số lượng", "number")],
        [
          ["Tổng thực tập sinh", data.total],
          ["Chưa cập nhật trường hoặc ngành", data.unknown],
        ],
      ),
      table(
        "Theo trường",
        countColumns,
        data.byUniversity.map((g) => [
          g.name,
          g.count,
          fractionFromPercent(g.percent),
        ]),
      ),
      table(
        "Theo ngành",
        countColumns,
        data.byMajor.map((g) => [
          g.name,
          g.count,
          fractionFromPercent(g.percent),
        ]),
      ),
      table(
        "Trường × ngành",
        [
          col("Trường / Ngành"),
          ...matrix.majors.map((m) => col(m, "number")),
          col("Tổng cộng", "number"),
        ],
        matrix.universities.map((u) => [
          u,
          ...matrix.majors.map((m) => matrix.data[u]?.[m] || 0),
          matrix.totals.byUniversity[u] || 0,
        ]),
        [
          "Tổng cộng",
          ...matrix.majors.map((m) => matrix.totals.byMajor[m] || 0),
          matrix.totals.grandTotal || 0,
        ],
      ),
      table(
        "Phễu ứng viên",
        [
          col("Trường"),
          col("Hồ sơ nộp", "number"),
          col("Đã duyệt", "number"),
          col("Từ chối", "number"),
          col("Chờ duyệt", "number"),
          col("Tỷ lệ duyệt", "percent"),
        ],
        data.funnel.map((g) => [
          g.name,
          g.applied,
          g.approved,
          g.rejected,
          g.pending,
          fractionFromPercent(g.approvalRate),
        ]),
      ),
    ],
    now,
  );
}
const attendanceFields = [
  ["Ngày phải đi làm", "requiredDays"],
  ["Có mặt", "presentDays"],
  ["Nghỉ phép", "leaveDays"],
  ["Vắng không phép", "absentDays"],
  ["Chờ duyệt nghỉ", "pendingLeaveDays"],
  ["Đi muộn", "lateCount"],
  ["Về sớm", "earlyLeaveCount"],
  ["Thiếu giờ", "shortHoursCount"],
  ["Thiếu check-out", "missingCheckoutCount"],
  ["Làm ngoài lịch", "offScheduleDays"],
];
function attendance(data, filters = {}, now) {
  const metrics = (r) => [
    ...attendanceFields.map(([, key]) => num(r[key])),
    Number((Number(r.totalWorkMinutes || 0) / 60).toFixed(1)),
    fractionFromPercent(r.attendanceRate),
  ];
  const metricsColumns = [
    ...attendanceFields.map(([label]) => col(label, "number")),
    col("Tổng giờ làm", "number"),
    col("Tỷ lệ chuyên cần", "percent"),
  ];
  return base(
    "Báo cáo chuyên cần",
    "bao-cao-chuyen-can",
    filterInfo(filters, {
      from: "Từ ngày",
      to: "Đến ngày",
      scopeType: "Phạm vi",
      scopeValue: "Giá trị phạm vi",
      internId: "Thực tập sinh (ID)",
      groupBy: "Nhóm",
    }),
    [
      table(
        "Tổng quan",
        [col("Nhóm"), col("Số thực tập sinh", "number"), ...metricsColumns],
        [["Tất cả", data.summary.totalInterns, ...metrics(data.summary)]],
      ),
      table(
        "Theo nhóm",
        [col("Nhóm"), col("Số thực tập sinh", "number"), ...metricsColumns],
        data.groups.map((g) => [g.name, g.totalInterns, ...metrics(g)]),
      ),
      table(
        "Thực tập sinh",
        [
          col("Họ tên"),
          col("Mã sinh viên"),
          col("Trường"),
          col("Chương trình"),
          col("Mentor"),
          col("Lịch áp dụng"),
          ...metricsColumns,
        ],
        data.interns.map((r) => [
          r.intern.fullName,
          r.intern.studentCode,
          r.intern.university,
          r.intern.programName,
          r.intern.mentorName,
          r.scheduleSource ? `${r.scheduleName} (${r.scheduleSource})` : "",
          ...metrics(r),
        ]),
      ),
    ],
    now,
  );
}
function finalReport(report, now) {
  const data = report.data;
  return base(
    report.title || "Báo cáo cuối kỳ",
    `bao-cao-cuoi-ky-${report.id}`,
    [
      `Trạng thái báo cáo: ${report.status}`,
      `Phạm vi: ${report.scopeLabel || report.scopeType || "Tất cả"}`,
      `Từ ngày: ${report.periodFrom || "Tất cả"}`,
      `Đến ngày: ${report.periodTo || "Tất cả"}`,
      `Ghi chú HR: ${report.hrNote || data.hrNote || "Không"}`,
    ],
    [
      table(
        "Tổng quan",
        [
          col("Tổng thực tập sinh", "number"),
          col("Đã đánh giá", "number"),
          col("Chưa đánh giá", "number"),
          col("Điểm kỹ năng TB", "number"),
          col("Điểm thái độ TB", "number"),
          col("Điểm tổng TB", "number"),
        ],
        [
          [
            data.summary.totalInterns,
            data.summary.evaluated,
            data.summary.notEvaluated,
            num(data.summary.avgSkill),
            num(data.summary.avgAttitude),
            num(data.summary.avgOverall),
          ],
        ],
      ),
      table(
        "Thực tập sinh",
        [
          col("Họ tên"),
          col("Mã sinh viên"),
          col("Trường"),
          col("Ngành"),
          col("Chương trình"),
          col("Phòng ban"),
          col("Mentor"),
          col("Bắt đầu", "date"),
          col("Kết thúc", "date"),
          col("Trạng thái đánh giá"),
          col("Điểm kỹ năng", "number"),
          col("Nhận xét kỹ năng"),
          col("Điểm thái độ", "number"),
          col("Nhận xét thái độ"),
          col("Điểm tổng", "number"),
          col("Nhận xét chung"),
          col("Tuần phải nộp", "number"),
          col("Đúng hạn", "number"),
          col("Trễ", "number"),
          col("Thiếu", "number"),
          col("Nhiệm vụ", "number"),
          col("Đã hoàn thành", "number"),
          col("Tổng phút làm việc", "number"),
        ],
        data.interns.map((i) => [
          i.fullName,
          i.studentCode,
          i.university,
          i.major,
          i.programName,
          i.departmentName,
          i.mentorName,
          i.startDate,
          i.endDate,
          i.evaluated ? "Đã đánh giá" : "Chưa đánh giá",
          num(i.skillScore),
          i.skillComment,
          num(i.attitudeScore),
          i.attitudeComment,
          num(i.overallScore),
          i.overallComment,
          i.weeklyReportStats.required,
          i.weeklyReportStats.onTime,
          i.weeklyReportStats.late,
          i.weeklyReportStats.missing,
          i.taskStats.total,
          i.taskStats.done,
          i.totalWorkMinutes,
        ]),
      ),
    ],
    now,
  );
}
module.exports = { completion, origin, attendance, finalReport };
