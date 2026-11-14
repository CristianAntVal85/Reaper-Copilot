import { call } from './client.mjs';
const ms = []; let fails = 0;
for (let i = 0; i < 200; i++) { const r = await call('ping', {}, 3000); if (r.ok) ms.push(r.roundTripMs); else fails++; }
ms.sort((a, b) => a - b);
console.log(`n=200 ok=${ms.length} fails=${fails} min=${ms[0]} median=${ms[ms.length >> 1]} p95=${ms[Math.floor(ms.length * 0.95)]} max=${ms[ms.length - 1]}`);
