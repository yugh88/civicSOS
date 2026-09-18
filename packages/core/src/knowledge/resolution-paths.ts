import type { CategoryId, ResolutionPath } from '../domain/types.js';

/**
 * Resolution paths — the deterministic heart of CivicSOS.
 *
 * Each record answers, without any help from a language model: who handles this,
 * what evidence is needed, what the citizen is asking for, what happens after
 * submission, how long to wait, and how to escalate. Gemini only ever fills in
 * the natural-language parts; these records decide the workflow.
 *
 * Response windows below are conservative *guidance* values, not statutory
 * guarantees — they vary by state and by municipal citizen's-charter. They are
 * presented to the user as "typical", never as a legal entitlement.
 */

/** Evidence requirements shared by every category. */
const BASE_EVIDENCE = [
  {
    key: 'photo',
    label: 'A clear photo of the problem',
    description: 'Wide enough to show the surroundings, so the location is recognisable.',
    required: true,
  },
  {
    key: 'location',
    label: 'The exact location',
    description: 'Street name plus a landmark. A nearby shop or building number works well.',
    required: true,
  },
] as const;

const DATE_EVIDENCE = {
  key: 'since_when',
  label: 'How long the problem has existed',
  description: 'A date or rough duration. This matters a lot for escalation later.',
  required: true,
};

const CONTACT_EVIDENCE = {
  key: 'contact',
  label: 'A contact number for the complaint form',
  description: 'The official portal will ask for it. CivicSOS does not need or store it.',
  required: false,
};

