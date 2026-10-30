import { auditSourceAssets } from './lib/source-assets.mjs';

const entries = auditSourceAssets();
console.log(`Source assets passed: ${entries.length} registered source output(s).`);
