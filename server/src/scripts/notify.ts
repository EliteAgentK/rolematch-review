// A message to the owner from a script on the host, such as the daily check: the subject is the first argument, the text comes on standard input.
//   echo "report" | node src/scripts/notify.js "RoleMatch daily check: all current"
import { notifyOwner } from "../opsNotify";
const subject = process.argv[2] ?? "RoleMatch";
let text = ""; for await (const chunk of process.stdin) text += chunk;
process.exit((await notifyOwner(subject, text.trim(), "the RoleMatch daily check on the PC")) === "sent" ? 0 : 1);
