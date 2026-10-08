import type {ReactNode} from 'react';
import type {IllustrationPlan} from './types';

/** Original, qualitative vector worlds. Time comes only from the supplied frame. */
export interface IllustrationWorldProps {
  illustration: IllustrationPlan;
  frame: number;
  fps: number;
  duration: number;
  vertical: boolean;
  accent?: string;
}

const C = {
  ink: '#29384F', navy: '#243D62', night: '#24304E', cream: '#FFF5E7', white: '#FFFCF6',
  coral: '#FF666E', rose: '#ED9AAA', peach: '#FFD2B2', orange: '#FFA45F', yellow: '#FFD166',
  green: '#68C99B', mint: '#A6E6B5', teal: '#169F99', aqua: '#78DCE8', sky: '#60A5DC',
  blue: '#486BDD', lilac: '#CBACF3', purple: '#986CE0', soil: '#C9A08B', bark: '#9E735F',
};
type Point = {x: number; y: number};
type World = {
  illustration: IllustrationPlan; t: number; p: number; cycle: number; growth: number;
  morph: number; focus: number; accent: string; id: string; vertical: boolean;
};
type WorldProps = {w: World};

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const ease = (n: number) => {const p = clamp(n); return p * p * (3 - 2 * p);};
const fraction = (n: number) => n - Math.floor(n);
const wave = (w: World, offset = 0, amount = 1) => Math.sin(w.t * 1.4 + offset) * amount;
const ellipsePoint = (cx: number, cy: number, rx: number, ry: number, angle: number): Point => ({x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry});
const mix = (a: number, b: number, p: number) => a + (b - a) * p;
function bezier(a: Point, b: Point, c: Point, d: Point, p: number): Point {
  const q = 1 - p;
  return {x: q * q * q * a.x + 3 * q * q * p * b.x + 3 * q * p * p * c.x + p * p * p * d.x,
    y: q * q * q * a.y + 3 * q * q * p * b.y + 3 * q * p * p * c.y + p * p * p * d.y};
}
function arc(a: Point, b: Point, height: number) {
  const c = {x: a.x + (b.x - a.x) * 0.22, y: Math.min(a.y, b.y) - height};
  const d = {x: a.x + (b.x - a.x) * 0.78, y: Math.min(a.y, b.y) - height};
  return {path: `M${a.x} ${a.y}C${c.x} ${c.y} ${d.x} ${d.y} ${b.x} ${b.y}`, point: (p: number) => bezier(a, c, d, b, p)};
}

function Part({w, index = 0, children, origin = '400 300'}: {w: World; index?: number; children: ReactNode; origin?: string}) {
  const build = ease((w.p - index * 0.035) / 0.38);
  const assembling = w.illustration.motion === 'assemble';
  const growing = w.illustration.motion === 'grow';
  const scale = growing ? mix(0.5, 1, build) : 1;
  const [x, y] = origin.split(' ').map(Number);
  const dx = assembling ? (1 - build) * (index % 2 ? -75 : 75) : 0;
  const dy = assembling ? (1 - build) * 45 : 0;
  return <g opacity={assembling ? mix(0.16, 1, build) : 1} transform={`translate(${dx} ${dy}) translate(${x} ${y}) scale(${scale}) translate(${-x} ${-y})`}>{children}</g>;
}

function Star({x, y, r = 7, color = C.yellow, opacity = 1}: {x: number; y: number; r?: number; color?: string; opacity?: number}) {
  return <path d={`M${x} ${y-r}Q${x+r*0.25} ${y-r*0.25} ${x+r} ${y}Q${x+r*0.25} ${y+r*0.25} ${x} ${y+r}Q${x-r*0.25} ${y+r*0.25} ${x-r} ${y}Q${x-r*0.25} ${y-r*0.25} ${x} ${y-r}`} fill={color} opacity={opacity}/>;
}

function Cloud({x, y, scale = 1, color = C.white}: {x: number; y: number; scale?: number; color?: string}) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} fill={color}>
    <path d="M-64 20C-75-10-55-36-28-31C-20-68 33-68 47-33C78-37 94-9 79 17C72 32-49 36-64 20Z"/>
    <path d="M-58 25C-12 35 38 29 77 18" fill="none" stroke={C.sky} strokeWidth="4" opacity="0.12"/>
  </g>;
}

function Leaf({x, y, angle = 0, scale = 1, color = C.green}: {x: number; y: number; angle?: number; scale?: number; color?: string}) {
  return <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
    <path d="M0 0C-37-3-54-34-47-69C-12-67 15-38 0 0Z" fill={color}/>
    <path d="M0 0-31-46M-15-21-35-25" fill="none" stroke={C.teal} strokeWidth="3" strokeLinecap="round" opacity="0.42"/>
  </g>;
}

function Flower({x, y, scale = 1, w, color = C.coral}: {x: number; y: number; scale?: number; w: World; color?: string}) {
  return <g transform={`translate(${x} ${y}) scale(${scale}) rotate(${wave(w,x,2)})`}>
    <path d="M0 0Q-12-30 0-68" fill="none" stroke={C.teal} strokeWidth="6" strokeLinecap="round"/>
    <Leaf x={-2} y={-25} angle={-65} scale={0.48}/>
    <g transform="translate(0 -77)">{Array.from({length: 6}, (_,i) => <ellipse key={i} cy="-18" rx="11" ry="19" transform={`rotate(${i*60})`} fill={color}/>)}<circle r="13" fill={C.yellow}/><circle cx="-4" cy="-5" r="4" fill={C.white} opacity="0.5"/></g>
  </g>;
}

function Character({x, y, scale = 1, w, pose = 'think', shirt = C.coral, skin = C.peach, hair = C.ink, backpack = false}: {
  x: number; y: number; scale?: number; w: World; pose?: 'think' | 'reach' | 'walk' | 'wave'; shirt?: string; skin?: string; hair?: string; backpack?: boolean;
}) {
  const stride = pose === 'walk' ? Math.sin(w.t * 3.5) * 10 : 0;
  const arm = pose === 'wave' ? -85 + wave(w,0,9) : pose === 'reach' ? -53 : pose === 'think' ? -27 : -stride;
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse cx="0" cy="96" rx="48" ry="9" fill={C.ink} opacity="0.10"/>
    {backpack && <><rect x="-49" y="-6" width="27" height="67" rx="12" fill={C.orange}/><rect x="-52" y="13" width="17" height="30" rx="7" fill={C.yellow}/></>}
    <g transform={`rotate(${stride} -16 54)`}><path d="M-20 48-25 84" stroke={C.navy} strokeWidth="18" strokeLinecap="round"/><path d="M-30 86-13 86" stroke={C.ink} strokeWidth="15" strokeLinecap="round"/></g>
    <g transform={`rotate(${-stride} 16 54)`}><path d="M18 48 22 84" stroke={C.blue} strokeWidth="18" strokeLinecap="round"/><path d="M18 88 37 88" stroke={C.ink} strokeWidth="15" strokeLinecap="round"/></g>
    <path d="M-22-9Q0-19 24-8L35 52Q2 66-33 51Z" fill={shirt}/>
    <path d="M-21-6Q-37 10-33 40" stroke={shirt} strokeWidth="18" strokeLinecap="round" fill="none"/><circle cx="-33" cy="43" r="9" fill={skin}/>
    <g transform={`rotate(${arm} 26 0)`}><path d="M26 0 37 33" stroke={shirt} strokeWidth="18" strokeLinecap="round"/><path d="M37 29 36 47" stroke={skin} strokeWidth="13" strokeLinecap="round"/></g>
    <path d="M-24 46Q0 54 27 47" fill="none" stroke={C.ink} strokeWidth="3" opacity="0.12"/>
    <rect x="-8" y="-27" width="17" height="23" rx="7" fill={skin}/>
    <ellipse cy="-47" rx="27" ry="31" fill={skin}/>
    <path d="M-27-44Q-33-82 3-80Q35-79 26-41L18-59Q-1-49-18-64L-22-44Z" fill={hair}/>
    <circle cx="-11" cy="-46" r="3" fill={C.ink}/><circle cx="10" cy="-46" r="3" fill={C.ink}/>
    <path d="M-5-32Q2-27 9-32" fill="none" stroke={C.ink} strokeWidth="2.5" strokeLinecap="round"/>
    <ellipse cx="-17" cy="-36" rx="5" ry="3" fill={C.coral} opacity="0.4"/>
  </g>;
}

