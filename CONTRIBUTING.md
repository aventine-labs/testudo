# Contributing to Testudo

Thank you for your interest in contributing to Testudo.

Testudo is an ultra-lightweight, zero-runtime-dependency testing utility and assertion engine optimized for financial calculations, headless DOM inspection, and Playwright workflows.

---

## 1. Development Principles

1. **Zero Runtime Dependencies:** Testudo core must never introduce runtime dependencies. Zero supply-chain attack surface.
2. **Sub-3KB Gzip Core Size:** Size discipline is a core invariant. All additions must be tree-shakeable.
3. **FinTech Numerical Precision:** Financial assertions must treat cents, basis points, and currency values deterministically without floating-point rounding errors.
4. **Zero-Telemetry Standard:** No diagnostic home-calls, network beacons, or tracking pixels.

---

## 2. Setting Up Local Development

```bash
# Clone the repository
git clone https://github.com/aventine-labs/testudo.git
cd testudo

# Install dev dependencies
npm install

# Compile TypeScript
npm run build

# Run unit tests
npm test

# Verify bundle size limits
npm run size
```

---

## 3. Pull Request Guidelines

1. Create a dedicated branch off `develop`: `git checkout -b feature/your-feature-name`.
2. Ensure all tests and TypeScript builds pass cleanly without warnings.
3. Verify that bundle size remains within strict limits (`npm run size`).
4. Submit a Pull Request referencing the rationale and providing test verification.
5. All submissions are reviewed by `@markbgilbert`.
