const PDFDocument = require("pdfkit");
const path = require("path");

const {
  validate,
  computeReports,
} = require("./attendanceReport.service");

const FONT_REGULAR = path.join(
  __dirname,
  "..",
  "DejaVuSans.ttf"
);

const FONT_BOLD = path.join(
  __dirname,
  "..",
  "DejaVuSans-Bold.ttf"
);

const HEADERS = [
  "Họ tên",
  "Mã sinh viên",
  "Trường",
  "Chương trình",
  "Mentor",
  "Lịch áp dụng",
  "Ngày phải đi làm",
  "Có mặt",
  "Nghỉ phép",
  "Vắng không phép",
  "Chờ duyệt nghỉ",
  "Đi muộn",
  "Về sớm",
  "Thiếu giờ",
  "Thiếu check-out",
  "Làm ngoài lịch",
  "Tổng giờ làm",
  "Tỷ lệ chuyên cần (%)",
];

function buildRows(reports) {
  return reports.map((r) => [
    r.intern.fullName || "",
    r.intern.studentCode || "",
    r.intern.university || "",
    r.intern.programName || "",
    r.intern.mentorName || "",

    r.scheduleSource
      ? `${r.scheduleName} (${r.scheduleSource})`
      : "",

    r.requiredDays,
    r.presentDays,
    r.leaveDays,
    r.absentDays,
    r.pendingLeaveDays,
    r.lateCount,
    r.earlyLeaveCount,
    r.shortHoursCount,
    r.missingCheckoutCount,
    r.offScheduleDays,

    (r.totalWorkMinutes / 60).toFixed(1),

    r.attendanceRate == null
      ? ""
      : String(r.attendanceRate),
  ].map((v) => String(v ?? "")));
}

function splitText(doc, text, width, fontSize) {
  doc.fontSize(fontSize);

  const words = String(text).split(/\s+/);

  const lines = [];

  let line = "";

  for (const word of words) {
    const candidate = line
      ? `${line} ${word}`
      : word;

    if (
      !line ||
      doc.widthOfString(candidate) <= width
    ) {
      line = candidate;
      continue;
    }

    lines.push(line);
    line = word;
  }

  if (line || !lines.length) {
    lines.push(line);
  }

  return lines;
}

function makeFilename(range) {
  return `bao-cao-chuyen-can_${range.from}_${range.to}.pdf`;
}

async function exportPdf(query) {
  // Dùng cùng bộ validate của báo cáo Excel
  const range = validate(query);

  // Dùng cùng dữ liệu mà Excel đang sử dụng
  const reports = (
    await computeReports(range)
  ).filter((r) => r.hasActivity);

  const rows = buildRows(reports);

  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",

    margins: {
      top: 24,
      bottom: 24,
      left: 18,
      right: 18,
    },

    autoFirstPage: false,
    bufferPages: true,
  });

  // Font tiếng Việt
  doc.registerFont(
    "Report",
    FONT_REGULAR
  );

  doc.registerFont(
    "Report-Bold",
    FONT_BOLD
  );

  const chunks = [];

  doc.on("data", (chunk) => {
    chunks.push(chunk);
  });

  const finished = new Promise(
    (resolve, reject) => {
      doc.on("end", () => {
        resolve(Buffer.concat(chunks));
      });

      doc.on("error", reject);
    }
  );

  // A4 landscape
  const pageWidth = 841.89;
  const pageHeight = 595.28;

  const left = 18;
  const top = 24;
  const bottom = 24;

  const usableWidth =
    pageWidth - left - 18;

  const fontSize = 5.2;
  const lineHeight = 6.2;
  const headerHeight = 25;

  // 18 cột
  const widths = [
    65,
    52,
    68,
    63,
    58,
    72,

    39,
    34,
    34,
    40,
    42,
    34,
    34,
    34,
    42,
    39,
    39,
    48,
  ];

  const widthScale =
    usableWidth /
    widths.reduce(
      (a, b) => a + b,
      0
    );

  const colWidths = widths.map(
    (w) => w * widthScale
  );

  function drawPageHeader() {
    doc
      .font("Report-Bold")
      .fontSize(11)
      .text(
        "BÁO CÁO CHUYÊN CẦN",
        left,
        top,
        {
          width: usableWidth,
          align: "center",
        }
      );

    doc
      .font("Report")
      .fontSize(6.5)
      .text(
        `Thời gian: ${range.from} → ${range.to} | Số thực tập sinh: ${reports.length}`,
        left,
        top + 15,
        {
          width: usableWidth,
          align: "center",
        }
      );
  }

  function drawTableHeader(y) {
    let x = left;

    doc
      .font("Report-Bold")
      .fontSize(fontSize);

    for (
      let i = 0;
      i < HEADERS.length;
      i++
    ) {
      doc
        .rect(
          x,
          y,
          colWidths[i],
          headerHeight
        )
        .fillAndStroke(
          "#e8e8e8",
          "#777777"
        );

      doc
        .fillColor("#111111")
        .text(
          HEADERS[i],
          x + 2,
          y + 3,
          {
            width:
              colWidths[i] - 4,

            height:
              headerHeight - 4,

            align:
              i < 6
                ? "left"
                : "center",

            lineBreak: true,
          }
        );

      x += colWidths[i];
    }
  }

  function drawRow(row, y) {
    const padding = 2;

    const cellLines = row.map(
      (value, i) =>
        splitText(
          doc,
          value,
          colWidths[i] -
            padding * 2,
          fontSize
        )
    );

    const lineCount = Math.max(
      ...cellLines.map(
        (lines) => lines.length
      )
    );

    const rowHeight = Math.max(
      12,
      lineCount *
        lineHeight +
        padding * 2
    );

    let x = left;

    doc
      .font("Report")
      .fontSize(fontSize)
      .fillColor("#111111");

    for (
      let i = 0;
      i < row.length;
      i++
    ) {
      doc
        .rect(
          x,
          y,
          colWidths[i],
          rowHeight
        )
        .stroke("#b0b0b0");

      const lines =
        cellLines[i];

      const align =
        i < 6
          ? "left"
          : "center";

      doc.text(
        lines.join("\n"),
        x + padding,
        y + padding,
        {
          width:
            colWidths[i] -
            padding * 2,

          height:
            rowHeight -
            padding * 2,

          align,

          lineBreak: true,
        }
      );
      x += colWidths[i];
    }

    return rowHeight;
  }

  // Trang đầu
  doc.addPage();

  drawPageHeader();

  let y = 55;

  drawTableHeader(y);

  y += headerHeight;

  // Vẽ từng dòng
  for (const row of rows) {
    const cellLines = row.map(
      (value, i) =>
        splitText(
          doc,
          value,
          colWidths[i] - 4,
          fontSize
        )
    );

    const rowHeight = Math.max(
      12,
      Math.max(
        ...cellLines.map(
          (lines) => lines.length
        )
      ) *
        lineHeight +
        4
    );

    // Hết trang → tạo trang mới
    if (
      y + rowHeight >
      pageHeight - bottom
    ) {
      doc.addPage();

      drawPageHeader();

      y = 55;

      drawTableHeader(y);

      y += headerHeight;
    }

    y += drawRow(row, y);
  }

  // Không có dữ liệu
  if (!rows.length) {
    doc
      .font("Report")
      .fontSize(8)
      .text(
        "Không có dữ liệu chuyên cần trong khoảng thời gian đã chọn.",
        left,
        y + 8
      );
  }

  doc.end();

  const content =
    await finished;

  return {
    filename:
      makeFilename(range),

    content,
  };
}

module.exports = {
  exportPdf,
};