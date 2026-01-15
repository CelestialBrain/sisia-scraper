import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { FunctionDeclaration } from '@google/generative-ai';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

// Connect to SISIA database
const db = new Database(path.join(__dirname, '../../sisia.db'), { readonly: true });

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Function definitions for Gemini
const functions: FunctionDeclaration[] = [
  {
    name: 'search_courses',
    description: 'Search for courses by keyword or course code. Returns matching courses with their details.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: { type: SchemaType.STRING, description: 'Search query (course code or title keyword)' },
        term: { type: SchemaType.STRING, description: 'Optional term code like 2025-2' },
        limit: { type: SchemaType.NUMBER, description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_course_sections',
    description: 'Get all sections for a specific course code, including schedule times and instructors.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        course_code: { type: SchemaType.STRING, description: 'Course code like MATH 30.13' },
        term: { type: SchemaType.STRING, description: 'Term code like 2025-2' },
      },
      required: ['course_code'],
    },
  },
  {
    name: 'get_instructor_schedule',
    description: 'Get all classes taught by an instructor, optionally filtered by day.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        instructor_name: { type: SchemaType.STRING, description: 'Instructor name (partial match)' },
        day: { type: SchemaType.STRING, description: 'Optional day like Monday, Friday' },
        term: { type: SchemaType.STRING, description: 'Term code' },
      },
      required: ['instructor_name'],
    },
  },
  {
    name: 'get_room_schedule',
    description: 'Get all classes in a specific room.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        room_code: { type: SchemaType.STRING, description: 'Room code like SEC-A117' },
        term: { type: SchemaType.STRING, description: 'Term code' },
      },
      required: ['room_code'],
    },
  },
  {
    name: 'list_all_instructors',
    description: 'Get a list of all instructors, optionally filtered by department.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        department: { type: SchemaType.STRING, description: 'Department code like DISCS, MA' },
        limit: { type: SchemaType.NUMBER, description: 'Max results (default 50)' },
      },
    },
  },
  {
    name: 'list_all_rooms',
    description: 'Get a list of all rooms/classrooms in the database.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        building: { type: SchemaType.STRING, description: 'Optional building filter' },
        limit: { type: SchemaType.NUMBER, description: 'Max results (default 50)' },
      },
    },
  },
  {
    name: 'get_term_summary',
    description: 'Get summary statistics for a term (section count, course count, etc).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        term: { type: SchemaType.STRING, description: 'Term code like 2025-2 (optional, defaults to current)' },
      },
    },
  },
  {
    name: 'find_classes_by_time',
    description: 'Find classes that meet on specific days or time ranges.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        day: { type: SchemaType.STRING, description: 'Day like Monday, MWF, TTh' },
        start_time: { type: SchemaType.STRING, description: 'Start time like 0800, 1300' },
        end_time: { type: SchemaType.STRING, description: 'End time like 0930, 1430' },
        term: { type: SchemaType.STRING, description: 'Term code' },
        limit: { type: SchemaType.NUMBER, description: 'Max results' },
      },
      required: ['day'],
    },
  },
];

