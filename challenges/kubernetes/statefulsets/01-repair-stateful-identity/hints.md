Create the headless Service reference, selector, Pod template metadata, and per-ordinal claim pattern under the StatefulSet spec. Use one workload identity across the relationship.

---

The claim template is a list under the StatefulSet spec. Its metadata names the volume that each ordinal Pod will receive.
