// Adapted from AttentionOS (MIT licence, Copyright (c) 2026 The AttentionOS Authors), commit 89f6781,
// apps/studio/src/components/worker-room/cast.ts. See licences/ATTENTIONOS-LICENSE. Changes for Faceless Studio:
// our roster (CONTRAT.md): the Chief of Staff on the dais and 7 teams of 3 real agents, one desk per agent.

export type TeamId = "research" | "strategy" | "writing" | "character" | "visual" | "sound_edit" | "distribution";

export type RobotId =
  | "outlier_analyst" | "trend_scout" | "teardown_analyst"
  | "strategist" | "calendar_planner" | "topic_editor"
  | "copywriter" | "hook_auditor" | "fact_checker"
  | "character_keeper" | "voice_writer" | "continuity_checker"
  | "storyboard_artist" | "image_artist" | "animator"
  | "voice_director" | "editor" | "qc_inspector"
  | "publisher" | "results_analyst" | "postmortem_writer";

export interface Team {
  id: TeamId;
  /** Team name, as in CONTRAT.md. */
  name: string;
  /** Painted on the floor pad, in caps. */
  floor: string;
  /** One short line for the camera bar while this team is resting. */
  line: string;
  /** Accent color for the pad, screens and packets. */
  tint: string;
  /** What a packet handed to this team is called. */
  ticket: string;
  robots: readonly [RobotId, RobotId, RobotId];
}

export const CHIEF_ID = "chief_of_staff";
export const CHIEF_NAME = "Lester"; // the chief of staff's name
export const CORE_NAME = "Cerveau";

/** Clockwise from the Chief, the order work moves around the room. */
export const TEAMS: readonly Team[] = [
  { id: "research", name: "Recherche", floor: "RECHERCHE", line: "La recherche trouve ce qui marche.", tint: "#8b5cf6", ticket: "Tendance", robots: ["outlier_analyst", "trend_scout", "teardown_analyst"] },
  { id: "strategy", name: "Stratégie", floor: "STRATÉGIE", line: "La stratégie choisit la prochaine vidéo.", tint: "#b77dff", ticket: "Sujet", robots: ["strategist", "calendar_planner", "topic_editor"] },
  { id: "writing", name: "Écriture", floor: "ÉCRITURE", line: "L'écriture transforme l'idée en histoire.", tint: "#d0a6ff", ticket: "Histoire", robots: ["copywriter", "hook_auditor", "fact_checker"] },
  // 2026-10-24: the hero is a parameter of the concept (concept/<id>/), so no hero's name is written here.
  { id: "character", name: "Personnage", floor: "PERSONNAGE", line: "Le personnage garde le héros et le casting fidèles à eux-mêmes.", tint: "#ff7ad9", ticket: "Casting", robots: ["character_keeper", "voice_writer", "continuity_checker"] },
  { id: "visual", name: "Image", floor: "IMAGE", line: "L'image dessine et anime chaque scène.", tint: "#8139fa", ticket: "Images", robots: ["storyboard_artist", "image_artist", "animator"] },
  { id: "sound_edit", name: "Son et montage", floor: "SON & MONTAGE", line: "Son et montage : la voix, le montage, le contrôle.", tint: "#6d7cff", ticket: "Montage", robots: ["voice_director", "editor", "qc_inspector"] },
  { id: "distribution", name: "Diffusion", floor: "DIFFUSION", line: "La diffusion publie et apprend des chiffres.", tint: "#a78bfa", ticket: "Publication", robots: ["publisher", "results_analyst", "postmortem_writer"] },
];

export const ROBOT_NAME: Record<RobotId, string> = {
  outlier_analyst: "Vidéos fortes",
  trend_scout: "Tendances",
  teardown_analyst: "Démontage",
  strategist: "Stratège",
  calendar_planner: "Calendrier",
  topic_editor: "Sujets",
  copywriter: "Rédacteur",
  hook_auditor: "Accroche",
  fact_checker: "Vérification",
  character_keeper: "Gardien du casting",
  voice_writer: "Sous-titres",
  continuity_checker: "Continuité",
  storyboard_artist: "Storyboard",
  image_artist: "Dessinateur",
  animator: "Animateur",
  voice_director: "Voix",
  editor: "Monteur",
  qc_inspector: "Contrôle",
  publisher: "Publication",
  results_analyst: "Résultats",
  postmortem_writer: "Bilan",
};

export const ALL_ROBOTS: readonly RobotId[] = TEAMS.flatMap((t) => t.robots);

/** Agent id → its team. */
export const TEAM_OF: Record<string, Team> = Object.fromEntries(TEAMS.flatMap((t) => t.robots.map((r) => [r, t])));

export function isRobot(id: string | null | undefined): id is RobotId {
  return !!id && id in ROBOT_NAME;
}

export function agentName(id: string | null | undefined): string {
  if (!id) return "Quelqu'un";
  if (id === CHIEF_ID) return CHIEF_NAME;
  if (isRobot(id)) return ROBOT_NAME[id];
  if (id.startsWith("user")) return "Toi";
  return id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
