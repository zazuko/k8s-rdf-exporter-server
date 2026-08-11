# @zazuko/k8s-rdf-exporter-server

## 0.0.3

### Patch Changes

- 25d0f32: Upgrade base image to use node 24
- 5aa405d: Add a startup probe to the Kubernetes deployment: the liveness probe used to run while the server
  was still starting, and could restart the container before it ever answered a request.

## 0.0.2

### Patch Changes

- 7ab33a9: Upgrade k8s-rdf-exporter to 0.4.0

## 0.0.1

### Patch Changes

- de9adae: Provide some useful logs in case of issue instead of crashing the server
- a62bf4d: Bump `@zazuko/k8s-rdf-exporter` to 0.3.5
