Use a map when each resource has a natural stable name. The map key becomes the instance identity, while the object value can carry the availability zone and subnet number.

---

Every expression inside the resource should follow the keyed iterator. Leaving one `count.index` expression behind preserves the identity problem.
