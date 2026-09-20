import lodash from "lodash";

export function renderInvoiceLine(data: Record<string, unknown>, options?: { imports?: Record<string, unknown> }): string {
  const imports = options?.imports ?? { currency: "$" };
  // The product supports one currency string, not arbitrary compiler options.
  if (Object.keys(imports).some((key) => key !== "currency") || typeof imports.currency !== "string") {
    throw new Error("Unsupported imports option");
  }
  return lodash.template("Total: <%= currency %><%= amount %>", { imports: { currency: imports.currency } })(data);
}
