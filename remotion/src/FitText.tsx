import React, {useLayoutEffect, useRef} from 'react';

export function fitTextNode(node: HTMLElement) {
  if (node.clientWidth < 1 || node.clientHeight < 1) return;
  let size = Number(node.dataset.maxFont);
  const minimum = Number(node.dataset.minFont);
  if (!Number.isFinite(size) || !Number.isFinite(minimum)) return;
  node.style.fontSize = `${size}px`;
  while (size > minimum && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)) {
    size = Math.max(minimum, size - 1);
    node.style.fontSize = `${size}px`;
  }
  node.dataset.fontSize = String(size);
}

export const FitText: React.FC<{text?: string; height: number | string; maxFont: number; minFont?: number; color: string; weight?: number; align?: React.CSSProperties['textAlign']; style?: React.CSSProperties; name?: string}> = ({text = '', height, maxFont, minFont = maxFont * 0.65, color, weight = 500, align = 'left', style, name = 'text'}) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const fit = () => fitTextNode(node);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text, height, maxFont, minFont]);
  return <div ref={ref} dir="auto" data-qa-text={name} data-max-font={maxFont} data-min-font={minFont} style={{height, width: '100%', fontSize: maxFont, lineHeight: 1.15, color, fontWeight: weight, textAlign: align, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', flexShrink: 0, ...style}}>{text}</div>;
};
