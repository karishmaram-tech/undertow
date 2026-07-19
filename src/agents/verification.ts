declare const process: { env: Record<string, string> };

export interface ProposedAction {
  id: string;
  type: string;
  targetId: string;
  triggeringSignals: string[];
}

export interface VerificationResult {
  action: ProposedAction;
  confidence: number;
  status: 'auto-approved' | 'pending-human-approval' | 'rejected';
  justification: string;
}

// In-memory queue of actions waiting for human verification
const pendingApprovals = new Map<string, VerificationResult>();
const historicalLogs: VerificationResult[] = [];

// Deterministic Weight Constants (Not LLM-based)
// 1. CROWD_FLOW_RISK_WEIGHT: Density risk indicates physical volume pressure.
// Primary driver (max 50 points) since physical bottlenecks are the most objective danger.
const CROWD_FLOW_RISK_WEIGHT = 50.0;

// 2. DISTRESS_WEIGHT: Panic language alerts indicate active distress.
// High weight (max 40 points) because panic signs confirm the crowd is in crisis.
const DISTRESS_WEIGHT = 40.0;

// 3. CORROBORATION_BONUS: Reward consensus across multiple sensors / channels.
// Adds 10 points per independent signal to build confidence.
const CORROBORATION_BONUS = 10.0;

// High stakes threshold and action types definition
const HIGH_STAKES_CONFIDENCE_THRESHOLD = 70.0;
const HIGH_STAKES_ACTION_TYPES = new Set([
  'gate_lockdown',
  'full_gate_closure',
  'critical_rerouting',
]);

/**
 * Returns all currently pending high-stakes actions awaiting confirmation
 */
export function getPendingApprovals(): VerificationResult[] {
  return Array.from(pendingApprovals.values());
}

/**
 * Confirms a pending action, removing it from the queue and marking status as approved
 */
export function confirmAction(actionId: string): VerificationResult | null {
  const result = pendingApprovals.get(actionId);
  if (result) {
    result.status = 'auto-approved'; // Now verified/approved
    pendingApprovals.delete(actionId);
    historicalLogs.push(result);
    return result;
  }
  return null;
}

/**
 * Overrides/rejects a pending action, removing it from the queue
 */
export function overrideAction(actionId: string): VerificationResult | null {
  const result = pendingApprovals.get(actionId);
  if (result) {
    result.status = 'rejected';
    pendingApprovals.delete(actionId);
    historicalLogs.push(result);
    return result;
  }
  return null;
}

/**
 * Clears the queue (useful for test resets)
 */
export function resetVerificationQueue() {
  pendingApprovals.clear();
  historicalLogs.length = 0;
}

/**
 * Generates a justification sentence, calling the live Gemini API if a key is present
 * or returning an explicitly-labeled Fallback Heuristic Justification.
 */
async function fetchJustification(
  action: ProposedAction,
  confidence: number
): Promise<string> {
  const apiKey =
    (typeof process !== 'undefined' && process.env.VITE_GROQ_API_KEY) ||
    (typeof window !== 'undefined' &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).GROQ_API_KEY) ||
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    (typeof import.meta !== 'undefined' &&
      import.meta.env &&
      import.meta.env.VITE_GROQ_API_KEY) ||
    '';

  const prompt = `You are a stadium crowd safety dispatcher. Write a single, brief, plain-language justification sentence explaining why the action ${action.type.toUpperCase()} was queued for ${action.targetId} with ${confidence.toFixed(1)}% confidence, citing these triggers: [${action.triggeringSignals.join(', ')}].`;

  if (!apiKey || apiKey === 'YOUR_GROQ_API_KEY_HERE') {
    const signalsText = action.triggeringSignals.join(', ');
    // Clearly prefix as deterministic fallback
    return `[Fallback Heuristic Justification] Action ${action.type.toUpperCase()} on ${action.targetId} is queued with ${confidence.toFixed(1)}% confidence, prompted by triggers: [${signalsText}].`;
  }

  try {
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });
    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (err) {
    console.warn('Justification Groq API failed, using fallback:', err);
    const signalsText = action.triggeringSignals.join(', ');
    return `[Fallback Heuristic Justification] Action ${action.type.toUpperCase()} on ${action.targetId} is queued with ${confidence.toFixed(1)}% confidence, prompted by triggers: [${signalsText}].`;
  }
}

/**
 * Evaluates a proposed action and routes it to auto-approved or pending-approval queues
 */
export async function verifyAction(
  proposed: Omit<ProposedAction, 'id'> & { id?: string },
  riskScore: number, // 0 to 1.0 from crowd flow density risk
  distressScore: number // 0 to 1.0 from panic language signals
): Promise<VerificationResult> {
  const id =
    proposed.id || `action-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const action: ProposedAction = {
    id,
    type: proposed.type,
    targetId: proposed.targetId,
    triggeringSignals: proposed.triggeringSignals,
  };

  // 1. Compute Confidence Score using the documented deterministic formula
  const rawConfidence =
    CROWD_FLOW_RISK_WEIGHT * riskScore +
    DISTRESS_WEIGHT * distressScore +
    CORROBORATION_BONUS * action.triggeringSignals.length;

  const confidence = Math.max(0, Math.min(100, rawConfidence));

  // Determine if it is high stakes
  const isHighStakesType = HIGH_STAKES_ACTION_TYPES.has(action.type);
  const meetsHighStakesConfidence =
    confidence >= HIGH_STAKES_CONFIDENCE_THRESHOLD;

  let status: 'auto-approved' | 'pending-human-approval' | 'rejected';
  let justification: string;

  // 2. Queue for human approval if action is high-stakes or meets the confidence threshold
  if (isHighStakesType || meetsHighStakesConfidence) {
    status = 'pending-human-approval';
    // Call verification wrapper to phrase the justification sentence
    justification = await fetchJustification(action, confidence);
  } else {
    status = 'auto-approved';
    const typeLabel = isHighStakesType ? 'high-stakes' : 'low-stakes';
    justification = `Auto-approved ${typeLabel} action (${action.type}) for target ${action.targetId} (confidence: ${confidence.toFixed(1)}%).`;
  }

  const result: VerificationResult = {
    action,
    confidence,
    status,
    justification,
  };

  if (status === 'pending-human-approval') {
    pendingApprovals.set(action.id, result);
  } else {
    historicalLogs.push(result);
  }

  return result;
}
