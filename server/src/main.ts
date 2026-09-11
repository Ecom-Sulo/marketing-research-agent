/**
 * Process entry point: build the app, settle whatever the last process left
 * behind, and serve.
 */

import { serve } from "@hono/node-server";

import { createApp } from "./app.js";

const app = createApp();

// A run does not survive a restart now that the agent lives in this process, so
// anything still marked `running` is a corpse. Say so before serving, or the
// cockpit shows a run that will never move again.
app.supervisor.recover();

const server = serve(
  { fetch: app.fetch, hostname: app.settings.host, port: app.settings.port },
  (info) => {
    console.log(
      `marketing-research-agent listening on ${app.settings.host}:${info.port} ` +
        `(model ${app.settings.model})`,
    );
  },
);

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} — stopping`);
    server.close();
    void app.close().then(
      () => process.exit(0),
      (error) => {
        console.error("shutdown failed", error);
        process.exit(1);
      },
    );
  });
}
