Inspect the earliest failed operation and compare its available inputs with the fixed scenario. Distinguish local files and authored settings from the state actually in use.

---

The global step executes before installing dependencies, the helper returns a lint command instead of building, and the resource points at packaging.

---

Repair all three layers: vars owns checkout/install and execution order; src/com/acme/Commands.groovy supplies the build command; resources/com/acme/unit.txt supplies the unit command. Keep the consumer thin, run lint and tests before building, and archive the package.
