### pipeline.yaml

```yaml
version: 1
jobs:
  ci:
    steps:
      - checkout: true
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

### package.json

```json
{
  "name": "checkout-service",
  "private": true,
  "scripts": {
    "lint": "eslint .",
    "test": "vitest run",
    "build": "vite build"
  },
  "devDependencies": {
    "eslint": "9.0.0",
    "vitest": "3.0.0",
    "vite": "6.0.0"
  }
}
```

The laptop's globally installed vitest concealed the missing project dependency. The repaired manifest agrees with the supplied lock, so a clean worker can install the approved tools without relying on the laptop.

One installation serves all steps in this job. Lint and unit tests precede packaging, so repairing the missing tool does not leave the rest of validation absent. Inspect installed versions and confirm that both authored failures stop before build.
