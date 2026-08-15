Call store.claim before the side effect. A false result means another invocation has already claimed the event.
---
Wrap the publish call so a failure releases the claim before the original error is rethrown.
