import assert from 'node:assert/strict';
import test from 'node:test';
import {validatePlan, illustrationSubjects, illustrationMotions} from '../validate-plan.mjs';
import {makePlan} from './fixtures.mjs';
test('all templates and styles accept trusted landscape and portrait data', () => {
  for (const style of ['classic', 'neon', 'chalkboard', 'paper', 'illustrated']) for (const portrait of [false, true]) assert.deepEqual(validatePlan(makePlan({style, portrait, long: true})), []);
});
test('illustrated subjects, motion and bounded concept labels share the trusted plan contract', () => {
  for (const subject of illustrationSubjects) for (const motion of illustrationMotions) {
    const plan = makePlan({style: 'illustrated'});
    plan.scenes[0].illustration = {subject, motion, mode: 'schematic', labels: ['Prior tokens', 'Context']};
    assert.deepEqual(validatePlan(plan), []);
  }
});
test('illustrations reject executable assets, arbitrary motion and unsafe or overflowing labels', () => {
  for (const art of [
    {subject: 'space', motion: 'orbit', mode: 'schematic', src: 'https://example.com/a.svg'},
    {subject: 'space', motion: 'eval', mode: 'schematic'},
    {subject: 'unapproved', motion: 'orbit', mode: 'metaphor'},
    {subject: 'space', motion: 'orbit', mode: 'realistic'},
    {subject: 'attention', motion: 'flow', mode: 'schematic', labels: ['<script>alert(1)</script>']},
    {subject: 'attention', motion: 'flow', mode: 'schematic', labels: ['x'.repeat(41)]},
    {subject: 'attention', motion: 'flow', mode: 'schematic', labels: ['a', 'b', 'c', 'd', 'e']},
  ]) {
    const plan = makePlan({style: 'illustrated'}); plan.scenes[0].illustration = art;
    assert.ok(validatePlan(plan).length > 0, JSON.stringify(art));
  }
});
test('arbitrary code, HTML components and external media are rejected as plan fields', () => {
  const plan = makePlan(); plan.scenes[0].code = 'process.exit()'; plan.scenes[1].items[0].src = 'https://example.com/image.png';
  assert.equal(validatePlan(plan).filter(x => x.includes('unsupported field')).length, 2);
});
test('every frame is covered exactly once without blank gaps', () => {
  const plan = makePlan(); plan.scenes[1].startFrame += 1;
  assert.ok(validatePlan(plan).some(x => x.includes('contiguous')));
});
test('unknown templates and icons, overlong labels and overlapping captions fail', () => {
  const plan = makePlan(); plan.scenes[0].template = 'custom'; plan.scenes[1].items[0].icon = 'external'; plan.scenes[2].items[0].label = 'x'.repeat(61); plan.captions[1].startFrame -= 1;
  assert.equal(validatePlan(plan).length, 4);
});
