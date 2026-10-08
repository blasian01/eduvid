import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {openBrowser, renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import {ensureCachedBrowser} from '../browser-cache.mjs';
import {validatePlan, contentKinds, exerciseNames} from '../validate-plan.mjs';
import {contentFixtures, makeContentPlan} from './content-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Same git-ignored scratch area as the other QA scripts, wherever npm was started from.
const out = process.env.EDUVID_CONTENT_QA_DIR ?? path.join(root, '.qa', 'content');
await mkdir(out, {recursive:true});
const fixtures = contentFixtures();
// Remotion forwards browser console messages to stdout after onBrowserLog.
// Keep per-frame observations in JSON rather than printing thousands of lines.
const originalLog=console.log;
console.log=(...args)=>{if(args.some(value=>typeof value==='string'&&value.includes('EDUVID_CONTENT_QA ')))return;originalLog(...args)};
let validationChild;
const runValidation = (file, output) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'render.mjs'), '--plan', file, '--output', output, '--validate'], {cwd:root});
  validationChild = child;
  let log = '';
  child.stdout.on('data', value => log += value); child.stderr.on('data', value => log += value);
  child.on('error', reject); child.on('close', code => {if(validationChild===child)validationChild=undefined;resolve({code, log})});
});

// Observe the production composition without changing its artwork or source.
// Frame blocking ensures each rendered frame has a matching DOM observation.
const entry = path.join(out, 'content-probe.tsx');
await writeFile(entry, `
import React, {useLayoutEffect} from 'react';
import {Composition, registerRoot, useCurrentFrame, delayRender, continueRender} from 'remotion';
import {EduVidExplainer} from ${JSON.stringify(path.join(root, 'src/Explainer.tsx'))};
const hash = text => {let h=2166136261; for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return(h>>>0).toString(16)};
const labelFit = node => {
  const split=[];const text=node.firstChild;
  if(text?.nodeType===Node.TEXT_NODE) for(const match of text.textContent.matchAll(/\\p{L}{4,}/gu)) {
    const range=document.createRange();range.setStart(text,match.index);range.setEnd(text,match.index+match[0].length);
    const tops=[...new Set([...range.getClientRects()].filter(rect=>rect.width>0).map(rect=>Math.round(rect.top)))];
    if(tops.length>1)split.push(match[0]);
  }
  return {text:node.textContent,fontSize:Number(node.dataset.fontSize),minimum:Number(node.dataset.minFont),width:node.clientWidth,height:node.clientHeight,scrollWidth:node.scrollWidth,scrollHeight:node.scrollHeight,split};
};
const Probe = props => {
  const frame=useCurrentFrame();
  useLayoutEffect(()=>{
    const handle=delayRender('content QA frame '+frame);
    const timer=setTimeout(()=>{
      try {
        const pictures=[...document.querySelectorAll('[data-content-kind]')];
        const picture=pictures[0];
        const box=picture?.getBoundingClientRect();
        const shapes=[...(picture?.querySelectorAll('path,line,circle,rect,polyline,polygon,ellipse')??[])];
        const geometry=shapes.map(node=>node.tagName+['d','x','y','cx','cy','r','rx','ry','x1','x2','y1','y2','width','height','points','transform'].map(key=>node.getAttribute(key)??'').join('|')).join(';');
        const transforms=[...(picture?.querySelectorAll('[transform],[style]')??[])].map(node=>(node.getAttribute('transform')??'')+(node.style?.transform??'')).join(';');
        const generation=[...(picture?.querySelectorAll('[data-generation-token]')??[])].map(node=>({index:Number(node.getAttribute('data-generation-token')),generated:node.getAttribute('data-generated')==='true',current:!!node.querySelector('rect[stroke-width="4"]'),blank:!!node.querySelector('rect[stroke-dasharray]')}));
        const predicted=generation.find(token=>token.current);
        const generationOutput=predicted?!!picture.querySelector('path[d="M509 382L'+(61+predicted.index*115+48)+' 243"]'):false;
        console.log('EDUVID_CONTENT_QA '+JSON.stringify({frame,count:pictures.length,kind:picture?.getAttribute('data-content-kind'),exercise:picture?.getAttribute('data-content-exercise'),cue:picture?.getAttribute('data-content-cue'),shot:picture?.getAttribute('data-content-shot'),caption:document.querySelector('[data-qa-text="caption"]')?.textContent??'',generation,generationOutput,labelFit:[...(picture?.querySelectorAll('[data-qa-text="content illustration label"]')??[])].map(labelFit),box:box?{left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:box.width,height:box.height}:null,shapes:shapes.length,geometryHash:hash(geometry),motionHash:hash(geometry+transforms),text:picture?.textContent??''}));
      } finally {continueRender(handle)}
    },45);
    return()=>{clearTimeout(timer);continueRender(handle)};
  },[frame]);
  return <EduVidExplainer {...props}/>;
};
const Root=()=> <Composition id="EduVidContentQA" component={Probe} width={1280} height={720} fps={30} durationInFrames={30} defaultProps={{plan:${JSON.stringify(makeContentPlan())}}} calculateMetadata={({props})=>({width:props.plan.width,height:props.plan.height,fps:props.plan.fps,durationInFrames:props.plan.durationInFrames})}/>;
registerRoot(Root);
`);

