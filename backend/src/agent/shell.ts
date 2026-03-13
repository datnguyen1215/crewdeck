// POSIX single-quote escaping for shell arguments
export function shellQuote(str: string): string {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}
