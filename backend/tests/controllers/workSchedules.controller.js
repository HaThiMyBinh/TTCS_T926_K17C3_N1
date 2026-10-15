const service = require("../services/workSchedules.service");
const { makeEndpoint } = require("./endpoint");
const endpoint = makeEndpoint("WORK_SCHEDULE");

module.exports = {
  list: endpoint(() => service.list(), "Lấy danh sách lịch làm việc thành công!"),
  get: endpoint((req) => service.get(req.params.id), "Lấy lịch làm việc thành công!"),
  create: endpoint((req) => service.create(req.body), "Tạo lịch làm việc thành công!", 201),
  update: endpoint((req) => service.update(req.params.id, req.body), "Cập nhật lịch làm việc thành công!"),
  remove: endpoint((req) => service.remove(req.params.id), "Đã xóa lịch làm việc!"),

  assignments: endpoint(() => service.assignments(), "Lấy danh sách áp dụng lịch thành công!"),
  assign: endpoint((req) => service.assign(req.user, req.body), "Đã áp dụng lịch làm việc!", 201),
  removeAssignment: endpoint((req) => service.removeAssignment(req.params.id), "Đã xóa lần áp dụng lịch!"),
  preview: endpoint((req) => service.preview(req.query), "Xem trước phạm vi áp dụng thành công!"),
  resolved: endpoint(() => service.resolved(), "Lấy lịch đang áp dụng thành công!"),
  options: endpoint(() => service.options(), "Lấy danh sách phạm vi thành công!"),

  holidays: endpoint(() => service.holidays(), "Lấy danh sách ngày nghỉ thành công!"),
  addHoliday: endpoint((req) => service.addHoliday(req.body), "Đã thêm ngày nghỉ!", 201),
  removeHoliday: endpoint((req) => service.removeHoliday(req.params.id), "Đã xóa ngày nghỉ!"),

  mine: endpoint((req) => service.mine(req.user), "Lấy lịch làm việc của bạn thành công!"),
};