// Function handlers
function handleFunctionCall(name: string, args: Record<string, unknown>): unknown {
  const limit = (args.limit as number) || 20;
  const term = (args.term as string) || '2025-2';
  
  switch (name) {
    case 'search_courses': {
      const query = `%${args.query}%`;
      const rows = db.prepare(`
        SELECT DISTINCT c.course_code, c.title, c.units, d.code as department,
               (SELECT COUNT(*) FROM class_section cs 
                JOIN term t ON cs.term_id = t.id 
                WHERE cs.course_id = c.id AND t.code = ?) as section_count
        FROM course c
        LEFT JOIN department d ON c.department_id = d.id
        WHERE c.course_code LIKE ? OR c.title LIKE ?
        ORDER BY c.course_code
        LIMIT ?
      `).all(term, query, query, limit);
      return { courses: rows, total: rows.length };
    }
    
    case 'get_course_sections': {
      const rows = db.prepare(`
        SELECT cs.section, i.name as instructor, cs.max_capacity, cs.free_slots,
               cs.remarks, t.code as term,
               GROUP_CONCAT(ss.day || ' ' || ss.start_time || '-' || ss.end_time || ' ' || COALESCE(r.code, ''), '; ') as schedule
        FROM class_section cs
        JOIN course c ON cs.course_id = c.id
        JOIN term t ON cs.term_id = t.id
        LEFT JOIN instructor i ON cs.instructor_id = i.id
        LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
        LEFT JOIN room r ON ss.room_id = r.id
        WHERE c.course_code = ? AND t.code = ?
        GROUP BY cs.id
        ORDER BY cs.section
      `).all(args.course_code, term);
      return { course: args.course_code, term, sections: rows };
    }
    
    case 'get_instructor_schedule': {
      const nameLike = `%${args.instructor_name}%`;
      let sql = `
        SELECT i.name as instructor, c.course_code, cs.section, 
               ss.day, ss.start_time, ss.end_time, r.code as room, t.code as term
        FROM class_section cs
        JOIN instructor i ON cs.instructor_id = i.id
        JOIN course c ON cs.course_id = c.id
        JOIN term t ON cs.term_id = t.id
        LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
        LEFT JOIN room r ON ss.room_id = r.id
        WHERE i.name LIKE ? AND t.code = ?
      `;
      const params: unknown[] = [nameLike, term];
      if (args.day) {
        sql += ` AND ss.day = ?`;
        params.push(args.day);
      }
      sql += ` ORDER BY ss.day, ss.start_time LIMIT ?`;
      params.push(limit);
      const rows = db.prepare(sql).all(...params);
      return { instructor: args.instructor_name, schedule: rows };
    }
    
    case 'get_room_schedule': {
      const rows = db.prepare(`
        SELECT r.code as room, c.course_code, cs.section, i.name as instructor,
               ss.day, ss.start_time, ss.end_time, t.code as term
        FROM schedule_slot ss
        JOIN room r ON ss.room_id = r.id
        JOIN class_section cs ON ss.section_id = cs.id
        JOIN course c ON cs.course_id = c.id
        JOIN term t ON cs.term_id = t.id
        LEFT JOIN instructor i ON cs.instructor_id = i.id
        WHERE r.code LIKE ? AND t.code = ?
        ORDER BY ss.day, ss.start_time
        LIMIT ?
      `).all(`%${args.room_code}%`, term, limit);
      return { room: args.room_code, schedule: rows };
    }
    
    case 'list_all_instructors': {
      let sql = `SELECT i.name, d.code as department, COUNT(cs.id) as class_count
                 FROM instructor i
                 LEFT JOIN department d ON i.department_id = d.id
                 LEFT JOIN class_section cs ON cs.instructor_id = i.id`;
      const params: unknown[] = [];
      if (args.department) {
        sql += ` WHERE d.code = ?`;
        params.push(args.department);
      }
      sql += ` GROUP BY i.id ORDER BY i.name LIMIT ?`;
      params.push(limit);
      const rows = db.prepare(sql).all(...params);
      return { instructors: rows, total: rows.length };
    }
    
    case 'list_all_rooms': {
      const rows = db.prepare(`
        SELECT r.code, COUNT(DISTINCT ss.id) as slot_count
        FROM room r
        LEFT JOIN schedule_slot ss ON ss.room_id = r.id
        GROUP BY r.id
        ORDER BY r.code
        LIMIT ?
      `).all(limit);
      return { rooms: rows, total: rows.length };
    }
    
    case 'get_term_summary': {
      const row = db.prepare(`
        SELECT t.code as term, 
               COUNT(DISTINCT cs.id) as sections,
               COUNT(DISTINCT c.id) as courses,
               COUNT(DISTINCT i.id) as instructors,
               COUNT(DISTINCT r.id) as rooms
        FROM term t
        LEFT JOIN class_section cs ON cs.term_id = t.id
        LEFT JOIN course c ON cs.course_id = c.id
        LEFT JOIN instructor i ON cs.instructor_id = i.id
        LEFT JOIN schedule_slot ss ON ss.section_id = cs.id
        LEFT JOIN room r ON ss.room_id = r.id
        WHERE t.code = ?
        GROUP BY t.id
      `).get(term);
      return row || { error: 'Term not found' };
    }
    
    case 'find_classes_by_time': {
      let sql = `
        SELECT c.course_code, cs.section, i.name as instructor,
               ss.day, ss.start_time, ss.end_time, r.code as room
        FROM schedule_slot ss
        JOIN class_section cs ON ss.section_id = cs.id
        JOIN course c ON cs.course_id = c.id
        JOIN term t ON cs.term_id = t.id
        LEFT JOIN instructor i ON cs.instructor_id = i.id
        LEFT JOIN room r ON ss.room_id = r.id
        WHERE t.code = ? AND ss.day LIKE ?
      `;
      const params: unknown[] = [term, `%${args.day}%`];
      if (args.start_time) {
        sql += ` AND ss.start_time >= ?`;
        params.push(args.start_time);
      }
      if (args.end_time) {
        sql += ` AND ss.end_time <= ?`;
        params.push(args.end_time);
      }
      sql += ` ORDER BY ss.start_time LIMIT ?`;
      params.push(limit);
      const rows = db.prepare(sql).all(...params);
      return { day: args.day, classes: rows };
    }
    
    default:
      return { error: `Unknown function: ${name}` };
  }
}

// System prompt
const SYSTEM_PROMPT = `You are SISIA Assistant, an AI helper for Ateneo students to query class schedules, courses, instructors, and rooms.

Current data: 2024-2025 academic year (terms 2024-2, 2025-0, 2025-1, 2025-2).
Database has: ~12,500 class sections, 2,400+ courses, 1,700+ instructors, 300+ rooms.

When displaying results:
- Format schedules as markdown tables when there are multiple entries
- Show instructor names in "LASTNAME, FIRSTNAME" format
- Include room codes and time slots
- For large result sets, summarize and offer to show more

Be helpful, concise, and accurate. If you can't find something, suggest alternatives.`;

// Chat endpoint
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { message, history = [] } = req.body;
    
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash',
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ functionDeclarations: functions }],
    });
    
    const chat = model.startChat({
      history: history.map((msg: { role: string; content: string }) => ({
        role: msg.role,
        parts: [{ text: msg.content }],
      })),
    });
    
    let response = await chat.sendMessage(message);
    let result = response.response;
    
    // Handle function calls
    let functionCalls = result.functionCalls();
    while (functionCalls && functionCalls.length > 0) {
      const functionResponses = [];
      
      for (const call of functionCalls) {
        console.log(`Function call: ${call.name}`, call.args);
        const functionResult = handleFunctionCall(call.name, call.args as Record<string, unknown>);
        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: functionResult,
          },
        });
      }
      
      response = await chat.sendMessage(functionResponses);
      result = response.response;
      functionCalls = result.functionCalls();
    }
    
    const text = result.text();
    res.json({ response: text });
    
  } catch (error: unknown) {
    console.error('Chat error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  const stats = db.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM class_section) as sections,
      (SELECT COUNT(*) FROM course) as courses,
      (SELECT COUNT(*) FROM instructor) as instructors
  `).get();
  res.json({ status: 'ok', database: stats });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🤖 SISIA Chat API running on http://localhost:${PORT}`);
});
