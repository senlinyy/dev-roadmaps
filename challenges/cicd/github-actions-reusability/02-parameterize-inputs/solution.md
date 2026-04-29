```yaml
inputs:
  node-version:
    description: "Node.js version to install"
    required: false
    default: '22'

runs:
  using: "composite"
  steps:
    - name: Setup Node
      uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
```

By declaring `node-version` as an input with a default of `22`, existing workflows do not break. New callers can override it with `with: { node-version: '18' }`. The `${{ inputs.node-version }}` expression resolves at runtime to the caller's value.
