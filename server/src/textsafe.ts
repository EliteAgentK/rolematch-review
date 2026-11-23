// Text helpers that stay fast on hostile input. A pattern such as /[ \t]+$/ re-scans a long run of spaces from every position and goes quadratic;
// these walk each line once.
export function rtrim(line: string): string {
  let end = line.length;
  while (end > 0 && (line.charCodeAt(end - 1) === 32 || line.charCodeAt(end - 1) === 9)) end--;
  return end === line.length ? line : line.slice(0, end);
}
/** Removes spaces and tabs at the end of every line. */
export const trimLineEnds = (text: string): string => text.split("\n").map(rtrim).join("\n");
