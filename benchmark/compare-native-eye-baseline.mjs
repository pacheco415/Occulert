import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {baselinePreset} from '../native-app/lib/eyeBaselineModel.ts';
import {SENSITIVITY_PRESETS,DEFAULT_SENSITIVITY,PERCLOS_ALERT_THRESHOLD,PERCLOS_WINDOW_MS} from '../native-app/constants/thresholds.ts';
import {RollingClosedFraction} from '../native-app/lib/rollingClosedFraction.ts';
const file='native-app/hooks/useEyeTracking.ts',source=fs.readFileSync(file,'utf8');
const code=source.replace(/^import[\s\S]*?;\s*/gm,'').replace(/^export /gm,'');
const context={useRef:value=>({current:value}),useCallback:fn=>fn,useMemo:fn=>fn,baselinePreset,SENSITIVITY_PRESETS,DEFAULT_SENSITIVITY,PERCLOS_ALERT_THRESHOLD,PERCLOS_WINDOW_MS,RollingClosedFraction};
vm.runInNewContext(stripTypeScriptTypes(code)+'\nglobalThis.create=useEyeTracking;',context);
const rows=[];
for(const baseline of [.5,.8,1])for(const probability of [.2,.4,.6,.8,1]){
 const standard=context.create('medium').processEyeOpenness(probability,probability);
 const calibrated=context.create('medium',baseline).processEyeOpenness(probability,probability);
 rows.push({baseline,syntheticEyeProbability:probability,defaultState:standard.state,experimentalState:calibrated.state,defaultThresholds:SENSITIVITY_PRESETS.medium,experimentalThresholds:baselinePreset('medium',baseline)});
}
const files=[file,'native-app/lib/eyeBaselineModel.ts','native-app/constants/thresholds.ts'];
const receipt={schemaVersion:1,kind:'synthetic_native_baseline_comparison',generatedAt:new Date().toISOString(),physicalAcceptance:false,accuracyEvidence:false,defaultAlertsChanged:false,sources:Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')])),runtime:process.version,rows};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(receipt,null,2)+'\n');else console.log(JSON.stringify(receipt,null,2));
