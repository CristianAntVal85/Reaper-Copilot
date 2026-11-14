import { call } from './client.mjs';
const ms = [];
for (let i = 0; i < 30; i++) { const r = await call('ping'); ms.push(r.ok ? r.roundTripMs : -1); }
ms.sort((a, b) => a - b);
console.log(`n=${ms.length} min=${ms[0]} median=${ms[15]} max=${ms[29]} fails=${ms.filter((x) => x < 0).length}`);
