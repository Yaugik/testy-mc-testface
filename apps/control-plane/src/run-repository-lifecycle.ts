import type { Pool } from "pg";
import type { RunId, RunStatus } from "@testy/shared-types";
import type { PersistedRun, ResolvedScenario, ScenarioStepRecord, ScenarioTimelineRecord, ScenarioValue } from "@testy/scenario-engine";

interface RunRow { readonly id:string; readonly scenario_id:string; readonly target:string; readonly status:RunStatus; readonly outcome_status:"PASSED"|"FAILED"|"CANCELLED"|null; readonly resolved_scenario_hash:string; readonly resolved_scenario:ResolvedScenario; readonly metadata:Readonly<Record<string,ScenarioValue>>; readonly cancel_requested_at:Date|null; readonly created_at:Date; readonly updated_at:Date; readonly started_at:Date|null; readonly finished_at:Date|null; }
interface StepRow { readonly run_id:string; readonly step_id:string; readonly kind:ScenarioStepRecord["kind"]; readonly phase:RunStatus; readonly status:ScenarioStepRecord["status"]; readonly attempt:number; readonly started_at:Date; readonly completed_at:Date|null; readonly duration_ms:number|null; readonly output_fingerprint:string|null; readonly error:NonNullable<ScenarioStepRecord["error"]>|null; }
interface TimelineRow { readonly run_id:string; readonly occurred_at:Date; readonly category:ScenarioTimelineRecord["category"]; readonly name:string; readonly metadata:Readonly<Record<string,ScenarioValue>>; }

