// Migration bổ sung cấu trúc dữ liệu theo 8 quy tắc thiết kế (nhóm, lịch sử mentor, người tham gia lịch...).
// Chỉ thêm mới, chạy lặp lại an toàn (idempotent), không xóa hay ghi đè dữ liệu có sẵn.
// Gọi sau khi các bảng internship_programs, program_interns, intern_profiles, mentors,
// meetings, work_schedule_assignments đã tồn tại.

const TABLES = {
  // Quy tắc 2: một chương trình có nhiều nhóm, mỗi nhóm thuộc đúng một chương trình.
  program_groups: `CREATE TABLE IF NOT EXISTS program_groups (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    program_id BIGINT NOT NULL,
    name VARCHAR(150) NOT NULL,
    description VARCHAR(500) NULL,
    created_by BIGINT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_group_program_name (program_id, name),
    UNIQUE KEY uq_group_id_program (id, program_id),
    CONSTRAINT fk_group_program FOREIGN KEY (program_id) REFERENCES internship_programs(id) ON DELETE CASCADE,
    CONSTRAINT fk_group_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Quy tắc 3: thành viên nhóm. Chỉ được vào nhóm nếu đã thuộc chương trình của nhóm (FK kép),
  // và tại một thời điểm mỗi thực tập sinh chỉ có tối đa MỘT nhóm chính trong một chương trình
  // (khóa duy nhất trên cột sinh active_primary_key). Nhóm phụ (is_primary = 0) được phép nhiều nhóm.
  group_members: `CREATE TABLE IF NOT EXISTS group_members (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    group_id BIGINT NOT NULL,
    program_id BIGINT NOT NULL,
    intern_id BIGINT NOT NULL,
    is_primary TINYINT(1) NOT NULL DEFAULT 1,
    joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    left_at DATETIME(3) NULL,
    assigned_by BIGINT NULL,
    active_primary_key VARCHAR(48) GENERATED ALWAYS AS (IF(is_primary = 1 AND left_at IS NULL, CONCAT(program_id, '-', intern_id), NULL)) VIRTUAL,
    active_member_key VARCHAR(48) GENERATED ALWAYS AS (IF(left_at IS NULL, CONCAT(group_id, '-', intern_id), NULL)) VIRTUAL,
    UNIQUE KEY uq_group_primary_active (active_primary_key),
    UNIQUE KEY uq_group_member_active (active_member_key),
    INDEX idx_group_members_intern (intern_id, program_id),
    INDEX idx_group_members_group (group_id, left_at),
    CONSTRAINT fk_gm_group FOREIGN KEY (group_id, program_id) REFERENCES program_groups(id, program_id) ON DELETE CASCADE,
    CONSTRAINT fk_gm_enrollment FOREIGN KEY (program_id, intern_id) REFERENCES program_interns(program_id, intern_id) ON DELETE CASCADE,
    CONSTRAINT fk_gm_user FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_gm_range CHECK (left_at IS NULL OR left_at >= joined_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Quy tắc 4: phân công mentor có thời gian hiệu lực [effective_from, effective_to).
  // Mỗi thực tập sinh chỉ có tối đa một phân công đang mở (effective_to IS NULL).
  // intern_profiles.mentor_id vẫn là "mentor hiện tại" (bản sao để các truy vấn cũ dùng) và luôn được cập nhật cùng giao dịch.
  mentor_assignments: `CREATE TABLE IF NOT EXISTS mentor_assignments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    intern_id BIGINT NOT NULL,
    mentor_id BIGINT NULL,
    mentor_name VARCHAR(100) NULL,
    program_id BIGINT NULL,
    effective_from DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    effective_to DATETIME(3) NULL,
    assigned_by BIGINT NULL,
    note VARCHAR(500) NULL,
    open_key BIGINT GENERATED ALWAYS AS (IF(effective_to IS NULL, intern_id, NULL)) VIRTUAL,
    UNIQUE KEY uq_mentor_assignment_open (open_key),
    INDEX idx_ma_intern (intern_id, effective_from),
    INDEX idx_ma_mentor (mentor_id, effective_to),
    CONSTRAINT fk_ma_intern FOREIGN KEY (intern_id) REFERENCES intern_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_ma_mentor FOREIGN KEY (mentor_id) REFERENCES mentors(id) ON DELETE SET NULL,
    CONSTRAINT fk_ma_program FOREIGN KEY (program_id) REFERENCES internship_programs(id) ON DELETE SET NULL,
    CONSTRAINT fk_ma_user FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_ma_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Quy tắc 8: lịch sử đăng ký chương trình (thêm/gỡ thành viên) và biến động nhóm. Không có FK tới nhóm để dấu vết
  // còn nguyên khi nhóm hoặc tư cách thành viên bị xóa (group_id/detail là bản chụp tại thời điểm xảy ra).
  program_intern_events: `CREATE TABLE IF NOT EXISTS program_intern_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    program_id BIGINT NOT NULL,
    intern_id BIGINT NOT NULL,
    event_type ENUM('ADDED','REMOVED','GROUP_JOINED','GROUP_LEFT') NOT NULL,
    group_id BIGINT NULL,
    detail VARCHAR(200) NULL,
    actor_user_id BIGINT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_pie_program (program_id, created_at),
    INDEX idx_pie_intern (intern_id, created_at),
    CONSTRAINT fk_pie_program FOREIGN KEY (program_id) REFERENCES internship_programs(id) ON DELETE CASCADE,
    CONSTRAINT fk_pie_intern FOREIGN KEY (intern_id) REFERENCES intern_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_pie_user FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Quy tắc 7: ngoại lệ theo cá nhân của một lịch họp. Lịch phạm vi chương trình/nhóm tự lấy người từ quan hệ thành viên;
  // INCLUDE = thêm người ngoài phạm vi, EXCLUDE = loại một thành viên khỏi lịch.
  schedule_participants: `CREATE TABLE IF NOT EXISTS schedule_participants (
    meeting_id BIGINT NOT NULL,
    intern_id BIGINT NOT NULL,
    participation ENUM('INCLUDE','EXCLUDE') NOT NULL DEFAULT 'INCLUDE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (meeting_id, intern_id),
    INDEX idx_sp_intern (intern_id),
    CONSTRAINT fk_sp_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    CONSTRAINT fk_sp_intern FOREIGN KEY (intern_id) REFERENCES intern_profiles(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
};

const WORK_SCHEDULE_TARGETS = [
  "DEFAULT",
  "UNIVERSITY",
  "PROGRAM",
  "MENTOR",
  "INTERN",
  "GROUP",
];

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?",
    [table, column],
  );
  return rows.length > 0;
}

async function constraintExists(conn, table, name) {
  const [rows] = await conn.query(
    "SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=?",
    [table, name],
  );
  return rows.length > 0;
}

// Lịch phạm vi cho cuộc họp + phạm vi GROUP cho lịch làm việc.
async function extendExistingTables(conn) {
  if (!(await columnExists(conn, "meetings", "scope_type")))
    await conn.query(
      "ALTER TABLE meetings ADD COLUMN scope_type ENUM('INDIVIDUAL','PROGRAM','GROUP') NOT NULL DEFAULT 'INDIVIDUAL'",
    );
  if (!(await columnExists(conn, "meetings", "group_id")))
    await conn.query("ALTER TABLE meetings ADD COLUMN group_id BIGINT NULL");
  if (!(await constraintExists(conn, "meetings", "fk_meeting_group")))
    await conn.query(
      "ALTER TABLE meetings ADD CONSTRAINT fk_meeting_group FOREIGN KEY (group_id) REFERENCES program_groups(id) ON DELETE SET NULL",
    );

  if (!(await columnExists(conn, "program_intern_events", "group_id")))
    await conn.query(
      "ALTER TABLE program_intern_events ADD COLUMN group_id BIGINT NULL, ADD COLUMN detail VARCHAR(200) NULL",
    );
  const [[evt]] = await conn.query(
    "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='program_intern_events' AND COLUMN_NAME='event_type'",
  );
  if (evt && !/GROUP_LEFT/.test(evt.COLUMN_TYPE))
    await conn.query(
      "ALTER TABLE program_intern_events MODIFY event_type ENUM('ADDED','REMOVED','GROUP_JOINED','GROUP_LEFT') NOT NULL",
    );

  const [[col]] = await conn.query(
    "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='work_schedule_assignments' AND COLUMN_NAME='target_type'",
  );
  if (col && !/'GROUP'/.test(col.COLUMN_TYPE))
    await conn.query(
      `ALTER TABLE work_schedule_assignments MODIFY target_type ENUM(${WORK_SCHEDULE_TARGETS.map((t) => `'${t}'`).join(",")}) NOT NULL`,
    );
}

// Đồng bộ mentor_assignments với intern_profiles.mentor_id (dữ liệu cũ chưa có lịch sử):
// đóng phân công mở không còn khớp, mở phân công cho người đang có mentor mà chưa có dòng mở.
async function reconcileMentorAssignments(conn) {
  await conn.query("SET @mig_now = NOW(3)");
  await conn.query(
    `UPDATE mentor_assignments ma JOIN intern_profiles ip ON ip.id = ma.intern_id
     SET ma.effective_to = @mig_now
     WHERE ma.effective_to IS NULL AND (ip.mentor_id IS NULL OR ma.mentor_id IS NULL OR ma.mentor_id <> ip.mentor_id)`,
  );
  await conn.query(
    `INSERT INTO mentor_assignments (intern_id, mentor_id, mentor_name, effective_from, note)
     SELECT ip.id, ip.mentor_id, m.full_name, COALESCE(ip.created_at, @mig_now), 'Khởi tạo từ dữ liệu hiện có'
     FROM intern_profiles ip JOIN mentors m ON m.id = ip.mentor_id
     WHERE ip.mentor_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM mentor_assignments x WHERE x.intern_id = ip.id AND x.effective_to IS NULL)`,
  );
}

// Phát hiện lệch giữa intern_profiles.mentor_id ("mentor hiện tại") và phân công đang mở của mentor_assignments.
// Trả về mỗi thực tập sinh bị lệch: mentor hiện tại khác mentor của dòng mở, có mentor mà không có dòng mở,
// có dòng mở mà không có mentor, hoặc dòng mở không gắn mentor nào. Danh sách rỗng nghĩa là hai nơi đang khớp.
const MENTOR_DRIFT_SQL = `SELECT ip.id AS internId, ip.mentor_id AS currentMentorId,
         ma.id AS openAssignmentId, ma.mentor_id AS openMentorId
  FROM intern_profiles ip
  LEFT JOIN mentor_assignments ma ON ma.intern_id = ip.id AND ma.effective_to IS NULL
  WHERE NOT (ip.mentor_id <=> ma.mentor_id) OR (ma.id IS NOT NULL AND ma.mentor_id IS NULL)
  ORDER BY ip.id`;

async function findMentorAssignmentDrift(database) {
  const [rows] = await database.query(MENTOR_DRIFT_SQL);
  return rows;
}

// Chạy work(conn) trên một kết nối riêng (hoặc kết nối được truyền vào) dưới khóa migration cấu trúc.
async function withStructureLock(database, work) {
  const own = typeof database.getConnection === "function";
  const conn = own ? await database.getConnection() : database;
  let locked = false;
  try {
    const [[lock]] = await conn.query(
      "SELECT GET_LOCK(CONCAT('structure:', LEFT(DATABASE(), 50)), 30) AS acquired",
    );
    if (Number(lock.acquired) !== 1)
      throw new Error("Không lấy được khóa migration cấu trúc nhóm/mentor");
    locked = true;
    return await work(conn);
  } finally {
    if (locked)
      await conn
        .query(
          "SELECT RELEASE_LOCK(CONCAT('structure:', LEFT(DATABASE(), 50)))",
        )
        .catch(() => {});
    if (own) conn.release();
  }
}

async function migrateStructure(database) {
  await withStructureLock(database, async (conn) => {
    for (const sql of Object.values(TABLES)) await conn.query(sql);
    await extendExistingTables(conn);
    await reconcileMentorAssignments(conn);
  });
}

// Đồng bộ lại lịch sử mentor mà không chạy cả migration. Dùng sau mọi thao tác ghi intern_profiles.mentor_id
// ngoài các luồng đã đi qua recordMentorChange (ví dụ backfillInternMentorIds sau khi nạp demo).
// Truyền pool (khuyến nghị) hoặc một kết nối chưa mở giao dịch. Trả về { before, after }: danh sách lệch
// trước và sau khi đồng bộ; after phải rỗng.
async function reconcileMentorHistory(database) {
  return withStructureLock(database, async (conn) => {
    const before = await findMentorAssignmentDrift(conn);
    if (before.length === 0) return { before, after: [] };
    await conn.beginTransaction();
    try {
      await reconcileMentorAssignments(conn);
      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    }
    return { before, after: await findMentorAssignmentDrift(conn) };
  });
}

module.exports = {
  TABLES,
  WORK_SCHEDULE_TARGETS,
  migrateStructure,
  reconcileMentorAssignments,
  reconcileMentorHistory,
  findMentorAssignmentDrift,
};
