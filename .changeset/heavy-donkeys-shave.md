---
"@zazuko/k8s-rdf-exporter-server": patch
---

Add a startup probe to the Kubernetes deployment: the liveness probe used to run while the server
was still starting, and could restart the container before it ever answered a request.
