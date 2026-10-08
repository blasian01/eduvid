import React from 'react';
import {Composition} from 'remotion';
import {EduVidExplainer} from './Explainer';
import type {ExplainerProps} from './types';
type CompositionInput = ExplainerProps & Record<string, unknown>;
const RenderVideo: React.FC<CompositionInput> = EduVidExplainer;
const defaultProps: CompositionInput = {plan: {version: 1, title: 'EduVid', width: 1280, height: 720, fps: 30, durationInFrames: 90, style: 'paper', scenes: [{template: 'hero', headline: 'Ideas in motion', items: [], startFrame: 0, durationInFrames: 90}], captions: []}};
export const Root = () => <Composition id="EduVidExplainer" component={RenderVideo} width={1280} height={720} fps={30} durationInFrames={90} defaultProps={defaultProps} calculateMetadata={({props}) => ({width: props.plan.width, height: props.plan.height, fps: props.plan.fps, durationInFrames: props.plan.durationInFrames})}/>;
