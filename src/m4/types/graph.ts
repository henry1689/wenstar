// M4 家族知识库图结构类型定义
// Ref: M4-design-v1.md §3

import type { EntityGene } from '../../m1/types/dna.js';

export type NodeType = 'person' | 'place' | 'thing' | 'concept' | 'object' | 'feature';

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  aliases?: string[];
  properties?: Record<string, unknown>;
}

export interface GraphEdge {
  id?: string;
  source_id: string;
  target_id: string;
  relation: string;
  properties?: Record<string, unknown>;
}

export interface GraphQueryResult {
  node: GraphNode;
  relationships: Array<{
    relation: string;
    direction: 'outgoing' | 'incoming';
    targetNode: GraphNode;
  }>;
}

export interface GraphPath {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface InferenceResult {
  nodes_created: number;
  edges_created: number;
  details: string[];
}

export interface FamilySummary {
  members: Array<{ name: string; relation_to_user: string; aliases: string[] }>;
  locations: string[];
}

export interface RelationCandidate {
  sourceName: string;
  targetName: string;
  relation: string;
  confidence: number;
}

export type FamilyManualAPI = {
  handleUserDefinedRelation(utterance: string): Promise<void>;
  handleCorrection(utterance: string): Promise<void>;
};

export interface FamilyGraph {
  findRelated(entityName: string, relation?: string): Promise<GraphQueryResult[]>;
  findPath(sourceName: string, targetName: string): Promise<GraphPath | null>;
  addNode(node: GraphNode): Promise<void>;
  addEdge(edge: GraphEdge): Promise<void>;
  integrateFromEntity(entities: EntityGene[], rawInput: string, selfName?: string): Promise<InferenceResult>;
  correctRelation(source: string, target: string, correctRelation: string): Promise<void>;
  addFamilyMember(name: string, relation: string, aliases?: string[]): Promise<void>;
  getFamilySummary(): Promise<FamilySummary>;
}
