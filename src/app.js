// @ts-check

import fastify from "fastify";
import defaultBuildDataset from "@zazuko/k8s-rdf-exporter";
import { turtle } from "@tpluscode/rdf-string";

/**
 * Create the Fastify application, with all the routes registered.
 *
 * @param {object} options options for the application.
 * @param {import("@zazuko/k8s-rdf-exporter/dist/config.js").Config} options.config configuration for the exporter.
 * @param {import("fastify").FastifyServerOptions["logger"]} [options.logger] logger configuration, enabled by default.
 * @param {typeof defaultBuildDataset} [options.buildDataset] dataset builder, injectable for tests.
 * @returns {import("fastify").FastifyInstance} the configured application.
 */
export const createApp = ({ config, logger = true, buildDataset = defaultBuildDataset }) => {
  const app = fastify({ logger });

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

  return app;
};

export default createApp;