function Backdrop({w, sky = C.cream}: {w: World; sky?: string}) {
  const drift = wave(w, 0, w.vertical ? 3 : 6);
  return <>
    <rect x="18" y="25" width="764" height="550" rx="62" fill={sky}/>
    <ellipse cx={184+drift} cy="151" rx="141" ry="112" fill={C.white} opacity="0.55"/>
    <ellipse cx={643-drift*0.6} cy="446" rx="146" ry="106" fill={C.peach} opacity="0.45"/>
    <path d="M45 447Q215 367 369 459T756 426" fill="none" stroke={C.white} strokeWidth="35" opacity="0.48"/>
    {w.illustration.motion === 'compare' && <><rect x="42" y="47" width="347" height="505" rx="44" fill={C.aqua} opacity={0.06+0.1*w.focus}/><rect x="411" y="47" width="347" height="505" rx="44" fill={C.lilac} opacity={0.16-0.1*w.focus}/><path d="M400 95V515" stroke={C.white} strokeWidth="4" strokeDasharray="6 13"/></>}
    {[{x: 82,y: 123},{x: 733,y: 155},{x: 700,y: 492}].map((p,i) => <Star key={i} {...p} r={7+wave(w,i,1.5)} color={i===1 ? C.coral : C.orange} opacity={0.5}/>)}
  </>;
}

function SpaceWorld({w}: WorldProps) {
  const angle = w.t * (w.illustration.motion === 'orbit' ? 0.34 : 0.12);
  const satellite = ellipsePoint(445,286,244,144,angle-0.8);
  return <>
    <Backdrop w={w} sky={C.night}/>
    <ellipse cx="418" cy="277" rx="311" ry="209" fill={C.purple} opacity="0.12"/>
    {Array.from({length: 27},(_,i) => <Star key={i} x={70+(i*97)%665} y={65+(i*71)%458} r={i%5===0 ? 6 : 3} color={i%3 ? C.white : C.yellow} opacity={0.4+0.25*Math.sin(w.t+i)}/>)}
    <g transform={`translate(${wave(w,0,4)} ${wave(w,2,5)})`}>
      <ellipse cx="302" cy="337" rx="177" ry="56" fill="none" stroke={C.coral} strokeWidth="21" transform="rotate(-20 302 337)" opacity="0.8"/>
      <circle cx="302" cy="320" r="132" fill={C.orange}/>
      <path d="M189 251Q329 259 403 232M176 310Q330 340 425 293M185 372Q318 398 406 345" fill="none" stroke={C.yellow} strokeWidth="23" opacity="0.6"/>
      <path d="M336 192A132 132 0 0 1 351 442Q399 293 336 192" fill={C.coral} opacity="0.3"/>
      <ellipse cx="302" cy="337" rx="177" ry="56" fill="none" stroke={C.peach} strokeWidth="16" transform="rotate(-20 302 337)" strokeDasharray="355 755"/>
      <circle cx="250" cy="254" r="18" fill={C.white} opacity="0.17"/>
    </g>
    <ellipse cx="445" cy="286" rx="244" ry="144" fill="none" stroke={C.sky} strokeWidth="2" strokeDasharray="5 12" opacity="0.4"/>
    <Part w={w} index={2}><g transform={`translate(${satellite.x} ${satellite.y}) rotate(${angle*25})`}>
      <rect x="-22" y="-20" width="44" height="42" rx="12" fill={C.white}/>
      <rect x="-76" y="-22" width="42" height="47" rx="6" fill={C.blue}/><rect x="34" y="-22" width="42" height="47" rx="6" fill={C.blue}/>
      {[-64,-49,46,61].map(x => <path key={x} d={`M${x}-17V20`} stroke={C.aqua} strokeWidth="2"/>)}
      <path d="M0-20V-45M-13-46Q0-60 13-46" fill="none" stroke={C.yellow} strokeWidth="5" strokeLinecap="round"/>
      <circle r="9" fill={C.coral}/>
    </g></Part>
    <Part w={w} index={4}><g transform={`translate(${604+wave(w,1,7)} ${410+wave(w,3,5)}) rotate(-18)`}>
      <path d="M-22 39-31 78-5 63 20 77 15 37" fill={C.coral}/>
      <path d="M-29 43Q-49-27 0-88Q48-29 30 42Z" fill={C.white}/>
      <path d="M0-88Q30-47 30-28H-30Q-26-58 0-88" fill={C.teal}/>
      <circle cy="-11" r="19" fill={C.sky} stroke={C.orange} strokeWidth="6"/>
      <path d={`M-15 48Q-19 ${85+wave(w,0,10)} 0 ${105+wave(w,2,8)}Q21 77 14 48Z`} fill={C.yellow}/>
      <path d="M-9 49 0 78 8 49" fill={C.orange}/>
    </g></Part>
    <circle cx="600" cy="116" r="38" fill={C.lilac}/><circle cx="615" cy="102" r="11" fill={C.purple} opacity="0.5"/><circle cx="588" cy="127" r="7" fill={C.purple} opacity="0.45"/>
  </>;
}

