import type {ReactNode} from 'react';
import {Icon} from './Icons';
import {ICON_NAMES, type ContentIconName, type IconName} from './types';

/** Original symbols for scene composition. No external art or executable data. */
export function ContentIcon({name, size, color}: {name: ContentIconName; size: number; color: string}) {
  if ((ICON_NAMES as readonly string[]).includes(name)) return <Icon name={name as IconName} color={color} size={size}/>;
  const shapes: Partial<Record<ContentIconName, ReactNode>> = {
    plate: <><circle cx="50" cy="51" r="32" fill="#FFF4DD"/><circle cx="50" cy="51" r="24" strokeWidth="2"/><path d="M48 31Q29 36 31 53L47 53Z" fill="#68C99B"/><path d="M52 32Q73 36 70 52H52Z" fill="#FFD166"/><path d="M33 58Q50 76 69 58Z" fill="#FF858F"/><path d="M8 18V46m-4-28v16m8-16v16M8 46v37M89 18v65m0-65c-8 10-8 24 0 28"/></>,
    calendar: <><rect x="13" y="22" width="74" height="65" rx="10" fill={color} fillOpacity=".16"/><path d="M13 40h74M31 13v18M69 13v18"/>{[0,1,2].map(i => <path key={i} d={`M${26+i*24} 58l5 5 9-11M${26+i*24} 76h10`} strokeWidth="4"/>)}</>,
    bridge: <><path d="M10 23v58M90 23v58M10 30Q50 66 90 30M10 54Q50 88 90 54"/>{[0,1,2,3,4].map(i => <path key={i} d={`M${18+i*16} ${38+12*Math.sin((i+1)*Math.PI/6)}v23`} strokeWidth="3"/>)}<path d="M7 84h16m54 0h16"/></>,
    computer: <><rect x="10" y="17" width="80" height="54" rx="9" fill={color} fillOpacity=".16"/><path d="M41 71v13m18-13v13M30 86h40M18 59h64"/><path d="m30 32-10 9 10 9m40-18 10 9-10 9M54 29 46 52" strokeWidth="4"/></>,
    token: <><rect x="9" y="29" width="82" height="43" rx="16" fill={color} fillOpacity=".16"/><path d="M24 45h19m-19 12h43m-13-12h13" strokeWidth="5"/></>,
    vector: <><path d="M25 12H14v76h11m50-76h11v76H75"/>{[0,1,2,3].map(i => <rect key={i} x="32" y={19+i*16} width={27-i%2*8} height="7" rx="3" fill={color} stroke="none"/>)}<circle cx="47" cy="84" r="2" fill={color}/></>,
    muscle: <><path d="M19 63Q21 39 39 46L49 35 45 19l12-8 15 13-1 20Q91 59 75 78Q59 89 39 82L17 84Z" fill={color} fillOpacity=".2"/><path d="M39 46q18-4 27 13M23 64q15-13 31 2M47 19l12 13 12-8"/></>,
    mat: <><path d="M18 35h65L72 77H6Z" fill={color} fillOpacity=".2"/><path d="M18 35q4-15 14-8t-1 16H17M18 68h43m-40-9h43m-40-9h43"/></>,
    note: <><rect x="19" y="13" width="62" height="75" rx="8" fill={color} fillOpacity=".16"/><path d="M31 32h38m-38 14h30m-30 14h38m-38 14h23" strokeWidth="4"/></>,
    question: <><path d="M14 13h72v56H53L34 87V69H14Z" fill={color} fillOpacity=".16"/><path d="M39 34c0-17 26-17 26 0 0 11-15 8-15 18m0 8v1"/></>,
    building: <><path d="M14 87V29h31V13h40v74Z" fill={color} fillOpacity=".16"/><path d="M14 87h77M52 87V69h16v18M25 43h9m-9 14h9m-9 14h9M57 29h16M57 43h16M57 57h16" strokeWidth="4"/></>,
    plant: <><path d="M50 69V32M50 48Q13 48 18 20q31 0 32 28M50 60q36 0 34-30-31 0-34 30" fill={color} fillOpacity=".24"/><path d="M30 71h40l-8 18H38Z" fill={color} fillOpacity=".4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}
