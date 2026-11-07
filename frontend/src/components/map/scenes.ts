// Every scene on the Map, by id.
import { OFFICE } from './office';
import { TOWN, type SceneDef, type SceneId } from './world';

export const SCENES: Record<SceneId, SceneDef> = { town: TOWN, office: OFFICE };

export const sceneOf = (id: string | undefined): SceneDef => SCENES[id as SceneId] ?? TOWN;
