/**
 * MCP Tools Index
 * 
 * Exports all tool definitions and handlers.
 * The AI can ONLY use these specific tools - no arbitrary queries.
 * 
 * BLOCKED: J_STUD_INFO.do - No personal information scraping allowed.
 */

// Public tools (no auth required)
import * as searchCourses from './searchCourses.js';
import * as getCourseSections from './getCourseSections.js';
import * as compareSections from './compareSections.js';
import * as searchInstructors from './searchInstructors.js';
import * as getInstructorSchedule from './getInstructorSchedule.js';
import * as getRoomSchedule from './getRoomSchedule.js';
import * as getCurriculum from './getCurriculum.js';
import * as buildSchedule from './buildSchedule.js';
import * as searchByNaturalTime from './searchByNaturalTime.js';
import * as getPrerequisites from './getPrerequisites.js';
import * as getDataStatus from './getDataStatus.js';
import * as listDepartments from './listDepartments.js';
import * as listPrograms from './listPrograms.js';
import * as checkConflicts from './checkConflicts.js';
import * as findFreeRooms from './findFreeRooms.js';
import * as getCourseInfo from './getCourseInfo.js';
import * as findOpenSections from './findOpenSections.js';
import * as buildCurriculumSchedule from './buildCurriculumSchedule.js';
// Phase 1 data-driven tools
import * as getPopularCourses from './getPopularCourses.js';
import * as getInstructorStats from './getInstructorStats.js';
import * as searchByModality from './searchByModality.js';
import * as searchByLevel from './searchByLevel.js';
import * as findCoursesWithoutPrereqs from './findCoursesWithoutPrereqs.js';
// Phase 2 gap solutions
import * as getRestrictedSections from './getRestrictedSections.js';
import * as getTimeSlotStats from './getTimeSlotStats.js';
import * as searchPECourses from './searchPECourses.js';
// Professor feedback from Facebook scraper
import * as getProfessorFeedback from './getProfessorFeedback.js';

// Personal tools (auth required, encrypted credentials)
import * as getMySchedule from './getMySchedule.js';
import * as getMyIPS from './getMyIPS.js';
import * as getMyGrades from './getMyGrades.js';
import * as getMyHoldOrders from './getMyHoldOrders.js';
import * as getMyEnrolledClasses from './getMyEnrolledClasses.js';

// Public tools (no authentication required)
const publicTools = [
  searchCourses,
  getCourseSections,
  compareSections,
  searchInstructors,
  getInstructorSchedule,
  getRoomSchedule,
  getCurriculum,
  buildSchedule,
  searchByNaturalTime,
  getPrerequisites,
  getDataStatus,
  listDepartments,
  listPrograms,
  checkConflicts,
  findFreeRooms,
  getCourseInfo,
  findOpenSections,
  buildCurriculumSchedule,
  // Phase 1 data-driven tools
  getPopularCourses,
  getInstructorStats,
  searchByModality,
  searchByLevel,
  findCoursesWithoutPrereqs,
  // Phase 2 gap solutions
  getRestrictedSections,
  getTimeSlotStats,
  searchPECourses,
  // Community feedback
  getProfessorFeedback,
];

// Personal tools (require authentication + linked AISIS)
const personalTools = [
  getMySchedule,
  getMyIPS,
  getMyGrades,
  getMyHoldOrders,
  getMyEnrolledClasses,
];

// All tools
const allTools = [...publicTools, ...personalTools];

// Export tool definitions for Gemini
export const definitions = allTools.map(t => t.definition);
export const publicDefinitions = publicTools.map(t => t.definition);
export const personalDefinitions = personalTools.map(t => t.definition);

// Handler lookup
const handlers: Record<string, (args: any, context?: any) => any> = {};
allTools.forEach(t => {
  handlers[t.definition.name] = t.handler;
});

// Personal tool names (require auth context)
const personalToolNames = new Set(personalTools.map(t => t.definition.name));

// Logging colors
const logColors = {
  function: '\x1b[36m',  // cyan
  result: '\x1b[32m',    // green
  time: '\x1b[33m',      // yellow
  error: '\x1b[31m',     // red
  personal: '\x1b[35m',  // magenta for personal tools
  reset: '\x1b[0m',
};

interface UserContext {
  userId: string;
  accessToken: string;
}

/**
 * Handle a function call from Gemini
 * Logs the call and result for debugging
 */
export async function handleFunctionCall(
  name: string, 
  args: Record<string, unknown>,
  userContext?: UserContext
): Promise<unknown> {
  const startTime = Date.now();
  const timestamp = new Date().toLocaleTimeString();
  const isPersonal = personalToolNames.has(name);
  
  // Log function call
  const color = isPersonal ? logColors.personal : logColors.function;
  console.log(`${color}[${timestamp}] 📞 FUNCTION: ${name}${isPersonal ? ' (PERSONAL)' : ''}${logColors.reset}`);
  console.log(`   Args: ${JSON.stringify(args, null, 0).slice(0, 200)}`);
  
  // Execute handler
  const handler = handlers[name];
  if (!handler) {
    console.log(`${logColors.error}   ❌ Unknown function: ${name}${logColors.reset}`);
    return { error: `Unknown function: ${name}. Available: ${Object.keys(handlers).join(', ')}` };
  }
  
  // Personal tools require user context
  if (isPersonal && !userContext) {
    console.log(`${logColors.error}   ❌ Personal tool requires authentication${logColors.reset}`);
    return { 
      error: 'This feature requires you to be logged in and have a linked AISIS account.',
      action_required: 'login'
    };
  }
  
  try {
    // Pass user context to personal tools
    const result = isPersonal 
      ? await handler(args, userContext)
      : handler(args);
    
    // Log result
    const duration = Date.now() - startTime;
    let summary = '';
    if (result && typeof result === 'object') {
      if ('courses' in result) summary = `${(result as any).courses?.length || 0} courses`;
      else if ('sections' in result) summary = `${(result as any).sections?.length || 0} sections`;
      else if ('schedule' in result) summary = `${(result as any).schedule?.length || 0} items`;
      else if ('instructors' in result) summary = `${(result as any).instructors?.length || 0} instructors`;
      else if ('curriculum' in result) summary = `${(result as any).total_courses || 0} courses`;
      else if ('weekly_grid' in result) summary = `schedule built`;
      else if ('interpretation' in result) summary = (result as any).interpretation;
      else if ('grades' in result) summary = `${(result as any).grades?.length || 0} grades`;
      else if ('gpa' in result) summary = `GPA: ${(result as any).gpa}`;
      else if ('has_holds' in result) summary = (result as any).has_holds ? 'HAS HOLDS' : 'clear';
      else if ('feedback' in result) summary = `${(result as any).feedback?.total_comments || 0} comments`;
      else if ('error' in result) summary = `ERROR: ${(result as any).error}`;
      else if ('found' in result && !(result as any).found) summary = 'not found';
    }
    
    console.log(`${logColors.result}[${timestamp}] ✅ RESULT: ${name}${logColors.reset} ${logColors.time}(${duration}ms)${logColors.reset}`);
    console.log(`   Summary: ${summary}`);
    
    return result;
  } catch (err: any) {
    console.log(`${logColors.error}[${timestamp}] ❌ ERROR: ${name} - ${err.message}${logColors.reset}`);
    return { error: err.message };
  }
}

// Export list of tool names for health check
export const toolNames = allTools.map(t => t.definition.name);
export const publicToolNames = publicTools.map(t => t.definition.name);
