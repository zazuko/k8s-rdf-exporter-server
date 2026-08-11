// @ts-check

import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { freePort } from "./kubectl.js";
import { parseTurtle } from "../../helpers/rdf.js";

const entrypoint = fileURLToPath(new URL("../../../src/index.js", import.meta.url));

/**
 * Start the server as a real child process, exactly the way `npm start` would.
 *
 * @param {Record<string, string>} env environment variables for the server, on top of PORT/HOST.
 * @returns {Promise<{
 *   url: string,
 *   output: () => string,
 *   stop: () => Promise<void>,
 * }>} handle on the running server.
 */
export const startServer = async (env) => {
  const port = await freePort();
  const child = spawn(process.execPath, [entrypoint], {
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  const stop = async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  };

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`the server exited before becoming ready:\n${output}`);
    }

    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) {
        return { url, output: () => output, stop };
      }
    } catch {
      // the server is not listening yet
    }

    await new Promise((resolve) => { setTimeout(resolve, 100); });
  }

  await stop();
  throw new Error(`the server did not become ready:\n${output}`);
};

/**
 * Run a function against a freshly started server, and stop the server afterwards.
 *
 * @template T
 * @param {Record<string, string>} env environment variables for the server.
 * @param {(server: { url: string, output: () => string }) => Promise<T>} run what to do with it.
 * @returns {Promise<T>} whatever `run` returned.
 */
export const withServer = async (env, run) => {
  const server = await startServer(env);
  try {
    return await run(server);
  } finally {
    await server.stop();
  }
};

/**
 * Fetch the RDF export and parse it.
 *
 * @param {string} url base URL of the server.
 * @returns {Promise<import("@zazuko/env/lib/Dataset.js").Dataset>} the exported dataset.
 */
export const fetchDataset = async (url) => {
  const response = await fetch(url);
  const body = await response.text();

  if (response.status !== 200) {
    throw new Error(`expected the export to succeed, got ${response.status}: ${body}`);
  }

  return parseTurtle(body);
};
