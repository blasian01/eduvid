import type {ReactNode} from 'react';
import type {IllustrationShot} from './types';
import {FitText} from './FitText';
import {ContentIcon} from './ContentIcon';
import {IllustrationWorld} from './IllustrationWorld';

export interface ContentIllustrationProps {
  shots: IllustrationShot[];
  frame: number;
  fps: number;
  duration: number;
  vertical: boolean;
  accent?: string;
}
type Point={x:number;y:number};
type Context={shot:IllustrationShot;frame:number;t:number;p:number;vertical:boolean;accent:string};
const C={ink:'#28354F',navy:'#283D6D',cream:'#FFF7E8',white:'#FFFDFA',blue:'#486BDD',sky:'#89C6EB',teal:'#169F99',mint:'#A6E6B5',coral:'#FF666E',yellow:'#FFD166',purple:'#986CE0',lilac:'#D9C6F4',skin:'#D89578',soil:'#C9A08B'};
const COLORS=[C.blue,C.teal,C.coral,C.purple];
const clamp=(v:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,v));
const ease=(v:number)=>{const p=clamp(v);return p*p*(3-2*p);};
const mix=(a:number,b:number,p:number)=>a+(b-a)*p;
const fraction=(v:number)=>v-Math.floor(v);
const pt=(x:number,y:number):Point=>({x,y});
const polar=(base:Point,length:number,angle:number):Point=>pt(base.x+Math.cos(angle)*length,base.y+Math.sin(angle)*length);

function Label({x,y,width=180,height=44,text,color=C.ink,size=24}: {x:number;y:number;width?:number;height?:number;text:string;color?:string;size?:number}) {
  return <foreignObject x={x} y={y} width={width} height={height}>
    <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',padding:2,boxSizing:'border-box'}}>
      <FitText text={text} name="content illustration label" height="100%" maxFont={size} minFont={14} color={color} weight={700} align="center" style={{overflowWrap:'normal',wordBreak:'normal'}}/>
    </div>
  </foreignObject>;
}

function Canvas({children}: {children:ReactNode}) {
  return <svg viewBox="0 0 800 600" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{display:'block'}}>
    <rect x="14" y="18" width="772" height="564" rx="42" fill="#EFF0FC"/>
    <ellipse cx="161" cy="159" rx="123" ry="97" fill={C.white} opacity="0.65"/>
    <ellipse cx="660" cy="474" rx="120" ry="85" fill={C.lilac} opacity="0.25"/>
    {children}
  </svg>;
}

function Connector({from,to,color=C.blue,progress=0,opacity=1,curve=0}: {from:Point;to:Point;color?:string;progress?:number;opacity?:number;curve?:number}) {
  const mid=pt((from.x+to.x)/2,(from.y+to.y)/2-curve);
  const endAngle=Math.atan2(to.y-mid.y,to.x-mid.x);
  const q=clamp(progress);const inv=1-q;
  const moving=pt(inv*inv*from.x+2*inv*q*mid.x+q*q*to.x,inv*inv*from.y+2*inv*q*mid.y+q*q*to.y);
  return <g opacity={opacity}>
    <path d={curve?`M${from.x} ${from.y}Q${mid.x} ${mid.y} ${to.x} ${to.y}`:`M${from.x} ${from.y}L${to.x} ${to.y}`} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"/>
    <path d={`M${to.x-13*Math.cos(endAngle-.45)} ${to.y-13*Math.sin(endAngle-.45)}L${to.x} ${to.y}L${to.x-13*Math.cos(endAngle+.45)} ${to.y-13*Math.sin(endAngle+.45)}`} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
    {progress>0&&progress<1&&<circle cx={moving.x} cy={moving.y} r="7" fill={color}/>}
  </g>;
}

type Rig={shoulder:Point;hip:Point;elbows:[Point,Point];hands:[Point,Point];knees:[Point,Point];feet:[Point,Point];front?:boolean;side?:boolean;core?:boolean};
const EXERCISE_TITLES:Record<NonNullable<IllustrationShot['exercise']>,string>={
  crunch:'Crunch', 'leg-raise':'Leg raise',plank:'Plank','side-plank':'Side plank','flutter-kick':'Flutter kicks',bicycle:'Bicycle crunch','russian-twist':'Russian twist','mountain-climber':'Mountain climber','heel-touch':'Heel touches','sit-up':'Sit-up',standing:'Standing',core:'Core', 'hip-dip':'Hip dips','star-crunch':'Star crunch','crunch-reach':'Crunch reach','plank-up-down':'Plank up and down','reverse-crunch':'Reverse crunch','hollow-hold':'Hollow hold',lying:'Lying',
};

