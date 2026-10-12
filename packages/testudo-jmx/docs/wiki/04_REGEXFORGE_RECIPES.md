# 04. RegexForge™ Auto-Correlation & Enterprise Recipes

Dynamic session parameters (CSRF tokens, session IDs, view states, OAuth nonces) break naive load test replays. In legacy Apache JMeter, QA engineers spend hours writing manual Regular Expression Extractors and Boundary Extractors.

Testudo-JMX embeds the **RegexForge™ Auto-Correlation Enclave**, which automatically scans the test plan hierarchy and injects extraction and parameter replacement rules in a single pass.

---

## 1. Supported Enterprise Correlation Recipes (23 Patterns)

Testudo-JMX ships with built-in heuristic rules covering major enterprise web frameworks:

| Category | Parameter Name | Variable Name | Default Left Boundary | Default Right Boundary |
| :--- | :--- | :--- | :--- | :--- |
| **CSRF / Security** | `csrf_token` | `csrf_token` | `name="csrf_token" value="` | `"` |
| **CSRF / Security** | `_csrf` | `csrf_token` | `name="_csrf" value="` | `"` |
| **CSRF / Security** | `csrfmiddlewaretoken` | `django_csrf` | `name="csrfmiddlewaretoken" value="` | `"` |
| **CSRF / Security** | `authenticity_token` | `rails_csrf` | `name="authenticity_token" value="` | `"` |
| **E-Commerce** | `form_key` | `magento_form_key` | `name="form_key" type="hidden" value="` | `"` |
| **Framework** | `_token` | `laravel_token` | `name="_token" value="` | `"` |
| **ASP.NET Core** | `__RequestVerificationToken` | `aspnet_verification_token` | `name="__RequestVerificationToken" type="hidden" value="` | `"` |
| **SPA Security** | `XSRF-TOKEN` | `xsrf_token` | `XSRF-TOKEN=` | `;` |
| **OAuth / OIDC** | `nonce` | `nonce` | `"nonce":"` | `"` |
| **ASP.NET** | `__VIEWSTATE` | `viewstate` | `id="__VIEWSTATE" value="` | `"` |
| **ASP.NET** | `__VIEWSTATEGENERATOR` | `viewstate_generator` | `id="__VIEWSTATEGENERATOR" value="` | `"` |
| **ASP.NET** | `__EVENTVALIDATION` | `event_validation` | `id="__EVENTVALIDATION" value="` | `"` |
| **Session Cookies** | `JSESSIONID` | `jsessionid` | `JSESSIONID=` | `;` |
| **Session Cookies** | `PHPSESSID` | `phpsessid` | `PHPSESSID=` | `;` |
| **Session Cookies** | `ASP.NET_SessionId` | `aspnet_session_id` | `ASP.NET_SessionId=` | `;` |
| **Session Cookies** | `connect.sid` | `express_sid` | `connect.sid=` | `;` |
| **API Tokens** | `session_id` | `session_id` | `"session_id":"` | `"` |
| **API Tokens** | `session_token` | `session_token` | `"session_token":"` | `"` |
| **OAuth2** | `access_token` | `access_token` | `"access_token":"` | `"` |
| **OAuth2** | `refresh_token` | `refresh_token` | `"refresh_token":"` | `"` |
| **OAuth2** | `id_token` | `id_token` | `"id_token":"` | `"` |
| **OAuth2** | `code` | `oauth_auth_code` | `code=` | `&` |
| **OAuth2** | `state` | `oauth_state` | `state=` | `&` |

---

## 2. Invoking Auto-Correlation

### Via CLI
Run correlation on any test plan and output the correlated plan:
```bash
testudo-jmx -correlate -t fixtures/login_flow.jmx
```

### Via Web Flight Deck
1. Launch the cockpit: `testudo-jmx -t fixtures/login_flow.jmx -g -p 3014`
2. Open the **Plan Studio & RegexForge** tab.
3. Review the candidate table.
4. Click **⚡ Auto-Correlate Plan**.

---

## 3. The Full RegexForge™ Visual Studio

For testing custom regex extractors, analyzing catastrophic backtracking (ReDoS), or transpiling regular expressions across PCRE, Go, Python, and JavaScript, visit our 100% client-side, zero-telemetry workbench:

👉 **[https://aventinelabs.com/forges/regex](https://aventinelabs.com/forges/regex)**

Features:
* Visual AST token visualizer with colored capture groups.
* Thompson NFA ReDoS complexity meter.
* 360+ production recipes for security, compliance, and log parsing.
* 100% in-browser WebAssembly execution with zero server telemetry.
