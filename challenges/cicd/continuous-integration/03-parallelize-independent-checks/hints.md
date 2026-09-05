Identify which operation occupies the timeline before the first useful failure. Then compare the independent lint and test durations.

---

Reordering steps keeps one worker serial. Splitting jobs allows overlap, but making packaging independent would spend time building rejected changes.

---

Prepare lint and test workers separately and make packaging depend on both. Check that changing one dependency does not accidentally serialize the validation workers or allow an early build.
