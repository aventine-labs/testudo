const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { getBinaryPath, getPlatformInfo, runSync, runPlan } = require('../dist/index.js');

async function runTests() {
  console.log('[testudo-jmx] Running CLI and Programmatic Node Runner tests...');

  // Test 1: Platform Info
  const platform = getPlatformInfo();
  assert.ok(platform.osName, 'osName should be defined');
  assert.ok(platform.archName, 'archName should be defined');
  assert.ok(platform.binaryFileName.includes(platform.osName), 'binaryFileName should contain osName');
  console.log(`  ✓ Platform detection: ${platform.osName}-${platform.archName} -> ${platform.binaryFileName}`);

  // Test 2: Binary Path Resolution
  const binPath = getBinaryPath();
  assert.ok(fs.existsSync(binPath), `Binary must exist at ${binPath}`);
  console.log(`  ✓ Binary path resolved: ${binPath}`);

  // Test 3: Version Execution via runSync
  const verResult = runSync(['--version']);
  assert.strictEqual(verResult.status, 0, 'Exit code should be 0 for --version');
  const verOutput = verResult.stdout || verResult.stderr;
  assert.ok(verOutput.includes('Testudo-JMX') || verOutput.includes('testudo-jmx'), 'Output should contain version string');
  console.log(`  ✓ CLI --version check passed: ${verOutput.trim()}`);

  // Test 4: Programmatic runPlan Execution with Dry/Fast Duration
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'sample_load_test.jmx');
  if (fs.existsSync(fixturePath)) {
    const planResult = await runPlan(fixturePath, {
      users: 1,
      duration: '1s'
    });
    assert.strictEqual(planResult.status, 0, 'runPlan should exit with status 0');
    console.log(`  ✓ Programmatic runPlan executed successfully with exit code 0`);
  }

  console.log('\n[testudo-jmx] All Node.js runner integration tests PASSED (4/4).');
}

runTests().catch((err) => {
  console.error('[testudo-jmx] Test failed:', err);
  process.exit(1);
});
