'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { env } from '@/config/env';

interface SocketRegistry {
  getSocket: (namespace: string) => Socket;
}

const SocketContext = createContext<SocketRegistry | null>(null);

/**
 * Lazy per-namespace Socket.io client. Components that need a live feed
 * call `useSocket('/coinflip')` which either returns an existing connection
 * or spins up a new one on demand — keeps the handshake cost off pages
 * that don't use sockets.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const registry = useRef<Map<string, Socket>>(new Map());

  const getSocket = (namespace: string): Socket => {
    const existing = registry.current.get(namespace);
    if (existing && existing.connected) return existing;
    const url = `${env.wsUrl.replace(/\/$/, '')}${namespace}`;
    const sock = io(url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1_000,
      withCredentials: true,
    });
    registry.current.set(namespace, sock);
    return sock;
  };

  useEffect(() => {
    const map = registry.current;
    return () => {
      for (const s of map.values()) s.disconnect();
      map.clear();
    };
  }, []);

  return <SocketContext.Provider value={{ getSocket }}>{children}</SocketContext.Provider>;
}

/**
 * Subscribe to a namespaced socket. Cleans up listeners on unmount but
 * keeps the underlying connection alive for other components.
 */
export function useSocket(namespace: string): Socket | null {
  const ctx = useContext(SocketContext);
  const [sock, setSock] = useState<Socket | null>(null);

  useEffect(() => {
    if (!ctx) return;
    const s = ctx.getSocket(namespace);
    setSock(s);
  }, [ctx, namespace]);

  return sock;
}
