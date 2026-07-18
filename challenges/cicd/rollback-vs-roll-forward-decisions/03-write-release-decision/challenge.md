---
title: "Write the Release Decision"
sectionSlug: putting-it-all-together
order: 3
---

The incident notes show that the canary was missing `DISCOUNT_RULES_URL` while stable task set `orders-api:41` stayed healthy. Maya chose a traffic revert because the previous task set was healthy. A patch forward was rejected because artifact code was not the first cause, and redeploying the previous artifact was unnecessary because stable was already serving traffic.

Your task:

1. **Set the decision type** to `traffic revert`.
2. **Explain why traffic revert fit** using the healthy previous task set.
3. **Record both evidence facts** from the incident notes.
4. **Capture the rejected `patch_forward` option** with the stated reason and record Maya as owner.

The grader checks the release decision record.
