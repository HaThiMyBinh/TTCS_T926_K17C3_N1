// Nhắc lịch cho thực tập sinh: mốc lịch thực tập sắp bắt đầu và nhiệm vụ sắp đến hạn.
// Chạy định kỳ; mỗi nhắc chỉ tạo một lần nhờ khóa chống trùng (dedupeKey) nên chạy lại bao nhiêu lần cũng không lặp.
const db = require("../db");
const { addDays } = require("./scheduleRules.service");
const { getVietnamToday } = require("../utils/date");
const { toInterns, viDate } = require("./internNotify.service");

const RUN_EVERY_MS = 60 * 60 * 1000;

function whenOf(date, today) {
  return date === today ? { code: "D0", text: "hôm nay" } : { code: "D1", text: "ngày mai" };
}

async function runReminders({ today = getVietnamToday(), deps = {} } = {}) {
  const store = deps.db || db;
  const tomorrow = addDays(today, 1);
  let milestones = 0, tasks = 0;

  for (const m of await store.listMilestonesStartingBetween(today, tomorrow)) {
    const when = whenOf(m.startDate, today);
    milestones += await toInterns([m.internId], {
      type: "SCHEDULE_REMINDER", title: "Sắp đến lịch thực tập",
      message: `Giai đoạn "${m.title}" bắt đầu ${when.text} (${viDate(m.startDate)}).`.slice(0, 500),
      targetTab: "tab-my-schedule", refId: m.id, dedupeKey: `ms-start:${m.id}:${m.startDate}:${when.code}`,
    }, deps);
  }
  for (const t of await store.listTasksDueBetween(today, tomorrow)) {
    const when = whenOf(t.dueDate, today);
    tasks += await toInterns([t.internId], {
      type: "TASK_REMINDER", title: "Nhiệm vụ sắp đến hạn",
      message: `Nhiệm vụ "${t.title}" đến hạn ${when.text} (${viDate(t.dueDate)}).`.slice(0, 500),
      targetTab: "tab-my-tasks", refId: t.id, dedupeKey: `task-due:${t.id}:${t.dueDate}:${when.code}`,
    }, deps);
  }
  return { milestones, tasks };
}

let timer = null, running = false;
async function safeRun() {
  if (running) return;
  running = true;
  try {
    const r = await runReminders();
    if (r.milestones || r.tasks) console.log(`[REMINDER] Đã tạo ${r.milestones} nhắc lịch thực tập, ${r.tasks} nhắc nhiệm vụ.`);
  } catch (err) {
    console.error("[REMINDER] Không chạy được nhắc lịch:", err.message);
  } finally {
    running = false;
  }
}
// Gọi một lần khi server khởi động (sau khi kết nối DB).
function start() {
  if (timer) return;
  setTimeout(safeRun, 10 * 1000).unref();
  timer = setInterval(safeRun, RUN_EVERY_MS);
  timer.unref();
}

module.exports = { runReminders, start };
