/**
 * What an open field shows when the server's copy of its record arrives again (the board reloads every 2 s while a batch runs).
 * A field the person has not changed follows the server; one they have changed keeps their words.
 */
export function followServer<T>(serverBefore: T, serverNow: T, local: T): T {
  return Object.is(local, serverBefore) ? serverNow : local;
}
