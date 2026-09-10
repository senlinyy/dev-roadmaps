Inspect the earliest failed operation and compare its available inputs with the fixed scenario. Distinguish local files and authored settings from the state actually in use.

---

The image omits configuration, plugins float outside the tested set, and promotion has no boot or smoke evidence.

---

Reconstruct the image with the exact catalog-tested lab-core-2 and lab-2 plugin set. Install plugins, copy JCasC, wire CASC_JENKINS_CONFIG, preserve external administrator-secret references, then build, boot, smoke-test and promote.
