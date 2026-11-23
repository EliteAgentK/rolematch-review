// A job description read exactly as live reads it (src/jobReader.ts, then src/aiJobFields.ts for the record), its calls metered as the platform's own
// evaluation. One helper for every measurement, so none of them keeps its own copy of how a job is read (register R188: copies drift).
import { jobRecordOf } from "../../src/aiJobFields";
import { jobReaderAsk, readJobDocument } from "../../src/jobReader";

export const evalAsk = jobReaderAsk("evaluation");
export async function readJobAsLive(advert: string) {
  const r = await readJobDocument(advert, evalAsk);
  if (!r.ok) throw new Error(`the job could not be read: ${r.why}`);
  return { ...jobRecordOf(r.reading), id: "job" } as any;
}
