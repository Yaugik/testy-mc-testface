import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import type {
  ContainerEngine,
  ContainerHandle,
  ContainerRunSpec,
} from "./types.js";

const execFile = promisify(execFileCallback);

export class DockerCliContainerEngine implements ContainerEngine {
  public async run(spec: ContainerRunSpec): Promise<ContainerHandle> {
    const args = ["run", "--detach", "--name", spec.name];

    for (const [key, value] of Object.entries(spec.labels).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      args.push("--label", `${key}=${value}`);
    }

    for (const [key, value] of Object.entries(spec.environment).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      args.push("--env", `${key}=${value}`);
    }

    for (const mount of spec.mounts) {
      args.push(
        "--volume",
        `${mount.hostPath}:${mount.containerPath}${mount.readOnly ? ":ro" : ""}`,
      );
    }

    for (const port of spec.ports) {
      args.push("--publish", `${port.hostAddress}::${port.containerPort}`);
    }

    args.push(spec.image);
    const { stdout } = await runDocker(args);
    const id = stdout.trim();
    if (id.length === 0) {
      throw new Error("Docker did not return a container ID.");
    }
    return { id };
  }

  public async resolveHostPort(
    containerId: string,
    containerPort: number,
  ): Promise<number> {
    const { stdout } = await runDocker([
      "port",
      containerId,
      `${containerPort}/tcp`,
    ]);
    const firstLine = stdout.trim().split(/\r?\n/u)[0];
    if (!firstLine) {
      throw new Error(
        `Docker did not expose a host port for ${containerId}:${containerPort}.`,
      );
    }

    const match = /:(\d+)$/u.exec(firstLine);
    if (!match) {
      throw new Error(`Unable to parse Docker port output '${firstLine}'.`);
    }

    return Number(match[1]);
  }

  public async logs(containerId: string): Promise<string> {
    const { stdout, stderr } = await runDocker(["logs", containerId], true);
    return [stdout, stderr].filter((value) => value.length > 0).join("\n");
  }

  public async remove(containerId: string): Promise<void> {
    await runDocker(["rm", "--force", containerId], true);
  }
}

async function runDocker(
  args: readonly string[],
  tolerateFailure = false,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  try {
    return await execFile("docker", [...args], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    });
  } catch (error) {
    if (tolerateFailure) {
      return { stdout: "", stderr: getErrorText(error) };
    }
    throw new Error(`Docker command failed: docker ${args.join(" ")}\n${getErrorText(error)}`, {
      cause: error,
    });
  }
}

function getErrorText(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as { stderr?: unknown; message?: unknown };
    if (typeof candidate.stderr === "string" && candidate.stderr.length > 0) {
      return candidate.stderr;
    }
    if (typeof candidate.message === "string") {
      return candidate.message;
    }
  }
  return String(error);
}