function PlanetWorld({w}: WorldProps) {
  const radius = 187 * (w.illustration.motion === 'pulse' ? 1+wave(w,0,0.018) : 1);
  const tilt = wave(w,0,3);
  return <>
    <Backdrop w={w} sky="#E7F1EA"/>
    <ellipse cx="407" cy="501" rx="179" ry="24" fill={C.navy} opacity="0.12"/>
    <circle cx="400" cy="299" r="221" fill={C.aqua} opacity="0.23"/>
    <circle cx="400" cy="299" r="206" fill="none" stroke={C.white} strokeWidth="3"/>
    <defs><clipPath id={`${w.id}-globe`}><circle cx="400" cy="299" r={radius}/></clipPath></defs>
    <g clipPath={`url(#${w.id}-globe)`} transform={`rotate(${tilt} 400 299)`}>
      <circle cx="400" cy="299" r={radius} fill={C.teal}/>
      <path d="M234 159 285 138 338 150 326 185 369 208 338 241 353 274 320 291 318 324 277 321 261 283 227 263 205 211Z" fill={C.green}/>
      <path d="M334 334 372 345 392 381 373 422 346 455 332 419 313 382Z" fill={C.yellow}/>
      <path d="M425 151 482 142 524 170 511 196 557 222 527 259 501 264 483 299 449 282 420 242 382 217Z" fill={C.mint}/>
      <path d="M440 284 478 307 485 356 451 390 419 364 411 331Z" fill={C.green}/>
      <path d="M529 388 573 382 589 415 558 441 521 419Z" fill={C.orange}/>
      <path d="M369 117Q491 229 421 490H586V96Z" fill={C.navy} opacity="0.14"/>
      <path d="M213 299H587M255 206Q400 250 545 206M255 393Q400 348 545 393" fill="none" stroke={C.white} strokeWidth="2" opacity="0.18"/>
      <ellipse cx="400" cy="299" rx="94" ry="187" fill="none" stroke={C.white} strokeWidth="2" opacity="0.18"/>
    </g>
    {[0,1,2].map(i => {const point=ellipsePoint(400,299,251,193,w.t*0.16+i*2.09); return <g key={i}><circle cx={point.x} cy={point.y} r="17" fill={[C.coral,C.yellow,C.purple][i]}/><circle cx={point.x-4} cy={point.y-4} r="5" fill={C.white} opacity="0.6"/></g>;})}
    <Cloud x={180+wave(w,0,7)} y={378} scale={0.6}/><Cloud x={626+wave(w,3,8)} y={203} scale={0.5}/>
    <Part w={w} index={4}><Leaf x={666} y={442} angle={26} scale={0.7}/><Leaf x={140} y={216} angle={-34} scale={0.65} color={C.orange}/></Part>
  </>;
}

function AtomWorld({w}: WorldProps) {
  const shells = [0,60,120];
  return <>
    <Backdrop w={w} sky="#F0EAF8"/>
    <circle cx="400" cy="299" r="225" fill={C.lilac} opacity="0.55"/>
    <circle cx="400" cy="299" r="174" fill={C.white} opacity="0.55"/>
    <circle cx="400" cy="299" r="118" fill={C.peach} opacity="0.35"/>
    {/* Shell paths are a symbolic model, without numeric scale or orbit-speed claims. */}
    {shells.map((angle,i) => <g key={angle} transform={`rotate(${angle} 400 299)`}>
      <ellipse cx="400" cy="299" rx="217" ry="85" fill="none" stroke={[C.purple,C.teal,C.orange][i]} strokeWidth="4" opacity="0.6"/>
      {[-1,1].map(side => {const p=ellipsePoint(400,299,217,85,w.t*0.45+i*1.3+(side===-1?Math.PI:0)); return <g key={side}><circle cx={p.x} cy={p.y} r="17" fill={[C.purple,C.teal,C.orange][i]}/><circle cx={p.x-4} cy={p.y-5} r="5" fill={C.white} opacity="0.75"/></g>;})}
    </g>)}
    <Part w={w} index={1}><g transform={`translate(400 299) scale(${w.illustration.motion==='pulse' ? 1+wave(w,0,0.05) : 1})`}>
      {[[-31,-13],[4,-30],[35,-9],[-27,24],[8,28],[1,0]].map(([x,y],i) => <g key={i}><circle cx={x} cy={y} r="28" fill={i%2 ? C.coral : C.yellow}/><path d={`M${x-15} ${y-12}Q${x-2} ${y-26} ${x+12} ${y-12}`} fill="none" stroke={C.white} strokeWidth="5" strokeLinecap="round" opacity="0.5"/></g>)}
    </g></Part>
    {[{x:147,y:141},{x:642,y:156},{x:149,y:451},{x:649,y:430}].map((point,i) => <g key={i}><circle {...{cx:point.x,cy:point.y}} r={18+i*3} fill={[C.aqua,C.peach,C.rose,C.mint][i]} opacity="0.75"/><Star {...point} x={point.x} y={point.y} r={7+wave(w,i,2)} color={C.white}/></g>)}
  </>;
}

function CellWorld({w}: WorldProps) {
  const breathe = w.illustration.motion === 'pulse' ? 1+wave(w,0,0.025) : 1+wave(w,0,0.008);
  return <>
    <Backdrop w={w} sky="#F8E9E5"/>
    <g transform={`translate(400 306) scale(${breathe}) translate(-400 -306)`}>
      <path d="M157 284C139 162 232 103 357 112C470 82 664 118 682 282C708 414 588 484 464 488C306 517 149 450 157 284Z" fill={C.coral} opacity="0.25"/>
      <path d="M174 286C156 177 245 122 359 130C472 99 644 137 663 284C687 405 572 464 461 469C306 493 163 433 174 286Z" fill={C.peach} stroke={C.coral} strokeWidth="7"/>
      <path d="M189 285C175 186 257 141 363 147C475 120 626 151 644 285C664 391 560 447 458 450C313 473 182 421 189 285Z" fill="none" stroke={C.white} strokeWidth="3" strokeDasharray="5 10" opacity="0.65"/>
      <Part w={w} index={1}><ellipse cx="423" cy="293" rx="91" ry="81" fill={C.purple} stroke={C.lilac} strokeWidth="12"/>
        <ellipse cx="419" cy="285" rx="67" ry="56" fill={C.lilac}/><circle cx="434" cy="293" r="28" fill={C.purple}/>
        <path d="M388 271Q430 253 447 262M389 307Q413 330 449 320" fill="none" stroke={C.white} strokeWidth="5" strokeLinecap="round" opacity="0.5"/>
      </Part>
      {[[272,230,-25],[547,205,18],[555,388,-18]].map(([x,y,angle],i) => <Part w={w} key={i} index={2+i}><g transform={`translate(${x} ${y+wave(w,i,3)}) rotate(${angle})`}>
        <rect x="-47" y="-22" width="94" height="44" rx="22" fill={C.orange}/>
        <path d="M-30-8-20 9-8-11 4 10 16-11 30 8" fill="none" stroke={C.cream} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
      </g></Part>)}
      <g fill="none" stroke={C.teal} strokeWidth="8" strokeLinecap="round" opacity="0.65"><path d="M297 343Q268 327 248 351T274 375Q316 361 324 391"/><path d="M297 363Q267 347 247 371T273 395Q303 387 324 412"/><path d="M313 157Q342 173 353 190M307 176Q330 188 332 208"/></g>
      {Array.from({length: 15},(_,i) => <circle key={i} cx={211+(i*73)%392} cy={177+(i*47)%250} r={4+i%3} fill={i%2?C.coral:C.teal} opacity="0.55"/>)}
      <g fill={C.aqua}><circle cx="234" cy="299" r="16"/><circle cx="501" cy="427" r="13"/><circle cx="596" cy="293" r="20"/></g>
    </g>
    {Array.from({length: 4},(_,i) => {const p=fraction(w.cycle+i/4); return <circle key={i} cx={mix(92,230,p)} cy={312+Math.sin(p*Math.PI*2+i)*21} r="7" fill={w.accent} opacity={0.15+0.7*Math.sin(p*Math.PI)}/>;})}
    <path d="M94 266Q74 304 98 341" fill="none" stroke={C.rose} strokeWidth="6" strokeLinecap="round"/>
  </>;
}

