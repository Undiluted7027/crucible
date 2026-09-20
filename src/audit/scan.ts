import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";
import { z } from "zod";
import { catalog } from "./catalog.js";

// npm audit report format v2. Anything else, including an npm error document, is rejected rather than read as "no findings".
const advisorySchema = z.object({
  source: z.union([z.number(), z.string()]),
  name: z.string().optional(),
  title: z.string(),
  url: z.string(),
  severity: z.string(),
  range: z.string().optional(),
});
const auditSchema = z.object({
  auditReportVersion: z.literal(2),
  vulnerabilities: z.record(z.string(), z.object({
    severity: z.string(),
    isDirect: z.boolean(),
    via: z.array(z.union([z.string(), advisorySchema])),
    range: z.string(),
    nodes: z.array(z.string()).default([]),
    fixAvailable: z.union([z.boolean(), z.object({ name: z.string(), version: z.string(), isSemVerMajor: z.boolean() })]),
  })),
});

export interface CallSite {
  package: string;
  symbol: string;
  file: string;
  line: number;
}

const ignoredDirectories = new Set(["node_modules", "dist", "build", "coverage", ".git", ".crucible", "vendor"]);

// Walk root files too. Symlinks are intentionally not followed.
export async function sourceFiles(root: string): Promise<string[]> {
  const paths: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) await walk(path);
      else if (entry.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) paths.push(path);
    }
  }
  await walk(root);
  return paths.sort();
}

function packageName(specifier: string): string | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return undefined;
  return specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
}

// These are syntactic call-site candidates, not a call graph or proof of execution.
export function inspectSource(text: string, file: string): CallSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const imports = new Map<string, { package: string; symbol?: string }>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const pkg = packageName(statement.moduleSpecifier.text);
    if (!pkg) continue;
    const clause = statement.importClause;
    if (clause?.isTypeOnly) continue;
    if (clause?.name) imports.set(clause.name.text, { package: pkg });
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) imports.set(bindings.name.text, { package: pkg });
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        if (!binding.isTypeOnly) imports.set(binding.name.text, { package: pkg, symbol: (binding.propertyName ?? binding.name).text });
      }
    }
  }
  const calls: CallSite[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const binding = ts.isIdentifier(expression) ? imports.get(expression.text)
        : ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)
          ? imports.get(expression.expression.text) : undefined;
      if (binding) calls.push({
        package: binding.package,
        symbol: ts.isPropertyAccessExpression(expression) ? expression.name.text : binding.symbol ?? "default",
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return calls;
}

/**
 * Turns an npm audit report into findings, one per affected package. An advisory is matched to a reviewed capsule by
 * its stable GHSA id and package name, never by title. Findings that only inherit from another package, and
 * advisories with no capsule, are kept and marked UNSUPPORTED, so nothing is dropped or declared safe.
 */
export function parseAudit(input: unknown, calls: readonly CallSite[]) {
  const audit = auditSchema.parse(input);
  return Object.entries(audit.vulnerabilities).map(([name, vulnerability]) => ({
    package: name,
    ...vulnerability,
    advisories: vulnerability.via.flatMap((via) => {
      if (typeof via === "string") return [];
      const id = via.url.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i)?.[0];
      const supported = catalog.find((entry) => entry.id === id && entry.package === name);
      const candidates = calls.filter((call) => call.package === name && supported?.symbols.some((symbol) => symbol === call.symbol));
      return [{ ...via, id: id ?? String(via.source), capsule: supported?.capsule ?? null, candidates,
        assessment: supported ? (candidates.length ? "CALL_SITE_CANDIDATE" : "NEEDS_REVIEW") : "UNSUPPORTED" }];
    }),
    inheritedFrom: vulnerability.via.filter((via) => typeof via === "string"),
  }));
}

export type ScanReport = Awaited<ReturnType<typeof scan>>;

/** Reads the repository's source for call sites and combines them with the audit report. Executes nothing. */
export async function scan(root: string, input: unknown) {
  const files = await sourceFiles(root);
  const calls: CallSite[] = [];
  for (const file of files) calls.push(...inspectSource(await readFile(file, "utf8"), relative(root, file)));
  return { schemaVersion: 1, recordedAt: new Date().toISOString(), sourceFiles: files.length,
    scope: "ES module call-site candidates only. No taint, runtime reachability, CommonJS, alias or shadowing analysis. Missing calls do not establish non-applicability. Curated replay does not test this repository.",
    findings: parseAudit(input, calls) };
}
