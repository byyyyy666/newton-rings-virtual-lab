(() => {
  "use strict";
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  function meanProfile(values,radius){
    const out=new Array(values.length),prefix=new Float64Array(values.length+1);
    for(let i=0;i<values.length;i+=1)prefix[i+1]=prefix[i]+values[i];
    for(let i=0;i<values.length;i+=1){
      const a=Math.max(0,i-radius),b=Math.min(values.length,i+radius+1);
      out[i]=(prefix[b]-prefix[a])/Math.max(1,b-a);
    }
    return out;
  }
  function smoothProfile(values,size){return meanProfile(values,Math.floor((Math.max(1,Math.round(size))-1)/2));}
  function maxRange(values,from,to){
    let max=-Infinity;
    for(let i=Math.max(0,Math.floor(from));i<Math.min(values.length,Math.ceil(to));i+=1)if(values[i]>max)max=values[i];
    return max;
  }
  function percentile(values,ratio){
    if(!values.length)return 0;
    const sorted=values.slice().sort((a,b)=>a-b);
    return sorted[clamp(Math.round((sorted.length-1)*ratio),0,sorted.length-1)];
  }
  function findCentralDarkSpot(profile,valleys,minWidth){
    const length=profile.length;
    if(length<24)return null;
    const minimum=Math.min(...profile),median=percentile(profile,.5),spread=median-minimum;
    if(!(spread>4))return null;

    const candidates=(Array.isArray(valleys)?valleys:[])
      .filter(item=>Number.isFinite(item.index)&&item.index>length*.05&&item.index<length*.95&&Number.isFinite(item.width))
      .slice()
      .sort((a,b)=>a.index-b.index);
    if(candidates.length<2)return null;

    const medianValleyWidth=percentile(candidates.map(item=>item.width),.5);
    const usefulValleys=candidates.filter(item=>item.width<=Math.max(minWidth*4,medianValleyWidth*2.4));
    if(usefulValleys.length<2)return null;
    const spacingSamples=[];
    for(let index=1;index<usefulValleys.length;index+=1)spacingSamples.push(usefulValleys[index].index-usefulValleys[index-1].index);
    const medianSpacing=Math.max(4,percentile(spacingSamples,.5));
    const minimumPlateauWidth=Math.max(minWidth*4,medianSpacing*3,length*.03);

    const imageCenter=length*.5;
    const activityRadius=Math.max(minWidth*3.5,length*.055);
    const roughnessRadius=Math.max(5,Math.round(minWidth*.75)),localRoughness=new Array(length);
    for(let index=0;index<length;index+=1){
      let localMin=Infinity,localMax=-Infinity;
      const from=Math.max(0,index-roughnessRadius),to=Math.min(length-1,index+roughnessRadius);
      for(let x=from;x<=to;x+=1){
        localMin=Math.min(localMin,profile[x]);
        localMax=Math.max(localMax,profile[x]);
      }
      localRoughness[index]=localMax-localMin;
    }
    const roughnessLimit=Math.max(3,percentile(localRoughness,.22)),darkLimit=median-spread*.22;
    let best=null;
    for(let index=Math.floor(length*.08);index<Math.ceil(length*.92);index+=1){
      if(profile[index]>darkLimit||localRoughness[index]>roughnessLimit)continue;
      let right=index;
      while(
        right+1<length*.92
        &&profile[right+1]<=darkLimit
        &&localRoughness[right+1]<=roughnessLimit
      )right+=1;
      const width=right-index;
      if(width>=minimumPlateauWidth&&width<=length*.42){
        let total=0,insideMin=Infinity,insideMax=-Infinity;
        for(let x=index;x<=right;x+=1){
          total+=profile[x];
          insideMin=Math.min(insideMin,profile[x]);
          insideMax=Math.max(insideMax,profile[x]);
        }
        const meanValue=total/(width+1),contrast=median-meanValue;
        const searchRadius=Math.max(width*1.1,activityRadius);
        const leftDensity=candidates.filter(item=>item.index<index&&item.index>=index-searchRadius).length;
        const rightDensity=candidates.filter(item=>item.index>right&&item.index<=right+searchRadius).length;
        if(leftDensity<1||rightDensity<1)continue;
        const peakToPeak=insideMax-insideMin;
        if(peakToPeak>Math.max(10,spread*.45))continue;
        const flatnessScore=1-clamp(percentile(localRoughness.slice(index,right+1),.5)/Math.max(1,roughnessLimit),0,1);
        const densityScore=clamp((leftDensity+rightDensity)/10,0,1);
        const center=(index+right)*.5,centerDistance=Math.abs(center-imageCenter);
        const centerScore=1-clamp(centerDistance/(length*.45),0,1);
        const score=width*(.7+.3*flatnessScore)*(.75+.25*densityScore)*(.65+.35*centerScore)*(.85+.15*clamp(contrast/Math.max(1,spread),0,1));
        if(!best||score>best.score){
          best={leftIndex:index,rightIndex:right,width,center,meanValue,contrast,score,leftDensity,rightDensity,meanRoughness:percentile(localRoughness.slice(index,right+1),.5),peakToPeak,leftValleyIndex:null,rightValleyIndex:null};
        }
      }
      index=right;
    }
    if(!best){
      for(let leftIndex=0;leftIndex<usefulValleys.length-1;leftIndex+=1){
        const leftValley=usefulValleys[leftIndex];
        for(let rightIndex=leftIndex+1;rightIndex<usefulValleys.length;rightIndex+=1){
          const rightValley=usefulValleys[rightIndex];
          const leftBoundary=leftValley.index+Math.max(2,leftValley.width);
          const rightBoundary=rightValley.index-Math.max(2,rightValley.width);
          const width=rightBoundary-leftBoundary;
          if(width<minimumPlateauWidth||width>length*.5)continue;
          const searchRadius=Math.max(width*1.2,activityRadius);
          const leftDensity=candidates.filter(item=>item.index<leftBoundary&&item.index>=leftBoundary-searchRadius).length;
          const rightDensity=candidates.filter(item=>item.index>rightBoundary&&item.index<=rightBoundary+searchRadius).length;
          if(leftDensity<2||rightDensity<2)continue;
          let total=0,insideMin=Infinity,insideMax=-Infinity;
          for(let x=leftBoundary;x<=rightBoundary;x+=1){
            total+=profile[x];
            insideMin=Math.min(insideMin,profile[x]);
            insideMax=Math.max(insideMax,profile[x]);
          }
          const meanValue=total/(width+1),contrast=median-meanValue,peakToPeak=insideMax-insideMin;
          if(peakToPeak>spread*1.5)continue;
          const plateauRoughness=percentile(localRoughness.slice(leftBoundary,rightBoundary+1),.5);
          if(plateauRoughness>Math.max(4,percentile(localRoughness,.32)))continue;
          const center=(leftBoundary+rightBoundary)*.5,centerDistance=Math.abs(center-imageCenter);
          const score=width*(1+clamp((leftDensity+rightDensity)/18,0,.5))*(1-clamp(centerDistance/(length*.6),0,.35));
          if(!best||score>best.score){
            best={leftIndex:leftBoundary,rightIndex:rightBoundary,width,center,meanValue,contrast,score,leftDensity,rightDensity,meanRoughness:plateauRoughness,peakToPeak,leftValleyIndex:leftValley.index,rightValleyIndex:rightValley.index};
          }
        }
      }
    }
    if(!best)return null;
    return {
      ...best,
      threshold:median-spread*.18,
      confidence:clamp(.66+clamp(best.width/(length*.16),0,1)*.16+clamp((best.leftDensity+best.rightDensity)/16,0,1)*.12+clamp(best.contrast/72,0,1)*.05,.66,.98)
    };
  }
  function horizontalProfile(imageData,halfWidth){
    const {width,height,data}=imageData,y0=Math.max(0,Math.floor(height/2)-halfWidth),y1=Math.min(height,Math.floor(height/2)+halfWidth+1),profile=new Array(width);
    for(let x=0;x<width;x+=1){
      let total=0;
      for(let y=y0;y<y1;y+=1){
        const o=(y*width+x)*4;
        total+=data[o]*.2126+data[o+1]*.7152+data[o+2]*.0722;
      }
      profile[x]=total/Math.max(1,y1-y0);
    }
    return {profile,y0,y1,centerY:Math.floor(height/2)};
  }
  function valleyWidth(data,index,window,minDepth){
    const left=maxRange(data,index-window,index),right=maxRange(data,index+1,index+window+1),strong=Math.max(left,right),weak=Math.min(left,right),value=data[index],depth=weak-value;
    if(!(depth>0)||strong-value<minDepth||depth<minDepth*.3)return {valid:false,left:index,right:index,width:0,depth:Math.max(0,depth)};
    const half=value+depth*.5;
    let a=index,b=index;
    for(let i=index;i>=0;i-=1)if(data[i]>=half){a=i;break;}
    for(let i=index;i<data.length;i+=1)if(data[i]>=half){b=i;break;}
    return {valid:true,left:a,right:b,width:b-a,depth};
  }
  function findValleys(profile,scale,options){
    const smoothWindow=clamp(Math.round(options.smoothingWindow||7),1,31),minDistance=clamp(Math.round(options.minimumDistance||8),2,40),minDepth=Math.max(.4,Number(options.minimumDepth??options.minimumContrast)||6),window=minDistance*3,smooth=smoothProfile(profile,smoothWindow),raw=[];
    for(let i=window;i<smooth.length-window;i+=1){
      if(!(smooth[i]<smooth[i-1]&&smooth[i]<smooth[i+1]))continue;
      if(valleyWidth(smooth,i,window,minDepth).valid)raw.push(i);
    }
    const filtered=[];
    for(const index of raw.slice().sort((a,b)=>smooth[a]-smooth[b]))if(filtered.every(item=>Math.abs(index-item)>=minDistance))filtered.push(index);
    filtered.sort((a,b)=>a-b);
    let measured=filtered.map(index=>({index,...valleyWidth(smooth,index,window,minDepth)})),removed=[];
    const centralSpot=findCentralDarkSpot(smooth,measured,minDistance*2);
    const median=measured.length>=3?percentile(measured.map(item=>item.width),.5):0;
    const centralWidthRatio=clamp(Number(options.centralWidthRatio)||2.2,1.8,5);
    const widthLimit=median>0?median*centralWidthRatio:Math.max(4,profile.length*.002);
    removed=measured.filter(item=>item.width>widthLimit).map(item=>({
      ...item,
      reason:"wide-half-height"
    }));
    const removedIndexes=new Set(removed.map(item=>item.index));
    measured=measured.filter(item=>!removedIndexes.has(item.index));
    const typical=measured.length?Math.max(minDepth,percentile(measured.map(item=>item.depth),.9)):minDepth,toX=index=>index/scale;
    return {
      smooth,removed:removed.map(item=>({profileIndex:item.index,xPx:toX(item.index),value:smooth[item.index],widthPx:item.width/scale,contrast:item.depth,leftProfileIndex:item.left,rightProfileIndex:item.right,reason:item.reason})),centralDarkSpot:centralSpot?{profileIndex:centralSpot.center,leftProfileIndex:centralSpot.leftIndex,rightProfileIndex:centralSpot.rightIndex,xPx:toX(centralSpot.center),leftXPx:toX(centralSpot.leftIndex),rightXPx:toX(centralSpot.rightIndex),widthPx:centralSpot.width/scale,value:centralSpot.meanValue,contrast:centralSpot.contrast,confidence:centralSpot.confidence}:null,widthLimitPx:widthLimit/scale,smoothWindow,minDepth,minDistance,window,
      valleys:measured.map(item=>({profileIndex:item.index,xPx:toX(item.index),value:smooth[item.index],contrast:item.depth,widthPx:item.width/scale,confidence:clamp(.58+clamp(item.depth/typical,0,1)*.4,0,.99)}))
    };
  }
  function detectDarkRings(source,options={}){
    const sourceWidth=source.videoWidth||source.naturalWidth||source.width,sourceHeight=source.videoHeight||source.naturalHeight||source.height;
    if(!sourceWidth||!sourceHeight)throw new Error("实时画面尺寸不可用");
    const processingLongEdge=clamp(Number(options.processingLongEdge)||1920,640,2560);
    const scale=clamp(processingLongEdge/Math.max(sourceWidth,sourceHeight),.25,3),canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(sourceWidth*scale));
    canvas.height=Math.max(1,Math.round(sourceHeight*scale));
    const context=canvas.getContext("2d",{willReadFrequently:true});
    context.drawImage(source,0,0,canvas.width,canvas.height);
    const imageData=context.getImageData(0,0,canvas.width,canvas.height),halfWidth=clamp(Math.round(Number(options.profileHalfWidth)||5),1,30),band=horizontalProfile(imageData,halfWidth),result=findValleys(band.profile,scale,options);
    return {
      horizontalProfile:band.profile,horizontalSmoothedProfile:result.smooth,horizontalValleys:result.valleys,centralDarkSpot:result.centralDarkSpot,removedCentralValleys:result.removed,removedCentralValleyCount:result.removed.length,centralWidthLimitPx:result.widthLimitPx,scanDirection:"full-horizontal",horizontalStartXPx:0,horizontalStepPx:1/scale,horizontalSmoothingWindow:result.smoothWindow,horizontalMinimumDepth:result.minDepth,horizontalMinimumDistance:result.minDistance,profileHalfWidth:halfWidth,processingLongEdge,processingScale:scale,bandCenterYPx:band.centerY/scale,bandFromYPx:band.y0/scale,bandToYPx:band.y1/scale,sampledWidth:canvas.width,sampledHeight:canvas.height,sourceWidth,sourceHeight,detectedCount:result.valleys.length
    };
  }
  window.NewtonRingDetector={detectDarkRings};
})();
