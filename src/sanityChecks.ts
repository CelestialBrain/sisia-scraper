/**
 * Sanity Checks - Validate scraped data against known baselines
 * Prevents data loss from AISIS HTML bleeding/misrouting
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger.js';
import type { ClassSection } from './types.js';

// Baseline thresholds for critical departments
export const DEPARTMENT_BASELINES: Record<string, {
  minCourses: number;
  requiredPrefixes?: string[];
  description: string;
}> = {
  MA: {
    minCourses: 150,
    requiredPrefixes: ['MATH'],
    description: 'Mathematics - must have MATH prefixed courses',
  },
  PE: {
    minCourses: 50,
    requiredPrefixes: ['PEPC', 'PHYED', 'NSTP'],
    description: 'Physical Education - must have PEPC, PHYED, or NSTP courses',
  },
  DISCS: {
    minCourses: 200,
    requiredPrefixes: ['CSCI', 'CS', 'IT', 'ITMGT'],
    description: 'Computer Science - must have CS/CSCI prefixed courses',
  },
  'NSTP (ADAST)': {
    minCourses: 10,
    requiredPrefixes: ['NSTP'],
    description: 'NSTP ADAST - must have NSTP courses',
  },
  'NSTP (OSCI)': {
    minCourses: 10,
    requiredPrefixes: ['NSTP'],
    description: 'NSTP OSCI - must have NSTP courses',
  },
};

export interface SanityCheckResult {
  department: string;
  passed: boolean;
  sectionCount: number;
  expectedMin: number;
  prefixCounts: Record<string, number>;
  missingPrefixes: string[];
  warnings: string[];
}

/**
 * Check if department data passes sanity checks
 */
export function checkDepartmentSanity(
  dept: string,
  sections: ClassSection[],
  rawHtml?: string
): SanityCheckResult {
  const baseline = DEPARTMENT_BASELINES[dept];
  const result: SanityCheckResult = {
    department: dept,
    passed: true,
    sectionCount: sections.length,
    expectedMin: baseline?.minCourses || 0,
    prefixCounts: {},
    missingPrefixes: [],
    warnings: [],
  };

  // Count subject prefixes
  for (const section of sections) {
    const prefix = section.subjectCode.split(' ')[0] || 'UNKNOWN';
    result.prefixCounts[prefix] = (result.prefixCounts[prefix] || 0) + 1;
  }

  // Check baseline if exists
  if (baseline) {
    // Check minimum count
    if (sections.length < baseline.minCourses) {
      result.passed = false;
      result.warnings.push(
        `Only ${sections.length} sections, expected at least ${baseline.minCourses}`
      );
    }

    // Check required prefixes
    if (baseline.requiredPrefixes) {
      for (const prefix of baseline.requiredPrefixes) {
        if (!result.prefixCounts[prefix]) {
          result.missingPrefixes.push(prefix);
        }
      }
      
      // Fail if ALL required prefixes are missing
      if (result.missingPrefixes.length === baseline.requiredPrefixes.length) {
        result.passed = false;
        result.warnings.push(
          `Missing ALL required prefixes: ${baseline.requiredPrefixes.join(', ')}`
        );
      }
    }
  }

  // Check for obvious data bleeding
  const topPrefix = Object.entries(result.prefixCounts)
    .sort((a, b) => b[1] - a[1])[0];
  
  if (topPrefix) {
    const deptFirstPart = dept.split(' ')[0].substring(0, 2);
    const prefixFirstPart = topPrefix[0].substring(0, 2);
    
    // Simple heuristic: if department code doesn't match top prefix at all
    if (dept !== 'PE' && dept !== 'DISCS' && 
        !topPrefix[0].includes(deptFirstPart) && 
        !dept.includes(prefixFirstPart)) {
      result.warnings.push(
        `Possible data bleeding: dept=${dept} but most courses are ${topPrefix[0]} (${topPrefix[1]})`
      );
    }
  }

  // Log result
  if (!result.passed) {
    logger.error('Sanity', `FAILED: ${dept}`, result.warnings);
    
    // Save raw HTML for debugging
    if (rawHtml) {
      logger.saveRawHTML('sanity-failed', dept, 'current', rawHtml);
    }
  } else if (result.warnings.length > 0) {
    logger.warn('Sanity', `WARN: ${dept}`, result.warnings);
  } else {
    logger.debug('Sanity', `PASS: ${dept} (${sections.length} sections)`);
  }

  return result;
}

