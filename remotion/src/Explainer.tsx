import React, {useLayoutEffect, useRef} from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {ExplainerProps, RemotionScene, SceneItem, VideoPlan} from './types';
import {FitText, fitTextNode} from './FitText';
import {Icon} from './Icons';
import {IllustratedVisual} from './IllustratedVisual';

type Theme = {bg: string; ink: string; muted: string; accent: string; second: string; panel: string; line: string};
const THEMES: Record<VideoPlan['style'], Theme> = {
  paper: {bg: '#F7F5F0', ink: '#172334', muted: '#53647A', accent: '#2563EB', second: '#AD5300', panel: '#FFFFFF', line: '#D9E1E9'},
  classic: {bg: '#101827', ink: '#F7FAFF', muted: '#BBC8DA', accent: '#52D3F5', second: '#FFC471', panel: '#1C2B40', line: '#344760'},
  neon: {bg: '#100F22', ink: '#FAF7FF', muted: '#CEC5DF', accent: '#BF9AFB', second: '#4DE2EB', panel: '#24203D', line: '#484061'},
  chalkboard: {bg: '#142D27', ink: '#F1F5E9', muted: '#C6D5C9', accent: '#B9E19C', second: '#F2D28E', panel: '#244039', line: '#49665A'},
  illustrated: {bg: '#171547', ink: '#FFF4DD', muted: '#D0D8FF', accent: '#FFD16B', second: '#69DFCC', panel: '#2A2763', line: '#615B9A'},
};
type Layout = {s: number; vertical: boolean; theme: Theme; frame: number; fps: number; duration: number; count: number; artistic: boolean};

function fitItemCard(card: HTMLElement) {
  const header = card.querySelector<HTMLElement>('[data-qa-item-header]');
  const label = card.querySelector<HTMLElement>('[data-qa-text="item label"]');
  const detail = card.querySelector<HTMLElement>('[data-qa-text="item detail"]');
  if (!header || !label || !detail || card.clientHeight < 1) return;
  const css = getComputedStyle(card);
  const available = card.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom) - parseFloat(css.gap);
  const naturalHeight = (node: HTMLElement, font: number) => {
    const previousHeight = node.style.height;
    node.style.height = 'auto'; node.style.fontSize = `${font}px`;
    const height = node.scrollHeight;
    node.style.height = previousHeight;
    return height;
  };
  const minimumLabel = Math.max(Number(header.dataset.iconSize), naturalHeight(label, Number(label.dataset.minFont)));
  const minimumDetail = naturalHeight(detail, Number(detail.dataset.minFont));
  const wantedLabel = Math.max(minimumLabel, naturalHeight(label, Number(label.dataset.maxFont)));
  const wantedDetail = Math.max(minimumDetail, naturalHeight(detail, Number(detail.dataset.maxFont)));
  const extra = Math.max(0, available - minimumLabel - minimumDetail);
  const wantedExtra = wantedLabel + wantedDetail - minimumLabel - minimumDetail;
  const headerHeight = minimumLabel + (wantedExtra ? Math.min(extra, wantedExtra) * (wantedLabel - minimumLabel) / wantedExtra : 0);
  header.style.height = `${headerHeight}px`;
  fitTextNode(label); fitTextNode(detail);
}

const Reveal: React.FC<{index?: number; layout: Layout; children: React.ReactNode; style?: React.CSSProperties}> = ({index = 0, layout, children, style}) => {
  const desiredDelay = index === 0 ? 8 : Math.round(Math.max(8, Math.min(layout.duration * 0.72, layout.fps * 0.7 + (index - 1) * Math.max(0, layout.duration - layout.fps * 2.8) / Math.max(1, layout.count))));
  const delay = Math.min(desiredDelay, Math.max(0, layout.duration - 25));
  const progress = spring({frame: layout.frame - delay, fps: layout.fps, config: {damping: 200, mass: 0.7, stiffness: 110}, durationInFrames: 25});
  return <div data-qa-reveal style={{opacity: interpolate(layout.frame - delay, [0, 12], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}), transform: `translateY(${(1 - progress) * 22 * layout.s}px)`, minWidth: 0, minHeight: 0, ...style}}>{children}</div>;
};

