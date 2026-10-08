export const templates = ['hero', 'cards', 'steps', 'comparison', 'timeline', 'diagram', 'story', 'takeaway'];
export const icons = ['truck', 'shield', 'brake', 'person', 'warning', 'lock', 'camera', 'fire', 'check', 'book', 'brain', 'spark', 'leaf', 'water', 'clock', 'arrow'];
const styles = ['classic', 'neon', 'chalkboard', 'paper', 'illustrated'];
export const illustrationSubjects = ['space', 'planet', 'atom', 'cell', 'nature', 'network', 'attention', 'machine', 'city', 'people', 'journey', 'abstract', 'notes'];
export const illustrationMotions = ['orbit', 'pulse', 'flow', 'grow', 'assemble', 'compare', 'transform'];
export const contentKinds = ['exercise', 'tokens', 'embedding', 'attention-mix', 'generation', 'process', 'bridge', 'causal-attention', 'notes'];
export const exerciseNames = ['crunch', 'leg-raise', 'plank', 'side-plank', 'flutter-kick', 'bicycle', 'russian-twist', 'mountain-climber', 'heel-touch', 'sit-up', 'standing', 'core', 'hip-dip', 'star-crunch', 'crunch-reach', 'plank-up-down', 'reverse-crunch', 'hollow-hold', 'lying'];
export const contentLayouts = ['single', 'sequence', 'comparison', 'collection'];
export const contentIcons = [...icons, 'plate', 'calendar', 'bridge', 'computer', 'token', 'vector', 'muscle', 'mat', 'note', 'question', 'building', 'plant'];

