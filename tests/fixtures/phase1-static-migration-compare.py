"""Static, read-only comparison; this never connects to or modifies a database.

Checks the current CREATE-only test fixture against the init migration, the
known attributes-default change in the second migration, and the SQL block in
the unexecuted Phase 1 proposal. It is deliberately not a migration planner,
SQL parser, data-compatibility check, or proof that applying the draft succeeds.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
initial = (ROOT / "prisma/migrations/20261119171130_init/migration.sql").read_text()
normalize = (ROOT / "prisma/migrations/20261120050000_normalize_variant_attributes/migration.sql").read_text()
proposal_file = (ROOT / "docs/proposals/PHASE_1_ORDER_INVENTORY_MIGRATION.md").read_text()
fixture = (ROOT / "tests/fixtures/phase1-disposable-schema.sql").read_text()
match = re.search(r"```sql\s*(.*?)\s*```", proposal_file, re.S)
assert match, "Missing proposal SQL block"
proposal = match.group(1)
assert re.search(r'ALTER\s+TABLE\s+"ProductVariant"\s+ALTER\s+COLUMN\s+"attributes"\s+SET\s+DEFAULT\s+\'\[\]\'::jsonb\s*;', normalize, re.I)


def compact(value):
    # The fixture adds explicit ::jsonb casts and uppercases boolean keywords;
    # those are equivalent for these default literals. Keep quoted text intact.
    value = re.sub(r"::jsonb\b", "", value, flags=re.I)
    return "".join(part if part.startswith("'") else re.sub(r"\s+", "", part).upper()
                   for part in re.split(r"('(?:[^']|'')*')", value))


def tables(sql):
    result = {}
    for table, body in re.findall(r'CREATE\s+TABLE\s+"([^"]+)"\s*\((.*?)\n\);', sql, re.I | re.S):
        fields = {}
        for line in body.splitlines():
            column = re.match(r'\s*"([^"]+)"\s+(.+?)\s*,?\s*$', line)
            if column:
                fields[column.group(1)] = compact(column.group(2).rstrip(","))
        if table in result:
            raise AssertionError(f"Duplicate table {table}")
        result[table] = fields
    return result


def enums(sql):
    return {name: re.findall(r"'([^']*)'", values) for name, values in re.findall(
        r'CREATE\s+TYPE\s+"([^"]+)"\s+AS\s+ENUM\s*\((.*?)\)\s*;', sql, re.I | re.S)}


def indexes(sql):
    values = re.findall(r'CREATE\s+(UNIQUE\s+)?INDEX\s+"([^"]+)"\s+ON\s+"([^"]+)"\s*\(([^)]*)\)\s*;', sql, re.I | re.S)
    result = {}
    for unique, name, table, columns in values:
        assert name not in result, f"Duplicate index {name}"
        result[name] = (bool(unique.strip()), table, compact(columns))
    return result


def owner_at(sql, position):
    blocks = list(re.finditer(r'CREATE\s+TABLE\s+"([^"]+)"\s*\(.*?\n\);', sql, re.I | re.S))
    blocks += list(re.finditer(r'ALTER\s+TABLE\s+"([^"]+)"\s+.*?;', sql, re.I | re.S))
    matches = [block.group(1) for block in blocks if block.start() <= position < block.end()]
    assert len(matches) == 1, f"Cannot identify constraint owner at offset {position}"
    return matches[0]


def primary_keys(sql):
    return {match.group(1): (owner_at(sql, match.start()), compact(match.group(2))) for match in re.finditer(
        r'CONSTRAINT\s+"([^"]+)"\s+PRIMARY\s+KEY\s*\(([^)]*)\)', sql, re.I | re.S)}


def foreign_keys(sql):
    action = r'(?:CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)'
    pattern = (r'CONSTRAINT\s+"([^"]+)"\s+FOREIGN\s+KEY\s*\(([^)]*)\)\s*'
               r'REFERENCES\s+"([^"]+)"\s*\(([^)]*)\)\s*ON\s+DELETE\s+(' + action + r')\s+ON\s+UPDATE\s+(' + action + r')')
    result = {}
    for match in re.finditer(pattern, sql, re.I | re.S):
        name, columns, table, target, delete, update = match.groups()
        assert name not in result, f"Duplicate foreign key {name}"
        result[name] = (owner_at(sql, match.start()), compact(columns), table, compact(target), compact(delete), compact(update))
    return result


def checks(sql):
    result = {}
    for match in re.finditer(r'CONSTRAINT\s+"([^"]+)"\s+CHECK\s*\(', sql, re.I):
        name, start = match.group(1), match.end() - 1
        depth, quote, end = 0, False, None
        for i in range(start, len(sql)):
            ch = sql[i]
            if ch == "'":
                quote = not quote
            elif not quote and ch == "(":
                depth += 1
            elif not quote and ch == ")":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        assert end is not None and name not in result, f"Malformed or duplicate CHECK {name}"
        result[name] = (owner_at(sql, match.start()), compact(sql[start:end]))
    return result


def compare(name, expected, actual):
    if expected != actual:
        missing = sorted(set(expected) - set(actual))
        extra = sorted(set(actual) - set(expected))
        changed = sorted(key for key in set(expected) & set(actual) if expected[key] != actual[key])
        raise AssertionError(f"{name}: missing={missing}, extra={extra}, differing={changed}")
    print(f"{name}: {len(expected)} match")


baseline_tables, proposed_tables, fixture_tables = tables(initial), tables(proposal), tables(fixture)
assert set(proposed_tables) == {"ReturnReceipt", "OwnDelivery", "OwnDeliveryEvent", "CourierOperation"}
expected_tables = {name: dict(fields) for name, fields in baseline_tables.items()}
expected_tables["ProductVariant"]["attributes"] = compact("JSONB NOT NULL DEFAULT '[]'")
expected_tables.update(proposed_tables)
added = []
for table, statement in re.findall(r'ALTER\s+TABLE\s+"([^"]+)"\s+(.*?);', proposal, re.I | re.S):
    for column, definition in re.findall(r'ADD\s+COLUMN\s+"([^"]+)"\s+([^,\n]+)', statement, re.I):
        assert table in expected_tables and column not in expected_tables[table], f"Unexpected added column {table}.{column}"
        expected_tables[table][column] = compact(definition)
        added.append(f"{table}.{column}")
assert set(added) == {"ProductVariant.damagedStock", "Order.cancellationReason", "Order.cancellationStockReleasedAt",
                      "StockMovement.bucket", "StockMovement.returnReceiptId"}
compare("tables and columns (type, nullability, default)", expected_tables, fixture_tables)
compare("enums and value order", {**enums(initial), **enums(proposal)}, enums(fixture))
compare("primary keys", {**primary_keys(initial), **primary_keys(proposal)}, primary_keys(fixture))
compare("indexes, uniqueness and column order", {**indexes(initial), **indexes(proposal)}, indexes(fixture))
compare("foreign keys and referential actions", {**foreign_keys(initial), **foreign_keys(proposal)}, foreign_keys(fixture))
compare("additional CHECK expressions", checks(proposal), checks(fixture))
print("Static comparison only; no migration or database operation was performed.")
