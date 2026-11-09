import {
  canonicalizeSkill,
  jaccard,
  normalizeCompany,
  normalizeTitle,
  tokenize,
  type EmploymentType,
  type MatchingWeights,
  type PreferredLocation,
  type SalaryPeriod,
  type WorkMode,
} from '@autoapply/shared';
import { annualize } from './normalize';

export const DEFAULT_WEIGHTS: MatchingWeights = { skill: 0.45, experience: 0.2, location: 0.15, preference: 0.1, salary: 0.1 };

export interface MatchCandidate {
  skills: { name: string; years?: number | null }[];
  totalExperienceMonths: number | null;
  titles: string[];
}

export interface MatchPreferences {
  titles: string[];
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  locations: PreferredLocation[];
  workModes: WorkMode[];
  employmentTypes: EmploymentType[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  salaryPeriod: SalaryPeriod;
  preferredCompanies: string[];
  excludedCompanies: string[];
  keywords: string[];
  maxPostingAgeDays: number | null;
}

export interface MatchJob {
  title: string;
  company: string;
  description: string;
  skills: string[];
  requiredSkills: string[];
  optionalSkills: string[];
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  location: string | null;
  city: string | null;
  country: string | null;
  workMode: WorkMode | null;
  employmentType: EmploymentType | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  postedAt: Date | null;
}

export interface MatchResult {
  overallScore: number;
  skillScore: number;
  experienceScore: number;
  locationScore: number;
  preferenceScore: number;
  salaryScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  disqualified: boolean;
  explanation: {
    summary: string;
    factors: { factor: string; score: number; weight: number; detail: string }[];
    disqualifiers: string[];
  };
}

export const MATCH_DISCLAIMER = 'Match scores describe how well a job fits your profile and preferences. They are not a prediction of hiring outcomes.';

const round = (n: number) => Math.round(Math.max(0, Math.min(100, n)) * 10) / 10;

/**
 * Deterministic, explainable job matching. Same inputs → same score.
 * Weights are configurable (platform setting `matching.weights`).
 */
export class MatchingEngine {
  constructor(private readonly weights: MatchingWeights = DEFAULT_WEIGHTS, private readonly now: () => Date = () => new Date()) {}

