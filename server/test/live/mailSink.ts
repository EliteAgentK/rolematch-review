// A rehearsal's stand-in for the test mailbox: the simulated mail host, with its messages readable over HTTP by the browser checks (e2e/hosted/kit.ts). Nothing leaves this machine.
//   node --import tsx test/live/mailSink.ts <smtp port> <http port>
import { createServer } from "node:http";
import { FakeSmtp } from "../fakeSmtp";

const [smtpPort, httpPort] = process.argv.slice(2).map(Number);
const smtp = new FakeSmtp(smtpPort); await smtp.start();
createServer((req, res) => {
  const to = new URL(req.url!, "http://x").searchParams.get("to") ?? "";
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(smtp.messages.filter((m) => m.to.includes(to)).map((m) => ({ to, subject: m.headers.subject ?? "", text: `${m.text}\n${m.html}`, at: m.at }))));
}).listen(httpPort, "127.0.0.1", () => console.log(`mail sink: smtp ${smtpPort}, http ${httpPort}`));
