import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [task,result]=process.argv.slice(2);
if(!/^[a-z0-9-]{1,40}$/.test(task||'')||!['success','failure','cancelled','skipped'].includes(result)) throw Error('Expected a safe task name and a workflow step result');
const digest=path=>createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex');
const installed=path=>existsSync(resolve(root,path))?JSON.parse(readFileSync(resolve(root,path),'utf8')).version:null;
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const worktreeDirty=Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',timeout:10000}).trim());
const receipt={schema:1,task,workflow_steps_result_before_receipt:result,checked_at:new Date().toISOString(),revision,worktree_dirty:worktreeDirty,
  environment:{node:process.version,npm:execFileSync('npm',['--version'],{encoding:'utf8'}).trim(),platform:process.platform,architecture:process.arch,runner_os:process.env.RUNNER_OS||null},
  lockfiles:{'package-lock.json':digest('package-lock.json'),'native-app/package-lock.json':digest('native-app/package-lock.json')},
  installed_tools:{playwright:installed('node_modules/@playwright/test/package.json'),pglite:installed('node_modules/@electric-sql/pglite/package.json'),expo:installed('native-app/node_modules/expo/package.json')},
  github:{repository:process.env.GITHUB_REPOSITORY||null,run_id:process.env.GITHUB_RUN_ID||null,run_attempt:process.env.GITHUB_RUN_ATTEMPT||null},
  verification_kind:'automated_software_checks',physical_acceptance:false};
const directory=resolve(root,'.verification-receipts');mkdirSync(directory,{recursive:true});writeFileSync(resolve(directory,`${task}.json`),JSON.stringify(receipt,null,2)+'\n');
console.log(`Saved ${task} verification evidence for ${revision}`);