const ItemCard: React.FC<{item: SceneItem; index: number; layout: Layout; compact?: boolean}> = ({item, index, layout, compact = false}) => {
  const {s, theme, vertical} = layout;
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const fit = () => fitItemCard(node);
    fit(); const observer = new ResizeObserver(fit); observer.observe(node);
    return () => observer.disconnect();
  }, [item.label, item.detail, s, compact]);
  const active = Math.min(layout.count - 1, Math.floor(layout.frame / layout.duration * layout.count)) === index;
  const iconSize = (compact ? 30 : 46) * s;
  return <Reveal index={index + 1} layout={layout} style={{height: '100%'}}><div ref={ref} data-qa-box="item" style={{height: '100%', boxSizing: 'border-box', padding: (compact ? 9 : 20) * s, border: `${(active ? 2 : 1) * s}px solid ${active ? theme.accent : theme.line}`, borderRadius: 20 * s, background: theme.panel, boxShadow: active ? `0 0 ${24 * s}px ${theme.accent}18` : undefined, display: 'flex', flexDirection: 'column', gap: (compact ? 6 : 8) * s, minWidth: 0}}>
    <div data-qa-item-header data-icon-size={iconSize} style={{display: 'flex', alignItems: 'center', gap: 14 * s, flex: item.detail ? '0 0 auto' : '1', height: item.detail ? '50%' : undefined, minHeight: 0}}><Icon name={item.icon} color={index % 2 ? theme.second : theme.accent} size={iconSize}/><div style={{flex: 1, minWidth: 0, height: '100%'}}><FitText text={item.label} height="100%" maxFont={(vertical ? 31 : 29) * s} minFont={18 * s} color={theme.ink} weight={700} name="item label"/></div></div>
    {item.detail && <FitText text={item.detail} height="100%" maxFont={26 * s} minFont={18 * s} color={theme.muted} name="item detail" style={{flex: 1, flexShrink: 1, minHeight: 0}}/>}
  </div></Reveal>;
};

const Body: React.FC<{text?: string; layout: Layout; height?: number; align?: 'left' | 'center'}> = ({text, layout, height = 0, align = 'left'}) => text ? <FitText text={text} height={(height || (layout.vertical ? 110 : 78)) * layout.s} maxFont={32 * layout.s} minFont={24 * layout.s} color={layout.theme.muted} align={align} name="body"/> : null;

