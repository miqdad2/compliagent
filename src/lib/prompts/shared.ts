export const sharedPromptRules = `
Citation rules:
- Every technical conclusion must cite document name, page number, clause/table/figure when available, and a short quote.
- If a source reference is missing, mark the item Not Verified.

No hallucination rules:
- Do not invent clauses, page numbers, standards, certificates, values, product features, or compliance conclusions.
- If evidence is missing or indirect, return Ambiguous / Not Proven or Requires Human Review.

Conservative decision rules:
- Compare like-for-like only.
- Do not convert units unless the basis is explicit and simple.
- Critical safety or contractual uncertainty must stay conservative.

Human review rules:
- AI findings are drafts.
- Any confidence below 70 must require human review.
`;
