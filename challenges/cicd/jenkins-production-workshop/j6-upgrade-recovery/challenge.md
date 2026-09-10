---
title: "Recover a failed controller upgrade from a matched snapshot"
sectionSlug: recover-a-failed-controller-upgrade-from-a-matched-snapshot
order: 6
revision: 1
---

## Description

After a Jenkins upgrade, the controller rejects an installed plugin. The previous image and a pre-upgrade archive are available, but the failed controller has already modified its volume; starting the old image against that state could make recovery worse.

As the Jenkins maintainer, prepare a guarded recovery script that restores a matched image and state without destroying incident evidence.

## Requirements

1. **Matched Recovery Inputs**. Use the previous pinned controller image together with its pre-upgrade state archive.
2. **Fresh Recovery Storage**. Restore into a new, empty named volume and leave the failed controller’s volume intact for investigation.
3. **Overwrite Protection**. Stop if the intended recovery volume or container already exists rather than deleting or overwriting it.
4. **Restricted Verification**. Keep network exposure local until administrator login and a representative job have been verified.

:::expand[Workspace and verification]{kind="note"}

Editable files: `scripts/recover.sh`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