/** Art poses express the named action; there are no repetitions, technique cues or prescriptions. */
function exerciseRig(name:NonNullable<IllustrationShot['exercise']>,t:number):Rig {
  const swing=(Math.sin(t*1.7)+1)/2;
  const hip=pt(410,412);const shoulder=pt(274,407);
  const rest:Rig={shoulder,hip,elbows:[pt(318,421),pt(318,432)],hands:[pt(364,435),pt(364,444)],knees:[pt(486,344),pt(476,354)],feet:[pt(543,442),pt(529,449)]};
  if(name==='lying') return rest;
  if(['leg-raise','flutter-kick','reverse-crunch','hollow-hold'].includes(name)) {
    let raisedHip=hip;
    if(name==='reverse-crunch') raisedHip=pt(400-12*swing,406-25*swing);
    const angles=name==='flutter-kick'?[.24+.16*Math.sin(t*2),.24-.16*Math.sin(t*2)]:name==='hollow-hold'?[.34,.31]:[mix(.18,1.2,swing),mix(.16,1.18,swing)];
    const knees=angles.map((angle,i)=>polar(pt(raisedHip.x,raisedHip.y+i*8),97,-angle)) as [Point,Point];
    const feet=angles.map((angle,i)=>polar(knees[i],105,-angle)) as [Point,Point];
    if(name==='reverse-crunch') {
      return {...rest,hip:raisedHip,knees:[pt(449,300-14*swing),pt(461,310-14*swing)],feet:[pt(490,237-8*swing),pt(503,251-8*swing)]};
    }
    if(name==='hollow-hold') return {...rest,shoulder:pt(290,372),elbows:[pt(232,340),pt(239,349)],hands:[pt(172,312),pt(184,321)],knees,feet};
    return {...rest,hip:raisedHip,knees,feet};
  }
  if(['crunch','crunch-reach','sit-up','bicycle'].includes(name)) {
    const lift=name==='sit-up'?mix(.12,1.1,swing):mix(.08,.4,swing);
    const lifted=pt(410-Math.cos(lift)*139,412-Math.sin(lift)*139);
    // A crunch keeps the arms folded near the chest; a crunch reach extends them
    // toward the knees. The pose, rather than only its heading, expresses the cue.
    const folded=name==='crunch';
    const elbows:[Point,Point]=folded?[pt(lifted.x+40,lifted.y+24),pt(lifted.x+35,lifted.y-18)]:[pt(lifted.x+57,lifted.y-8),pt(lifted.x+55,lifted.y+3)];
    const hands:[Point,Point]=folded?[pt(lifted.x+52,lifted.y-9),pt(lifted.x+52,lifted.y+10)]:[pt(lifted.x+117,lifted.y-15),pt(lifted.x+111,lifted.y-4)];
    if(name==='bicycle') {
      const alternate=(Math.sin(t*1.8)+1)/2;
      return {...rest,shoulder:lifted,elbows,hands,knees:[pt(mix(444,496,alternate),mix(308,366,alternate)),pt(mix(497,445,alternate),mix(372,317,alternate))],feet:[pt(mix(447,604,alternate),mix(250,406,alternate)),pt(mix(610,454,alternate),mix(414,260,alternate))]};
    }
    return {...rest,shoulder:lifted,elbows,hands};
  }
  if(['plank','mountain-climber','plank-up-down','hip-dip'].includes(name)) {
    const lift=name==='plank-up-down'?18*swing:0;
    const s=pt(270,309-lift);const h=pt(424,359-lift*.6+(name==='hip-dip'?16*Math.sin(t*1.4):0));
    const bent=(Math.sin(t*1.9)+1)/2;
    const knees:[Point,Point]=name==='mountain-climber'?[pt(mix(418,524,bent),mix(385,392,bent)),pt(mix(527,420,bent),mix(400,391,bent))]:[pt(522,393),pt(518,401)];
    const feet:[Point,Point]=name==='mountain-climber'?[pt(mix(470,624,bent),mix(427,428,bent)),pt(mix(620,476,bent),mix(435,433,bent))]:[pt(623,427),pt(616,434)];
    const palms=name==='mountain-climber';
    const support=name==='plank-up-down'?swing:palms?1:0;
    return {shoulder:s,hip:h,elbows:[pt(270,mix(416,369-lift*.5,support)),pt(284,mix(422,375-lift*.5,support))],hands:[pt(mix(332,268,support),mix(435,441,support)),pt(mix(340,288,support),mix(441,447,support))],knees,feet};
  }
  if(name==='side-plank') {
    return {shoulder:pt(289,289),hip:pt(430,351),side:true,elbows:[pt(289,413),pt(373,247)],hands:[pt(355,436),pt(441,327)],knees:[pt(522,393),pt(528,385)],feet:[pt(625,437),pt(632,429)]};
  }
  if(name==='russian-twist') {
    const turn=Math.sin(t*1.4)*54;
    return {shoulder:pt(389+turn*.2,292),hip:pt(425,410),elbows:[pt(402+turn*.6,335),pt(408+turn*.6,340)],hands:[pt(423+turn,359),pt(427+turn,366)],knees:[pt(505,354),pt(494,365)],feet:[pt(565,431),pt(552,440)]};
  }
  if(name==='star-crunch'||name==='heel-touch') {
    const tuck=name==='star-crunch'?swing:0;
    const side=name==='heel-touch'?Math.sin(t*1.5)*22:0;
    return {shoulder:pt(400+side,239+15*tuck),hip:pt(400,355),front:true,
      elbows:[pt(312+42*tuck,260+40*tuck),pt(488-42*tuck,260+40*tuck)],
      hands:name==='heel-touch'?[pt(322+side,416),pt(478+side,416)]:[pt(248+92*tuck,257+78*tuck),pt(552-92*tuck,257+78*tuck)],
      knees:name==='heel-touch'?[pt(315,397),pt(485,397)]:[pt(330+32*tuck,414-34*tuck),pt(470-32*tuck,414-34*tuck)],feet:name==='heel-touch'?[pt(325,433),pt(475,433)]:[pt(288+58*tuck,480-35*tuck),pt(512-58*tuck,480-35*tuck)]};
  }
  return {shoulder:pt(400,248),hip:pt(400,364),front:true,core:name==='core',elbows:[pt(332,308),pt(468,308)],hands:[pt(337,369),pt(463,369)],knees:[pt(371,426),pt(429,426)],feet:[pt(360,492),pt(442,492)]};
}

