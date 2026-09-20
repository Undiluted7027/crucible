import { spawn } from "node:child_process";

/** One external command to run. Output is bounded and the command is killed at its deadline. */
export interface ProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin?: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly env?: NodeJS.ProcessEnv;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly outputTruncated: boolean;
}

/** Keeps only the last `limit` bytes. The end of a failing command's output is what explains the failure. */
class TailBuffer {
  private retained = Buffer.alloc(0);
  private didTruncate = false;

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError("Output limit must be a positive integer");
  }

  append(chunk: Buffer): void {
    const combined = Buffer.concat([this.retained, chunk]);
    if (combined.byteLength > this.limit) {
      this.didTruncate = true;
      this.retained = combined.subarray(combined.byteLength - this.limit);
      return;
    }
    this.retained = combined;
  }

  result(): { text: string; truncated: boolean } {
    return { text: this.retained.toString("utf8"), truncated: this.didTruncate };
  }
}

/**
 * Runs a command without a shell, so arguments are never interpreted. Never rejects for a non-zero exit; it
 * reports `exitCode`, `timedOut` and `outputTruncated` and lets the caller decide. It rejects only if the command
 * cannot be started. On timeout the process gets SIGTERM, then SIGKILL one second later.
 */
export async function runProcess(request: ProcessRequest): Promise<ProcessResult> {
  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(request.command, [...request.args], {
      env: request.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = new TailBuffer(request.maxOutputBytes);
    const stderr = new TailBuffer(request.maxOutputBytes);
    let timedOut = false;

    child.stdout.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));
    child.on("error", reject);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    }, request.timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      const retainedStdout = stdout.result();
      const retainedStderr = stderr.result();
      resolve({
        exitCode: code ?? -1,
        stdout: retainedStdout.text,
        stderr: retainedStderr.text,
        timedOut,
        outputTruncated: retainedStdout.truncated || retainedStderr.truncated,
      });
    });

    if (request.stdin === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(request.stdin);
    }
  });
}

/**
 * Runs a command and returns its stdout. Throws unless it exited 0 before its deadline with untruncated output,
 * so callers never parse partial data.
 */
export async function runChecked(request: ProcessRequest): Promise<string> {
  const result = await runProcess(request);
  if (result.exitCode !== 0 || result.timedOut || result.outputTruncated) {
    const reason = result.timedOut ? "timed out" : result.outputTruncated ? "output exceeded its limit" : `exited ${result.exitCode}`;
    throw new Error(`${request.command} ${request.args[0] ?? ""} failed (${reason}): ${result.stderr.slice(-1000).trim()}`);
  }
  return result.stdout;
}
