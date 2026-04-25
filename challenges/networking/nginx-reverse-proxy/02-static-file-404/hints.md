If the root page loads and the SPA shell exists on disk, a deep-link 404 usually means Nginx is treating client-side routes like missing files. Look closely at the `try_files` line.
