import { spawn, type ChildProcessByStdio, type SpawnOptionsWithStdioTuple, type StdioPipe } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { PgConfig } from "./pg-env";

/**
 * One long-lived `psql` backend connection driven over stdin.
 *
 * Why psql and not a Node driver: the repository may not gain npm
 * dependencies in this change, and `psql` is on every CI runner. Each session
 * is its own PostgreSQL backend, so two sessions really do contend for row
 * locks. Statements are fed one by one and the end of each is detected with
 * client-side `\echo` / `\warn` markers, which psql prints only after the
 * previous statement has finished (so a statement blocked on a lock keeps its
 * promise pending until it is released) and which also work inside an aborted
 * transaction.
 */

export interface ExecResult {
  /** Non-empty stdout lines (-t -A output). */
  rows: string[];
  /** The ERROR:/FATAL: text psql printed for this exec, or null. */
  error: string | null;
}

interface Pending {
  outMarker: string;
  errMarker: string;
  resolve: (r: ExecResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

const open = new Set<PsqlSession>();

export class PsqlSession {
  private readonly proc: ChildProcessByStdio<Writable, Readable, Readable>;
  private outBuf = "";
  private errBuf = "";
  private seq = 0;
  private readonly pending: Pending[] = [];
  private closed = false;
  private exitPromise: Promise<void>;

  private constructor(
    readonly label: string,
    cfg: PgConfig,
  ) {
    const args: string[] = ["-X", "-q", "-t", "-A", "-h", cfg.host, "-p", cfg.port, "-U", cfg.user, "-d", cfg.database];
    const options: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe> = {
      // A minimal environment: nothing from the caller's env leaks into psql.
      env: {
        PATH: process.env.PATH ?? "",
        PGPASSWORD: cfg.password,
        PGCONNECT_TIMEOUT: "10",
        PGAPPNAME: `linoe_pg_test:${label}`,
        LC_ALL: "C",
      },
      stdio: ["pipe", "pipe", "pipe"],
    };
    this.proc = spawn("psql", args, options);
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => {
      this.outBuf += chunk;
      this.drain();
    });
    this.proc.stderr.on("data", (chunk: string) => {
      this.errBuf += chunk;
      this.drain();
    });
    this.proc.stdin.on("error", () => {
      /* the process died; handled by "exit" */
    });
    this.exitPromise = new Promise((resolve) => {
      this.proc.on("exit", () => {
        this.closed = true;
        open.delete(this);
        for (const p of this.pending.splice(0)) {
          clearTimeout(p.timer);
          p.reject(new Error(`psql session "${this.label}" closed`));
        }
        resolve();
      });
      this.proc.on("error", (err) => {
        this.closed = true;
        for (const p of this.pending.splice(0)) {
          clearTimeout(p.timer);
          p.reject(err);
        }
        resolve();
      });
    });
    open.add(this);
  }

  static async open(cfg: PgConfig, label: string): Promise<PsqlSession> {
    const session = new PsqlSession(label, cfg);
    // Proves the connection works before any test statement.
    const ping = await session.exec("select 1;");
    if (ping.error) throw new Error(`psql session "${label}" could not connect: ${ping.error}`);
    return session;
  }

  private drain(): void {
    for (;;) {
      const head = this.pending[0];
      if (!head) return;
      const outAt = this.outBuf.indexOf(`${head.outMarker}\n`);
      const errAt = this.errBuf.indexOf(`${head.errMarker}\n`);
      if (outAt < 0 || errAt < 0) return;

      const rows = this.outBuf
        .slice(0, outAt)
        .split("\n")
        .filter((line) => line.length > 0);
      const stderr = this.errBuf.slice(0, errAt);
      this.outBuf = this.outBuf.slice(outAt + head.outMarker.length + 1);
      this.errBuf = this.errBuf.slice(errAt + head.errMarker.length + 1);
      this.pending.shift();
      clearTimeout(head.timer);

      const errorLine = stderr.split("\n").find((line) => /\b(ERROR|FATAL):/.test(line)) ?? null;
      head.resolve({ rows, error: errorLine ? errorLine.trim() : null });
    }
  }

  /**
   * Sends statements (each must end with ';') and resolves when psql has
   * finished all of them. A statement blocked on a lock keeps this pending.
   */
  exec(sql: string, timeoutMs = 20_000): Promise<ExecResult> {
    if (this.closed) return Promise.reject(new Error(`psql session "${this.label}" is closed`));
    const n = ++this.seq;
    const outMarker = `__LINOE_OUT_${n}__`;
    const errMarker = `__LINOE_ERR_${n}__`;
    return new Promise<ExecResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`psql session "${this.label}" timed out waiting for: ${sql.slice(0, 120)}`));
      }, timeoutMs);
      this.pending.push({ outMarker, errMarker, resolve, reject, timer });
      this.proc.stdin.write(`${sql}\n\\echo ${outMarker}\n\\warn ${errMarker}\n`);
    });
  }

  async backendPid(): Promise<number> {
    const result = await this.exec("select pg_backend_pid();");
    return Number(result.rows[0]);
  }

  /** Simulates a crashed client/process: the connection just disappears. */
  async crash(): Promise<void> {
    this.proc.kill("SIGKILL");
    await this.exitPromise;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    try {
      this.proc.stdin.write("\\q\n");
      this.proc.stdin.end();
    } catch {
      /* already gone */
    }
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3_000));
    await Promise.race([this.exitPromise, timeout]);
    if (!this.closed) {
      this.proc.kill("SIGKILL");
      await this.exitPromise;
    }
  }
}

export async function closeAllSessions(): Promise<void> {
  await Promise.all([...open].map((s) => s.close()));
}
