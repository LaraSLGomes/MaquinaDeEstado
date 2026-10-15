import { runAllScenarios } from './src/engine/testScenarios.js';

const results = runAllScenarios();
for (const [index, result] of results.entries()) {
  const status = result.passed ? 'APROVADO' : 'REPROVADO';
  console.log(`${String(index + 1).padStart(2, '0')} ${status} | ${result.name}`);
  if (result.error) console.error(`   ${result.error}`);
  if (result.details) console.log(`   ${JSON.stringify(result.details)}`);
}

const passed = results.filter((result) => result.passed).length;
console.log(`\nResultado: ${passed}/${results.length} cenários aprovados.`);
if (passed !== results.length) process.exitCode = 1;