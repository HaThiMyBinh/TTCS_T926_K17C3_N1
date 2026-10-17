const service = require("../services/supportRequests.service");
const { makeEndpoint, sendError } = require("./endpoint");
const endpoint = makeEndpoint("SUPPORT");
const action = (fn, status = 200) => endpoint(fn, "Thành công!", status);

const mine = action((req) => service.mine(req.user, req.query));
const create = action((req) => service.create(req.user, req.body), 201);
const cancel = action((req) => service.cancel(req.user, req.params.id));
const list = action((req) => service.listHr(req.query));
const detail = action((req) => service.detail(req.params.id));
const process = action((req) =>
  service.process(req.user, req.params.id, req.body),
);
const uploadMine = action(
  (req) => service.upload(req.user, req.params.id, req.file, "REQUEST", null),
  201,
);
const uploadResult = action(
  (req) => service.upload(req.user, req.params.id, req.file, "RESULT"),
  201,
);
const removeAttachment = action((req) =>
  service.removeAttachment(req.user, req.params.id, req.params.attachmentId),
);
const removeResultAttachment = action((req) =>
  service.removeResultAttachment(req.params.id, req.params.attachmentId),
);
async function download(req, res) {
  try {
    const file = await service.download(
      req.user,
      req.params.id,
      req.params.attachmentId,
    );
    res
      .set("Cache-Control", "private, no-store")
      .set("X-Content-Type-Options", "nosniff");
    return res.download(file.filePath, file.originalName, (err) => {
      if (!err) return;
      if (res.headersSent) {
        console.error("[SUPPORT]", err);
        res.destroy();
        return;
      }
      sendError(res, err, "SUPPORT");
    });
  } catch (err) {
    return sendError(res, err, "SUPPORT");
  }
}
module.exports = {
  mine,
  create,
  cancel,
  list,
  detail,
  process,
  uploadMine,
  uploadResult,
  removeAttachment,
  removeResultAttachment,
  download,
};
