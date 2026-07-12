---
title: "Repair the Fast SSD Profile"
sectionSlug: assembled-example
order: 1
---

The platform StorageClass for production PostgreSQL has its stable identity and CSI driver but is missing the reviewed production policy. Build the profile contract before application teams use it.

Your job:

1. **Keep API version `storage.k8s.io/v1`, kind `StorageClass`, name `fast-ssd`, and provisioner `csi.example.com`**.
2. **Build the provider parameter map** with type `ssd` and encrypted set to the string `"true"`.
3. **Build the lifecycle and scheduling policy** with reclaim policy `Delete`, expansion set to boolean `true`, and binding mode `WaitForFirstConsumer`.
4. **Mark the class as non-default** with annotation `storageclass.kubernetes.io/is-default-class` set to the string `"false"`.

The grader checks every named StorageClass field and exact literal in the parsed YAML.
