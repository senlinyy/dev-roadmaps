### `publish-api.yaml`

```yaml
openapi: 3.0.1
info:
  title: Northstar Publish API
  version: 1.0.0
paths:
  /lessons/{lessonId}/publish:
    post:
      operationId: publishLesson
      parameters:
        - name: lessonId
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - publishedBy
              properties:
                publishedBy:
                  type: string
      responses:
        "202":
          description: Publish accepted
        "400":
          description: Invalid publish request
      x-amazon-apigateway-integration:
        type: aws_proxy
        httpMethod: POST
        payloadFormatVersion: "2.0"
        uri: arn:aws:apigateway:eu-west-2:lambda:path/2015-03-31/functions/arn:aws:lambda:eu-west-2:123456789012:function:publish-lesson/invocations
```
