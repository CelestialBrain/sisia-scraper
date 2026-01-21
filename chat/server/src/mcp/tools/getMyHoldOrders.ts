/**
 * Get My Hold Orders Tool
 * 
 * Checks for any hold orders on the user's AISIS account.
 */

import { SchemaType } from '@google/generative-ai';
import { scrapeHoldOrders } from '../../scrapers/holdOrders.js';
import { getDecryptedCredentials } from '../../routes/aisis.js';

export const definition = {
  name: 'get_my_hold_orders',
  description: 'Check if YOU have any hold orders on your AISIS account. Returns: has_holds flag, hold details, and status message.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {},
    required: [],
  },
};

export async function handler(
  _args: Record<string, unknown>,
  context: { userId: string; accessToken: string }
) {
  const credentials = await getDecryptedCredentials(context.userId, context.accessToken);
  
  if (!credentials) {
    return { 
      error: 'AISIS account not linked. Please link your account first.',
      action_required: 'link_aisis'
    };
  }
  
  try {
    const result = await scrapeHoldOrders(
      credentials.username,
      credentials.password
    );
    
    return {
      has_holds: result.has_holds,
      holds: result.holds,
      message: result.message,
    };
  } catch (error: any) {
    return { 
      error: 'Failed to check hold orders.',
      details: error.message
    };
  }
}
