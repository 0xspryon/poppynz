> **Draft — pending legal review.** This default agreement is a structured placeholder written by Poppynz for testing. It has not been reviewed by a lawyer and is not legal advice.

# Service Agreement

**Agreement version {{agreement.version}}** · Contract reference {{contract.reference}}, terms version {{contract.version}}

This Service Agreement (the "Agreement") is made through the Poppynz platform between the two people named below. It records the care services one of them will provide to the other, on the terms they agreed on Poppynz.

## 1. The parties

- **The Family:** {{family.name}}, of {{family.location}}
- **The Helper:** {{helper.name}}, of {{helper.location}}

The Family and the Helper are each a "Party" and together the "Parties".

## 2. Services

The Helper agrees to provide the following services, at the hourly rates below:

{{#services}}
- **{{name}}** at {{rate}} per hour, {{weeklyHours}} hours a week ({{weeklyAmount}} a week){{#hasExpectations}}. Expectations: {{expectations}}{{/hasExpectations}}
{{/services}}

## 3. Schedule

Sessions repeat every week, in {{contract.timeZone}}:

{{#schedule}}
- {{day}}, {{start}} to {{end}} ({{hours}} h): {{service}}
{{/schedule}}

That is {{schedule.weeklyHours}} hours a week. The first day of the contract is **{{contract.startsOn}}**. {{#contract.hasEndDate}}The last day of the contract is **{{contract.endsOn}}**, ending at {{contract.endsAt}}.{{/contract.hasEndDate}}{{^contract.hasEndDate}}The contract has no fixed end date; it runs until either Party ends it (section 7).{{/contract.hasEndDate}}

## 4. Payment and fees

All amounts are in {{contract.currency}}. For one week of the schedule above:

- Care services: {{fees.weeklyCare}}{{#fees.careTaxes}}, plus {{label}} of {{amount}}{{/fees.careTaxes}}
- Poppynz Family Service Fee ({{fees.familyFeePercent}} of the care services): {{fees.familyFee}}{{#fees.familyFeeTaxes}}, plus {{label}} of {{amount}}{{/fees.familyFeeTaxes}}
- **The Family pays {{fees.familyWeeklyTotal}} a week.**
- Poppynz commission ({{fees.commissionPercent}} of the care services, deducted from the Helper's earnings): {{fees.commission}}{{#fees.commissionTaxes}}, plus {{label}} of {{amount}}{{/fees.commissionTaxes}}
- **The Helper receives {{fees.helperWeeklyShare}} a week.**

Billing runs in cycles of {{billing.cycleDays}} days. Poppynz places a hold on the Family's card {{billing.holdLeadHours}} hours before each cycle starts for that cycle's scheduled sessions, and charges it on the cycle's first day, before care begins. If a hold is declined, Poppynz retries every {{billing.retryHours}} hours; if payment has not succeeded by the time the cycle starts, its sessions are suspended until it does. The Helper is paid through Poppynz after each cycle. The Parties agree not to pay or accept payment for these services outside Poppynz.

## 5. Extra sessions

Either Party may propose an extra session outside the weekly schedule on Poppynz: a date, a start and end time in {{contract.timeZone}}, and one of the services in section 2, at its agreed hourly rate. An extra session may be dated up to {{billing.extraSessionLookbackDays}} days in the past, for a session that already took place.

An extra session only takes place once both Parties have confirmed it on Poppynz. Silence is never a confirmation: a proposal not confirmed within {{billing.extraSessionResponseHours}} hours lapses, and nothing is charged for it.

**The Family authorises Poppynz to charge the Family's card on file for each extra session the Family confirms or proposes, at the hourly rates in section 2, plus the Poppynz Family Service Fee and applicable taxes, for the amount shown to the Family when it gives that authorisation.** The charge is made {{billing.extraSessionDelayMinutes}} minutes after both Parties have confirmed the extra session; until then, either Party may cancel it at no cost. The charge is added to the cycle's payment when that payment has not been taken yet, or made on its own otherwise. If it is declined, Poppynz retries it every {{billing.retryHours}} hours and the regular schedule is not affected. The Helper is paid for an extra session once its charge has succeeded. Once charged, an extra session is treated like any other session, including under section 6.

## 6. Cancellations

Cancelled sessions, no-shows and refunds follow section 10 of the Poppynz {{cancellation.policyTitle}}, version {{cancellation.policyVersion}} (published {{cancellation.policyPublishedOn}}), which both Parties have accepted and which forms part of this Agreement.

## 7. Ending the contract

Either Party may end this contract at any time on Poppynz by giving {{notice.days}} days' notice; sessions continue, and are paid for, until the notice period ends. The terms of a signed contract cannot be changed: to change them, the Parties end this contract and agree a new one.

## 8. Poppynz's role

Poppynz provides the platform the Parties used to find each other, agree these terms and handle payments. Poppynz is not a party to this Agreement, does not employ the Helper and does not supervise the services. The Poppynz Terms of Service apply to both Parties' use of the platform.

## 9. Signatures

Each Party signs this Agreement electronically on Poppynz by ticking "I have read and agree" and confirming: the Family with "Sign & send", the Helper with "Accept & sign". Poppynz records who signed, when, and the exact text signed.
