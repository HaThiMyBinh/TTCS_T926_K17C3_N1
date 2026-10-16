// Shared classification of public 4xx errors and private server failures.
class HttpError extends Error {
  constructor(status, message, extra = null) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function publicError(
  err,
  fallbackMessage = "Lỗi server, vui lòng thử lại sau!",
  tag = "API",
) {
  const isClientError =
    Number.isInteger(err?.status) && err.status >= 400 && err.status < 500;
  if (!isClientError) {
    console.error(`[${tag}]`, err);
    return { status: 500, message: fallbackMessage, extra: {} };
  }
  return {
    status: err.status,
    message:
      typeof err.message === "string" ? err.message : "Yêu cầu không hợp lệ!",
    extra:
      err.extra && typeof err.extra === "object" && !Array.isArray(err.extra)
        ? err.extra
        : {},
  };
}

// Preserve the legacy { error, ...extra } response envelope for existing routes.
function sendRouteError(res, err, fallbackMessage) {
  const failure = publicError(err, fallbackMessage);
  return res
    .status(failure.status)
    .json({ ...failure.extra, error: failure.message });
}
module.exports = { HttpError, publicError, sendRouteError };
