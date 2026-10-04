import { auditRetiredAssets } from './lib/retired-assets.mjs';
const result = auditRetiredAssets();
console.log(`Retired asset audit passed (${result.assets.length} versioned assets checked).`);
