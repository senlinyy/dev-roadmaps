The gate belongs on the job that needs production credentials, not on a manual shell step. `concurrency` belongs at workflow level here because the whole production release path should be serialized.

