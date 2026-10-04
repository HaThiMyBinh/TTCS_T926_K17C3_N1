function normalizedName(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("vi") : "";
}

function resolveUniqueMentorId(name, mentors) {
  const target = normalizedName(name);
  if (!target || !Array.isArray(mentors)) return null;

  const matches = mentors.filter((mentor) => {
    const fullName = mentor?.fullName ?? mentor?.full_name;
    return normalizedName(fullName) === target;
  });
  if (matches.length !== 1) return null;

  const id = Number(matches[0].id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

module.exports = { resolveUniqueMentorId };
