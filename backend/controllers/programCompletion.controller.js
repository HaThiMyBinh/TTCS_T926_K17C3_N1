const service = require("../services/programCompletion.service");
const { makeEndpoint } = require("./endpoint");
module.exports = {
  save: makeEndpoint("PROGRAM_RESULT")(
    (req) =>
      service.save(req.params.id, req.params.internId, req.body, req.user),
    "Đã lưu kết quả chương trình!",
  ),
};
