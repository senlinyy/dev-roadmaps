Read the first failing job's log, then locate the executable used by the test script in the laptop record. Is it supplied by the project or by the developer's machine?

---

Compare the manifest with the approved lockfile. Changing installation commands cannot make inconsistent dependency records agree, and changing the script would hide the problem.

---

After restoring the dependency declaration, build the complete locked lint/test/build sequence. Check both failure cases: working installation is a prerequisite, not the final objective.
