/**
 * CSV cell escaping with spreadsheet-formula-injection protection: a cell that starts with = + - @ TAB or CR
 * would be EXECUTED by Excel / LibreOffice (e.g. a sender named `=HYPERLINK(...)`), so it is prefixed with an
 * apostrophe. Numbers that legitimately start with "-" (money) are passed through as numbers by the callers.
 */
export function csvEscape(value: unknown): string {
  let s = value == null ? '' : String(value);
  const isPlainNumber = /^-?\d+(\.\d+)?$/.test(s);
  if (!isPlainNumber && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}
