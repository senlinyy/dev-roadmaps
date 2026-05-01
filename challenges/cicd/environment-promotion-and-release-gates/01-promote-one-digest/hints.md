The build job already has a `digest` step. Promote that value through `jobs.build.outputs`, then consume `needs.build.outputs.image_digest` in both deploy jobs. Production needs both `build` and `deploy-staging` if it reads the build output directly.

