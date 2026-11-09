const CAMPAIGN_COLORS={'平稳':'#b9a25d','富庶':'#c2ad65','繁荣':'#d1bd77','旱灾':'#b68b4d','凋敝':'#968461','边警':'#af7857','兵弱':'#a29468','民变':'#aa604a'};
// Shared vertices keep province borders continuous. This remains a schematic atlas.
const ATLAS={
 liaodong:['840,275 863,242 886,204 924,194 940,225 921,259 902,282 887,312 866,337 852,328 867,301 854,294',[895,257]],
 beizhili:['755,315 790,300 820,311 840,275 854,294 867,301 852,328 839,342 835,365 814,370 802,397 782,384 771,349',[811,344]],
 shanxi:['715,331 755,315 771,349 782,384 763,421 733,416 715,379',[747,369]],
 shaanxi:['562,337 603,320 628,341 680,329 715,331 715,379 733,416 706,446 660,437 632,412 606,402 586,365',[675,385]],
 shandong:['835,365 855,369 868,361 878,349 893,349 889,359 908,355 918,364 901,376 883,383 866,410 835,417 802,397 814,370',[853,391]],
 henan:['733,416 763,421 782,384 802,397 835,417 830,447 801,461 757,459 729,442 706,446',[775,435]],
 nanzhili:['835,417 866,410 878,431 882,451 895,465 888,479 901,491 895,505 873,514 846,494 826,503 801,481 801,461 830,447',[856,464]],
 zhejiang:['873,514 895,505 897,521 890,530 895,537 881,544 885,553 871,568 846,575 838,547 846,524 846,494',[868,544]],
 fujian:['846,575 871,568 860,588 862,601 851,614 845,628 832,640 815,656 790,635 804,609 821,586',[832,611]],
 jiangxi:['801,481 826,503 846,494 846,524 838,547 846,575 821,586 804,609 790,635 765,619 761,587 774,555 767,525',[803,552]],
 huguang:['706,446 729,442 757,459 801,461 801,481 767,525 774,555 761,587 765,619 727,615 712,590 690,590 683,555 700,521 685,492',[731,524]],
 sichuan:['632,412 660,437 706,446 685,492 700,521 683,555 651,560 627,578 591,558 565,568 551,539 543,494 562,461 590,446',[617,502]],
 guizhou:['651,560 683,555 690,590 712,590 727,615 704,634 669,625 649,642 627,615 627,578',[673,602]],
 yunnan:['565,568 591,558 627,578 627,615 649,642 623,665 619,697 597,708 580,683 549,691 527,676 536,652 515,640 530,610 548,608',[579,636]],
 guangxi:['649,642 669,625 704,634 727,615 743,640 722,668 721,690 696,695 678,712 651,704 619,697 623,665',[682,665]],
 guangdong:['727,615 765,619 790,635 815,656 795,665 781,678 761,683 752,675 745,692 731,698 712,715 701,713 696,695 721,690 722,668 743,640',[758,655]]
};
// Subdivide shared edges identically in either direction for finer, gap-free boundaries.
for(const geo of Object.values(ATLAS)){
 const vertices=geo[0].split(' ').map(p=>p.split(',').map(Number)),detail=[];
 for(let i=0;i<vertices.length;i++){
  const a=vertices[i],b=vertices[(i+1)%vertices.length],forward=a[0]<b[0]||(a[0]===b[0]&&a[1]<b[1]),s=forward?a:b,t=forward?b:a,dx=t[0]-s[0],dy=t[1]-s[1],len=Math.hypot(dx,dy),steps=Math.max(1,Math.ceil(len/7)),edge=[];
  for(let j=0;j<=steps;j++){const u=j/steps,offset=j===0||j===steps?0:Math.sin(s[0]*13+s[1]*7+j*3.7)*Math.min(1.8,len/10);edge.push([(s[0]+dx*u-dy/len*offset).toFixed(2),(s[1]+dy*u+dx/len*offset).toFixed(2)].join(','));}
  if(!forward)edge.reverse();detail.push(...edge.slice(0,-1));
 }geo[0]=detail.join(' ');
}
let atlasZoom=1,atlasX=0,atlasY=0,drag=null,dragMoved=false;
function renderCampaignMap({svg,provinces,status,open}){
 const ns='http://www.w3.org/2000/svg',n=(tag,a={},text)=>{const e=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(a))e.setAttribute(k,v);if(text)e.textContent=text;return e};
 svg.setAttribute('viewBox','0 0 1400 900');svg.setAttribute('preserveAspectRatio','xMidYMid slice');
 let world=svg.querySelector('#atlas-world'),landLayer=svg.querySelector('#atlas-land'),labels=svg.querySelector('#atlas-labels');
 if(!world){
  // Static backdrop is built once; only the province layer is rebuilt per render.
  const defs=n('defs');defs.innerHTML='<linearGradient id="sea" x2="1" y2="1"><stop stop-color="#9cafaa"/><stop offset=".55" stop-color="#678b96"/><stop offset="1" stop-color="#365e75"/></linearGradient><radialGradient id="earth"><stop stop-color="#a4ab83"/><stop offset="1" stop-color="#748a79"/></radialGradient><filter id="paper"><feTurbulence type="fractalNoise" baseFrequency=".55" numOctaves="3" seed="7"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".17"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter><filter id="relief"><feTurbulence type="fractalNoise" baseFrequency=".022 .05" numOctaves="4" seed="12"/><feDiffuseLighting lighting-color="#dfd2ac" surfaceScale="4" diffuseConstant="1"><feDistantLight azimuth="225" elevation="42"/></feDiffuseLighting><feComposite in2="SourceGraphic" operator="in"/><feBlend in="SourceGraphic" mode="soft-light"/></filter>';
  svg.append(defs,n('rect',{width:1400,height:900,fill:'url(#sea)'}));
  world=n('g',{id:'atlas-world'});svg.append(world);
  const mainland='M-200 -100H1050L1080 60 1054 100 1068 135 1035 160 1047 190 1016 218 1029 244 1002 261 982 288 960 295 940 318 927 349 910 357 889 349 878 349 868 361 855 369 835 365 839 342 852 328 866 337 887 312 902 282 921 259 940 225 924 194 886 204 863 242 840 275 820 311 790 300 755 315 715 331 680 329 628 341 603 320 562 337 586 365 606 402 632 412 590 446 562 461 543 494 551 539 565 568 548 608 530 610 515 640 536 652 527 676 549 691 580 683 597 708 619 697 651 704 678 712 696 695 701 713 689 741 669 765 667 799 637 812 630 847 610 870 602 910 550 960H-200Z';
  world.append(n('path',{d:mainland,fill:'url(#earth)',stroke:'#bac4a0','stroke-width':5}));
  world.append(n('path',{d:'M-100 300Q150 200 350 290T620 230L810 90 980 50 880 -90H-100Z',fill:'#8c9a78',opacity:.7}));
  world.append(n('path',{d:'M880 -30L970 25 1047 70 1054 100 1068 135 1035 160 1047 190 1016 218 1029 244 1002 261 982 288 960 295 940 318 927 349 910 357 889 349 902 282 921 259 940 225 924 194 886 204 850 170 872 130 851 89Z',fill:'#af805b',stroke:'#837553','stroke-width':1.2}));
  // Korea, Japan and Taiwan establish the eastern coastline without adding playable regions.
  for(const d of ['M982 288L1000 303 1008 325 1027 346 1035 372 1052 393 1038 412 1024 402 1015 417 1006 397 994 392 989 372 978 361 982 343 963 322Z','M1151 430L1185 416 1201 393 1223 378 1228 345 1243 337 1246 362 1238 390 1212 416 1195 423 1180 441 1154 449 1131 464 1114 459 1119 447Z','M1098 466L1114 473 1100 488 1084 481Z','M1088 482L1090 501 1077 522 1060 516 1057 501 1071 483Z','M1254 330L1264 304 1295 289 1317 293 1305 312 1280 320 1271 338Z','M909 634Q923 651 902 692L890 698Q887 678 909 634Z','M731 739Q748 733 750 748L739 766 722 763 719 751Z'])world.append(n('path',{d,fill:'#929b71',stroke:'#b3baa0','stroke-width':2}));
  // Deterministic relief strokes: lightweight vector topography rather than a screenshot backdrop.
  const relief=n('g',{'pointer-events':'none',opacity:.28});
  for(let i=0;i<140;i++){const x=60+(i*73%620),y=160+(i*47%570),w=16+(i%5)*9;relief.append(n('path',{d:`M${x-w} ${y+14}q${w/2} -5 ${w} -24q${w/2} 12 ${w} 20m${-w} -20l-4 18`,fill:'none',stroke:i%3?'#5d6553':'#e2d2a5','stroke-width':i%3?2:3}));}world.append(relief);
  landLayer=n('g',{id:'atlas-land'});labels=n('g',{id:'atlas-labels','pointer-events':'none'});world.append(landLayer);
  const terrain=n('g',{filter:'url(#relief)',opacity:.16,'pointer-events':'none'});
  for(const geo of Object.values(ATLAS))terrain.append(n('polygon',{points:geo[0],fill:'#baa46b'}));world.append(terrain);
  const deco=n('g',{'pointer-events':'none'});world.append(deco);
  for(const d of ['M603 354Q628 375 659 365L674 349Q688 344 700 360L699 391Q719 413 753 415T805 424Q836 431 864 414','M562 513Q584 531 611 520T661 511Q674 502 689 521T735 543Q765 539 780 521T825 502Q862 502 894 490','M706 446Q723 467 729 497T735 543','M743 584Q766 573 780 551','M799 572Q808 544 825 526'])deco.append(n('path',{d,fill:'none',stroke:'#547e80','stroke-width':1.7,opacity:.9}));
  deco.append(n('path',{d:'M584 350L607 345 630 359 660 345 690 344 715 342 739 325 761 319 790 310 812 320 833 306 852 296 869 278',fill:'none',stroke:'#885044','stroke-width':4,'stroke-dasharray':'6 2'}));
  for(const [x,y,t]of [[791,311,'宣府镇'],[758,324,'大同镇'],[685,344,'延绥镇'],[612,345,'甘肃镇'],[860,294,'山海关']]){deco.append(n('circle',{cx:x,cy:y,r:2.6,fill:'#5e3c2c',stroke:'#ead7a5','stroke-width':1}),n('text',{x,y:y-8,'text-anchor':'middle',class:'capital'},t));}
  for(const [x,y,t]of [[816,322,'京师'],[867,488,'南京']]){deco.append(n('path',{d:`M${x-9} ${y-2}h18v9h-18zM${x-12} ${y-3}l12-7 12 7z`,fill:'#8f4931',stroke:'#cfb277','stroke-width':1.2}),n('text',{x:x+13,y:y+5,class:'capital'},t));}
  world.append(labels);
  for(const [x,y,t]of [[492,186,'喀尔喀蒙古'],[739,258,'察哈尔'],[964,155,'海西'],[978,244,'建州'],[318,480,'乌思藏'],[469,393,'和硕特部'],[1020,367,'朝鲜'],[1173,470,'日本'],[917,715,'台湾'],[1163,260,'日本海'],[1051,607,'东海'],[850,804,'南海']])world.append(n('text',{x,y,'text-anchor':'middle',style:'font-size:14px;letter-spacing:3px;opacity:.65;stroke-width:2'},t));
  svg.append(n('rect',{width:1400,height:900,fill:'#bcb38e',opacity:.18,filter:'url(#paper)','pointer-events':'none'}));
  const update=()=>world.setAttribute('transform',`translate(${700*(1-atlasZoom)+atlasX} ${450*(1-atlasZoom)+atlasY}) scale(${atlasZoom})`);update();
  const zoom=d=>{atlasZoom=Math.max(.75,Math.min(2.8,atlasZoom+d));update()};document.getElementById('map-in').onclick=()=>zoom(.2);document.getElementById('map-out').onclick=()=>zoom(-.2);document.getElementById('map-home').onclick=()=>{atlasZoom=1;atlasX=atlasY=0;update()};
  svg.onwheel=e=>{e.preventDefault();zoom(e.deltaY<0?.1:-.1)};
  svg.onpointerdown=e=>{if(e.button!==0)return;drag=[e.clientX,e.clientY,atlasX,atlasY];dragMoved=false};
  svg.onpointermove=e=>{if(!drag)return;const dx=e.clientX-drag[0],dy=e.clientY-drag[1];if(Math.abs(dx)+Math.abs(dy)>5){dragMoved=true;svg.classList.add('dragging');svg.setPointerCapture(e.pointerId)}const ratio=Math.min(1400/svg.clientWidth,900/svg.clientHeight);atlasX=drag[2]+dx*ratio;atlasY=drag[3]+dy*ratio;update()};
  svg.onpointerup=svg.onpointercancel=()=>{drag=null;svg.classList.remove('dragging')};
 }
 // Dynamic province layer, rebuilt each render.
 landLayer.replaceChildren();labels.replaceChildren();
 for(const p of provinces){const geo=ATLAS[p.id];if(!geo)continue;const g=n('g',{class:'prov',role:'button',tabindex:0,'aria-label':p.name+'，民心'+p.popular+'，军备'+p.garrison});g.append(n('title',{},p.name+' · 民心'+p.popular+' · 军备'+p.garrison+' · 点击查看地方奏报'));g.append(n('polygon',{id:'province-'+p.id,'data-name':p.name,points:geo[0],fill:CAMPAIGN_COLORS[status(p)],stroke:'#887c4c','stroke-width':1.1,'stroke-linejoin':'round'}));g.onclick=()=>{if(!dragMoved)open(p)};g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(p)}};landLayer.append(g);labels.append(n('text',{x:geo[1][0],y:geo[1][1],'text-anchor':'middle',class:'pname'},p.name),n('text',{x:geo[1][0],y:geo[1][1]+12,'text-anchor':'middle',class:'pstat'},'民'+p.popular+' 军'+p.garrison));}
}
