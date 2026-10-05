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
  const content = renderPageBlocks(page.id, page.blocks, variables);
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
  <div class="site-announcement">
    <span>New: richer account timelines and routing workflows</span>
    <a href="/pricing">Explore plans →</a>
  </div>
  <header class="site-header">
    <a class="site-brand" href="/" aria-label="${escapeAttribute(site.site.displayName)} home">
      <span class="site-brand-mark">${escapeHtml(site.site.displayName.slice(0, 1).toUpperCase())}</span>
      <span>${escapeHtml(site.site.displayName)}</span>
    </a>
    <nav class="site-nav" aria-label="Primary navigation">
      <div class="site-nav-menu">
        <a href="/product">Product</a>
        <div class="site-nav-dropdown">
          <a href="/product"><strong>Product overview</strong><span>See the complete Northstar workflow</span></a>
          <a href="/product/account-identification"><strong>Account identification</strong><span>Reveal eligible business accounts</span></a>
          <a href="/product/intent-signals"><strong>Intent signals</strong><span>Understand research themes and depth</span></a>
          <a href="/product/enrichment"><strong>Enrichment</strong><span>Add company and contact context</span></a>
          <a href="/product/scoring"><strong>Scoring</strong><span>Prioritize the strongest account signals</span></a>
          <a href="/product/routing-workflows"><strong>Routing & workflows</strong><span>Move qualified accounts to the right owner</span></a>
        </div>
      </div>
      <div class="site-nav-menu">
        <a href="/solutions">Solutions</a>
        <div class="site-nav-dropdown site-nav-dropdown--compact">
          <a href="/solutions/sales"><strong>Sales</strong><span>Reach out with better context</span></a>
          <a href="/solutions/revops"><strong>Revenue Operations</strong><span>Manage routing, quality, and feedback</span></a>
          <a href="/solutions/marketing"><strong>Marketing</strong><span>Understand account-level content engagement</span></a>
        </div>
      </div>
      <a href="/customers">Customers</a>
      <a href="/integrations">Integrations</a>
      <div class="site-nav-menu">
        <a href="/resources">Resources</a>
        <div class="site-nav-dropdown site-nav-dropdown--compact">
          <a href="/resources"><strong>Resource library</strong><span>Guides, benchmarks, and checklists</span></a>
          <a href="/blog"><strong>Blog</strong><span>Ideas for modern revenue teams</span></a>
          <a href="/changelog"><strong>Changelog</strong><span>See what’s new in Northstar</span></a>
        </div>
      </div>
      <a href="/pricing">Pricing</a>
      <a class="site-nav-cta" href="/contact">Book a demo</a>
    </nav>
  </header>
  <main class="site-main">${content}</main>
  <footer class="site-footer">
    <div class="footer-brand">
      <a class="site-brand" href="/">
        <span class="site-brand-mark">${escapeHtml(site.site.displayName.slice(0, 1).toUpperCase())}</span>
        <span>${escapeHtml(site.site.displayName)}</span>
      </a>
      <p>Revenue intelligence for teams that want signal, context, and a clear next action.</p>
    </div>
    <div class="footer-column">
      <strong>Product</strong>
      <a href="/product">Overview</a>
      <a href="/product/account-identification">Identification</a>
      <a href="/product/intent-signals">Intent signals</a>
      <a href="/product/enrichment">Enrichment</a>
      <a href="/product/scoring">Scoring</a>
      <a href="/product/routing-workflows">Routing</a>
    </div>
    <div class="footer-column">
      <strong>Solutions</strong>
      <a href="/solutions/sales">Sales</a>
      <a href="/solutions/revops">Revenue Operations</a>
      <a href="/solutions/marketing">Marketing</a>
      <a href="/integrations">Integrations</a>
      <a href="/security">Security</a>
    </div>
    <div class="footer-column">
      <strong>Resources</strong>
      <a href="/resources">Resource library</a>
      <a href="/blog">Blog</a>
      <a href="/changelog">Changelog</a>
      <a href="/customers">Customers</a>
      <a href="/pricing">Pricing</a>
    </div>
    <div class="footer-column">
      <strong>Company</strong>
      <a href="/about">About</a>
      <a href="/careers">Careers</a>
      <a href="/contact">Contact</a>
    </div>
    <div class="footer-meta">
      <span>© 2026 ${escapeHtml(site.site.displayName)}</span>
      <span>Privacy-aware demo experience</span>
    </div>
  </footer>
  ${consent}
  ${renderGeneratedScript(page.id, site.consent, trackingEndpoint)}
</body>
</html>`;
}

function renderPageBlocks(
  pageId: string,
  blocks: readonly SiteBlockDefinition[],
  variables: Readonly<Record<string, string>>,
): string {
  if (blocks.length === 0) return "";

  const bodyStart = blocks.findIndex(
    (block, index) =>
      index > 0 &&
      ((block.type === "heading" && block.level >= 2) || block.type === "form"),
  );
  const heroEnd = bodyStart === -1 ? blocks.length : bodyStart;
  const hero = blocks.slice(0, heroEnd);
  const body = blocks.slice(heroEnd);

  const heroVisual =
    pageId === "home"
      ? `