function Limb({from,joint,to,color,width=23,skin=false,far=false}: {from:Point;joint:Point;to:Point;color:string;width?:number;skin?:boolean;far?:boolean}) {
  return <g opacity={far?.7:1}>
    <path d={`M${from.x} ${from.y}L${joint.x} ${joint.y}L${to.x} ${to.y}`} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx={joint.x} cy={joint.y} r={width/2} fill={color}/>
    {skin?<circle cx={to.x} cy={to.y} r="10" fill={C.skin}/>:<g transform={`translate(${to.x} ${to.y})`}><path d="M-12-9H5L23 1Q25 12 14 12H-13Z" fill={C.navy}/><path d="M-11 9H20" stroke={C.white} strokeWidth="3" opacity=".65"/></g>}
  </g>;
}

function Figure({rig,c}: {rig:Rig;c:Context}) {
  const dx=rig.hip.x-rig.shoulder.x;const dy=rig.hip.y-rig.shoulder.y;const len=Math.hypot(dx,dy)||1;
  const unit=pt(dx/len,dy/len);const normal=pt(-unit.y,unit.x);
  const shoulderWidth=rig.front?43:rig.side?38:29;const hipWidth=rig.front?29:rig.side?28:23;
  const edge=(p:Point,width:number,side:number)=>pt(p.x+normal.x*width*side,p.y+normal.y*width*side);
  const a=edge(rig.shoulder,shoulderWidth,1),b=edge(rig.hip,hipWidth,1),d=edge(rig.shoulder,shoulderWidth,-1),e=edge(rig.hip,hipWidth,-1);
  const supportShoulder=rig.side?edge(rig.shoulder,shoulderWidth*.78,1):rig.shoulder;
  const upperShoulder=rig.side?edge(rig.shoulder,shoulderWidth*.78,-1):rig.shoulder;
  const head=pt(rig.shoulder.x-unit.x*48,rig.shoulder.y-unit.y*48);
  const core=pt(mix(rig.shoulder.x,rig.hip.x,.64),mix(rig.shoulder.y,rig.hip.y,.64));
  return <g data-exercise-pose data-side-orientation={rig.side?true:undefined}>
    <Limb from={rig.hip} joint={rig.knees[1]} to={rig.feet[1]} color={C.purple} width={27} far/>
    {!rig.side&&<Limb from={rig.shoulder} joint={rig.elbows[1]} to={rig.hands[1]} color={C.skin} width={21} skin far/>}
    <Limb from={rig.hip} joint={rig.knees[0]} to={rig.feet[0]} color={C.blue} width={28}/>
    <path d={`M${a.x} ${a.y}Q${core.x+normal.x*38} ${core.y+normal.y*38} ${b.x} ${b.y}L${e.x} ${e.y}Q${core.x-normal.x*36} ${core.y-normal.y*36} ${d.x} ${d.y}Z`} fill={c.accent}/>
    {rig.side&&<path d={`M${d.x} ${d.y}Q${rig.shoulder.x+unit.x*22} ${rig.shoulder.y+unit.y*22} ${a.x} ${a.y}`} fill="none" stroke={C.cream} strokeWidth="3" opacity=".55"/>}
    <path d={`M${b.x} ${b.y}L${e.x} ${e.y}`} stroke={C.navy} strokeWidth="13" strokeLinecap="round"/>
    <ellipse cx={core.x} cy={core.y} rx="29" ry="22" fill={C.yellow} opacity={.25+.1*Math.sin(c.t*1.2)} transform={`rotate(${Math.atan2(dy,dx)*180/Math.PI} ${core.x} ${core.y})`}/>
    <path d={`M${rig.shoulder.x} ${rig.shoulder.y}L${head.x} ${head.y}`} stroke={C.skin} strokeWidth="23" strokeLinecap="round"/>
    <g transform={`translate(${head.x} ${head.y})`}>
      <ellipse rx="26" ry="29" fill={C.skin}/><path d="M-25-1Q-33-35-4-34Q32-37 25-5L14-18Q-3-9-17-21Z" fill={C.navy}/>
      <circle cx="-10" cy="0" r="2.5" fill={C.ink}/><circle cx="10" cy="0" r="2.5" fill={C.ink}/><path d="M-5 13Q1 17 7 13" fill="none" stroke={C.ink} strokeWidth="2.5" strokeLinecap="round"/>
    </g>
    <Limb from={supportShoulder} joint={rig.elbows[0]} to={rig.hands[0]} color={C.skin} width={23} skin/>
    {/* The upper arm rests on the hip in front of the chest-facing torso.
        Drawing it behind the body would erase the side-plank silhouette. */}
    {rig.side&&<g data-side-plank-upper-arm><Limb from={upperShoulder} joint={rig.elbows[1]} to={rig.hands[1]} color={C.skin} width={23} skin/></g>}
    {rig.core&&<path d={`M${core.x-15} ${core.y-16}H${core.x+15}M${core.x-15} ${core.y}H${core.x+15}M${core.x} ${core.y-25}V${core.y+22}`} stroke={C.cream} strokeWidth="3" opacity=".45"/>}
  </g>;
}

