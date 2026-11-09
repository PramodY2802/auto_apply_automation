import { canonicalizeSkill, type CandidateProfileUpdate, type ExtractedResume, type SkillCategory } from '@autoapply/shared';

const BUCKET_CATEGORY: Record<keyof ExtractedResume['skills'], SkillCategory> = {
  technical: 'TECHNICAL',
  soft: 'SOFT',
  programmingLanguages: 'PROGRAMMING_LANGUAGE',
  frameworks: 'FRAMEWORK',
  databases: 'DATABASE',
  cloud: 'CLOUD',
  tools: 'TOOL',
};

/** CandidateProfileMapper — converts a validated extraction into a profile update payload. */
export class CandidateProfileMapper {
  toProfileUpdate(r: ExtractedResume): CandidateProfileUpdate {
    const skills = new Map<string, { name: string; category: SkillCategory }>();
    for (const [bucket, list] of Object.entries(r.skills) as [keyof ExtractedResume['skills'], string[]][]) {
      for (const s of list) {
        const c = canonicalizeSkill(s);
        if (!skills.has(c.key)) skills.set(c.key, { name: c.name, category: c.known ? c.category : BUCKET_CATEGORY[bucket] });
      }
    }
    return {
      fullName: r.fullName,
      email: r.email,
      phone: r.phone,
      location: r.location,
      summary: r.summary,
      currentTitle: r.currentTitle,
      totalExperienceMonths: r.totalExperienceMonths,
      links: { ...r.links },
      experiences: r.experiences,
      education: r.education,
      skills: [...skills.values()],
      certifications: r.certifications,
      projects: r.projects,
      achievements: r.achievements,
    };
  }
}