<div class="hero-product-preview" aria-label="Northstar account intelligence preview">
  <div class="preview-window-bar">
    <span class="preview-dot"></span><span class="preview-dot"></span><span class="preview-dot"></span>
    <span class="preview-window-title">Account activity · live</span>
  </div>
  <div class="preview-layout">
    <aside class="preview-sidebar">
      <span class="preview-sidebar-brand">N</span>
      <span class="preview-sidebar-item active"></span>
      <span class="preview-sidebar-item"></span>
      <span class="preview-sidebar-item"></span>
      <span class="preview-sidebar-item short"></span>
    </aside>
    <div class="preview-content">
      <div class="preview-kicker">TODAY'S ACCOUNT SIGNALS</div>
      <div class="preview-stat-grid">
        <div><strong>148</strong><span>identified accounts</span></div>
        <div><strong>23</strong><span>high-intent accounts</span></div>
        <div><strong>92%</strong><span>high-confidence matches</span></div>
      </div>
      <div class="preview-company">
        <span class="preview-company-logo">H</span>
        <div><strong>Halcyon Systems</strong><span>Pricing + integrations · 6 visits</span></div>
        <span class="preview-score">87</span>
      </div>
      <div class="preview-company">
        <span class="preview-company-logo">A</span>
        <div><strong>Arbor Labs</strong><span>Security + platform · 4 visits</span></div>
        <span class="preview-score">79</span>
      </div>
      <div class="preview-company muted">
        <span class="preview-company-logo">S</span>
        <div><strong>Solace Grid</strong><span>Product research · 3 visits</span></div>
        <span class="preview-score">64</span>
      </div>
    </div>
  </div>
</div>
<div class="customer-strip">
  <span>Built for modern revenue teams</span>
  <strong>HALCYON</strong><strong>ARBOR</strong><strong>VERDANT</strong><strong>POLARIS</strong><strong>ORBITAL</strong>
</div>`
      : pageId === "product"
        ? `
<div class="product-page-preview" aria-label="Northstar product workflow preview">
  <div class="product-preview-rail">
    <span class="active">Identify</span>
    <span>Intent</span>
    <span>Enrich</span>
    <span>Score</span>
    <span>Route</span>
  </div>
  <div class="product-preview-main">
    <div class="product-preview-company">
      <div class="product-preview-logo">H</div>
      <div><strong>Halcyon Systems</strong><span>High-confidence account · active research</span></div>
      <div class="product-preview-badge">87 score</div>
    </div>
    <div class="product-preview-grid">
      <div><small>Recent intent</small><strong>Pricing + integrations</strong><span>6 visits across 3 sessions</span></div>
      <div><small>Identification</small><strong>High confidence</strong><span>Corporate network match</span></div>
      <div><small>Enrichment</small><strong>Ready</strong><span>Company + contact context</span></div>
      <div><small>Next action</small><strong>Route to account owner</strong><span>Evidence attached</span></div>
    </div>
  </div>
</div>`
        : "";

  const heroHtml =
    hero.length > 0
      ? `<section class="page-hero">${hero
          .map((block) => renderBlock(block, variables))
          .join("\n")}${heroVisual}</section>`
      : "";

  const groups: string[] = [];
  for (let index = 0; index < body.length; ) {
    const block = body[index];
    if (!block) break;

    if (block.type === "heading" && block.level >= 2) {
      const sectionBlocks: SiteBlockDefinition[] = [block];
      index += 1;
      while (index < body.length) {
        const next = body[index];
        if (
          !next ||
          next.type === "form" ||
          (next.type === "heading" && next.level >= 2)
        ) {
          break;
        }
        sectionBlocks.push(next);
        index += 1;
      }
      groups.push(
        `<section class="content-card" data-section-id="${escapeAttribute(block.id)}">${sectionBlocks
          .map((item) => renderBlock(item, variables))
          .join("\n")}</section>`,
      );
      continue;
    }

    if (block.type === "form") {
      groups.push(
        `<section class="form-panel" data-section-id="${escapeAttribute(block.id)}">${renderBlock(block, variables)}</section>`,
      );
      index += 1;
      continue;
    }

    groups.push(
      `<section class="content-card content-card--standalone" data-section-id="${escapeAttribute(block.id)}">${renderBlock(block, variables)}</section>`,
    );
    index += 1;
  }

  return `${heroHtml}${groups.length > 0 ? `<div class="site-content-grid">${groups.join("\n")}</div>` : ""}`;
}

function renderBlock(
  block: SiteBlockDefinition,
  variables: Readonly<Record<string, string>>,
): string {
  const testId = block.testId
    ? ` data-test="${escapeAttribute(block.testId)}"`
    : "";
  const blockAttrs = ` id="${escapeAttribute(block.id)}" data-block-id="${escapeAttribute(block.id)}"${testId}`;
  switch (block.type) {
    case "heading":
      return `<h${block.level}${blockAttrs}>${escapeHtml(interpolate(block.text, variables))}</h${block.level}>`;
    case "text":
      return `<p${blockAttrs}>${escapeHtml(interpolate(block.text, variables))}</p>`;
    case "link":
      return `<a${blockAttrs} href="${escapeAttribute(interpolate(block.href, variables))}"${block.target ? ` target="${block.target}"` : ""}>${escapeHtml(interpolate(block.text, variables))}</a>`;
    case "button":
      return `<button type="button"${blockAttrs}${block.event ? ` data-test-event="${escapeAttribute(block.event)}"` : ""}>${escapeHtml(interpolate(block.text, variables))}</button>`;
    case "form":
      return renderForm(block, variables, blockAttrs);
  }
}

function renderForm(
  form: FormBlock,
  variables: Readonly<Record<string, string>>,
  blockAttrs: string,
): string {
  const fields = form.fields.map((field) => renderField(field, variables)).join("\n");
  return `<form${blockAttrs} method="${form.method}" action="${escapeAttribute(interpolate(form.action, variables))}"${form.successPath ? ` data-test-success-path="${escapeAttribute(form.successPath)}"` : ""}>
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