function Exercise({c}: {c:Context}) {
  const name=c.shot.exercise??'standing';const rig=exerciseRig(name,c.t);
  const topView=name==='star-crunch'||name==='heel-touch';
  const supported=['plank','side-plank','mountain-climber','plank-up-down','hip-dip'].includes(name);
  const offset=topView?0:name==='standing'||name==='core'?-15:supported?40:name==='russian-twist'?50:35;
  return <Canvas>
    <Label x={100} y={45} width={600} height={58} text={EXERCISE_TITLES[name]} size={31}/>
    {topView?<g><rect x="155" y="136" width="490" height="376" rx="25" fill={C.teal} opacity=".16"/><rect x="169" y="150" width="462" height="348" rx="17" fill="none" stroke={C.teal} strokeWidth="3" opacity=".3"/></g>:<g><path d="M97 479H698L671 516H70Z" fill={C.teal} opacity=".16"/><path d="M96 476H696L680 495H79Z" fill={C.teal}/><path d="M112 487H650" stroke={C.mint} strokeWidth="3" opacity=".5"/><ellipse cx="405" cy="473" rx="249" ry="13" fill={C.ink} opacity=".08"/></g>}
    <g transform={`translate(0 ${offset})`}><Figure rig={rig} c={c}/></g>
    <Label x={170} y={527} width={460} height={32} text={topView?'Floor view · illustrated movement':'Illustrated movement'} size={18} color={C.navy}/>
  </Canvas>;
}

