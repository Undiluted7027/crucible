/** The one advisory with a reviewed explanation and replay. Adding a case means adding an entry here and a capsule. */
export const invoiceAdvisory = {
  id: "GHSA-r5fr-rjxr-66jc",
  package: "lodash",
  symbols: ["template"],
  summary: "Untrusted imports option keys can become JavaScript in a compiled lodash template.",
  condition: "The application must pass attacker-controlled imports keys into template compilation. Merely installing lodash does not establish this condition.",
  action: "Inspect the options argument to lodash.template. Replay the curated invoice case to compare a reproduction, a feature-breaking patch, and an application-level guard.",
  capsule: "invoice",
} as const;

export const catalog = [invoiceAdvisory];
