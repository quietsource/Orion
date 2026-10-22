export type SwarmStatus = 'draft'|'running'|'paused'|'completed'|'stopped'|'warning';
export interface SwarmSteer { id:string; text:string; completionRules:string; importance:1|2|3|4|5; createdAt:number; status:'active'|'completed'; }
export interface SwarmLogEntry { id:string; at:number; role:'system'|'planner'|'researcher'|'builder'|'reviewer'; summary:string; detail?:string; warning?:boolean; action?:string; }
export interface SwarmRecord { id:string; name:string; objective:string; completionRules:string; status:SwarmStatus; createdAt:number; updatedAt:number; iteration:number; lastRunAt:number|null; drivePath:string|null; driveLetter:string|null; steers:SwarmSteer[]; logs:SwarmLogEntry[]; warning:string|null; }
export interface SwarmCreateInput { name:string; objective:string; completionRules:string; }
export interface SwarmSteerInput { text:string; completionRules:string; importance:1|2|3|4|5; }
