import lodash from "lodash";

export function renderInvoiceLine(data: Record<string, unknown>, options?: { imports?: Record<string, unknown> }): string {
  const imports = Object.fromEntries(Object.entries(options?.imports ?? { currency: "$" })
    .map(([key, value]) => [key, value === null ? undefined : value]));
  return lodash.template("Total: <%= currency %><%= amount %>", { imports })(data);
}