function Tree({x,y,scale,w,color=C.green}: {x:number;y:number;scale:number;w:World;color?:string}) {
  const growth=w.growth;
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <g transform={`scale(1 ${growth})`}>
      <path d="M0 0Q-8-73 4-168M-2-83-50-129M2-116 58-157" fill="none" stroke={C.bark} strokeWidth="18" strokeLinecap="round"/>
      <g transform={`rotate(${wave(w,x,1.5)} 0 -135)`}>
        <path d="M-98-163C-104-201-66-222-42-215C-38-265 29-264 39-226C81-245 116-212 103-179C124-143 69-114 45-127C19-96-26-105-43-131C-72-111-103-135-98-163Z" fill={color}/>
        <path d="M-55-163Q-7-192 51-170M-5-143V-219" fill="none" stroke={C.teal} strokeWidth="5" strokeLinecap="round" opacity="0.25"/>
        {[[-58,-181],[18,-225],[70,-160]].map(([a,b],i) => <circle key={i} cx={a} cy={b} r="12" fill={C.yellow} opacity="0.6"/>)}
      </g>
    </g>
    <path d="M0 0-24 35M1 10 35 32M-3 12-5 48" fill="none" stroke={C.bark} strokeWidth="5" strokeLinecap="round" opacity="0.6"/>
  </g>;
}

function NatureWorld({w}: WorldProps) {
  return <>
    <Backdrop w={w} sky="#E9F0DE"/>
    <circle cx="654" cy="141" r="48" fill={C.yellow}/><circle cx="654" cy="141" r={61+wave(w,0,3)} fill="none" stroke={C.yellow} strokeWidth="3" opacity="0.5"/>
    <Cloud x={157+wave(w,0,7)} y={153} scale={0.7}/><Cloud x={454+wave(w,3,5)} y={116} scale={0.45}/>
    <path d="M43 423Q188 347 355 410Q526 345 757 420V541Q392 584 43 532Z" fill={C.mint}/>
    <path d="M52 451Q204 398 375 455T748 443L735 539Q414 566 66 531Z" fill={C.soil}/>
    <path d="M52 451Q205 406 374 455T748 443" fill="none" stroke={C.green} strokeWidth="9"/>
    <Tree x={247} y={425} scale={1.12} w={w}/><Tree x={570} y={430} scale={0.86} w={w} color={C.teal}/>
    <Part w={w} index={3}><Flower x={365} y={450} scale={0.75*w.growth} w={w}/><Flower x={425} y={461} scale={0.57*w.growth} w={w} color={C.yellow}/></Part>
    <Part w={w} index={4}><g transform="translate(150 453)"><path d="M-21 3Q0-31 25 3Z" fill={C.coral}/><path d="M0 3V23" stroke={C.cream} strokeWidth="11"/><circle cx="-6" cy="-2" r="4" fill={C.white}/><circle cx="10" cy="-4" r="3" fill={C.white}/></g></Part>
    <path d="M247 438Q278 477 366 488Q445 484 571 442M366 488 382 522M290 464 267 509M498 470 533 512" fill="none" stroke={C.bark} strokeWidth="4" strokeDasharray="3 7" opacity="0.65"/>
    {Array.from({length: 5},(_,i) => {const p=fraction(w.cycle+i/5);const q=bezier({x:247,y:443},{x:315,y:506},{x:442,y:508},{x:571,y:443},p);return <circle key={i} cx={q.x} cy={q.y} r="5" fill={i%2?C.yellow:C.cream} opacity="0.9"/>;})}
    <Leaf x={686} y={441} angle={35} scale={0.72*w.growth}/><Leaf x={684} y={441} angle={-26} scale={0.52*w.growth} color={C.teal}/>
  </>;
}

const NETWORK_POINTS: Point[][] = [
  [{x:151,y:203},{x:151,y:319},{x:151,y:435}],
  [{x:396,y:153},{x:396,y:263},{x:396,y:373},{x:396,y:483}],
  [{x:641,y:203},{x:641,y:319},{x:641,y:435}],
];
function NetworkWorld({w}: WorldProps) {
  return <>
    <Backdrop w={w} sky="#E9ECF7"/>
    <ellipse cx="397" cy="316" rx="280" ry="207" fill={C.white} opacity="0.5"/>
    {[0,1].map(layer => NETWORK_POINTS[layer].map((from,i) => NETWORK_POINTS[layer+1].map((to,j) => {
      const route = arc(from,to,0);
      const active = (i+j+layer)%3===Math.floor(w.cycle*3)%3;
      const p=fraction(w.cycle*0.75+i*0.13+j*0.1-layer*0.3);
      const point=route.point(p);
      return <g key={`${layer}-${i}-${j}`}><path d={route.path} fill="none" stroke={active?w.accent:C.sky} strokeWidth={active?4:2} opacity={active?0.62:0.24}/>{active && <circle cx={point.x} cy={point.y} r="7" fill={C.yellow}/>}</g>;
    })))}
    {NETWORK_POINTS.map((layer,i) => layer.map((point,j) => <Part w={w} index={i+j} key={`${i}-${j}`} origin={`${point.x} ${point.y}`}>
      <g transform={`translate(${point.x} ${point.y}) scale(${1+wave(w,i+j,0.028)})`}>
        <circle r="35" fill={[C.teal,C.purple,C.coral][i]}/><circle cx="-8" cy="-10" r="15" fill={C.white} opacity="0.2"/>
        <rect x="-13" y="-11" width="26" height="22" rx="7" fill={C.white} opacity="0.88"/>
        <circle cx="0" cy="0" r="5" fill={[C.teal,C.purple,C.coral][i]}/>
      </g>
    </Part>))}
    <path d="M121 519H670" stroke={C.sky} strokeWidth="3" strokeDasharray="4 10" opacity="0.45"/>
    <Star x={86} y={297} r={11} color={C.coral}/><Star x={715} y={286} r={14} color={C.yellow}/>
  </>;
}