function Chip({x,y,width=96,height=62,color=C.blue,text,blank=false,current=false}: {x:number;y:number;width?:number;height?:number;color?:string;text?:string;blank?:boolean;current?:boolean}) {
  return <g>
    <rect x={x} y={y+6} width={width} height={height} rx="16" fill={color} opacity=".1"/>
    <rect x={x} y={y} width={width} height={height} rx="16" fill={blank?C.white:color} stroke={current?C.ink:color} strokeWidth={current?4:2} strokeDasharray={blank?'6 7':undefined}/>
    {text?<Label x={x+6} y={y+7} width={width-12} height={height-14} text={text} color={C.white} size={23}/>:!blank&&<><rect x={x+width*.2} y={y+height*.3} width={width*.6} height="8" rx="4" fill={C.white} opacity=".65"/><rect x={x+width*.2} y={y+height*.56} width={width*.38} height="8" rx="4" fill={C.white} opacity=".38"/></>}
  </g>;
}

function Tokens({c}: {c:Context}) {
  // A narrated ellipsis denotes the unspecified prediction, not a context token.
  const words=c.shot.text?.trim().replace(/(?:\s*(?:\.{2,}|…))+$/u,'').trim().split(/\s+/).filter(Boolean);
  const tokens=words?.length?words.slice(-12):['','','',''];
  const columns=Math.min(6,tokens.length);const width=Math.min(111,610/columns-12);
  const start=(800-(columns*(width+12)-12))/2;
  return <Canvas>
    <Label x={115} y={68} width={570} height={51} text="Context → current token → next" size={28}/>
    {tokens.map((token,i)=>{
      const x=start+(i%columns)*(width+12);const y=176+Math.floor(i/columns)*96;
      return <g key={i} data-context-token={i}><Chip x={x} y={y} width={width} color={i===tokens.length-1?C.coral:C.blue} text={token} current={i===tokens.length-1}/>{i===tokens.length-1&&<Label x={x-10} y={y+68} width={width+20} height={35} text="Current" size={20}/>}</g>;
    })}
    <Connector from={pt(324,402)} to={pt(465,402)} color={c.accent} progress={fraction(c.t*.3)}/>
    <Chip x={484} y={370} width={125} height={70} color={C.teal} blank/>
    <Label x={135} y={378} width={182} height={47} text="Context so far" size={23}/>
    <Label x={475} y={446} width={149} height={57} text="Predicted token" size={22}/>
    <Label x={80} y={515} width={640} height={46} text={words&&words.length>12?'Illustrative word-piece excerpt; actual tokenization varies':'Illustrative word pieces; actual tokenization varies'} size={20}/>
  </Canvas>;
}

function Embedding({c}: {c:Context}) {
  return <Canvas>
    <Label x={85} y={54} width={630} height={51} text="Token → symbolic representation" size={28}/>
    {[0,1,2].map(i=>{
      const y=167+i*109;const active=Math.floor(c.p*3)%3===i;
      return <g key={i}>
        <Chip x={124} y={y} width={115} height={64} color={COLORS[i]}/>
        <Connector from={pt(253,y+33)} to={pt(363,y+33)} color={COLORS[i]} progress={fraction(c.t*.3+i/3)} opacity={active?1:.4}/>
        <g transform={`translate(383 ${y})`} data-symbolic-vector>
          <rect x="0" y="0" width="252" height="64" rx="14" fill={C.white} stroke={COLORS[i]} strokeWidth="3"/>
          <path d="M20 13H12V51H20M230 13H238V51H230" fill="none" stroke={COLORS[i]} strokeWidth="3"/>
          {[0,1,2].map(j=><g key={j}><rect x={37+j*60} y="20" width="40" height="25" rx="5" fill={COLORS[i]} opacity={.18+.08*((j+i)%3)}/><circle cx={47+j*60} cy="33" r="2" fill={COLORS[i]}/><circle cx={56+j*60} cy="33" r="2" fill={COLORS[i]}/><circle cx={65+j*60} cy="33" r="2" fill={COLORS[i]}/></g>)}
        </g>
      </g>;
    })}
    <Label x={95} y={505} width={170} text="Tokens"/><Label x={348} y={505} width={323} text="Symbolic numeric slots"/>
  </Canvas>;
}

