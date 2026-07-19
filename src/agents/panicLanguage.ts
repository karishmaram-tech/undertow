import venuePolicy from '../data/venuePolicy.json';
import {
  agentLogEvents,
  lastSimulationTime,
} from '../simulation/agentIntegration';

export interface DistressClassification {
  distressLevel: 'none' | 'mild' | 'severe';
  keywords: string[];
  reasoning: string;
}

// Module-level state for tracking distress scores per zone
// distress score is in range [0, 1]
const zoneDistressScores = new Map<string, number>();

// Decay rate: distress score decays by 0.02 units per second of simulated time
const DECAY_RATE_PER_SECOND = 0.02;

/**
 * Reset distress scores (useful during simulation reset)
 */
export function resetPanicLanguage() {
  zoneDistressScores.clear();
}

/**
 * Get current distress score for a zone (clamped to [0, 1])
 */
export function getZoneDistressScore(zoneId: string): number {
  return zoneDistressScores.get(zoneId) || 0;
}

/**
 * Directly set distress score for a zone (useful for testing/seeding)
 */
export function setZoneDistressScore(zoneId: string, score: number) {
  zoneDistressScores.set(zoneId, Math.max(0, Math.min(1, score)));
}

/**
 * Apply decay to all active zone distress scores
 * @param dt Simulated time step in seconds
 */
export function tickDistressScores(dt: number) {
  zoneDistressScores.forEach((score, zoneId) => {
    const newScore = Math.max(0, score - DECAY_RATE_PER_SECOND * dt);
    if (newScore === 0) {
      zoneDistressScores.delete(zoneId);
    } else {
      zoneDistressScores.set(zoneId, newScore);
    }
  });
}

/**
 * Helper to calculate keyword overlap score between message and incident patterns
 */
function getKeywordRelevanceScore(message: string, keywords: string[]): number {
  const lowercaseMsg = message.toLowerCase();
  let score = 0;
  keywords.forEach((kw) => {
    if (lowercaseMsg.includes(kw.toLowerCase())) {
      score += 2.0; // Word matches increase relevance
    }
  });
  return score;
}

/**
 * Retrieves the 2-3 most relevant snippets from venuePolicy.json based on keyword match
 */
export function retrieveRelevantPolicyContext(message: string): string[] {
  const snippets: { text: string; score: number }[] = [];

  // 1. Check incident patterns
  venuePolicy.incidentPatterns.forEach((pattern) => {
    const score = getKeywordRelevanceScore(message, pattern.keywords);
    if (score > 0) {
      snippets.push({
        text: `Incident Profile [${pattern.patternId}]: ${pattern.description}`,
        score,
      });
    }
  });

  // 2. Check general thresholds and closure conditions
  venuePolicy.operatingThresholds.closureConditions.forEach((condition) => {
    const keywords = [
      'lockdown',
      '2.0 p/m²',
      'fire',
      'weapon',
      'stampede',
      'cpr',
      'unconscious',
      'crushing',
    ];
    const score = getKeywordRelevanceScore(message, keywords);
    if (score > 0) {
      snippets.push({
        text: `Policy Rule: ${condition}`,
        score,
      });
    }
  });

  // Sort by score descending and take top 3
  snippets.sort((a, b) => b.score - a.score);
  return snippets.slice(0, 3).map((s) => s.text);
}

/**
 * Fallback heuristic categorization based on keywords, stems, and semantic phrases.
 * Logs the generated prompt and raw LLM response string to make the process transparent.
 */
function runFallbackHeuristic(
  message: string,
  retrievedContext: string[],
  prompt: string
): DistressClassification {
  const lowercaseMsg = message.toLowerCase();

  // Handle semantic non-keyword cases (e.g., person on the ground, passed out, etc.)
  const isSevereSemantic =
    lowercaseMsg.includes('person on the ground') ||
    lowercaseMsg.includes("nobody's helping") ||
    lowercaseMsg.includes('fainted') ||
    lowercaseMsg.includes('passed out') ||
    lowercaseMsg.includes('injury') ||
    lowercaseMsg.includes('injured');

  // Severe Indicators (Medical, Weapon, Fire, Stampede) - Stemmed to support plurals and genders
  const severeKeywords = [
    // English
    'cpr',
    'collapse',
    'unconscious',
    'suffocat',
    'crush',
    'stampede',
    'trample',
    'shooter',
    'gun',
    'weapon',
    'smoke',
    'fire',
    'emergency',
    // Spanish
    'colapso',
    'inconsciente',
    'asfixia',
    'aplasta',
    'avalancha',
    'dispar',
    'arma',
    'fuego',
    'humo',
    'médico',
    'socorro',
    'ayuda',
    'muere',
    'tiro',
    // Portuguese
    'desmaio',
    'sufoco',
    'esmagad',
    'correria',
    'fumaça',
    'ajuda',
    'morre',
  ];

  // Mild Indicators (Congestion, slow flow, minor discomfort) - Stemmed
  const mildKeywords = [
    // English
    'slow',
    'crowd',
    'anxious',
    'stuck',
    'pushing',
    'congest',
    // Spanish
    'lento',
    'lenta',
    'ansioso',
    'atrapado',
    'empuja',
    'tapón',
    // Portuguese
    'preso',
    'empurra',
    'apertado',
    'devagar',
    'lotado',
    'espera',
  ];

  const severeMatches = severeKeywords.filter((kw) =>
    lowercaseMsg.includes(kw)
  );
  const mildMatches = mildKeywords.filter((kw) => lowercaseMsg.includes(kw));

  let distressLevel: 'none' | 'mild' | 'severe' = 'none';
  let reasoning = 'No critical threat keywords identified in chatter.';
  const keywords = [...severeMatches, ...mildMatches];

  if (isSevereSemantic || severeMatches.length > 0) {
    distressLevel = 'severe';
    if (isSevereSemantic && severeMatches.length === 0) {
      keywords.push('injury_semantic');
    }
    reasoning = `Retrieved context triggers severe alert. Critical keywords: [${keywords.join(', ')}]. Policy matching implies immediate action. Context matched: "${retrievedContext[0] || 'None'}".`;
  } else if (mildMatches.length > 0) {
    distressLevel = 'mild';
    reasoning = `Retrieved context triggers warning threshold. Mild keywords detected: [${mildMatches.join(', ')}]. Context matched: "${retrievedContext[0] || 'None'}".`;
  }

  const rawJsonOutput = JSON.stringify(
    {
      distressLevel,
      keywords,
      reasoning,
    },
    null,
    2
  );

  // LOG BOTH THE PROMPT AND THE DETAILED DETERMINISTIC FALLBACK RESULT FOR REVISIBILITY
  console.log(
    '\n=================== CLASSIFIER PROMPT SENT ==================='
  );
  console.log(prompt);
  console.log('=========================================================');
  console.log(
    '\n========= FALLBACK HEURISTIC RESPONSE (Deterministic Fallback) ========='
  );
  console.log(rawJsonOutput);
  console.log('=========================================================\n');

  return {
    distressLevel,
    keywords,
    reasoning,
  };
}

