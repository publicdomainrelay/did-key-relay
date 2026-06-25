import type { RelayRequest } from "@publicdomainrelay/did-key-relay-common";

export interface SubscriberOptions {
  label?: string;
  keypair: {
    did(): string;
    sign(data: Uint8Array): Promise<Uint8Array>;
  };
  getServiceAuthToken: (nsid: string) => Promise<string>;
  dispatcherHost: string;
  synthetic?: boolean;
  handleRequest?: (
    req: RelayRequest,
  ) => Promise<{ status: number; body: unknown; contentType: string }>;
  /**
   * When set, inbound relay subscriptions for the tunnel NSID open a TCP
   * connection to this target and pipe bytes full-duplex over the relay
   * (raw byte stream, e.g. SSH-over-websocket).
   */
  tunnelTarget?: { hostname: string; port: number };
}

export interface SubscriberHandle {
  subdomain: string;
  proxyRef: string;
  ws: WebSocket;
}

export interface CallerOptions {
  label?: string;
  dispatcherHost: string;
  subscriberDid?: string;
  subscriberSubdomain?: string;
  nsid?: string;
  cursor?: number;
  onEvent?: (summary: Record<string, unknown>, eventIndex: number) => void;
}

export interface CallerHandle {
  close(): void;
}
