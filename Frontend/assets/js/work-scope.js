function pill(label, cls) {
  return `<span class="ar-badge ${cls}">${escapeHtml(label)}</span>`;
}
function postJson(body, method = "POST") {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
function daysInclusive(from, to) {
  return (
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86400000,
    ) + 1
  );
}
function weekdayLabel(date) {
  return WEEKDAY_LABELS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
}
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || "";
}

// Danh sách trường / chương trình / mentor / thực tập sinh cho các ô chọn phạm vi.
async function loadWorkScopeOptions(force = false) {
  if (!workScopeOptions || force) {
    const result = await wrRequest("/work-schedules/options");
    if (result && result.res.ok) workScopeOptions = result.body.data;
  }
  return (
    workScopeOptions || {
      universities: [],
      programs: [],
      groups: [],
      mentors: [],
      interns: [],
    }
  );
}
function scopeChoices(type, options) {
  if (type === "UNIVERSITY")
    return options.universities.map((v) => ({ value: v, label: v }));
  if (type === "PROGRAM")
    return options.programs.map((p) => ({
      value: String(p.id),
      label: p.name,
    }));
  if (type === "GROUP")
    return (options.groups || []).map((g) => ({
      value: String(g.id),
      label: `${g.name} — ${g.programName}`,
    }));
  if (type === "MENTOR")
    return options.mentors.map((m) => ({
      value: String(m.id),
      label: m.name,
    }));
  if (type === "INTERN")
    return options.interns.map((i) => ({
      value: String(i.id),
      label: `${i.name}${i.studentCode ? ` (${i.studentCode})` : ""}`,
    }));
  return [];
}
function fillScopeSelect(selectId, type, options) {
  const choices = scopeChoices(type, options);
  document.getElementById(selectId).innerHTML = choices.length
    ? choices
        .map(
          (c) =>
            `<option value="${escapeHtml(c.value)}">${escapeHtml(c.label)}</option>`,
        )
        .join("")
    : `<option value="">— Chưa có dữ liệu —</option>`;
}
