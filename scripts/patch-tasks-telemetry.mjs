// Reproduce the one local vendor modification from the original npm bundle.
// Usage: node scripts/patch-tasks-telemetry.mjs <upstream vision_bundle.js> <output>
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const manifest=JSON.parse(fs.readFileSync(new URL('../vendor/mediapipe/tasks-vision-1.0.1-occulert.1/runtime-manifest.json',import.meta.url)));
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function patchTelemetry(bytes){
 if(digest(bytes)!==manifest.localPatch.upstreamBundleSha256)throw Error('Unexpected upstream Tasks bundle');
 const source=bytes.toString(),start=source.indexOf('var Ah=class{'),end=source.indexOf(',wh=class',start);
 if(start<0||end<0||digest(source.slice(start,end))!==manifest.localPatch.transportSha256)throw Error('Unexpected telemetry transport');
 const output=Buffer.from(source.slice(0,start)+'/* Occulert local patch: disable upstream telemetry transport; see NOTICE.txt. */var Ah=class{async send(t,e){e?.("")}}'+source.slice(end));
 if(digest(output)!==manifest.files.find(file=>file.file==='vision_bundle.js').sha256)throw Error('Patched runtime does not match pins');
 return output;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==4)throw Error('Provide upstream bundle and output paths');
 fs.writeFileSync(process.argv[3],patchTelemetry(fs.readFileSync(process.argv[2])),{flag:'wx'});
}
