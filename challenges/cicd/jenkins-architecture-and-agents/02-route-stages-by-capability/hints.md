Inspect the earliest failed operation and compare its available inputs with the fixed scenario. Distinguish local files and authored settings from the state actually in use.

---

The current workflow sends both workloads to the same pool. An online agent is not necessarily capable of executing every step.

---

Repair Jenkinsfile so validation and the application build use Node-capable Linux agents, then transfer the generated application to a Docker-capable agent for packaging. Do not rebuild the application on the packaging agent.
