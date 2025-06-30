// @ts-check

import fastify from "fastify";
import buildDataset from "@zazuko/k8s-rdf-exporter";
import { turtle } from "@tpluscode/rdf-string";
import { defaultBaseIri, defaultBaseIriOci } from "@zazuko/k8s-rdf-exporter/dist/config.js";

const app = fastify({
  logger: true,
});

const port = parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "0.0.0.0";

/**
 * Configuration for the Kubernetes RDF exporter.
 *
 * @type {import("@zazuko/k8s-rdf-exporter/dist/config.js").Config}
 */
const config = {
  clusterName: process.env.CLUSTER_NAME || "k8s-cluster",
  baseIri: process.env.BASE_IRI || defaultBaseIri,
  baseIriOci: process.env.BASE_IRI_OCI || defaultBaseIriOci,
  namespaces: process.env.NAMESPACES ? process.env.NAMESPACES.split(",").map((ns) => ns.trim()) : undefined,

  skipTLSVerify: process.env.SKIP_TLS_VERIFY === "true",
  namespace: process.env.NAMESPACE,
  apiUrl: process.env.API_URL,
  serviceToken: process.env.SERVICE_TOKEN,
  certificatePath: process.env.CERTIFICATE_PATH,
};

// Health check endpoint
app.get("/healthz", async (_request, reply) => {
  return reply.status(200).send({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// Get Kubernetes state as RDF
app.get("/", async (_request, reply) => {
  try {
    const dataset = await buildDataset(config);
    const ttl = turtle`${dataset}`.toString();
    return reply.status(200).header("content-type", "text/turtle").send(ttl);
  } catch (error) {
    app.log.error(error);
    return reply.status(500).send({
      status: "error",
      message: "Unable to retrieve Kubernetes state. Please check the logs for more details.",
    });
  }
});

app.listen({ port, host }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }

  app.log.info(`Server listening at ${address}`);
});