const SceneVisual: React.FC<{scene: RemotionScene; layout: Layout}> = ({scene, layout}) => {
  const {s, theme, vertical, frame, fps} = layout;
  if (layout.artistic) return <IllustratedVisual scene={scene} s={s} vertical={vertical} frame={frame} fps={fps}/>;
  const items = scene.items;
  const gap = 18 * s;
  const sharedGrid: React.CSSProperties = {display: 'grid', gridTemplateColumns: `repeat(${items.length === 1 ? 1 : 2}, minmax(0, 1fr))`, gridAutoRows: 'minmax(0, 1fr)', gap, minHeight: 0, flex: 1};
  const icon = items[0]?.icon ?? 'spark';
  if (scene.template === 'hero') {
    const dense = items.length > 2 && items.some(item => item.detail);
    const circle = dense ? 90 : vertical ? 245 : 220;
    return <div style={{height: '100%', display: 'flex', flexDirection: 'column', gap}}>
      <div style={{display: 'flex', flexDirection: vertical && !dense ? 'column-reverse' : 'row', flex: dense ? 'none' : '1', minHeight: 0, alignItems: 'center', gap}}>
        <Reveal layout={layout} style={{flex: 1, width: '100%'}}><Body text={scene.body} layout={layout} height={dense ? 90 : vertical ? 140 : 150}/></Reveal>
        <Reveal layout={layout} index={1} style={{display: 'flex', justifyContent: 'center', flex: dense ? 'none' : 1}}><div style={{width: circle * s, height: circle * s, borderRadius: '50%', background: `${theme.accent}15`, border: `${2 * s}px solid ${theme.accent}40`, display: 'flex', alignItems: 'center', justifyContent: 'center'}}><Icon name={icon} color={theme.accent} size={circle * 0.7 * s}/></div></Reveal>
      </div>
      {!!items.length && <div style={{...sharedGrid, flex: dense ? 1 : 'none', height: dense ? undefined : (vertical && items.length > 2 ? 198 : 90) * s, gridTemplateColumns: `repeat(${vertical || dense ? Math.min(2, items.length) : items.length}, minmax(0, 1fr))`}}>{items.map((item, i) => <ItemCard key={i} item={item} index={i} layout={layout} compact/>)}</div>}
    </div>;
  }
  if (scene.template === 'cards' || scene.template === 'comparison') {
    return <div style={{height: '100%', display: 'flex', flexDirection: 'column', gap}}>
      <div style={sharedGrid}>{items.map((item, i) => <ItemCard key={i} item={item} index={i} layout={layout} compact={items.length > 2}/>)}</div>
      <Body text={scene.body} layout={layout}/>
    </div>;
  }
  if (scene.template === 'steps' || scene.template === 'timeline') {
    const timeline = scene.template === 'timeline';
    return <div style={{height: '100%', display: 'flex', flexDirection: 'column', gap}}>
      <Body text={scene.body} layout={layout}/>
      <div style={{display: 'flex', flexDirection: vertical ? 'column' : 'row', gap, flex: 1, minHeight: 0}}>{items.map((item, i) => <Reveal key={i} index={i + 1} layout={layout} style={{flex: 1, display: 'flex', flexDirection: vertical ? 'row' : 'column', gap: 18 * s, alignItems: vertical ? 'center' : 'flex-start', position: 'relative'}}>
        <div style={{flexShrink: 0, width: 60 * s, height: 60 * s, borderRadius: timeline ? '50%' : 16 * s, color: theme.bg, background: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 * s, fontWeight: 800}}>{timeline ? <Icon name={item.icon ?? 'clock'} size={36 * s} color={theme.bg}/> : i + 1}</div>
        {i < items.length - 1 && <div style={{position: 'absolute', background: theme.line, ...(vertical ? {width: 3 * s, top: 75 * s, bottom: -gap, left: 29 * s} : {height: 3 * s, left: 76 * s, right: -gap, top: 29 * s})}}/>}
        <div style={{minWidth: 0, flex: 1, width: '100%', background: theme.panel, borderRadius: 16 * s, padding: 14 * s, boxSizing: 'border-box', height: '100%', display: 'flex', flexDirection: 'column', gap: 8 * s, minHeight: 0}}><FitText text={item.label} height="100%" maxFont={31 * s} minFont={18 * s} style={{flex: item.detail ? '0 0 40%' : '1', flexShrink: 1, minHeight: 0}} color={theme.ink} weight={700} name="step label"/>{item.detail && <FitText text={item.detail} height="100%" maxFont={26 * s} minFont={18 * s} style={{flex: 1, flexShrink: 1, minHeight: 0}} color={theme.muted} name="step detail"/>}</div>
      </Reveal>)}</div>
    </div>;
  }
  if (scene.template === 'diagram') {
    return <div style={{height: '100%', display: 'flex', flexDirection: 'column', gap}}><Body text={scene.body} layout={layout}/>
      <div style={{flex: 1, minHeight: 0, display: 'flex', flexDirection: vertical ? 'column' : 'row', gap: 12 * s}}>
        {items.map((item, i) => <React.Fragment key={i}><div style={{flex: 1, minHeight: 0, minWidth: 0}}><ItemCard item={item} index={i} layout={layout} compact/></div>
          {i < items.length - 1 && <div style={{alignSelf: 'center', transform: vertical ? 'rotate(90deg)' : undefined, flexShrink: 0}}><Icon name="arrow" color={theme.accent} size={28 * s}/></div>}
        </React.Fragment>)}
      </div></div>;
  }
  if (scene.template === 'story') {
    return <div style={{height: '100%', display: 'flex', flexDirection: 'column', gap}}><Body text={scene.body} layout={layout} height={vertical ? 110 : 78}/>
      <div style={{display: 'flex', flexDirection: vertical ? 'column' : 'row', flex: 1, minHeight: 0, gap}}>
        <Reveal layout={layout} style={{flex: vertical ? 'none' : 0.55, height: vertical ? 250 * s : '100%', position: 'relative', borderRadius: 28 * s, background: `linear-gradient(160deg, ${theme.accent}20, ${theme.panel})`, overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
          <svg style={{position: 'absolute', width: '100%', height: '100%'}} viewBox="0 0 500 400" preserveAspectRatio="none"><path d="M0 320Q120 240 250 310T500 300V400H0Z" fill={theme.accent} opacity="0.08"/><path d="M0 345H500" stroke={theme.line} strokeWidth="3"/><circle cx="410" cy="75" r="30" fill={theme.second} opacity="0.3"/><path d="M45 275v-95h60v95m25 0v-150h70v150" fill={theme.accent} opacity="0.1"/></svg>
          <div style={{display: 'flex', gap: 20 * s, alignItems: 'flex-end', transform: `translateY(${Math.sin(frame / fps) * 3 * s}px)`}}><Icon name="person" color={theme.ink} size={130 * s}/><Icon name={icon} color={theme.accent} size={(icon === 'truck' ? 235 : 155) * s}/></div>
        </Reveal>
        <div style={{...sharedGrid, flex: 1.45}}>{items.map((item, i) => <ItemCard key={i} item={item} index={i} layout={layout} compact/>)}</div>
      </div></div>;
  }
  return <div style={{height: '100%', display: 'flex', flexDirection: 'column', gap}}>
    <div style={{display: 'flex', alignItems: 'center', gap, height: (vertical ? 130 : 78) * s, flexShrink: 0}}>
      <Reveal layout={layout}><Icon name="check" color={theme.accent} size={(vertical ? 105 : 65) * s}/></Reveal>
      <div style={{flex: 1, minWidth: 0}}><Body text={scene.body} layout={layout} height={vertical ? 125 : 78}/></div>
    </div>
    <div style={{width: '100%', ...sharedGrid}}>{items.map((item, i) => <ItemCard key={i} item={item} index={i} layout={layout} compact/>)}</div>
  </div>;
};

const Scene: React.FC<{scene: RemotionScene; plan: VideoPlan; index: number}> = ({scene, plan, index}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const vertical = plan.height > plan.width;
  const s = plan.width / (vertical ? 720 : 1280);
  const theme = THEMES[plan.style];
  const ref = useRef<HTMLDivElement>(null);
  const logged = useRef(new Set<string>());
  const layout = {s, vertical, theme, frame, fps, duration: scene.durationInFrames, count: scene.items.length, artistic: plan.style === 'illustrated'};
  useLayoutEffect(() => {
    if (!ref.current) return;
    const root = ref.current;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const bounds = root.getBoundingClientRect();
        if (bounds.width < 1 || bounds.height < 1) return;
        const issues: string[] = [];
        root.querySelectorAll<HTMLElement>('[data-qa-box="item"]').forEach(fitItemCard);
        root.querySelectorAll<HTMLElement>('[data-qa-text]').forEach(node => {
          const reveal = node.closest<HTMLElement>('[data-qa-reveal]');
          if (reveal && Number(getComputedStyle(reveal).opacity) < 1) return;
          fitTextNode(node);
          const rect = node.getBoundingClientRect();
          if (node.scrollHeight > node.clientHeight + 2 || node.scrollWidth > node.clientWidth + 2) issues.push(`Text overflow in scene ${index + 1}: ${node.dataset.qaText} "${node.textContent?.slice(0, 60)}"`);
          if (rect.left < bounds.left - 2 || rect.right > bounds.right + 2 || rect.top < bounds.top - 2 || rect.bottom > bounds.bottom + 2) issues.push(`Content outside safe area in scene ${index + 1}: ${node.dataset.qaText}`);
          const panel = node.closest<HTMLElement>('[data-qa-box]')?.getBoundingClientRect();
          if (panel && (rect.top < panel.top - 2 || rect.bottom > panel.bottom + 2)) issues.push(`Text outside its panel in scene ${index + 1}: ${node.dataset.qaText}`);
        });
        const fresh = issues.filter(issue => !logged.current.has(issue));
        fresh.forEach(issue => logged.current.add(issue));
        if (fresh.length) console.log('EDUVID_QA ' + JSON.stringify({issues: fresh}));
      });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(root);
    return () => {cancelAnimationFrame(raf); observer.disconnect();};
  }, [frame, index, scene]);
  return <AbsoluteFill style={{fontFamily: 'Avenir Next, Inter, system-ui, sans-serif', color: theme.ink}}>
    <div ref={ref} data-qa-content style={{position: 'absolute', left: (vertical ? 40 : 64) * s, right: (vertical ? 40 : 64) * s, top: (vertical ? 55 : 40) * s, bottom: (vertical ? 155 : 116) * s, display: 'flex', flexDirection: 'column', gap: 18 * s}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 12 * s, height: 25 * s, flexShrink: 0}}><div style={{width: 27 * s, height: 4 * s, background: theme.accent}}/><div style={{flex: 1, minWidth: 0}}><FitText text={scene.kicker ?? plan.title} height={25 * s} maxFont={20 * s} minFont={15 * s} color={theme.muted} weight={700} name="kicker"/></div><span style={{fontSize: 18 * s, color: theme.muted, whiteSpace: 'nowrap'}}>{String(index + 1).padStart(2, '0')} / {String(plan.scenes.length).padStart(2, '0')}</span></div>
      <Reveal layout={layout}><FitText text={scene.headline} height={(vertical ? 155 : scene.headline.length > 50 ? 100 : 80) * s} maxFont={(vertical ? 61 : 56) * s} minFont={(vertical ? 39 : 35) * s} color={theme.ink} weight={800} name="headline"/></Reveal>
      <div style={{flex: 1, minHeight: 0}}><SceneVisual scene={scene} layout={layout}/></div>
      {scene.footer && <FitText text={scene.footer} height={44 * s} maxFont={22 * s} minFont={18 * s} color={theme.muted} name="footer"/>}
    </div>
  </AbsoluteFill>;
};

