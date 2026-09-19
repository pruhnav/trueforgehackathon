import { ensureConnector, forgeStatus, forgeRequest, agentSpec } from '../server/trueforge.js';
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
  const name = 'homeward-discharge-copilot';
  const agents = await forgeRequest('/agents');
  if (!agents.data.some((a) => a.name === name))
    await forgeRequest('/agents', {
      method: 'POST',
      body: JSON.stringify({
        name,
        description: 'Source-grounded discharge follow-up for fictional patient Alex Morgan.',
        manifest: agentSpec(status.selectedModel, 'homeward-demo-001', 'demo-001'),
      }),
    });
  console.log(`Saved agent: ${name}. Model: ${status.selectedModel}`);
} else
  console.log(
    'Connectors are ready. Configure a model in TrueForge Settings → Models, then rerun this command to save the agent.',
  );