export function validatePlan(plan) {
  const issues = [];
  const fail = message => issues.push(message);
  const object = (value, allowed, name) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { fail(`${name} must be an object`); return false; }
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${name}: unsupported field ${key}`);
    return true;
  };
  const text = (value, max, name, required = false) => {
    if (value === undefined && !required) return;
    if (typeof value !== 'string' || (required && !value.trim())) { fail(`${name} must be ${required ? 'nonempty ' : ''}text`); return; }
    if ([...value].length > max) fail(`${name} exceeds ${max} characters`);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(`${name} contains control characters`);
  };
  const integer = (value, low, high, name) => { if (!Number.isSafeInteger(value) || value < low || value > high) fail(`${name} must be an integer from ${low} to ${high}`); };
  const plainText = (value, max, name) => {
    text(value, max, name, true);
    if (typeof value === 'string' && /<[^>]*>|(?:https?:\/\/|data:|javascript:|file:)/i.test(value)) fail(`${name} must be plain text`);
  };
  if (!object(plan, ['version', 'title', 'width', 'height', 'fps', 'durationInFrames', 'style', 'scenes', 'captions'], 'plan')) return issues;
  if (plan.version !== 1) fail('Unsupported plan version');
  text(plan.title, 200, 'title', true);
  integer(plan.width, 360, 3840, 'width'); integer(plan.height, 360, 3840, 'height');
  if (plan.width % 2 || plan.height % 2) fail('Video dimensions must be even');
  if (Math.min(Math.abs(plan.width / plan.height - 16 / 9), Math.abs(plan.width / plan.height - 9 / 16)) > 0.02) fail('Video aspect must be 16:9 or 9:16');
  integer(plan.fps, 15, 60, 'fps'); integer(plan.durationInFrames, 1, 36000, 'durationInFrames');
  if (!styles.includes(plan.style)) fail('Unknown visual style');
  if (!Array.isArray(plan.scenes) || plan.scenes.length < 1 || plan.scenes.length > 60) fail('scenes must contain 1–60 scenes');
  else {
    let nextFrame = 0;
    for (const [index, scene] of plan.scenes.entries()) {
      const name = `scene ${index + 1}`;
      if (!object(scene, ['template', 'headline', 'kicker', 'body', 'items', 'footer', 'illustration', 'startFrame', 'durationInFrames'], name)) continue;
      if (!templates.includes(scene.template)) fail(`${name}: unknown template`);
      text(scene.headline, 80, `${name} headline`, true); text(scene.kicker, 50, `${name} kicker`);
      text(scene.body, 180, `${name} body`); text(scene.footer, 100, `${name} footer`);
      if (scene.illustration !== undefined && object(scene.illustration, ['subject', 'motion', 'mode', 'labels', 'shots'], `${name} illustration`)) {
        const art = scene.illustration;
        if (!illustrationSubjects.includes(art.subject)) fail(`${name}: unknown illustration subject`);
        if (!illustrationMotions.includes(art.motion)) fail(`${name}: unknown illustration motion`);
        if (!['schematic', 'metaphor'].includes(art.mode)) fail(`${name}: illustration mode must be schematic or metaphor`);
        if (art.labels !== undefined) {
          if (!Array.isArray(art.labels) || art.labels.length > 4) fail(`${name}: illustration labels must be at most 4 concepts`);
          else art.labels.forEach((label, i) => {
            text(label, 40, `${name} illustration label ${i + 1}`, true);
            if (typeof label === 'string' && /<[^>]*>|(?:https?:\/\/|data:|javascript:|file:)/i.test(label)) fail(`${name}: illustration label must be plain text`);
          });
        }
        if (art.shots !== undefined) {
          if (!Array.isArray(art.shots) || art.shots.length < 1 || art.shots.length > 12) fail(`${name}: content shots must contain 1–12 shots`);
          else {
            let shotStart = 0;
            const cues = new Set();
            for (const [i, shot] of art.shots.entries()) {
              const shotName = `${name} shot ${i + 1}`;
              if (!object(shot, ['cue', 'kind', 'exercise', 'text', 'labels', 'layout', 'objects', 'startFrame', 'durationInFrames'], shotName)) continue;
              plainText(shot.cue, 400, `${shotName} cue`);
              if (!contentKinds.includes(shot.kind)) fail(`${shotName}: unknown content kind`);
              const cueKey = typeof shot.cue === 'string' ? shot.cue.trim().replace(/\s+/g, ' ').toLowerCase() : '';
              if (cues.has(cueKey)) fail(`${shotName}: duplicate narration cue`);
              cues.add(cueKey);
              integer(shot.startFrame, 0, scene.durationInFrames - 1, `${shotName} startFrame`);
              integer(shot.durationInFrames, 1, scene.durationInFrames, `${shotName} durationInFrames`);
              if (shot.startFrame !== shotStart) fail(`${shotName}: content shots must be contiguous`);
              shotStart = shot.startFrame + shot.durationInFrames;
              if (shot.kind === 'exercise') {
                if (!exerciseNames.includes(shot.exercise)) fail(`${shotName}: unknown or missing exercise`);
              } else if (shot.exercise !== undefined) fail(`${shotName}: exercise is only supported by exercise pictures`);
              if (shot.text !== undefined) {
                if (shot.kind !== 'tokens') fail(`${shotName}: example text is only supported by token pictures`);
                plainText(shot.text, 80, `${shotName} text`);
              }
              if (shot.labels !== undefined) {
                if (!Array.isArray(shot.labels) || shot.labels.length > 4) fail(`${shotName}: labels must contain at most 4 concepts`);
                else shot.labels.forEach((label, j) => plainText(label, 40, `${shotName} label ${j + 1}`));
              }
              if (shot.kind === 'process') {
                if (!contentLayouts.includes(shot.layout)) fail(`${shotName}: unknown or missing composition layout`);
                if (!Array.isArray(shot.objects) || shot.objects.length < 1 || shot.objects.length > 4) fail(`${shotName}: composition needs 1–4 objects`);
                else {
                  if (shot.layout === 'single' && shot.objects.length !== 1) fail(`${shotName}: single layout needs one object`);
                  if (shot.layout === 'comparison' && shot.objects.length !== 2) fail(`${shotName}: comparison layout needs two objects`);
                  for (const [j, item] of shot.objects.entries()) {
                    if (!object(item, ['icon', 'label'], `${shotName} object ${j + 1}`)) continue;
                    if (!contentIcons.includes(item.icon)) fail(`${shotName}: unknown content icon`);
                    plainText(item.label, 40, `${shotName} object ${j + 1} label`);
                  }
                }
              } else if (shot.objects !== undefined || shot.layout !== undefined) fail(`${shotName}: objects and layout are only supported by process pictures`);
            }
            if (shotStart !== scene.durationInFrames) fail(`${name}: content shots must cover the complete scene`);
          }
        }
      }
      integer(scene.startFrame, 0, 36000, `${name} startFrame`); integer(scene.durationInFrames, 1, 36000, `${name} durationInFrames`);
      if (scene.startFrame !== nextFrame) fail(`${name} must start at frame ${nextFrame}; scenes must be contiguous`);
      nextFrame = scene.startFrame + scene.durationInFrames;
      if (!Array.isArray(scene.items) || scene.items.length > 4) fail(`${name} items must be an array of at most 4 items`);
      else for (const [i, item] of scene.items.entries()) {
        if (!object(item, ['label', 'detail', 'icon'], `${name} item ${i + 1}`)) continue;
        text(item.label, 60, `${name} item ${i + 1} label`, true); text(item.detail, 120, `${name} item ${i + 1} detail`);
        if (item.icon !== undefined && !icons.includes(item.icon)) fail(`${name} item ${i + 1}: unknown icon`);
      }
    }
    if (nextFrame !== plan.durationInFrames) fail('Scene durations must cover the entire video exactly');
  }
  if (!Array.isArray(plan.captions) || plan.captions.length > 2000) fail('captions must be an array of at most 2000 cues');
  else {
    let end = 0;
    for (const [i, cue] of plan.captions.entries()) {
      if (!object(cue, ['startFrame', 'endFrame', 'text'], `caption ${i + 1}`)) continue;
      integer(cue.startFrame, 0, plan.durationInFrames, `caption ${i + 1} startFrame`);
      integer(cue.endFrame, 1, plan.durationInFrames, `caption ${i + 1} endFrame`);
      text(cue.text, 200, `caption ${i + 1} text`, true);
      if (cue.endFrame <= cue.startFrame || cue.startFrame < end) fail(`caption ${i + 1} must have positive duration and not overlap`);
      end = cue.endFrame;
    }
  }
  return issues.slice(0, 50);
}
