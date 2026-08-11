// @ts-check

import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Run a `kubectl` command.
 *
 * @param {string[]} args arguments to pass to kubectl.
 * @param {object} [options] options.
 * @param {string} [options.input] content to pipe to kubectl stdin.
 * @param {boolean} [options.allowFailure] resolve instead of throwing when kubectl exits non-zero.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} the result of the command.
 */
export const kubectl = async (args, { input, allowFailure = false } = {}) => {
  try {
    const { stdout, stderr } = await execFileAsync("kubectl", args, {
      input,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = /** @type {{ code?: number, stdout?: string, stderr?: string, message: string }} */ (error);
    if (!allowFailure) {
      throw new Error(
        `kubectl ${args.join(" ")} failed:\n${failure.stderr || failure.message}`,
        { cause: error },
      );
    }
    return {
      code: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message,
    };
  }
};

/**
 * Make sure a cluster is reachable, and fail with an actionable message otherwise.
 *
 * @returns {Promise<void>}
 */
export const requireCluster = async () => {
  const { code, stderr } = await kubectl(["get", "--raw", "/readyz"], { allowFailure: true });
  if (code !== 0) {
    throw new Error(
      "The end-to-end tests need a reachable Kubernetes cluster.\n"
      + "Start one and point KUBECONFIG at it, see test/README.md.\n"
      + `kubectl said: ${stderr.trim()}`,
    );
  }
};

/**
 * Apply manifests to the cluster.
 *
 * @param {string} path path of the file or kustomization to apply.
 * @param {object} [options] options.
 * @param {boolean} [options.kustomize] treat the path as a kustomization directory.
 * @param {boolean} [options.serverSide] use a server-side apply, which does not add a
 *   `kubectl.kubernetes.io/last-applied-configuration` annotation to the resources.
 * @returns {Promise<void>}
 */
export const apply = async (path, { kustomize = false, serverSide = false } = {}) => {
  await kubectl([
    "apply",
    kustomize ? "-k" : "-f",
    path,
    ...(serverSide ? ["--server-side", "--force-conflicts"] : []),
  ]);
};

/**
 * Delete manifests from the cluster, waiting for the resources to be gone.
 *
 * Failures are ignored: this is used in cleanup hooks, where a missing resource is not a problem.
 *
 * @param {string} path path of the file or kustomization to delete.
 * @param {object} [options] options.
 * @param {boolean} [options.kustomize] treat the path as a kustomization directory.
 * @returns {Promise<void>}
 */
export const remove = async (path, { kustomize = false } = {}) => {
  await kubectl([
    "delete",
    kustomize ? "-k" : "-f",
    path,
    "--ignore-not-found",
    "--wait=true",
    "--timeout=120s",
  ], { allowFailure: true });
};

/**
 * Wait for a deployment to be rolled out.
 *
 * @param {string} namespace namespace of the deployment.
 * @param {string} name name of the deployment.
 * @param {string} [timeout] kubectl timeout expression.
 * @returns {Promise<void>}
 */
export const waitForRollout = async (namespace, name, timeout = "180s") => {
  const { code, stderr } = await kubectl(
    ["-n", namespace, "rollout", "status", `deployment/${name}`, `--timeout=${timeout}`],
    { allowFailure: true },
  );

  if (code !== 0) {
    // Surface what the cluster thinks is wrong: a failing rollout is otherwise painful to debug
    // from CI logs alone.
    const { stdout: pods } = await kubectl(
      ["-n", namespace, "get", "pods", "-o", "wide"],
      { allowFailure: true },
    );
    const { stdout: events } = await kubectl(
      ["-n", namespace, "get", "events", "--sort-by=.lastTimestamp"],
      { allowFailure: true },
    );
    const { stdout: logs } = await kubectl(
      ["-n", namespace, "logs", `deployment/${name}`, "--all-containers", "--tail=50"],
      { allowFailure: true },
    );

    throw new Error(
      `deployment/${name} did not roll out: ${stderr.trim()}\n\n`
      + `Pods:\n${pods}\nEvents:\n${events}\nLogs:\n${logs}`,
    );
  }
};

/**
 * Create a short-lived token for a service account.
 *
 * @param {string} namespace namespace of the service account.
 * @param {string} name name of the service account.
 * @returns {Promise<string>} the token.
 */
export const createToken = async (namespace, name) => {
  const { stdout } = await kubectl(["-n", namespace, "create", "token", name, "--duration=1h"]);
  return stdout.trim();
};

/**
 * Read a value out of the current kubeconfig context.
 *
 * @param {string} jsonpath jsonpath expression, applied to the minified kubeconfig.
 * @returns {Promise<string>} the value.
 */
const kubeconfigValue = async (jsonpath) => {
  const { stdout } = await kubectl(["config", "view", "--minify", "--raw", "-o", `jsonpath=${jsonpath}`]);
  return stdout.trim();
};

/**
 * Get the URL of the Kubernetes API server of the current context.
 *
 * @returns {Promise<string>} the API server URL.
 */
export const apiUrl = () => kubeconfigValue("{.clusters[0].cluster.server}");

/**
 * Get the name of the cluster of the current context, as the Kubernetes client sees it.
 *
 * @returns {Promise<string>} the cluster name.
 */
export const kubeconfigClusterName = () => kubeconfigValue("{.clusters[0].name}");

/**
 * Write a PEM bundle from the current kubeconfig to a file, and return its path.
 *
 * @param {string} jsonpath jsonpath of the base64-encoded PEM data.
 * @param {string} filename name of the file to write.
 * @returns {Promise<string>} path of the written file.
 */
const writePem = async (jsonpath, filename) => {
  const data = await kubeconfigValue(jsonpath);
  if (!data) {
    throw new Error(`no PEM data found in the kubeconfig at ${jsonpath}`);
  }

  const path = join(tmpdir(), `k8s-rdf-exporter-e2e-${filename}`);
  await writeFile(path, Buffer.from(data, "base64"));
  return path;
};

/**
 * Write the certificate authority of the cluster to a file.
 *
 * @returns {Promise<string>} path of the CA file.
 */
export const writeClusterCa = () => writePem("{.clusters[0].cluster.certificate-authority-data}", "ca.crt");

/**
 * Write a valid PEM certificate that is *not* the certificate authority of the cluster.
 *
 * The client certificate of the kubeconfig fits: it is a well-formed certificate, so the exporter
 * gets far enough to actually verify the API server against it, and fails.
 *
 * @returns {Promise<string>} path of the unrelated certificate file.
 */
export const writeUnrelatedCa = () => writePem("{.users[0].user.client-certificate-data}", "unrelated-ca.crt");

/**
 * Find a free TCP port on the loopback interface.
 *
 * @returns {Promise<number>} the port number.
 */
export const freePort = async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("could not determine a free port");
  }

  await new Promise((resolve) => server.close(resolve));
  return address.port;
};

/**
 * Forward a local port to a service of the cluster.
 *
 * @param {string} namespace namespace of the service.
 * @param {string} service name of the service.
 * @param {number} remotePort port of the service.
 * @returns {Promise<{ url: string, stop: () => Promise<void> }>} the local URL and a stop function.
 */
export const portForward = async (namespace, service, remotePort) => {
  const localPort = await freePort();
  const child = spawn(
    "kubectl",
    ["-n", namespace, "port-forward", `service/${service}`, `${localPort}:${remotePort}`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  const stop = async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  };

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (output.includes("Forwarding from")) {
      return { url: `http://127.0.0.1:${localPort}`, stop };
    }
    if (child.exitCode !== null) {
      throw new Error(`port-forward to service/${service} exited early:\n${output}`);
    }
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  }

  await stop();
  throw new Error(`port-forward to service/${service} did not become ready:\n${output}`);
};
