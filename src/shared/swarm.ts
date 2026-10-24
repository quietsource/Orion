export type SwarmStatus = 'draft'|'running'|'paused'|'completed'|'stopped'|'warning';
export type SwarmInferenceEngine = 'orion'|'llama.cpp'|'ollama';
export interface SwarmSteer { id:string; text:string; completionRules:string; importance:1|2|3|4|5; createdAt:number; status:'active'|'completed'; }
export interface SwarmModelSelection { engine:SwarmInferenceEngine; model:string; }
export interface SwarmLogEntry { id:string; at:number; role:'system'|'planner'|'researcher'|'builder'|'reviewer'; summary:string; detail?:string; warning?:boolean; action?:string; }
export interface SwarmFileActivity { reads:number; writes:number; moves:number; lastAccessAt:number; indexedHash?:string; }
export interface SwarmVirtualView { id:string; name:string; purpose:string; paths:string[]; createdAt:number; updatedAt:number; }
export interface AgentNetworkRequest { id:string; url:string; reason:string; requestedAt:number; }
export interface SwarmRecord { id:string; name:string; objective:string; completionRules:string; models?:SwarmModelSelection[]; engine?:SwarmInferenceEngine; model?:string; status:SwarmStatus; createdAt:number; updatedAt:number; iteration:number; lastRunAt:number|null; lastProgressAt:number; drivePath:string|null; driveLetter:string|null; steers:SwarmSteer[]; logs:SwarmLogEntry[]; warning:string|null; fileActivity:Record<string,SwarmFileActivity>; virtualViews:SwarmVirtualView[]; pendingNetworkRequest?:AgentNetworkRequest|null; }
export interface SwarmCreateInput { name:string; objective:string; completionRules:string; models:SwarmModelSelection[]; engine?:SwarmInferenceEngine; model?:string; }
export interface SwarmSteerInput { text:string; completionRules:string; importance:1|2|3|4|5; }
