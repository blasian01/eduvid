import assert from 'node:assert/strict';
import test from 'node:test';
import {validatePlan, contentKinds, exerciseNames, contentLayouts, contentIcons} from '../validate-plan.mjs';
import {makeContentPlan} from './content-fixtures.mjs';

const shotPlan = shot => {
  const plan = makeContentPlan();
  plan.scenes = [{...plan.scenes[0], illustration: {...plan.scenes[0].illustration, shots: [{cue: 'leg raises', kind: 'exercise', exercise: 'leg-raise', startFrame: 0, durationInFrames: 30, ...shot}]}}];
  plan.durationInFrames = 30; plan.captions = [];
  return plan;
};
test('all specific pictures, exercise poses and process layouts have valid fixtures in both aspects', () => {
  for (const portrait of [false, true]) {
    const plan = makeContentPlan({portrait});
    assert.deepEqual(validatePlan(plan), []);
    const shots = plan.scenes.flatMap(scene => scene.illustration.shots);
    assert.deepEqual([...new Set(shots.map(shot => shot.kind))].sort(), [...contentKinds].sort());
    assert.deepEqual([...new Set(shots.filter(shot => shot.kind === 'exercise').map(shot => shot.exercise))].sort(), [...exerciseNames].sort());
    assert.deepEqual([...new Set(shots.filter(shot => shot.kind === 'process').map(shot => shot.layout))].sort(), [...contentLayouts].sort());
  }
});
test('four timestamped shots cover each scene exactly, preserving exercise and decoder cue order', () => {
  const plan = makeContentPlan({framesPerShot: 60});
  for (const scene of plan.scenes.filter(scene => scene.illustration.shots.length === 4)) {
    assert.deepEqual(scene.illustration.shots.map(shot => [shot.startFrame, shot.durationInFrames]), [[0,60],[60,60],[120,60],[180,60]]);
    assert.equal(scene.durationInFrames, 240);
  }
  assert.deepEqual(validatePlan(plan), []);
});
test('all nine named workout exercises get separate contiguous pictures in the same beat', () => {
  const plan = makeContentPlan();
  const circuit = plan.scenes.find(scene => scene.illustration.shots.length === 9);
  assert.deepEqual(circuit.illustration.shots.map(shot => shot.exercise), ['leg-raise','flutter-kick','plank','hip-dip','star-crunch','crunch-reach','side-plank','hollow-hold','mountain-climber']);
  assert.deepEqual(circuit.illustration.shots.map(shot => shot.startFrame), [0,30,60,90,120,150,180,210,240]);
  assert.deepEqual(validatePlan(plan), []);
});
test('narrated fixture captions change at the exact picture cue rather than retaining the first exercise', () => {
  const plan=makeContentPlan();
  for(const scene of plan.scenes) for(const shot of scene.illustration.shots) {
    const caption=plan.captions.find(value=>value.startFrame===scene.startFrame+shot.startFrame);
    assert.equal(caption?.text,shot.cue);
    assert.equal(caption.endFrame,scene.startFrame+shot.startFrame+shot.durationInFrames);
  }
  const fitness=plan.scenes.find(scene=>scene.headline==='Pictures change with the narrated exercise');
  assert.equal(plan.captions.find(value=>value.startFrame===fitness.startFrame+30).text,'side planks');
  assert.equal(plan.captions.find(value=>value.startFrame===fitness.startFrame+60).text,'core as a rope bridge');
  assert.equal(plan.captions.find(value=>value.startFrame===fitness.startFrame+90).text,'nutrition plays a big role');
});
test('unknown pictures, wrong pose scope and invalid process cardinalities are rejected', () => {
  for (const invalid of [
    {kind: 'random-photo'}, {kind: 'exercise', exercise: undefined}, {exercise: 'unapproved'},
    {kind: 'embedding', exercise: 'plank'}, {kind: 'tokens', exercise: undefined, text: '<img src=x>'},
    {kind: 'embedding', exercise: undefined, text: 'A fabricated definition'},
    {kind: 'process', exercise: undefined, layout: 'single', objects: [{icon: 'plate',label:'Nutrition'},{icon:'calendar',label:'Consistency'}]},
    {kind: 'process', exercise: undefined, layout: 'comparison', objects: [{icon: 'plate',label:'Nutrition'}]},
    {kind: 'process', exercise: undefined, layout: 'random', objects: [{icon: 'plate',label:'Nutrition'}]},
    {kind: 'process', exercise: undefined, layout: 'single', objects: [{icon: 'external-url',label:'Nutrition'}]},
  ]) assert.ok(validatePlan(shotPlan(invalid)).length, JSON.stringify(invalid));
});
test('shots reject gaps, overlap, extra fields, unsafe cues, duplicate cues and excess shots', () => {
  for (const invalid of [
    {startFrame: 1}, {durationInFrames: 29}, {durationInFrames: 31}, {durationInFrames: 0},
    {cue: '<script>run()</script>'}, {cue: 'javascript:run()'}, {cue: 'x'.repeat(401)},
    {cue: ''}, {labels: ['x'.repeat(41)]}, {labels: ['one','two','three','four','five']},
    {src: 'https://example.com/exercise.png'}, {code: 'eval()'},
  ]) assert.ok(validatePlan(shotPlan(invalid)).length, JSON.stringify(invalid));
  const duplicate = makeContentPlan();
  const scene = duplicate.scenes.at(-1); scene.illustration.shots[1].cue = scene.illustration.shots[0].cue.toUpperCase();
  assert.ok(validatePlan(duplicate).some(issue => issue.includes('duplicate narration cue')));
  for (const mutate of [shots => {shots[1].startFrame++;}, shots => {shots[1].startFrame--; }]) {
    const plan = makeContentPlan(); mutate(plan.scenes.at(-1).illustration.shots);
    assert.ok(validatePlan(plan).length);
  }
  const excess = shotPlan(); excess.durationInFrames = excess.scenes[0].durationInFrames = 130;
  excess.scenes[0].illustration.shots = Array.from({length:13}, (_,i) => ({cue:`approved cue ${String.fromCharCode(65+i)}`,kind:'exercise',exercise:'plank',startFrame:i*10,durationInFrames:10}));
  assert.ok(validatePlan(excess).some(issue => issue.includes('1–12')));
});
test('every process icon is trusted and labels remain bounded plain text', () => {
  for (const icon of contentIcons) assert.deepEqual(validatePlan(shotPlan({kind:'process',exercise:undefined,layout:'single',objects:[{icon,label:'Approved concept'}]})), []);
  for (const label of ['<b>Unsafe</b>', 'https://example.com', 'x'.repeat(41)]) assert.ok(validatePlan(shotPlan({kind:'process',exercise:undefined,layout:'single',objects:[{icon:'plate',label}]})).length);
});
test('scientific cue metadata can retain a complete qualified sentence while visible labels stay short', () => {
  const cue = "In the paper's experiments, with the same model size and training tokens, BitNet b1.58 matches its sixteen-bit baseline on perplexity and end-task scores starting from three billion parameters.";
  assert.ok(cue.length > 180 && cue.length < 400);
  const plan = shotPlan({kind:'process',exercise:undefined,cue,layout:'comparison',objects:[{icon:'computer',label:'16-bit baseline'},{icon:'computer',label:'BitNet b1.58'}]});
  assert.deepEqual(validatePlan(plan), []);
  plan.scenes[0].illustration.shots[0].objects[0].label = cue;
  assert.ok(validatePlan(plan).some(issue => issue.includes('40')));
});
