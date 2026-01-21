/**
 * Hold Orders Scraper
 * 
 * Scrapes user's hold orders from J_VHOR.do
 * 
 * AISIS Structure (based on actual page analysis):
 * - Usually shows text message: "You have no pending Hold Orders..."
 * - If holds exist: table format with hold details
 * - Form: dropdown for School Year - Semester
 */

import * as cheerio from 'cheerio';
import { loginToAISIS } from './aisisSession.js';

export interface HoldOrder {
  type: string;
  reason: string;
  office: string;
  date_placed?: string;
  status: string;
}

export interface HoldOrdersResult {
  student_name: string;
  has_holds: boolean;
  hold_count: number;
  holds: HoldOrder[];
  message: string;
  term: string;
}

/**
 * Scrape hold orders from AISIS
 */
export async function scrapeHoldOrders(
  username: string,
  password: string,
  term?: string
): Promise<HoldOrdersResult> {
  const session = await loginToAISIS(username, password);
  
  let url = 'https://aisis.ateneo.edu/j_aisis/J_VHOR.do';
  if (term) {
    url += `?termCode=${term}`;
  }
  
  const response = await session.fetch(url);
  const html = await response.text();
  
  const $ = cheerio.load(html);
  const holds: HoldOrder[] = [];
  
  // Extract student name
  const studentNameText = $('span.text04').last().text().trim();
  
  // Extract term from dropdown or header
  const termText = $('select option:selected').text().trim() || term || '2025-2';
  
  // Check for "no hold orders" message
  const pageText = $('body').text().toLowerCase();
  const noHoldsMsg = pageText.includes('no pending hold orders') || 
                     pageText.includes('no hold orders') ||
                     pageText.includes('you have no');
  
  if (!noHoldsMsg) {
    // Parse holds table if present
    $('table').each((_, table) => {
      const $table = $(table);
      const headerText = $table.find('tr').first().text().toLowerCase();
      
      // Look for hold orders table (might have columns like Type, Reason, Office)
      if (!headerText.includes('type') && !headerText.includes('hold')) {
        return;
      }
      
      $table.find('tr').slice(1).each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length < 2) return;
        
        holds.push({
          type: $(cells[0]).text().trim(),
          reason: $(cells[1]).text().trim(),
          office: cells[2] ? $(cells[2]).text().trim() : '',
          date_placed: cells[3] ? $(cells[3]).text().trim() : undefined,
          status: cells[4] ? $(cells[4]).text().trim() : 'Active',
        });
      });
    });
  }
  
  const hasHolds = holds.length > 0;
  let message: string;
  
  if (hasHolds) {
    message = `⚠️ You have ${holds.length} active hold order(s). Please contact the relevant office to resolve before enrollment.`;
  } else {
    message = '✅ You have no pending hold orders. You are clear for enrollment activities.';
  }
  
  return {
    student_name: studentNameText,
    has_holds: hasHolds,
    hold_count: holds.length,
    holds,
    message,
    term: termText,
  };
}