export const RESOLUTION_PATHS: Record<CategoryId, ResolutionPath> = {
  ROAD_DAMAGE: {
    pathId: 'PATH_ROAD_DAMAGE_V1',
    categoryId: 'ROAD_DAMAGE',
    authorityId: 'MUNICIPAL_ROADS',
    requestedAction: 'Inspect and repair the damaged road surface, and make the spot safe in the meantime.',
    evidenceRequirements: [
      ...BASE_EVIDENCE,
      DATE_EVIDENCE,
      {
        key: 'scale',
        label: 'Rough size or number of potholes',
        description: 'E.g. "three potholes, about 2 feet wide". Helps the engineering wing plan the repair.',
        required: false,
      },
      CONTACT_EVIDENCE,
    ],
    expectedAcknowledgementDays: 3,
    expectedResolutionDays: 15,
    afterSubmission: [
      'The portal or helpline gives you a complaint/ticket number — save it, everything later depends on it.',
      'The complaint is routed to the ward engineer or junior engineer for that stretch of road.',
      'A site inspection is usually done first, then the repair is scheduled against the ward budget.',
      'You may get an SMS when the work order is raised and again when it is marked complete.',
    ],
    escalationSteps: [
      {
        level: 1,
        title: 'Follow up on your complaint number',
        detail:
          'Call the helpline or reopen the ticket on the portal, quoting your complaint number and the date filed. ' +
          'Ask specifically for the name of the officer the complaint was assigned to.',
        afterDays: 15,
      },
      {
        level: 2,
        title: 'Escalate to the ward officer / executive engineer',
        detail:
          'Write to the ward officer or executive engineer of the zone, attaching your original complaint number, ' +
          'the photos, and the fact that the statutory window has passed.',
        afterDays: 30,
        authorityHint: 'Ward officer or executive engineer (engineering wing)',
      },
      {
        level: 3,
        title: 'File on CPGRAMS and consider the municipal commissioner',
        detail:
          'Lodge the grievance on the Government of India CPGRAMS portal and copy the municipal commissioner. ' +
          'A road hazard that has caused an injury can also be raised with the state road safety cell.',
        afterDays: 45,
        authorityHint: 'CPGRAMS + municipal commissioner',
      },
    ],
    complaintTemplate: {
      subject: 'Complaint: damaged road surface at [[LOCATION]]',
      body: `To the Engineering / Roads Department,
[[AUTHORITY_NAME]]

Subject: Damaged road surface at [[LOCATION]] — request for inspection and repair

Sir / Madam,

I wish to report damage to the road surface at [[LOCATION]].

Details of the problem:
[[DESCRIPTION]]

Duration: the problem has been present [[SINCE_WHEN]].

This condition is a safety risk to two-wheeler riders, pedestrians and school children using this stretch, and it worsens during rain when the damage is not visible under standing water.

I request that the department:
1. Inspect the location at the earliest.
2. Carry out the necessary repair or resurfacing.
3. Put up a temporary warning marker if the repair will take time.

Photographs of the location are attached / available on request.

I would be grateful for a complaint number and an expected timeline for the repair.

Yours faithfully,
[[YOUR_NAME]]
[[YOUR_CONTACT]]
Date: [[TODAY]]`,
    },
  },

  GARBAGE_SANITATION: {
    pathId: 'PATH_GARBAGE_V1',
    categoryId: 'GARBAGE_SANITATION',
    authorityId: 'MUNICIPAL_SANITATION',
    requestedAction: 'Clear the accumulated waste and restore the regular collection schedule for this location.',
    evidenceRequirements: [
      ...BASE_EVIDENCE,
      DATE_EVIDENCE,
      {
        key: 'recurring',
        label: 'Whether this keeps happening',
        description: 'A recurring lapse is treated differently from a one-off missed pickup.',
        required: false,
      },
      CONTACT_EVIDENCE,
    ],
    expectedAcknowledgementDays: 1,
    expectedResolutionDays: 7,
    afterSubmission: [
      'Sanitation complaints are usually the fastest — many cities target 24–48 hours for a clearance.',
      'The complaint goes to the sanitary inspector or health officer for your ward.',
      'The Swachhata app asks for a photo and then shows the resolution photo once the spot is cleared.',
      'If the cause is a missed collection route, ask for the collection schedule to be corrected, not just a one-time cleanup.',
    ],
    escalationSteps: [
      {
        level: 1,
        title: 'Reopen the complaint with a fresh photo',
        detail:
          'On the Swachhata app or your city portal, reopen the ticket and attach a new photo with the current date. ' +
          'A photo taken after the claimed resolution date is the single most effective escalation evidence.',
        afterDays: 7,
      },
      {
        level: 2,
        title: 'Escalate to the ward sanitary inspector / health officer',
        detail:
          'Write to the ward sanitary inspector and the zonal health officer, quoting the complaint number and the ' +
          'dates on which the location was photographed still uncleared.',
        afterDays: 14,
        authorityHint: 'Ward sanitary inspector / zonal health officer',
      },
      {
        level: 3,
        title: 'Escalate to CPGRAMS and the public health angle',
        detail:
          'File on CPGRAMS. Where waste has been standing long enough to be a mosquito-breeding or disease risk, ' +
          'raise it with the municipal health department as a public health complaint, not just a cleanliness one.',
        afterDays: 30,
        authorityHint: 'CPGRAMS + municipal health department',
      },
    ],
    complaintTemplate: {
      subject: 'Complaint: uncollected garbage at [[LOCATION]]',
      body: `To the Sanitation / Solid Waste Management Department,
[[AUTHORITY_NAME]]

Subject: Uncollected waste at [[LOCATION]] — request for immediate clearance and schedule correction

Sir / Madam,

I wish to report accumulated, uncollected waste at [[LOCATION]].

Details of the problem:
[[DESCRIPTION]]

Duration: the waste has been lying there [[SINCE_WHEN]].

The accumulation has begun to cause a persistent odour and is attracting flies, stray animals and mosquito breeding, which is a public health risk for residents of this area — particularly children and elderly residents.

I request that the department:
1. Arrange immediate clearance of the accumulated waste.
2. Confirm and correct the door-to-door collection schedule for this location, so the problem does not recur.
3. Consider placing a covered community bin here if the location is a habitual dumping spot.

Photographs of the location are attached / available on request.

I would be grateful for a complaint number and confirmation once the spot has been cleared.

Yours faithfully,
[[YOUR_NAME]]
[[YOUR_CONTACT]]
Date: [[TODAY]]`,
    },
  },

  STREETLIGHT: {
    pathId: 'PATH_STREETLIGHT_V1',
    categoryId: 'STREETLIGHT',
    authorityId: 'MUNICIPAL_STREETLIGHT',
    requestedAction: 'Repair or replace the non-functional street lighting and restore lighting on this stretch.',
    evidenceRequirements: [
      ...BASE_EVIDENCE,
      DATE_EVIDENCE,
      {
        key: 'pole_number',
        label: 'The pole number, if one is painted on it',
        description: 'Street light poles usually carry a number. It lets the crew find the exact pole immediately.',
        required: false,
      },
      {
        key: 'count',
        label: 'How many lights are affected',
        description: 'One lamp versus a whole stretch points to different faults.',
        required: false,
      },
      CONTACT_EVIDENCE,
    ],
    expectedAcknowledgementDays: 2,
    expectedResolutionDays: 10,
    afterSubmission: [
      'The complaint is routed to the electrical wing of the corporation, or to the distribution company where lighting is outsourced.',
      'A lineman is typically sent to check whether the fault is the lamp, the fuse or the feeder line.',
      'A single dead lamp is usually a quick fix; a whole dark stretch often means a cable or feeder fault and takes longer.',
      'Ask for the pole number to be recorded against the ticket — it speeds up every follow-up.',
    ],
    escalationSteps: [
      {
        level: 1,
        title: 'Follow up with the pole number',
        detail:
          'Call the helpline with your complaint number and the pole number. Ask whether the fault was logged as a ' +
          'lamp fault or a feeder fault — those go to different crews.',
        afterDays: 10,
      },
      {
        level: 2,
        title: 'Escalate to the electrical executive engineer',
        detail:
          'Write to the executive engineer (electrical) for the zone. A dark stretch is a womens-safety and ' +
          'road-safety issue, and framing it that way is both accurate and effective.',
        afterDays: 21,
        authorityHint: 'Executive engineer (electrical) / distribution company nodal officer',
      },
      {
        level: 3,
        title: 'CPGRAMS, and the local elected representative',
        detail:
          'File on CPGRAMS. Street lighting is also a standard ward-committee matter, so raising it with your elected ' +
          'ward councillor in writing is a legitimate parallel route.',
        afterDays: 35,
        authorityHint: 'CPGRAMS + ward councillor',
      },
    ],
    complaintTemplate: {
      subject: 'Complaint: street lights not working at [[LOCATION]]',
      body: `To the Street Lighting / Electrical Department,
[[AUTHORITY_NAME]]

Subject: Non-functional street lighting at [[LOCATION]] — request for repair

Sir / Madam,

I wish to report that street lighting at [[LOCATION]] is not working.

Details of the problem:
[[DESCRIPTION]]

Duration: the lighting has been out [[SINCE_WHEN]].

The stretch is completely unlit after dark. This is a safety concern for pedestrians, for women returning home in the evening, and for vehicles using the road, and it has increased the risk of both accidents and petty crime in the area.

I request that the department:
1. Depute a lineman to inspect the affected pole(s).
2. Repair or replace the non-functional fitting.
3. Confirm whether the fault lies with the corporation or with the electricity distribution company, so that it can be routed correctly without further delay.

If street lighting at this location is maintained by the distribution company rather than the corporation, I request that this complaint be forwarded to them and that I be informed accordingly.

Photographs of the location are attached / available on request.

Yours faithfully,
[[YOUR_NAME]]
[[YOUR_CONTACT]]
Date: [[TODAY]]`,
    },
  },

  WATER_SEWERAGE: {
    pathId: 'PATH_WATER_V1',
    categoryId: 'WATER_SEWERAGE',
    authorityId: 'WATER_UTILITY',
    requestedAction: 'Restore safe water supply / stop the leak or sewage overflow and repair the affected line.',
    evidenceRequirements: [
      ...BASE_EVIDENCE,
      DATE_EVIDENCE,
      {
        key: 'households',
        label: 'Roughly how many households are affected',
        description: 'A street-wide outage is prioritised differently from a single connection.',
        required: true,
      },
      {
        key: 'consumer_number',
        label: 'Your water connection / consumer number',
        description: 'On your water bill. Needed for supply complaints; not needed for a public leak or drain.',
        required: false,
      },
      CONTACT_EVIDENCE,
    ],
    expectedAcknowledgementDays: 1,
    expectedResolutionDays: 7,
    afterSubmission: [
      'Water complaints are usually logged as emergency, priority or routine — say clearly if supply is fully cut off or the water is contaminated.',
      'The complaint goes to the assistant engineer for your water/sewerage sub-division.',
      'A valve operator or fitter normally inspects first; a line repair may need a road-cutting permission, which adds days.',
      'Contaminated water should also be raised with the municipal health department — ask for a water sample test and keep the test reference.',
    ],
    escalationSteps: [
      {
        level: 1,
        title: 'Follow up and ask for the priority classification',
        detail:
          'Call the helpline with your complaint number and ask how the complaint was classified. If supply is cut ' +
          'off or water is contaminated, ask explicitly for it to be re-classified as an emergency.',
        afterDays: 7,
      },
      {
        level: 2,
        title: 'Escalate to the assistant / executive engineer',
        detail:
          'Write to the assistant engineer and executive engineer of the water sub-division, quoting the complaint ' +
          'number, the number of affected households, and the days without safe supply.',
        afterDays: 14,
        authorityHint: 'Assistant / executive engineer, water supply & sewerage',
      },
      {
        level: 3,
        title: 'CPGRAMS, and the public health route',
        detail:
          'File on CPGRAMS. Contaminated drinking water or a standing sewage overflow is a public health matter — ' +
          'raise it with the municipal health officer and, if there are illnesses in the area, say so in writing.',
        afterDays: 25,
        authorityHint: 'CPGRAMS + municipal health officer',
      },
    ],
    complaintTemplate: {
      subject: 'Complaint: water supply / sewerage problem at [[LOCATION]]',
      body: `To the Water Supply & Sewerage Department,
[[AUTHORITY_NAME]]

Subject: Water supply / sewerage problem at [[LOCATION]] — request for urgent attention

Sir / Madam,

I wish to report a water supply / sewerage problem at [[LOCATION]].

Details of the problem:
[[DESCRIPTION]]

Duration: the problem has continued [[SINCE_WHEN]].
Households affected: [[HOUSEHOLDS_AFFECTED]]

This directly affects the daily water needs and the sanitary conditions of the residents of this area. Where water is being wasted through a leak, it is also a loss of treated water at a time of shortage; where sewage is overflowing, it is an immediate health hazard.

I request that the department:
1. Depute a fitter / valve operator to inspect the location urgently.
2. Carry out the necessary repair to the line or connection.
3. Where drinking water quality is in question, collect a water sample for testing and share the result.

My water connection / consumer number, where applicable, is [[CONSUMER_NUMBER]].

Photographs of the location are attached / available on request.

Yours faithfully,
[[YOUR_NAME]]
[[YOUR_CONTACT]]
Date: [[TODAY]]`,
    },
  },

  PUBLIC_SAFETY_HAZARD: {
    pathId: 'PATH_SAFETY_V1',
    categoryId: 'PUBLIC_SAFETY_HAZARD',
    authorityId: 'SAFETY_MULTI',
    requestedAction: 'Make the location safe immediately, then permanently remove or repair the hazard.',
    evidenceRequirements: [
      ...BASE_EVIDENCE,
      {
        key: 'hazard_type',
        label: 'What exactly is dangerous',
        description: 'Live wire, fallen tree, open pit, unsafe wall — this decides who is sent.',
        required: true,
      },
      {
        key: 'risk_to_people',
        label: 'Who is at risk right now',
        description: 'Pedestrians, a school route, a bus stop. Be specific; it drives prioritisation.',
        required: true,
      },
      CONTACT_EVIDENCE,
    ],
    expectedAcknowledgementDays: 1,
    expectedResolutionDays: 3,
    afterSubmission: [
      'If there is danger to life right now, the emergency helpline is the correct first step — not a written complaint.',
      'Hazard reports are normally treated as priority and attended within hours to a couple of days.',
      'Electrical hazards go to the distribution company; trees and structures go to the corporation; keep both numbers if unsure.',
      'Ask for the spot to be barricaded even if the permanent repair will take longer.',
    ],
    escalationSteps: [
      {
        level: 1,
        title: 'Call again and ask for barricading',
        detail:
          'Call the helpline with your complaint number. If nothing has happened, ask specifically for interim ' +
          'barricading or a warning marker, which is a much smaller ask than the full repair.',
        afterDays: 3,
      },
      {
        level: 2,
        title: 'Escalate in writing to the disaster management cell',
        detail:
          'Write to the municipal disaster management cell and the relevant executive engineer, stating that an ' +
          'identified hazard has remained unattended and who is at risk. Put the risk in writing — it shifts liability.',
        afterDays: 7,
        authorityHint: 'Municipal disaster management cell / executive engineer',
      },
      {
        level: 3,
        title: 'CPGRAMS and the commissioner, in writing',
        detail:
          'File on CPGRAMS and write to the municipal commissioner. A documented, unattended public hazard is a ' +
          'serious matter and the written record is what makes the escalation effective.',
        afterDays: 14,
        authorityHint: 'CPGRAMS + municipal commissioner',
      },
    ],
    complaintTemplate: {
      subject: 'URGENT — public safety hazard at [[LOCATION]]',
      body: `To the Disaster Management / Engineering Department,
[[AUTHORITY_NAME]]

Subject: URGENT — public safety hazard at [[LOCATION]] — request for immediate action

Sir / Madam,

I wish to report a public safety hazard at [[LOCATION]] that requires immediate attention.

Nature of the hazard:
[[HAZARD_TYPE]]

Details of the problem:
[[DESCRIPTION]]

People at risk:
[[RISK_TO_PEOPLE]]

This is an immediate risk of serious injury. I request that the department:
1. Depute a team to make the location safe without delay.
2. Barricade or cordon the spot immediately if the permanent repair will take longer.
3. Carry out the permanent repair or removal, and confirm once done.

If this hazard falls under the jurisdiction of the electricity distribution company or another agency, I request that it be forwarded to them immediately given the urgency, and that I be informed.

Photographs of the location are attached / available on request.

Yours faithfully,
[[YOUR_NAME]]
[[YOUR_CONTACT]]
Date: [[TODAY]]`,
    },
  },

  OTHER: {
    pathId: 'PATH_GENERAL_V1',
    categoryId: 'OTHER',
    authorityId: 'GENERAL_GRIEVANCE',
    requestedAction: 'Route the complaint to the correct department and confirm the action taken.',
    evidenceRequirements: [...BASE_EVIDENCE, DATE_EVIDENCE, CONTACT_EVIDENCE],
    expectedAcknowledgementDays: 3,
    expectedResolutionDays: 21,
    afterSubmission: [
      'A general grievance is first routed to whichever department the portal decides owns the issue.',
      'You will get a registration number — keep it, since the routing itself is often what needs following up.',
      'If it is routed to the wrong department, say so in the follow-up rather than filing a fresh complaint.',
    ],
    escalationSteps: [
      {
        level: 1,
        title: 'Check where the complaint was routed',
        detail:
          'Log in to the portal and check which department the grievance was assigned to. A wrongly routed ' +
          'complaint is the most common reason for silence.',
        afterDays: 21,
      },
      {
        level: 2,
        title: 'Ask for reassignment, in writing',
        detail: 'Request reassignment to the correct department, quoting the registration number and the reason.',
        afterDays: 35,
      },
      {
        level: 3,
        title: 'Escalate on CPGRAMS',
        detail: 'Use the appeal option on CPGRAMS once the grievance has been closed without a substantive reply.',
        afterDays: 50,
        authorityHint: 'CPGRAMS appeal',
      },
    ],
    complaintTemplate: {
      subject: 'Complaint regarding [[LOCATION]]',
      body: `To the Grievance Redressal Officer,
[[AUTHORITY_NAME]]

Subject: Civic complaint regarding [[LOCATION]]

Sir / Madam,

I wish to bring the following civic problem to your attention.

Location: [[LOCATION]]

Details of the problem:
[[DESCRIPTION]]

Duration: [[SINCE_WHEN]]

I request that this complaint be routed to the department responsible, that the necessary action be taken, and that I be informed of the outcome.

Photographs of the location are attached / available on request.

Yours faithfully,
[[YOUR_NAME]]
[[YOUR_CONTACT]]
Date: [[TODAY]]`,
    },
  },
};

export function getResolutionPath(categoryId: CategoryId): ResolutionPath {
  return RESOLUTION_PATHS[categoryId] ?? RESOLUTION_PATHS.OTHER;
}

export function getResolutionPathById(pathId: string): ResolutionPath | undefined {
  return Object.values(RESOLUTION_PATHS).find((path) => path.pathId === pathId);
}