function AttentionWorld({w}: WorldProps) {
  const current = Math.min(4, Math.floor(clamp(w.p)*5));
  const tokenX = (i:number) => 116+i*142;
  const query = {x:tokenX(current),y:390};
  return <>
    <Backdrop w={w} sky="#F6EBDC"/>
    <path d="M84 454H717" stroke={C.soil} strokeWidth="3" strokeDasharray="3 10" opacity="0.65"/>
    <g data-current-token={current}>
      {/* Decoder-only causal attention: no edge originates from a future token. */}
      {Array.from({length:current+1},(_,source) => {
        const start={x:tokenX(source),y:390};
        const route=source===current ? {path:`M${start.x-22} 379C${start.x-77} 297 ${start.x+77} 297 ${start.x+22} 379`,point:(p:number)=>bezier({x:start.x-22,y:379},{x:start.x-77,y:297},{x:start.x+77,y:297},{x:start.x+22,y:379},p)} : arc(start,query,98+Math.abs(current-source)*27);
        const point=route.point(fraction(w.cycle+source/(current+2)));
        return <g key={source} data-attention-source={source} data-attention-target={current}>
          <path d={route.path} fill="none" stroke={[C.teal,C.coral,C.purple,C.blue,C.orange][source]} strokeWidth="5" opacity="0.7" strokeLinecap="round"/>
          <circle cx={point.x} cy={point.y} r="8" fill={[C.teal,C.coral,C.purple,C.blue,C.orange][source]}/>
        </g>;
      })}
      {Array.from({length:5},(_,i) => {
        const x=tokenX(i);const past=i<=current;
        return <Part w={w} index={i} key={i} origin={`${x} 421`}><g transform={`translate(${x} 421)`} data-token-position={i}>
          <rect x="-48" y="-29" width="96" height="88" rx="22" fill={past ? [C.teal,C.coral,C.purple,C.blue,C.orange][i] : C.soil} opacity={past?1:0.4}/>
          <rect x="-39" y="-21" width="78" height="13" rx="6" fill={C.white} opacity="0.25"/>
          {[0,1,2].map(j => <rect key={j} x={-25+j*19} y={13-j*5} width="11" height={18+j*7} rx="5" fill={C.white} opacity={past?0.8:0.32}/>)}
          {i===current && <rect x="-55" y="-36" width="110" height="102" rx="28" fill="none" stroke={C.navy} strokeWidth="4"/>}
          {!past && <path d="M-14 3 15 33M15 3-14 33" stroke={C.cream} strokeWidth="4" opacity="0.75"/>}
        </g></Part>;
      })}
      <path d={`M${query.x} 340V248`} stroke={C.navy} strokeWidth="4" strokeDasharray="4 9" opacity="0.5"/>
      <g transform={`translate(${query.x} 190)`}>
        <circle r="53" fill={C.white} stroke={C.yellow} strokeWidth="4"/>
        {Array.from({length:current+1},(_,i) => <rect key={i} x={-29+i*7} y={-27+i*10} width="44" height="14" rx="6" fill={[C.teal,C.coral,C.purple,C.blue,C.orange][i]} opacity="0.8"/>)}
      </g>
    </g>
  </>;
}

function Gear({x,y,r,color,angle,teeth=12}: {x:number;y:number;r:number;color:string;angle:number;teeth?:number}) {
  const points=Array.from({length:teeth*4},(_,i)=>{const a=i/(teeth*4)*Math.PI*2;const radius=r*(i%4===0||i%4===3?0.84:1);return `${Math.cos(a)*radius},${Math.sin(a)*radius}`;}).join(' ');
  return <g transform={`translate(${x} ${y}) rotate(${angle})`}>
    <polygon points={points} fill={color} stroke={C.ink} strokeWidth="3" strokeLinejoin="round"/>
    <circle r={r*0.53} fill={C.cream}/><circle r={r*0.27} fill={color}/><circle r={r*0.11} fill={C.ink}/>
    {[0,1,2].map(i=><rect key={i} x={r*0.25} y="-5" width={r*0.36} height="10" rx="5" fill={C.white} opacity="0.5" transform={`rotate(${i*120})`}/>)}
  </g>;
}

function MachineWorld({w}: WorldProps) {
  const rotation=w.t*27;
  return <>
    <Backdrop w={w} sky="#E4EDF0"/>
    <rect x="128" y="182" width="543" height="304" rx="37" fill={C.sky} opacity="0.4"/>
    <rect x="140" y="197" width="516" height="269" rx="29" fill={C.white}/>
    <path d="M177 461V509M619 461V509" stroke={C.navy} strokeWidth="21" strokeLinecap="round"/>
    <path d="M169 513H634" stroke={C.navy} strokeWidth="12" strokeLinecap="round"/>
    <Part w={w} index={1} origin="280 307"><Gear x={280} y={307} r={99} color={C.coral} angle={rotation}/></Part>
    <Part w={w} index={2} origin="439 302"><Gear x={439} y={302} r={65} color={C.yellow} angle={-rotation*1.5}/></Part>
    <Part w={w} index={3} origin="524 388"><Gear x={524} y={388} r={73} color={C.teal} angle={rotation*1.35}/></Part>
    <Part w={w} index={4}><g><rect x="177" y="385" width="142" height="51" rx="17" fill={C.purple}/><rect x="191" y="398" width="87" height="8" rx="4" fill={C.lilac}/><circle cx="300" cy="411" r="9" fill={C.yellow}/></g></Part>
    <path d="M202 211V159Q202 126 238 126H523Q565 126 565 170V219" fill="none" stroke={C.navy} strokeWidth="15" strokeLinecap="round"/>
    <path d="M202 211V159Q202 126 238 126H523Q565 126 565 170V219" fill="none" stroke={C.aqua} strokeWidth="7" strokeDasharray="13 17" strokeDashoffset={-w.t*20}/>
    <g transform="translate(399 126)"><circle r="37" fill={C.white} stroke={C.navy} strokeWidth="7"/><path d="M-22-10Q0-33 22-10" fill="none" stroke={C.green} strokeWidth="8"/><path d={`M0 11 ${Math.sin(w.t*.7)*18} -13`} stroke={C.coral} strokeWidth="5" strokeLinecap="round"/><circle cy="11" r="5" fill={C.navy}/></g>
    {[[159,219],[637,219],[159,444],[637,444]].map(([x,y],i)=><g key={i}><circle cx={x} cy={y} r="5" fill={C.navy}/><path d={`M${x-2} ${y-2} ${x+2} ${y+2}`} stroke={C.white} strokeWidth="1.5"/></g>)}
  </>;
}

function Building({x,y,width,height,color,w,index}: {x:number;y:number;width:number;height:number;color:string;w:World;index:number}) {
  const growth=w.illustration.motion==='grow'?ease((w.p-index*0.07)/0.52):1;
  return <g transform={`translate(${x} ${y}) scale(1 ${0.12+0.88*growth})`}>
    <rect x={-width/2} y={-height} width={width} height={height} rx="15" fill={color}/>
    <rect x={width/2-17} y={-height+6} width="17" height={height-6} rx="7" fill={C.navy} opacity="0.12"/>
    {Array.from({length:Math.floor((height-38)/37)},(_,row)=>Array.from({length:Math.max(1,Math.floor(width/35))},(_,col)=><rect key={`${row}-${col}`} x={-width/2+14+col*30} y={-height+19+row*37} width="15" height="22" rx="4" fill={(row+col+index)%3===0?C.yellow:C.white} opacity={(row+col)%3===0?0.65+wave(w,row+col,0.12):0.7}/>))}
    <path d={`M-9 0V-29Q0-39 9-29V0`} fill={C.navy} opacity="0.75"/>
  </g>;
}

