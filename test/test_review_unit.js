// test_review_unit.js - Unit test điều kiện duyệt hồ sơ (US10). Không cần MySQL / mạng.
const {
  countRequiredDocs,
  missingDocsMessage,
  validateReviewConditions,
} = require("../services/reviewRules");

let pass = 0;
let fail = 0;
function check(id, desc, ok, detail = "") {
  console.log(
    ` [${ok ? "PASS" : "FAIL"}] ${id}: ${desc}${ok || !detail ? "" : ` (${detail})`}`,
  );
  ok ? pass++ : fail++;
}

const CV = { doc_type: "CV" };
const LETTER = { doc_type: "APPLICATION_LETTER" };

console.log("\n UNIT TEST ĐIỀU KIỆN DUYỆT HỒ SƠ\n");

// --- hàm thuần ---
check(
  "U01",
  "Đủ CV + Đơn -> 2/2, isComplete",
  (() => {
    const r = countRequiredDocs([CV, LETTER]);
    return r.uploaded === 2 && r.isComplete && r.missing.length === 0;
  })(),
);
check(
  "U02",
  "Chỉ có CV -> 1/2, thiếu APPLICATION_LETTER",
  (() => {
    const r = countRequiredDocs([CV]);
    return (
      r.uploaded === 1 && !r.isComplete && r.missing[0] === "APPLICATION_LETTER"
    );
  })(),
);
check(
  "U03",
  "Không có tài liệu / null / undefined -> 0/2",
  [[], null, undefined].every((d) => countRequiredDocs(d).uploaded === 0),
);
check(
  "U04",
  "Trùng loại tài liệu không tính 2 lần (CV + CV = 1/2)",
  countRequiredDocs([CV, CV]).uploaded === 1,
);
check(
  "U05",
  "Chấp nhận khóa docType (camelCase từ DB)",
  countRequiredDocs([{ docType: "CV" }, { docType: "APPLICATION_LETTER" }])
    .isComplete,
);
check(
  "U06",
  "Loại tài liệu lạ không được tính",
  countRequiredDocs([{ doc_type: "OTHER" }, CV]).uploaded === 1,
);
check(
  "U07",
  "Thông báo thiếu tài liệu đúng định dạng",
  missingDocsMessage([CV]) === "Hồ sơ chưa đủ tài liệu (1/2), không thể duyệt!",
);

// --- validateReviewConditions ---
check(
  "U08",
  "APPROVED + đủ doc -> hợp lệ",
  validateReviewConditions({ status: "APPROVED", documents: [CV, LETTER] })
    .valid === true,
);
const miss = validateReviewConditions({ status: "APPROVED", documents: [CV] });
check(
  "U09",
  "APPROVED + thiếu doc -> 400 kèm (1/2)",
  !miss.valid &&
    miss.httpStatus === 400 &&
    miss.message === "Hồ sơ chưa đủ tài liệu (1/2), không thể duyệt!",
  JSON.stringify(miss),
);
check(
  "U10",
  "APPROVED + 0 doc -> 400 (0/2)",
  validateReviewConditions({
    status: "APPROVED",
    documents: [],
  }).message.includes("(0/2)"),
);
check(
  "U11",
  "REJECTED không yêu cầu đủ tài liệu",
  validateReviewConditions({ status: "REJECTED", documents: [] }).valid ===
    true,
);
check(
  "U12",
  "Status không hợp lệ (MAYBE/PENDING/rỗng/null/số) -> 400",
  ["MAYBE", "PENDING", "", null, undefined, 1, "approved"].every((s) => {
    const r = validateReviewConditions({ status: s, documents: [CV, LETTER] });
    return !r.valid && r.httpStatus === 400;
  }),
);

// --- changeStatus với db giả: kiểm tra thứ tự 400 / 404 / 409 / 200 mà không cần MySQL ---
const dbStub = {
  apps: {},
  docs: {},
  atomicCalls: [],
  findApplicationById: async (id) => dbStub.apps[id] || null,
  findDocumentsByApplicationId: async (id) => dbStub.docs[id] || [],
  findDocumentsByApplicationIds: async () => [],
  reviewApplicationAtomic: async (args) => {
    dbStub.atomicCalls.push(args);
    const a = dbStub.apps[args.id];
    if (!a || a.status !== "Chờ duyệt") return null;
    const d = dbStub.docs[args.id] || [];
    if (
      args.requiredDocs > 0 &&
      new Set(d.map((x) => x.docType)).size < args.requiredDocs
    )
      return null;
    a.status = args.newStatus;
    return a;
  },
};
require.cache[require.resolve("../db")] = {
  id: "db",
  filename: "db",
  loaded: true,
  exports: dbStub,
};
const service = require("../services/applications.service");
const HR = { id: 1, role: "HR" };
const mk = (status) => ({ id: 1, name: "A", email: "a@x.vn", status });

async function expectErr(promise) {
  try {
    await promise;
    return { status: 200 };
  } catch (e) {
    return { status: e.status, message: e.message };
  }
}

