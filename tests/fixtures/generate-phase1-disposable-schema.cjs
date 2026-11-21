/*
 * Generate a CREATE-only schema for a brand-new, identity-verified disposable
 * PostgreSQL test cluster. This is a test fixture, NOT a migration, and this
 * script never connects to a database. It deliberately does not read or run
 * prisma/migrations or the proposed ALTER statements.
 *
 * Uses the official Prisma WASM metadata package at the repository's Prisma
 * version. Fixture-only CHECKs below mirror the separately reviewed proposal.
 */
const fs = require("node:fs");
const path = require("node:path");
const { getDMMF } = require("@prisma/internals");

const source = fs.readFileSync(path.resolve("prisma/schema.prisma"), "utf8");
const q = (value) => `"${String(value).replaceAll('"', '""')}"`;
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const checks = {
  ProductVariant: ['CONSTRAINT "ProductVariant_damagedStock_nonnegative" CHECK ("damagedStock" >= 0)'],
  ReturnReceipt: [
    'CONSTRAINT "ReturnReceipt_quantity_positive" CHECK ("receivedQuantity" > 0)',
    'CONSTRAINT "ReturnReceipt_inspection_split" CHECK (("inspectedAt" IS NULL AND "sellableQuantity" IS NULL AND "damagedQuantity" IS NULL) OR ("inspectedAt" IS NOT NULL AND "sellableQuantity" IS NOT NULL AND "damagedQuantity" IS NOT NULL AND "sellableQuantity" >= 0 AND "damagedQuantity" >= 0 AND "sellableQuantity"::BIGINT + "damagedQuantity"::BIGINT = "receivedQuantity"))',
  ],
  StockMovement: ['CONSTRAINT "StockMovement_receipt_bucket_shape" CHECK (("returnReceiptId" IS NULL AND "bucket" = \'SELLABLE\') OR ("returnReceiptId" IS NOT NULL AND "type" = \'RETURN\' AND "quantity" > 0 AND "reference" IS NOT NULL))'],
  CourierOperation: [
    'CONSTRAINT "CourierOperation_kind_check" CHECK ("kind" = \'CANCEL\')',
    'CONSTRAINT "CourierOperation_status_check" CHECK ("status" IN (\'AWAITING_RESULT\', \'OUTCOME_UNKNOWN\', \'RECONCILIATION_REQUIRED\', \'RECONCILED\'))',
  ],
};

function column(field) {
  if (field.dbName || field.nativeType || field.isList) throw new Error(`Unsupported mapped/native/list field: ${field.name}`);
  const scalar = { String: "TEXT", Int: "INTEGER", Boolean: "BOOLEAN", DateTime: "TIMESTAMP(3)", Json: "JSONB" };
  const type = field.kind === "enum" ? q(field.type) : scalar[field.type];
  if (!type) throw new Error(`Unsupported scalar type: ${field.type}`);
  let result = `${q(field.name)} ${type}${field.isRequired ? " NOT NULL" : ""}`;
  if (field.hasDefaultValue) {
    const value = field.default;
    if (value && typeof value === "object") {
      if (value.name === "now") result += " DEFAULT CURRENT_TIMESTAMP";
      else if (value.name !== "cuid") throw new Error(`Unsupported default function: ${value.name}`);
      // Prisma supplies cuid IDs client-side; they have no database default.
    } else if (field.type === "Json") result += ` DEFAULT ${literal(value)}::jsonb`;
    else if (typeof value === "string") result += ` DEFAULT ${literal(value)}`;
    else if (typeof value === "number" || typeof value === "boolean") result += ` DEFAULT ${String(value).toUpperCase()}`;
    else throw new Error(`Unsupported default for ${field.name}`);
  }
  return result;
}

