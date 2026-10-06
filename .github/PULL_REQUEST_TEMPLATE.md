## Description

Provide a clear and concise description of the proposed change, the motivation behind it, and any relevant issue references.

## Engineering Invariants & Quality Verification

All contributions must adhere to the core Testudo architecture principles:

- [ ] **Strict Zero Runtime Dependencies:** Verified that `package.json` contains 0 runtime dependencies (`dependencies` object is empty).
- [ ] **Bundle Size Discipline:** Verified core bundle remains within the strict budget (<5KB core gzip).
- [ ] **Financial Precision:** Currency and basis point assertions adhere to exact decimal precision.
- [ ] **Playwright & Jest Compatibility:** Cross-framework matchers verified against headless browser runtimes.
- [ ] **Type Safety:** TypeScript compilation succeeds with zero errors (`npm run build`).
- [ ] **Unit Tests:** All unit test suites pass (`npm test`).
