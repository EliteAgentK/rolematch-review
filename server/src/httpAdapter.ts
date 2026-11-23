import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

export interface ServeOptions {
  port: number;
  /** Requests with a larger body are refused with 413 before it is read. A function can allow more for some paths (uploads) than others. */
  maxBodyBytes?: number | ((method: string, path: string) => number);
  fetch: (req: Request, ip: string) => Response | Promise<Response>;
}
export interface Served { port: number; stop: () => Promise<void> }

/** Runs a Web-standard `fetch(Request) => Response` handler on Node's HTTP server. */
export function serve(opts: ServeOptions): Promise<Served> {
  const limitFor = (method: string, path: string) => (typeof opts.maxBodyBytes === "function" ? opts.maxBodyBytes(method, path) : opts.maxBodyBytes ?? Infinity);
  // Slow or oversized requests are cut off, so a few patient attackers cannot hold every connection open.
  const http: Server = createServer({ headersTimeout: 30_000, requestTimeout: 120_000, keepAliveTimeout: 5_000, maxHeaderSize: 16 * 1024 }, async (nreq, nres) => {
    try {
      const max = limitFor(nreq.method ?? "GET", (nreq.url ?? "/").split("?")[0]);
      const declared = Number(nreq.headers["content-length"] ?? 0);
      if (declared > max) { nres.writeHead(413, { "content-type": "text/plain" }); nres.end("Request too large"); nreq.destroy(); return; }
      const headers = new Headers();
      for (const [k, v] of Object.entries(nreq.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      const url = `http://${nreq.headers.host ?? "localhost"}${nreq.url ?? "/"}`;
      const hasBody = nreq.method !== "GET" && nreq.method !== "HEAD";
      let seen = 0;
      const body = hasBody
        ? (Readable.toWeb(nreq) as ReadableStream<Uint8Array>).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, ctl) { seen += chunk.byteLength; if (seen > max) ctl.error(new Error("Request too large")); else ctl.enqueue(chunk); },
          }))
        : undefined;
      const req = new Request(url, { method: nreq.method, headers, body, duplex: "half" } as RequestInit);
      const res = await opts.fetch(req, nreq.socket.remoteAddress ?? "unknown");
      const out: Record<string, string | string[]> = {};
      res.headers.forEach((v, k) => { if (k !== "set-cookie") out[k] = v; });
      const cookies = res.headers.getSetCookie();
      if (cookies.length) out["set-cookie"] = cookies;
      nres.writeHead(res.status, out);
      if (!res.body) { nres.end(); return; }
      Readable.fromWeb(res.body as any).pipe(nres);
    } catch (e) {
      if (!nres.headersSent) nres.writeHead(500, { "content-type": "text/plain" });
      nres.end("Server error");
    }
  });
  http.maxHeadersCount = 100;
  // This machine only, unless LISTEN_HOST says otherwise: the public way in is the tunnel on the same host, so nothing needs the service open to the local network (security audit, 6 Nov 2026).
  return new Promise((resolve) => {
    http.listen(opts.port, process.env.LISTEN_HOST ?? "127.0.0.1", () => resolve({
      port: (http.address() as AddressInfo).port,
      stop: () => new Promise<void>((done) => { http.closeAllConnections(); http.close(() => done()); }),
    }));
  });
}
