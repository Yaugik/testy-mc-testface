const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const suppliedAttributionHeaders = new Set([
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
  "x-client-ip",
  "true-client-ip",
  "cf-connecting-ip",
]);

export function prepareForwardHeaders(
  incoming: Headers,
  syntheticIp: string,
  sourceProtocol: "http" | "https",
): Headers {
  const outgoing = new Headers();
  for (const [name, value] of incoming.entries()) {
    const normalized = name.toLowerCase();
    if (
      hopByHopHeaders.has(normalized) ||
      suppliedAttributionHeaders.has(normalized) ||
      normalized === "host" ||
      normalized === "content-length" ||
      normalized.startsWith("x-testy-")
    ) {
      continue;
    }
    outgoing.append(name, value);
  }
  outgoing.set("x-forwarded-for", syntheticIp);
  outgoing.set("x-forwarded-proto", sourceProtocol);
  outgoing.set("forwarded", `for=${syntheticIp};proto=${sourceProtocol}`);
  return outgoing;
}

export function prepareResponseHeaders(incoming: Headers): Headers {
  const outgoing = new Headers();
  for (const [name, value] of incoming.entries()) {
    const normalized = name.toLowerCase();
    if (hopByHopHeaders.has(normalized) || normalized === "content-length") continue;
    outgoing.append(name, value);
  }
  return outgoing;
}