function AttentionMix({c}: {c:Context}) {
  const stage=Math.min(3,Math.floor(c.p*4));
  const focused=Math.floor(c.t*.5)%3;
  return <Canvas>
    <Label x={63} y={47} width={675} height={52} text="Compare → weight → mix values" size={28}/>
    <circle cx="95" cy="269" r="43" fill={C.blue}/><Label x={62} y={237} width={66} height={62} text="Q" color={C.white} size={32}/>
    <Label x={32} y={324} width={125} text="Query" size={22}/>
    {/* Values are existing inputs. Comparison-derived weights and values meet
        at an explicit application join; weights never create a value vector. */}
    <path d="M749 190V483H548" fill="none" stroke={C.teal} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity={stage>=3?.8:.12}/>
    <path d="M561 475 548 483 561 491" fill="none" stroke={C.teal} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity={stage>=3?.8:.12}/>
    {[0,1,2].map(i=>{
      const y=160+i*100;const selected=i===focused;const color=COLORS[i];
      return <g key={i} data-attention-value-row={i}>
        <Connector from={pt(145,266)} to={pt(213,y+30)} color={color} progress={fraction(c.t*.25+i/3)} opacity={selected?1:.3}/>
        <Chip x={223} y={y} width={74} height={58} color={color}/>
        <Connector from={pt(307,y+30)} to={pt(356,y+30)} color={color} progress={stage>=1?fraction(c.t*.28):0} opacity={stage>=1?1:.18}/>
        <rect x="366" y={y+6} width="94" height="47" rx="14" fill={selected&&stage>=1?C.yellow:C.white} stroke={color} strokeWidth="2"/>
        <path d={`M385 ${y+29}H441`} stroke={color} strokeWidth="7" strokeLinecap="round" opacity={stage>=1?(selected?.9:.25):.1}/>
        <g data-attention-input="weight"><Connector from={pt(472,y+28)} to={pt(692,y+16)} color={color} curve={66} progress={stage>=2?fraction(c.t*.3+i/3):0} opacity={stage>=2?1:.15}/></g>
        <Chip x={546} y={y} width={83} height={58} color={color}/>
        <g data-attention-input="value"><Connector from={pt(639,y+30)} to={pt(689,y+30)} color={color} progress={stage>=2?fraction(c.t*.3+i/3+.4):0} opacity={stage>=2?1:.3}/></g>
        <g data-attention-apply-weight><circle cx="710" cy={y+30} r="18" fill={C.white} stroke={color} strokeWidth="3"/><path d={`M704 ${y+24}L716 ${y+36}M704 ${y+36}L716 ${y+24}`} stroke={color} strokeWidth="3" strokeLinecap="round"/></g>
        <Connector from={pt(733,y+30)} to={pt(749,y+30)} color={color} progress={stage>=3?fraction(c.t*.25+i/3):0} opacity={stage>=3?1:.15}/>
      </g>;
    })}
    <Label x={191} y={105} width={139} text="Keys (K)" size={21}/><Label x={355} y={105} width={116} text="Weights" size={21}/><Label x={522} y={105} width={128} text="Values (V)" size={21}/><Label x={670} y={105} width={83} text="Apply" size={19}/>
    <rect x="349" y="450" width="184" height="67" rx="20" fill={C.navy}/>
    {[0,1,2].map(i=><rect key={i} x={370+i*46} y="470" width="34" height="26" rx="8" fill={COLORS[i]} opacity={stage===3?.65:.15}/>)}
    <Label x={318} y={526} width={246} height={34} text="Mixed context" size={23}/>
  </Canvas>;
}

