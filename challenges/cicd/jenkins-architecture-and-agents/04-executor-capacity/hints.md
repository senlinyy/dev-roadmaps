Inspect the earliest failed operation and compare its available inputs with the fixed scenario. Distinguish local files and authored settings from the state actually in use.

---

The pipeline is sequential and the enabled worker cannot safely gain more executors. Increasing a slot count would not create memory or CPU.

---

Enable the existing second Node worker in agent-settings.yaml and restructure Jenkinsfile so lint and unit tests overlap on distinct allocations. Build only after the checks join. Publish unit reports even when tests fail.
