const { pgFetch, verifyAccessToken, bearerToken } = require('../supabase');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function json(res,status,body) { res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body)); }
module.exports = async function(request,response) {
  const membership = new URL(request.url,'https://occulert.invalid').pathname === '/api/fleet-membership';
  const allowed = membership ? ['GET','POST'] : ['DELETE'];
  if (!allowed.includes(request.method)) { response.setHeader('Allow',allowed.join(', '));return json(response,405,{ok:false,error:'method_not_allowed'}); }
  if (Object.keys(request.query||{}).length) return json(response,400,{ok:false,error:'invalid_query'});
  if (process.env.OCCULERT_FLEET_OFFBOARDING_ENABLED !== 'true') return json(response,501,{ok:false,error:'offboarding_not_enabled'});
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return json(response,501,{ok:false,error:'backend_not_configured'});
  try {
    const user=await verifyAccessToken(bearerToken(request));
    if (!user) return json(response,401,{ok:false,error:'unauthorized'});
    if (request.method === 'GET') {
      const drivers=await pgFetch('drivers',{params:{select:'id,fleet_id',user_id:'eq.'+user.id,limit:'1'}});
      return json(response,200,{ok:true,membership:drivers[0]||null});
    }
    const body=request.body;
    if (!String(request.headers['content-type']||'').toLowerCase().includes('application/json') || !body || typeof body!=='object' || Array.isArray(body) || JSON.stringify(body).length>2048) return json(response,415,{ok:false,error:'invalid_json_body'});
    if (body.confirm!==true) return json(response,400,{ok:false,error:'confirmation_required'});
    const id=membership?body.fleet_id:body.driver_id;
    if (typeof id!=='string'||!UUID.test(id)) return json(response,400,{ok:false,error:membership?'invalid_fleet_id':'invalid_driver_id'});
    const result=await pgFetch(membership?'rpc/leave_fleet':'rpc/remove_fleet_driver',{method:'POST',body:membership?{p_user_id:user.id,p_expected_fleet_id:id}:{p_owner_user_id:user.id,p_driver_id:id}});
    const errors={fleet_not_found:404,driver_not_found:404,driver_profile_not_found:404,membership_changed:409};
    if (result&&Object.hasOwn(errors,result.error)) return json(response,errors[result.error],{ok:false,error:result.error});
    if (!result || (membership?typeof result.left!=='boolean':result.removed!==true)) return json(response,502,{ok:false,error:'offboarding_not_saved'});
    return json(response,200,{ok:true,...result});
  } catch { return json(response,502,{ok:false,error:'supabase_error'}); }
};
