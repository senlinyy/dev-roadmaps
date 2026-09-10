Inspect the earliest failed operation and compare its available inputs with the fixed scenario. Distinguish local files and authored settings from the state actually in use.

---

The assigned labels and enabled executor slots no longer expose usable Node capacity. Broadening the pipeline to any agent risks landing on an unsuitable worker.

---

Inspect the node inventory, restore useful Node capacity through agent-settings.yaml, and split validation from packaging in Jenkinsfile. Keep controller executors at zero and preserve all nodes. Each worker's safeExecutors is a measured limit.
