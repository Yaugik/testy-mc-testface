import { relative, sep } from "node:path";

import type { LoadedVendorPackage } from "@testy/config-loader";
import type {
  AuthenticationStrategy,
  OperationCaseDefinition,
  ResponseDefinition,
  SystemStateDefinition,
  TransportFaultDefinition,
} from "@testy/vendor-schema";

import { canonicalJson } from "./canonical-json.js";
import { VendorCompilationError, type CompilationIssue } from "./errors.js";
import { createBundleId, sha256 } from "./hash.js";
import { compileRequestMatchers } from "./matchers.js";
import {
  createStatefulStoreLayout,
  createStorePreloadData,
  renderStatefulCaseScript,
  requiresStatefulExecution,
  type StatefulStoreLayout,
} from "./stateful-script.js";
import {
  DEFAULT_IMPOSTER_IMAGE,
  IMPOSTER_CONFIG_DIRECTORY,
  IMPOSTER_CONTAINER_PORT,
  IMPOSTER_STATUS_PATH,
  IMPOSTER_STORE_PATH,
  TESTY_CORRELATION_HEADER,
  VENDOR_COMPILER_VERSION,
  type BundleFileDescriptor,
  type CompileVendorBundleOptions,
  type CompiledVendorBundle,
  type CompilerWarning,
  type GeneratedBundleFile,
  type SourceMapEntry,
  type VendorBundleManifest,
} from "./types.js";

interface ImposterResource extends Record<string, unknown> {
  readonly path: string;
  readonly method?: string;
  readonly response?: Readonly<Record<string, unknown>>;
}

interface CompiledResource {
  readonly resource: ImposterResource;
  readonly scriptFile?: GeneratedBundleFile;
}

