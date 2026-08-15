1. Register the command task under a descriptive variable name.
2. Reference `.rc` in `failed_when` and keep the command read-only.
3. Use an assert task to consume `.stdout` from the same registered result.
