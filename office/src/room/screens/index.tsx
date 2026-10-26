// Adapted from AttentionOS (MIT licence, Copyright (c) 2026 The AttentionOS Authors), commit 89f6781,
// apps/studio/src/components/worker-room/screens/index.tsx. See licences/ATTENTIONOS-LICENSE.
// Which screen each of our 21 agents shows.

import type { ComponentType } from "react";
import type { RobotId } from "../cast";
import type { SceneProps } from "./bits";
import { Cutter } from "./editing";
import { CommentReplies } from "./inbox";
import { FilmList, IdeaPicker, LaneBalance } from "./planning";
import { CrossPoster, Scheduler } from "./publishing";
import { CompetitorWatch, TranscriptReader, TrendScout } from "./research";
import { HookWriter, ScriptWriter } from "./scripting";
import { Animate, CharacterSheet, ContinuityCheck, ImageDraw, PostMortem, QcCheck, Results, SoundMix, Storyboard } from "./studio";

export const SCENES: Record<RobotId, ComponentType<SceneProps>> = {
  outlier_analyst: CompetitorWatch,
  trend_scout: TrendScout,
  teardown_analyst: TranscriptReader,
  strategist: IdeaPicker,
  calendar_planner: Scheduler,
  topic_editor: LaneBalance,
  copywriter: ScriptWriter,
  hook_auditor: HookWriter,
  fact_checker: FilmList,
  character_keeper: CharacterSheet,
  voice_writer: CommentReplies,
  continuity_checker: ContinuityCheck,
  storyboard_artist: Storyboard,
  image_artist: ImageDraw,
  animator: Animate,
  voice_director: SoundMix,
  editor: Cutter,
  qc_inspector: QcCheck,
  publisher: CrossPoster,
  results_analyst: Results,
  postmortem_writer: PostMortem,
};

