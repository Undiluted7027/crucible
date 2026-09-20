import express from "express";
import { renderInvoiceLine } from "./render.js";

const app = express();
app.use(express.json({ limit: "32kb" }));
app.get("/healthz", (_request, response) => response.json({ status: "ready" }));
app.post("/invoices/preview", (request, response) => {
  // Templates are server-owned; the test varies only the imports options.
  if (request.body.template !== undefined) {
    response.status(400).send("Client templates are not supported");
    return;
  }
  try {
    response.type("text/plain").send(renderInvoiceLine(request.body.data ?? {}, request.body.options));
  } catch (error) {
    response.status(500).type("text/plain").send(error instanceof Error ? error.message : "Render failed");
  }
});
const server = app.listen(3000, "0.0.0.0");
process.on("SIGTERM", () => server.close());