(async () => {
  dbStub.apps = {
    1: mk("Chờ duyệt"),
    2: mk("Chờ duyệt"),
    3: mk("Đã duyệt"),
    4: mk("Từ chối"),
    5: mk("Chờ duyệt"),
  };
  dbStub.docs = {
    1: [{ docType: "CV" }, { docType: "APPLICATION_LETTER" }],
    2: [{ docType: "CV" }],
    3: [], // đã duyệt nhưng thiếu doc: vẫn phải là 409, không phải 400
    5: [],
  };

  let r = await expectErr(
    service.changeStatus({ id: "abc", status: "APPROVED" }, HR),
  );
  check("S01", "id sai -> 400", r.status === 400);
  r = await expectErr(
    service.changeStatus({ id: "999", status: "APPROVED" }, HR),
  );
  check(
    "S02",
    "Duyệt hồ sơ không tồn tại -> 404 (không phải 400)",
    r.status === 404,
  );
  r = await expectErr(
    service.changeStatus({ id: "2", status: "APPROVED" }, HR),
  );
  check(
    "S03",
    "Duyệt thiếu doc -> 400 (1/2) và không gọi UPDATE",
    r.status === 400 &&
      r.message.includes("(1/2)") &&
      dbStub.atomicCalls.length === 0,
    JSON.stringify(r),
  );
  r = await expectErr(
    service.changeStatus({ id: "3", status: "APPROVED" }, HR),
  );
  check(
    "S04",
    "Duyệt lại hồ sơ đã duyệt (thiếu doc) -> 409 ưu tiên hơn 400",
    r.status === 409,
  );
  r = await expectErr(
    service.changeStatus({ id: "4", status: "APPROVED" }, HR),
  );
  check("S05", "Duyệt hồ sơ đã từ chối -> 409", r.status === 409);
  r = await expectErr(
    service.changeStatus(
      { id: "5", status: "REJECTED", rejection_reason: "Không phù hợp" },
      HR,
    ),
  );
  check(
    "S06",
    "Từ chối hồ sơ 0/2 doc -> 200 (requiredDocs=0)",
    r.status === 200 && dbStub.atomicCalls.at(-1).requiredDocs === 0,
  );
  r = await expectErr(
    service.changeStatus({ id: "1", status: "APPROVED" }, HR),
  );
  check(
    "S07",
    "Duyệt hồ sơ đủ doc -> 200 (requiredDocs=2)",
    r.status === 200 && dbStub.atomicCalls.at(-1).requiredDocs === 2,
  );
  r = await expectErr(
    service.changeStatus({ id: "1", status: "APPROVED" }, HR),
  );
  check("S08", "Duyệt lại ngay sau đó -> 409", r.status === 409);

  // require_documents:false (trang duyệt hồ sơ online): bỏ qua điều kiện tài liệu nhưng vẫn giữ 404 / 409
  dbStub.apps[7] = mk("Chờ duyệt");
  dbStub.docs[7] = [];
  r = await expectErr(
    service.changeStatus(
      { id: "7", status: "APPROVED", require_documents: false },
      HR,
    ),
  );
  check(
    "S10",
    "require_documents:false, 0 doc -> 200 (requiredDocs=0)",
    r.status === 200 && dbStub.atomicCalls.at(-1).requiredDocs === 0,
    JSON.stringify(r),
  );
  r = await expectErr(
    service.changeStatus(
      { id: "7", status: "APPROVED", require_documents: false },
      HR,
    ),
  );
  check(
    "S11",
    "require_documents:false nhưng đã duyệt -> vẫn 409",
    r.status === 409,
  );
  r = await expectErr(
    service.changeStatus(
      { id: "999", status: "APPROVED", require_documents: false },
      HR,
    ),
  );
  check(
    "S12",
    "require_documents:false, hồ sơ không tồn tại -> vẫn 404",
    r.status === 404,
  );
  dbStub.apps[8] = mk("Chờ duyệt");
  dbStub.docs[8] = [];
  r = await expectErr(
    service.changeStatus(
      { id: "8", status: "APPROVED", require_documents: "false" },
      HR,
    ),
  );
  check(
    "S13",
    'require_documents không phải boolean false (chuỗi "false") -> vẫn bắt buộc đủ doc (400)',
    r.status === 400,
  );

  // UPDATE không đổi dòng nào vì doc bị xóa giữa chừng -> 400 (không phải 409)
  dbStub.apps[6] = mk("Chờ duyệt");
  dbStub.docs[6] = [{ docType: "CV" }, { docType: "APPLICATION_LETTER" }];
  const realFind = dbStub.findDocumentsByApplicationId;
  let calls = 0;
  dbStub.findDocumentsByApplicationId = async (id) => {
    const out = [...(dbStub.docs[id] || [])];
    if (id === 6 && ++calls === 1) dbStub.docs[6] = [{ docType: "CV" }]; // intern xóa 1 file ngay sau pre-check
    return out;
  };
  r = await expectErr(
    service.changeStatus({ id: "6", status: "APPROVED" }, HR),
  );
  dbStub.findDocumentsByApplicationId = realFind;
  check(
    "S09",
    "Race: doc bị xóa sau pre-check -> UPDATE từ chối, trả 400 (x/2)",
    r.status === 400 && r.message.includes("(1/2)"),
    JSON.stringify(r),
  );

  console.log(`\n KẾT QUẢ UNIT TEST REVIEW: ${pass}/${pass + fail} PASS\n`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(" Lỗi không mong đợi:", e);
  process.exit(1);
});
