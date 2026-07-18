import { gatewayError } from "./errors.js";

const documentationPrefixes = new Set(["192.0.2", "198.51.100", "203.0.113"]);

export function isReservedSyntheticIpv4(value: string): boolean {
  const octets = value.split(".");
  if (octets.length !== 4) return false;
  const numbers = octets.map((octet) => Number(octet));
  if (numbers.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  return documentationPrefixes.has(numbers.slice(0, 3).join("."));
}

export function assertReservedSyntheticIpv4(value: string): void {
  if (!isReservedSyntheticIpv4(value)) {
    throw gatewayError(
      "synthetic-ip-not-reserved",
      400,
      "Synthetic visitor IP must be inside an RFC 5737 documentation range.",
    );
  }
}