function expectedAt(plan, frame) {
  const sceneIndex = plan.scenes.findIndex(scene => frame >= scene.startFrame && frame < scene.startFrame + scene.durationInFrames);
  assert.ok(sceneIndex >= 0, `No fixture covers frame ${frame}`);
  const scene = plan.scenes[sceneIndex]; const relative = frame - scene.startFrame;
  const shotIndex = scene.illustration.shots.findIndex(shot => relative >= shot.startFrame && relative < shot.startFrame + shot.durationInFrames);
  return {sceneIndex, shotIndex, scene, shot:scene.illustration.shots[shotIndex]};
}
function validationFrames(plan) {
  return plan.scenes.flatMap(scene => {
    const relative = new Set([Math.min(scene.durationInFrames-1,Math.round(plan.fps)),Math.floor(scene.durationInFrames/2),scene.durationInFrames-1]);
    for(const shot of scene.illustration.shots) for(const offset of [0,Math.floor(shot.durationInFrames/2),shot.durationInFrames-1]) relative.add(shot.startFrame+offset);
    return [...relative].sort((a,b)=>a-b).map(frame=>scene.startFrame+frame);
  });
}
let browser;
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, async()=>{try{validationChild?.kill('SIGTERM');await browser?.close({silent:true});}finally{process.exit(130)}});
const summaries=[];
try {
  const serveUrl = await bundle({entryPoint:entry, rootDir:root, outDir:path.join(out,'probe-bundle')});
  for(const portrait of [false,true]) {
    const name=portrait?'portrait':'landscape';
    const plan=makeContentPlan({portrait}); assert.deepEqual(validatePlan(plan),[]);
    const planPath=path.join(out,`${name}.json`); await writeFile(planPath,JSON.stringify(plan,null,2));
    const validationOut=path.join(out,`${name}-stills`);
    console.log(`Checking ${name}: ${plan.scenes.length} narrated scenes, all ${exerciseNames.length} poses and ${contentKinds.length} picture kinds.`);
    const validation=await runValidation(planPath,validationOut);
    assert.equal(validation.code,0,validation.log);
    const report=JSON.parse(await readFile(path.join(validationOut,'report.json'),'utf8'));
    assert.equal(report.ok,true,JSON.stringify(report.issues));
    assert.deepEqual([...new Set(report.frames.map(item=>item.frame))].sort((a,b)=>a-b),validationFrames(plan).sort((a,b)=>a-b),'renderer must produce every scene and shot start/mid/end still');
    for(const frame of report.frames) assert.ok((await stat(frame.path)).size>1000,`Missing rendered still: ${frame.path}`);
    console.log(`${name}: ${report.frames.length} shot-boundary stills passed; checking every motion frame.`);
    browser = await openBrowser('chrome',{browserExecutable:await ensureCachedBrowser(),logLevel:'error'});
    const samples=new Map(); const layoutIssues=new Set();
    const inputProps={plan};
    const composition=await selectComposition({serveUrl,id:'EduVidContentQA',inputProps,puppeteerInstance:browser,logLevel:'error'});
    const onBrowserLog=log=>{
      for(const [marker,handler] of [['EDUVID_CONTENT_QA ',sample=>samples.set(sample.frame,sample)],['EDUVID_QA ',sample=>{for(const issue of sample.issues??[])layoutIssues.add(issue)}]]) {
        const position=log.text.indexOf(marker);if(position<0)continue;
        try{handler(JSON.parse(log.text.slice(position+marker.length)))}catch{}
      }
    };
    await renderMedia({serveUrl,composition,inputProps,outputLocation:path.join(out,`${name}-motion.mp4`),codec:'h264',muted:true,pixelFormat:'yuv420p',crf:22,x264Preset:'fast',concurrency:2,puppeteerInstance:browser,logLevel:'error',onBrowserLog});
    const repeatFrames=[
      plan.scenes[exerciseNames.indexOf('leg-raise')].startFrame+8,
      plan.scenes[fixtures.findIndex(fixture=>fixture.name==='tokens')].startFrame+22,
      plan.scenes[fixtures.findIndex(fixture=>fixture.name==='attention-mix')].startFrame+15,
    ];
    for(const frame of repeatFrames) {
      const files=[0,1].map(i=>path.join(out,`${name}-repeat-${frame}-${i}.png`));
      for(const output of files) await renderStill({serveUrl,composition,inputProps,frame,output,imageFormat:'png',puppeteerInstance:browser,logLevel:'error',onBrowserLog});
      assert.deepEqual(await readFile(files[0]),await readFile(files[1]),`${name} frame ${frame}: repeated rendering must produce identical pixels`);
    }
    await writeFile(path.join(out,`${name}-observations.json`),JSON.stringify([...samples.values()],null,2));
    await browser.close({silent:true});browser=undefined;
    assert.deepEqual([...layoutIssues],[],'every motion frame must stay within the safe layout');
    assert.equal(samples.size,plan.durationInFrames,'every rendered frame needs a semantic observation');
    for(let frame=0;frame<plan.durationInFrames;frame++) {
      const sample=samples.get(frame);const expected=expectedAt(plan,frame);
      assert.equal(sample?.count,1,`${name} frame ${frame}: exactly one current picture`);
      assert.equal(sample.kind,expected.shot.kind,`${name} frame ${frame}: wrong picture kind`);
      assert.equal(sample.exercise??undefined,expected.shot.exercise,`${name} frame ${frame}: wrong exercise pose`);
      assert.equal(sample.cue,expected.shot.cue,`${name} frame ${frame}: wrong narration cue`);
      assert.equal(sample.caption,expected.shot.cue,`${name} frame ${frame}: caption must follow the same narrated shot`);
      assert.equal(Number(sample.shot),expected.shotIndex,`${name} frame ${frame}: wrong shot ordinal`);
      if(expected.shot.kind==='generation') {
        const local=frame-expected.scene.startFrame-expected.shot.startFrame;
        const appended=Math.min(2,Math.floor(local/Math.max(1,expected.shot.durationInFrames-1)*4));
        const current=sample.generation.filter(token=>token.current);
        assert.equal(sample.generation.length,4+appended);
        assert.deepEqual(current,[{index:3+appended,generated:false,current:true,blank:true}],`${name} frame ${frame}: keep one unspecified next prediction visible`);
        assert.equal(sample.generationOutput,true,`${name} frame ${frame}: model output must point to the current prediction`);
      }
      assert.ok(sample.shapes>=2,`${name} frame ${frame}: picture contains no real vector geometry`);
      for(const label of sample.labelFit) {
        assert.ok(Number.isFinite(label.fontSize)&&label.fontSize>=label.minimum,`${label.text}: font below its safe minimum`);
        assert.ok(label.scrollWidth<=label.width+2&&label.scrollHeight<=label.height+2,`${label.text}: label exceeds its bounds`);
        assert.deepEqual(label.split,[],`${label.text}: a word is split across lines`);
      }
      const b=sample.box;assert.ok(b && b.width>0 && b.height>0 && b.left>=-1 && b.top>=-1 && b.right<=plan.width+1 && b.bottom<=plan.height+1,`${name} frame ${frame}: picture exceeds frame bounds`);
    }
    const atPose=(exercise,relative=15)=>samples.get(plan.scenes[exerciseNames.indexOf(exercise)].startFrame+relative);
    for(const [a,b] of [['leg-raise','plank'],['plank','side-plank'],['crunch','flutter-kick'],['lying','standing'],['side-plank','mountain-climber'],['crunch','star-crunch'],['crunch','crunch-reach']]) assert.notEqual(atPose(a).geometryHash,atPose(b).geometryHash,`${a} and ${b} must use different actual vector poses, not different labels on the same picture`);
    for(const exercise of ['leg-raise','flutter-kick','mountain-climber']) assert.notEqual(atPose(exercise,8).motionHash,atPose(exercise,22).motionHash,`${exercise} must show deterministic movement within its shot`);
    for(const name of ['tokens','embedding','attention-mix','generation']) {
      const index=fixtures.findIndex(fixture=>fixture.name===name);const start=plan.scenes[index].startFrame;
      assert.notEqual(samples.get(start+8).motionHash,samples.get(start+22).motionHash,`${name} must animate its specific mechanism`);
    }
    const summary={aspect:name,width:plan.width,height:plan.height,scenes:plan.scenes.length,shots:plan.scenes.reduce((n,scene)=>n+scene.illustration.shots.length,0),pictureKinds:contentKinds.length,exerciseVariants:exerciseNames.length,renderedStillCount:report.frames.length,motionFrames:samples.size,identicalPixelRepeatFrames:repeatFrames,layoutIssues:[...layoutIssues],semanticChecks:'kind, exercise, cue and shot selection verified on every rendered frame',geometryChecks:'distinct vector poses, mechanism motion and identical repeated-render pixels',limitations:'DOM metadata and geometry checks supplement human review; they cannot establish that an arbitrary illustration correctly teaches its narration.'};
    summaries.push(summary); console.log(`${name}: ${report.frames.length} real stills and ${samples.size} motion frames passed.`);
  }
  await writeFile(path.join(out,'summary.json'),JSON.stringify(summaries,null,2));
  console.log(`Content-specific illustration QA passed. Inspect rendered pictures in ${out}`);
} finally {console.log=originalLog;await browser?.close({silent:true})}
