import {exerciseNames} from '../validate-plan.mjs';

const poseNames = {
  'leg-raise': 'Leg raises', 'side-plank': 'Side planks', 'flutter-kick': 'Flutters',
  'mountain-climber': 'Mountain climbers', 'hip-dip': 'Hip dips', 'star-crunch': 'Star crunches',
  'crunch-reach': 'Reaches', 'hollow-hold': 'A hold', 'plank-up-down': 'Plank up and down',
};
const nameOf = value => poseNames[value] ?? value.replaceAll('-', ' ');
const process = (cue, layout, objects) => ({cue, kind: 'process', layout, objects});

export function contentFixtures() {
  return [
    ...exerciseNames.map(exercise => ({name: `exercise-${exercise}`, title: nameOf(exercise), shots: [{cue: nameOf(exercise), kind: 'exercise', exercise}]})),
    {name: 'tokens', title: 'Text becomes tokens', shots: [{cue: 'text becomes tokens', kind: 'tokens', text: 'The cat sat on the ...', labels: ['Words or parts of words']} ]},
    {name: 'embedding', title: 'Embedding representations', shots: [{cue: 'each token becomes an embedding', kind: 'embedding', labels: ['List of numbers']} ]},
    {name: 'attention-mix', title: 'Weights mix value vectors', shots: [{cue: 'weights mix value vectors', kind: 'attention-mix', labels: ['Query', 'Keys', 'Values', 'Context']} ]},
    {name: 'generation', title: 'Build context, predict, append, repeat', shots: [{cue: 'generation is a loop', kind: 'generation', labels: ['Build context', 'Predict one token', 'Append', 'Repeat']} ]},
    {name: 'bridge', title: 'A rope bridge is a metaphor', shots: [{cue: 'core as a rope bridge', kind: 'bridge', labels: ['Upper abs', 'Lower abs', 'Obliques', 'Erector spine']} ]},
    {name: 'causal-attention', title: 'Use current and earlier tokens', shots: [{cue: 'decoder self-attention masks future tokens', kind: 'causal-attention', labels: ['Current and earlier', 'Future blocked']} ]},
    {name: 'notes', title: 'A filing cabinet metaphor', shots: [{cue: 'matching a question to relevant notes', kind: 'notes', labels: ['Query', 'Key', 'Value', 'Metaphor']} ]},
    {name: 'nutrition', title: 'Core strength and visible abs', shots: [process('nutrition affects visible abs', 'comparison', [{icon: 'muscle', label: 'Core strength'}, {icon: 'plate', label: 'Nutrition'}])]},
    {name: 'calendar', title: 'The real target is consistency', shots: [process('the real target is consistency', 'single', [{icon: 'calendar', label: 'Consistency'}])]},
    {name: 'no-rest', title: 'No rest and time under tension', shots: [process('increases time under tension', 'sequence', [{icon: 'clock', label: 'No rest'}, {icon: 'muscle', label: 'Time under tension'}, {icon: 'arrow', label: 'Endurance'}])]},
    {name: 'parallel-heads', title: 'Different comparisons in parallel', shots: [process('multiple heads learn different comparisons in parallel', 'collection', [{icon: 'brain', label: 'Head A'}, {icon: 'brain', label: 'Head B'}, {icon: 'brain', label: 'Head C'}])]},
    {name: 'timed-fitness', title: 'Pictures change with the narrated exercise', shots: [
      {cue: 'leg raises', kind: 'exercise', exercise: 'leg-raise'},
      {cue: 'side planks', kind: 'exercise', exercise: 'side-plank'},
      {cue: 'core as a rope bridge', kind: 'bridge', labels: ['Visual metaphor']},
      process('nutrition plays a big role', 'single', [{icon: 'plate', label: 'Nutrition matters'}]),
    ]},
    {name: 'nine-exercise-circuit', title: 'One continuous circuit', shots: [
      ['leg raises','leg-raise'], ['flutters','flutter-kick'], ['planks','plank'],
      ['hip dips','hip-dip'], ['star crunches','star-crunch'], ['reaches','crunch-reach'],
      ['side planks','side-plank'], ['a hold','hollow-hold'], ['mountain climbers','mountain-climber'],
    ].map(([cue, exercise]) => ({cue, kind:'exercise', exercise}))},
    {name: 'timed-decoder', title: 'Decoder components and architecture', shots: [
      {cue: 'masks future tokens', kind: 'causal-attention', labels: ['Current and earlier', 'Future blocked']},
      process('multiple heads learn different comparisons in parallel', 'collection', [{icon: 'brain', label: 'Different comparisons'}, {icon: 'brain', label: 'In parallel'}]),
      process('feed-forward layers update each representation', 'sequence', [{icon: 'vector', label: 'Representation'}, {icon: 'computer', label: 'Feed-forward'}, {icon: 'vector', label: 'Updated representation'}]),
      process('encoder and decoder versus decoder-only', 'comparison', [{icon: 'computer', label: 'Encoder + decoder'}, {icon: 'computer', label: 'Decoder-only'}]),
    ]},
  ];
}

export function makeContentPlan({portrait = false, framesPerShot = 30} = {}) {
  let next = 0;
  const fixtures = contentFixtures();
  const scenes = fixtures.map(fixture => {
    const durationInFrames = framesPerShot * fixture.shots.length;
    const scene = {template: 'cards', headline: fixture.title, items: [], body: 'The picture follows the approved narration.',
      illustration: {subject: 'abstract', motion: 'pulse', mode: fixture.shots[0].kind === 'bridge' || fixture.shots[0].kind === 'notes' ? 'metaphor' : 'schematic',
        shots: fixture.shots.map((shot, i) => ({...shot, startFrame: i * framesPerShot, durationInFrames: framesPerShot}))},
      startFrame: next, durationInFrames};
    next += durationInFrames;
    return scene;
  });
  return {version: 1, title: 'Narration-specific illustration QA', width: portrait ? 720 : 1280, height: portrait ? 1280 : 720, fps: 30,
    durationInFrames: next, style: 'illustrated', scenes,
    captions: scenes.flatMap(scene => scene.illustration.shots.map(shot => ({startFrame: scene.startFrame+shot.startFrame, endFrame: scene.startFrame+shot.startFrame+shot.durationInFrames, text: shot.cue})))};
}