function Generation({c}: {c:Context}) {
  // Keep the sixth slot available for the next prediction through the loop.
  const appended=Math.min(2,Math.floor(c.p*4));
  return <Canvas>
    <Label x={75} y={48} width={650} height={55} text="Append one token, then repeat" size={29}/>
    {Array.from({length:6},(_,i)=>{
      const generated=i>=3;const exists=i<3+appended;const predicted=i===3+appended;
      return (exists||predicted)&&<g key={i} data-generation-token={i} data-generated={generated&&exists}><Chip x={61+i*115} y={166} width={96} height={65} color={generated?C.teal:C.blue} blank={generated} current={predicted}/>{generated&&exists&&<rect x={72+i*115} y="219" width="74" height="7" rx="3" fill={C.teal}/>}</g>;
    })}
    <Label x={78} y={250} width={263} text="Existing context"/><Label x={433} y={250} width={287} text="Next token stays unspecified" size={22}/>
    <rect x="293" y="348" width="214" height="102" rx="27" fill={C.purple}/>
    <Label x={321} y={371} width={159} height={51} text="Model" color={C.white} size={28}/>
    <Connector from={pt(176,245)} to={pt(291,382)} color={C.blue} progress={fraction(c.t*.3)}/>
    <Connector from={pt(509,382)} to={pt(61+(3+appended)*115+48,243)} color={C.teal} progress={fraction(c.t*.3+.5)}/>
    <path d="M558 474Q400 535 242 474" fill="none" stroke={C.coral} strokeWidth="5" strokeLinecap="round"/>
    <path d="M253 490 242 474 262 472" fill="none" stroke={C.coral} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
    <Label x={291} y={507} width={218} text="Use the expanded context" size={22}/>
  </Canvas>;
}

function ObjectCard({x,y,width,height,object,color,active,compact=false}: {x:number;y:number;width:number;height:number;object:NonNullable<IllustrationShot['objects']>[number];color:string;active:boolean;compact?:boolean}) {
  const iconSize=compact?58:Math.min(104,width*.62);
  return <g>
    <rect x={x+3} y={y+7} width={width} height={height} rx="21" fill={color} opacity=".12"/>
    <rect x={x} y={y} width={width} height={height} rx="21" fill={C.white} stroke={active?color:C.sky} strokeWidth={active?4:2}/>
    <g transform={`translate(${compact?x+15:x+(width-iconSize)/2} ${compact?y+(height-iconSize)/2:y+22})`}><ContentIcon name={object.icon} size={iconSize} color={color}/></g>
    <Label x={compact?x+86:x+10} y={compact?y+9:y+height-76} width={compact?width-96:width-20} height={compact?height-18:64} text={object.label} size={compact?23:24}/>
  </g>;
}

function Process({c}: {c:Context}) {
  const objects=c.shot.objects??[];const layout=c.shot.layout??'single';
  const active=Math.min(Math.max(0,objects.length-1),Math.floor(c.p*Math.max(1,objects.length)));
  if(!objects.length) return <Canvas><Label x={100} y={234} width={600} height={85} text="Scene objects are not available"/></Canvas>;
  if(layout==='single') return <Canvas><ObjectCard x={224} y={127} width={352} height={347} object={objects[0]} color={c.accent} active/></Canvas>;
  if(layout==='sequence') {
    const vertical=c.vertical&&objects.length>2;
    const cardWidth=vertical?488:objects.length===2?242:objects.length===3?190:143;
    const height=vertical?91:230;
    const gap=vertical?21:objects.length===4?36:43;
    const left=vertical?156:(800-(objects.length*cardWidth+(objects.length-1)*gap))/2;
    return <Canvas>{objects.map((object,i)=>{
      const x=left+(vertical?0:i*(cardWidth+gap));const y=vertical?77+i*(height+gap):191;
      return <g key={i} data-process-order={i}><ObjectCard x={x} y={y} width={cardWidth} height={height} object={object} color={COLORS[i%4]} active={i===active} compact={vertical}/>{i<objects.length-1&&<Connector from={vertical?pt(400,y+height+4):pt(x+cardWidth+5,y+height/2)} to={vertical?pt(400,y+height+gap-4):pt(x+cardWidth+gap-5,y+height/2)} color={COLORS[i%4]} progress={fraction(c.t*.3+i*.2)} opacity={i<=active?1:.3}/>}</g>;
    })}</Canvas>;
  }
  const rows=objects.length>2?2:1;const cardWidth=293;const height=rows===2?193:292;const top=rows===2?79:139;
  return <Canvas>{layout==='comparison'&&<path d="M400 64V526" stroke={C.purple} strokeWidth="3" strokeDasharray="5 10" opacity=".35"/>}{objects.map((object,i)=>{
    const col=objects.length===1?0:i%2;const row=Math.floor(i/2);const x=objects.length===1?254:76+col*353;const y=top+row*(height+30);
    return <ObjectCard key={i} x={x} y={y} width={cardWidth} height={height} object={object} color={COLORS[i%4]} active={i===active}/>;
  })}</Canvas>;
}

