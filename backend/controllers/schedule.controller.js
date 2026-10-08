const service = require("../services/schedule.service");
const { HttpError } = require("../errors");

function sendError(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      success: false,
      message: err.message,
      error: err.message,
    });
  }

  console.error("[SCHEDULE CONTROLLER]", err);
  return res.status(500).json({
    success: false,
    message: "Lỗi server, vui lòng thử lại sau!",
    error: "Lỗi server, vui lòng thử lại sau!",
  });
}

async function getMySchedule(req, res) {
  try {
    const todayOverride =
      process.env.NODE_ENV === "test" ? req.query.today : undefined;
    const data = await service.getScheduleForInternUser(
      req.user,
      todayOverride,
    );
    return res.json({
      success: true,
      message: "Lấy lịch thực tập cá nhân thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function getInternSchedule(req, res) {
  try {
    const todayOverride =
      process.env.NODE_ENV === "test" ? req.query.today : undefined;
    const data = await service.getScheduleForInternId(
      req.params.id,
      todayOverride,
      req.user,
    );
    return res.json({
      success: true,
      message: "Lấy lịch thực tập sinh thành công!",
      data,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function mutateMilestones(req, res, action) {
  try {
    const data = await service.manageMilestones(
      req.user,
      req.params.id,
      action,
      req.params.milestoneId,
      req.body,
    );
    return res
      .status(action === "create" || action === "template" ? 201 : 200)
      .json({ success: true, message: "Đã cập nhật lịch thực tập!", data });
  } catch (err) {
    return sendError(res, err);
  }
}

const createMilestone = (req, res) => mutateMilestones(req, res, "create");
const updateMilestone = (req, res) => mutateMilestones(req, res, "update");
const deleteMilestone = (req, res) => mutateMilestones(req, res, "delete");
const createTemplate = (req, res) => mutateMilestones(req, res, "template");

module.exports = {
  getMySchedule,
  getInternSchedule,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  createTemplate,
};