/**
 * Baseline storage and comparison
 */
export class BaselineTracker {
  private baselineDir: string;
  private baselines: Record<string, BaselineData> = {};

  constructor() {
    this.baselineDir = path.join(process.cwd(), 'logs', 'baselines');
    if (!fs.existsSync(this.baselineDir)) {
      fs.mkdirSync(this.baselineDir, { recursive: true });
    }
  }

  /**
   * Load baseline for a term
   */
  loadBaseline(term: string): BaselineData | null {
    const filepath = path.join(this.baselineDir, `baseline-${term}.json`);
    if (fs.existsSync(filepath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
        this.baselines[term] = data;
        logger.info('Baseline', `Loaded baseline for ${term}`);
        return data;
      } catch (error) {
        logger.warn('Baseline', `Failed to load baseline for ${term}`);
        return null;
      }
    }
    return null;
  }

  /**
   * Save current data as baseline
   */
  saveBaseline(term: string, departments: DepartmentBaseline[]): void {
    const data: BaselineData = {
      term,
      timestamp: new Date().toISOString(),
      totalSections: departments.reduce((sum, d) => sum + d.sectionCount, 0),
      departments: Object.fromEntries(
        departments.map(d => [d.code, {
          sectionCount: d.sectionCount,
          prefixCounts: d.prefixCounts,
        }])
      ),
    };

    const filepath = path.join(this.baselineDir, `baseline-${term}.json`);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    this.baselines[term] = data;
    logger.info('Baseline', `Saved baseline for ${term}: ${data.totalSections} total sections`);
  }

  /**
   * Compare current data against baseline
   */
  compareToBaseline(
    term: string,
    current: DepartmentBaseline[]
  ): BaselineComparisonResult {
    const baseline = this.baselines[term] || this.loadBaseline(term);
    
    if (!baseline) {
      logger.info('Baseline', `No baseline exists for ${term}, current will become baseline`);
      return { hasBaseline: false, regressions: [], improvements: [] };
    }

    const result: BaselineComparisonResult = {
      hasBaseline: true,
      regressions: [],
      improvements: [],
    };

    const dropThreshold = parseFloat(process.env.BASELINE_DEPT_DROP_THRESHOLD || '0.5');

    for (const dept of current) {
      const baselineDept = baseline.departments[dept.code];
      if (!baselineDept) continue;

      const dropPct = 1 - (dept.sectionCount / baselineDept.sectionCount);
      
      if (dropPct >= dropThreshold) {
        result.regressions.push({
          department: dept.code,
          baseline: baselineDept.sectionCount,
          current: dept.sectionCount,
          dropPercent: Math.round(dropPct * 100),
        });
        logger.error('Baseline', `REGRESSION: ${dept.code} dropped ${Math.round(dropPct * 100)}%`, {
          baseline: baselineDept.sectionCount,
          current: dept.sectionCount,
        });
      } else if (dept.sectionCount > baselineDept.sectionCount * 1.1) {
        result.improvements.push({
          department: dept.code,
          baseline: baselineDept.sectionCount,
          current: dept.sectionCount,
        });
      }
    }

    return result;
  }
}

interface BaselineData {
  term: string;
  timestamp: string;
  totalSections: number;
  departments: Record<string, {
    sectionCount: number;
    prefixCounts: Record<string, number>;
  }>;
}

interface DepartmentBaseline {
  code: string;
  sectionCount: number;
  prefixCounts: Record<string, number>;
}

interface BaselineComparisonResult {
  hasBaseline: boolean;
  regressions: Array<{
    department: string;
    baseline: number;
    current: number;
    dropPercent: number;
  }>;
  improvements: Array<{
    department: string;
    baseline: number;
    current: number;
  }>;
}

export const baselineTracker = new BaselineTracker();
