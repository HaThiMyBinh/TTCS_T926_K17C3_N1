function csvCell(value) {
  let text = value == null ? "" : String(value);
  const startsWithFormulaCharacter = /^[=+@\t\r]/.test(text);
  const startsWithMinus = text.startsWith("-");
  const isNumber = startsWithMinus && Number.isFinite(Number(text));
  if (startsWithFormulaCharacter || (startsWithMinus && !isNumber)) {
    text = "'" + text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

module.exports = { csvCell };
