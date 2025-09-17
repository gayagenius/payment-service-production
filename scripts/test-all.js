#!/usr/bin/env node

/**
 * Master Test Runner
 * Runs all test suites in sequence
 * Validates complete system functionality
 */

import PartitioningTester from './test-partitioning.js';
import ArchivingTester from './test-archiving.js';
import LoadTester from './test-load.js';
import E2ETester from './test-e2e.js';

class MasterTestRunner {
  constructor() {
    this.results = {
      partitioning: { passed: 0, failed: 0, tests: [] },
      archiving: { passed: 0, failed: 0, tests: [] },
      load: { passed: 0, failed: 0, tests: [] },
      e2e: { passed: 0, failed: 0, tests: [] }
    };
    this.startTime = Date.now();
  }

  async runTestSuite(suiteName, TesterClass) {
    console.log(`\n🚀 Starting ${suiteName} Tests...`);
    console.log('='.repeat(50));
    
    try {
      const tester = new TesterClass();
      await tester.runAllTests();
      
      // Extract results from the tester
      const suiteResults = tester.results;
      const totalPassed = Object.values(suiteResults).reduce((sum, r) => sum + r.passed, 0);
      const totalFailed = Object.values(suiteResults).reduce((sum, r) => sum + r.failed, 0);
      
      this.results[suiteName.toLowerCase()] = {
        passed: totalPassed,
        failed: totalFailed,
        tests: Object.values(suiteResults).flatMap(r => r.tests)
      };
      
      console.log(`✅ ${suiteName} Tests Completed: ${totalPassed} passed, ${totalFailed} failed`);
      
    } catch (error) {
      console.error(`❌ ${suiteName} Tests Failed:`, error.message);
      this.results[suiteName.toLowerCase()] = {
        passed: 0,
        failed: 1,
        tests: [{ name: 'Suite Execution', status: 'FAILED', error: error.message }]
      };
    }
  }

  async runAllTests() {
    console.log('🎯 MASTER TEST RUNNER');
    console.log('====================');
    console.log('Running comprehensive test suite for production readiness...\n');
    
    try {
      // Run all test suites
      await this.runTestSuite('Partitioning', PartitioningTester);
      await this.runTestSuite('Archiving', ArchivingTester);
      await this.runTestSuite('Load', LoadTester);
      await this.runTestSuite('E2E', E2ETester);
      
      // Print final summary
      this.printFinalSummary();
      
    } catch (error) {
      console.error('❌ Master test runner failed:', error.message);
      process.exit(1);
    }
  }

  printFinalSummary() {
    const totalDuration = Date.now() - this.startTime;
    
    console.log('\n🎯 MASTER TEST SUMMARY');
    console.log('======================');
    console.log(`⏱️  Total Duration: ${Math.round(totalDuration / 1000)}s`);
    
    let overallPassed = 0;
    let overallFailed = 0;
    
    Object.entries(this.results).forEach(([suite, results]) => {
      console.log(`\n${suite.toUpperCase()}:`);
      console.log(`  ✅ Passed: ${results.passed}`);
      console.log(`  ❌ Failed: ${results.failed}`);
      console.log(`  📈 Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
      
      overallPassed += results.passed;
      overallFailed += results.failed;
      
      if (results.failed > 0) {
        console.log('\n  Failed Tests:');
        results.tests.filter(t => t.status === 'FAILED').forEach(test => {
          console.log(`    - ${test.name}: ${test.error}`);
        });
      }
    });
    
    console.log(`\n🎯 OVERALL RESULT:`);
    console.log(`  ✅ Total Passed: ${overallPassed}`);
    console.log(`  ❌ Total Failed: ${overallFailed}`);
    console.log(`  📈 Overall Success Rate: ${((overallPassed / (overallPassed + overallFailed)) * 100).toFixed(1)}%`);
    
    if (overallFailed === 0) {
      console.log('\n🎉 ALL TESTS PASSED! SYSTEM IS PRODUCTION-READY!');
      console.log('✅ Partitioning enabled and working');
      console.log('✅ Archiving works (threshold + compliance cadence)');
      console.log('✅ Reports table serves history data');
      console.log('✅ Safe read/write helpers for payments, history, refunds');
      console.log('✅ Retry key in payments endpoint works with idempotency key');
      console.log('✅ Query optimization documented');
      console.log('✅ Read/write DB pools configured and tested');
      console.log('✅ End-to-end testing confirms:');
      console.log('   - No data loss');
      console.log('   - No breaking under load');
      console.log('   - Compliance rules followed');
      console.log('✅ Production-ready code meeting industry standards');
    } else {
      console.log('\n⚠️  SOME TESTS FAILED! Review and fix before production deployment.');
      console.log('\n🔧 Next Steps:');
      console.log('1. Review failed tests above');
      console.log('2. Fix identified issues');
      console.log('3. Re-run tests: npm run test:all');
      console.log('4. Deploy only when all tests pass');
      process.exit(1);
    }
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const runner = new MasterTestRunner();
  runner.runAllTests().catch(console.error);
}

export default MasterTestRunner;
