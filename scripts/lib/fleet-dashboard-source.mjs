import { readFileSync } from 'node:fs';
import { assetByStem } from './current-assets.mjs';
export function fleetDashboardRuntime(){
  const filename=assetByStem('fleet-dashboard.js');
  const markup=readFileSync(new URL('../../fleet-dashboard.html',import.meta.url),'utf8');
  if(!markup.includes(`src="/${filename}"`))throw Error('Dashboard does not load its active runtime');
  return readFileSync(new URL('../../'+filename,import.meta.url),'utf8');
}
// Structural contracts span markup and its explicitly linked external runtime.
// VM behavior tests execute fleetDashboardRuntime(), never fabricated inline HTML.
export function fleetDashboardContract(){return readFileSync(new URL('../../fleet-dashboard.html',import.meta.url),'utf8')+'\n'+fleetDashboardRuntime()}
