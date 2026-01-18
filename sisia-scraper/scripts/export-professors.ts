/**
 * Export active professors from SISIA database to scraper's target list
 * Run: npm run export-professors
 */

import { config } from "dotenv";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SisiaInstructor {
  id: number;
  name: string;
}

interface ExportedProfessor {
  instructor_id: number;
  name: string;
  name_normalized: string;
  search_terms: string[];
  last_name: string;
  first_name: string;
}

/**
 * Normalize name for matching
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.']/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b[a-z]\b/g, "")
    .trim();
}

/**
 * Parse AISIS format name: "LASTNAME, FIRSTNAME M."
 */
function parseName(name: string): { lastName: string; firstName: string } {
  const parts = name.split(",").map(p => p.trim());
  return {
    lastName: parts[0] || name,
    firstName: parts[1] || "",
  };
}

/**
 * Generate search term variations
 */
function generateSearchTerms(name: string): string[] {
  const terms: string[] = [name];
  const { lastName, firstName } = parseName(name);
  
  // Add variations
  terms.push(lastName);
  if (firstName) {
    terms.push(firstName.split(" ")[0]); // First part of first name
    terms.push(`${lastName} ${firstName.split(" ")[0]}`);
  }
  terms.push(normalizeName(name));

  return [...new Set(terms.filter(t => t.length > 1))];
}

async function main() {
  console.log("🎓 Exporting professors from SISIA database...\n");

  // Paths
  const sisiaDbPath = process.env.SISIA_DB_PATH || join(__dirname, "../../chat/server/data/sisia.db");
  const scraperDbPath = process.env.DB_PATH || join(__dirname, "../data/scraper.db");
  const exportPath = join(__dirname, "../data/professors.json");

  // Check SISIA database exists
  if (!existsSync(sisiaDbPath)) {
    console.error(`❌ SISIA database not found at: ${sisiaDbPath}`);
    console.log("   Make sure you've run the SISIA scraper to populate instructor data.");
    process.exit(1);
  }

  // Ensure data directory exists
  const dataDir = dirname(exportPath);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // Connect to SISIA database
  const sisiaDb = new Database(sisiaDbPath, { readonly: true });

  // Get instructors who are actively teaching (have sections in recent terms)
  const instructors = sisiaDb.prepare(`
    SELECT DISTINCT i.id, i.name
    FROM instructor i
    JOIN class_section cs ON cs.instructor_id = i.id
    JOIN term t ON cs.term_id = t.id
    WHERE t.code IN ('2025-1', '2025-2', '2024-2', '2024-1')
      AND i.name IS NOT NULL
      AND i.name != ''
      AND i.name NOT LIKE '%TBA%'
    ORDER BY i.name
  `).all() as SisiaInstructor[];

  console.log(`📊 Found ${instructors.length} active instructors\n`);

  // Transform for export
  const professors: ExportedProfessor[] = instructors.map(inst => {
    const { lastName, firstName } = parseName(inst.name);
    return {
      instructor_id: inst.id,
      name: inst.name,
      name_normalized: normalizeName(inst.name),
      search_terms: generateSearchTerms(inst.name),
      last_name: lastName,
      first_name: firstName,
    };
  });

  // Save to JSON
  writeFileSync(exportPath, JSON.stringify(professors, null, 2));
  console.log(`✅ Exported to: ${exportPath}\n`);

  // Also insert into scraper database if it exists
  if (!existsSync(scraperDbPath)) {
    // Initialize scraper DB with schema
    const initDb = new Database(scraperDbPath);
    const schemaPath = join(__dirname, "../db/schema.sql");
    if (existsSync(schemaPath)) {
      const { readFileSync } = await import("fs");
      const schema = readFileSync(schemaPath, "utf-8");
      initDb.exec(schema);
    }
    initDb.close();
  }

  const scraperDb = new Database(scraperDbPath);
  
  // Insert professors with priority (limit to first 20 for initial scraping)
  const insertStmt = scraperDb.prepare(`
    INSERT OR REPLACE INTO target_professors 
    (instructor_id, name, name_normalized, search_terms, priority, active)
    VALUES (?, ?, ?, ?, ?, TRUE)
  `);

  const limit = parseInt(process.env.PROFESSOR_LIMIT || "20");
  let inserted = 0;

  for (let i = 0; i < Math.min(professors.length, limit); i++) {
    const prof = professors[i];
    insertStmt.run(
      prof.instructor_id,
      prof.name,
      prof.name_normalized,
      JSON.stringify(prof.search_terms),
      limit - i // Higher priority for first professors
    );
    inserted++;
  }

  scraperDb.close();
  sisiaDb.close();

  console.log(`📝 Inserted ${inserted} professors into scraper database (priority queue)`);
  console.log(`\n🎯 Top 5 professors to scrape:`);
  professors.slice(0, 5).forEach((p, i) => {
    console.log(`   ${i + 1}. ${p.name}`);
  });
  console.log("\n✨ Done! Run 'npm run scrape' to start collecting feedback.");
}

main().catch(console.error);
