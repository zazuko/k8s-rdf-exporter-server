// @ts-check

import { defaultBaseIri, defaultBaseIriOci } from "@zazuko/k8s-rdf-exporter/dist/config.js";

/**
 * Build the configuration for the Kubernetes RDF exporter out of environment variables.
 *
 * Note that `clusterName`, `apiUrl`, `serviceToken` and `certificatePath` are only taken into
 * account by the exporter if *all* of them are set: if any of them is missing, the exporter falls
 * back to the default Kubernetes configuration (in-cluster service account, or kubeconfig file).
 *
 * @param {Record<string, string | undefined>} [env] environment to read from, defaults to `process.env`.
 * @returns {import("@zazuko/k8s-rdf-exporter/dist/config.js").Config} configuration for the exporter.
 */
export const buildConfigFromEnv = (env = process.env) => ({
  clusterName: env.CLUSTER_NAME || "k8s-cluster",
  baseIri: env.BASE_IRI || defaultBaseIri,
  baseIriOci: env.BASE_IRI_OCI || defaultBaseIriOci,
  namespaces: env.NAMESPACES ? env.NAMESPACES.split(",").map((ns) => ns.trim()) : undefined,
  generateNamespaces: env.GENERATE_NAMESPACES === "true",

  skipTLSVerify: env.SKIP_TLS_VERIFY === "true",
  namespace: env.NAMESPACE,
  apiUrl: env.API_URL,
  serviceToken: env.SERVICE_TOKEN,
  certificatePath: env.CERTIFICATE_PATH,
});

/**
 * Build the server options out of environment variables.
 *
 * @param {Record<string, string | undefined>} [env] environment to read from, defaults to `process.env`.
 * @returns {{ port: number, host: string }} options for the HTTP server.
 */
export const buildServerOptionsFromEnv = (env = process.env) => ({
  port: parseInt(env.PORT || "3000", 10),
  host: env.HOST || "0.0.0.0",
});
