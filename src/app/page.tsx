import { LOAN_ELIGIBILITY_EXAMPLE_DIFF } from "@/lib/examples/loan-eligibility";

import { Workspace } from "@/components/workspace";

export default function Home() {
  return <Workspace exampleDiff={LOAN_ELIGIBILITY_EXAMPLE_DIFF} />;
}