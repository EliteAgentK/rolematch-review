// Every bullet a document starts a line with, in one place for every reader (11 Nov 2026: four readers kept four different lists, and a duty showed the
// CV's own "⬤" beside the panel's dot). Counted on the 30 real CVs' lines: • 533, ⬤ 235, ➢ 185, U+F0B7 182 (the Symbol font's bullet, stored in the
// private-use range), ⮚ 145, U+F0D8 22, ◼ 22, · 16. Symbol-font and icon-font characters (the private-use range) are never words, so they count too.
const GLYPHS = "•·●○◉◦⬤⚫⚪▪▫■□◼◻◾◽◆◇❖✦✧★☆►▶▷▸▹➤➢➣➔➜→⇒⮚⮞‣⁃✓✔✗✘☑☐»«*\\-–—\\uE000-\\uF8FF";
/** One or more bullets at the start of a line, with the spaces around them. */
const LEADING_BULLETS = new RegExp(`^[\\s${GLYPHS}]+`, "u");
/** A line that begins with a bullet followed by a space (a list item), for readers that tell list lines from others. */
export const BULLET_ITEM = new RegExp(`^\\s*(?:[${GLYPHS}]|\\d{1,2}[.)])\\s+`, "u");
/** The line without its bullets and without a list number ("1.", "(2)"). A line with no bullet is returned as it was, trimmed. */
export const stripBullet = (s: string) => s.replace(LEADING_BULLETS, "").replace(/^\(?\d{1,2}[.)]\s+/, "").trim();
