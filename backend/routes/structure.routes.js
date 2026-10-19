// Nhóm trong chương trình, lịch sử mentor, lịch sử đăng ký chương trình.
const express = require("express");
const { requireRole } = require("../auth");
const { makeEndpoint } = require("../utils/endpoint");
const service = require("../services/structure.service");
const endpoint = makeEndpoint("STRUCTURE");
const router = express.Router();

const staffRead = requireRole("Admin", "HR");
const hrWrite = requireRole("HR");

router.get(
  "/programs/:id/groups",
  staffRead,
  endpoint((req) => service.listGroups(req.params.id), "Lấy danh sách nhóm thành công!"),
);
router.post(
  "/programs/:id/groups",
  hrWrite,
  endpoint(
    (req) => service.createGroup(req.params.id, req.body, req.user),
    "Tạo nhóm thành công!",
    201,
  ),
);
router.get(
  "/programs/:id/ungrouped-interns",
  staffRead,
  endpoint(
    (req) => service.listUngrouped(req.params.id),
    "Lấy danh sách thực tập sinh chưa có nhóm thành công!",
  ),
);
router.get(
  "/programs/:id/enrollment-history",
  staffRead,
  endpoint(
    (req) => service.enrollmentHistory(req.params.id),
    "Lấy lịch sử đăng ký chương trình thành công!",
  ),
);
router.put(
  "/groups/:groupId",
  hrWrite,
  endpoint((req) => service.updateGroup(req.params.groupId, req.body), "Cập nhật nhóm thành công!"),
);
router.delete(
  "/groups/:groupId",
  hrWrite,
  endpoint((req) => service.deleteGroup(req.params.groupId), "Xóa nhóm thành công!"),
);
router.get(
  "/groups/:groupId/members",
  staffRead,
  endpoint(
    (req) => service.listMembers(req.params.groupId, req.query),
    "Lấy thành viên nhóm thành công!",
  ),
);
router.post(
  "/groups/:groupId/members",
  hrWrite,
  endpoint(
    (req) => service.addMembers(req.params.groupId, req.body, req.user),
    "Cập nhật thành viên nhóm thành công!",
  ),
);
router.delete(
  "/groups/:groupId/members/:internId",
  hrWrite,
  endpoint(
    (req) =>
      service.removeMember(req.params.groupId, req.params.internId, req.query, {}, req.user),
    "Đã gỡ thực tập sinh khỏi nhóm!",
  ),
);
router.put(
  "/groups/:groupId/mentor",
  hrWrite,
  endpoint(
    (req) => service.assignGroupMentor(req.params.groupId, req.body, req.user),
    "Cập nhật phân công mentor cho nhóm thành công!",
  ),
);
router.post(
  "/groups/:groupId/roadmap",
  hrWrite,
  endpoint(
    (req) => service.applyRoadmap("group", req.params.groupId, req.body),
    "Đã áp dụng lộ trình cho nhóm!",
  ),
);
router.post(
  "/programs/:id/roadmap",
  hrWrite,
  endpoint(
    (req) => service.applyRoadmap("program", req.params.id, req.body),
    "Đã áp dụng lộ trình cho chương trình!",
  ),
);
router.get(
  "/me/groups",
  requireRole("Intern", "Mentor"),
  endpoint((req) => service.myGroups(req.user), "Lấy nhóm của tôi thành công!"),
);
router.get(
  "/interns/:id/mentor-history",
  staffRead,
  endpoint(
    (req) => service.mentorHistory(req.params.id, req.query),
    "Lấy lịch sử phân công mentor thành công!",
  ),
);

module.exports = router;
