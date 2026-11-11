# SweldoSync

Autonomous agentic payroll engine built on Stellar Testnet and Velo.

SweldoSync models employee compensation as an autonomous 3-layer agent loop that audits incoming timesheet records, computes wages with overtime multipliers and statutory withholding, evaluates policy spending caps, and executes wage disbursements directly on the Stellar Testnet.

## System Architecture

```text
+-------------------------------------------------------------+
| Layer 1: Perception & Sanity Evaluator                      |
| - Ingests timesheets and work logs                         |
| - Rejects non-positive hours (<=0h)                        |
| - Flags impossible shifts (>16h daily ceiling)             |
| - Detects duplicate entries per employee/date               |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Layer 2: Reasoning & Policy Evaluator                       |
| - Regular wages: regular_hours * base_rate                  |
| - Overtime wages: overtime_hours * (base_rate * 1.25)       |
| - Statutory withholding: 5% flat deduction                 |
| - Guardrail check: net_payout <= max_auto_payout_xlm       |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Layer 3: Autonomous Stellar Action                          |
| - Submits live payment operation to Horizon testnet        |
| - Auto-funds destination accounts via Friendbot on 404     |
| - Emits audit receipts with stellar.expert tx links         |
+-------------------------------------------------------------+
```

## Directory Structure

```text
30_Deliverables/sweldosync/
├── apps/
│   ├── server/           # Express REST API, Stellar Horizon helper, Velo proxy
│   │   ├── package.json
│   │   └── src/index.js
│   └── web/              # Minimalist dashboard UI with <velo-wallet>
│       ├── index.html
│       ├── css/style.css
│       └── js/app.js
├── packages/
│   ├── agent/            # 3-Layer PayrollAgent & verification test suites
│   │   ├── package.json
│   │   ├── src/payroll-agent.js
│   │   └── scripts/verify-all.js
│   └── shared/           # Constants, roster defaults, contract IDs
│       ├── package.json
│       └── src/index.js
├── .env
├── .env.template
├── package.json          # Root npm workspaces configuration
└── README.md
```

## Protocol Constants

- Velo Project Key: `vw_pk_JfssyvlfNeu7dYgW4dXuGccU8s2m5f-X`
- Velo API Key: `tk_live_3d5e9d72414374917173f784cc446e28`
- Device Registry Contract: `CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5`
- Agent Registry Contract: `CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV`
- Payment Escrow Contract: `CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS`
- Native SAC Contract: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- Network: Stellar Testnet (`https://horizon-testnet.stellar.org`)

## API Endpoints

- `GET /api/employees` - Returns employee roster and active wage policies.
- `POST /api/worklogs` - Submits a timesheet work log.
- `GET /api/worklogs` - Returns all recorded work logs and processing statuses.
- `POST /api/agent/cycle` - Executes the autonomous agent cycle on pending work logs.
- `GET /api/payroll/audit-log` - Returns the audit trail of receipts and on-chain transaction hashes.
- `GET /api/v1/wallet-config/:projectKey` - Local CORS proxy for Velo wallet configuration.
- `GET /api/health` - System health check.

## Setup and Verification

Run the automated verification suite:

```bash
node packages/agent/scripts/verify-all.js
```

Start the Express server and web dashboard:

```bash
npm start
```

Open `http://localhost:3001` in your browser.
