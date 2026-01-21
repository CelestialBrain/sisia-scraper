/**
 * WebSocket server for SISIA real-time notifications
 * Provides streaming chat responses and schedule change alerts
 */

import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'http';

interface WSMessage {
  type: 'chat_stream' | 'notification' | 'slot_change' | 'console_log' | 'ping';
  payload: unknown;
}

interface WSClient {
  ws: WebSocket;
  id: string;
  subscribedCourses: string[];
  lastPing: number;
}

export class SISIAWebSocket {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WSClient> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;

  constructor() {}

  // Attach to existing HTTP server
  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      
      const client: WSClient = {
        ws,
        id: clientId,
        subscribedCourses: [],
        lastPing: Date.now(),
      };
      
      this.clients.set(clientId, client);
      console.log(`🔌 WebSocket client connected: ${clientId}`);

      // Send welcome message
      this.sendToClient(clientId, {
        type: 'notification',
        payload: { message: 'Connected to SISIA real-time updates', clientId },
      });

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as { type: string; payload?: unknown };
          this.handleMessage(clientId, message);
        } catch (err) {
          console.error('WebSocket message parse error:', err);
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`🔌 WebSocket client disconnected: ${clientId}`);
      });

      ws.on('error', (err) => {
        console.error(`WebSocket error for ${clientId}:`, err);
        this.clients.delete(clientId);
      });
    });

    // Start ping interval to keep connections alive
    this.pingInterval = setInterval(() => {
      this.pingClients();
    }, 30000); // Every 30 seconds

    console.log('🔌 WebSocket server started on /ws');
  }

  private handleMessage(clientId: string, message: { type: string; payload?: unknown }): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (message.type) {
      case 'pong':
        client.lastPing = Date.now();
        break;

      case 'subscribe':
        // Subscribe to course slot updates
        if (message.payload && typeof message.payload === 'object' && 'courses' in message.payload) {
          const courses = (message.payload as { courses: string[] }).courses || [];
          client.subscribedCourses = courses;
          this.sendToClient(clientId, {
            type: 'notification',
            payload: { message: `Subscribed to updates for: ${courses.join(', ')}` },
          });
        }
        break;

      case 'unsubscribe':
        client.subscribedCourses = [];
        break;

      default:
        break;
    }
  }

  private pingClients(): void {
    const now = Date.now();
    
    for (const [clientId, client] of this.clients) {
      // Disconnect clients that haven't responded in 60 seconds
      if (now - client.lastPing > 60000) {
        client.ws.close();
        this.clients.delete(clientId);
        continue;
      }

      this.sendToClient(clientId, { type: 'ping', payload: { time: now } });
    }
  }

  // Send message to specific client
  sendToClient(clientId: string, message: WSMessage): void {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }

  // Broadcast to all clients
  broadcast(message: WSMessage): void {
    for (const [clientId] of this.clients) {
      this.sendToClient(clientId, message);
    }
  }

  // Notify clients subscribed to specific courses about slot changes
  notifySlotChange(courseCode: string, sectionData: { section: string; oldSlots: number; newSlots: number }): void {
    for (const [clientId, client] of this.clients) {
      if (client.subscribedCourses.includes(courseCode)) {
        this.sendToClient(clientId, {
          type: 'slot_change',
          payload: {
            course: courseCode,
            ...sectionData,
            message: `${courseCode} ${sectionData.section}: slots changed from ${sectionData.oldSlots} to ${sectionData.newSlots}`,
          },
        });
      }
    }
  }

  // Stream chat response tokens
  streamChatToken(clientId: string, token: string, done = false): void {
    this.sendToClient(clientId, {
      type: 'chat_stream',
      payload: { token, done },
    });
  }

  // Stream console log to all debug subscribers
  streamLog(level: 'info' | 'function' | 'result' | 'error', message: string, data?: Record<string, unknown>): void {
    this.broadcast({
      type: 'console_log',
      payload: {
        level,
        message,
        data,
        timestamp: new Date().toISOString(),
      },
    });
  }

  // Get stats
  getStats(): { connectedClients: number; subscriptions: Record<string, number> } {
    const subscriptions: Record<string, number> = {};
    
    for (const [, client] of this.clients) {
      for (const course of client.subscribedCourses) {
        subscriptions[course] = (subscriptions[course] || 0) + 1;
      }
    }

    return {
      connectedClients: this.clients.size,
      subscriptions,
    };
  }

  // Cleanup
  close(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    if (this.wss) {
      this.wss.close();
    }
  }
}

// Singleton instance
export const wsServer = new SISIAWebSocket();
