1. Use check mode with diff first so output includes the proposed file change.
2. Read each task result separately from the final recap.
3. Repeat the preview with `--limit web-01`; this removes the unreachable host but keeps the configuration failure visible.
