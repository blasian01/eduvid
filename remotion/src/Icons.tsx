import React from 'react';
import type {IconName} from './types';

export const Icon: React.FC<{name?: IconName; color: string; size?: number; style?: React.CSSProperties}> = ({name = 'spark', color, size = 80, style}) => {
  const paths: Record<Exclude<IconName, 'truck' | 'person'>, React.ReactNode> = {
    shield: <><path d="M50 12 82 25v24c0 20-15 32-32 40-17-8-32-20-32-40V25Z"/><path d="m34 49 11 12 23-25"/></>,
    brake: <><circle cx="50" cy="50" r="27"/><path d="M17 28a39 39 0 0 0 0 44M83 28a39 39 0 0 1 0 44M50 32v22m0 12v1"/></>,
    warning: <><path d="M50 13 89 82H11Z"/><path d="M50 37v24m0 11v1"/></>,
    lock: <><rect x="24" y="43" width="52" height="42" rx="7"/><path d="M33 43V29a17 17 0 0 1 34 0v14M50 60v11"/></>,
    camera: <><path d="M12 32h20l7-12h22l7 12h20v49H12Z"/><circle cx="50" cy="56" r="16"/></>,
    fire: <><path d="M51 10c10 27-3 29 10 39 6-8 8-14 8-14 19 25 20 50-17 54-35-1-39-26-22-47 0 16 12 17 12 5 0-12 13-18 9-37Z"/><path d="M50 58c-18 18-7 28 4 25 13-4 11-16-4-25Z"/></>,
    check: <><circle cx="50" cy="50" r="35"/><path d="m29 50 15 15 28-31"/></>,
    book: <><path d="M50 24C36 15 22 14 12 18v62c14-4 25-2 38 5 13-7 24-9 38-5V18c-10-4-24-3-38 6v61Z"/><path d="M24 33h13m-13 13h13m26-13h13m-13 13h13"/></>,
    brain: <><path d="M50 25c-4-19-25-14-27 1-18 2-20 22-9 30-9 19 9 34 23 26 2 7 13 8 13-2Zm0 0c4-19 25-14 27 1 18 2 20 22 9 30 9 19-9 34-23 26-2 7-13 8-13-2Z"/><path d="M24 31c12 0 16 9 12 16M14 56c12-5 23 1 23 12M76 31c-12 0-16 9-12 16m22 9c-12-5-23 1-23 12"/></>,
    spark: <><path d="m50 11 9 28 30 11-30 10-9 29-10-29-29-10 29-11Z"/><path d="m80 11 2 7 7 2-7 2-2 7-2-7-7-2 7-2Z"/></>,
    leaf: <><path d="M84 15C45 14 13 36 20 67c8 31 58 19 64-52Z"/><path d="M15 88 66 37M37 65V43m0 22h24"/></>,
    water: <><path d="M50 10C37 31 19 48 19 65a31 31 0 0 0 62 0c0-17-18-34-31-55Z"/><path d="M32 63c0 13 8 18 17 18"/></>,
    clock: <><circle cx="50" cy="50" r="36"/><path d="M50 27v25l18 11M50 15v4M15 50h4m62 0h4M50 81v4"/></>,
    arrow: <><path d="M14 50h70M61 27l23 23-23 23"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" style={{display: 'block', flexShrink: 0, ...style}} aria-hidden="true">
    {name === 'truck' ? <><path d="M7 67V42h18l10 13v12m-28 0h32m1-8h11m0-26h41v31H51l-9-6Z" fill={color} fillOpacity="0.13"/><path d="M13 47h10l7 10H13Zm37-9h37M35 63l13 4"/><circle cx="22" cy="72" r="9"/><circle cx="74" cy="72" r="9"/><path d="M22 70v4m52-4v4"/></> : name === 'person' ? <><circle cx="50" cy="24" r="12"/><path d="M50 40v27m-24-7 13-16h22l13 16M50 67 32 89m18-22 18 22"/></> : paths[name]}
  </svg>;
};
