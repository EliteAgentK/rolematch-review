// Puts a fixed distance on the way to a database, for measuring how the service behaves when its database is in another country. Bytes are passed unchanged. Disposable stack only.
//   node slowLink.mjs <listen port> <target host> <target port> <milliseconds each way>
import net from "node:net";
const [listen, host, port, delay] = process.argv.slice(2);
const later = (write) => (d) => setTimeout(write, Number(delay), d);
net.createServer((c) => {
  const up = net.connect(Number(port), host); c.setNoDelay(true); up.setNoDelay(true);
  c.on("data", later((d) => up.write(d))); up.on("data", later((d) => c.write(d)));
  const end = () => { c.destroy(); up.destroy(); };
  for (const s of [c, up]) { s.on("close", () => setTimeout(end, Number(delay))); s.on("error", end); }
}).listen(Number(listen), "127.0.0.1", () => console.log(`distance of ${delay} ms each way on ${listen}`));
