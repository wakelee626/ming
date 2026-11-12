/* Integer allocation uses largest remainders so every soldier is accounted for. */
function armyComposition(total, entries){
 const men=Math.max(0,Math.floor(Number(total)||0));
 const valid=entries.filter(e=>Number.isFinite(e.weight)&&e.weight>0);
 const sum=valid.reduce((n,e)=>n+e.weight,0);
 if(!sum)return [];
 const rows=valid.map((e,index)=>{const exact=men*e.weight/sum;return {...e,index,men:Math.floor(exact),fraction:exact-Math.floor(exact)}});
 let remaining=men-rows.reduce((n,e)=>n+e.men,0);
 for(const row of [...rows].sort((a,b)=>b.fraction-a.fraction||a.index-b.index)){if(remaining--<=0)break;row.men++}
 return rows.map(({unitId,men,weight})=>({unitId,men,percent:weight/sum*100}));
}
