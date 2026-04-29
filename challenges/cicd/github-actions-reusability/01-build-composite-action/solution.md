```yaml
runs:
  using: "composite"
  steps:
    - name: Install Dependencies
      run: npm ci
      shell: bash
    - name: Run Build
      run: npm run build
      shell: bash
```

The `using: "composite"` declaration tells GitHub this is a multi-step action (not a Docker or JS action). The `shell: bash` requirement exists because composite actions are portable: the caller might be on any OS, so you must be explicit about which shell interprets your commands.
