import express, { type NextFunction, type Request, type Response } from "express";
import { renderInvoiceLine } from "./render.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.get("/healthz", (_request, response) => {
  response.json({ status: "ready" });
});

app.post("/invoices/preview", (request, response) => {
  const body: unknown = request.body;
  const record = typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const data = typeof record.data === "object" && record.data !== null && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : {};
  const options = typeof record.options === "object" && record.options !== null && !Array.isArray(record.options)
    ? record.options as Record<string, unknown>
    : undefined;
  response.type("text/plain").send(renderInvoiceLine(String(record.template ?? ""), data, options));
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unhandled target error";
  console.error(message);
  response.status(500).type("text/plain").send(message);
});

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, "0.0.0.0", () => console.log(`invoice target listening on ${port}`));

function shutdown(): void {
  server.close((error) => {
    if (error !== undefined) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