export class PostgresRunLifecycleStore {
  public constructor(private readonly pool: Pool) {}
  public async createRun(run: PersistedRun): Promise<void> {
    await this.pool.query(
      `INSERT INTO test_runs (
        id, scenario_id, target, status, outcome_status,
        resolved_scenario_hash, resolved_scenario, metadata,
        cancel_requested_at, created_at, updated_at, started_at, finished_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7::JSONB, $8::JSONB,
        $9, $10, $11, $12, $13
      )`,
      [run.id,run.scenarioId,run.target,run.status,run.outcomeStatus ?? null,run.resolvedScenarioHash,JSON.stringify(run.resolvedScenario),JSON.stringify(run.metadata),run.cancelRequestedAt ?? null,run.createdAt,run.updatedAt,run.startedAt ?? null,run.finishedAt ?? null],
    );
  }
  public async updateRunStatus(runId:RunId,status:RunStatus,options:{readonly outcomeStatus?:"PASSED"|"FAILED"|"CANCELLED";readonly startedAt?:string;readonly finishedAt?:string;readonly metadata?:Readonly<Record<string,ScenarioValue>>;}={}):Promise<void>{await this.pool.query(`UPDATE test_runs SET status=$2,outcome_status=COALESCE($3,outcome_status),started_at=COALESCE($4,started_at),finished_at=COALESCE($5,finished_at),metadata=metadata||COALESCE($6::JSONB,'{}'::JSONB),updated_at=NOW() WHERE id=$1`,[runId,status,options.outcomeStatus??null,options.startedAt??null,options.finishedAt??null,options.metadata?JSON.stringify(options.metadata):null]);}
  public async requestCancellation(runId:RunId,requestedAt:string):Promise<boolean>{const result=await this.pool.query(`UPDATE test_runs SET cancel_requested_at=COALESCE(cancel_requested_at,$2),updated_at=NOW() WHERE id=$1 AND status NOT IN ('PASSED','FAILED','CANCELLED','CLEANUP')`,[runId,requestedAt]);return(result.rowCount??0)>0;}
  public async getRun(runId:RunId):Promise<PersistedRun|undefined>{const result=await this.pool.query<RunRow>(`SELECT id,scenario_id,target,status,outcome_status,resolved_scenario_hash,resolved_scenario,metadata,cancel_requested_at,created_at,updated_at,started_at,finished_at FROM test_runs WHERE id=$1`,[runId]);return result.rows[0]?mapRun(result.rows[0]):undefined;}
  public async listActiveRuns():Promise<readonly PersistedRun[]>{const result=await this.pool.query<RunRow>(`SELECT id,scenario_id,target,status,outcome_status,resolved_scenario_hash,resolved_scenario,metadata,cancel_requested_at,created_at,updated_at,started_at,finished_at FROM test_runs WHERE status NOT IN ('PASSED','FAILED','CANCELLED') ORDER BY created_at ASC`);return result.rows.map(mapRun);}
  public async recordStep(record:ScenarioStepRecord):Promise<void>{await this.pool.query(`INSERT INTO run_steps(run_id,step_id,kind,phase,status,attempt,started_at,completed_at,duration_ms,output_fingerprint,error) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::JSONB) ON CONFLICT(run_id,step_id,attempt) DO UPDATE SET status=EXCLUDED.status,completed_at=EXCLUDED.completed_at,duration_ms=EXCLUDED.duration_ms,output_fingerprint=EXCLUDED.output_fingerprint,error=EXCLUDED.error`,[record.runId,record.stepId,record.kind,record.phase,record.status,record.attempt,record.startedAt,record.completedAt??null,record.durationMs??null,record.outputFingerprint??null,record.error===undefined?null:JSON.stringify(record.error)]);}
  public async appendTimeline(record:ScenarioTimelineRecord):Promise<void>{await this.pool.query(`INSERT INTO timeline_events(run_id,occurred_at,category,name,metadata) VALUES($1,$2,$3,$4,$5::JSONB)`,[record.runId,record.occurredAt,record.category,record.name,JSON.stringify(record.metadata)]);}
  public async listTimeline(runId:RunId):Promise<readonly ScenarioTimelineRecord[]>{const result=await this.pool.query<TimelineRow>(`SELECT run_id,occurred_at,category,name,metadata FROM timeline_events WHERE run_id=$1 ORDER BY occurred_at ASC,id ASC`,[runId]);return result.rows.map(row=>({runId:row.run_id as RunId,occurredAt:row.occurred_at.toISOString(),category:row.category,name:row.name,metadata:row.metadata}));}
  public async listSteps(runId:RunId):Promise<readonly ScenarioStepRecord[]>{const result=await this.pool.query<StepRow>(`SELECT run_id,step_id,kind,phase,status,attempt,started_at,completed_at,duration_ms,output_fingerprint,error FROM run_steps WHERE run_id=$1 ORDER BY started_at ASC,step_id ASC,attempt ASC`,[runId]);return result.rows.map(mapStep);}
}
function mapRun(row:RunRow):PersistedRun{return{id:row.id as RunId,scenarioId:row.scenario_id,target:row.target,status:row.status,...(row.outcome_status?{outcomeStatus:row.outcome_status}:{}),resolvedScenarioHash:row.resolved_scenario_hash.trim(),resolvedScenario:row.resolved_scenario,metadata:row.metadata,...(row.cancel_requested_at?{cancelRequestedAt:row.cancel_requested_at.toISOString()}:{}),createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),...(row.started_at?{startedAt:row.started_at.toISOString()}:{}),...(row.finished_at?{finishedAt:row.finished_at.toISOString()}: {})};}
function mapStep(row:StepRow):ScenarioStepRecord{return{runId:row.run_id as RunId,stepId:row.step_id,kind:row.kind,phase:row.phase,status:row.status,attempt:row.attempt,startedAt:row.started_at.toISOString(),...(row.completed_at?{completedAt:row.completed_at.toISOString()}:{}),...(row.duration_ms===null?{}:{durationMs:row.duration_ms}),...(row.output_fingerprint===null?{}:{outputFingerprint:row.output_fingerprint.trim()}),...(row.error===null?{}:{error:row.error})};}