declare const process: { env: Record<string, string> };

/**
 * Executes the LLM classification, either calling a live Groq API endpoint or falling back to the heuristic logger
 */
async function fetchLLMClassification(
  message: string,
  retrievedContext: string[]
): Promise<DistressClassification> {
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

  const prompt = `You are a stadium crowd monitoring safety AI. Classify the message below.
Safety Policy Rules Context:
${retrievedContext.join('\n')}

Message: "${message}"

CLASSIFICATION RULES:
- Reserve "severe" ONLY for messages indicating direct physical harm, active medical emergencies (e.g. collapse, fainting, can't breathe, unconscious, bleeding, active CPR), active fires, weapons, or active stampedes with immediate injuries.
- Classify general crowd pressure, slowness, tight spacing, anxiety, or pushing without an explicit active harm or collapse signal as "mild" (even if they mention pushing or slow movement).
- Classify general chatter or questions with no distress as "none".

Return a raw JSON object matching this schema:
{
  "distressLevel": "none" | "mild" | "severe",
  "keywords": string[],
  "reasoning": string
}`;

  if (!apiKey || apiKey === 'YOUR_GROQ_API_KEY_HERE') {
    // If no key is set, run heuristic and print the mock prompt and raw output to show mechanism
    return runFallbackHeuristic(message, retrievedContext, prompt);
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
        response_format: { type: 'json_object' },
      }),
    });
    const data = await response.json();

    if (
      !data.choices ||
      data.choices.length === 0 ||
      !data.choices[0].message ||
      !data.choices[0].message.content
    ) {
      console.warn(
        'Groq API blocked or returned empty response, falling back:',
        JSON.stringify(data, null, 2)
      );
      return runFallbackHeuristic(message, retrievedContext, prompt);
    }

    const text = data.choices[0].message.content;

    // Log the actual raw response from the live Groq API
    console.log(
      '\n================= LIVE GROQ API RESPONSE =================='
    );
    console.log(text.trim());
    console.log(
      '=============================================================\n'
    );

    const parsed = JSON.parse(text);
    return {
      distressLevel: parsed.distressLevel,
      keywords: parsed.keywords || [],
      reasoning: parsed.reasoning || '',
    };
  } catch (err) {
    console.warn('Groq API failed, using fallback:', err);
    return runFallbackHeuristic(message, retrievedContext, prompt);
  }
}

/**
 * Classifies a distress signal, updates the zone distress score, and returns the classification
 */
export async function classifyDistressSignal(
  message: string,
  zoneId: string
): Promise<DistressClassification> {
  // 1. Context retrieval
  const context = retrieveRelevantPolicyContext(message);

  // 2. LLM / Parser classification
  const classification = await fetchLLMClassification(message, context);

  // 3. Score update
  const currentScore = zoneDistressScores.get(zoneId) || 0;
  let newScore = currentScore;
  if (classification.distressLevel === 'severe') {
    newScore = Math.min(1.0, currentScore + 0.4); // Increment on severe alerts
  } else if (classification.distressLevel === 'mild') {
    newScore = Math.min(1.0, currentScore + 0.15); // Small increment on mild warnings
  }
  zoneDistressScores.set(zoneId, newScore);

  agentLogEvents.push({
    timestamp: lastSimulationTime,
    agentName: 'Panic-Language',
    entityId: zoneId,
    entityName: zoneId.replace('zone-', '').toUpperCase(),
    description: `Classified signal: "${message}" as ${classification.distressLevel.toUpperCase()}. Zone distress score escalated to ${(newScore * 100).toFixed(0)}%.`,
    degraded: classification.distressLevel === 'severe',
  });

  return classification;
}
