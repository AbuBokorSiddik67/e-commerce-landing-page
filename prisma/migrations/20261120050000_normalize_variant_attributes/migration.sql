-- Older seeds and the former JSON default stored variant attributes as an
-- object. Preserve each key and value while converting to the array shape used
-- by the product form and validation. Existing arrays are left untouched.
UPDATE "ProductVariant" AS variant
SET "attributes" = (
    SELECT COALESCE(
        jsonb_agg(jsonb_build_object('name', attribute.key, 'value', attribute.value) ORDER BY attribute.key),
        '[]'::jsonb
    )
    FROM jsonb_each(variant."attributes") AS attribute
)
WHERE jsonb_typeof(variant."attributes") = 'object';

-- All future variants, including inserts that omit attributes, use that shape.
ALTER TABLE "ProductVariant" ALTER COLUMN "attributes" SET DEFAULT '[]'::jsonb;
