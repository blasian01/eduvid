import React from 'react';
import {interpolate, spring} from 'remotion';
import type {RemotionScene, IllustrationPlan} from './types';
import {FitText} from './FitText';
import {IllustrationWorld} from './IllustrationWorld';
import {ContentIllustration} from './ContentIllustration';

const INK = '#FFF4DD';
const MUTED = '#D0D8FF';
const COLORS = ['#FFD16B', '#69DFCC', '#FF858F', '#AA94FF'];
const DEFAULT_ART: IllustrationPlan = {subject: 'abstract', motion: 'pulse', mode: 'metaphor'};

/** Narrated illustrated stage: a large world and one complete idea in focus.
 * Labels stay visible as the explanation advances. No claim is shortened here.
 */
export const IllustratedVisual: React.FC<{scene: RemotionScene; s: number; vertical: boolean; frame: number; fps: number}> = ({scene, s, vertical, frame, fps}) => {
  const art = scene.illustration ?? DEFAULT_ART;
  const count = art.shots?.length ?? scene.items.length;
  const shotIndex = art.shots?.reduce((current, shot, i) => frame >= shot.startFrame ? i : current, 0) ?? 0;
  const shot = art.shots?.[shotIndex];
  const progress = Math.max(0, Math.min(0.999, (frame - 12) / Math.max(1, scene.durationInFrames - 30)));
  const active = shot ? shotIndex : Math.min(Math.max(0, count - 1), Math.floor(progress * Math.max(1, count)));
  const shotNames = shot?.labels?.length ? shot.labels : shot?.kind === 'process' ? shot.objects?.map(object => object.label) ?? [] : [];
  const kindLabel = shot?.kind === 'exercise' ? shot.exercise?.replaceAll('-', ' ') : {
    tokens: 'Text and tokens', embedding: 'Numeric representation', 'attention-mix': 'Weighted value mixing',
    generation: 'Predict, append, repeat', bridge: 'Bridge analogy', 'causal-attention': 'Current and earlier tokens', notes: 'Notes analogy', process: 'The narrated concept',
  }[shot?.kind ?? 'process'];
  const shotLabel = shotNames[0] ?? kindLabel;
  // Items are not one-to-one with shots. Only reuse the matching concept's
  // detail; rotating four item names across nine movements shows stale poses.
  const item = shot ? scene.items.find(value => value.label.toLocaleLowerCase() === shotLabel?.toLocaleLowerCase()) : scene.items[active];
  const accent = COLORS[active % COLORS.length];
  const enter = spring({frame, fps, durationInFrames: 28, config: {damping: 180, stiffness: 100}});
  const ordered = ['steps', 'diagram', 'timeline'].includes(scene.template);
  const concepts = shot ? shot.labels ?? [] : art.labels ?? [];
  const pointLabel = shot ? shotLabel ?? 'The narrated concept' : item?.label ?? (scene.template === 'takeaway' ? 'Carry the idea forward' : 'Explore the idea');
  const pointDetail = shot ? item?.detail ?? (shotNames.length > 1 ? shotNames.slice(1).join(' · ') : undefined) : item?.detail ?? scene.body;
  const pointChange = frame - (shot ? shot.startFrame : Math.floor(active * Math.max(1, scene.durationInFrames - 30) / Math.max(1, count)) + 12);
  const pointOpacity = interpolate(pointChange, [0, 8], [0.6, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <div data-qa-illustrated-stage data-illustration-subject={art.subject} data-illustration-motion={art.motion} style={{height: '100%', display: 'flex', flexDirection: vertical ? 'column' : 'row', gap: 22 * s, minHeight: 0}}>
    <div style={{flex: vertical ? '1.3 1 0' : '1.9 1 0', minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 * s}}>
      <div data-qa-box="illustration" style={{flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', borderRadius: `${32 * s}px ${80 * s}px ${32 * s}px ${48 * s}px`, background: 'radial-gradient(ellipse at 45% 35%, #393073, #201C55 75%)', border: `${1.5 * s}px solid #6B5E9A55`, transform: `translateY(${(1 - enter) * 12 * s}px)`, opacity: 0.25 + enter * 0.75}}>
        <svg width="100%" height="100%" viewBox="0 0 800 600" preserveAspectRatio="none" style={{position: 'absolute', inset: 0}} aria-hidden="true">
          <ellipse cx="560" cy="180" rx="330" ry="240" fill="#7D63B922"/>
          <path d="M-80 490Q140 330 320 430T880 390V640H-80Z" fill="#504879" opacity="0.38"/>
          <path d="M-50 550Q240 460 430 500T860 470V640H-50Z" fill="#171947" opacity="0.6"/>
        </svg>
        <div style={{position: 'absolute', inset: '2%', transform: `scale(${1.015 + 0.015 * Math.sin(frame / fps / 3)})`}}>
          {art.shots?.length ? <ContentIllustration shots={art.shots} frame={frame} fps={fps} duration={scene.durationInFrames} vertical={vertical} accent={accent}/> : <IllustrationWorld illustration={art} frame={frame} fps={fps} duration={scene.durationInFrames} vertical={vertical} accent={accent}/>}
        </div>
        <span style={{position: 'absolute', left: 18 * s, top: 16 * s, color: '#DAD9FF', fontSize: 13 * s, letterSpacing: 1.2 * s, textTransform: 'uppercase', background: '#171547AA', padding: `${5 * s}px ${9 * s}px`, borderRadius: 20 * s}}>{shot ? ['bridge', 'notes'].includes(shot.kind) ? 'Visual metaphor' : shot.kind === 'exercise' ? 'Exercise illustration' : 'Concept diagram' : art.mode === 'metaphor' ? 'Visual metaphor' : 'Illustrated schematic'}</span>
        {scene.template === 'takeaway' && <div aria-hidden="true" style={{position: 'absolute', right: 22 * s, bottom: 18 * s, color: '#FFD16B', fontSize: 34 * s, transform: `rotate(${Math.sin(frame / fps) * 5}deg)`}}>✦</div>}
      </div>
      {concepts.length > 0 && <div style={{height: (vertical && concepts.length > 2 ? 84 : 46) * s, display: 'grid', gridTemplateColumns: `repeat(${vertical ? Math.min(2, concepts.length) : concepts.length}, minmax(0, 1fr))`, gap: 8 * s, flexShrink: 0}}>{concepts.map((label, i) => <div key={i} data-qa-box="concept" style={{borderRadius: 14 * s, padding: `${4 * s}px ${9 * s}px`, boxSizing: 'border-box', border: `${1 * s}px solid ${COLORS[i % 4]}66`, color: COLORS[i % 4], background: '#2B2765', minWidth: 0, minHeight: 0}}><FitText text={label} name="illustration label" color={COLORS[i % 4]} height="100%" maxFont={19 * s} minFont={14 * s} weight={700} align="center"/></div>)}</div>}
    </div>
    <div style={{flex: vertical ? '1 1 0' : '1 1 0', minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 * s}}>
      <div data-qa-box="art-point" data-content-point-cue={shot?.cue} style={{flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10 * s, background: 'linear-gradient(135deg, #363069, #29265B)', borderRadius: 24 * s, padding: (vertical ? 19 : 21) * s, boxSizing: 'border-box', borderTop: `${4 * s}px solid ${accent}`, boxShadow: '0 12px 40px #09072330', opacity: pointOpacity}}>
        <div style={{height: 22 * s, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 * s}}><span aria-hidden="true" style={{width: 9 * s, height: 9 * s, borderRadius: '50%', background: accent}}/><span style={{fontSize: 14 * s, color: accent, letterSpacing: 1.5 * s, textTransform: 'uppercase'}}>{scene.template === 'hero' ? 'The question' : scene.template === 'takeaway' ? 'The insight' : ordered ? 'Follow the mechanism' : 'Look closer'}</span>{count > 1 && <span style={{marginLeft: 'auto', color: MUTED, fontSize: 14 * s}}>{active + 1} / {count}</span>}</div>
        <FitText text={pointLabel} name="illustrated point label" height="100%" color={INK} maxFont={(vertical ? 32 : 31) * s} minFont={21 * s} weight={800} style={{flex: pointDetail ? '0 0 34%' : '1', minHeight: 0}}/>
        {pointDetail && <FitText text={pointDetail} name="illustrated point detail" height="100%" maxFont={(vertical ? 26 : 27) * s} minFont={19 * s} color={MUTED} style={{flex: 1, minHeight: 0}}/>}
      </div>
      {count > 1 && <div aria-hidden="true" style={{height: 14 * s, flexShrink: 0, display: 'flex', gap: 8 * s}}>{Array.from({length: count}, (_, i) => <div key={i} style={{flex: 1, borderRadius: 8 * s, background: i === active ? COLORS[i % 4] : '#514A83', opacity: i <= active ? 1 : 0.45}}/>)}</div>}
    </div>
  </div>;
};
