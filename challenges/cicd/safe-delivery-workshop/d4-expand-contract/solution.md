## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### db/expand.sql

```sql
BEGIN;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS display_name text;
CREATE OR REPLACE FUNCTION mirror_customer_name() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.display_name := NEW.name;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS customers_name_bridge ON customers;
CREATE TRIGGER customers_name_bridge BEFORE INSERT OR UPDATE OF name ON customers
FOR EACH ROW EXECUTE FUNCTION mirror_customer_name();
UPDATE customers SET display_name = name WHERE display_name IS NULL;
COMMIT;
```

### db/read-customer.sql

```sql
SELECT id, COALESCE(display_name, name) AS display_name FROM customers WHERE id = 1;
```

### db/contract.sql

```sql
BEGIN;
ALTER TABLE customers ALTER COLUMN display_name SET NOT NULL;
DROP TRIGGER customers_name_bridge ON customers;
DROP FUNCTION mirror_customer_name();
ALTER TABLE customers DROP COLUMN name;
COMMIT;
```

## Why this works

An additive schema lets old and new applications coexist. This bridge explicitly makes name authoritative until cutover, avoiding ambiguous two-way synchronization. Contract is a separate irreversible boundary: old queries and writes stop working after column removal. A tested rollback before contract does not establish rollback safety afterward.

## Verification and expected evidence

Load evidence/schema.sql in a disposable PostgreSQL database, apply expand.sql, insert/update through name, and run read-customer.sql. Confirm the old SELECT name query still works. For contract, first stop old writers, deploy a final query using only display_name and switch all writes to display_name; then run contract.sql during the approved cutover. The training table is tiny; large production backfills need batching and lock/statement timeouts.

## Self-review

- [ ] Old writes populate the new column during coexistence.
- [ ] New reads work before and after backfill while old queries remain valid.
- [ ] Dropping the old column is delayed until old binaries and writers are retired.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://www.postgresql.org/docs/current/sql-altertable.html)
- [Official reference 2](https://www.postgresql.org/docs/current/sql-createtrigger.html)
