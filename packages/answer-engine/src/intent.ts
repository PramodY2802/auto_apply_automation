import type { DetectedField, QuestionIntent } from '@autoapply/shared';

const RULES: [QuestionIntent, RegExp][] = [
  ['DEMOGRAPHIC', /\b(gender|sex|race|ethnicity|ethnic|veteran|disability|disabled|pronoun|sexual orientation|religion|caste|marital|date of birth|age)\b/i],
  ['LEGAL_DECLARATION', /\b(i certify|i confirm|i declare|i acknowledge|i agree|attest|true and (complete|accurate)|terms and conditions|privacy (policy|notice)|consent)\b/i],
  ['SPONSORSHIP', /\b(sponsor(ship)?|visa)\b/i],
  ['WORK_AUTHORIZATION', /\b(authori[sz]ed to work|work authori[sz]ation|right to work|legally (eligible|authori[sz]ed)|eligible to work|work permit|citizenship)\b/i],
  ['CURRENT_SALARY', /\b(current (salary|ctc|compensation)|present (salary|ctc))\b/i],
  ['SALARY_EXPECTATION', /\b(expected (salary|ctc|compensation)|salary expectation|desired (salary|pay|compensation)|expected pay|compensation expectation|salary requirement)/i],
  ['NOTICE_PERIOD', /\b(notice period|how soon can you join|joining time|days? notice)\b/i],
  ['AVAILABILITY', /\b(start date|available to start|availability|when can you start|earliest start)\b/i],
  ['RELOCATION', /\b(relocat(e|ion)|willing to move|commute)\b/i],
  ['RESUME_UPLOAD', /\b(resume|cv|curriculum vitae)\b/i],
  ['COVER_LETTER', /\bcover letter\b/i],
  ['LINKEDIN', /\blinked\s?in\b/i],
  ['GITHUB', /\bgithub\b/i],
  ['PORTFOLIO', /\b(portfolio|personal (website|site)|website)\b/i],
  ['FIRST_NAME', /\b(first|given) name\b/i],
  ['LAST_NAME', /\b(last|family|sur) ?name\b/i],
  ['FULL_NAME', /\b(full name|^name$|your name|legal name)\b/i],
  ['EMAIL', /\be-?mail\b/i],
  ['PHONE', /\b(phone|mobile|contact number|telephone)\b/i],
  ['SKILL_EXPERIENCE', /\b(years?|how (long|many years)).{0,40}\b(experience|worked|working) (with|in|on|using)\b|\bexperience (with|in) .{1,40}\b(years?)\b/i],
  ['TOTAL_EXPERIENCE', /\b(total|overall|professional|relevant)?\s*(years of experience|experience \(years\)|how many years|years experience|work experience)\b/i],
  ['CURRENT_TITLE', /\b(current (job )?title|current (role|position|designation))\b/i],
  ['CURRENT_COMPANY', /\b(current (company|employer|organi[sz]ation)|present employer)\b/i],
  ['EDUCATION', /\b(highest (degree|qualification)|education|degree|university|college)\b/i],
  ['LOCATION', /\b(current location|city|where are you (based|located)|location|address)\b/i],
  ['MOTIVATION', /\b(why (do you want|are you interested|us|this (role|company|position))|what interests you|motivat|tell us about yourself|why should we)\b/i],
];

/** Classifies a form field into an intent using its label, key and type. */
export function classifyIntent(field: Pick<DetectedField, 'label' | 'key' | 'type'>): QuestionIntent {
  const text = `${field.label} ${field.key.replace(/[_-]+/g, ' ')}`.trim();
  if (field.type === 'FILE') return /cover/i.test(text) ? 'COVER_LETTER' : 'RESUME_UPLOAD';
  if (field.type === 'EMAIL') return 'EMAIL';
  if (field.type === 'PHONE') return 'PHONE';
  if (/\b(years?|how long)\b/i.test(field.label) && /\bexperience|worked|working\b/i.test(field.label)) {
    const skill = extractSkillFromQuestion(field.label);
    if (skill && !/^(total|overall|the industry|industry|software|this (field|role)|similar roles?|a similar role|general)$/i.test(skill)) return 'SKILL_EXPERIENCE';
  }
  for (const [intent, re] of RULES) if (re.test(text)) return intent;
  return 'CUSTOM';
}

/** Extracts the skill name from "How many years of experience do you have with Python?" */
export function extractSkillFromQuestion(label: string): string | null {
  const m = /(?:with|in|using|on)\s+([A-Za-z0-9.+#/ -]{1,40}?)(?:\?|$|\s+(?:do|have|would|development|programming))/i.exec(label);
  return m ? m[1]!.trim() : null;
}
