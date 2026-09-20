import lodash from "lodash";

function denull(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item === null ? undefined : item]));
}

export function renderInvoiceLine(
  template: string,
  data: Record<string, unknown>,
  options?: Record<string, unknown>,
): string {
  const normalized = options === undefined ? undefined : { ...options, imports: denull(options.imports) };
  return lodash.template(template, normalized)(data);
}