export const EduVidExplainer: React.FC<ExplainerProps> = ({plan, audioSrc}) => {
  const frame = useCurrentFrame();
  const vertical = plan.height > plan.width;
  const s = plan.width / (vertical ? 720 : 1280);
  const theme = THEMES[plan.style];
  const cue = plan.captions.find(c => c.startFrame <= frame && frame < c.endFrame);
  const captionRef = useRef<HTMLDivElement>(null);
  const captionLogged = useRef(new Set<string>());
  useLayoutEffect(() => {
    if (!cue || !captionRef.current) return;
    const root = captionRef.current;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (root.getBoundingClientRect().width < 1) return;
        const progress = root.parentElement?.querySelector<HTMLElement>('[data-qa-progress]');
        const overlapKey = 'caption-progress-overlap';
        if (progress && root.getBoundingClientRect().top < progress.getBoundingClientRect().bottom - 1 && !captionLogged.current.has(overlapKey)) {
          captionLogged.current.add(overlapKey);
          console.log('EDUVID_QA ' + JSON.stringify({issues: ['Caption band overlaps the progress line']}));
        }
        const text = root.querySelector<HTMLElement>('[data-qa-text="caption"]');
        if (text) fitTextNode(text);
        if (text && (text.scrollHeight > text.clientHeight + 2 || text.scrollWidth > text.clientWidth + 2) && !captionLogged.current.has(cue.text)) {
          captionLogged.current.add(cue.text);
          console.log('EDUVID_QA ' + JSON.stringify({issues: [`Caption text overflows its safe band: "${cue.text.slice(0, 60)}"`]}));
        }
      });
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(root);
    return () => {cancelAnimationFrame(raf); observer.disconnect();};
  }, [cue]);
  return <AbsoluteFill style={{backgroundColor: theme.bg, overflow: 'hidden', fontFamily: 'Avenir Next, Inter, system-ui, sans-serif'}}>
    <AbsoluteFill style={{backgroundImage: `radial-gradient(ellipse at 100% 0%, ${theme.accent}16, transparent 60%)`}}/>
    {plan.style === 'illustrated' ? <svg width="100%" height="100%" viewBox={`0 0 ${plan.width} ${plan.height}`} style={{position: 'absolute', inset: 0, opacity: 0.45}} aria-hidden="true">{Array.from({length: 48}, (_, i) => <circle key={i} cx={((i * 199 + 41) % 997) / 997 * plan.width} cy={((i * 137 + 19) % 991) / 991 * plan.height} r={(i % 5 === 0 ? 2 : 1) * s} fill={i % 3 ? '#9D9DEF' : '#FFD16B'} opacity={0.25 + 0.25 * Math.sin(frame / 45 + i)}/>)}</svg> : <AbsoluteFill style={{opacity: 0.08, backgroundImage: `linear-gradient(${theme.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.line} 1px, transparent 1px)`, backgroundSize: `${45 * s}px ${45 * s}px`}}/>}
    {plan.scenes.map((scene, index) => <Sequence key={index} from={scene.startFrame} durationInFrames={scene.durationInFrames}><Scene scene={scene} plan={plan} index={index}/></Sequence>)}
    <div data-qa-progress style={{position: 'absolute', bottom: (vertical ? 126 : 100) * s, left: 40 * s, right: 40 * s, height: 3 * s, background: theme.line}}><div style={{height: '100%', width: `${100 * (frame + 1) / plan.durationInFrames}%`, background: theme.accent}}/></div>
    {cue && <div ref={captionRef} style={{position: 'absolute', left: (vertical ? 36 : 80) * s, right: (vertical ? 36 : 80) * s, bottom: 24 * s, display: 'flex', justifyContent: 'center'}}><div style={{background: '#000000CB', borderRadius: 12 * s, padding: `${10 * s}px ${18 * s}px`, maxWidth: '100%', boxSizing: 'border-box'}}><FitText text={cue.text} height={(vertical ? 63 : 48) * s} maxFont={(vertical ? 30 : 29) * s} minFont={22 * s} color="#FFFFFF" align="center" name="caption"/></div></div>}
    {audioSrc && <Audio src={audioSrc}/>}
  </AbsoluteFill>;
};
