import { ensureConnector, forgeStatus, registerPatientTeam } from '../server/trueforge.js';
import { Store } from '../server/store.js';
const store = new Store();
const patients = store.all('patient');
store.close();
const status = await forgeStatus();
if (!status.connected) {
  console.error('Start TrueForge at http://localhost:8790, then retry.');
  process.exit(1);
}
for (const p of patients) console.log(`Registered connector: ${await ensureConnector(p.id)}`);
if (status.ready) {
  for (const patient of patients) {
    for (const agent of await registerPatientTeam(patient.id, status.selectedModel))
      console.log(`${agent.created ? 'Saved' : 'Preserved existing'} agent: ${agent.name}`);
  }
  console.log(`Team model: ${status.selectedModel}. Existing definitions and credentials were not replaced.`);
} else
  console.log(
    'Legacy connectors are ready. Configure an available model in TrueForge Settings → Models, then rerun to register the role-scoped team. Existing saved definitions are preserved; live app sessions use the current inline specs.',
  );
