# Undertow — Predictive Crowd-Safety Intelligence

Undertow is a multi-agent, GenAI-enabled crowd egress simulation built for the **"Smart Stadiums & Tournament Operations"** challenge (FIFA World Cup 2026 track) as part of Hack2Skill's **PromptWars Virtual (Challenge 4)**. Undertow simulates real-time crowd dynamics, predicts gate congestion, routes vulnerable fans via safer/calmer zones, reunifies separated family members, and enables stadium operators to verify high-stakes safety recommendations (such as gate overrides or security dispatches). Deployed live at: **[https://undertow-alpha.vercel.app/](https://undertow-alpha.vercel.app/)**

---

## The Problem

Most modern stadium safety systems are designed around getting fans **IN** (optimizing entry gates, ticket validation, and queue movement). Egress—safely getting tens of thousands of fans **OUT** of a stadium during a crowd surge—remains a highly dangerous, underserved safety hazard. During exit rushes, density peaks can cause visual blockages, physical pressure, and severe distress. These hazards disproportionately affect vulnerable demographics:
* **Mobility-Imaired Fans**: Require wider clearance envelopes and cannot navigate steep turns or bottlenecked corridors.
* **Elderly Fans**: Have slower reaction times, reduced balance adjustability, and are highly susceptible to tripping.
* **Sensory-Sensitive Fans**: Experience severe psychological distress and panic under close physical contact and loud ambient noise.
* **Separated Families**: Guardians and children are frequently separated by lateral crowd friction, making independent search vectors impossible.

Undertow models these specific constraints dynamically, mitigating egress congestion before it becomes critical.

---

## What It Does

Undertow models the stadium evacuation flow using **five real, specialized agents** working in parallel:

| Agent | Operation Mode | Primary Function / Description |
| :--- | :--- | :--- |
| **Crowd-Flow** | Deterministic | Constantly calculates density trends and projects estimated times to overload (ETA) for each gate based on localized crowd velocity vectors. |
| **Routing** | Deterministic | Employs A\* pathfinding to guide vulnerable entities. If preferred low-density paths are blocked, it executes staged fallback relaxation of density/sensory constraints to find the safest possible route. |
| **Reunification** | Deterministic | Detects parent-child separation via spatial distance checks and dynamically calculates a safe meeting waypoint based on intersecting velocity vectors. |
| **Panic-Language** | LLM-based (Groq/Llama 3.3) | Classifies multilingual distress text alerts sent by fans. It filters out false alarms (e.g., general complaints) and translates urgent alerts to identify genuine safety risks. |
| **Verification** | Hybrid (Deterministic + LLM) | Scores recommend actions using a deterministic, auditable formula based on agent confidence and target risk. Generates natural language justifications via an LLM, routing high-stakes safety recommendations to a human operator for final approval. |

---

## Key Design Principles

1. **LLM Partitioning**: LLMs are strictly quarantined for unstructured text classification (multilingual panic alerts) and generating operator justifications. Safety-critical operations like routing, pathfinding, and collision math remain fully deterministic, auditable, and mathematically verifiable.
2. **True Comparative Scorecard**: The "Protected Minutes" scorecard does not rely on estimates. It runs the full 85-second simulation twice programmatically using a fixed random seed—Run A (all agents disabled) and Run B (all safety agents enabled)—and sums the exact duration vulnerable entities spend in unsafe densities. A passing unit test ensures its mathematical accuracy and sanity.
3. **Human-in-the-Loop Validation**: System confidence scoring is governed by fixed, auditable formulas, never hallucinated by an LLM. High-stakes safety overrides (such as locking/unlocking gates or deploying first responders) require explicit human approval via the Operator Console.

---

## Tech Stack

Undertow is built using a modern, performant web technology stack:
* **Framework**: React 19 (TypeScript)
* **Build Tooling**: Vite 8
* **State Management**: Zustand 5
* **Animations**: Framer Motion 12
* **Styling**: Tailwind CSS 4
* **LLM Engine**: Groq SDK (Llama 3.3 70B Model)
* **Code Quality**: ESLint 10, Prettier 3

---

## Project Structure

```text
undertow/
├── src/
│   ├── App.tsx                     # Main dashboard container & Operator HUD UI
│   ├── main.tsx                    # React mounting root
│   ├── index.css                   # Tailwind setup and global keyframe animations
│   ├── agents/                     # Multi-Agent logic
│   │   ├── crowdFlow.ts            # Density forecasting & gate overload ETA calculations
│   │   ├── panicLanguage.ts        # Groq/Llama 3.3 multilingual panic classification
│   │   ├── reunification.ts        # Separation detection & meeting point calculation
│   │   ├── routing.ts              # Deterministic A* with staged fallback thresholds
│   │   └── verification.ts         # Deterministic confidence formulas & LLM justifications
│   ├── simulation/                 # Evacuation physics sandbox
│   │   ├── Particle.ts             # Crowd and vulnerable entity physics behavior
│   │   ├── SimulationWorld.ts      # Core 2D physics engine & spatial partition loops
│   │   ├── SpatialHashGrid.ts      # O(N) neighborhood query optimization grid
│   │   ├── agentIntegration.ts     # Multi-agent controller and comparative simulation run
│   │   ├── scorecard.test.ts       # Automated comparative dual-run verification test
│   │   ├── types.ts                # TypeScript type definitions
│   │   └── debug_peaks.ts          # Seed test script for peak density tracking
│   ├── data/
│   │   ├── stadiumLayout.ts        # Stadium coordinates, boundaries, and zones
│   │   └── venuePolicy.json        # Stadium security codes and response SOPs
│   └── assets/                     # Graphic resources and icons
├── .env.example                    # Environment variable configuration template
├── package.json                    # Dependencies configuration
└── tsconfig.json                   # TypeScript configuration
```

---

## Running Locally

### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org/) installed (v18+ recommended).

### 2. Installation
Clone the repository and install all dependencies:
```bash
npm install
```

### 3. Configure Environment Variables
Copy the `.env.example` template to create a local environment file:
```bash
cp .env.example .env
```
Open the `.env` file and insert your Groq API Key:
```text
VITE_GROQ_API_KEY=your_real_groq_api_key_here
```

### 4. Run Development Server
Launch the development server:
```bash
npm run dev
```
Open **[http://localhost:5173/](http://localhost:5173/)** in your browser to view the sandbox.

---

## Verification & Tests

To execute the automated scorecard sanity test (Run A vs Run B comparative runs):
```bash
npx tsx src/simulation/scorecard.test.ts
```

---

*Undertow was developed as part of Hack2Skill's PromptWars Virtual Challenge 4 under Google Antigravity pair programming.*
