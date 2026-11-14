import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, extractCasualties } from '../src/analysis/classify.js';

test('non-incident news is not classified', () => {
  assert.equal(classify('Central bank holds interest rates steady'), null);
  assert.equal(classify('SpaceX rockets launch another batch of satellites'), null);
  assert.equal(classify('A flood of memes followed the final'), null);
});

test('suspected terrorism needs terror language or a non-state actor', () => {
  assert.equal(classify('Suicide bomber kills 12 at market in Mogadishu').category, 'terrorism');
  assert.equal(classify('Islamic State claims attack on police post').category, 'terrorism');
  assert.equal(classify('Militants kill 20 in attack on village in Burkina Faso').category, 'terrorism');
  // Attacks on the military are treated as armed conflict.
  assert.equal(classify('Militants attack army convoy in northern Burkina Faso').category, 'conflict');
  assert.notEqual(classify('Gunman opens fire at gym, police say').category, 'terrorism');
});

test('state conflict is armed conflict, not terrorism', () => {
  assert.equal(classify('Russian strikes hit Kharkiv overnight, killing 3').category, 'conflict');
});

test('severity grows with casualties and is clamped', () => {
  const minor = classify('Protesters clash with police in capital');
  const deadly = classify('At least 120 killed as militants storm villages');
  assert.ok(minor.severity >= 1 && minor.severity <= 2, `minor severity ${minor.severity}`);
  assert.equal(deadly.severity, 5);
});

test('headline casualty figures win over summary figures', () => {
  const r = classify('DR Congo: At least 44 dead in attack by Islamic State-linked gunmen', 'Earlier reports said 66 people died.');
  assert.equal(r.casualties.killed, 44);
});

test('foiled plots and retrospectives are downgraded', () => {
  assert.ok(classify('Police foil terror plot targeting concert').severity <= 2);
  assert.equal(classify('Ten years on from the Paris terror attacks, survivors remember').severity, 1);
});

test('extractCasualties reads numbers and number words', () => {
  assert.deepEqual(extractCasualties('Five killed and 20 injured in blast'), { killed: 5, injured: 20 });
  assert.equal(extractCasualties('Death toll rises to 31').killed, 31);
  assert.equal(extractCasualties('Gunmen kill 14 villagers').killed, 14);
});