function Bridge({c}: {c:Context}) {
  const moving=mix(178,627,ease(c.p));const sag=44+8*Math.sin(c.t*.8);
  const deckY=(x:number)=>350+sag*Math.sin((x-145)/(650-145)*Math.PI);
  return <Canvas>
    <Label x={67} y={48} width={666} height={56} text="Rope bridge — a conceptual metaphor" size={28}/>
    <path d="M28 520 83 278 190 356 215 543Z" fill={C.sky}/><path d="M572 543 636 315 708 282 774 520Z" fill={C.purple}/>
    <path d="M209 539Q410 495 589 540" fill="none" stroke={C.teal} strokeWidth="28" opacity=".4"/>
    <path d="M145 266V477M650 266V477" stroke={C.navy} strokeWidth="13" strokeLinecap="round"/>
    {[0,1,2,3].map(i=>{
      const base=277+i*18;
      return <path key={i} d={`M145 ${base}Q397 ${base+sag*2} 650 ${base}`} fill="none" stroke={COLORS[i]} strokeWidth={7+(i===Math.floor(c.p*4)%4?2:0)} opacity=".8"/>;
    })}
    <path d={`M145 350Q397 ${350+sag*2} 650 350`} fill="none" stroke={C.soil} strokeWidth="18"/>
    {Array.from({length:13},(_,i)=>{const x=155+i*40;return <path key={i} d={`M${x} ${deckY(x)-4}V${deckY(x)+13}`} stroke={C.cream} strokeWidth="5"/>;})}
    {[185,265,345,425,505,585].map(x=><path key={x} d={`M${x} ${277+sag*Math.sin((x-145)/505*Math.PI)}V${deckY(x)}`} stroke={C.cream} strokeWidth="3" opacity=".85"/>)}
    <circle cx={moving} cy={deckY(moving)-49} r="19" fill={C.coral}/><rect x={moving-17} y={deckY(moving)-29} width="34" height="32" rx="11" fill={C.yellow}/>
    <Label x={162} y={503} width={475} height={58} text="The bridge is an analogy, not anatomy" size={23}/>
  </Canvas>;
}

export function ContentIllustration({shots,frame,fps,duration,vertical,accent}:ContentIllustrationProps) {
  if(!shots.length) return null;
  const safeFrame=clamp(Number.isFinite(frame)?frame:0,0,Math.max(0,duration-1));
  let index=0;
  for(let i=0;i<shots.length;i++) if(safeFrame>=shots[i].startFrame) index=i;
  const shot=shots[index];
  const local=clamp(safeFrame-shot.startFrame,0,Math.max(0,shot.durationInFrames-1));
  const c:Context={shot,frame:local,t:local/(fps>0?fps:30),p:local/Math.max(1,shot.durationInFrames-1),vertical,accent:accent&&/^#[\da-f]{6}$/i.test(accent)?accent:C.blue};
  let image:ReactNode;
  switch(shot.kind) {
    case 'exercise':image=<Exercise c={c}/>;break;
    case 'tokens':image=<Tokens c={c}/>;break;
    case 'embedding':image=<Embedding c={c}/>;break;
    case 'attention-mix':image=<AttentionMix c={c}/>;break;
    case 'generation':image=<Generation c={c}/>;break;
    case 'process':image=<Process c={c}/>;break;
    case 'bridge':image=<Bridge c={c}/>;break;
    case 'causal-attention':image=<IllustrationWorld illustration={{subject:'attention',motion:'flow',mode:'schematic'}} frame={local} fps={fps} duration={shot.durationInFrames} vertical={vertical} accent={c.accent}/>;break;
    case 'notes':image=<IllustrationWorld illustration={{subject:'notes',motion:'flow',mode:'metaphor'}} frame={local} fps={fps} duration={shot.durationInFrames} vertical={vertical} accent={c.accent}/>;break;
  }
  // A hard shot cut is intentional: the old pose never persists under the next cue.
  return <div data-content-kind={shot.kind} data-content-exercise={shot.exercise} data-content-cue={shot.cue} data-content-shot={index}
    style={{width:'100%',height:'100%',position:'relative'}}>{image}</div>;
}
