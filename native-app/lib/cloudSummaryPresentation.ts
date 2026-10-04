/** A local record alone cannot establish that no cloud write occurred. */
export function cloudSummaryPresentation(record: {sessionId?:unknown;cloudSynced?:unknown;cloudSessionId?:unknown}, pendingLocalIds: string[]): {
  icon:'cloud-done-outline'|'cloud-upload-outline'|'phone-portrait-outline';confirmed:boolean;label:string;
} {
  if (record.cloudSynced === true && typeof record.cloudSessionId === 'string' && record.cloudSessionId.trim()) {
    return {icon:'cloud-done-outline',confirmed:true,label:'Saved on this iPhone; cloud completion confirmed'};
  }
  if (typeof record.sessionId === 'string' && pendingLocalIds.includes(record.sessionId)) {
    return {icon:'cloud-upload-outline',confirmed:false,label:'Saved on this iPhone; cloud summary pending'};
  }
  return {icon:'phone-portrait-outline',confirmed:false,label:'Saved on this iPhone; cloud completion not confirmed'};
}