  score(candidate: MatchCandidate, prefs: MatchPreferences, job: MatchJob): MatchResult {
    const disqualifiers: string[] = [];
    const factors: MatchResult['explanation']['factors'] = [];

    // --- Skills
    const have = new Set(candidate.skills.map((s) => canonicalizeSkill(s.name).key));
    const req = [...new Set(job.requiredSkills.map((s) => canonicalizeSkill(s).name))];
    const opt = [...new Set(job.optionalSkills.map((s) => canonicalizeSkill(s).name))].filter((s) => !req.includes(s));
    const isHave = (s: string) => have.has(canonicalizeSkill(s).key);
    const reqHit = req.filter(isHave);
    const optHit = opt.filter(isHave);
    let skillScore: number;
    let skillDetail: string;
    if (!req.length && !opt.length) {
      skillScore = 50;
      skillDetail = 'The posting lists no recognisable skills; skill fit is neutral';
    } else {
      const reqPart = req.length ? reqHit.length / req.length : 1;
      const optPart = opt.length ? optHit.length / opt.length : reqPart;
      skillScore = 100 * (req.length ? 0.8 * reqPart + 0.2 * optPart : optPart);
      skillDetail = `${reqHit.length}/${req.length} required${opt.length ? ` and ${optHit.length}/${opt.length} preferred` : ''} skills matched`;
    }
    const missing = [...req.filter((s) => !isHave(s)), ...opt.filter((s) => !isHave(s))];
    factors.push({ factor: 'skills', score: round(skillScore), weight: this.weights.skill, detail: skillDetail });

    // --- Experience
    const years = candidate.totalExperienceMonths != null ? candidate.totalExperienceMonths / 12 : null;
    let expScore = 70;
    let expDetail = 'Experience requirement not stated';
    if (years == null) {
      expScore = 50;
      expDetail = 'Your total experience is unknown — add it to your profile';
    } else if (job.experienceMinYears != null || job.experienceMaxYears != null) {
      const min = job.experienceMinYears ?? 0;
      const max = job.experienceMaxYears;
      if (years < min) {
        expScore = Math.max(0, 100 - 25 * (min - years));
        expDetail = `Requires ${min}+ years; you have ${years.toFixed(1)}`;
      } else if (max != null && years > max + 1) {
        expScore = Math.max(40, 100 - 10 * (years - max));
        expDetail = `Range ${min}-${max} years; you have ${years.toFixed(1)} (may be over-qualified)`;
      } else {
        expScore = 100;
        expDetail = `Your ${years.toFixed(1)} years fits the ${min}${max != null ? `-${max}` : '+'} year requirement`;
      }
    }
    if (years != null && prefs.experienceMinYears != null && job.experienceMaxYears != null && job.experienceMaxYears < prefs.experienceMinYears) {
      expScore = Math.min(expScore, 50);
      expDetail += '; below your preferred seniority';
    }
    factors.push({ factor: 'experience', score: round(expScore), weight: this.weights.experience, detail: expDetail });

    // --- Location / work mode
    let locScore = 80;
    let locDetail = 'No location preference set';
    const jobLoc = `${job.location ?? ''} ${job.city ?? ''} ${job.country ?? ''}`.toLowerCase();
    if (job.workMode && prefs.workModes.length && !prefs.workModes.includes(job.workMode)) {
      disqualifiers.push(`Work mode ${job.workMode.toLowerCase()} is not in your preferences`);
    }
    if (job.workMode === 'REMOTE' && (!prefs.workModes.length || prefs.workModes.includes('REMOTE'))) {
      locScore = 100;
      locDetail = 'Remote role matches your preference';
    } else if (prefs.locations.length) {
      const cityHit = prefs.locations.find((l) => l.city && jobLoc.includes(l.city.toLowerCase()));
      const stateHit = prefs.locations.find((l) => l.state && jobLoc.includes(l.state.toLowerCase()));
      const countryHit = prefs.locations.find((l) => l.country && jobLoc.includes(l.country.toLowerCase()));
      if (cityHit) {
        locScore = 100;
        locDetail = `Located in ${cityHit.city}`;
      } else if (stateHit) {
        locScore = 80;
        locDetail = `In your preferred region (${stateHit.state})`;
      } else if (countryHit) {
        locScore = 65;
        locDetail = `In ${countryHit.country}, outside your preferred cities`;
      } else if (!jobLoc.trim()) {
        locScore = 50;
        locDetail = 'Job location not stated';
      } else {
        locScore = 15;
        locDetail = `Location (${job.location ?? job.city}) is outside your preferences`;
      }
    }
    factors.push({ factor: 'location', score: round(locScore), weight: this.weights.location, detail: locDetail });

    // --- Preferences: title relevance, keywords, employment type, companies
    const jt = tokenize(normalizeTitle(job.title));
    const titleSims = [...prefs.titles, ...candidate.titles].map((t) => {
      const pt = tokenize(normalizeTitle(t));
      const contains = normalizeTitle(job.title).includes(normalizeTitle(t)) ? 1 : 0;
      return Math.max(jaccard(jt, pt), contains, pt.length ? pt.filter((x) => jt.includes(x)).length / pt.length * 0.85 : 0);
    });
    const titleScore = titleSims.length ? Math.max(...titleSims) : 0.5;
    const text = `${job.title} ${job.description}`.toLowerCase();
    const kwHits = prefs.keywords.filter((k) => text.includes(k.toLowerCase()));
    const kwScore = prefs.keywords.length ? kwHits.length / prefs.keywords.length : 1;
    const typeOk = !job.employmentType || !prefs.employmentTypes.length || prefs.employmentTypes.includes(job.employmentType);
    if (!typeOk) disqualifiers.push(`Employment type ${job.employmentType!.replace('_', ' ').toLowerCase()} is not in your preferences`);
    const company = normalizeCompany(job.company);
    const preferredCo = prefs.preferredCompanies.some((c) => normalizeCompany(c) === company);
    if (prefs.excludedCompanies.some((c) => normalizeCompany(c) === company)) disqualifiers.push(`${job.company} is on your excluded companies list`);
    const prefScore = 100 * (0.6 * titleScore + 0.2 * kwScore + 0.1 * (typeOk ? 1 : 0) + 0.1 * (preferredCo ? 1 : 0.5));
    const prefDetail = `Title relevance ${(titleScore * 100).toFixed(0)}%${prefs.keywords.length ? `, ${kwHits.length}/${prefs.keywords.length} keywords` : ''}${preferredCo ? ', preferred company' : ''}`;
    factors.push({ factor: 'preferences', score: round(prefScore), weight: this.weights.preference, detail: prefDetail });
    if (prefs.titles.length && titleScore < 0.25) disqualifiers.push('Job title is unrelated to your target roles');

    // --- Salary
    let salScore = 60;
    let salDetail = 'Salary not disclosed';
    if (prefs.salaryMin == null && prefs.salaryMax == null) {
      salScore = 80;
      salDetail = 'No salary preference set';
    } else if (job.salaryMin != null || job.salaryMax != null) {
      if (job.salaryCurrency && job.salaryCurrency !== prefs.salaryCurrency) {
        salScore = 50;
        salDetail = `Salary is in ${job.salaryCurrency}; cannot compare with ${prefs.salaryCurrency}`;
      } else {
        const jobTop = annualize(job.salaryMax ?? job.salaryMin!, job.salaryPeriod ?? 'YEAR');
        const want = prefs.salaryMin != null ? annualize(prefs.salaryMin, prefs.salaryPeriod) : 0;
        if (jobTop >= want) {
          salScore = 100;
          salDetail = 'Salary range meets your minimum';
        } else {
          salScore = Math.max(0, 100 * (jobTop / Math.max(want, 1)) - 20);
          salDetail = `Top of range is ${Math.round((1 - jobTop / want) * 100)}% below your minimum`;
        }
      }
    }
    factors.push({ factor: 'salary', score: round(salScore), weight: this.weights.salary, detail: salDetail });

    // --- Posting age
    if (prefs.maxPostingAgeDays != null && job.postedAt) {
      const ageDays = (this.now().getTime() - job.postedAt.getTime()) / 86_400_000;
      if (ageDays > prefs.maxPostingAgeDays) disqualifiers.push(`Posted ${Math.floor(ageDays)} days ago (limit ${prefs.maxPostingAgeDays})`);
    }

    let overall =
      skillScore * this.weights.skill +
      expScore * this.weights.experience +
      locScore * this.weights.location +
      prefScore * this.weights.preference +
      salScore * this.weights.salary;
    const disqualified = disqualifiers.length > 0;
    if (disqualified) overall = Math.min(overall, 30);

    const top = [...factors].sort((a, b) => b.score * b.weight - a.score * a.weight);
    const summary = disqualified
      ? `Filtered by your preferences: ${disqualifiers[0]}.`
      : `${skillDetail}. ${expDetail}. ${locDetail}.`;

    return {
      overallScore: round(overall),
      skillScore: round(skillScore),
      experienceScore: round(expScore),
      locationScore: round(locScore),
      preferenceScore: round(prefScore),
      salaryScore: round(salScore),
      matchedSkills: [...reqHit, ...optHit],
      missingSkills: missing,
      disqualified,
      explanation: { summary, factors: top, disqualifiers },
    };
  }
}