async function main() {
  const dmmf = await getDMMF({ datamodel: source });
  const models = dmmf.datamodel.models;
  if (models.some((model) => model.dbName)) throw new Error("Mapped model names require explicit fixture review");
  const pending = new Map(models.map((model) => [model.name, model]));
  const ordered = [];
  while (pending.size) {
    const ready = [...pending.values()].filter((model) => model.fields
      .filter((field) => field.kind === "object" && field.relationFromFields?.length && field.type !== model.name)
      .every((field) => !pending.has(field.type)));
    if (!ready.length) throw new Error(`Relation cycle requires explicit fixture review: ${[...pending.keys()].join(", ")}`);
    for (const model of ready) { ordered.push(model); pending.delete(model.name); }
  }
  const sql = ["-- CREATE-only test fixture for a brand-new, verified disposable cluster.",
    "-- Generated from Prisma metadata; NOT a migration and never for an existing database."];
  for (const item of dmmf.datamodel.enums) {
    sql.push(`CREATE TYPE ${q(item.name)} AS ENUM (${item.values.map((value) => literal(value.name)).join(", ")});`);
  }
  for (const model of ordered) {
    const fields = model.fields.filter((field) => field.kind !== "object");
    const parts = fields.map(column);
    const primary = model.primaryKey?.fields ?? fields.filter((field) => field.isId).map((field) => field.name);
    if (primary.length) parts.push(`CONSTRAINT ${q(`${model.name}_pkey`)} PRIMARY KEY (${primary.map(q).join(", ")})`);
    for (const relation of model.fields.filter((field) => field.kind === "object" && field.relationFromFields?.length)) {
      const action = { Cascade: "CASCADE", SetNull: "SET NULL", Restrict: "RESTRICT", NoAction: "NO ACTION" };
      const onDelete = action[relation.relationOnDelete ?? (relation.isRequired ? "Restrict" : "SetNull")];
      const onUpdate = action[relation.relationOnUpdate ?? "Cascade"];
      if (!onDelete || !onUpdate) throw new Error(`Unsupported relation action: ${model.name}.${relation.name}`);
      parts.push(`CONSTRAINT ${q(`${model.name}_${relation.relationFromFields.join("_")}_fkey`)} FOREIGN KEY (${relation.relationFromFields.map(q).join(", ")}) REFERENCES ${q(relation.type)} (${relation.relationToFields.map(q).join(", ")}) ON DELETE ${onDelete} ON UPDATE ${onUpdate}`);
    }
    parts.push(...(checks[model.name] ?? []));
    sql.push(`CREATE TABLE ${q(model.name)} (\n  ${parts.join(",\n  ")}\n);`);
    for (const field of fields.filter((item) => item.isUnique)) {
      sql.push(`CREATE UNIQUE INDEX ${q(`${model.name}_${field.name}_key`)} ON ${q(model.name)} (${q(field.name)});`);
    }
    for (const unique of model.uniqueIndexes) {
      sql.push(`CREATE UNIQUE INDEX ${q(`${model.name}_${unique.fields.join("_")}_key`)} ON ${q(model.name)} (${unique.fields.map(q).join(", ")});`);
    }
    const block = source.match(new RegExp(`^model ${model.name} \\{([\\s\\S]*?)^\\}`, "m"));
    if (!block) throw new Error(`Missing model source for ${model.name}`);
    for (const match of block[1].matchAll(/@@index\(\[([^\]]+)\]\)/g)) {
      const columns = match[1].split(",").map((value) => value.trim());
      if (columns.some((name) => !fields.some((field) => field.name === name))) throw new Error(`Unsupported index on ${model.name}`);
      sql.push(`CREATE INDEX ${q(`${model.name}_${columns.join("_")}_idx`)} ON ${q(model.name)} (${columns.map(q).join(", ")});`);
    }
  }
  const output = path.resolve("tests/fixtures/phase1-disposable-schema.sql");
  fs.writeFileSync(output, `${sql.join("\n\n")}\n`);
  console.log(`Wrote CREATE-only fixture with ${ordered.length} models and ${dmmf.datamodel.enums.length} enums: ${output}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
