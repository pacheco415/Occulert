// Shared pixel-space eye geometry for parked experiments and offline datasets.
(function(root){
  function eyeEAR(landmarks,indices,width,height){
    if(!Array.isArray(landmarks)||!Array.isArray(indices)||indices.length!==6||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width>16384||height>16384)return NaN;
    const points=indices.map(index=>landmarks[index]);
    if(points.some(point=>!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)))return NaN;
    const distance=(a,b)=>Math.hypot((a.x-b.x)*width,(a.y-b.y)*height);
    const horizontal=distance(points[0],points[3]);
    if(horizontal<.001)return NaN;
    return(distance(points[1],points[5])+distance(points[2],points[4]))/(2*horizontal);
  }
  const left=Object.freeze([362,385,387,263,373,380]),right=Object.freeze([33,160,158,133,153,144]);
  function meanEyes(landmarks,width,height){return(eyeEAR(landmarks,left,width,height)+eyeEAR(landmarks,right,width,height))/2;}
  const api=Object.freeze({eyeEAR,meanEyes,left,right});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.OcculertEARGeometry=api;
})(typeof globalThis!=='undefined'?globalThis:this);
