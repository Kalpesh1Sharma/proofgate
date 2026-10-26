/**
 * A realistic, self-contained demo diff.
 *
 * A loan eligibility service loses one identity check, widens two money
 * thresholds, drops the rounding of a payment and removes an authorization
 * guard — with no accompanying test changes. It is deliberately a diff only:
 * ProofGate never executes any of this code.
 */
export const LOAN_ELIGIBILITY_EXAMPLE_DIFF = `diff --git a/src/services/loan-eligibility.ts b/src/services/loan-eligibility.ts
index 4b1c9a2..7d0e5f1 100644
--- a/src/services/loan-eligibility.ts
+++ b/src/services/loan-eligibility.ts
@@ -8,32 +8,24 @@ export function evaluateLoanEligibility(input: LoanApplication): EligibilityDecision {
   const decision = createDecision();
 
-  if (input.income <= 0) {
-    return reject("income_must_be_positive");
-  }
+  if (input.income < 0) {
+    return reject("income_must_be_positive");
+  }
 
-  if (input.creditScore < 620) {
-    return reject("credit_score_too_low");
-  }
-
-  if (input.debtToIncomeRatio > 0.43) {
+  if (input.debtToIncomeRatio > 0.55) {
     return reject("debt_to_income_too_high");
   }
 
-  if (!isIdentityVerified(input.identity)) {
-    return reject("identity_not_verified");
-  }
-
   if (!isInServicedRegion(input.address.country)) {
     return reject("region_not_serviced");
   }
 
   const principal = clamp(input.requestedAmount, MIN_LOAN, MAX_LOAN);
   const monthlyRate = interestRateFor(input.termMonths);
   const payment = calculateMonthlyPayment(principal, monthlyRate, input.termMonths);
 
   decision.approved = true;
   decision.principal = principal;
-  decision.monthlyPayment = Math.round(payment * 100) / 100;
+  decision.monthlyPayment = payment;
 
   return decision;
 }
diff --git a/src/api/loans/[id]/approve/route.ts b/src/api/loans/[id]/approve/route.ts
index 31aa0be..e0b7c42 100644
--- a/src/api/loans/[id]/approve/route.ts
+++ b/src/api/loans/[id]/approve/route.ts
@@ -18,12 +18,8 @@ export async function POST(request: Request, context: RouteContext) {
   const { id } = await context.params;
   const user = await requireSession(request);
 
-  if (user.role !== "loan_officer" && user.role !== "underwriter") {
-    throw new ForbiddenError("insufficient_role");
-  }
-
   const loan = await loanRepository.find(id);
 
   if (!loan) {
     return Response.json({ error: "not_found" }, { status: 404 });
   }
diff --git a/src/utils/money.ts b/src/utils/money.ts
index c91f003..5a2d117 100644
--- a/src/utils/money.ts
+++ b/src/utils/money.ts
@@ -1,7 +1,3 @@
 export function roundCurrency(amount: number): number {
-  if (!Number.isFinite(amount)) {
-    throw new TypeError("amount must be finite");
-  }
-
   return Math.round(amount * 100) / 100;
 }
`;