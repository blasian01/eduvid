import {templates} from '../validate-plan.mjs';

export function makePlan({portrait = false, style = 'paper', duration = 90, long = false} = {}) {
  return {version: 1, title: 'Ideas that change how we see the world', width: portrait ? 720 : 1280, height: portrait ? 1280 : 720, fps: 30, durationInFrames: templates.length * duration, style,
    scenes: templates.map((template, i) => ({template, headline: long ? 'A longer headline about learning, movement and practical safety' : ['Ideas become motion', 'Three kinds of protection', 'A process, step by step', 'Two approaches to learning', 'Small changes over time', 'From question to answer', 'The turning point', 'Carry these ideas forward'][i], kicker: 'Source-grounded learning', body: long ? 'A clear explanation connects each idea to the next, while keeping context and the original source in view.' : 'Build understanding by connecting the ideas, one clear step at a time.', items: [
      {label: long ? 'A longer label that still deserves to be read in full' : 'Understand the setting', detail: 'Know what the source says and what remains uncertain.', icon: 'book'},
      {label: long ? 'Every meaningful word remains visible in the layout' : 'See the mechanism', detail: 'Follow the relationships and preserve the causal direction.', icon: 'brain'},
      {label: long ? '机器、人员与环境：说明性示意图，而不是操作说明' : 'Keep the context', detail: 'An illustrative schematic is a guide to the idea, not an operating procedure.', icon: 'shield'},
      {label: long ? 'شرح واضح يحتفظ بالنص الكامل دون إخفاء الكلمات' : 'Carry it forward', detail: 'Use the main takeaway to connect the explanation to a new question.', icon: 'spark'},
    ], footer: 'Illustrative schematic · retain the source qualifications', startFrame: i * duration, durationInFrames: duration})),
    captions: templates.map((_, i) => ({startFrame: i * duration, endFrame: (i + 1) * duration, text: 'A clear explanation keeps the meaning in view.'}))};
}
