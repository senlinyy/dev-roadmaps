## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### scripts/scan.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${IMAGE:?Set registry image by digest}"
[[ "$IMAGE" =~ @sha256:[a-f0-9]{64}$ ]]
mkdir -p reports
trivy image --format cyclonedx --output reports/sbom.cdx.json "$IMAGE"
trivy image --ignorefile .trivyignore.yaml --severity HIGH,CRITICAL --format json --output reports/vulnerabilities.json --exit-code 1 "$IMAGE"
```

### .trivyignore.yaml

```yaml
vulnerabilities: []
```

## Why this works

A release policy must state which severity and exception rules apply. SBOM generation inventories components; it does not establish that no vulnerabilities exist. Scan a digest so the result is tied to bytes. An exception needs a real finding ID, rationale, accountable owner and expiry; the default policy grants none. Store reports even when the gate fails, and treat scanner failure as inability to establish safety.

## Verification and expected evidence

On a runner with the approved Trivy distribution, run the script for known healthy and vulnerable fixture images. Publish reports with an always-running artifact step in the surrounding workflow. Review a proposed exception separately; do not fabricate a vulnerability ID to obtain a green run.

## Self-review

- [ ] Blocking findings produce a failed gate.
- [ ] JSON scan results and an SBOM are retained on failure.
- [ ] Exceptions require an identified vulnerability, owner, reason and future expiry; none are silently preapproved.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://trivy.dev/latest/docs/configuration/filtering/)
