import app from './app.js';
import { env } from './config/env.js';

app.listen(env.port, () => {
  console.log(`Smart Utility Meter API running on http://localhost:${env.port}`);
  console.log(`Recharge approval: ${env.autoApproveRecharge ? 'AUTO' : 'ADMIN'}`);
});
