## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### scripts/recover.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${PREVIOUS_IMAGE:?Set the approved previous image@sha256}"
[[ "$PREVIOUS_IMAGE" =~ @sha256:[a-f0-9]{64}$ ]]
(cd backup && shasum -a 256 -c jenkins-home.tar.sha256)
if docker volume inspect orders-jenkins-recovery >/dev/null 2>&1; then
  echo 'Recovery volume already exists; inspect it manually.' >&2
  exit 1
fi
if docker container inspect orders-jenkins-recovery >/dev/null 2>&1; then
  echo 'Recovery container already exists; inspect it manually.' >&2
  exit 1
fi
docker volume create orders-jenkins-recovery >/dev/null
docker run --rm --user root --entrypoint sh \
  --mount type=volume,src=orders-jenkins-recovery,dst=/restore \
  --mount "type=bind,src=$PWD/backup,dst=/backup,readonly" \
  "$PREVIOUS_IMAGE" -c 'tar -xpf /backup/jenkins-home.tar -C /restore'
docker run -d --name orders-jenkins-recovery -p 127.0.0.1:18080:8080 \
  --env-file recovery-secrets.env \
  --mount type=volume,src=orders-jenkins-recovery,dst=/var/jenkins_home \
  "$PREVIOUS_IMAGE"
docker logs orders-jenkins-recovery
```

## Why this works

Controller rollback is a restoration of a compatible image/plugin/state set. Take a consistent backup while Jenkins is stopped or using a documented consistent snapshot mechanism. Restore into a separate volume so failure evidence survives. Rehearse with a non-production controller and a harmless representative pipeline; do not enable release jobs until external effects and credentials have been reviewed.

## Verification and expected evidence

Use a disposable backup whose archive paths are relative to JENKINS_HOME and whose credentials/key material is included securely. Supply protected recovery-secrets.env and the previous immutable image. Confirm startup, administrator login, plugin load and a non-deploying sample job before switching traffic. Verify the failed controller volume still exists. A checksum proves archive integrity, not that the backup was trustworthy.

## Self-review

- [ ] Recovery uses the prior image and a matched pre-upgrade state archive.
- [ ] The failed volume remains intact for investigation.
- [ ] An existing recovery volume or container causes a stop rather than destructive overwrite.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://www.jenkins.io/doc/book/system-administration/backing-up/)
- [Official reference 2](https://www.jenkins.io/doc/book/upgrade-guide/)
