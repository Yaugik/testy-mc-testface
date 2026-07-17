import { startTrafficGateway } from "@testy/traffic-gateway";

import { loadTrafficGatewayConfig } from "./config.js";

const config = loadTrafficGatewayConfig();
const gateway = await startTrafficGateway({
  host: config.host,
  port: config.port,
  adminToken: config.adminToken,
  allowedTargetOrigins: config.allowedTargetOrigins,
  ...(config.blockedProviderHosts.length > 0
    ? { blockedProviderHosts: config.blockedProviderHosts }
    : {}),
});

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await gateway.stop();
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
process.stdout.write(`${JSON.stringify({ service: "traffic-gateway", origin: gateway.origin })}
`);
