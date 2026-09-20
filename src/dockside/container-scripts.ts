/**
 * Small Node scripts that Crucible runs inside a container with `docker exec <container> node -e <script> [args]`.
 * They are plain CommonJS JavaScript (not TypeScript) because they run in the container's own Node, use only
 * built-in modules, and read their arguments from `process.argv[1..]`.
 *
 * Probe scripts exit 0 when the action was denied (the safe outcome) and 2 when it succeeded, so a probe that fails
 * to run is never mistaken for a pass. container-scripts.test.ts runs them against a local server.
 */

/**
 * Args: `<timeoutMs> <host:port> [<host:port> ...]`.
 * Exit 0 only if every TCP connection is refused, errors, or times out; exit 2 if any connects.
 */
export const tcpDeniedScript = `
const net = require("node:net");
const [timeoutMs, ...targets] = process.argv.slice(1);

function denied(target) {
  const [host, port] = target.split(":");
  return new Promise((resolve) => {
    const socket = net.connect(Number(port), host);
    const finish = (wasDenied) => {
      socket.destroy();
      resolve(wasDenied);
    };
    socket.setTimeout(Number(timeoutMs), () => finish(true));
    socket.on("error", () => finish(true));
    socket.on("connect", () => finish(false));
  });
}

Promise.all(targets.map(denied)).then((results) => process.exit(results.every(Boolean) ? 0 : 2));
`;

/** No args. Exit 0 if an HTTPS request to the public internet fails within 2.5 seconds; exit 2 if it succeeds. */
export const internetDeniedScript = `
fetch("https://example.com", { signal: AbortSignal.timeout(2500) }).then(
  () => process.exit(2),
  () => process.exit(0),
);
`;

/** Args: `<path>`. Exit 0 if the path does not exist inside the container; exit 2 if it does. */
export const pathAbsentScript = `
process.exit(require("node:fs").existsSync(process.argv[1]) ? 2 : 0);
`;

/** Args: `<path>`. Writes everything read from stdin to that file. */
export const writeStdinToFileScript = `
const fs = require("node:fs");
fs.writeFileSync(process.argv[1], fs.readFileSync(0));
`;

/**
 * Sends one HTTP POST and prints `{ status, body, durationMs }` as JSON. Stdin is `{ "url": ..., "body": ... }`.
 * Runs in the trusted management container, never the target, so the target cannot write the evaluator's
 * expectations. Redirects are refused, and the request fails after 5 seconds or once the response exceeds
 * 8192 characters. Failure prints the reason to stderr and exits 1.
 */
export const postJsonScript = `
const fs = require("node:fs");
const { url, body } = JSON.parse(fs.readFileSync(0, "utf8"));
const maxResponseChars = 8192;
const start = Date.now();

fetch(url, {
  method: "POST",
  redirect: "error",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(5000),
})
  .then(async (response) => {
    let text = "";
    for await (const chunk of response.body) {
      text += Buffer.from(chunk).toString();
      if (text.length > maxResponseChars) throw new Error("Response too large");
    }
    console.log(JSON.stringify({ status: response.status, body: text, durationMs: Date.now() - start }));
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
`;
