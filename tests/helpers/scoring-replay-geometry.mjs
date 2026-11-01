// Test-only geometry. Keep this function self-contained for browser initialization.
export function landmarks(frame) {
    if (!frame.hasFace) return null;
    const points=Array.from({length:468},()=>({x:.5,y:.5}));
    for(const [indices,center]of [[[362,385,387,263,373,380],.62],[[33,160,158,133,153,144],.38]]) {
        const h=frame.ear*.05,xy=[[center-.05,.5],[center-.02,.5-h],[center+.02,.5-h],[center+.05,.5],[center+.02,.5+h],[center-.02,.5+h]];
        indices.forEach((index,i)=>{points[index]={x:xy[i][0],y:xy[i][1]};});
    }
    points[4]={x:frame.turned?.8:.5,y:frame.noseY??.55};points[234]={x:.25,y:.6};points[454]={x:.75,y:.6};
    return points;
}

export const scoringGeometryInitScript = `globalThis.__scoringReplayLandmarks = (${landmarks.toString()});`;
