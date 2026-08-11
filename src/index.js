// @ts-check

import { createApp } from "./app.js";
import { buildConfigFromEnv, buildServerOptionsFromEnv } from "./config.js";

const { port, host } = buildServerOptionsFromEnv();
const app = createApp({ config: buildConfigFromEnv() });

app.listen({ port, host }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }

  app.log.info(`Server listening at ${address}`);
});
