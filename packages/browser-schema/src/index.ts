export const BROWSER_SCHEMA_VERSION = "1.0" as const;

export const BROWSER_SCHEMA_IDS = {
  common: "https://testy-mctestface.dev/schemas/browser/v1/common.schema.json",
  customer: "https://testy-mctestface.dev/schemas/browser/v1/customer.schema.json",
  site: "https://testy-mctestface.dev/schemas/browser/v1/site.schema.json",
  persona: "https://testy-mctestface.dev/schemas/browser/v1/persona.schema.json",
  journey: "https://testy-mctestface.dev/schemas/browser/v1/journey.schema.json",
  fragment: "https://testy-mctestface.dev/schemas/browser/v1/fragment.schema.json",
} as const;

export const browserSchemaDirectory = new URL("./schemas/v1/", import.meta.url);

export type BrowserSchemaVersion = typeof BROWSER_SCHEMA_VERSION;
export type ArtifactCaptureMode = "never" | "on-failure" | "always";
export type ColorScheme = "light" | "dark" | "no-preference";

export interface ArtifactPolicy {
  readonly screenshot: ArtifactCaptureMode;
  readonly trace: ArtifactCaptureMode;
  readonly console: ArtifactCaptureMode;
  readonly failedRequests: ArtifactCaptureMode;
  readonly selectedHar: ArtifactCaptureMode;
}

export interface CustomerConfig {
  readonly schemaVersion: BrowserSchemaVersion;
  readonly customer: {
    readonly id: string;
    readonly displayName: string;
  };
  readonly site: string;
  readonly personas: readonly string[];
  readonly journeys: readonly string[];
  readonly fragments?: readonly string[];
  readonly artifactPolicy: ArtifactPolicy;
}

export interface SiteConfig {
  readonly schemaVersion: BrowserSchemaVersion;
  readonly site: {
    readonly id: string;
    readonly displayName: string;
    readonly hostname: string;
  };
  readonly variables?: Readonly<Record<string, string>>;
  readonly tracking?: {
    readonly enabled: boolean;
    readonly endpoint?: string;
  };
  readonly consent?: ConsentBannerDefinition;
  readonly pages: readonly SitePageDefinition[];
}

export interface ConsentBannerDefinition {
  readonly id: string;
  readonly text: string;
  readonly storage: "cookie" | "localStorage";
  readonly key: string;
  readonly acceptText: string;
  readonly rejectText: string;
  readonly acceptTestId: string;
  readonly rejectTestId: string;
}

export interface SitePageDefinition {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly blocks: readonly SiteBlockDefinition[];
}

export type SiteBlockDefinition =
  | HeadingBlock
  | TextBlock
  | LinkBlock
  | ButtonBlock
  | FormBlock;

interface BaseSiteBlock {
  readonly id: string;
  readonly testId?: string;
}

export interface HeadingBlock extends BaseSiteBlock {
  readonly type: "heading";
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly text: string;
}

export interface TextBlock extends BaseSiteBlock {
  readonly type: "text";
  readonly text: string;
}

export interface LinkBlock extends BaseSiteBlock {
  readonly type: "link";
  readonly text: string;
  readonly href: string;
  readonly target?: "_self" | "_blank";
}

export interface ButtonBlock extends BaseSiteBlock {
  readonly type: "button";
  readonly text: string;
  readonly event?: string;
}

export interface FormBlock extends BaseSiteBlock {
  readonly type: "form";
  readonly method: "GET" | "POST";
  readonly action: string;
  readonly fields: readonly FormFieldDefinition[];
  readonly submit: {
    readonly text: string;
    readonly testId: string;
  };
  readonly successPath?: string;
}

export type FormFieldDefinition =
  | TextFormField
  | CheckboxFormField
  | SelectFormField;

interface BaseFormField {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly testId: string;
  readonly required?: boolean;
}

export interface TextFormField extends BaseFormField {
  readonly type: "text" | "email";
  readonly placeholder?: string;
  readonly value?: string;
}

export interface CheckboxFormField extends BaseFormField {
  readonly type: "checkbox";
  readonly checked?: boolean;
  readonly value?: string;
}

export interface SelectFormField extends BaseFormField {
  readonly type: "select";
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly value?: string;
}

export interface PersonaConfig {
  readonly schemaVersion: BrowserSchemaVersion;
  readonly persona: {
    readonly id: string;
    readonly displayName: string;
  };
  readonly browser: {
    readonly locale: string;
    readonly timezoneId: string;
    readonly colorScheme: ColorScheme;
    readonly viewport: {
      readonly width: number;
      readonly height: number;
    };
  };
  readonly variables?: Readonly<Record<string, string>>;
  readonly session?: {
    readonly cookies?: readonly BrowserCookieDefinition[];
    readonly localStorage?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  };
}

export interface BrowserCookieDefinition {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: "Strict" | "Lax" | "None";
}

export type BrowserSelector =
  | { readonly testId: string }
  | { readonly role: string; readonly name: string }
  | { readonly label: string }
  | { readonly placeholder: string }
  | { readonly css: string };

export interface NetworkFixtureDefinition {
  readonly id: string;
  readonly match: {
    readonly url: string;
    readonly method?: string;
  };
  readonly response: {
    readonly status: number;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly delayMs?: number;
  };
}

export interface JourneyConfig {
  readonly schemaVersion: BrowserSchemaVersion;
  readonly journey: {
    readonly id: string;
    readonly displayName: string;
  };
  readonly persona: string;
  readonly startPath: string;
  readonly timeoutMs?: number;
  readonly allowCssFallback?: boolean;
  readonly networkFixtures?: readonly NetworkFixtureDefinition[];
  readonly artifactPolicy?: Partial<ArtifactPolicy>;
  readonly steps: readonly JourneyStepDefinition[];
}

export interface FragmentConfig {
  readonly schemaVersion: BrowserSchemaVersion;
  readonly fragment: {
    readonly id: string;
    readonly displayName: string;
  };
  readonly steps: readonly JourneyStepDefinition[];
}

export type JourneyStepDefinition =
  | { readonly id: string; readonly useFragment: string }
  | JourneyActionDefinition;

export interface JourneyActionDefinition {
  readonly id: string;
  readonly action:
    | "open"
    | "navigate"
    | "reload"
    | "goBack"
    | "goForward"
    | "click"
    | "doubleClick"
    | "hover"
    | "fill"
    | "fillForm"
    | "select"
    | "check"
    | "uncheck"
    | "submit"
    | "wait"
    | "waitForRequest"
    | "waitForResponse"
    | "waitForEvent"
    | "expectVisible"
    | "expectHidden"
    | "expectText"
    | "expectUrl"
    | "expectAttribute"
    | "expectRequest"
    | "setCookie"
    | "setLocalStorage"
    | "openTab"
    | "switchTab"
    | "closeTab"
    | "screenshot";
  readonly selector?: BrowserSelector;
  readonly path?: string;
  readonly value?: string | boolean | number;
  readonly values?: Readonly<Record<string, string | boolean>>;
  readonly option?: string;
  readonly text?: string;
  readonly attribute?: string;
  readonly url?: string;
  readonly method?: string;
  readonly event?: string;
  readonly tab?: string;
  readonly timeoutMs?: number;
}

export interface LoadedBrowserPackage {
  readonly rootDir: string;
  readonly customer: CustomerConfig;
  readonly site: SiteConfig;
  readonly personas: readonly PersonaConfig[];
  readonly journeys: readonly JourneyConfig[];
  readonly fragments: readonly FragmentConfig[];
  readonly contentHash: string;
}