export function compileVendorBundle(
  loaded: LoadedVendorPackage,
  options: CompileVendorBundleOptions = {},
): CompiledVendorBundle {
  const runtimeImage = options.runtimeImage ?? DEFAULT_IMPOSTER_IMAGE;
  const issues: CompilationIssue[] = [];
  const warnings: CompilerWarning[] = [];

  validateRuntimeImage(runtimeImage, issues, warnings);
  validateTransportFaults(loaded, issues, warnings);
  validateStateTargets(loaded, issues);

  const sourceMapEntries: SourceMapEntry[] = [];
  const resources: ImposterResource[] = [];
  const generatedScripts: GeneratedBundleFile[] = [];
  const initialStateDefinition = loaded.systemCasesFile.value.states[
    loaded.systemCasesFile.value.initialState
  ] as SystemStateDefinition;
  const stateful = requiresStatefulExecution(loaded.executionModel);
  const stores = stateful
    ? createStatefulStoreLayout(loaded.executionModel, options.runNamespace)
    : undefined;

  if (loaded.executionModel.authentication.length > 0) {
    resources.push(createPermittedSystemResource("GET", IMPOSTER_STATUS_PATH));
    sourceMapEntries.push({
      resourceIndex: resources.length - 1,
      vendorId: loaded.executionModel.vendor.id,
      sourceFile: normalizePath(relative(loaded.rootDir, loaded.vendorFile.filePath)),
      sourcePointer: "/authentication",
      generatedPointer: `/resources/${resources.length - 1}`,
    });

    if (stateful) {
      resources.push(createPermittedSystemResource(undefined, `${IMPOSTER_STORE_PATH}/*`));
    }
  }

  for (const operation of loaded.executionModel.operations) {
    const operationFile = loaded.operationFiles.find(
      (candidate) => candidate.value.operationId === operation.id,
    );
    if (!operationFile) {
      throw new Error(`Operation source file not found for '${operation.id}'.`);
    }

    for (const operationCase of operation.cases) {
      const compiled = compileCaseResource(
        loaded,
        operation.id,
        operation.method,
        operation.path,
        operationCase,
        initialStateDefinition,
        stateful,
        stores,
        issues,
      );
      resources.push(compiled.resource);
      if (compiled.scriptFile) {
        generatedScripts.push(compiled.scriptFile);
      }

      const caseIndex = operationFile.value.cases.findIndex(
        (candidate) => candidate.id === operationCase.id,
      );
      sourceMapEntries.push({
        resourceIndex: resources.length - 1,
        vendorId: loaded.executionModel.vendor.id,
        operationId: operation.id,
        caseId: operationCase.id,
        sourceFile: normalizePath(relative(loaded.rootDir, operationFile.filePath)),
        sourcePointer: `/cases/${caseIndex}`,
        generatedPointer: `/resources/${resources.length - 1}`,
        ...(compiled.scriptFile
          ? { generatedScript: compiled.scriptFile.relativePath }
          : {}),
      });
    }
  }

  const fallbackScript = stateful
    ? createFallbackScript(loaded, stores as StatefulStoreLayout)
    : undefined;
  if (fallbackScript) {
    generatedScripts.push(fallbackScript);
  }

  for (const fallbackPath of fallbackPaths(loaded.executionModel.server.basePath)) {
    resources.push({
      path: fallbackPath,
      log: `TESTY_UNMATCHED vendor=${loaded.executionModel.vendor.id} correlation=\${context.request.headers.${TESTY_CORRELATION_HEADER}}`,
      response: fallbackScript
        ? { scriptFile: stripImposterPrefix(fallbackScript.relativePath) }
        : compileStaticResponse(
            loaded.executionModel.routing.unmatchedRequest,
            initialStateDefinition,
          ),
    });
    sourceMapEntries.push({
      resourceIndex: resources.length - 1,
      vendorId: loaded.executionModel.vendor.id,
      sourceFile: normalizePath(relative(loaded.rootDir, loaded.vendorFile.filePath)),
      sourcePointer: "/routing/unmatchedRequest",
      generatedPointer: `/resources/${resources.length - 1}`,
      ...(fallbackScript
        ? { generatedScript: fallbackScript.relativePath }
        : {}),
    });
  }

  if (issues.length > 0) {
    throw new VendorCompilationError(issues);
  }

  addAuthenticationWarnings(loaded.executionModel.authentication, warnings);

  const imposterConfig: Readonly<Record<string, unknown>> = {
    plugin: "rest",
    contentType: loaded.executionModel.server.defaultContentType,
    ...(stateful && stores
      ? {
          system: {
            stores: createStorePreloadData(loaded.executionModel, stores),
          },
        }
      : {}),
    ...(loaded.executionModel.authentication.length > 0
      ? { security: compileSecurity(loaded.executionModel.authentication) }
      : {}),
    resources,
  };

  const configContent = Buffer.from(canonicalJson(imposterConfig), "utf8");
  const assetFiles: GeneratedBundleFile[] = loaded.assets.map((asset) => ({
    relativePath: `imposter/${asset.relativePath}`,
    content: asset.content,
    sha256: asset.sha256,
    byteLength: asset.byteLength,
  }));
  const configFile = makeFile("imposter/vendor-config.json", configContent);
  const preliminaryFiles = [
    configFile,
    ...assetFiles,
    ...generatedScripts,
  ].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const bundleId = createBundleId([
    VENDOR_COMPILER_VERSION,
    loaded.contentHash,
    runtimeImage,
    options.runNamespace ?? "",
    ...preliminaryFiles.map((file) => `${file.relativePath}:${file.sha256}`),
  ]);

  const sourceMap = {
    schemaVersion: "1.0" as const,
    entries: sourceMapEntries,
  };
  const sourceMapFile = makeFile(
    "source-map.json",
    Buffer.from(canonicalJson(sourceMap), "utf8"),
  );

  const descriptors: BundleFileDescriptor[] = [...preliminaryFiles, sourceMapFile]
    .map(({ relativePath, sha256: fileHash, byteLength }) => ({
      relativePath,
      sha256: fileHash,
      byteLength,
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const sequenceDeclared = loaded.executionModel.operations.some((operation) =>
    operation.cases.some((operationCase) => operationCase.sequence !== undefined),
  );
  const mutationDeclared = loaded.executionModel.operations.some((operation) =>
    operation.cases.some(
      (operationCase) =>
        (operationCase.effects?.stores?.length ?? 0) > 0 ||
        (operationCase.sequence?.steps.some(
          (step) => (step.effects?.stores?.length ?? 0) > 0,
        ) ??
          false),
    ),
  );

  const manifest: VendorBundleManifest = {
    schemaVersion: "1.0",
    bundleId,
    compilerVersion: VENDOR_COMPILER_VERSION,
    vendor: {
      id: loaded.executionModel.vendor.id,
      contractVersion: loaded.executionModel.vendor.contractVersion,
    },
    sourceContentHash: loaded.contentHash,
    runtime: {
      engine: "imposter",
      image: runtimeImage,
      containerPort: IMPOSTER_CONTAINER_PORT,
      configMountPath: IMPOSTER_CONFIG_DIRECTORY,
      statusPath: IMPOSTER_STATUS_PATH,
      storePath: IMPOSTER_STORE_PATH,
    },
    endpoint: { basePath: loaded.executionModel.server.basePath },
    state: {
      execution: stateful ? "scripted-stores" : "static",
      initialState: loaded.executionModel.system.initialState,
      ...(stores ? { stores } : {}),
    },
    capabilities: {
      authentication:
        loaded.executionModel.authentication.length > 0
          ? "native-security-policy"
          : "none",
      requestMatching: [
        "path-parameters",
        "query-parameters",
        "request-headers",
        "form-parameters",
        "raw-body",
        "equal",
        "not-equal",
        "exists",
        "not-exists",
        "contains",
        "regex",
      ],
      responseFeatures: [
        "status",
        "headers",
        "content-type",
        "file-body",
        "exact-delay",
        ...(stateful ? ["generated-javascript"] : []),
      ],
      transportFaults: ["close-connection", "timeout-via-delayed-close"],
      stateTransitions:
        loaded.executionModel.system.transitions.length > 0
          ? "scripted-store"
          : "none-declared",
      responseSequences: sequenceDeclared
        ? "scripted-store"
        : "none-declared",
      storeMutations: mutationDeclared
        ? "scripted-store"
        : "none-declared",
      callLedger: "structured-log-correlation",
    },
    files: descriptors,
    warnings,
  };
  const manifestFile = makeFile(
    "manifest.json",
    Buffer.from(canonicalJson(manifest), "utf8"),
  );

  return {
    bundleId,
    manifest,
    sourceMap,
    imposterConfig,
    files: [...preliminaryFiles, sourceMapFile, manifestFile].sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath),
    ),
  };
}

function compileCaseResource(
  loaded: LoadedVendorPackage,
  operationId: string,
  method: string,
  operationPath: string,
  operationCase: OperationCaseDefinition,
  initialState: SystemStateDefinition,
  stateful: boolean,
  stores: StatefulStoreLayout | undefined,
  issues: CompilationIssue[],
): CompiledResource {
  const context = { operationId, caseId: operationCase.id };
  const matchers = compileRequestMatchers(operationCase.when, context, issues);
  const resourceBase = {
    path: joinHttpPath(loaded.executionModel.server.basePath, operationPath),
    method,
    ...matchers,
    log: `TESTY_MATCH vendor=${loaded.executionModel.vendor.id} operation=${operationId} case=${operationCase.id} correlation=\${context.request.headers.${TESTY_CORRELATION_HEADER}}`,
  };

  if (stateful && stores) {
    const scriptRelativePath = `imposter/generated/${safeFilePart(operationId)}--${safeFilePart(operationCase.id)}.js`;
    const scriptContent = Buffer.from(
      renderStatefulCaseScript({
        vendorId: loaded.executionModel.vendor.id,
        operationId,
        caseId: operationCase.id,
        initialState: loaded.systemCasesFile.value.initialState,
        states: loaded.systemCasesFile.value.states,
        transitions: loaded.systemCasesFile.value.transitions ?? [],
        operationCase,
        stores,
      }),
      "utf8",
    );

    return {
      resource: {
        ...resourceBase,
        response: {
          scriptFile: stripImposterPrefix(scriptRelativePath),
        },
      },
      scriptFile: makeFile(scriptRelativePath, scriptContent),
    };
  }

  const response = operationCase.respond
    ? compileStaticResponse(operationCase.respond, initialState)
    : compileStaticTransportFault(
        operationCase.transport,
        initialState,
        issues,
        context,
      );

  return {
    resource: {
      ...resourceBase,
      ...((initialState.override?.contentType ?? operationCase.respond?.contentType)
        ? {
            contentType:
              initialState.override?.contentType ?? operationCase.respond?.contentType,
          }
        : {}),
      response,
    },
  };
}

function createFallbackScript(
  loaded: LoadedVendorPackage,
  stores: StatefulStoreLayout,
): GeneratedBundleFile {
  const operationCase: OperationCaseDefinition = {
    id: "unmatched-request",
    priority: 0,
    when: { "path.value": { present: true } },
    respond: loaded.executionModel.routing.unmatchedRequest,
  };
  const relativePath = "imposter/generated/unmatched-request.js";
  return makeFile(
    relativePath,
    Buffer.from(
      renderStatefulCaseScript({
        vendorId: loaded.executionModel.vendor.id,
        operationId: "unmatched",
        caseId: "unmatched-request",
        initialState: loaded.systemCasesFile.value.initialState,
        states: loaded.systemCasesFile.value.states,
        transitions: loaded.systemCasesFile.value.transitions ?? [],
        operationCase,
        stores,
      }),
      "utf8",
    ),
  );
}

function compileStaticTransportFault(
  transport: TransportFaultDefinition | undefined,
  initialState: SystemStateDefinition,
  issues: CompilationIssue[],
  context: { readonly operationId: string; readonly caseId: string },
): Readonly<Record<string, unknown>> {
  if (initialState.override) {
    return compileStaticResponse(initialState.override, initialState);
  }
  if (!transport) {
    return compileStaticResponse({ status: 204 }, initialState);
  }

  switch (transport.type) {
    case "timeout": {
      const durationMs = parseDurationForCompiler(transport.duration ?? "30s");
      return {
        delay: { exact: durationMs },
        fail: "CloseConnection",
      };
    }
    case "connection-close":
      return { fail: "CloseConnection" };
    case "connection-reset":
      issues.push({
        code: "unsupported-fault",
        operationId: context.operationId,
        caseId: context.caseId,
        message: `Cannot compile connection-reset fault in ${context.operationId}/${context.caseId}; Imposter documents CloseConnection but not a distinct reset primitive.`,
      });
      return {};
  }
}

function compileStaticResponse(
  response: ResponseDefinition,
  initialState: SystemStateDefinition,
): Readonly<Record<string, unknown>> {
  const effective = initialState.override ?? response;
  const delayMs = effective.delay
    ? parseDurationForCompiler(effective.delay)
    : initialState.defaults?.delay
      ? parseDurationForCompiler(initialState.defaults.delay)
      : undefined;

  return {
    statusCode: effective.status,
    ...(effective.headers ? { headers: effective.headers } : {}),
    ...(effective.body ? { file: effective.body } : {}),
    ...(delayMs !== undefined ? { delay: { exact: delayMs } } : {}),
  };
}

function compileSecurity(
  strategies: readonly AuthenticationStrategy[],
): Readonly<Record<string, unknown>> {
  return {
    default: "Deny",
    conditions: strategies.flatMap((strategy) =>
      strategy.validValues.map((value) => ({
        effect: "Permit",
        ...(strategy.source === "header"
          ? { requestHeaders: { [strategy.name]: value } }
          : { queryParams: { [strategy.name]: value } }),
      })),
    ),
  };
}

function createPermittedSystemResource(
  method: string | undefined,
  path: string,
): ImposterResource {
  return {
    ...(method ? { method } : {}),
    path,
    security: { default: "Permit" },
  };
}

function addAuthenticationWarnings(
  strategies: readonly AuthenticationStrategy[],
  warnings: CompilerWarning[],
): void {
  for (const strategy of strategies) {
    if (strategy.onFailure.body || strategy.onFailure.status !== 401) {
      warnings.push({
        code: "authentication-response-body-ignored",
        message: `Authentication strategy '${strategy.id}' uses Imposter's native security policy, which returns HTTP 401 and does not use the configured failure body.`,
      });
    }
  }
}

function validateTransportFaults(
  loaded: LoadedVendorPackage,
  issues: CompilationIssue[],
  warnings: CompilerWarning[],
): void {
  for (const operation of loaded.executionModel.operations) {
    for (const operationCase of operation.cases) {
      validateFault(
        operationCase.transport,
        operation.id,
        operationCase.id,
        issues,
        warnings,
      );
      for (const step of operationCase.sequence?.steps ?? []) {
        validateFault(
          step.transport,
          operation.id,
          operationCase.id,
          issues,
          warnings,
        );
      }
    }
  }
}

function validateFault(
  transport: TransportFaultDefinition | undefined,
  operationId: string,
  caseId: string,
  issues: CompilationIssue[],
  warnings: CompilerWarning[],
): void {
  if (!transport) {
    return;
  }

  if (transport.type === "connection-reset") {
    issues.push({
      code: "unsupported-fault",
      operationId,
      caseId,
      message: `Cannot compile connection-reset fault in ${operationId}/${caseId}; Imposter documents CloseConnection but not a distinct reset primitive.`,
    });
  }

  if (transport.type === "timeout") {
    warnings.push({
      code: "timeout-approximated",
      operationId,
      caseId,
      message:
        "Timeout is implemented as an exact delay followed by CloseConnection; the client timeout should expire before the connection closes.",
    });
  }
}

function validateStateTargets(
  loaded: LoadedVendorPackage,
  issues: CompilationIssue[],
): void {
  const stateIds = new Set(Object.keys(loaded.systemCasesFile.value.states));

  for (const operation of loaded.executionModel.operations) {
    for (const operationCase of operation.cases) {
      validateEffectsState(
        operationCase.effects,
        stateIds,
        operation.id,
        operationCase.id,
        issues,
      );
      for (const step of operationCase.sequence?.steps ?? []) {
        validateEffectsState(
          step.effects,
          stateIds,
          operation.id,
          operationCase.id,
          issues,
        );
      }
    }
  }
}

function validateEffectsState(
  effects: OperationCaseDefinition["effects"] | undefined,
  stateIds: ReadonlySet<string>,
  operationId: string,
  caseId: string,
  issues: CompilationIssue[],
): void {
  if (effects?.setState && !stateIds.has(effects.setState)) {
    issues.push({
      code: "invalid-state-target",
      operationId,
      caseId,
      field: "effects.setState",
      message: `Cannot compile state target '${effects.setState}' in ${operationId}/${caseId}; the state is not defined in system-cases.yaml.`,
    });
  }
}

function validateRuntimeImage(
  image: string,
  issues: CompilationIssue[],
  warnings: CompilerWarning[],
): void {
  if (image.trim() !== image || image.length === 0 || /\s/u.test(image)) {
    issues.push({
      code: "invalid-runtime-image",
      message: `Runtime image '${image}' is not a valid container image reference.`,
    });
    return;
  }

  if (!image.includes("@sha256:")) {
    warnings.push({
      code: "runtime-image-not-digest-pinned",
      message: `Runtime image '${image}' is not digest-pinned. Set TESTY_IMPOSTER_IMAGE to an image@sha256 reference before release gating.`,
    });
  }
}

function fallbackPaths(basePath: string): readonly string[] {
  const normalized = normalizeBasePath(basePath);
  return normalized === "/" ? ["/*"] : [normalized, `${normalized}/*`];
}

function joinHttpPath(basePath: string, operationPath: string): string {
  const base = normalizeBasePath(basePath);
  const operation = operationPath.startsWith("/") ? operationPath : `/${operationPath}`;
  return base === "/" ? operation : `${base}${operation}`.replaceAll(/\/{2,}/gu, "/");
}

function normalizeBasePath(basePath: string): string {
  const withLeadingSlash = basePath.startsWith("/") ? basePath : `/${basePath}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/u, "");
  return withoutTrailingSlash.length === 0 ? "/" : withoutTrailingSlash;
}

function parseDurationForCompiler(value: string): number {
  const match = /^(\d+)(ms|s|m)$/u.exec(value);
  if (!match) {
    throw new Error(`Invalid duration '${value}'.`);
  }
  const amount = Number(match[1]);
  switch (match[2]) {
    case "ms":
      return amount;
    case "s":
      return amount * 1_000;
    case "m":
      return amount * 60_000;
    default:
      throw new Error(`Unsupported duration unit in '${value}'.`);
  }
}

function makeFile(relativePath: string, content: Buffer): GeneratedBundleFile {
  return {
    relativePath,
    content,
    sha256: sha256(content),
    byteLength: content.byteLength,
  };
}

function stripImposterPrefix(relativePath: string): string {
  return relativePath.replace(/^imposter\//u, "");
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/gu, "-").slice(0, 100);
}

function normalizePath(value: string): string {
  return value.split(sep).join("/");
}
