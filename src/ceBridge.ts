import * as http from "node:http";

interface PendingRequest {
  id: number;
  method: string;
  params: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * HTTP transport bridging the MCP server <-> the CE Lua script.
 *
 * Why HTTP? Cheat Engine's bundled Lua doesn't include LuaSocket as `require"socket"`,
 * but it does ship `getInternet()` which gives us synchronous HTTP. We host a tiny
 * server on 127.0.0.1:<port> that the CE side polls.
 *
 * Single endpoint, POST /:
 *   {"action":"hello"}                  -> {"ok":true}
 *   {"action":"poll"}                   -> {} (idle) or {id, method, params}
 *   {"action":"reply", id, result|error}-> {"ok":true}
 *
 * Long-poll: poll waits up to ~2s for a pending command before returning empty.
 */
export class CeBridge {
  private server: http.Server;
  private pending = new Map<number, PendingRequest>();
  private queue: number[] = [];
  private waiters: Array<(id: number | null) => void> = [];
  private nextId = 1;
  private bridgeLastSeen = 0;
  private readonly defaultTimeoutMs = 15_000;
  private readonly pollWaitMs = 250;

  constructor(private readonly host = "127.0.0.1", private readonly port = 5874) {
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", reject);
        console.error(`[ce-bridge] HTTP listening on ${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  /** Bridge is "connected" if CE polled within the last 5 s. */
  isConnected(): boolean {
    return Date.now() - this.bridgeLastSeen < 5_000;
  }

  call(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<unknown> {
    if (!this.isConnected()) {
      return Promise.reject(
        new Error(
          "Cheat Engine bridge is not connected. In Cheat Engine open Table → Show Cheat Table Lua Script (Ctrl+Alt+L), paste ce-lua/bridge.lua, and click Execute script.",
        ),
      );
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CE call '${method}' timed out`));
      }, timeoutMs ?? this.defaultTimeoutMs);
      this.pending.set(id, { id, method, params, resolve, reject, timer });
      this.queue.push(id);
      this.flushWaiters();
    });
  }

  private flushWaiters() {
    while (this.waiters.length > 0 && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const w = this.waiters.shift()!;
      w(id);
    }
  }

  private waitForCommand(): Promise<number | null> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift()!);
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        const idx = this.waiters.indexOf(resolver);
        if (idx >= 0) this.waiters.splice(idx, 1);
        resolve(null);
      }, this.pollWaitMs);
      const resolver = (id: number | null) => {
        clearTimeout(t);
        resolve(id);
      };
      this.waiters.push(resolver);
    });
  }

  private async readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.setEncoding("utf8");
      req.on("data", (c: string) => { data += c; if (data.length > 16 * 1024 * 1024) req.destroy(); });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
    let body: string;
    try { body = await this.readBody(req); }
    catch { res.writeHead(400); res.end(); return; }
    let msg: any;
    try { msg = body.length ? JSON.parse(body) : {}; }
    catch { res.writeHead(400); res.end('{"error":"bad json"}'); return; }

    this.bridgeLastSeen = Date.now();
    const action = msg.action;

    if (action === "hello") {
      console.error("[ce-bridge] CE bridge connected (hello)");
      return this.respondJson(res, { ok: true });
    }

    if (action === "poll") {
      const id = await this.waitForCommand();
      if (id == null) return this.respondJson(res, {});
      const p = this.pending.get(id);
      if (!p) return this.respondJson(res, {});
      return this.respondJson(res, { id: p.id, method: p.method, params: p.params });
    }

    if (action === "reply") {
      const id = Number(msg.id);
      const p = this.pending.get(id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(id);
        if (msg.error) p.reject(new Error(String(msg.error)));
        else p.resolve(msg.result);
      }
      return this.respondJson(res, { ok: true });
    }

    res.writeHead(400); res.end('{"error":"unknown action"}');
  }

  private respondJson(res: http.ServerResponse, obj: unknown) {
    const body = JSON.stringify(obj);
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
  }
}
