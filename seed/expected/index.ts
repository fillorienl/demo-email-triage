/** Expected results per seed email: the AI reading, the lane, and a draft template. Used by tests and fixture mode. */
import type { Lane, ReadResult } from "../../core/types";
import e01 from "./01.json";
import e02 from "./02.json";
import e03 from "./03.json";
import e04 from "./04.json";
import e05 from "./05.json";
import e06 from "./06.json";
import e07 from "./07.json";
import e08 from "./08.json";
import e09 from "./09.json";
import e10 from "./10.json";
import e11 from "./11.json";

export interface SeedExpected {
  read: ReadResult;
  expected: { lane: Lane; ruleId: string };
  draft: string | null;
}

const ALL = [e01, e02, e03, e04, e05, e06, e07, e08, e09, e10, e11] as unknown as SeedExpected[];

export function seedExpected(no: number): SeedExpected | null {
  return ALL[no - 1] ?? null;
}