function CityWorld({w}: WorldProps) {
  return <>
    <Backdrop w={w} sky="#E7F0F4"/>
    <circle cx="665" cy="130" r="39" fill={C.yellow}/>
    <Cloud x={172+wave(w,0,8)} y={113} scale={0.58}/><Cloud x={433+wave(w,2,5)} y={177} scale={0.42}/>
    <path d="M49 352Q190 242 340 352Q518 226 746 346V480H49Z" fill={C.sky} opacity="0.22"/>
    <path d="M47 470Q381 432 754 467V533Q440 565 47 533Z" fill={C.mint}/>
    {[[126,430,85,150,C.sky],[246,439,102,232,C.coral],[366,444,81,179,C.orange],[488,434,111,265,C.purple],[619,439,93,198,C.teal]].map(([x,y,width,height,color],i)=><Part w={w} index={i} key={i}><Building x={Number(x)} y={Number(y)} width={Number(width)} height={Number(height)} color={String(color)} w={w} index={i}/></Part>)}
    <path d="M89 504Q240 469 388 508Q545 550 711 501" fill="none" stroke={C.cream} strokeWidth="40" strokeLinecap="round"/>
    <path d="M90 504Q240 469 388 508Q545 550 711 501" fill="none" stroke={C.soil} strokeWidth="2" strokeDasharray="8 16"/>
    <Tree x={73} y={441} scale={0.37} w={w}/><Tree x={706} y={447} scale={0.4} w={w}/>
    <g transform={`translate(${160+fraction(w.t*.065)*480} 501)`}>
      <rect x="-35" y="-23" width="70" height="31" rx="11" fill={C.teal}/><rect x="-22" y="-18" width="21" height="12" rx="4" fill={C.aqua}/><rect x="6" y="-18" width="19" height="12" rx="4" fill={C.aqua}/>
      <circle cx="-22" cy="9" r="8" fill={C.navy}/><circle cx="21" cy="9" r="8" fill={C.navy}/>
    </g>
    <Character x={108} y={492} scale={0.29} w={w} pose="walk" shirt={C.purple}/><Character x={643} y={484} scale={0.25} w={w} pose="wave" shirt={C.orange} skin={C.bark}/>
  </>;
}

function PeopleWorld({w}: WorldProps) {
  return <>
    <Backdrop w={w} sky="#F5E8DA"/>
    <rect x="145" y="121" width="512" height="235" rx="34" fill={C.mint}/>
    <rect x="162" y="138" width="478" height="201" rx="22" fill={C.white}/>
    <path d="M403 348V465M269 463H537" stroke={C.bark} strokeWidth="12" strokeLinecap="round"/>
    <g transform={`translate(400 230) rotate(${wave(w,0,2)})`}>
      {[[-85,-32,C.teal],[12,-50,C.coral],[-37,25,C.purple],[70,37,C.yellow]].map(([x,y,color],i)=><Part w={w} index={i} key={i}><rect x={Number(x)} y={Number(y)} width="60" height="56" rx="15" fill={String(color)} opacity={w.illustration.motion==='compare' ? 0.55+0.45*((i%2 ? 1-w.focus : w.focus)) : 1}/></Part>)}
      <path d="M-20-10 4-24M-13 20 55 39M-64 28-58 12" stroke={C.navy} strokeWidth="4" strokeLinecap="round" opacity="0.5"/>
    </g>
    <Character x={179} y={425} scale={1.06} w={w} pose="reach" shirt={C.teal} skin={C.soil} hair={C.navy}/>
    <Character x={312} y={458} scale={0.77} w={w} pose="think" shirt={C.orange} skin={C.peach} hair={C.bark}/>
    <Character x={501} y={457} scale={0.8} w={w} pose="wave" shirt={C.purple} skin={C.bark}/>
    <Character x={649} y={423} scale={1.02} w={w} pose="reach" shirt={C.coral} skin={C.peach} hair={C.bark}/>
    <ellipse cx="409" cy="494" rx="187" ry="34" fill={C.soil}/><ellipse cx="409" cy="482" rx="187" ry="30" fill={C.cream}/>
    <g transform="translate(406 474)"><path d="M-37-5Q-15-14 0-3Q19-14 37-5V16Q15 8 0 21Q-19 9-37 16Z" fill={C.sky}/><path d="M0-3V21" stroke={C.white} strokeWidth="3"/><path d="M-29 2-10 3M12 3 29 2" stroke={C.white} strokeWidth="2" opacity="0.65"/></g>
    <Star x={96} y={276} r={13+wave(w,0,2)} color={C.orange}/><Star x={695} y={285} r={10+wave(w,2,2)} color={C.purple}/>
  </>;
}

function JourneyWorld({w}: WorldProps) {
  const route={a:{x:112,y:443},b:{x:279,y:325},c:{x:485,y:531},d:{x:683,y:240}};
  const progress=clamp(w.p*0.86+0.05);
  const traveler=bezier(route.a,route.b,route.c,route.d,progress);
  return <>
    <Backdrop w={w} sky="#E9EEF0"/>
    <circle cx="654" cy="128" r="44" fill={C.yellow}/>
    <Cloud x={170+wave(w,0,5)} y={133} scale={0.6}/><Cloud x={422+wave(w,1,5)} y={104} scale={0.45}/>
    <path d="M69 380 228 174 389 373 535 185 737 381Z" fill={C.sky} opacity="0.35"/>
    <path d="M80 418 242 237 415 419 571 259 747 413V536H80Z" fill={C.green}/>
    <path d="M193 226 228 174 270 226 245 216 229 234 214 216Z" fill={C.white}/>
    <path d="M490 239 535 185 582 239 550 221 534 248 516 227Z" fill={C.white}/>
    <path d="M92 502Q296 462 404 523Q599 475 732 506V549H92Z" fill={C.teal} opacity="0.6"/>
    <path d="M112 443C279 325 485 531 683 240" fill="none" stroke={C.cream} strokeWidth="31" strokeLinecap="round"/>
    <path d="M112 443C279 325 485 531 683 240" fill="none" stroke={C.orange} strokeWidth="3" strokeDasharray="4 15" strokeLinecap="round"/>
    {[0.1,0.38,0.65,0.9].map((p,i)=>{const point=bezier(route.a,route.b,route.c,route.d,p);return <g key={i}><circle cx={point.x} cy={point.y} r="12" fill={progress>=p?C.coral:C.white}/><circle cx={point.x} cy={point.y} r="5" fill={progress>=p?C.white:C.soil}/></g>;})}
    <Tree x={123} y={392} scale={0.38} w={w}/><Tree x={589} y={437} scale={0.4} w={w}/>
    <Character x={traveler.x} y={traveler.y-47} scale={0.73} w={w} pose="walk" shirt={w.accent} backpack/>
    <g transform="translate(681 232)"><path d="M0 4V-62" stroke={C.navy} strokeWidth="6" strokeLinecap="round"/><path d={`M3-62Q${28+wave(w,0,4)}-57 61-62L49-41Q25-38 3-42Z`} fill={C.coral}/><ellipse cy="8" rx="26" ry="8" fill={C.navy} opacity="0.15"/></g>
    <Part w={w} index={4}><g transform="translate(160 523) rotate(-9)"><rect x="-42" y="-32" width="84" height="55" rx="9" fill={C.white}/><path d="M-26 9-10-12 4 8 23-17M-13-25V17M15-25V17" fill="none" stroke={C.teal} strokeWidth="3" opacity="0.6"/><circle cx="23" cy="-17" r="5" fill={C.coral}/></g></Part>
  </>;
}

