// Quy tắc duyệt hồ sơ (US10) - hàm thuần, không đụng DB/mạng nên unit test được trực tiếp
const REQUIRED_DOC_TYPES = ["CV", "APPLICATION_LETTER"];
const REVIEWABLE_TARGETS = ["APPROVED", "REJECTED"];

// documents: mảng có doc_type (hoặc docType). Trả về { uploaded, required, missing, isComplete }
function countRequiredDocs(documents) {
  const types = new Set(
    (Array.isArray(documents) ? documents : []).map(
      (d) => d && (d.doc_type ?? d.docType),
    ),
  );
  const missing = REQUIRED_DOC_TYPES.filter((t) => !types.has(t));
  return {
    uploaded: REQUIRED_DOC_TYPES.length - missing.length,
    required: REQUIRED_DOC_TYPES.length,
    missing,
    isComplete: missing.length === 0,
  };
}

function isReviewableStatus(status) {
  return typeof status === "string" && REVIEWABLE_TARGETS.includes(status);
}

function missingDocsMessage(documents) {
  const { uploaded, required } = countRequiredDocs(documents);
  return `Hồ sơ chưa đủ tài liệu (${uploaded}/${required}), không thể duyệt!`;
}

// Trả { valid: true } hoặc { valid: false, httpStatus, message }. Từ chối KHÔNG yêu cầu đủ tài liệu.
function validateReviewConditions({ status, documents }) {
  if (!isReviewableStatus(status)) {
    return {
      valid: false,
      httpStatus: 400,
      message: "Trạng thái không hợp lệ! Chỉ chấp nhận APPROVED hoặc REJECTED.",
    };
  }
  if (status === "APPROVED" && !countRequiredDocs(documents).isComplete) {
    return {
      valid: false,
      httpStatus: 400,
      message: missingDocsMessage(documents),
    };
  }
  return { valid: true };
}

module.exports = {
  REQUIRED_DOC_TYPES,
  isReviewableStatus,
  countRequiredDocs,
  missingDocsMessage,
  validateReviewConditions,
};
