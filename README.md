# SweldoSync 2.0

Crypto-native global payroll infrastructure powered by Stellar Horizon and Soroban smart contracts. Designed for distributed engineering teams requiring trustless multi-currency settlement, automated labor policy guardrails, and cryptographic auditability.

---

## Architectural Overview

SweldoSync 2.0 separates stateful accounting, cryptographic verification, and on-chain execution into a decoupled monorepo:

- **Frontend (`apps/web`)**: Studio-grade React 19 single-page application built on Vite, Tailwind CSS v4, and Framer Motion. Features a crisp daylight canvas with a 1-click Obsidian dark mode toggle, trustless client-side XDR decoding, and responsive layouts across tablet and desktop viewports.
- **Backend (`apps/server`)**: Hardened Express server with SQLite (`sql.js` WASM) persistence, atomic single-writer write-ahead semantics, timing-safe Bearer authentication, and idempotent Stellar submission retries.
- **Agent & Shared Engine (`packages/agent`, `packages/shared`)**: Deterministic integer-stroop math (`10_000_000n` per unit, HALF_UP rounding), policy evaluation matrix (`READY`, `FLAGGED`, `BLOCKED`), and RFC-8785 canonical JSON MemoHash calculation.

---

## Key Capabilities

1. **Guided 4-Step Payroll Stepper**
   - **Step 1 · Select Shifts & Review Guardrails**: Select verified timesheets and inspect automated flags (`MAX_SHIFT_EXCEEDED`, `DUPLICATE_SHIFT`, `CAP_EXCEEDED`). Record supervisor overrides directly to the immutable audit log.
   - **Step 2 · Compensation Preview**: Real-time stroop calculation displaying regular hours, overtime (1.25x statutory rate), gross earnings, withholding taxes, and exact settlement amounts locked to current FX quotes.
   - **Step 3 · Preflight Reserve & Trustless In-Browser Decoder**: Unsigned XDR transactions are parsed directly in the browser with `@stellar/stellar-sdk` before signing. Inspects source account, network passphrase, operation count, exact recipient routing, and the RFC-8785 SHA-256 MemoHash. Offers 1-click Demo Treasury settlement on Testnet and Freighter wallet signing on Testnet/Mainnet.
   - **Step 4 · Confirmed Receipts & 1-Page PDF Payslips**: Real-time confirmation displaying ledger sequence number and transaction hash. Generates per-employee printable payslips formatted for clean `@media print` physical or PDF archiving.

2. **Smart Recipient Operation Routing**
   - **Funded XLM Accounts**: Disburses direct `Operation.payment`.
   - **Unfunded Accounts (&gt;= 1 XLM)**: Executes `Operation.createAccount` to establish and fund the recipient account in a single atomic transaction.
   - **Micro-Payments (&lt; 1 XLM) or USDC without Trustline**: Creates `Operation.createClaimableBalance` with two claimants: unconditional immediate access for the employee, and a 30-day time-locked recovery predicate for the treasury.

3. **Cryptographic MemoHash Integrity**
   - Every pay run calculates an RFC-8785 canonical JSON digest containing recipient addresses, amounts, and period metadata.
   - The resulting SHA-256 hash is embedded directly into the transaction `Memo.hash`, providing cryptographic proof on Stellar Horizon that disbursement matches payroll records.

4. **Fintech Design System**
   - **Daylight Theme**: `#F8FAFC` canvas, crisp elevated white cards, royal cobalt CTAs (`#2563EB`), and emerald settlement badges.
   - **Obsidian Dark Theme**: `#090D16` deep canvas, slate-900 cards, and high-contrast typography.
   - **Strict Typography**: Tabular monospace styling restricted strictly to amounts, hours, wallet chips, and hashes (`font-mono tabular-nums`).

---

## Directory Layout

```text
30_Deliverables/sweldosync/
├── apps/
│   ├── server/             # Express API, SQLite persistence, Stellar Horizon bridge
│   │   ├── src/
│   │   │   ├── db.js       # SQLite WASM atomic persistence
│   │   │   ├── index.js    # Express application & REST routes
│   │   │   └── stellar-service.js # Horizon routing, XDR builder, demo funder
│   │   └── test/           # Integration & routing tests
│   └── web/                # React 19 + Vite + Tailwind v4 + Framer Motion
│       ├── src/
│       │   ├── components/ # Shell, Common UI, and 5 Application Views
│       │   ├── context/    # AppContext (theme, network, wallet, bootstrap)
│       │   ├── services/   # API client & trustless Stellar XDR decoder
│       │   └── main.jsx
│       └── vite.config.js  # Vite bundler, proxy configuration, chunk splitting
├── packages/
│   ├── agent/              # Payroll calculation engine, guardrail evaluator, MemoHash
│   └── shared/             # Stroop BigInt arithmetic, network configs, address helpers
├── render.yaml             # Render Blueprint configuration
└── package.json            # Monorepo workspaces definition
```

---

## Quick Start

### 1. Requirements
- Node.js &gt;= 20.0.0
- npm &gt;= 10.0.0

### 2. Run the Development Environment
```bash
# Start backend API (defaults to PORT 3001)
npm run dev:server

# Start Vite frontend (defaults to PORT 3000 with proxy to 3001)
npm run dev:web
```

### 3. Build for Production
```bash
npm run build
```
This compiles the single-page application into `apps/web/dist` with optimized vendor code-splitting (`stellar`, `motion`, `lucide`).

### 4. Run Automated Test Suites
```bash
npm test
```
Executes the full test suite including BigInt stroop math verification, guardrail evaluations, RFC-8785 JSON canonicalization, zero-secret scanning, and HTTP API integration.

---

## Production Deployment (Render)

SweldoSync includes a deployment configuration file (`render.yaml`) ready for Render Blueprints:

- **Build Command**: `npm ci --include=dev && npm run build`
- **Start Command**: `npm start`
- **Health Check**: `/healthz`
- **Persistent Disk**: Mounted at `/opt/render/project/src/data` for persistent SQLite database retention across restarts.
- **Environment Variables**: Managed securely through the Render dashboard (`ADMIN_TOKEN`, `AGENT_SECRET_KEY`, `NOIR_VERIFIER_CONTRACT_ID`).
