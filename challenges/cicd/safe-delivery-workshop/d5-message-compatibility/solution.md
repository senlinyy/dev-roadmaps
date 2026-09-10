## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### db/worker.sql

```sql
CREATE TABLE IF NOT EXISTS processed_events(event_id text PRIMARY KEY, processed_at timestamptz NOT NULL DEFAULT now());
```

### worker/consume.py

```python
import json

def process(body, connection):
    item = json.loads(body)
    version = item.get("version", 1)
    if version not in (1, 2):
        raise ValueError("Unsupported message version")
    amount = item["total_cents"] if version == 1 else item["amount_cents"]
    if type(amount) is not int or amount <= 0:
        raise ValueError("Invalid amount")
    event_id, order_id = item["event_id"], item["order_id"]
    if not isinstance(event_id, str) or not event_id or not isinstance(order_id, str) or not order_id:
        raise ValueError("Missing identity")
    with connection.transaction():
        inserted = connection.execute(
            "INSERT INTO processed_events(event_id) VALUES (%s) ON CONFLICT DO NOTHING RETURNING event_id",
            (event_id,),
        ).fetchone()
        if inserted is None:
            return "duplicate"
        connection.execute(
            "INSERT INTO orders(id,total_cents) VALUES (%s,%s)", (order_id, amount)
        )
    return "committed"
```

## Why this works

At-least-once delivery requires idempotency at the business effect, not just in memory. Recording the event and inserting the order in one database transaction closes the crash gap between them. Version compatibility handles messages already queued before deployment. This transaction covers PostgreSQL only; external payments require an outbox/idempotency design rather than claiming one SQL transaction controls every side effect.

## Verification and expected evidence

Install the pinned psycopg dependency in a local virtual environment, create the supplied orders table and worker table, and call process using a psycopg connection opened with autocommit=True. Feed each evidence message; there must be two orders. Raise a database error and confirm neither event marker nor order commits. In the existing queue poller call DeleteMessage only after process returns; errors must leave the message unacknowledged. Keep visibility timeout above bounded processing time and configure a dead-letter policy. Run `DATABASE_URL=... python test/worker_test.py` in that environment for executable redelivery, transaction rollback and unknown-version tests. Tests use temporary tables and do not mutate permanent application tables.

## Self-review

- [ ] Legacy and version-2 payloads produce the same order representation.
- [ ] Duplicate event IDs cannot repeat the transactional database effect.
- [ ] Failed parsing or database work does not acknowledge the message.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://www.psycopg.org/psycopg3/docs/basic/transactions.html)
- [Official reference 2](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html)
