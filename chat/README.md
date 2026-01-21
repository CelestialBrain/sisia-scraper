# SISIA Chat - AI-Powered Class Schedule Assistant

An AI chatbot for Ateneo students to query class schedules, courses, instructors, and rooms.

## Architecture

```
chat/server/
├── api.ts                 ← Express routes (clean, ~220 lines)
├── src/
│   ├── models/            ← Database SQL queries
│   │   ├── Course.ts        searchCourses, getCourseSections, compareSections
│   │   ├── ClassSection.ts  searchByNaturalTime, buildSchedule
│   │   ├── Instructor.ts    searchInstructors, getInstructorSchedule
│   │   ├── Room.ts          getRoomSchedule
│   │   ├── Curriculum.ts    getCurriculum, listDegreePrograms
│   │   └── index.ts
│   └── mcp/
│       └── tools/         ← Gemini function tools (1 file = 1 tool)
│           ├── searchCourses.ts
│           ├── getCourseSections.ts
│           ├── compareSections.ts
│           ├── searchInstructors.ts
│           ├── getInstructorSchedule.ts
│           ├── getRoomSchedule.ts
│           ├── getCurriculum.ts
│           ├── buildSchedule.ts
│           ├── searchByNaturalTime.ts
│           └── index.ts
├── cache.ts               ← LRU cache
├── embedding.ts           ← Gemini embeddings
└── websocket.ts           ← Real-time updates
```

## AI Configuration

```typescript
const AI_CONFIG = {
  model: "gemini-2.0-flash",
  temperature: 0.3, // Low for factual responses
  maxOutputTokens: 2048,
  topP: 0.8,
  topK: 40,
};
```

## Quick Start

```bash
npm install
npm run dev         # Frontend: http://localhost:5173
npx tsx server/api.ts   # API: http://localhost:3001
```

## API Endpoints

| Endpoint      | Method | Description                 |
| ------------- | ------ | --------------------------- |
| `/api/chat`   | POST   | Chat with AI assistant      |
| `/api/health` | GET    | Health check with tool list |

## Adding a New Tool

1. Create model function in `src/models/YourModel.ts`
2. Create tool file in `src/mcp/tools/yourTool.ts`
3. Export from `src/mcp/tools/index.ts`