/** Filing cards are a conceptual analogy, not a literal account of model storage. */
function NotesWorld({w}: WorldProps) {
  const colors=[C.coral,C.teal,C.purple];
  const selected=Math.min(2,Math.floor(w.p*3));
  const rowY=(i:number)=>245+i*89;
  const selectedColor=colors[selected];
  const match=ease((w.cycle-0.14)/0.2);
  const transfer=ease((w.cycle-0.38)/0.47);
  const pulse=w.illustration.motion==='pulse'?1+wave(w,0,0.035):1;
  const keyRoute=arc({x:206,y:263},{x:263,y:rowY(selected)+4},39);
  const valueRoute=arc({x:486,y:rowY(selected)+2},{x:613,y:358},37);
  return <>
    <Backdrop w={w} sky="#F5E8D8"/>
    <ellipse cx="405" cy="524" rx="292" ry="24" fill={C.navy} opacity="0.09"/>
    <Part w={w} index={0} origin="141 233"><g transform={`translate(141 233) rotate(${wave(w,1,2)}) scale(${pulse})`} data-notes-role="query">
      <rect x="-77" y="-78" width="154" height="153" rx="23" fill={C.sky} opacity="0.25" transform="translate(5 8)"/>
      <rect x="-77" y="-78" width="154" height="153" rx="23" fill={C.white} stroke={selectedColor} strokeWidth="4"/>
      <path d="M-58-45H43" stroke={selectedColor} strokeWidth="10" strokeLinecap="round" opacity="0.2"/>
      <circle cx="-20" cy="-5" r="22" fill="none" stroke={selectedColor} strokeWidth="8"/>
      <path d="M-3 12 20 35" stroke={selectedColor} strokeWidth="9" strokeLinecap="round"/>
      <rect x="20" y="-12" width="31" height="9" rx="4" fill={C.soil}/><rect x="20" y="5" width="24" height="8" rx="4" fill={C.soil} opacity="0.5"/>
      <rect x="-53" y="47" width="83" height="8" rx="4" fill={selectedColor} opacity="0.5"/>
      {selected===0?<circle cx="47" cy="46" r="12" fill={selectedColor}/>:selected===1?<path d="M47 33 61 58 33 58Z" fill={selectedColor}/>:<rect x="35" y="34" width="24" height="24" rx="6" fill={selectedColor}/>}
    </g></Part>
    <Part w={w} index={1} origin="379 348">
      <path d="M276 159H476L513 180V500L481 522H276Z" fill={C.navy} opacity="0.12"/>
      <rect x="267" y="166" width="223" height="347" rx="25" fill={C.sky}/>
      <path d="M286 166H469Q490 166 490 190V493Q475 486 472 467V185H286Z" fill={C.blue} opacity="0.28"/>
      <path d="M283 515V531M473 515V531" stroke={C.navy} strokeWidth="11" strokeLinecap="round"/>
      <rect x="277" y="178" width="200" height="24" rx="10" fill={C.aqua}/>
      <rect x="322" y="183" width="105" height="11" rx="5" fill={C.white} opacity="0.6"/>
      {colors.map((color,i)=>{
        const y=rowY(i);const active=i===selected;
        const pull=active?18*match:0;
        const emphasis=w.illustration.motion==='compare'?(active?0.65+0.35*w.focus:0.24):active?1:0.46;
        return <Part w={w} index={i+2} key={i} origin={`380 ${y}`}><g transform={`translate(${pull} 0)`}>
          <path d={`M281 ${y-21} 464 ${y-21} 480 ${y-36} 297 ${y-36}Z`} fill={C.cream}/>
          {Array.from({length:4},(_,j)=><g key={j} transform={`translate(${311+j*33} ${y-32}) rotate(${j%2?2:-2})`} data-notes-role="value">
            <rect x="-21" y="-17" width="43" height="48" rx="6" fill={C.white} stroke={C.soil} strokeWidth="1"/>
            <rect x="-15" y="-22" width="23" height="10" rx="4" fill={color}/>
            <path d="M-11-3H11M-11 7H7" stroke={color} strokeWidth="4" strokeLinecap="round" opacity="0.7"/>
          </g>)}
          <rect x="281" y={y-15} width="189" height="65" rx="12" fill={active?C.white:C.aqua}/>
          <path d={`M289 ${y+35}H461`} stroke={C.blue} strokeWidth="3" opacity="0.15"/>
          <rect x="319" y={y+2} width="114" height="24" rx="9" fill={C.navy} opacity="0.12"/>
          <path d={`M338 ${y+13}H414`} stroke={C.cream} strokeWidth="7" strokeLinecap="round"/>
          <g data-notes-role="key" data-notes-selected={active}>
            <rect x="245" y={y-13} width="58" height="53" rx="14" fill={color}/>
            <rect x="253" y={y-5} width="42" height="37" rx="10" fill={C.white} opacity="0.16"/>
            {i===0?<circle cx="274" cy={y+13} r="9" fill={C.white}/>:i===1?<path d={`M274 ${y+2} 285 ${y+22} 263 ${y+22}Z`} fill={C.white}/>:<rect x="265" y={y+4} width="18" height="18" rx="5" fill={C.white}/>}
            <rect x="239" y={y-19} width="70" height="65" rx="19" fill="none" stroke={active?C.navy:color} strokeWidth={active?4:2} opacity={emphasis}/>
          </g>
        </g></Part>;
      })}
    </Part>
    {colors.map((color,i)=>{
      const route=arc({x:206,y:263},{x:253,y:rowY(i)+5},39);
      return <path key={i} d={route.path} fill="none" stroke={color} strokeWidth={i===selected?4:2} strokeDasharray={i===selected?'6 7':'3 9'} opacity={i===selected?0.2+0.65*match:0.18}/>;
    })}
    <path d={valueRoute.path} fill="none" stroke={selectedColor} strokeWidth="4" opacity={0.16+0.58*transfer} strokeDasharray="5 9"/>
    {[0,1,2].map(i=>{
      const phase=clamp((w.cycle-0.42-i*0.09)/0.38);
      const point=valueRoute.point(phase);
      const visible=w.cycle>0.42+i*0.09;
      return <g key={i} transform={`translate(${point.x} ${point.y}) rotate(${wave(w,i,4)})`} opacity={visible?0.96:0} data-notes-role="retrieved-value">
        <rect x="-24" y="-10" width="48" height="20" rx="7" fill={selectedColor}/>
        <path d="M-13 0H12" stroke={C.white} strokeWidth="4" strokeLinecap="round" opacity="0.8"/>
      </g>;
    })}
    <Part w={w} index={5} origin="653 375"><g transform="translate(654 383)" data-notes-role="answer">
      <rect x="-58" y="-95" width="128" height="179" rx="20" fill={C.soil} opacity="0.17" transform="translate(6 8)"/>
      <rect x="-58" y="-95" width="128" height="179" rx="20" fill={C.white} stroke={selectedColor} strokeWidth="3"/>
      <rect x="-43" y="-78" width="40" height="12" rx="5" fill={selectedColor}/>
      {[0,1,2].map(i=><g key={i} opacity={0.22+0.78*ease((transfer-i*0.18)/0.55)}>
        <rect x="-42" y={-46+i*33} width={88-i*8} height="19" rx="7" fill={selectedColor}/>
        <path d={`M-30 ${-36+i*33}H${28-i*8}`} stroke={C.white} strokeWidth="4" strokeLinecap="round" opacity="0.7"/>
      </g>)}
      <path d="M-41 66H45" stroke={C.soil} strokeWidth="5" strokeLinecap="round" opacity="0.4"/>
    </g></Part>
    {w.cycle<0.5&&<circle cx={keyRoute.point(match).x} cy={keyRoute.point(match).y} r="6" fill={selectedColor}/>}
    <Character x={157} y={448} scale={0.64} w={w} pose="reach" shirt={C.purple} skin={C.soil}/>
    <g transform="translate(571 506) rotate(-5)"><rect x="-40" y="-20" width="93" height="19" rx="5" fill={C.coral}/><rect x="-32" y="-35" width="75" height="17" rx="5" fill={C.yellow}/><path d="M-26-27H35M-33-11H45" stroke={C.white} strokeWidth="3" opacity="0.6"/></g>
  </>;
}

