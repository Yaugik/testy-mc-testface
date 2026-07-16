import type {
  ConsentBannerDefinition,
  FormBlock,
  FormFieldDefinition,
  SiteBlockDefinition,
  SiteConfig,
  SitePageDefinition,
} from "@testy/browser-schema";

export interface RenderedSitePage {
  readonly pageId: string;
  readonly path: string;
  readonly html: string;
}

export function renderSitePages(site: SiteConfig): readonly RenderedSitePage[] {
  const variables = site.variables ?? {};
  return site.pages.map((page) => ({
    pageId: page.id,
    path: page.path,
    html: renderPage(site, page, variables),
  }));
}

function renderPage(
  site: SiteConfig,
  page: SitePageDefinition,
  variables: Readonly<Record<string, string>>,
): string {
  const title = interpolate(page.title, variables);
  const content = page.blocks
    .map((block) => renderBlock(block, variables))
    .join("\n");
  const consent = site.consent ? renderConsent(site.consent, variables) : "";
  const trackingEndpoint = site.tracking?.enabled
    ? site.tracking.endpoint ?? "/__testy/events"
    : undefined;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/__testy/style.css">
</head>
<body data-test-page="${escapeAttribute(page.id)}">
  <main>${content}</main>
  ${consent}
  ${renderGeneratedScript(page.id, site.consent, trackingEndpoint)}
</body>
</html>`;
}

function renderBlock(
  block: SiteBlockDefinition,
  variables: Readonly<Record<string, string>>,
): string {
  const testId = block.testId
    ? ` data-test="${escapeAttribute(block.testId)}"`
    : "";
  switch (block.type) {
    case "heading":
      return `<h${block.level}${testId}>${escapeHtml(interpolate(block.text, variables))}</h${block.level}>`;
    case "text":
      return `<p${testId}>${escapeHtml(interpolate(block.text, variables))}</p>`;
    case "link":
      return `<a${testId} href="${escapeAttribute(interpolate(block.href, variables))}"${block.target ? ` target="${block.target}"` : ""}>${escapeHtml(interpolate(block.text, variables))}</a>`;
    case "button":
      return `<button type="button"${testId}${block.event ? ` data-test-event="${escapeAttribute(block.event)}"` : ""}>${escapeHtml(interpolate(block.text, variables))}</button>`;
    case "form":
      return renderForm(block, variables, testId);
  }
}

function renderForm(
  form: FormBlock,
  variables: Readonly<Record<string, string>>,
  testId: string,
): string {
  const fields = form.fields.map((field) => renderField(field, variables)).join("\n");
  return `<form${testId} method="${form.method}" action="${escapeAttribute(interpolate(form.action, variables))}"${form.successPath ? ` data-test-success-path="${escapeAttribute(form.successPath)}"` : ""}>
${fields}
<button type="submit" data-test="${escapeAttribute(form.submit.testId)}">${escapeHtml(interpolate(form.submit.text, variables))}</button>
</form>`;
}

function renderField(
  field: FormFieldDefinition,
  variables: Readonly<Record<string, string>>,
): string {
  const id = `field-${field.id}`;
  const required = field.required ? " required" : "";
  const label = `<label for="${escapeAttribute(id)}">${escapeHtml(interpolate(field.label, variables))}</label>`;
  if (field.type === "select") {
    const options = field.options
      .map(
        (option) =>
          `<option value="${escapeAttribute(option.value)}"${option.value === field.value ? " selected" : ""}>${escapeHtml(interpolate(option.label, variables))}</option>`,
      )
      .join("");
    return `<div>${label}<select id="${escapeAttribute(id)}" name="${escapeAttribute(field.name)}" data-test="${escapeAttribute(field.testId)}"${required}>${options}</select></div>`;
  }
  if (field.type === "checkbox") {
    return `<div><input id="${escapeAttribute(id)}" type="checkbox" name="${escapeAttribute(field.name)}" value="${escapeAttribute(field.value ?? "true")}" data-test="${escapeAttribute(field.testId)}"${field.checked ? " checked" : ""}${required}>${label}</div>`;
  }
  return `<div>${label}<input id="${escapeAttribute(id)}" type="${field.type}" name="${escapeAttribute(field.name)}" data-test="${escapeAttribute(field.testId)}"${field.placeholder ? ` placeholder="${escapeAttribute(interpolate(field.placeholder, variables))}"` : ""}${field.value ? ` value="${escapeAttribute(interpolate(field.value, variables))}"` : ""}${required}></div>`;
}

function renderConsent(
  consent: ConsentBannerDefinition,
  variables: Readonly<Record<string, string>>,
): string {
  return `<aside data-test="consent-banner" data-test-consent-storage="${consent.storage}" data-test-consent-key="${escapeAttribute(consent.key)}">
<p>${escapeHtml(interpolate(consent.text, variables))}</p>
<button type="button" data-test="${escapeAttribute(consent.acceptTestId)}" data-test-consent-value="accepted">${escapeHtml(interpolate(consent.acceptText, variables))}</button>
<button type="button" data-test="${escapeAttribute(consent.rejectTestId)}" data-test-consent-value="rejected">${escapeHtml(interpolate(consent.rejectText, variables))}</button>
</aside>`;
}

function renderGeneratedScript(
  pageId: string,
  consent: ConsentBannerDefinition | undefined,
  trackingEndpoint: string | undefined,
): string {
  const endpoint = JSON.stringify(trackingEndpoint ?? "/__testy/events");
  const consentConfig = consent
    ? JSON.stringify({ storage: consent.storage, key: consent.key })
    : "null";
  return `<script>
(() => {
  const endpoint = ${endpoint};
  const trackingEnabled = ${trackingEndpoint ? "true" : "false"};
  const consent = ${consentConfig};
  const emit = (event) => {
    if (!trackingEnabled) return;
    navigator.sendBeacon(endpoint, new Blob([JSON.stringify(event)], { type: "application/json" }));
  };
  if (trackingEnabled) emit({ type: "page-view", pageId: ${JSON.stringify(pageId)} });
  document.querySelectorAll("[data-test-event]").forEach((button) => {
    button.addEventListener("click", () => emit({ type: "button", pageId: ${JSON.stringify(pageId)}, event: button.getAttribute("data-test-event") }));
  });
  const banner = document.querySelector("[data-test-consent-storage]");
  if (banner && consent) {
    const current = consent.storage === "cookie"
      ? document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(consent.key + "="))
      : localStorage.getItem(consent.key);
    if (current) banner.hidden = true;
    banner.querySelectorAll("[data-test-consent-value]").forEach((button) => {
      button.addEventListener("click", () => {
        const value = button.getAttribute("data-test-consent-value");
        if (consent.storage === "cookie") document.cookie = consent.key + "=" + value + "; Path=/; SameSite=Lax";
        else localStorage.setItem(consent.key, value);
        banner.hidden = true;
        emit({ type: "consent", pageId: ${JSON.stringify(pageId)}, value });
      });
    });
  }
})();
</script>`;
}

function interpolate(
  value: string,
  variables: Readonly<Record<string, string>>,
): string {
  return value.replace(/\{\{([a-zA-Z][a-zA-Z0-9_.-]*)\}\}/gu, (_match, name: string) => {
    const replacement = variables[name];
    if (replacement === undefined) {
      throw new Error(`Synthetic-site variable '${name}' is not defined.`);
    }
    return replacement;
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
