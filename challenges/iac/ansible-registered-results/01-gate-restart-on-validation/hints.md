The validation task needs to finish without being marked changed or failed so the next task can inspect its registered `rc` field. The service task should read that field in a condition.
