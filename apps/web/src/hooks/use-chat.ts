'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '@/store/auth-store';
import { env } from '@/config/env';
import { io, type Socket } from 'socket.io-client';

export interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  user: {
    id: string;
    username: string | null;
    walletAddress: string;
    role: 'user' | 'moderator' | 'admin';
    level?: number;
  };
}

/**
 * Dedicated chat socket — takes the JWT from the auth store so authed users
 * can post. Reconnects are automatic via socket.io-client's built-in
 * exponential backoff.
 */
export function useChat() {
  const token = useAuthStore((s) => s.accessToken);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const url = `${env.wsUrl.replace(/\/$/, '')}/chat`;
    const sock = io(url, {
      transports: ['websocket'],
      auth: token ? { token } : undefined,
      reconnection: true,
      withCredentials: true,
    });

    sock.on('connect', () => setConnected(true));
    sock.on('disconnect', () => setConnected(false));
    sock.on('chat:history', (msgs: ChatMessage[]) => setMessages(msgs));
    sock.on('chat:message', (msg: ChatMessage) =>
      setMessages((prev) => [...prev, msg].slice(-200)),
    );
    sock.on('chat:error', (payload: { message: string }) => {
      setError(payload.message);
      setTimeout(() => setError(null), 4000);
    });

    // eslint-disable-next-line react-hooks/set-state-in-effect -- io() opens a Socket.io connection (a side effect that must not run during render); storing the resulting socket in state is the intended subscribe-to-external-system pattern.
    setSocket(sock);
    return () => {
      sock.disconnect();
    };
  }, [token]);

  const send = useCallback(
    (body: string) => {
      if (!socket) return;
      socket.emit('chat:send', { body });
    },
    [socket],
  );

  return { messages, send, error, connected, canPost: !!token };
}
