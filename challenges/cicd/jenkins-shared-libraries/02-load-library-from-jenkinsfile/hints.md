Load the shared library before any pipeline code runs, pin it to the release in the prompt, and reduce the Jenkinsfile to a call into the library with the service-specific settings.
