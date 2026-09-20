import lodash from "lodash";

export function renderInvoiceLine(data: Record<string, unknown>): string {
  // A tempting repair removes the whole feature. The euro control catches it.
  return lodash.template("Total: $<%= amount %>")(data);
}