function AbstractWorld({w}: WorldProps) {
  const transform=w.illustration.motion==='transform'?ease(w.p):0.5+wave(w,0,0.2);
  return <>
    <Backdrop w={w} sky="#EEEAF5"/>
    <path d="M139 364C197 363 213 195 304 197C419 207 440 451 550 424C619 402 625 250 695 247" fill="none" stroke={C.lilac} strokeWidth="58" strokeLinecap="round"/>
    <path d="M139 364C197 363 213 195 304 197C419 207 440 451 550 424C619 402 625 250 695 247" fill="none" stroke={C.white} strokeWidth="3" strokeDasharray="4 12" opacity="0.8"/>
    {Array.from({length:8},(_,i)=>{const p=fraction(w.cycle*.6+i/8);const point=bezier({x:120,y:356},{x:210,y:96},{x:550,y:547},{x:698,y:247},p);return <g key={i} transform={`translate(${point.x} ${point.y}) rotate(${p*180})`}><rect x="-12" y="-12" width="24" height="24" rx={mix(12,3,transform)} fill={[C.coral,C.orange,C.teal,C.purple][i%4]}/></g>;})}
    <Part w={w} index={1}><g transform="translate(225 325)">
      <ellipse cx="-16" cy="57" rx="74" ry="18" fill={C.navy} opacity="0.12"/>
      <path d="M-63-13-9-49 51-12-2 24Z" fill={C.coral}/><path d="M-63-13-2 24V80L-63 43Z" fill={C.orange}/><path d="M-2 24 51-12V42L-2 80Z" fill={C.yellow}/>
      <path d="M-26-2 11-26" stroke={C.white} strokeWidth="4" strokeLinecap="round" opacity="0.5"/>
    </g></Part>
    <Part w={w} index={3}><g transform={`translate(554 270) rotate(${wave(w,0,5)})`}>
      <circle r="81" fill={C.aqua} opacity="0.4"/>
      {Array.from({length:6},(_,i)=>{const a=i*Math.PI/3;const radius=mix(23,49,transform);return <circle key={i} cx={Math.cos(a)*radius} cy={Math.sin(a)*radius} r={mix(24,19,transform)} fill={[C.teal,C.coral,C.orange,C.purple,C.green,C.blue][i]}/>;})}
      <circle r="24" fill={C.white}/><circle r="12" fill={w.accent}/>
    </g></Part>
    <g transform={`translate(387 430) rotate(${w.t*9})`}><path d="M-28-37 28-37 49 0 27 38-28 38-48 0Z" fill={C.purple}/><path d="M-14-19 14-19 25 0 14 20-14 20-25 0Z" fill={C.lilac}/></g>
    <Star x={106} y={203} r={17} color={C.yellow}/><Star x={701} y={405} r={17+wave(w,1,2)} color={C.coral}/>
    <path d="M313 138Q366 114 399 145M677 455Q644 485 610 471" fill="none" stroke={C.teal} strokeWidth="8" strokeLinecap="round" opacity="0.45"/>
  </>;
}

const WORLDS = {
  space: SpaceWorld, planet: PlanetWorld, atom: AtomWorld, cell: CellWorld,
  nature: NatureWorld, network: NetworkWorld, attention: AttentionWorld, machine: MachineWorld,
  city: CityWorld, people: PeopleWorld, journey: JourneyWorld, abstract: AbstractWorld, notes: NotesWorld,
};

export function IllustrationWorld({illustration,frame,fps,duration,vertical,accent}: IllustrationWorldProps) {
  const safeFrame=Math.max(0,Number.isFinite(frame)?frame:0);
  const seconds=safeFrame/(Number.isFinite(fps)&&fps>0?fps:30);
  const progress=clamp(safeFrame/Math.max(1,duration-1));
  const w:World={illustration,t:seconds,p:progress,cycle:fraction(seconds/4.5),growth:illustration.motion==='grow'?mix(0.35,1,ease(progress/0.78)):1,
    morph:illustration.motion==='transform'?ease(progress):0.5,focus:(Math.sin(seconds*.65)+1)/2,
    accent:accent&&/^#[\da-f]{6}$/i.test(accent)?accent:C.teal,id:`iw-${illustration.subject}-${illustration.motion}-${Math.floor(safeFrame)}-${vertical?'v':'h'}`,vertical};
  const Scene=WORLDS[illustration.subject]||AbstractWorld;
  // No text is drawn here: the compositor measures all teaching labels/callouts.
  return <svg viewBox="0 0 800 600" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label={`${illustration.subject} ${String(illustration.subject)==='notes'?'conceptual filing-card metaphor':illustration.mode==='schematic'?'schematic':'visual metaphor'}`}
    data-conceptual-metaphor={String(illustration.subject)==='notes'?true:undefined}
    data-illustration-subject={illustration.subject} data-illustration-motion={illustration.motion}
    style={{display:'block',overflow:'hidden',isolation:'isolate'}}>
    <Scene w={w}/>
  </svg>;
}
