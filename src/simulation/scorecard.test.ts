import { runComparisonMode } from './agentIntegration';

function runSanityCheckTest() {
  console.log(
    '--- TEST 1: Dual-Run Comparison with disabled agents in BOTH runs ---'
  );
  const seed = 12345;
  const resultsDisabled = runComparisonMode(seed, true);

  console.log(`Protected Minutes: ${resultsDisabled.protectedMinutes}`);
  console.log('Exposure times in Run A:', resultsDisabled.runA.exposure);
  console.log('Exposure times in Run B:', resultsDisabled.runB.exposure);

  const keys = Object.keys(resultsDisabled.runA.exposure);
  let matchCount = 0;
  keys.forEach((key) => {
    const valA = resultsDisabled.runA.exposure[key];
    const valB = resultsDisabled.runB.exposure[key];
    if (Math.abs(valA - valB) < 1e-6) {
      matchCount++;
    }
  });

  const test1Passed =
    matchCount === keys.length && resultsDisabled.protectedMinutes === 0;
  console.log(`TEST 1 RESULT: ${test1Passed ? 'PASSED' : 'FAILED'}`);

  console.log(
    '\n--- TEST 2: Real Comparison (Unassisted Run A vs Guided Run B) ---'
  );
  const resultsNormal = runComparisonMode(seed, false);
  console.log(`Protected Minutes: ${resultsNormal.protectedMinutes} min`);
  console.log('Run A (Unassisted) Exposure Times:');
  Object.keys(resultsNormal.runA.exposure).forEach((k) => {
    console.log(`  ${k}: ${resultsNormal.runA.exposure[k].toFixed(2)}s`);
  });
  console.log('Run B (Guided) Exposure Times:');
  Object.keys(resultsNormal.runB.exposure).forEach((k) => {
    console.log(`  ${k}: ${resultsNormal.runB.exposure[k].toFixed(2)}s`);
  });
  console.log(`Log message detail: "${resultsNormal.runB.detailMessage}"`);

  if (test1Passed) {
    console.log('\nALL TESTS COMPLETED SUCCESSFULLY.');
  } else {
    throw new Error(
      'TEST FAILED: Unsafe exposure times differ or Protected Minutes is non-zero.'
    );
  }
}

runSanityCheckTest();
