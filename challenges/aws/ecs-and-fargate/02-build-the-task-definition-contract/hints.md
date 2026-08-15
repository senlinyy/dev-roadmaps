The execution role lets ECS pull images, fetch injected secrets, and publish logs. The task role is what application code receives. Secrets belong in containerDefinitions[].secrets, not environment.
